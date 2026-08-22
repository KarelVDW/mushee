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
 */

import type { NoteEventTime } from '../../../src/recordings/pipeline/note-event';

import {
  NoteExtractor,
  type NoteExtractorOptions,
} from '../../../src/recordings/pipeline/note-extractor';
import { VOICE_OPTS } from '../../../src/recordings/pipeline/providers/crepe-provider';
import { segmentNotes } from '../../../src/recordings/pipeline/providers/pitch-decoder';
import { VoiceNoteDecoder } from '../../../src/recordings/pipeline/voice-note-decoder';
import { PITCHDOWN_PROVIDER_NAME } from '../../../src/recordings/pipeline/profiles/pipeline-profile';
import type { CachedClip } from './trackCache';

/**
 * Frame-count knob as production's provider would see it. The octave-down
 * wrapper multiplies BOTH the declared value and its default by its slow-down
 * factor (its frames span half the real time), so replaying its cached
 * 10 ms-hop track needs the same counts — 8 frames = 80 ms real, matching the
 * at-pitch bands' 4 frames at 20 ms.
 */
export function frameCount(c: CachedClip, declared: number | undefined): number {
  return (declared ?? 4) * (c.providerName === PITCHDOWN_PROVIDER_NAME ? 2 : 1);
}

/**
 * Honours the same `RECORDING_VOICE_DECODE=0` kill-switch as the resolver, so an
 * A/B works off an already-cached profile (where `isVoice` is baked in) without
 * rebuilding the cache.
 */
function voiceEnabled(): boolean {
  return process.env.RECORDING_VOICE_DECODE !== '0';
}

/** Raw notes from the decode the clip's profile selects. */
export function segmentAsProduction(c: CachedClip): NoteEventTime[] {
  const gate = {
    confidenceThreshold: c.profile.confidenceThreshold ?? 0.5,
    minFreqHz: c.profile.minFreqHz,
    maxFreqHz: c.profile.maxFreqHz,
  };
  if (c.profile.isVoice && voiceEnabled()) {
    return new VoiceNoteDecoder({
      ...VOICE_OPTS,
      ...gate,
      minNoteSec: frameCount(c, c.profile.minFramesPerNote) * c.track.hopSec,
    }).decode(c.track, c.energy);
  }
  return segmentNotes(c.track.cents, c.track.confidence, c.track.frames, {
    hopSize: 1,
    sampleRate: 1 / c.track.hopSec,
    ...gate,
    minFramesPerNote: frameCount(c, c.profile.minFramesPerNote),
    pitchBinToleranceCents: 50,
    mode: c.profile.segmentMode === 'median' ? 'median' : 'semitone',
    smoothFrames: frameCount(c, c.profile.smoothFrames),
  });
}

/** The cleanup set the clip's profile selects — mirrors `AudioConverter.cleanupFor`. */
export function cleanupAsProduction(c: CachedClip): NoteExtractorOptions {
  // maxGridDivisor 4 everywhere: the MusicXML grid bottoms out at the 16th, so a
  // finer snap is re-rounded by the round-trip and only shows up as onset error.
  if (c.profile.isVoice && voiceEnabled()) {
    return {
      maxGridDivisor: 4,
      steps: {
        pitchOutliers: false,
        merge: false,
        transients: false,
        monophonic: false,
      },
    };
  }
  return {
    maxGridDivisor: 4,
    steps: { pitchOutliers: false, merge: false },
    adaptiveFloorFraction: 0.3,
  };
}

/** Cleaned (performance-domain) notes — segmentation plus the profile's cleanup. */
export function performanceAsProduction(c: CachedClip, bpm = 120): NoteEventTime[] {
  return new NoteExtractor(cleanupAsProduction(c)).clean(segmentAsProduction(c), {
    bpm,
    onsetTimesSec: c.onsetTimesSec,
  });
}
