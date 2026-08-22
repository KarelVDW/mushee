/**
 * A `PipelineProfile` is the *config* that adapts the (single, shared) pipeline
 * to one input's register and character. It bundles everything that used to be
 * hard-coded: which provider runs, the decoder high-pass cutoff, and the
 * provider's frequency window / gating thresholds.
 *
 * Profiles are produced by the `ProfileResolver` from a coarse pitch scan of
 * the first audio (optionally seeded by an instrument hint). The named bands
 * below are the *anchors* the resolver snaps a detected register to; the
 * resolver then overrides the frequency window with a dynamic one fitted to the
 * actual audio. Keeping the per-band provider/threshold choices in one table is
 * what the tuning workflow edits — the rest of the pipeline never forks.
 */

export interface PipelineProfile {
  id: string;
  /** Provider key understood by the ProviderRegistry. */
  providerName: string;
  /** Decoder high-pass cutoff (Hz). Sits below the lowest expected fundamental. */
  highpassHz: number;
  minFreqHz: number;
  maxFreqHz: number;
  /** Voicing gate for CREPE. */
  confidenceThreshold?: number;
  /**
   * Run the decoder's spectral denoiser (afftdn) before transcription — set by
   * the resolver when the scan measures a noisy backdrop (wind, chatter, hiss).
   */
  denoise?: boolean;
  /** Minimum voiced run length (frames) a note needs — raised under noise. */
  minFramesPerNote?: number;
  /**
   * Calibrated report-time correction for the amplitude re-attack detector, in
   * seconds (+ = later) — aubio's `delay` parameter, per profile (R7). The
   * detector reports the trough of the inter-note dip, which precedes the
   * audible re-attack, so a positive constant is expected once calibrated.
   * Unset = 0 = the historical behaviour. (The voice decode's own analogous
   * constant is `onsetShiftSec` on `VoiceNoteDecoder` — a different path with
   * its own calibration; see E5/R12 before unifying them.)
   */
  onsetDelaySec?: number;
  /**
   * Which note segmentation the trajectory providers run.
   *
   * Until 2026-08 this was not on the profile at all — the pipeline could adapt
   * *where* it listened (register, gates, denoise) but not *how* it decided where
   * notes begin, so every source got the same segmenter. That is the plumbing gap
   * the voice flow needed closed: `'voice'` selects `VoiceNoteDecoder`, which is
   * a large win on singing and a large loss on instruments, so it has to be a
   * per-source choice rather than a global one.
   */
  segmentMode?: 'median' | 'semitone' | 'voice';
  /** Semitone-mode median smoother half-window, in frames. */
  smoothFrames?: number;
  /**
   * True when the resolver believes this recording is a human voice. Distinct
   * from `segmentMode === 'voice'` because it also selects the voice cleanup set
   * downstream (`AudioConverter.cleanupFor`) and is what gets archived as the
   * routing decision.
   */
  isVoice?: boolean;
  /**
   * What the resolver believes is at the microphone — distinct from `isVoice`,
   * which is the ROUTING outcome: on the no-reliable-pitch fallback the profile
   * ran the note-level provider, where the voice overlay deliberately never applied, so a
   * voice take can be believed 'voice' while `isVoice` stays unset. The belief
   * is what the client shows the user and what gets archived for debugging.
   */
  sourceBelief?: 'voice' | 'instrument';
  /**
   * Which evidence produced `sourceBelief`, in priority order: an explicit
   * caller declaration, the audio source classifier's verdict, or the
   * score-instrument prior (also the fallback when the classifier abstains).
   * A mis-routed recording is only debuggable if this is recorded.
   */
  sourceDecidedBy?: 'explicit' | 'classifier' | 'prior';
}

/** Absolute clamps for any resolved window. ~A0 to a hair above C8. */
export const GLOBAL_MIN_FREQ_HZ = 55;
export const GLOBAL_MAX_FREQ_HZ = 4500;

/**
 * CREPE trajectory models top out near ~1997 Hz. Content above it is served by
 * the octave-down wrapper (`CrepePitchdownProvider`), which hears to 2× this.
 */
export const TRAJECTORY_MODEL_CEILING_HZ = 1900;

export const PITCHDOWN_PROVIDER_NAME = 'crepe-tiny-down1';
/** The wrapper hears everything at half frequency: 2 × the CREPE ceiling. */
export const PITCHDOWN_MODEL_CEILING_HZ = TRAJECTORY_MODEL_CEILING_HZ * 2;

/**
 * Register bands, ordered low→high. The resolver picks the band whose range
 * best contains the detected median f0, takes its provider + thresholds, then
 * fits the actual min/max around the detected distribution.
 *
 * Provider + threshold choices come from the tuning workflow's per-band sweep
 * over the eval corpus (scripts/eval): the monophonic CREPE trajectory
 * providers beat the polyphonic basic-pitch by a wide margin on sustained
 * single-pitch input (F1 ~0.71–0.74 vs ~0.50–0.58) within their ~1997 Hz
 * ceiling. Above that ceiling the octave-down wrapper hears (to ~3.9 kHz), so
 * the very-high band (piccolo, whistling) rides it — which is what allowed
 * basic-pitch's removal (2026-08-22).
 */
export const PROFILE_BANDS: PipelineProfile[] = [
  {
    id: 'low', // bass voice, tuba, cello, bassoon
    providerName: 'crepe-tiny',
    highpassHz: 40,
    minFreqHz: 55,
    maxFreqHz: 700,
    // 0.6 predates the 2026-07 scan fix: the legacy scan often locked onto a
    // harmonic and routed male voices to `mid`; with the register now read
    // correctly they land here, and 0.6 cost them recall on the real corpus.
    confidenceThreshold: 0.5,
  },
  {
    id: 'mid', // trumpet, clarinet, tenor/alto voice, harmonica
    providerName: 'crepe-tiny',
    highpassHz: 70,
    minFreqHz: 90,
    maxFreqHz: 1300,
    confidenceThreshold: 0.5,
  },
  {
    id: 'high', // flute, oboe, violin, soprano voice
    providerName: 'crepe-tiny',
    highpassHz: 120,
    minFreqHz: 200,
    maxFreqHz: 1900,
    confidenceThreshold: 0.5,
  },
  {
    id: 'very-high', // piccolo, whistling — via the octave-down CREPE wrapper
    providerName: PITCHDOWN_PROVIDER_NAME,
    highpassHz: 300,
    minFreqHz: 500,
    // Capped to what the wrapper hears (~3.9 kHz real) by the resolver — above
    // the highest note either corpus contains (3 729 Hz).
    maxFreqHz: 4500,
    // A confidence gate, which also arms the reverberance relief ramp
    // (`applyReverb`) on this band — something the old note-level provider
    // could not have. Measured before basic-pitch's removal (eval README,
    // 2026-08-20/22 logs): synthetic adaptive 0.589 → 0.605; real audio
    // decisive — TinySOL very-high (exact truth) +0.150*, whistle-real
    // (n=117) +0.275*.
    confidenceThreshold: 0.5,
  },
];

/**
 * The **voice band family**: same register routing as the instrument bands, but
 * carrying the voice decode and its own gate.
 *
 * Kept as an overlay applied by `ProfileResolver.applyVoice` rather than as extra
 * rows in `PROFILE_BANDS`, because register and source are independent — a bass
 * voice and a tuba share a register and want different segmentation, and
 * duplicating every band per source would double the table for one flag.
 *
 * Measured on the voice slice of the real corpus (annotated-vocalset, N20EMv2,
 * vocadito) with `scripts/eval/sweep-voice.ts`, paired bootstrap over clips:
 * COnP@±100 ms **0.570 → 0.668 on held-out test** (+0.123 [+0.102, +0.144]),
 * dev +0.145. The instrument corpora are untouched because nothing routes them
 * here — and if they were, it would cost them ~0.03.
 */
export const VOICE_OVERLAY = {
  segmentMode: 'voice',
  isVoice: true,
} as const satisfies Partial<PipelineProfile>;

/**
 * Safe profile used before detection completes / when audio is too short.
 *
 * Measured before it moved off basic-pitch (`bench-default-provider.ts`, over
 * every clip the resolver actually routes here — 188 heavy-reverb real
 * variants + 60 synthetic): the fallback fires only on audio so degraded that
 * NO provider transcribes it (COnP ≈ 0.001 under basic-pitch, CREPE, and the
 * octave-down wrapper alike, paired Δ +0.000 [+0.000, +0.000]) — the provider
 * choice on this route is immaterial. The 1900 Hz cap (the old default reached
 * 2200) sits in a range the fallback never successfully transcribed anywhere
 * in either corpus.
 */
export const DEFAULT_PROFILE: PipelineProfile = {
  id: 'default-wide',
  providerName: 'crepe-tiny',
  highpassHz: 55,
  minFreqHz: GLOBAL_MIN_FREQ_HZ,
  maxFreqHz: TRAJECTORY_MODEL_CEILING_HZ,
  confidenceThreshold: 0.5,
};

/** Distinct provider keys any profile can select — what the registry pre-warms. */
export function usedProviderNames(): string[] {
  return [
    ...new Set([
      DEFAULT_PROFILE.providerName,
      ...PROFILE_BANDS.map((b) => b.providerName),
    ]),
  ];
}
