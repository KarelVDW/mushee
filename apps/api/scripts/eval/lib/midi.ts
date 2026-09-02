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

/** One note read back out of a Standard MIDI File, in seconds. */
export interface MidiNote {
  onsetSec: number;
  durSec: number;
  midi: number;
}

/**
 * Minimal SMF reader (formats 0/1): note-on/off pairs from every track, tempo
 * map honoured, in seconds. Used to turn a corpus's reference MIDI (HumTrans)
 * into a prescribed melody; nothing more than that is parsed.
 */
export function parseMidiNotes(buf: Buffer): { notes: MidiNote[]; bpm: number } {
  if (buf.toString('latin1', 0, 4) !== 'MThd') throw new Error('not a MIDI file');
  const division = buf.readUInt16BE(12);
  if (division & 0x8000) throw new Error('SMPTE time division not supported');
  const nTracks = buf.readUInt16BE(10);
  let pos = 8 + buf.readUInt32BE(4);

  const readVlq = (): number => {
    let v = 0;
    for (;;) {
      const c = buf[pos];
      pos += 1;
      v = (v << 7) | (c & 0x7f);
      if (!(c & 0x80)) return v;
    }
  };

  // Absolute-tick events from every track, merged, then converted with the tempo map.
  const tempoChanges: { tick: number; usPerQuarter: number }[] = [];
  const events: { tick: number; on: boolean; midi: number }[] = [];
  for (let t = 0; t < nTracks && pos + 8 <= buf.length; t += 1) {
    if (buf.toString('latin1', pos, pos + 4) !== 'MTrk') throw new Error('bad track header');
    const len = buf.readUInt32BE(pos + 4);
    pos += 8;
    const end = pos + len;
    let tick = 0;
    let running = 0;
    while (pos < end) {
      tick += readVlq();
      let status = buf[pos];
      if (status & 0x80) {
        pos += 1;
        running = status;
      } else {
        status = running;
      }
      const type = status & 0xf0;
      if (status === 0xff) {
        const metaType = buf[pos];
        pos += 1;
        const l = readVlq();
        if (metaType === 0x51 && l === 3) {
          tempoChanges.push({ tick, usPerQuarter: buf.readUIntBE(pos, 3) });
        }
        pos += l;
      } else if (status === 0xf0 || status === 0xf7) {
        pos += readVlq();
      } else if (type === 0x90 || type === 0x80) {
        const midi = buf[pos];
        const vel = buf[pos + 1];
        pos += 2;
        events.push({ tick, on: type === 0x90 && vel > 0, midi });
      } else if (type === 0xa0 || type === 0xb0 || type === 0xe0) {
        pos += 2;
      } else if (type === 0xc0 || type === 0xd0) {
        pos += 1;
      } else {
        throw new Error(`unexpected MIDI status 0x${status.toString(16)}`);
      }
    }
    pos = end;
  }

  tempoChanges.sort((a, b) => a.tick - b.tick);
  if (!tempoChanges.length || tempoChanges[0].tick > 0) {
    tempoChanges.unshift({ tick: 0, usPerQuarter: 500000 });
  }
  const secondsAt = (tick: number): number => {
    let sec = 0;
    for (let i = 0; i < tempoChanges.length; i += 1) {
      const from = tempoChanges[i].tick;
      const to = i + 1 < tempoChanges.length ? Math.min(tick, tempoChanges[i + 1].tick) : tick;
      if (tick <= from) break;
      sec += ((to - from) / division) * (tempoChanges[i].usPerQuarter / 1e6);
    }
    return sec;
  };

  events.sort((a, b) => a.tick - b.tick || Number(a.on) - Number(b.on));
  const open = new Map<number, number>();
  const notes: MidiNote[] = [];
  for (const e of events) {
    if (e.on) {
      open.set(e.midi, e.tick);
    } else if (open.has(e.midi)) {
      const start = open.get(e.midi)!;
      open.delete(e.midi);
      const onsetSec = secondsAt(start);
      notes.push({ onsetSec, durSec: Math.max(0.01, secondsAt(e.tick) - onsetSec), midi: e.midi });
    }
  }
  notes.sort((a, b) => a.onsetSec - b.onsetSec);
  return { notes, bpm: Math.round(60e6 / tempoChanges[0].usPerQuarter) };
}
