import { describe, expect, it } from 'vitest'

import type { PipelineProfile } from '../../src/recordings/pipeline/profiles/pipeline-profile'
import { DEFAULT_PROFILE, PROFILE_BANDS } from '../../src/recordings/pipeline/profiles/pipeline-profile'
import { RecordingPipeline } from '../../src/recordings/pipeline/recording-pipeline'

/**
 * When the adaptive profile may lock.
 *
 * The scan of a prefix with no reliable pitch (breath, a late start, speech)
 * resolves to the blind `default-wide` fallback. Locking that for the whole take
 * was a silent failure — the eval census measured COnP ≈ 0.001 through it — so
 * the pipeline now keeps listening until the first pitched second, accepts the
 * fallback only past `RECORDING_DETECT_MAX_WAIT_SEC` (or on the final pass), and
 * re-resolves a fallback-locked take over the whole audio when it finalises.
 * These tests pin that policy with a stubbed decode/resolver: the routing rule,
 * not ffmpeg or the model, is what is under test.
 */

const MID = PROFILE_BANDS.find((b) => b.id === 'mid')!

interface Harness {
    pipeline: RecordingPipeline
    /** What the next resolve() returns. */
    next: { profile: PipelineProfile; durationSec: number }
    resolves: number
}

function harness(): Harness {
    const h: Partial<Harness> = { resolves: 0 }
    // Just enough provider for `AudioConverter`'s constructor; no audio ever flows.
    const registry = {
        get: () => ({
            name: 'fake',
            sampleRate: 16000,
            normalizeLoudness: false,
            hasNativeOnsets: false,
            cachesAcrossPasses: true,
            windowAlignSamples: 1,
            createSession: () => ({}),
        }),
    }
    const resolver = {
        resolve: () => {
            h.resolves! += 1
            return h.next!.profile
        },
    }
    const p = new RecordingPipeline(
        registry as unknown as ConstructorParameters<typeof RecordingPipeline>[0],
        resolver as unknown as ConstructorParameters<typeof RecordingPipeline>[1],
    )
    // The detection decode is stubbed to report a duration and no samples.
    ;(p as unknown as { decoder: unknown }).decoder = {
        decode: async () => ({
            samples: new Float32Array(0),
            duration: h.next!.durationSec,
            sampleRate: 16000,
        }),
    }
    h.pipeline = p
    return h as Harness
}

async function resolve(h: Harness, isFinal: boolean): Promise<boolean> {
    return (
        h.pipeline as unknown as {
            resolveProfile(buffer: Buffer, isFinal: boolean): Promise<boolean>
        }
    ).resolveProfile(Buffer.alloc(1), isFinal)
}

function locked(h: Harness): PipelineProfile | null {
    return (h.pipeline as unknown as { profile: PipelineProfile | null }).profile
}

describe('RecordingPipeline profile lock', () => {
    it('waits below the minimum detection length', async () => {
        const h = harness()
        h.next = { profile: MID, durationSec: 0.8 }
        expect(await resolve(h, false)).toBe(false)
        expect(locked(h)).toBeNull()
        expect(h.resolves).toBe(0)
    })

    it('locks a real band as soon as the scan is long enough', async () => {
        const h = harness()
        h.next = { profile: MID, durationSec: 1.5 }
        expect(await resolve(h, false)).toBe(true)
        expect(locked(h)?.id).toBe('mid')
    })

    it('defers the unvoiced fallback instead of locking it on the prefix', async () => {
        const h = harness()
        h.next = { profile: DEFAULT_PROFILE, durationSec: 1.5 }
        expect(await resolve(h, false)).toBe(false)
        expect(locked(h)).toBeNull()
        // …and the same for the hint-widened fallback the resolver emits with a score instrument.
        h.next = { profile: { ...DEFAULT_PROFILE, id: 'default-wide+hint' }, durationSec: 3 }
        expect(await resolve(h, false)).toBe(false)
        expect(locked(h)).toBeNull()
    })

    it('locks the band the moment pitched audio arrives after a silent lead-in', async () => {
        const h = harness()
        h.next = { profile: DEFAULT_PROFILE, durationSec: 2.5 }
        expect(await resolve(h, false)).toBe(false)
        h.next = { profile: MID, durationSec: 4 }
        expect(await resolve(h, false)).toBe(true)
        expect(locked(h)?.id).toBe('mid')
    })

    it('accepts the fallback once the wait budget is spent', async () => {
        const h = harness()
        h.next = { profile: DEFAULT_PROFILE, durationSec: 9 }
        expect(await resolve(h, false)).toBe(true)
        expect(locked(h)?.id).toBe(DEFAULT_PROFILE.id)
    })

    it('accepts whatever the final pass resolves, however short', async () => {
        const h = harness()
        h.next = { profile: DEFAULT_PROFILE, durationSec: 0.5 }
        expect(await resolve(h, true)).toBe(true)
        expect(locked(h)?.id).toBe(DEFAULT_PROFILE.id)
    })
})
