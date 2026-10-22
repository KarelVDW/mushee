import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { WaveformMeter } from '@/lib/WaveformMeter'

/** An analyser whose time-domain window holds one constant byte (128 = silence). */
class FakeAnalyser {
    fftSize = 2048
    connect = vi.fn()
    level = 128
    getByteTimeDomainData = vi.fn((arr: Uint8Array) => arr.fill(this.level))
}

let analyser: FakeAnalyser
let context: FakeAudioContext
const rememberContext = (ctx: FakeAudioContext): void => {
    context = ctx
}
class FakeAudioContext {
    createMediaStreamSource = vi.fn(() => ({ connect: vi.fn() }))
    createAnalyser = vi.fn(() => (analyser = new FakeAnalyser()))
    close = vi.fn(() => Promise.resolve())
    constructor() {
        rememberContext(this)
    }
}

function meter(): WaveformMeter {
    return new WaveformMeter({} as MediaStream)
}

describe('WaveformMeter', () => {
    beforeEach(() => {
        vi.stubGlobal('AudioContext', FakeAudioContext)
    })

    afterEach(() => {
        vi.unstubAllGlobals()
    })

    it('meters the stream through a 256-sample analyser', () => {
        meter()
        expect(analyser.fftSize).toBe(256)
        expect(context.createMediaStreamSource).toHaveBeenCalled()
    })

    it('self-calibrates the gain so quiet capture paths (iOS) still fill the staff', () => {
        const m = meter()
        // iOS-quiet signal: RMS = 4/128 ≈ 0.031 — the old fixed ×10 gain drew this at ~30%.
        analyser.level = 132
        expect(m.sample()).toBe(1)

        // Half that level renders at ~half height once calibrated.
        analyser.level = 130
        const amp = m.sample()
        expect(amp).toBeGreaterThan(0.4)
        expect(amp).toBeLessThan(0.6)
    })

    it('keeps the fixed desktop gain for hot mics and never calibrates on sub-gate noise', () => {
        const m = meter()
        // Room noise (RMS ≈ 0.008, below the gate): stays at the fixed gain, not blown up.
        analyser.level = 129
        expect(m.sample()).toBeCloseTo(0.078, 2)

        // Hot desktop mic (RMS ≈ 0.56): clamps at 1, exactly as the fixed gain did.
        analyser.level = 200
        expect(m.sample()).toBe(1)

        // Moderate desktop level after the hot peak: still the fixed ×10 gain.
        analyser.level = 136 // RMS = 8/128 = 0.0625
        expect(m.sample()).toBeCloseTo(0.625, 2)
    })

    it('close() releases the context and swallows a rejected close', async () => {
        const m = meter()
        context.close.mockImplementation(() => Promise.reject(new Error('ctx busy')))
        expect(() => m.close()).not.toThrow()
        await Promise.resolve()
        expect(context.close).toHaveBeenCalled()
    })
})
