import type { GroundTruth, Melody } from '../types';

/** MIDI note number -> frequency in Hz (A4 = 69 = 440 Hz). */
export function midiToHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** Frequency in Hz -> fractional MIDI note number. Inverse of midiToHz. */
export function hzToMidi(hz: number): number {
  return 69 + 12 * Math.log2(hz / 440);
}

/**
 * Resolve a register-agnostic melody to absolute, timed notes at the given
 * root. Notes are laid out back-to-back (no rests) starting at t=0. This is the
 * exact same layout the MIDI renderer and the direct synthesizer use, so it
 * doubles as ground truth.
 */
export function melodyToTruth(melody: Melody, rootMidi: number): GroundTruth {
  const secPerBeat = 60 / melody.bpm;
  let t = 0;
  const notes = melody.notes.map((n) => {
    const durSec = n.beats * secPerBeat;
    const note = { onsetSec: t, durSec, midi: rootMidi + n.degree };
    t += durSec;
    return note;
  });
  return { bpm: melody.bpm, notes };
}
