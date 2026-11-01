import { afterEach, describe, expect, it, vi } from 'vitest'

import { OnsetDetector } from '../../src/recordings/pipeline/onset-detector'
import { PITCHDOWN_PROVIDER_NAME, SUSTAINED_ONSET_DIP_RATIO } from '../../src/recordings/pipeline/profiles/pipeline-profile'
import { analyzeScores, decideSource } from '../../src/recordings/pipeline/profiles/source-classifier'

/**
 * The whistle family (`RECORDING_WHISTLE_*`, built off). The knobs are read at
 * module load, so each case imports a fresh resolver under its own env. The
 * YAMNet verdict is pinned through its pure rule; the resolver cases use the
 * `whistle` hint, which admits a take without the model.
 */

const SR = 16000

/** A held near-sine at `hz` — enough for the pitch scan to lock a band. */
function tone(hz: number, sec = 2): Float32Array {
    const x = new Float32Array(Math.round(sec * SR))
    for (let i = 0; i < x.length; i += 1) {
        const t = i / SR
        x[i] = 0.3 * Math.sin(2 * Math.PI * hz * t) + 0.03 * Math.sin(4 * Math.PI * hz * t)
    }
    return x
}

async function resolverUnder(env: Record<string, string>) {
    vi.resetModules()
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v)
    // The model is not needed for hint-admitted takes; keep the test off YAMNet.
    vi.stubEnv('RECORDING_SOURCE_CLASSIFY', '0')
    const { ProfileResolver } = await import('../../src/recordings/pipeline/profiles/profile-resolver')
    return new ProfileResolver()
}

afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
})

describe('analyzeScores (whistling verdict)', () => {
    const NAMES = ['Silence', 'Speech', 'Singing', 'Guitar', 'Music', 'Whistling', 'Sine wave', 'Flute']

    function frame(hot: Record<string, number>): Float32Array {
        const logits = new Float32Array(NAMES.length).fill(-1)
        for (const [name, logit] of Object.entries(hot)) logits[NAMES.indexOf(name)] = logit
        return logits
    }

    it('says whistling when the class ranks in the top 3', () => {
        expect(analyzeScores(frame({ Whistling: 2 }), 1, NAMES.length, NAMES).whistling).toBe(true)
        expect(analyzeScores(frame({ Music: 3, 'Sine wave': 2.5, Whistling: 2 }), 1, NAMES.length, NAMES).whistling).toBe(true)
    })

    it('does not when three classes outrank it', () => {
        expect(analyzeScores(frame({ Music: 3, 'Sine wave': 2.5, Flute: 2.2, Whistling: 2 }), 1, NAMES.length, NAMES).whistling).toBe(false)
    })

    it('leaves the voice/instrument verdict exactly as decideSource gives it', () => {
        const cases: Array<Record<string, number>> = [{ Singing: 2, Whistling: 2.5 }, { Guitar: 2, Music: 2.5 }, { Silence: 3 }]
        for (const hot of cases) {
            const logits = frame(hot)
            expect(analyzeScores(logits, 1, NAMES.length, NAMES).source).toBe(decideSource(logits, 1, NAMES.length, NAMES))
        }
    })

    it('does not count a tie at the absent-class floor as a rank (near-silent prefix)', () => {
        // Silence on top, every other class at the same floor — Whistling is NOT second.
        const logits = new Float32Array(NAMES.length).fill(0)
        logits[NAMES.indexOf('Silence')] = 1
        expect(analyzeScores(logits, 1, NAMES.length, NAMES).whistling).toBe(false)
    })

    it('is false on a class map without the class', () => {
        const names = ['Silence', 'Music']
        expect(analyzeScores(new Float32Array([1, 2]), 1, 2, names).whistling).toBe(false)
    })
})

describe('whistle family in the resolver', () => {
    const WHISTLE = { instrumentId: 'whistle', sourceKind: 'instrument' as const }

    it('changes nothing while every whistle knob is off', async () => {
        const off = await resolverUnder({})
        const p = off.resolve(tone(1000), SR, WHISTLE)
        expect(p.id).not.toContain('whistle')
        expect(p.providerName).not.toBe(PITCHDOWN_PROVIDER_NAME)
        expect(p.onsetDipRatio).toBeGreaterThanOrEqual(SUSTAINED_ONSET_DIP_RATIO)
    })

    it('routes a whistle-hinted take to the octave-down band under RECORDING_WHISTLE_PITCHDOWN', async () => {
        const r = await resolverUnder({ RECORDING_WHISTLE_PITCHDOWN: '1' })
        const p = r.resolve(tone(1000), SR, WHISTLE)
        expect(p.providerName).toBe(PITCHDOWN_PROVIDER_NAME)
        expect(p.id).toMatch(/^very-high\+whistle/)
        // The window still comes from finalize, under the pitch-down ceiling.
        expect(p.maxFreqHz).toBeGreaterThan(1900)
    })

    it('keeps a tin-whistle hint in the sustained family (it tongues: its re-attacks are real)', async () => {
        const r = await resolverUnder({ RECORDING_WHISTLE_PITCHDOWN: '1', RECORDING_WHISTLE_ONSET: 'off' })
        const p = r.resolve(tone(1000), SR, { instrumentId: 'tin-whistle', sourceKind: 'instrument' })
        expect(p.id).not.toContain('whistle')
        expect(p.providerName).not.toBe(PITCHDOWN_PROVIDER_NAME)
        expect(p.onsetDipRatio).toBeGreaterThan(0)
    })

    it('sets the family re-attack dip from RECORDING_WHISTLE_ONSET, with no reverb ramp', async () => {
        const off = await resolverUnder({ RECORDING_WHISTLE_ONSET: 'off' })
        expect(off.resolve(tone(1000), SR, WHISTLE).onsetDipRatio).toBe(0)
        const dip = await resolverUnder({ RECORDING_WHISTLE_ONSET: '0.2' })
        expect(dip.resolve(tone(1000), SR, WHISTLE).onsetDipRatio).toBe(0.2)
        // Not a family member: the sustained policy, as today.
        expect(dip.resolve(tone(1000), SR, { instrumentId: 'flute', sourceKind: 'instrument' }).onsetDipRatio).toBeGreaterThanOrEqual(
            SUSTAINED_ONSET_DIP_RATIO,
        )
    })

    it('never routes a family member to the voice decode, even when declared voice', async () => {
        const r = await resolverUnder({ RECORDING_WHISTLE_PITCHDOWN: '1' })
        const p = r.resolve(tone(1000), SR, { instrumentId: 'whistle', sourceKind: 'voice' })
        expect(p.isVoice).toBeUndefined()
        expect(p.sourceBelief).toBe('instrument')
        expect(p.sourceDecidedBy).toBe('prior')
    })
})

describe('a zero re-attack dip', () => {
    it('never fires, even on cleanly separated repeated notes', () => {
        const x = new Float32Array(4 * SR)
        for (let i = 0; i < x.length; i += 1) {
            const t = i / SR
            x[i] = 0.5 * Math.exp(-(t % 0.5) / 0.06) * Math.sin(2 * Math.PI * 880 * t)
        }
        expect(new OnsetDetector().detect(x, SR).length).toBeGreaterThan(4)
        expect(new OnsetDetector({ dipRatio: 0 }).detect(x, SR)).toEqual([])
    })
})
