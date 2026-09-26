import { describe, expect, it } from 'vitest'

import { estimateReverberance, ProfileResolver } from '../../src/recordings/pipeline/profiles/profile-resolver'

const SR = 16000

/** A harmonic-rich tone, amplitude shaped by `envAt(tSec)`. */
function shaped(seconds: number, envAt: (t: number) => number, freq = 220): Float32Array {
    const out = new Float32Array(Math.floor(seconds * SR))
    for (let i = 0; i < out.length; i += 1) {
        const t = i / SR
        let s = 0
        for (let h = 1; h <= 5; h += 1) s += Math.sin(2 * Math.PI * freq * h * t) / h
        out[i] = envAt(t) * s * 0.2
    }
    return out
}

/**
 * A dry melody: notes that decay to near-silence between attacks, so the
 * envelope's quiet moments sit far below its peak.
 */
function dryMelody(): Float32Array {
    const noteSec = 0.5
    return shaped(4, (t) => {
        const phase = t % noteSec
        return 0.6 * Math.exp(-phase / 0.06)
    })
}

/**
 * The same melody in a reverberant room: each note's decay is floored by the
 * room's wash, so the envelope never gets far below its peak.
 */
function wetMelody(): Float32Array {
    const noteSec = 0.5
    return shaped(4, (t) => {
        const phase = t % noteSec
        return 0.6 * (Math.exp(-phase / 0.06) * 0.45 + 0.55)
    })
}

describe('estimateReverberance', () => {
    it('scores a dry melody near 0 and a reverberant one higher', () => {
        const dry = estimateReverberance(dryMelody(), SR)
        const wet = estimateReverberance(wetMelody(), SR)
        expect(dry).toBeLessThan(0.2)
        expect(wet).toBeGreaterThan(dry)
        expect(wet).toBeGreaterThan(0.5)
    })

    it('stays in [0, 1]', () => {
        for (const s of [dryMelody(), wetMelody()]) {
            const r = estimateReverberance(s, SR)
            expect(r).toBeGreaterThanOrEqual(0)
            expect(r).toBeLessThanOrEqual(1)
        }
    })

    it('scores a constant-amplitude tone as 0 — no dips is not filled dips', () => {
        // The degenerate case the modulation guard exists for: a steady tone has no
        // quiet moments at all, so its fill ratio is trivially ~1 and carries no
        // information about the room. Measured corpus minimum modulation is 0.195;
        // this fixture sits at ~0.027.
        expect(
            estimateReverberance(
                shaped(2, () => 0.5),
                SR,
            ),
        ).toBe(0)
    })

    it('returns 0 for audio too short to have an envelope', () => {
        expect(estimateReverberance(new Float32Array(200), SR)).toBe(0)
    })
})

describe('ProfileResolver reverb adaptation', () => {
    it('leaves the voicing gate alone on a dry take', () => {
        const profile = new ProfileResolver().resolve(dryMelody(), SR)
        expect(profile.id).not.toContain('+reverb')
        expect(profile.confidenceThreshold).toBe(0.5)
    })

    it('relaxes the voicing gate on a reverberant take, and marks the profile', () => {
        const profile = new ProfileResolver().resolve(wetMelody(), SR)
        expect(profile.id).toContain('+reverb')
        // Reverb collapses CREPE's per-frame confidence, so a gate calibrated on dry
        // audio discards frames from inside held notes. Relief is capped at 0.25.
        expect(profile.confidenceThreshold).toBeLessThan(0.5)
        expect(profile.confidenceThreshold).toBeGreaterThanOrEqual(0.25)
    })

    it('never relaxes below the floor', () => {
        const profile = new ProfileResolver().resolve(wetMelody(), SR)
        expect(profile.confidenceThreshold).toBeGreaterThanOrEqual(0.25)
    })
})
