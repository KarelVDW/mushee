import { describe, expect, it } from 'vitest'

import { BEAT_EPSILON } from '../../../../packages/notation/src/model/Duration'
import { Score } from '../../../../packages/notation/src/model/Score'
import { TimeSignature } from '../../../../packages/notation/src/model/TimeSignature'
import { ScoreDeserializer } from '../../../../packages/notation/src/model/util/ScoreDeserializer'
import { MxmlBuilder, type PendingNote } from '../../src/recordings/pipeline/mxml-builder'

/**
 * The live-recording contract between the API and the editor: every measure the
 * pipeline's MxmlBuilder emits must load into the editor's score model — the
 * whole take as a document, and bar by bar the way useRecording applies streamed
 * `score-update`s (`ScoreDeserializer.mxmlMeasureToNotes` → `Score.replace`).
 * Random monophonic note streams in every meter the recorder offers; the bars
 * that come out must be full (never over-full, never short by a triplet sixteenth
 * or more), and nothing may throw on either side.
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
        const builder = new MxmlBuilder({ bpm, beats, beatType, chromaticTranspose: rng.pick([0, -2, -9, 12]), keyFifths: rng.int(-7, 7) })
        if (rng.next() < 0.4) builder.setVoiceSpelling(true)
        const notes = take(rng, bpm)
        const last = notes[notes.length - 1]
        const measureCount = builder.measureIndexFor(last.startTimeSeconds + last.durationSeconds) + 1
        const measures = Array.from({ length: measureCount }, (_, i) => builder.buildMeasure(i, notes))

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
