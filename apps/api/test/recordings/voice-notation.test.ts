import { describe, expect, it } from 'vitest'

import { MxmlBuilder } from '../../src/recordings/pipeline/mxml-builder'
import {
    chooseNamingOffset,
    estimateGridPhaseBeats,
    estimateTuningOffsetCents,
    keyPitchClasses,
    spellMidi,
} from '../../src/recordings/pipeline/voice-notation'

/**
 * Fixture shaped like the real take that motivated this module: Frère Jacques
 * sung ~55–60 cents above the B♭ grid (measured scale degrees 46.45 / 48.65 /
 * 50.65 — do re mi with near-perfect intervals, every one straddling a
 * semitone boundary). Absolute rounding scatters it chromatically; spelling on
 * the take's own grid must recover the diatonic line. Note the naming of such
 * a take is inherently ±1 semitone ambiguous (it fits the B-grid at −41 c
 * exactly as well as the B♭-grid at +59 c); the estimator returns the minimal
 * shift and `chooseNamingOffset` lets the key break the tie.
 */
function note(midiFloat: number, start: number, dur = 0.4) {
    return {
        startTimeSeconds: start,
        durationSeconds: dur,
        pitchMidi: Math.round(midiFloat),
        pitchMidiFloat: midiFloat,
        amplitude: 1,
    }
}

const FRERE = [
    note(46.45, 0),
    note(48.65, 0.5),
    note(50.65, 1.0),
    note(46.55, 1.5),
    note(46.4, 2.0),
    note(48.7, 2.5),
    note(50.7, 3.0),
    note(46.6, 3.5),
]

describe('estimateTuningOffsetCents', () => {
    it('finds the consistent between-keys offset (minimal-shift naming)', () => {
        const off = estimateTuningOffsetCents(FRERE)
        // Deviations cluster ~59 c above the low name = ~41 c below the high one;
        // the minimal shift is the negative reading.
        expect(off).toBeLessThan(-30)
        expect(off).toBeGreaterThan(-50)
    })

    it('returns ~0 for an in-tune performer and 0 for incoherent scatter', () => {
        const inTune = [note(60.03, 0), note(61.97, 0.5), note(64.05, 1), note(65.02, 1.5)]
        expect(Math.abs(estimateTuningOffsetCents(inTune))).toBeLessThan(6)
        const scattered = [note(60.25, 0), note(61.75, 0.5), note(64.0, 1), note(65.45, 1.5), note(66.6, 2)]
        // Vectors cancel → low confidence → offset forced to 0, not to noise.
        expect(estimateTuningOffsetCents(scattered)).toBe(0)
    })

    it('ignores notes without fractional pitch (instruments)', () => {
        const bare = [
            { startTimeSeconds: 0, durationSeconds: 1, pitchMidi: 60 },
            { startTimeSeconds: 1, durationSeconds: 1, pitchMidi: 62 },
        ]
        expect(estimateTuningOffsetCents(bare)).toBe(0)
    })
})

describe('spellMidi', () => {
    it('renames a between-keys melody CONSISTENTLY once normalized', () => {
        const off = estimateTuningOffsetCents(FRERE)
        const spelled = FRERE.map((n) => spellMidi(n, off, null))
        // Minimal-shift naming lands on the B grid: B C♯ D♯ B, twice — one
        // consistent diatonic do-re-mi-do, where absolute rounding scatters.
        expect(spelled).toEqual([47, 49, 51, 47, 47, 49, 51, 47])
        const absolute = FRERE.map((n) => n.pitchMidi)
        expect(new Set(absolute).size).toBeGreaterThan(new Set(spelled).size)
    })

    it('key-snaps an ambiguous out-of-key note to its in-key neighbour', () => {
        const dMajor = keyPitchClasses(2) // D E F♯ G A B C♯
        // Sung F 42 c sharp into a D-major score: ambiguous, F out, F♯ in → up.
        expect(spellMidi(note(65.42, 0), 0, dMajor)).toBe(66)
        // Same ambiguity from above: G♭ region sung 40 c flat of G → F♯ in key.
        expect(spellMidi(note(66.6, 0), 0, keyPitchClasses(0))).toBe(67) // G in C major, already in key → nearest
        expect(spellMidi(note(65.6, 0), 0, dMajor)).toBe(66)
    })

    it('never moves a confident note, even out of key', () => {
        const dMajor = keyPitchClasses(2)
        // A deliberate F-natural, sung close to the key centre: stays F.
        expect(spellMidi(note(65.05, 0), 0, dMajor)).toBe(65)
    })

    it('never moves a note whose nearest name is already in key', () => {
        const cMajor = keyPitchClasses(0)
        // 64.6 rounds to 65 (F, in key): no snap despite the wide deviation.
        expect(spellMidi(note(64.6, 0), 0, cMajor)).toBe(65)
    })

    it('passes instrument notes through untouched', () => {
        expect(spellMidi({ pitchMidi: 61 }, 40, keyPitchClasses(0))).toBe(61)
    })
})

describe('chooseNamingOffset', () => {
    it('lets the key pick the naming when the shift is near half a semitone', () => {
        const off = estimateTuningOffsetCents(FRERE) // ≈ −41 → B C♯ D♯ naming
        // In E major (4 sharps: E F♯ G♯ A B C♯ D♯) the B-naming is fully diatonic —
        // keep the minimal shift.
        expect(chooseNamingOffset(FRERE, off, keyPitchClasses(4))).toBe(off)
        // In F major (1 flat: F G A B♭ C D E) the OTHER naming (B♭ C D) is fully
        // diatonic while B/C♯/D♯ is fully chromatic — flip to the +59 c reading.
        const flipped = chooseNamingOffset(FRERE, off, keyPitchClasses(-1))
        expect(flipped).toBeGreaterThan(30)
        expect(FRERE.map((n) => spellMidi(n, flipped, null))).toEqual([46, 48, 50, 46, 46, 48, 50, 46])
    })

    it('keeps the minimal shift when no key is known or the shift is small', () => {
        expect(chooseNamingOffset(FRERE, -41, null)).toBe(-41)
        expect(chooseNamingOffset(FRERE, -20, keyPitchClasses(-1))).toBe(-20)
    })
})

describe('estimateGridPhaseBeats', () => {
    const at = (beat: number, dur = 0.4) => ({
        startTimeSeconds: (beat * 60) / 120,
        durationSeconds: dur,
    })

    it('detects a take dragged uniformly one 16th behind the click', () => {
        const dragged = [0.25, 1.25, 2.25, 3.25, 4.25, 5.25].map((b) => at(b))
        expect(estimateGridPhaseBeats(dragged, 120)).toBe(0.25)
    })

    it('never shifts genuinely syncopated or on-beat material', () => {
        const onBeat = [0, 1, 2, 3, 4].map((b) => at(b))
        expect(estimateGridPhaseBeats(onBeat, 120)).toBe(0)
        const syncopated = [0, 0.75, 1.5, 2.25, 3, 3.75].map((b) => at(b))
        expect(estimateGridPhaseBeats(syncopated, 120)).toBe(0)
    })
})

describe('MxmlBuilder voice spelling', () => {
    function pitchesOf(builder: MxmlBuilder): string[] {
        const measure = builder.buildMeasure(0, FRERE)
        const seen = measure.entries
            .filter((e) => e._type === 'note' && 'pitch' in e && e.pitch)
            .map((e) => {
                const p = (e as { pitch: { step: string; alter?: number; octave: number } }).pitch
                return `${p.step}${p.alter === 1 ? '#' : p.alter === -1 ? 'b' : ''}${p.octave}`
            })
        // Tied continuations repeat the pitch; collapse to the sung sequence.
        return seen.filter((p, i) => i === 0 || p !== seen[i - 1])
    }

    it('spells the sung take diatonically when voice spelling is on', () => {
        const builder = new MxmlBuilder({ bpm: 120, beats: 4, beatType: 4, keyFifths: -1 })
        builder.setVoiceSpelling(true)
        // F-major score → the key flips the naming to B♭ C D (A♯ spelled by the
        // sharp-preferring step table).
        expect(pitchesOf(builder)).toEqual(['A#2', 'C3', 'D3', 'A#2'])
    })

    it('keeps absolute spelling for instruments (flag off)', () => {
        const builder = new MxmlBuilder({ bpm: 120, beats: 4, beatType: 4, keyFifths: -1 })
        const pitches = pitchesOf(builder)
        // Absolute rounding of the same floats is chromatic and inconsistent.
        expect(new Set(pitches).size).toBeGreaterThan(3)
    })
})
