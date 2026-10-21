import { describe, expect, it } from 'vitest'

import { BEAT_EPSILON } from '../../../../packages/notation/src/model/Duration'
import { DURATION_TYPE, type MxmlMeasure as EditorMxmlMeasure } from '../../../../packages/notation/src/model/io/MusicXml'
import { ScoreDeserializer } from '../../../../packages/notation/src/model/io/ScoreDeserializer'
import { Score } from '../../../../packages/notation/src/model/Score'
import { TimeSignature } from '../../../../packages/notation/src/model/TimeSignature'
import { DurationSpeller } from '../../../../packages/notation/src/model/util/DurationSpeller'
import { MxmlBuilder, type PendingNote } from '../../src/recordings/pipeline/mxml-builder'

/**
 * The live-recording contract between the API and the editor: every measure the
 * pipeline's MxmlBuilder emits must load into the editor's score model — the
 * whole take as a document, and bar by bar the way useRecording applies streamed
 * `score-update`s (`ScoreDeserializer.mxmlMeasureToNotes` → `Score.replace`).
 * Random monophonic note streams in every meter the recorder offers; the bars
 * that come out must be full (never over-full, never short by a triplet sixteenth
 * or more), and nothing may throw on either side.
 *
 * It also pins the API's two hand-kept twins of packages/notation, which the
 * API's CommonJS build cannot import yet: the emitted types (mxml.types.ts vs
 * model/io/MusicXml.ts, checked by `tsc` through the typed `measures` below) and
 * the duration speller (MxmlBuilder.spellSpan vs model/util/DurationSpeller.ts).
 */

class Rng {
    private state: number
    constructor(seed: number) {
        this.state = seed >>> 0
    }
    next(): number {
        let t = (this.state += 0x6d2b79f5)
        t = Math.imul(t ^ (t >>> 15), t | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
    int(min: number, max: number): number {
        return min + Math.floor(this.next() * (max - min + 1))
    }
    pick<T>(items: readonly T[]): T {
        return items[Math.floor(this.next() * items.length)]
    }
}

const METERS: ReadonlyArray<[number, number]> = [
    [4, 4],
    [3, 4],
    [2, 4],
    [6, 8],
    [2, 2],
    [5, 4],
    [7, 8],
    [12, 8],
]
const RESIDUE = 1 / 6

/** A monophonic take: notes with real-world onsets and lengths (not grid-aligned), gaps in between. */
function take(rng: Rng, bpm: number): PendingNote[] {
    const notes: PendingNote[] = []
    const secondsPerBeat = 60 / bpm
    let t = rng.next() * 0.4
    for (let i = rng.int(1, 40); i > 0; i--) {
        const durationSeconds = secondsPerBeat * (0.12 + rng.next() * 2.5)
        notes.push({
            startTimeSeconds: t,
            durationSeconds,
            pitchMidi: rng.int(48, 84),
            ...(rng.next() < 0.3 && { pitchMidiFloat: rng.int(48, 84) + rng.next() - 0.5 }),
        })
        t += durationSeconds + (rng.next() < 0.6 ? 0 : rng.next() * secondsPerBeat * 2)
    }
    return notes
}

const SEEDS = Array.from({ length: 150 }, (_, i) => i + 1)

describe('MxmlBuilder output loads into the editor model', () => {
    it.each(SEEDS)('whole take and bar-by-bar streaming both yield well-formed bars (seed %i)', (seed) => {
        const rng = new Rng(seed)
        const [beats, beatType] = rng.pick(METERS)
        const bpm = rng.int(40, 200)
        // Drawn in the order the seeds were recorded with: transpose, key, then the voice-spelling coin.
        const chromaticTranspose = rng.pick([0, -2, -9, 12])
        const keyFifths = rng.int(-7, 7)
        const voiceSpelling = rng.next() < 0.4
        const builder = new MxmlBuilder({ bpm, beats, beatType, chromaticTranspose, keyFifths, voiceSpelling })
        const notes = take(rng, bpm)
        const last = notes[notes.length - 1]
        const measureCount = builder.measureIndexFor(last.startTimeSeconds + last.durationSeconds) + 1
        // Typed as the EDITOR's measure: the compile-time pin that the API's emitted
        // subset (mxml.types.ts) stays assignable to the wire format it feeds.
        const measures: EditorMxmlMeasure[] = Array.from({ length: measureCount }, (_, i) => builder.buildMeasure(i, notes))

        // 1. As a document — what a finished take is saved as.
        const score = new ScoreDeserializer({
            partList: { scoreParts: [{ id: 'P1', partName: 'Piano' }] },
            parts: [{ id: 'P1', measures: measures.map((m, i) => ({ ...m, number: String(i + 1) })) }],
        }).toScore()
        expect(score.measures.length).toBe(measureCount)
        for (const measure of score.measures) {
            expect(measure.beats, `bar ${measure.index} over-full`).toBeLessThan(measure.maxBeats + BEAT_EPSILON)
            expect(measure.maxBeats - measure.beats, `bar ${measure.index} holds ${measure.beats}/${measure.maxBeats}`).toBeLessThan(
                RESIDUE,
            )
        }

        // 2. Streamed into a live editor score, the way useRecording applies score-updates.
        const live = new Score()
        const timeSignature = new TimeSignature(beats, beatType)
        for (let i = 0; i < measureCount; i++) {
            const measure = live.addMeasure()
            measure.setTimeSignature(timeSignature)
            measure.complete()
        }
        for (const [index, mxml] of measures.entries()) {
            const target = live.measures[index]
            const streamed = ScoreDeserializer.mxmlMeasureToNotes(mxml)
            if (!streamed.length || !target.firstNote) continue
            live.replace([target.firstNote], streamed)
            for (const measure of live.measures) {
                expect(measure.beats, `after bar ${index}: bar ${measure.index} over-full`).toBeLessThan(measure.maxBeats + BEAT_EPSILON)
                expect(measure.maxBeats - measure.beats, `after bar ${index}: bar ${measure.index} short`).toBeLessThan(RESIDUE)
            }
        }
        expect(live.measures.length).toBe(measureCount) // a streamed bar never spills into a new one
    })
})

/**
 * MxmlBuilder.spellSpan is the original that DurationSpeller ports: the same
 * metrical split at 12 divisions per quarter instead of 4 sixteenth units, with
 * one known divergence — in the no-interior-boundary fallback the API takes any
 * value that fits, where DurationSpeller also requires it to align. Until the API
 * can run the package, this pins the two to the same spelling for every
 * sixteenth-grid span of every recorder meter. A case that differs is listed in
 * KNOWN_DIFFERENCES with the reason; neither speller is changed to make this pass
 * (the builder's output is the benchmarked recording path).
 */
describe('MxmlBuilder spells durations as the editor DurationSpeller does', () => {
    // Expected only from the fallback, which on-grid spans do not reach in these
    // metres (every case below agrees), so today there are none. Format:
    // `${beats}/${beatType} start=${sixteenth} length=${sixteenths}: <api> vs <editor>`.
    const KNOWN_DIFFERENCES: string[] = []

    it.each(METERS)('%i/%i: every on-grid note span', (beats, beatType) => {
        // 60 bpm: one second per quarter, so sixteenth positions are exact in seconds.
        const builder = new MxmlBuilder({ bpm: 60, beats, beatType })
        const speller = new DurationSpeller(new TimeSignature(beats, beatType))
        const sixteenths = (beats * 16) / beatType
        const differences: string[] = []
        for (let start = 0; start < sixteenths; start++) {
            for (let length = 1; start + length <= sixteenths; length++) {
                const measure = builder.buildMeasure(0, [{ startTimeSeconds: start / 4, durationSeconds: length / 4, pitchMidi: 60 }])
                const written = measure.entries
                    .filter((e) => e._type === 'note' && e.pitch)
                    .map((e) => (e._type === 'note' && e.type ? `${DURATION_TYPE[e.type]}${'.'.repeat(e.dot ?? 0)}` : '?'))
                const expected = speller.spell(start / 4, length / 4).map((d) => `${d.type}${'.'.repeat(d.dots)}`)
                if (written.join(' ') !== expected.join(' ')) {
                    differences.push(`${beats}/${beatType} start=${start} length=${length}: ${written.join(' ')} vs ${expected.join(' ')}`)
                }
            }
        }
        expect(differences).toEqual(KNOWN_DIFFERENCES.filter((d) => d.startsWith(`${beats}/${beatType} `)))
    })
})
