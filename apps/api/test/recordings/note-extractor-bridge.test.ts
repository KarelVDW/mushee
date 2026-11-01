import { afterEach, describe, expect, it, vi } from 'vitest'

import { AudioConverter } from '../../src/recordings/pipeline/audio-converter'
import { NoteExtractor } from '../../src/recordings/pipeline/note-extractor'
import {
    AT_PITCH_PROVIDER_NAME,
    type PipelineProfile,
    PITCHDOWN_PROVIDER_NAME,
    SUSTAINED_ONSET_DIP_RATIO,
} from '../../src/recordings/pipeline/profiles/pipeline-profile'
import type { ProfileHint } from '../../src/recordings/pipeline/profiles/profile-resolver'
import type { SourceAnalysis } from '../../src/recordings/pipeline/profiles/source-classifier'

const n = (start: number, dur: number, midi: number, amp = 0.5) => ({
    startTimeSeconds: start,
    durationSeconds: dur,
    pitchMidi: midi,
    amplitude: amp,
})

/** The trajectory cleanup set with nothing but the bridge switched on, so each test sees the bridge alone. */
const bridgeOnly = (gapSec: number) =>
    new NoteExtractor({
        bridgeSamePitchGapSec: gapSec,
        steps: { monophonic: false, pitchOutliers: false, transients: false, merge: false, onsetSplit: false },
    })

describe('NoteExtractor same-pitch gap bridge', () => {
    it('rejoins a held note split by a short dip below the voicing gate', () => {
        const out = bridgeOnly(0.12).clean([n(1, 0.5, 48, 0.4), n(1.56, 0.6, 48, 0.7)], { bpm: 120, onsetTimesSec: [] })
        expect(out).toHaveLength(1)
        expect(out[0]).toMatchObject({ startTimeSeconds: 1, pitchMidi: 48, amplitude: 0.7 })
        expect(out[0].durationSeconds).toBeCloseTo(1.16, 9)
    })

    it('chains a third fragment onto the already-joined note', () => {
        const out = bridgeOnly(0.1).clean([n(0, 0.3, 50), n(0.36, 0.3, 50), n(0.74, 0.3, 50)], { bpm: 120, onsetTimesSec: [] })
        expect(out).toHaveLength(1)
        expect(out[0].durationSeconds).toBeCloseTo(1.04, 9)
    })

    it('bridges a gap of exactly the limit (whole frames computed two ways)', () => {
        // 0.8 − 0.7 = 0.10000000000000009: the frame grid must not miss the limit by a rounding error.
        const out = bridgeOnly(0.1).clean([n(0, 0.7, 60), n(0.8, 0.2, 60)], { bpm: 120, onsetTimesSec: [] })
        expect(out).toHaveLength(1)
    })

    it('keeps a re-attacked repeat: a detected onset within 30 ms of the gap vetoes the join', () => {
        const notes = [n(1, 0.5, 48), n(1.56, 0.6, 48)]
        expect(bridgeOnly(0.12).clean(notes, { bpm: 120, onsetTimesSec: [1.58] })).toHaveLength(2)
        expect(bridgeOnly(0.12).clean(notes, { bpm: 120, onsetTimesSec: [1.48] })).toHaveLength(2)
        // An onset well inside a note is no evidence about this gap.
        expect(bridgeOnly(0.12).clean(notes, { bpm: 120, onsetTimesSec: [1.2, 1.9] })).toHaveLength(1)
    })

    it('never joins different pitches or a gap longer than the limit', () => {
        expect(bridgeOnly(0.12).clean([n(0, 0.4, 60), n(0.44, 0.4, 61)], { bpm: 120, onsetTimesSec: [] })).toHaveLength(2)
        expect(bridgeOnly(0.06).clean([n(0, 0.4, 60), n(0.48, 0.4, 60)], { bpm: 120, onsetTimesSec: [] })).toHaveLength(2)
    })

    it('with a fragment limit, joins only when the shorter note is a fragment', () => {
        const ex = new NoteExtractor({
            bridgeSamePitchGapSec: 0.12,
            bridgeMaxFragmentSec: 0.2,
            steps: { monophonic: false, pitchOutliers: false, transients: false, merge: false, onsetSplit: false },
        })
        // Two full-length notes a frame apart: a re-bowed repeat the detector missed — kept.
        expect(ex.clean([n(0, 0.5, 43), n(0.52, 0.6, 43)], { bpm: 120, onsetTimesSec: [] })).toHaveLength(2)
        // A 120 ms fragment after a dropout — rejoined, on either side.
        expect(ex.clean([n(0, 0.5, 43), n(0.56, 0.12, 43)], { bpm: 120, onsetTimesSec: [] })).toHaveLength(1)
        expect(ex.clean([n(0, 0.12, 43), n(0.16, 0.5, 43)], { bpm: 120, onsetTimesSec: [] })).toHaveLength(1)
    })

    it('is off by default', () => {
        const notes = [n(1, 0.5, 48), n(1.54, 0.6, 48)]
        const off = new NoteExtractor({ steps: { onsetSplit: false } }).clean(notes, { bpm: 120, onsetTimesSec: [] })
        expect(off).toHaveLength(2)
    })

    it('runs before the onset split, which still separates a re-attack inside the joined note', () => {
        const ex = new NoteExtractor({ bridgeSamePitchGapSec: 0.12, steps: { pitchOutliers: false, merge: false } })
        const out = ex.clean([n(0, 0.5, 48), n(0.54, 0.6, 48)], { bpm: 120, onsetTimesSec: [0.9] })
        expect(out.map((x) => [x.startTimeSeconds, x.pitchMidi])).toEqual([
            [0, 48],
            [0.9, 48],
        ])
    })
})

describe('AudioConverter.bridgesSamePitchGaps (who gets the bridge)', () => {
    const sustained: PipelineProfile = {
        id: 'low',
        providerName: AT_PITCH_PROVIDER_NAME,
        highpassHz: 40,
        minFreqHz: 55,
        maxFreqHz: 700,
        confidenceThreshold: 0.5,
        onsetDipRatio: SUSTAINED_ONSET_DIP_RATIO,
        sourceBelief: 'instrument',
    }

    it('selects sustained instruments on the at-pitch provider', () => {
        expect(AudioConverter.bridgesSamePitchGaps(sustained)).toBe(true)
    })

    it('excludes voice by routing or by belief, struck/plucked, the octave-down band and a disabled detector', () => {
        expect(AudioConverter.bridgesSamePitchGaps({ ...sustained, isVoice: true })).toBe(false)
        expect(AudioConverter.bridgesSamePitchGaps({ ...sustained, sourceBelief: 'voice' })).toBe(false)
        expect(AudioConverter.bridgesSamePitchGaps({ ...sustained, onsetDipRatio: undefined })).toBe(false)
        expect(AudioConverter.bridgesSamePitchGaps({ ...sustained, onsetDipRatio: 0 })).toBe(false)
        expect(AudioConverter.bridgesSamePitchGaps({ ...sustained, providerName: PITCHDOWN_PROVIDER_NAME })).toBe(false)
        expect(AudioConverter.bridgesSamePitchGaps(undefined)).toBe(false)
    })

    it('ships the bridge (0.12 s, fragment < 0.2 s) for sustained instruments while the env is unset', () => {
        expect(AudioConverter.cleanupFor(false, sustained)).toMatchObject({ bridgeSamePitchGapSec: 0.12, bridgeMaxFragmentSec: 0.2 })
        expect(AudioConverter.cleanupFor(false, { ...sustained, onsetDipRatio: undefined })).not.toHaveProperty('bridgeSamePitchGapSec')
    })

    afterEach(() => {
        vi.unstubAllEnvs()
        vi.resetModules()
    })

    it('reads EXTRACTOR_BRIDGE_GAP_SEC / EXTRACTOR_BRIDGE_FRAGMENT_SEC into the sustained set only', async () => {
        vi.stubEnv('EXTRACTOR_BRIDGE_GAP_SEC', '0.08')
        vi.stubEnv('EXTRACTOR_BRIDGE_FRAGMENT_SEC', '0.25')
        vi.resetModules()
        const { AudioConverter: Fresh } = await import('../../src/recordings/pipeline/audio-converter')
        expect(Fresh.cleanupFor(false, sustained)).toMatchObject({ bridgeSamePitchGapSec: 0.08, bridgeMaxFragmentSec: 0.25 })
        expect(Fresh.cleanupFor(false, { ...sustained, onsetDipRatio: undefined })).not.toHaveProperty('bridgeSamePitchGapSec')
        expect(Fresh.cleanupFor(false, { ...sustained, isVoice: true })).not.toHaveProperty('bridgeSamePitchGapSec')
        expect(Fresh.cleanupFor(true, sustained)).toEqual({})
    })

    it('EXTRACTOR_BRIDGE_GAP_SEC=0 is the kill-switch; EXTRACTOR_BRIDGE_FRAGMENT_SEC=0 drops the fragment condition', async () => {
        vi.stubEnv('EXTRACTOR_BRIDGE_GAP_SEC', '0')
        vi.resetModules()
        const off = (await import('../../src/recordings/pipeline/audio-converter')).AudioConverter
        expect(off.cleanupFor(false, sustained)).not.toHaveProperty('bridgeSamePitchGapSec')
        vi.unstubAllEnvs()
        vi.stubEnv('EXTRACTOR_BRIDGE_FRAGMENT_SEC', '0')
        vi.resetModules()
        const anyLength = (await import('../../src/recordings/pipeline/audio-converter')).AudioConverter.cleanupFor(false, sustained)
        expect(anyLength).toMatchObject({ bridgeSamePitchGapSec: 0.12 })
        expect(anyLength).not.toHaveProperty('bridgeMaxFragmentSec')
    })
})

/**
 * Who gets the bridge through the RESOLVER, end to end: the family split the bridge
 * reads (`onsetDipRatio`) comes from `applyOnsetPolicy`, so a change there changes
 * the bridge's reach. The classifier's verdict is pinned (no model); the take is a
 * held 220 Hz tone, which routes to the at-pitch provider.
 */
describe('who gets the bridge, through the resolver', () => {
    const SR = 16000
    const tone = new Float32Array(2 * SR).map(
        (_, i) => 0.3 * Math.sin((2 * Math.PI * 220 * i) / SR) + 0.1 * Math.sin((4 * Math.PI * 220 * i) / SR),
    )
    const INSTRUMENT: SourceAnalysis = { source: 'instrument', whistling: false, struckOrPlucked: false }
    const PLUCKED: SourceAnalysis = { source: 'instrument', whistling: false, struckOrPlucked: true }

    async function bridgedUnder(analysis: SourceAnalysis | undefined, env: Record<string, string> = {}) {
        vi.resetModules()
        for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v)
        vi.stubEnv('RECORDING_SOURCE_CLASSIFY', '0')
        const { SourceClassifier } = await import('../../src/recordings/pipeline/profiles/source-classifier')
        const analyze = vi.spyOn(SourceClassifier.prototype, 'analyze').mockReturnValue(analysis)
        const { ProfileResolver } = await import('../../src/recordings/pipeline/profiles/profile-resolver')
        const { AudioConverter: Converter } = await import('../../src/recordings/pipeline/audio-converter')
        const resolver = new ProfileResolver()
        return { analyze, bridged: (hint: ProfileHint) => Converter.bridgesSamePitchGaps(resolver.resolve(tone, SR, hint)) }
    }

    afterEach(() => {
        vi.restoreAllMocks()
        vi.unstubAllEnvs()
        vi.resetModules()
    })

    it('declared: struck/plucked scores never, sustained scores always — and the verdict is not consulted', async () => {
        const { analyze, bridged } = await bridgedUnder(PLUCKED)
        for (const id of ['guitar', 'piano', 'bass-guitar']) expect(bridged({ instrumentId: id, sourceKind: 'instrument' }), id).toBe(false)
        for (const id of ['cello', 'violin', 'flute']) expect(bridged({ instrumentId: id, sourceKind: 'instrument' }), id).toBe(true)
        expect(bridged({ instrumentId: 'cello', sourceKind: 'voice' })).toBe(false)
        expect(analyze).not.toHaveBeenCalled()
    })

    it('undeclared, heard as a sustained instrument: the bridge on any non-plucked score, none on a plucked one', async () => {
        const { bridged } = await bridgedUnder(INSTRUMENT)
        expect(bridged({ instrumentId: 'voice-lead' })).toBe(true)
        expect(bridged({})).toBe(true)
        expect(bridged({ instrumentId: 'violin' })).toBe(true)
        // The audio only moves a take INTO the struck/plucked family; the score still can.
        expect(bridged({ instrumentId: 'guitar' })).toBe(false)
    })

    it('undeclared, heard as struck/plucked: no bridge on a voice or empty score; a named instrument still decides', async () => {
        const { bridged } = await bridgedUnder(PLUCKED)
        for (const hint of [{ instrumentId: 'voice-lead' }, {}, { instrumentId: 'piano' }]) {
            expect(bridged(hint), JSON.stringify(hint)).toBe(false)
        }
        // The verdict's false positives are low sustained instruments (a tuba heard as
        // "Bass guitar"), so it never overrules a score that names a sustained one.
        for (const id of ['violin', 'cello', 'tuba']) expect(bridged({ instrumentId: id }), id).toBe(true)
    })

    it('undeclared, heard as a voice or abstaining: the voice route, or the score prior', async () => {
        expect(
            (await bridgedUnder({ source: 'voice', whistling: false, struckOrPlucked: false })).bridged({ instrumentId: 'violin' }),
        ).toBe(false)
        const abstain = (await bridgedUnder(undefined)).bridged
        expect(abstain({ instrumentId: 'cello' })).toBe(true)
        expect(abstain({ instrumentId: 'voice-lead' })).toBe(false)
        expect(abstain({ instrumentId: 'guitar' })).toBe(false)
    })

    it('RECORDING_PLUCKED_DETECT=0 lets the score alone decide again', async () => {
        const { bridged } = await bridgedUnder(PLUCKED, { RECORDING_PLUCKED_DETECT: '0' })
        expect(bridged({ instrumentId: 'voice-lead' })).toBe(true)
        expect(bridged({})).toBe(true)
        expect(bridged({ instrumentId: 'guitar' })).toBe(false)
    })
})
