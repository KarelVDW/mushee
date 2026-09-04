import { CLEF_DEFS } from '@mushee/notation/components/constants'
import type { BarlineType, ClefType, DurationType, ScorePartwise } from '@mushee/notation/components/types'
import { BEAT_EPSILON, Duration } from '@mushee/notation/model/Duration'
import { Instrument } from '@mushee/notation/model/Instrument'
import { Measure } from '@mushee/notation/model/Measure'
import { Note } from '@mushee/notation/model/Note'
import { Pitch } from '@mushee/notation/model/Pitch'
import { Score } from '@mushee/notation/model/Score'
import { TimeSignature } from '@mushee/notation/model/TimeSignature'
import { MidiExporter } from '@mushee/notation/model/util/MidiExporter'
import { MidiImporter } from '@mushee/notation/model/util/MidiImporter'
import { MusicXmlExporter } from '@mushee/notation/model/util/MusicXmlExporter'
import { MusicXmlImporter } from '@mushee/notation/model/util/MusicXmlImporter'
import { ScoreDeserializer } from '@mushee/notation/model/util/ScoreDeserializer'
import { ScoreSerializer } from '@mushee/notation/model/util/ScoreSerializer'
import { describe, expect, it } from 'vitest'

/**
 * Generative round-trip properties. A seeded generator builds random but valid
 * scores — every meter, clef and key the model knows, dotted values, triplets,
 * ties, mid-bar clef/key changes, tempo marks, barlines, every selectable
 * instrument — and each persistence path must give the same score back:
 *
 *  - JSON (the shape the API stores) → exact.
 *  - MusicXML export → import: exact, and the importer must not need to warn about
 *    a document we wrote ourselves.
 *  - MIDI export → import: the *sounding* music (onset, release, sounding pitch,
 *    tempo, meter) — MIDI carries no spelling, written pitch or rests.
 *
 * Deterministic seeds make any failure reproducible: rerun the one seed.
 */

// --- Seeded randomness (mulberry32) ---

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

    chance(probability: number): boolean {
        return this.next() < probability
    }
}

// --- Generator ---

const PLAIN_VALUES: ReadonlyArray<{ type: DurationType; dots: number }> = [
    { type: 'w', dots: 0 },
    { type: 'h', dots: 1 },
    { type: 'h', dots: 0 },
    { type: 'q', dots: 1 },
    { type: 'q', dots: 0 },
    { type: '8', dots: 1 },
    { type: '8', dots: 0 },
    { type: '16', dots: 0 },
]
const TRIPLET_BASES: ReadonlyArray<{ type: DurationType; dots: number }> = [
    { type: 'q', dots: 0 },
    { type: '8', dots: 0 },
    { type: '8', dots: 1 },
    { type: '16', dots: 0 },
]
const TIME_SIGNATURES: ReadonlyArray<[number, number]> = [
    [4, 4],
    [3, 4],
    [2, 4],
    [6, 8],
    [2, 2],
    [3, 8],
    [5, 4],
    [9, 8],
    [12, 8],
    [7, 8],
    [3, 2],
]
const CLEFS = Object.keys(CLEF_DEFS) as ClefType[]
const EXPLICIT_BARLINES: ReadonlyArray<BarlineType> = ['double', 'end', 'none']
const MODES = ['major', 'minor', undefined]

interface GeneratorOptions {
    /** Triplet groups (MIDI import quantizes to sixteenths, so the MIDI property runs without them). */
    tuplets: boolean
    /** Tempo marks anywhere in a bar, or only on its downbeat (MIDI import keeps one marking per bar). */
    midBarTempos: boolean
}

function randomPitch(rng: Rng): Pitch {
    const name = rng.pick(['C', 'D', 'E', 'F', 'G', 'A', 'B'])
    const roll = rng.next()
    const alter = roll < 0.6 ? 0 : roll < 0.8 ? 1 : roll < 0.95 ? -1 : rng.pick([2, -2])
    // Half the altered notes carry no accidental token (a key-spelled note): only `alter` is persisted.
    const accidental = rng.chance(0.5) ? Pitch.alterToAccidental(alter) : undefined
    return new Pitch({ name, alter, accidental, octave: rng.int(3, 6) })
}

function samePitch(a: Pitch | undefined, b: Pitch | undefined): boolean {
    return !!a && !!b && a.name === b.name && a.alter === b.alter && a.octave === b.octave
}

/** Written values filling exactly `maxBeats`, mixing plain and dotted values with whole triplet groups. */
function barRhythm(rng: Rng, maxBeats: number, tuplets: boolean): Duration[] {
    const result: Duration[] = []
    let remaining = maxBeats
    while (remaining > BEAT_EPSILON) {
        if (tuplets && rng.chance(0.15)) {
            const bases = TRIPLET_BASES.filter((base) => 2 * new Duration(base).beats <= remaining + BEAT_EPSILON)
            if (bases.length) {
                const base = rng.pick(bases)
                for (let i = 0; i < 3; i++) result.push(new Duration({ ...base, ratio: { actualNotes: 3, normalNotes: 2 } }))
                remaining -= 2 * new Duration(base).beats
                continue
            }
        }
        const fits = PLAIN_VALUES.filter((value) => new Duration(value).beats <= remaining + BEAT_EPSILON)
        const value = new Duration(rng.pick(fits))
        result.push(value)
        remaining -= value.beats
    }
    return result
}

function generateScore(rng: Rng, options: GeneratorOptions): Score {
    const score = new Score()
    score.seedInstrument(rng.pick(Instrument.selectable()))

    // Content first, so ties can look at the next note across bars.
    const bars: Array<{ timeSignature: TimeSignature; durations: Duration[]; pitches: Array<Pitch | undefined> }> = []
    let timeSignature = new TimeSignature(...rng.pick(TIME_SIGNATURES))
    let previousPitch: Pitch | undefined
    for (let i = rng.int(1, 6); i > 0; i--) {
        if (bars.length && rng.chance(0.2)) timeSignature = new TimeSignature(...rng.pick(TIME_SIGNATURES))
        const durations = barRhythm(rng, timeSignature.maxBeats, options.tuplets)
        const pitches = durations.map(() => {
            // Repeating the previous pitch often enough makes ties common.
            const pitch = rng.chance(0.25) ? undefined : previousPitch && rng.chance(0.3) ? previousPitch : randomPitch(rng)
            previousPitch = pitch
            return pitch
        })
        bars.push({ timeSignature, durations, pitches })
    }
    const flat = bars.flatMap((bar) => bar.pitches)

    let clefType: ClefType = 'treble'
    let key: { fifths: number; mode: string | undefined } = { fifths: 0, mode: undefined }
    let noteIndex = 0
    for (const bar of bars) {
        const leadingClefExplicit = rng.chance(0.15)
        if (leadingClefExplicit) clefType = rng.pick(CLEFS)
        const leadingKeyExplicit = rng.chance(0.15)
        if (leadingKeyExplicit) key = { fifths: rng.int(-7, 7), mode: rng.pick(MODES) }
        const measure = new Measure(score, clefType, bar.timeSignature, {
            keyFifths: key.fifths,
            keyMode: key.mode,
            endBarline: rng.chance(0.2) ? rng.pick(EXPLICIT_BARLINES) : undefined,
            leadingClefExplicit,
            leadingKeyExplicit,
        })
        const notes = bar.durations.map((duration, i) => {
            const pitch = bar.pitches[i]
            const ties = samePitch(pitch, flat[noteIndex + 1]) && rng.chance(0.6)
            return new Note({ duration, pitch, ...(ties && { tie: 'start' as const }) })
        })
        noteIndex += notes.length
        measure.addNotes(notes)

        if (notes.length > 1 && rng.chance(0.15)) {
            clefType = rng.pick(CLEFS)
            measure.addClef(measure.beatOffsetOf(notes[rng.int(1, notes.length - 1)]), clefType)
        }
        if (notes.length > 1 && rng.chance(0.1)) {
            key = { fifths: rng.int(-7, 7), mode: rng.pick(MODES) }
            measure.addKeySignature(measure.beatOffsetOf(notes[rng.int(1, notes.length - 1)]), key.fifths, key.mode)
        }
        if (rng.chance(0.3)) {
            const anchor = options.midBarTempos ? rng.pick(notes) : notes[0]
            measure.addTempo(measure.beatOffsetOf(anchor), rng.int(40, 240))
        }
        score.addMeasure(undefined, measure)
    }
    return score
}

// --- Observations ---

const round = (beats: number) => Math.round(beats * 1e6) / 1e6

function describeNote(note: Note): string {
    const pitch = note.pitch ? `${note.pitch.name}${note.pitch.alter}/${note.pitch.octave}` : 'rest'
    const ratio = note.inTuplet ? `(${note.duration.ratio.actualNotes}:${note.duration.ratio.normalNotes})` : ''
    return `${pitch}:${note.duration.type}${'.'.repeat(note.duration.dots)}${ratio}${note.tiesForward ? '~' : ''}${note.tiesBack ? '_' : ''}`
}

/** Everything the notation persists, in a shape `toEqual` diffs readably. */
function describeScore(score: Score) {
    return {
        instrument: score.instrument.id,
        measures: score.measures.map((measure, index) => ({
            time: `${measure.timeSignature.beatAmount}/${measure.timeSignature.beatType}`,
            // The opening bar's clef and key are always written out, so their "explicit boundary" flag is
            // moot there (nothing precedes it to carry forward from) and is only observed from bar two on.
            clef: `${measure.clef.type}${index > 0 && measure.leadingClefExplicit ? '!' : ''}`,
            key: `${measure.keySignature.fifths}${measure.keySignature.mode ?? ''}${index > 0 && measure.leadingKeyExplicit ? '!' : ''}`,
            midClefs: measure.midMeasureClefs.map((clef) => `${round(clef.beatPosition)}:${clef.type}`),
            midKeys: measure.midMeasureKeySignatures.map((key) => `${round(key.beatPosition)}:${key.fifths}${key.mode ?? ''}`),
            tempos: measure.tempos.map((tempo) => `${round(tempo.beatPosition)}:${tempo.bpm}`),
            barline: measure.endBarline,
            notes: measure.notes.map(describeNote),
        })),
    }
}

/** What a listener hears: one event per attack, ties merged, written pitch transposed to sounding. */
function soundingEvents(score: Score): string[] {
    const events: string[] = []
    let position = 0
    for (const measure of score.measures) {
        for (const note of measure.notes) {
            const start = position
            position += note.duration.effectiveBeats
            if (!note.pitch || note.tiesBack) continue
            let end = position
            let current = note
            while (current.tiesForward) {
                const next = current.getNext()
                if (!next) break
                end += next.duration.effectiveBeats
                current = next
            }
            events.push(`${round(start)}-${round(end)}:${note.pitch.toMidi() + score.instrument.chromaticTranspose}`)
        }
    }
    return events
}

/** Tempo marks as absolute beat → bpm. */
function tempoMarks(score: Score): string[] {
    const marks: string[] = []
    let position = 0
    for (const measure of score.measures) {
        for (const tempo of measure.tempos) marks.push(`${round(position + tempo.beatPosition)}:${tempo.bpm}`)
        position += measure.maxBeats
    }
    return marks
}

const meter = (measure: Measure) => `${measure.timeSignature.beatAmount}/${measure.timeSignature.beatType}`

const SEEDS = Array.from({ length: 150 }, (_, i) => i + 1)

describe('round-trip properties', () => {
    describe('JSON save → load', () => {
        it.each(SEEDS)('preserves the score exactly (seed %i)', (seed) => {
            const score = generateScore(new Rng(seed), { tuplets: true, midBarTempos: true })
            const json = JSON.parse(JSON.stringify(new ScoreSerializer(score).toInput())) as ScorePartwise
            const restored = new ScoreDeserializer(json).toScore()
            expect(describeScore(restored)).toEqual(describeScore(score))
        })
    })

    describe('MusicXML export → import', () => {
        it.each(SEEDS)('preserves the score exactly and needs no warnings (seed %i)', (seed) => {
            const score = generateScore(new Rng(seed), { tuplets: true, midBarTempos: true })
            const imported = new MusicXmlImporter(new MusicXmlExporter(score).toXml('Round trip')).toScore()
            expect(imported.warnings).toEqual([])
            expect(imported.title).toBe('Round trip')
            expect(describeScore(imported.score)).toEqual(describeScore(score))
        })
    })

    describe('MIDI export → import', () => {
        it.each(SEEDS)('preserves the sounding music, meters and tempo marks (seed %i)', (seed) => {
            const score = generateScore(new Rng(seed), { tuplets: false, midBarTempos: false })
            const bytes = new MidiExporter(score).toBytes()
            if (!score.measures.some((measure) => measure.notes.some((note) => note.pitch))) {
                // Silence has no MIDI notes to import; the importer says so instead of producing an empty score.
                expect(() => new MidiImporter(bytes).toScore()).toThrow('contains no notes')
                return
            }
            const imported = new MidiImporter(bytes).toScore()
            expect(imported.warnings).toEqual([])
            expect(soundingEvents(imported.score)).toEqual(soundingEvents(score))

            // MIDI has no rests: bars after the last attack are not reconstructed, everything before is.
            const lastSounding = score.measures.findLastIndex((measure) => measure.notes.some((note) => note.pitch))
            expect(imported.score.measures.length).toBeGreaterThan(lastSounding)
            expect(imported.score.measures.length).toBeLessThanOrEqual(score.measures.length)
            expect(imported.score.measures.map(meter)).toEqual(score.measures.slice(0, imported.score.measures.length).map(meter))

            // Every mark within the reconstructed bars is back (the file may add the default opening tempo when we had none).
            const importedBeats = imported.score.measures.reduce((sum, measure) => sum + measure.maxBeats, 0)
            const marks = tempoMarks(imported.score)
            for (const mark of tempoMarks(score)) {
                if (Number(mark.split(':')[0]) < importedBeats - BEAT_EPSILON) expect(marks).toContain(mark)
            }
        })
    })
})
