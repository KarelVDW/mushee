import type { Condition, Scenario } from './types';

/**
 * The evaluation matrix. Roots are chosen to place each melody in the source's
 * natural register — and, for the known-broken cases, deliberately at the
 * extremes the current pipeline mishandles:
 *   - whistle-high (~2 kHz) sits far above the old 1100 Hz ceiling
 *   - voice-bass (~85 Hz) sits at/under the old 80 Hz highpass + 65 Hz floor
 *   - voice-soprano-high / piccolo push the upper ceiling
 * trumpet-mid is the known-good control that must not regress.
 *
 * GM programs mirror apps/web Instrument.gmProgram values.
 */
export const SCENARIOS: Scenario[] = [
  // --- Instruments (rendered via FluidR3_GM) ---
  { id: 'trumpet-mid', label: 'Trumpet (mid, control)', kind: 'instrument', gmProgram: 56, instrumentId: 'trumpet', rootMidi: 60 },
  { id: 'trombone-low', label: 'Trombone (low brass)', kind: 'instrument', gmProgram: 57, instrumentId: 'trombone', rootMidi: 48 },
  { id: 'tuba-verylow', label: 'Tuba (very low)', kind: 'instrument', gmProgram: 58, instrumentId: 'tuba', rootMidi: 36 },
  { id: 'flute-high', label: 'Flute (high)', kind: 'instrument', gmProgram: 73, instrumentId: 'flute', rootMidi: 72 },
  { id: 'clarinet-mid', label: 'Clarinet (mid)', kind: 'instrument', gmProgram: 71, instrumentId: 'clarinet', rootMidi: 55 },
  { id: 'oboe-high', label: 'Oboe (high)', kind: 'instrument', gmProgram: 68, instrumentId: 'oboe', rootMidi: 72 },
  { id: 'bassoon-low', label: 'Bassoon (low double reed)', kind: 'instrument', gmProgram: 70, instrumentId: 'bassoon', rootMidi: 46 },
  { id: 'violin-high', label: 'Violin (high strings)', kind: 'instrument', gmProgram: 40, instrumentId: 'violin', rootMidi: 72 },
  { id: 'cello-low', label: 'Cello (low strings)', kind: 'instrument', gmProgram: 42, instrumentId: 'cello', rootMidi: 48 },
  { id: 'piccolo-veryhigh', label: 'Piccolo (very high)', kind: 'instrument', gmProgram: 72, instrumentId: 'piccolo', rootMidi: 84 },
  { id: 'harmonica-mid', label: 'Harmonica (free reed)', kind: 'instrument', gmProgram: 22, instrumentId: 'harmonica', rootMidi: 60 },

  // --- Voice (synthesized proxy, bass -> soprano) ---
  { id: 'voice-bass', label: 'Voice — bass', kind: 'voice', instrumentId: 'voice-lead', rootMidi: 41 },
  { id: 'voice-tenor', label: 'Voice — tenor', kind: 'voice', instrumentId: 'voice-lead', rootMidi: 50 },
  { id: 'voice-alto', label: 'Voice — alto', kind: 'voice', instrumentId: 'voice-lead', rootMidi: 57 },
  { id: 'voice-soprano', label: 'Voice — soprano (high)', kind: 'voice', instrumentId: 'voice-lead', rootMidi: 74 },

  // --- Whistling (synthesized proxy) ---
  { id: 'whistle-mid', label: 'Whistle (mid ~1 kHz)', kind: 'whistle', rootMidi: 84 },
  { id: 'whistle-high', label: 'Whistle (high ~1.5-3 kHz)', kind: 'whistle', rootMidi: 90 },
];

/**
 * Degradation conditions. Moderate by design — the user still expects "relative
 * quality" input, so we model a clean take, a roomy/condenser mic, and a noisy
 * band-limited phone mic, not extreme corruption.
 */
export const CONDITIONS: Condition[] = [
  { id: 'clean', label: 'Clean' },
  {
    id: 'room-mic',
    label: 'Room + condenser mic',
    noise: { color: 'pink', amplitude: 0.006 },
    postFilter: 'aecho=0.8:0.7:35:0.2,highpass=f=90,lowpass=f=9000',
  },
  {
    id: 'noisy-phone',
    label: 'Noisy phone mic',
    noise: { color: 'pink', amplitude: 0.02 },
    postFilter: 'highpass=f=85,lowpass=f=7000',
  },
];
