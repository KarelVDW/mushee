import { describe, expect, it } from 'vitest'

import { OnsetDetector } from '../../src/recordings/pipeline/onset-detector'
import { isStruckOrPluckedInstrument } from '../../src/recordings/pipeline/profiles/instrument-ranges'
import { SUSTAINED_ONSET_DIP_RATIO, VOICE_ONSET_DIP_RATIO } from '../../src/recordings/pipeline/profiles/pipeline-profile'
import { estimateReverberance, ProfileResolver } from '../../src/recordings/pipeline/profiles/profile-resolver'

const SR = 16000

/** A held harmonic tone at `hz` — enough for the pitch scan to lock a band. */
function tone(hz: number, sec = 2): Float32Array {
    const x = new Float32Array(Math.round(sec * SR))
    for (let i = 0; i < x.length; i += 1) {
        const t = i / SR
        x[i] = 0.3 * Math.sin(2 * Math.PI * hz * t) + 0.15 * Math.sin(4 * Math.PI * hz * t) + 0.08 * Math.sin(6 * Math.PI * hz * t)
    }
    return x
}

/**
 * Repeated 0.5 s notes at 330 Hz. Dry: each decays to near-silence before the next
 * attack. Wet: the decay is floored by a room's wash (the reverberance fixtures'
 * shape, reverberance.test.ts).
 */
function melody(wet: boolean): Float32Array {
    const x = new Float32Array(4 * SR)
    for (let i = 0; i < x.length; i += 1) {
        const t = i / SR
        const decay = Math.exp(-(t % 0.5) / 0.06)
        const env = 0.6 * (wet ? decay * 0.45 + 0.55 : decay)
        let s = 0
        for (let h = 1; h <= 5; h += 1) s += Math.sin(2 * Math.PI * 330 * h * t) / h
        x[i] = env * s * 0.2
    }
    return x
}

describe('onset sensitivity policy', () => {
    const resolver = new ProfileResolver()

    it('asks sung takes for a deeper re-attack dip', () => {
        const p = resolver.resolve(tone(330), SR, { instrumentId: 'voice-lead', sourceKind: 'voice' })
        expect(p.onsetDipRatio).toBe(VOICE_ONSET_DIP_RATIO)
    })

    it('asks sustained instruments for a deeper re-attack dip', () => {
        for (const id of ['violin', 'flute', 'oboe', 'trumpet', 'tuba', 'erhu']) {
            const p = resolver.resolve(tone(330), SR, { instrumentId: id, sourceKind: 'instrument' })
            expect(p.onsetDipRatio, id).toBe(SUSTAINED_ONSET_DIP_RATIO)
        }
    })

    it('relaxes the sustained-instrument dip toward the default as the room gets wetter', () => {
        // A heavy room fills the short gap between tongued repeated notes, so the
        // deep dip that stops vibrato splitting would start merging real repeats.
        expect(estimateReverberance(melody(false), SR)).toBeLessThan(0.2)
        expect(estimateReverberance(melody(true), SR)).toBeGreaterThan(0.5)
        const dry = resolver.resolve(melody(false), SR, { instrumentId: 'french-horn', sourceKind: 'instrument' }).onsetDipRatio ?? NaN
        const wet = resolver.resolve(melody(true), SR, { instrumentId: 'french-horn', sourceKind: 'instrument' }).onsetDipRatio ?? NaN
        expect(dry).toBeGreaterThanOrEqual(SUSTAINED_ONSET_DIP_RATIO)
        expect(dry).toBeLessThan(SUSTAINED_ONSET_DIP_RATIO + 0.03)
        expect(wet).toBeGreaterThan(dry)
        expect(wet).toBeLessThanOrEqual(OnsetDetector.DEFAULT_DIP_RATIO)
    })

    it('keeps the sung dip deep in a reverberant room', () => {
        // Measured: ramping the voice like the instruments costs −0.02 on real
        // reverberant singing — a room deepens sung vibrato's modulation.
        const p = resolver.resolve(melody(true), SR, { instrumentId: 'voice-lead', sourceKind: 'voice' })
        expect(p.onsetDipRatio).toBe(VOICE_ONSET_DIP_RATIO)
    })

    it('leaves struck and plucked instruments at the detector default', () => {
        for (const id of ['piano', 'guitar', 'bass-guitar']) {
            const p = resolver.resolve(tone(220), SR, { instrumentId: id, sourceKind: 'instrument' })
            expect(p.onsetDipRatio, id).toBeUndefined()
        }
    })

    it('classifies the app instrument ids', () => {
        expect(isStruckOrPluckedInstrument('guitar')).toBe(true)
        expect(isStruckOrPluckedInstrument('bass-guitar')).toBe(true)
        expect(isStruckOrPluckedInstrument('piano')).toBe(true)
        expect(isStruckOrPluckedInstrument('violin')).toBe(false)
        expect(isStruckOrPluckedInstrument(undefined)).toBe(false)
    })
})
