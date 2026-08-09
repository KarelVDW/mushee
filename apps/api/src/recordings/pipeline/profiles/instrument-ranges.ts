/**
 * Optional, approximate sounding-pitch ranges (Hz) keyed by the web app's
 * `Instrument.id`. Used only as a *hint* to widen the resolved frequency window
 * so the first notes aren't clipped before the pitch scan has enough audio —
 * auto-detection from the audio remains authoritative. A missing id just means
 * "no hint", which is fine.
 *
 * Ranges are generous (a bit below the lowest and above the highest practical
 * note) and expressed at concert/sounding pitch, matching what the microphone
 * actually hears regardless of the instrument's written transposition.
 */
export interface FreqRange {
  minHz: number;
  maxHz: number;
}

const RANGES: Record<string, FreqRange> = {
  // Brass
  trumpet: { minHz: 160, maxHz: 1200 },
  trombone: { minHz: 70, maxHz: 620 },
  tuba: { minHz: 40, maxHz: 380 },
  'french-horn': { minHz: 90, maxHz: 720 },
  euphonium: { minHz: 60, maxHz: 500 },
  brass: { minHz: 90, maxHz: 1000 },
  // Woodwinds
  flute: { minHz: 240, maxHz: 2200 },
  piccolo: { minHz: 500, maxHz: 4200 },
  oboe: { minHz: 230, maxHz: 1800 },
  clarinet: { minHz: 130, maxHz: 1600 },
  'bass-clarinet': { minHz: 70, maxHz: 800 },
  bassoon: { minHz: 55, maxHz: 620 },
  recorder: { minHz: 350, maxHz: 2400 },
  'pan-flute': { minHz: 240, maxHz: 1500 },
  saxophone: { minHz: 110, maxHz: 900 },
  'alto-saxophone': { minHz: 130, maxHz: 900 },
  'tenor-saxophone': { minHz: 100, maxHz: 700 },
  harmonica: { minHz: 200, maxHz: 1800 },
  ocarina: { minHz: 400, maxHz: 2200 },
  // Whistles, and whistling. Reached by the substring fallback for the app's
  // `tin-whistle` (a D whistle, D5-D7), which previously matched nothing and so got
  // no hint at all. The bound is set for *human whistling*, whose compass is
  // genuinely C5-C8 (523-4186 Hz) rather than the 1-3 kHz usually assumed, and which
  // contains the tin whistle's range. Erring wide is the right way round here per the
  // resolver's own tradeoff: too high a floor clips real notes outright, while too
  // low a one only mildly risks an octave error that post-processing still suppresses.
  whistle: { minHz: 500, maxHz: 4300 },
  // Strings
  violin: { minHz: 190, maxHz: 2800 },
  viola: { minHz: 120, maxHz: 1500 },
  cello: { minHz: 60, maxHz: 920 },
  contrabass: { minHz: 38, maxHz: 400 },
  erhu: { minHz: 270, maxHz: 1500 },
  guitar: { minHz: 75, maxHz: 1400 },
  'bass-guitar': { minHz: 38, maxHz: 450 },
  // Voice
  'voice-lead': { minHz: 75, maxHz: 1100 },
};

/**
 * Instrument ids that mean "a person is singing into the microphone".
 *
 * The score's instrument is the pipeline's voice prior of last resort. Since
 * 2026-08 the audio itself decides first (`SourceClassifier`, stock YAMNet
 * class scores — no fitted head, so the no-training policy is respected); this
 * prior is what an abstention falls back to, and an explicit
 * `ProfileHint.sourceKind` from the caller overrides both.
 */
const VOICE_INSTRUMENT_IDS = new Set(['voice-lead']);

/** Whether the score's instrument implies a sung source. */
export function isVoiceInstrument(id: string | undefined): boolean {
  if (!id) return false;
  return VOICE_INSTRUMENT_IDS.has(id) || id.startsWith('voice');
}

export function rangeForInstrument(id: string | undefined): FreqRange | undefined {
  if (!id) return undefined;
  if (RANGES[id]) return RANGES[id];
  // Fall back on a coarse substring match (e.g. "soprano-saxophone").
  for (const [key, range] of Object.entries(RANGES)) {
    if (id.includes(key)) return range;
  }
  return undefined;
}
