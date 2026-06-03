/**
 * Minimal Standard MIDI File (format 0) writer. No dependencies.
 *
 * Emits a single track: a program-change for the chosen GM instrument followed
 * by sequential note-on/note-off pairs. Sufficient for rendering monophonic
 * melodies through fluidsynth.
 */

import type { Melody } from '../types';

const TICKS_PER_QUARTER = 480;

/** Variable-length quantity encoding used by MIDI delta times. */
function vlq(value: number): number[] {
  const bytes = [value & 0x7f];
  let v = value >> 7;
  while (v > 0) {
    bytes.unshift((v & 0x7f) | 0x80);
    v >>= 7;
  }
  return bytes;
}

function u32(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

function u16(value: number): number[] {
  return [(value >>> 8) & 0xff, value & 0xff];
}

/**
 * Build an SMF for `melody` transposed so degree 0 = `rootMidi`, played on GM
 * `program`. Velocity is fixed; tempo comes from the melody's bpm.
 */
export function melodyToMidi(
  melody: Melody,
  rootMidi: number,
  program: number,
): Buffer {
  const events: number[] = [];
  const microsPerQuarter = Math.round(60_000_000 / melody.bpm);

  // Tempo meta event (delta 0).
  events.push(
    ...vlq(0),
    0xff,
    0x51,
    0x03,
    (microsPerQuarter >> 16) & 0xff,
    (microsPerQuarter >> 8) & 0xff,
    microsPerQuarter & 0xff,
  );
  // Program change on channel 0 (delta 0).
  events.push(...vlq(0), 0xc0, program & 0x7f);

  // Detach successive notes: sound for most of the slot, rest the remainder,
  // so each note has a distinct onset (a real player rarely plays perfectly
  // legato). The rest is carried as the delta on the next note-on, so note
  // onsets — and therefore the ground truth — are unchanged.
  let pendingGap = 0;
  for (const note of melody.notes) {
    const midi = Math.max(0, Math.min(127, rootMidi + note.degree));
    const durTicks = Math.round(note.beats * TICKS_PER_QUARTER);
    const gap = Math.min(Math.round(durTicks * 0.2), 80);
    const sound = Math.max(1, durTicks - gap);
    events.push(...vlq(pendingGap), 0x90, midi, 96); // note on
    events.push(...vlq(sound), 0x80, midi, 0); // note off
    pendingGap = gap;
  }
  // End of track.
  events.push(...vlq(0), 0xff, 0x2f, 0x00);

  const trackHeader = [0x4d, 0x54, 0x72, 0x6b, ...u32(events.length)];
  const header = [
    0x4d,
    0x54,
    0x68,
    0x64,
    ...u32(6),
    ...u16(0), // format 0
    ...u16(1), // one track
    ...u16(TICKS_PER_QUARTER),
  ];
  return Buffer.from([...header, ...trackHeader, ...events]);
}
