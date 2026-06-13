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
  /** basic-pitch note gates. */
  onsetThreshold?: number;
  frameThreshold?: number;
}

/** Absolute clamps for any resolved window. ~A0 to a hair above C8. */
export const GLOBAL_MIN_FREQ_HZ = 55;
export const GLOBAL_MAX_FREQ_HZ = 4500;

/**
 * CREPE trajectory models top out near ~1997 Hz; only basic-pitch's CNN
 * spans the full MIDI 21–108 (~4186 Hz). Any window reaching above this must
 * therefore use basic-pitch.
 */
export const TRAJECTORY_MODEL_CEILING_HZ = 1900;

/**
 * Register bands, ordered low→high. The resolver picks the band whose range
 * best contains the detected median f0, takes its provider + thresholds, then
 * fits the actual min/max around the detected distribution.
 *
 * Provider + threshold choices come from the tuning workflow's per-band sweep
 * over the eval corpus (scripts/eval): the monophonic trajectory providers
 * (CREPE) beat the polyphonic basic-pitch by a wide margin on sustained
 * single-pitch input (F1 ~0.71–0.74 vs ~0.50–0.58) within their ~1997 Hz
 * ceiling. Above that ceiling only basic-pitch's CNN reaches, so the very-high
 * band (piccolo, whistling) stays on basic-pitch. The resolver also falls back
 * to basic-pitch whenever a fitted window exceeds the trajectory ceiling.
 */
export const PROFILE_BANDS: PipelineProfile[] = [
  {
    id: 'low', // bass voice, tuba, cello, bassoon
    providerName: 'crepe-tiny',
    highpassHz: 40,
    minFreqHz: 55,
    maxFreqHz: 700,
    confidenceThreshold: 0.6,
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
    id: 'very-high', // piccolo, whistling — above the CREPE ceiling
    providerName: 'basic-pitch',
    highpassHz: 300,
    minFreqHz: 500,
    maxFreqHz: 4500,
    onsetThreshold: 0.5,
    frameThreshold: 0.3,
  },
];

/** Safe profile used before detection completes / when audio is too short. */
export const DEFAULT_PROFILE: PipelineProfile = {
  id: 'default-wide',
  providerName: 'basic-pitch',
  highpassHz: 55,
  minFreqHz: GLOBAL_MIN_FREQ_HZ,
  maxFreqHz: 2200,
  onsetThreshold: 0.5,
  frameThreshold: 0.3,
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
