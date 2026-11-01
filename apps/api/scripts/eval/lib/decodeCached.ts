/**
 * Segment a cached clip **the way the production pipeline would**.
 *
 * Every downstream script wants this and each used to hand-roll it, which is how
 * they drifted: `notation-eval.ts` was scoring the notation stage with the
 * semitone-run segmenter and `NoteExtractor`'s *default* cleanup, a combination
 * that has never shipped (the trajectory path drops `pitchOutliers` and `merge`).
 * A metric computed on a configuration the product does not run is not a
 * measurement of the product.
 *
 * The routing decision itself lives in the cached `PipelineProfile` — `TrackCache`
 * stores what `ProfileResolver` chose for that clip — so this only has to *honour*
 * it, never re-derive it.
 *
 * Parity with the benchmark (`benchmark.ts run` → `AudioConverter`, whole buffer):
 * `notesAsProduction` reproduces it note for note when the entry is current —
 * trackCache v7, built under the process's resolver env — because the cache holds
 * the same resolver call, the same `track()`, the profile's own re-attack onsets,
 * and the cleanup comes from `AudioConverter.cleanupFor` itself. Checked
 * 2026-11-01 over every pooled dataset (see the eval README). What neither path
 * models is the streaming server: the profile locked on the first pitched
 * ≥ 1.2 s, the final-pass reroute, the MusicXML round-trip.
 */

import { AudioConverter } from '../../../src/recordings/pipeline/audio-converter'
import type { NoteEventTime } from '../../../src/recordings/pipeline/note-event'
import { NoteExtractor, type NoteExtractorOptions } from '../../../src/recordings/pipeline/note-extractor'
import { PITCHDOWN_PROVIDER_NAME } from '../../../src/recordings/pipeline/profiles/pipeline-profile'
import { segmentNotes } from '../../../src/recordings/pipeline/semitone-segmenter'
import { SHIPPING_VOICE_OPTS } from '../../../src/recordings/pipeline/voice-note-decoder'
import { VoiceNoteDecoder } from '../../../src/recordings/pipeline/voice-note-decoder'
import type { CachedClip } from './trackCache'

/**
 * What the decode reads from a cache entry — both `TrackCache` (`CachedClip`)
 * and `VariantTrackCache` (`CachedVariant`) entries carry it.
 */
export type DecodableClip = Pick<CachedClip, 'profile' | 'providerName' | 'track' | 'energy' | 'onsetTimesSec'>

/**
 * Frame-count knob as production's provider would see it. The octave-down
 * wrapper multiplies BOTH the declared value and its default by its slow-down
 * factor (its frames span half the real time), so replaying its cached
 * 10 ms-hop track needs the same counts — 8 frames = 80 ms real, matching the
 * at-pitch bands' 4 frames at 20 ms.
 */
export function frameCount(c: DecodableClip, declared: number | undefined): number {
    return (declared ?? 4) * (c.providerName === PITCHDOWN_PROVIDER_NAME ? 2 : 1)
}

/**
 * Honours the same `RECORDING_VOICE_DECODE=0` kill-switch as the resolver, so an
 * A/B works off an already-cached profile (where `isVoice` is baked in) without
 * rebuilding the cache.
 */
function voiceEnabled(): boolean {
    return process.env.RECORDING_VOICE_DECODE !== '0'
}

/** Raw notes from the decode the clip's profile selects. */
export function segmentAsProduction(c: DecodableClip): NoteEventTime[] {
    const gate = {
        confidenceThreshold: c.profile.confidenceThreshold ?? 0.5,
        minFreqHz: c.profile.minFreqHz,
        maxFreqHz: c.profile.maxFreqHz,
    }
    if (c.profile.isVoice && voiceEnabled()) {
        return new VoiceNoteDecoder({
            ...SHIPPING_VOICE_OPTS,
            ...gate,
            minNoteSec: frameCount(c, c.profile.minFramesPerNote) * c.track.hopSec,
        }).decode(c.track, c.energy)
    }
    return segmentNotes(c.track.cents, c.track.confidence, c.track.frames, {
        hopSize: 1,
        sampleRate: 1 / c.track.hopSec,
        ...gate,
        minFramesPerNote: frameCount(c, c.profile.minFramesPerNote),
        pitchBinToleranceCents: 50,
        mode: c.profile.segmentMode === 'median' ? 'median' : 'semitone',
        smoothFrames: frameCount(c, c.profile.smoothFrames),
    })
}

/**
 * The cleanup set the clip's profile selects: production's own
 * `AudioConverter.cleanupFor`, so the voice branch carries the shipped adaptive
 * floor and seam-fill. Under `RECORDING_VOICE_DECODE=0` the cached `isVoice` is
 * ignored, as the resolver would not have set it.
 */
export function cleanupAsProduction(c: DecodableClip): NoteExtractorOptions {
    return AudioConverter.cleanupFor(false, voiceEnabled() ? c.profile : { ...c.profile, isVoice: undefined })
}

/** Cleaned (performance-domain) notes — segmentation plus the profile's cleanup, no quantisation. */
export function performanceAsProduction(c: DecodableClip, bpm = 120): NoteEventTime[] {
    return new NoteExtractor(cleanupAsProduction(c)).clean(segmentAsProduction(c), {
        bpm,
        onsetTimesSec: c.onsetTimesSec,
    })
}

/**
 * The notes the benchmark scores for this clip: `AudioConverter.convert` on the
 * cached track — decode, the profile's cleanup with the profile's re-attack
 * onsets (trackCache v7), the 16th-grid snap at the take's tempo and the
 * one-note-per-slot collapse (`NoteExtractor.extract().deduced`). Pass the
 * truth's `bpm`: the snap grid depends on it.
 */
export function notesAsProduction(c: DecodableClip, bpm: number): NoteEventTime[] {
    return new NoteExtractor(cleanupAsProduction(c)).extract(segmentAsProduction(c), {
        bpm,
        onsetTimesSec: c.onsetTimesSec,
    }).deduced
}
