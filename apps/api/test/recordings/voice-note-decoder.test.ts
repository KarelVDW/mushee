import { afterEach, describe, expect, it, vi } from 'vitest'

import { PitchTrack } from '../../src/recordings/pipeline/pitch-track'
import { SHIPPING_VOICE_OPTS, VoiceNoteDecoder } from '../../src/recordings/pipeline/voice-note-decoder'

/**
 * The decoder reads only a frame-level contour, so the contour IS the fixture —
 * no audio, no model. These tests pin the *behaviours the corpus bought*, not the
 * tuned constants: a sweep can move `changeCost` and should not break a test, but
 * a change that lets vibrato shatter a held note must.
 */

const HOP = 0.02

interface NoteSpec {
    /** MIDI pitch, or null for a silent gap. */
    midi: number | null
    sec: number
    /** Peak-to-peak vibrato width in cents (sinusoidal at 5.5 Hz). */
    vibratoCents?: number
    /** Semitones below the target the note scoops from, over its first 60 ms. */
    scoopSemitones?: number
    /** Frame confidence (default 0.9); below the 0.5 gate the pitch is present but unvoiced. */
    conf?: number
}

/**
 * Build a `PitchTrack` (and matching envelope) from a note list. Unvoiced frames
 * get zero confidence, which is what the voicing gate keys on.
 */
function contour(spec: NoteSpec[]): { track: PitchTrack; energy: Float32Array } {
    const cents: number[] = []
    const conf: number[] = []
    const energy: number[] = []
    for (const n of spec) {
        const frames = Math.round(n.sec / HOP)
        for (let i = 0; i < frames; i += 1) {
            if (n.midi === null) {
                cents.push(0)
                conf.push(0)
                energy.push(0.001)
                continue
            }
            const t = i * HOP
            const vib = n.vibratoCents ? (n.vibratoCents / 2) * Math.sin(2 * Math.PI * 5.5 * t) : 0
            const scoopFrames = Math.round(0.06 / HOP)
            const scoop = n.scoopSemitones && i < scoopFrames ? -100 * n.scoopSemitones * (1 - i / scoopFrames) : 0
            cents.push(n.midi * 100 + vib + scoop)
            conf.push(n.conf ?? 0.9)
            energy.push(n.conf !== undefined && n.conf < 0.5 ? 0.02 : 0.2)
        }
    }
    return {
        track: new PitchTrack(Float32Array.from(cents), Float32Array.from(conf), cents.length, HOP),
        energy: Float32Array.from(energy),
    }
}

/** The shipping configuration (`SHIPPING_VOICE_OPTS`) behind a fixed voicing gate. */
function decoder(over = {}): VoiceNoteDecoder {
    return new VoiceNoteDecoder({
        ...SHIPPING_VOICE_OPTS,
        confidenceThreshold: 0.5,
        minFreqHz: 55,
        maxFreqHz: 1100,
        ...over,
    })
}

describe('VoiceNoteDecoder', () => {
    it('writes one note for a held pitch, not a chain of fragments', () => {
        const { track, energy } = contour([{ midi: 60, sec: 1.2 }])
        const notes = decoder().decode(track, energy)
        expect(notes).toHaveLength(1)
        expect(notes[0].pitchMidi).toBe(60)
    })

    it('does not shatter a note whose vibrato crosses the semitone boundary', () => {
        // ±60 cents about C4 — the failure mode that made studio singing score 0.45:
        // a semitone-rounding segmenter flips between 59 and 60 for the whole note.
        const { track, energy } = contour([{ midi: 60, sec: 1.5, vibratoCents: 120 }])
        const notes = decoder().decode(track, energy)
        expect(notes).toHaveLength(1)
        expect(notes[0].pitchMidi).toBe(60)
    })

    it('separates two different pitches sung back to back', () => {
        const { track, energy } = contour([
            { midi: 60, sec: 0.6 },
            { midi: 64, sec: 0.6 },
        ])
        const notes = decoder().decode(track, energy)
        expect(notes.map((n) => n.pitchMidi)).toEqual([60, 64])
    })

    it('absorbs a scoop into the note it belongs to', () => {
        // A singer arriving at C4 from two semitones below over 60 ms. Without the
        // wide attack state this is written as a passing A#3/B3 before the real note.
        const { track, energy } = contour([{ midi: 60, sec: 0.8, scoopSemitones: 2 }])
        const notes = decoder().decode(track, energy)
        expect(notes).toHaveLength(1)
        expect(notes[0].pitchMidi).toBe(60)
    })

    it('reports the onset where the pitch arrives, not where the glide starts', () => {
        // The attack state is entered as the contour DEPARTS the previous note; the
        // reported onset must be calibrated forward from there, or every note in the
        // take lands ~50 ms early (worth 0.15 COnP on the corpus).
        const { track, energy } = contour([
            { midi: 60, sec: 0.6 },
            { midi: 67, sec: 0.6 },
        ])
        const notes = decoder().decode(track, energy)
        expect(notes).toHaveLength(2)
        expect(notes[1].startTimeSeconds).toBeGreaterThan(0.55)
        expect(notes[1].startTimeSeconds).toBeLessThan(0.72)
    })

    it('takes a note’s pitch from a trimmed mean, so a scoop cannot drag it flat', () => {
        // Plain-mean pitch over this contour sits low enough to round to 59.
        const { track, energy } = contour([{ midi: 60, sec: 0.5, scoopSemitones: 3 }])
        expect(decoder().decode(track, energy)[0].pitchMidi).toBe(60)
    })

    it('emits nothing for a wholly unvoiced take', () => {
        const { track, energy } = contour([{ midi: null, sec: 1 }])
        expect(decoder().decode(track, energy)).toEqual([])
    })

    it('ignores pitch outside the resolved register window', () => {
        // Out-of-band frames are not evidence of a note — the window is the pipeline's
        // main adaptive lever and the decoder must honour it, not just the gate.
        const { track, energy } = contour([{ midi: 60, sec: 1 }])
        const notes = decoder({ minFreqHz: 400, maxFreqHz: 1100 }).decode(track, energy)
        expect(notes).toEqual([])
    })

    it('rejoins a semitone wobble under the SiPTH guard but keeps a held step', () => {
        const guard = { deltaSemitones: 0.5, gammaSemitoneSec: 0.1 }
        // A brief, low-cost excursion to the neighbour: not enough accumulated area.
        const wobble = contour([
            { midi: 60, sec: 0.5 },
            { midi: 61, sec: 0.08 },
            { midi: 60, sec: 0.5 },
        ])
        const rejoined = decoder({ mergeGuard: guard }).decode(wobble.track, wobble.energy)
        expect(rejoined.map((n) => n.pitchMidi)).toEqual([60])

        // The same interval, genuinely held: area accumulates and the split survives.
        const held = contour([
            { midi: 60, sec: 0.5 },
            { midi: 61, sec: 0.5 },
        ])
        const kept = decoder({ mergeGuard: guard }).decode(held.track, held.energy)
        expect(kept.map((n) => n.pitchMidi)).toEqual([60, 61])
    })

    it('judges existence at existenceShiftSec when set, and still reports the onset at onsetShiftSec', () => {
        // An 80 ms (4-frame) blip between rests, and the same blip held 100 ms.
        const take = (sec: number): ReturnType<typeof contour> =>
            contour([
                { midi: 60, sec: 0.5 },
                { midi: null, sec: 0.3 },
                { midi: 64, sec },
                { midi: null, sec: 0.3 },
                { midi: 62, sec: 0.5 },
            ])
        const blip = take(0.08)
        // Judged at the 0.05 reporting shift (unset), the 4-frame run survives as a 30 ms note…
        const atReporting = { existenceShiftSec: undefined }
        expect(decoder(atReporting).decode(blip.track, blip.energy).map((n) => n.pitchMidi)).toEqual([60, 64, 62])
        // …judged at 0.07 (what ships) it is dropped, as it was before the 2026-11 shift.
        expect(SHIPPING_VOICE_OPTS.existenceShiftSec).toBe(0.07)
        expect(decoder().decode(blip.track, blip.energy).map((n) => n.pitchMidi)).toEqual([60, 62])
        // A 5-frame run exists either way, and its onset is the reporting shift's.
        const held = take(0.1)
        const shipped = decoder().decode(held.track, held.energy)
        expect(decoder(atReporting).decode(held.track, held.energy)).toEqual(shipped)
        expect(shipped[1].startTimeSeconds).toBeCloseTo(0.8 + 0.05, 6)
        // Equal to the reporting shift, it is the same as leaving it unset.
        expect(decoder({ existenceShiftSec: SHIPPING_VOICE_OPTS.onsetShiftSec }).decode(blip.track, blip.energy)).toEqual(
            decoder(atReporting).decode(blip.track, blip.energy),
        )
    })

    describe('backExtend (sub-gate onset back-extension, off by default)', () => {
        const backExtend = { minConfidence: 0.15, windowSec: 0.15 }
        // A rest, then 80 ms of the next note's pitch at sub-gate confidence, then the note.
        const quietOnset = (): ReturnType<typeof contour> =>
            contour([
                { midi: 60, sec: 0.5 },
                { midi: null, sec: 0.3 },
                { midi: 64, sec: 0.08, conf: 0.3 },
                { midi: 64, sec: 0.5 },
            ])

        it('starts a note entered from silence where its pitch was already present below the gate', () => {
            const { track, energy } = quietOnset()
            const plain = decoder().decode(track, energy)
            const extended = decoder({ backExtend }).decode(track, energy)
            expect(extended.map((n) => n.pitchMidi)).toEqual(plain.map((n) => n.pitchMidi))
            // The four sub-gate frames move the onset 80 ms earlier; the end stays put.
            expect(plain[1].startTimeSeconds - extended[1].startTimeSeconds).toBeCloseTo(0.08, 6)
            const end = (n: { startTimeSeconds: number; durationSeconds: number }): number => n.startTimeSeconds + n.durationSeconds
            expect(end(extended[1])).toBeCloseTo(end(plain[1]), 6)
            // The first note has nothing before it to extend over.
            expect(extended[0]).toEqual(plain[0])
        })

        it('reaches back at most windowSec and never into the previous note', () => {
            const { track, energy } = quietOnset()
            const short = decoder({ backExtend: { minConfidence: 0.15, windowSec: 0.04 } }).decode(track, energy)
            const plain = decoder().decode(track, energy)
            expect(plain[1].startTimeSeconds - short[1].startTimeSeconds).toBeCloseTo(0.04, 6)

            // The whole rest at the next pitch: the onset stops at the rest's first frame.
            const legato = contour([
                { midi: 60, sec: 0.5 },
                { midi: 62, sec: 0.1, conf: 0.3 },
                { midi: 62, sec: 0.5 },
            ])
            const notes = decoder({ backExtend: { minConfidence: 0.15, windowSec: 0.5 } }).decode(legato.track, legato.energy)
            expect(notes).toHaveLength(2)
            expect(notes[1].startTimeSeconds).toBeGreaterThanOrEqual(notes[0].startTimeSeconds + notes[0].durationSeconds)
        })

        it('leaves frames at another pitch or under minConfidence alone', () => {
            const offPitch = contour([
                { midi: null, sec: 0.3 },
                { midi: 66, sec: 0.08, conf: 0.3 },
                { midi: 64, sec: 0.5 },
            ])
            const quiet = contour([
                { midi: null, sec: 0.3 },
                { midi: 64, sec: 0.08, conf: 0.1 },
                { midi: 64, sec: 0.5 },
            ])
            for (const { track, energy } of [offPitch, quiet]) {
                expect(decoder({ backExtend }).decode(track, energy)).toEqual(decoder().decode(track, energy))
            }
        })

        it('moves onsets of notes that exist but never makes one', () => {
            // 60 ms of voice: the 70 ms onset shift pushes its start past its end, so the
            // decode drops it — and lengthening it backwards must not bring it back.
            const { track, energy } = contour([
                { midi: null, sec: 0.3 },
                { midi: 64, sec: 0.1, conf: 0.3 },
                { midi: 64, sec: 0.06 },
                { midi: null, sec: 0.3 },
            ])
            const over = { minNoteSec: 0.02 }
            // The run is there (unshifted, existence judged unshifted too, it is a note); only the shift drops it.
            expect(decoder({ ...over, onsetShiftSec: 0, existenceShiftSec: undefined }).decode(track, energy)).toHaveLength(1)
            expect(decoder(over).decode(track, energy)).toEqual([])
            expect(decoder({ ...over, backExtend }).decode(track, energy)).toEqual([])
        })
    })
})

describe('SHIPPING_VOICE_OPTS env overrides', () => {
    const KEYS = ['VOICE_ONSET_SHIFT_SEC', 'VOICE_ONSET_BACKEXTEND', 'VOICE_ONSET_EXISTENCE_SHIFT_SEC'] as const
    const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]))
    afterEach(() => {
        for (const k of KEYS) {
            if (saved[k] === undefined) delete process.env[k]
            else process.env[k] = saved[k]
        }
        vi.resetModules()
    })
    async function shippingWith(env: Partial<Record<(typeof KEYS)[number], string>>): Promise<typeof SHIPPING_VOICE_OPTS> {
        for (const k of KEYS) delete process.env[k]
        Object.assign(process.env, env)
        vi.resetModules()
        return (await import('../../src/recordings/pipeline/voice-note-decoder')).SHIPPING_VOICE_OPTS
    }

    it('ships the 2026-11 onset shift (0.05), existence at 0.07 and no back-extension when unset', async () => {
        expect(await shippingWith({})).toEqual({
            transitionMode: 'direct',
            changeCost: 2.5,
            evidenceDiscount: 0.35,
            trust: 0.7,
            onsetShiftSec: 0.05,
            existenceShiftSec: 0.07,
        })
    })

    it('reads the onset shift (0.07 = the kill-switch) and the back-extension pair', async () => {
        const o = await shippingWith({ VOICE_ONSET_SHIFT_SEC: '0.07', VOICE_ONSET_BACKEXTEND: '0.15,0.1' })
        expect(o.onsetShiftSec).toBe(0.07)
        expect(o.backExtend).toEqual({ minConfidence: 0.15, windowSec: 0.1 })
    })

    it('reads the existence shift (0.05 = the kill-switch), separately from the onset shift', async () => {
        const o = await shippingWith({ VOICE_ONSET_EXISTENCE_SHIFT_SEC: '0.05' })
        expect(o.existenceShiftSec).toBe(0.05)
        expect(o.onsetShiftSec).toBe(0.05)
    })

    it('ignores malformed values instead of feeding NaN into the decode', async () => {
        for (const bad of ['off', '0.15', '0.15,', 'a,b', '0.1,0.2,0.3']) {
            const o = await shippingWith({ VOICE_ONSET_SHIFT_SEC: 'abc', VOICE_ONSET_BACKEXTEND: bad, VOICE_ONSET_EXISTENCE_SHIFT_SEC: 'abc' })
            expect(o.onsetShiftSec).toBe(0.05)
            expect(o.backExtend).toBeUndefined()
            expect(o.existenceShiftSec).toBe(0.07)
        }
    })
})
