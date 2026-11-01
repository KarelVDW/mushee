import { afterEach, describe, expect, it, vi } from 'vitest'

import { AudioConverter } from '../../src/recordings/pipeline/audio-converter'
import { NoteExtractor } from '../../src/recordings/pipeline/note-extractor'
import {
    AT_PITCH_PROVIDER_NAME,
    type PipelineProfile,
    PITCHDOWN_PROVIDER_NAME,
    SUSTAINED_ONSET_DIP_RATIO,
} from '../../src/recordings/pipeline/profiles/pipeline-profile'

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

    it('leaves the shipped cleanup set unchanged while EXTRACTOR_BRIDGE_GAP_SEC is unset', () => {
        expect(AudioConverter.cleanupFor(false, sustained)).not.toHaveProperty('bridgeSamePitchGapSec')
        expect(AudioConverter.cleanupFor(false, sustained)).not.toHaveProperty('bridgeMaxFragmentSec')
    })

    afterEach(() => {
        vi.unstubAllEnvs()
        vi.resetModules()
    })

    it('reads EXTRACTOR_BRIDGE_GAP_SEC / EXTRACTOR_BRIDGE_FRAGMENT_SEC into the sustained set only', async () => {
        vi.stubEnv('EXTRACTOR_BRIDGE_GAP_SEC', '0.12')
        vi.stubEnv('EXTRACTOR_BRIDGE_FRAGMENT_SEC', '0.2')
        vi.resetModules()
        const { AudioConverter: Fresh } = await import('../../src/recordings/pipeline/audio-converter')
        expect(Fresh.cleanupFor(false, sustained)).toMatchObject({ bridgeSamePitchGapSec: 0.12, bridgeMaxFragmentSec: 0.2 })
        expect(Fresh.cleanupFor(false, { ...sustained, onsetDipRatio: undefined })).not.toHaveProperty('bridgeSamePitchGapSec')
        expect(Fresh.cleanupFor(false, { ...sustained, isVoice: true })).not.toHaveProperty('bridgeSamePitchGapSec')
        expect(Fresh.cleanupFor(true, sustained)).toEqual({})
    })
})
