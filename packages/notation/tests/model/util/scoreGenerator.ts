import { CLEF_DEFS } from '@mushee/notation/components/constants'
import type { BarlineType, ClefType, DurationType } from '@mushee/notation/components/types'
import { BEAT_EPSILON, Duration } from '@mushee/notation/model/Duration'
import { Instrument } from '@mushee/notation/model/Instrument'
import { Measure } from '@mushee/notation/model/Measure'
import { Note } from '@mushee/notation/model/Note'
import { Pitch } from '@mushee/notation/model/Pitch'
import { Score } from '@mushee/notation/model/Score'
import { TimeSignature } from '@mushee/notation/model/TimeSignature'

/**
 * Seeded random scores for property tests: every meter, clef and key the model
 * knows, dotted values, triplets, ties, mid-bar clef/key changes, tempo marks,
 * barlines, every selectable instrument. Deterministic per seed, so a failing
 * property names the one seed to rerun.
 */

// --- Seeded randomness (mulberry32) ---

export class Rng {
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

export interface GeneratorOptions {
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

export function generateScore(rng: Rng, options: GeneratorOptions): Score {
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
