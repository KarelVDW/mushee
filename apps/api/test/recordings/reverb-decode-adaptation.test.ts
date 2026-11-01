import { afterEach, describe, expect, it, vi } from 'vitest'

import type { NoteEventTime } from '../../src/recordings/pipeline/note-event'
import { PitchTrack } from '../../src/recordings/pipeline/pitch-track'
import { ReverbDecodeAdaptation } from '../../src/recordings/pipeline/profiles/reverberance'
import type { ModelBackend } from '../../src/recordings/pipeline/providers/model-backend'

/**
 * The decode-side reverb adaptation (built off): the take-level evidence
 * (`PitchTrack.reverbEvidence`), the onset back-extension
 * (`PitchTrack.backExtendOnsets`), the decision rule
 * (`ReverbDecodeAdaptation.decide`) and the provider's streaming freeze. The eval
 * harness replays the same class on cached tracks, so these pin the arithmetic
 * both paths share.
 */

const HOP = 0.02

function track(cents: number[], confidence: number[]): PitchTrack {
    return new PitchTrack(Float32Array.from(cents), Float32Array.from(confidence), cents.length, HOP)
}

function note(startFrame: number, frames: number, pitchMidi: number): NoteEventTime {
    return { startTimeSeconds: startFrame * HOP, durationSeconds: frames * HOP, pitchMidi, amplitude: 1 }
}

describe('PitchTrack.reverbEvidence', () => {
    it('takes the median confidence over loud frames only', () => {
        const t = track(new Array<number>(8).fill(6000), [0.9, 0.8, 0.7, 0.6, 0.1, 0.1, 0.1, 0.1])
        const energy = Float32Array.from([1, 1, 1, 1, 0.05, 0.05, 0.05, 0.05])
        const e = t.reverbEvidence(energy, HOP)
        expect(e.loudFrames).toBe(4)
        expect(e.confMed).toBeCloseTo(0.8)
    })

    it('measures a prefix when asked', () => {
        const t = track(new Array<number>(6).fill(6000), [0.9, 0.9, 0.9, 0.2, 0.2, 0.2])
        const energy = Float32Array.from([0.05, 1, 1, 1, 1, 1])
        expect(t.reverbEvidence(energy, HOP, 3).confMed).toBeCloseTo(0.9)
        expect(t.reverbEvidence(energy, HOP, 3).loudFrames).toBe(2)
        expect(t.reverbEvidence(energy, HOP).confMed).toBeCloseTo(0.2)
        expect(t.reverbEvidence(energy, HOP).loudFrames).toBe(5)
    })

    it('reads a fast release as a large 100 ms level drop and a slow decay as a small one', () => {
        const n = 40
        const conf = new Array<number>(n).fill(0.9)
        // 20 dB per 100 ms (5 frames) vs 4 dB per 100 ms.
        const dry = Float32Array.from({ length: n }, (_, i) => Math.pow(10, (-4 * i) / 20))
        const wet = Float32Array.from({ length: n }, (_, i) => Math.pow(10, (-0.8 * i) / 20))
        const t = track(new Array<number>(n).fill(6000), conf)
        expect(t.reverbEvidence(dry, HOP).maxDropDb).toBeGreaterThan(15)
        expect(t.reverbEvidence(wet, HOP).maxDropDb).toBeLessThan(5)
    })
})

describe('ReverbDecodeAdaptation on takes with nothing to measure', () => {
    const shipped = new ReverbDecodeAdaptation({ knee: 0.85, slope: 2, floor: 0.2, base: 0.5, mode: 'min', dryDropDb: 12 }, undefined, 1.5)
    const neutral = { confMed: 1, loudFrames: 0, maxDropDb: 99 }
    const N = 200
    /** Deterministic jitter in [0, 1). */
    const jitter = (i: number, seed: number): number => {
        const x = Math.sin(i * 12.9898 + seed * 78.233) * 43758.5453
        return x - Math.floor(x)
    }
    const noise = (level: number): Float32Array => Float32Array.from({ length: N }, (_, i) => level * (0.9 + 0.2 * jitter(i, 1)))
    const noiseConfidence = Array.from({ length: N }, (_, i) => 0.15 + 0.2 * jitter(i, 2))
    const flat = new Array<number>(N).fill(6000)
    /** Half-second notes in a room: each decays 4 dB per 100 ms, never fast. */
    const room = (level: number): Float32Array => Float32Array.from({ length: N }, (_, i) => level * Math.pow(10, (-0.8 * (i % 25)) / 20))

    it('reads digital silence as neutral and keeps the profile gate', () => {
        const ev = track(flat, noiseConfidence).reverbEvidence(new Float32Array(N), HOP)
        expect(ev).toEqual(neutral)
        expect(shipped.decide(ev, 0.5, true, HOP).gate).toBe(0.5)
    })

    it('reads stationary noise as neutral and keeps the profile gate', () => {
        const ev = track(flat, noiseConfidence).reverbEvidence(noise(0.01), HOP)
        expect(ev).toEqual(neutral)
        expect(shipped.decide(ev, 0.5, false, HOP).gate).toBe(0.5)
    })

    it('reads a steady hum CREPE hears as pitched as neutral too: it has no dynamics', () => {
        expect(track(flat, new Array<number>(N).fill(0.6)).reverbEvidence(noise(0.01), HOP)).toEqual(neutral)
    })

    it('reads anything under -60 dBFS as neutral, pitched or not', () => {
        expect(track(flat, new Array<number>(N).fill(0.7)).reverbEvidence(room(5e-4), HOP)).toEqual(neutral)
    })

    it('still measures a reverberant take, loud or quiet, and lowers its gate', () => {
        for (const level of [1, 0.005]) {
            const ev = track(flat, new Array<number>(N).fill(0.75)).reverbEvidence(room(level), HOP)
            expect(ev.loudFrames).toBe(N)
            expect(ev.confMed).toBeCloseTo(0.75)
            expect(ev.maxDropDb).toBeCloseTo(4)
            expect(shipped.decide(ev, 0.5, true, HOP).gate).toBeCloseTo(0.3)
        }
    })
})

describe('PitchTrack.backExtendOnsets', () => {
    // frames 0-4 silent, 5-9 at the note's pitch under the gate, 10-19 the detected note
    const conf = [0, 0, 0, 0, 0, 0.2, 0.2, 0.2, 0.2, 0.2, ...new Array<number>(10).fill(0.9)]
    const cents = new Array<number>(20).fill(6000)

    it('moves the start back over sub-gate frames already at the pitch', () => {
        const [n] = track(cents, conf).backExtendOnsets([note(10, 10, 60)], { minConfidence: 0.15, maxFrames: 8 })
        expect(n.startTimeSeconds).toBeCloseTo(5 * HOP)
        expect(n.startTimeSeconds + n.durationSeconds).toBeCloseTo(20 * HOP)
    })

    it('stops at the window, at the confidence floor and at another pitch', () => {
        expect(track(cents, conf).backExtendOnsets([note(10, 10, 60)], { minConfidence: 0.15, maxFrames: 3 })[0].startTimeSeconds).toBeCloseTo(7 * HOP)
        expect(track(cents, conf).backExtendOnsets([note(10, 10, 60)], { minConfidence: 0.25, maxFrames: 8 })[0].startTimeSeconds).toBeCloseTo(10 * HOP)
        const bent = cents.map((c, i) => (i < 8 ? c + 100 : c))
        expect(track(bent, conf).backExtendOnsets([note(10, 10, 60)], { minConfidence: 0.15, maxFrames: 8 })[0].startTimeSeconds).toBeCloseTo(8 * HOP)
    })

    it('never reaches into or touches the previous note', () => {
        const out = track(cents, conf).backExtendOnsets([note(10, 10, 60), note(2, 4, 60)], { minConfidence: 0.15, maxFrames: 8 })
        expect(out[0].startTimeSeconds).toBeCloseTo(2 * HOP)
        expect(out[1].startTimeSeconds).toBeCloseTo(7 * HOP)
    })

    it('leaves a note with nothing to extend over untouched', () => {
        const n = note(10, 10, 62)
        expect(track(cents, conf).backExtendOnsets([n], { minConfidence: 0.15, maxFrames: 8 })[0]).toEqual(n)
    })
})

describe('ReverbDecodeAdaptation.decide', () => {
    const gate = { knee: 0.85, slope: 2, floor: 0.2, base: 0.5, mode: 'min' as const, dryDropDb: Infinity }
    const extend = { maxDropDb: 10, maxConfMed: 0.87, minConfidence: 0.15, windowSec: 0.15 }
    const ev = (confMed: number, maxDropDb = 20): { confMed: number; loudFrames: number; maxDropDb: number } => ({ confMed, loudFrames: 100, maxDropDb })

    it('keeps the profile gate at or above the knee and lowers it below, never under the floor', () => {
        const a = new ReverbDecodeAdaptation(gate, undefined, 1.5)
        expect(a.decide(ev(0.9), 0.5, true, HOP).gate).toBe(0.5)
        expect(a.decide(ev(0.75), 0.5, true, HOP).gate).toBeCloseTo(0.3)
        expect(a.decide(ev(0.4), 0.5, true, HOP).gate).toBe(0.2)
    })

    it('leaves a take whose level falls fast (a dry room) at its profile gate', () => {
        const a = new ReverbDecodeAdaptation({ ...gate, dryDropDb: 12 }, undefined, 1.5)
        expect(a.decide(ev(0.7, 20), 0.5, true, HOP).gate).toBe(0.5)
        expect(a.decide(ev(0.7, 6), 0.5, true, HOP).gate).toBeCloseTo(0.2)
    })

    it('min mode never raises a gate the profile already relaxed; replace mode ignores the profile relief', () => {
        expect(new ReverbDecodeAdaptation(gate, undefined, 1.5).decide(ev(0.84), 0.4, false, HOP).gate).toBe(0.4)
        expect(new ReverbDecodeAdaptation({ ...gate, mode: 'replace' }, undefined, 1.5).decide(ev(0.84), 0.4, false, HOP).gate).toBeCloseTo(0.48)
        expect(new ReverbDecodeAdaptation({ ...gate, mode: 'replace' }, undefined, 1.5).decide(ev(0.9), 0.4, false, HOP).gate).toBe(0.5)
    })

    it('back-extends only non-voice takes that read reverberant on both features', () => {
        const a = new ReverbDecodeAdaptation(undefined, extend, 1.5)
        expect(a.decide(ev(0.8, 8), 0.5, false, HOP)).toEqual({ gate: 0.5, backExtend: { minConfidence: 0.15, maxFrames: 8 } })
        expect(a.decide(ev(0.8, 8), 0.5, true, HOP).backExtend).toBeUndefined()
        expect(a.decide(ev(0.8, 12), 0.5, false, HOP).backExtend).toBeUndefined()
        expect(a.decide(ev(0.9, 8), 0.5, false, HOP).backExtend).toBeUndefined()
        expect(a.decide(ev(0.8, 8), 0.5, false, 0.01).backExtend?.maxFrames).toBe(15)
    })

    it('is off unless the env opts in', () => {
        expect(ReverbDecodeAdaptation.fromEnv()).toBeUndefined()
    })

    it('agrees on decisions with the same onset treatment and gates within the drift tolerance', () => {
        const a = new ReverbDecodeAdaptation(gate, undefined, 1.5)
        const ext = { minConfidence: 0.15, maxFrames: 8 }
        // 0.48 − 0.46 is 0.020000000000000018 in floating point: still within 0.02.
        expect(a.agrees({ gate: 0.48 }, { gate: 0.46 })).toBe(true)
        expect(a.agrees({ gate: 0.48 }, { gate: 0.45 })).toBe(false)
        expect(a.agrees({ gate: 0.5, backExtend: ext }, { gate: 0.5 })).toBe(false)
        expect(new ReverbDecodeAdaptation(gate, undefined, 1.5, 0).agrees({ gate: 0.48 }, { gate: 0.4799 })).toBe(false)
    })
})

describe('CrepeProvider streaming with the relative gate on', () => {
    afterEach(() => {
        vi.unstubAllEnvs()
        vi.resetModules()
    })

    /** A backend whose every frame peaks at bin 200 with the current `peak` activation. */
    function backend(): ModelBackend & { peak: number } {
        const b = {
            peak: 0.9,
            available: () => true,
            warm: () => Promise.resolve(),
            crepePredict: (_frames: Float32Array, count: number): Promise<Float32Array> => {
                const out = new Float32Array(count * 360)
                for (let f = 0; f < count; f += 1) out[f * 360 + 200] = b.peak
                return Promise.resolve(out)
            },
        }
        return b
    }

    /** Half-second notes decaying 40 dB/s, as in a room — a steady tone has no dynamics and reads neutral. */
    const tone = (sec: number): Float32Array =>
        Float32Array.from({ length: Math.round(sec * 16000) }, (_, i) => 0.3 * Math.pow(10, (-2 * ((i / 16000) % 0.5))) * Math.sin((2 * Math.PI * 440 * i) / 16000))

    async function provider(env: Record<string, string>): Promise<{ p: InstanceType<typeof import('../../src/recordings/pipeline/providers/crepe-provider').CrepeProvider>; b: ReturnType<typeof backend> }> {
        for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v)
        vi.resetModules()
        const { CrepeProvider } = await import('../../src/recordings/pipeline/providers/crepe-provider')
        const b = backend()
        return { p: new CrepeProvider(b, 'test'), b }
    }

    it('freezes the evidence once enough loud audio exists, and the final pass re-measures it', async () => {
        const { p, b } = await provider({ RECORDING_CONF_RELATIVE_GATE: '1' })
        const s = p.createSession()
        const decisions = (s as unknown as { decisions: Map<string, unknown> }).decisions
        // 2 s of loud audio at confidence 0.9: frozen at gate 0.5.
        await p.transcribe(tone(2), { confidenceThreshold: 0.5 }, s)
        expect([...decisions.keys()]).toEqual(['0.5|0'])
        // New audio at low confidence: the frozen evidence holds the gate.
        b.peak = 0.3
        await p.transcribe(tone(6), { confidenceThreshold: 0.5 }, s)
        expect([...decisions.keys()]).toEqual(['0.5|0'])
        expect(p.voicingAdaptationDrifted(s)).toBe(false)
        // The final pass measures the whole take (now mostly low confidence) and flags the drift.
        await p.transcribe(tone(6), { confidenceThreshold: 0.5, finalPass: true }, s)
        expect(decisions.size).toBe(2)
        expect(p.voicingAdaptationDrifted(s)).toBe(true)
    })

    it('keeps the live notes when the final gate lands within the drift tolerance of the frozen one', async () => {
        for (const [later, drifts] of [
            [0.83, false],
            [0.8, true],
        ] as const) {
            const { p, b } = await provider({ RECORDING_CONF_RELATIVE_GATE: '1' })
            const s = p.createSession()
            // Frozen at confidence 0.84: gate 0.48.
            b.peak = 0.84
            await p.transcribe(tone(2), { confidenceThreshold: 0.5 }, s)
            // The whole take reads 0.83 (gate 0.46, within 0.02: the same decision) or 0.80 (gate 0.40: drift).
            b.peak = later
            await p.transcribe(tone(6), { confidenceThreshold: 0.5, finalPass: true }, s)
            expect((s as unknown as { decisions: Map<string, unknown> }).decisions.size).toBe(2)
            expect(p.voicingAdaptationDrifted(s)).toBe(drifts)
        }
    })

    it('never drifts with the adaptation off', async () => {
        const { p, b } = await provider({})
        const s = p.createSession()
        await p.transcribe(tone(2), { confidenceThreshold: 0.5 }, s)
        b.peak = 0.3
        await p.transcribe(tone(6), { confidenceThreshold: 0.5, finalPass: true }, s)
        expect(p.voicingAdaptationDrifted(s)).toBe(false)
    })
})

describe('RecordingPipeline final pass after a drifted reverb decision', () => {
    async function finalPass(drifted: boolean): Promise<NoteEventTime[]> {
        const { PROFILE_BANDS } = await import('../../src/recordings/pipeline/profiles/pipeline-profile')
        const { RecordingPipeline } = await import('../../src/recordings/pipeline/recording-pipeline')
        const p = new RecordingPipeline(
            { get: () => ({}) } as unknown as ConstructorParameters<typeof RecordingPipeline>[0],
            {} as unknown as ConstructorParameters<typeof RecordingPipeline>[1],
        )
        const finalNote: NoteEventTime = { startTimeSeconds: 0.52, durationSeconds: 0.5, pitchMidi: 62, amplitude: 1 }
        const internals = p as unknown as {
            chunkBytes: number
            profile: unknown
            converter: unknown
            streamDecoder: unknown
            emittedNotes: NoteEventTime[]
            emittedKeys: Set<string>
            process(isFinal: boolean): Promise<void>
        }
        internals.chunkBytes = 1
        internals.profile = PROFILE_BANDS.find((b) => b.id === 'mid')
        internals.streamDecoder = { finalize: () => Promise.resolve(new Float32Array(32000)) }
        internals.converter = {
            provider: { sampleRate: 16000 },
            convert: () => Promise.resolve({ raw: [finalNote], deduced: [finalNote] }),
            voicingAdaptationDrifted: () => drifted,
        }
        // A note committed live under the earlier gate, 20 ms off the final one.
        internals.emittedNotes.push({ startTimeSeconds: 0.5, durationSeconds: 0.5, pitchMidi: 62 } as NoteEventTime)
        internals.emittedKeys.add('500_62')
        await internals.process(true)
        return internals.emittedNotes
    }

    it('rebuilds the score from the final pass alone', async () => {
        const notes = await finalPass(true)
        expect(notes.map((n) => n.startTimeSeconds)).toEqual([0.52])
    })

    it('keeps the committed notes when nothing drifted (production)', async () => {
        const notes = await finalPass(false)
        expect(notes.map((n) => n.startTimeSeconds)).toEqual([0.5, 0.52])
    })
})
