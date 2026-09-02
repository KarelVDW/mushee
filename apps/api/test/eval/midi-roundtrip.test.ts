import { describe, expect, it } from 'vitest';

import { melodyToMidi, parseMidiNotes } from '../../scripts/eval/lib/midi';
import type { Melody } from '../../scripts/eval/types';

/**
 * The harness's MIDI reader turns a corpus's reference MIDI (HumTrans) into a
 * prescribed melody. Its writer has been rendering the synthetic corpus for
 * months, so a write→read round trip pins the reader against timing conventions
 * that are already trusted: ticks per quarter, the tempo meta event, note-on /
 * note-off pairing, and seconds.
 */
const melody: Melody = {
  name: 'roundtrip',
  bpm: 90,
  notes: [
    { degree: 0, beats: 1 },
    { degree: 4, beats: 0.5 },
    { degree: 7, beats: 1.5 },
    { degree: 12, beats: 2 },
  ],
};

describe('parseMidiNotes', () => {
  it('reads back what melodyToMidi wrote, in seconds', () => {
    const { notes, bpm } = parseMidiNotes(melodyToMidi(melody, 60, 0));
    expect(bpm).toBe(90);
    expect(notes.map((n) => n.midi)).toEqual([60, 64, 67, 72]);
    const secPerBeat = 60 / 90;
    const expectedOnsets = [0, 1, 1.5, 3].map((b) => b * secPerBeat);
    notes.forEach((n, i) => expect(n.onsetSec).toBeCloseTo(expectedOnsets[i], 3));
    // Durations may be shortened by the writer's inter-note gap; they must never
    // exceed the written value and must stay positive.
    notes.forEach((n, i) => {
      expect(n.durSec).toBeGreaterThan(0);
      expect(n.durSec).toBeLessThanOrEqual(melody.notes[i].beats * secPerBeat + 1e-6);
    });
  });

  it('rejects non-MIDI input', () => {
    expect(() => parseMidiNotes(Buffer.from('RIFF....WAVE'))).toThrow(/not a MIDI file/);
  });
});
