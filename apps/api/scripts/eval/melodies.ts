import type { Melody } from './types';

/**
 * Register-agnostic melodies (semitone offsets within a major scale). Each is
 * placed into a scenario's register via its root MIDI. Multiple distinct
 * shapes (stepwise, leaps, mixed rhythm) guard against overfitting the pipeline
 * to one contour. bpm is intentionally moderate so notes stay separable.
 */

const BPM = 100;

/** Major scale up then down, even eighth-ish notes. */
const scale: Melody = {
  name: 'scale',
  bpm: BPM,
  notes: [0, 2, 4, 5, 7, 9, 11, 12, 11, 9, 7, 5, 4, 2, 0].map((degree) => ({
    degree,
    beats: 0.5,
  })),
};

/** Triad arpeggio over an octave — tests larger interval leaps. */
const arpeggio: Melody = {
  name: 'arpeggio',
  bpm: BPM,
  notes: [0, 4, 7, 12, 16, 12, 7, 4, 0].map((degree) => ({
    degree,
    beats: 0.5,
  })),
};

/** "Ode to Joy" fragment — stepwise, mostly quarter notes with a final half. */
const tune: Melody = {
  name: 'tune',
  bpm: BPM,
  notes: [
    [4, 1], [4, 1], [5, 1], [7, 1],
    [7, 1], [5, 1], [4, 1], [2, 1],
    [0, 1], [0, 1], [2, 1], [4, 1],
    [4, 1.5], [2, 0.5], [2, 2],
  ].map(([degree, beats]) => ({ degree, beats })),
};

/** Mixed-rhythm motif — eighths, quarters, and a held note. */
const rhythm: Melody = {
  name: 'rhythm',
  bpm: BPM,
  notes: [
    [0, 0.5], [0, 0.5], [2, 0.5], [4, 0.5],
    [4, 1], [2, 0.5], [0, 0.5],
    [7, 1], [5, 0.5], [4, 0.5], [2, 1], [0, 2],
  ].map(([degree, beats]) => ({ degree, beats })),
};

export const MELODIES: Melody[] = [scale, arpeggio, tune, rhythm];
