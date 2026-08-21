/**
 * Seeded melody generator for UI-created corpora.
 *
 * The goal is clips that are VARIED enough to be separate test cases (different
 * keys, contours, rhythms) while staying performable by a human reading them
 * off the screen: diatonic, mostly stepwise, one un-tied duration per note,
 * every measure filled exactly, and a long final note to land on.
 *
 * Deterministic: the same params + seed always produce the same clips, so a
 * corpus row in the DB fully reproduces its expected notes.
 */

import type { ClipMelody, MelodyEvent, MelodyPitch } from './melody'

export interface RegisterRange {
    lowMidi: number
    highMidi: number
}

export interface GeneratorParams {
    seed: number
    clipCount: number
    bpm: number
    /** Quarter-note beats per measure; 4 = 4/4, 3 = 3/4. */
    beatsPerMeasure: number
    measuresPerClip: number
    register: RegisterRange
    /** Which keys the per-clip draw may pick from. */
    mode: 'major' | 'minor' | 'mixed'
    /** 0..1 — chance a melodic move is a leap instead of a step. */
    leapProb: number
    /** 0..1 — chance a note becomes a breathing rest. */
    restProb: number
    rhythm: 'simple' | 'varied' | 'complex'
}

/** Register presets offered by the UI, spanning the pipeline's band vocabulary. */
export const REGISTER_PRESETS: Record<string, RegisterRange & { label: string }> = {
    low: { label: 'Low (C3–C4)', lowMidi: 48, highMidi: 60 },
    mid: { label: 'Mid (G3–G5)', lowMidi: 55, highMidi: 79 },
    high: { label: 'High (G4–G6)', lowMidi: 67, highMidi: 91 },
    'very-high': { label: 'Very high (G5–E7)', lowMidi: 79, highMidi: 100 },
}

/** mulberry32 — small, seedable, good enough for melody dice. */
function makeRng(seed: number): () => number {
    let a = seed >>> 0
    return () => {
        a |= 0
        a = (a + 0x6d2b79f5) | 0
        let t = Math.imul(a ^ (a >>> 15), 1 | a)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

function pick<T>(rng: () => number, items: readonly T[]): T {
    return items[Math.floor(rng() * items.length)]
}

interface KeyDef {
    label: string
    mode: 'major' | 'minor'
    fifths: number
    /** The seven scale degrees, spelled. */
    steps: ReadonlyArray<{ step: MelodyPitch['step']; alter: number }>
}

const KEYS: readonly KeyDef[] = [
    { label: 'C major', mode: 'major', fifths: 0, steps: [{ step: 'C', alter: 0 }, { step: 'D', alter: 0 }, { step: 'E', alter: 0 }, { step: 'F', alter: 0 }, { step: 'G', alter: 0 }, { step: 'A', alter: 0 }, { step: 'B', alter: 0 }] },
    { label: 'G major', mode: 'major', fifths: 1, steps: [{ step: 'G', alter: 0 }, { step: 'A', alter: 0 }, { step: 'B', alter: 0 }, { step: 'C', alter: 0 }, { step: 'D', alter: 0 }, { step: 'E', alter: 0 }, { step: 'F', alter: 1 }] },
    { label: 'D major', mode: 'major', fifths: 2, steps: [{ step: 'D', alter: 0 }, { step: 'E', alter: 0 }, { step: 'F', alter: 1 }, { step: 'G', alter: 0 }, { step: 'A', alter: 0 }, { step: 'B', alter: 0 }, { step: 'C', alter: 1 }] },
    { label: 'F major', mode: 'major', fifths: -1, steps: [{ step: 'F', alter: 0 }, { step: 'G', alter: 0 }, { step: 'A', alter: 0 }, { step: 'B', alter: -1 }, { step: 'C', alter: 0 }, { step: 'D', alter: 0 }, { step: 'E', alter: 0 }] },
    { label: 'B♭ major', mode: 'major', fifths: -2, steps: [{ step: 'B', alter: -1 }, { step: 'C', alter: 0 }, { step: 'D', alter: 0 }, { step: 'E', alter: -1 }, { step: 'F', alter: 0 }, { step: 'G', alter: 0 }, { step: 'A', alter: 0 }] },
    { label: 'A minor', mode: 'minor', fifths: 0, steps: [{ step: 'A', alter: 0 }, { step: 'B', alter: 0 }, { step: 'C', alter: 0 }, { step: 'D', alter: 0 }, { step: 'E', alter: 0 }, { step: 'F', alter: 0 }, { step: 'G', alter: 0 }] },
    { label: 'E minor', mode: 'minor', fifths: 1, steps: [{ step: 'E', alter: 0 }, { step: 'F', alter: 1 }, { step: 'G', alter: 0 }, { step: 'A', alter: 0 }, { step: 'B', alter: 0 }, { step: 'C', alter: 0 }, { step: 'D', alter: 0 }] },
    { label: 'D minor', mode: 'minor', fifths: -1, steps: [{ step: 'D', alter: 0 }, { step: 'E', alter: 0 }, { step: 'F', alter: 0 }, { step: 'G', alter: 0 }, { step: 'A', alter: 0 }, { step: 'B', alter: -1 }, { step: 'C', alter: 0 }] },
]

const STEP_SEMITONE: Record<MelodyPitch['step'], number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }

/** Every note of `key` inside the register, spelled, sorted by pitch. */
function scaleNotesInRange(key: KeyDef, range: RegisterRange): MelodyPitch[] {
    const notes: MelodyPitch[] = []
    for (let octave = 0; octave <= 9; octave++) {
        for (const { step, alter } of key.steps) {
            const midi = (octave + 1) * 12 + STEP_SEMITONE[step] + alter
            if (midi >= range.lowMidi && midi <= range.highMidi) notes.push({ step, alter, octave, midi })
        }
    }
    return notes.sort((a, b) => a.midi - b.midi)
}

/** Per-measure rhythm templates (beat lists that fill the measure exactly). */
function rhythmTemplates(beatsPerMeasure: number, rhythm: GeneratorParams['rhythm']): number[][] {
    if (beatsPerMeasure === 3) {
        const simple = [[1, 1, 1], [2, 1], [1, 2], [3]]
        const varied = [...simple, [1, 0.5, 0.5, 1], [1.5, 0.5, 1], [0.5, 0.5, 1, 1]]
        const complex = [...varied, [0.5, 0.5, 0.5, 0.5, 1], [1, 0.5, 0.25, 0.25, 1]]
        return rhythm === 'simple' ? simple : rhythm === 'varied' ? varied : complex
    }
    const simple = [[1, 1, 1, 1], [2, 1, 1], [1, 1, 2], [2, 2], [4]]
    const varied = [...simple, [1, 0.5, 0.5, 1, 1], [0.5, 0.5, 1, 1, 1], [1.5, 0.5, 1, 1], [2, 0.5, 0.5, 1], [1, 1, 1.5, 0.5]]
    const complex = [...varied, [0.5, 0.5, 0.5, 0.5, 1, 1], [1, 0.25, 0.25, 0.5, 1, 1], [0.5, 0.25, 0.25, 1, 2]]
    return rhythm === 'simple' ? simple : rhythm === 'varied' ? varied : complex
}

function generateClip(params: GeneratorParams, clipSeed: number): ClipMelody {
    const rng = makeRng(clipSeed)
    const keys = KEYS.filter((k) => params.mode === 'mixed' || k.mode === params.mode)
    const key = pick(rng, keys)
    const scale = scaleNotesInRange(key, params.register)
    if (scale.length < 5) throw new Error(`register ${params.register.lowMidi}–${params.register.highMidi} holds too few ${key.label} notes`)

    const templates = rhythmTemplates(params.beatsPerMeasure, params.rhythm)
    // Start near the middle of the range so both directions stay open.
    let idx = Math.floor(scale.length / 2) + Math.floor((rng() - 0.5) * scale.length * 0.3)

    const events: MelodyEvent[] = []
    for (let m = 0; m < params.measuresPerClip; m++) {
        const last = m === params.measuresPerClip - 1
        // Land on a long final note: the whole last measure is one note.
        const template = last ? [params.beatsPerMeasure] : pick(rng, templates)
        for (const beats of template) {
            const first = events.length === 0
            // Breathing rests break up phrases; never the opening or the ending.
            if (!first && !last && rng() < params.restProb) {
                events.push({ beats })
                continue
            }
            if (!first) {
                const r = rng()
                let move: number
                if (r < 0.12) move = 0
                else if (rng() < params.leapProb) move = (2 + Math.floor(rng() * 3)) * (rng() < 0.5 ? -1 : 1)
                else move = rng() < 0.5 ? -1 : 1
                idx += move
                // Reflect off the register edges instead of hugging them.
                if (idx < 0) idx = -idx
                if (idx >= scale.length) idx = 2 * (scale.length - 1) - idx
                idx = Math.max(0, Math.min(scale.length - 1, idx))
            }
            events.push({ beats, pitch: scale[idx] })
        }
    }

    return {
        bpm: params.bpm,
        beatsPerMeasure: params.beatsPerMeasure,
        keyLabel: key.label,
        keyFifths: key.fifths,
        events,
    }
}

export interface GeneratedClip {
    name: string
    seed: number
    melody: ClipMelody
}

/** Generate the corpus's clips; clip N's seed is `params.seed + N` so any
 * single clip can be re-derived without generating the rest. */
export function generateClips(params: GeneratorParams): GeneratedClip[] {
    const clips: GeneratedClip[] = []
    for (let i = 0; i < params.clipCount; i++) {
        const seed = params.seed + i
        clips.push({
            name: `clip-${String(i + 1).padStart(2, '0')}`,
            seed,
            melody: generateClip(params, seed),
        })
    }
    return clips
}
