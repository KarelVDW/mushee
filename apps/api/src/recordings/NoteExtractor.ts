import {
  NoteEventTime,
  noteFramesToTime,
  outputToNotesPoly,
} from '@spotify/basic-pitch';

const MAX_PITCH_JUMP_SEMITONES = 12;

export interface ExtractOptions {
  bpm: number;
  /** Quantization unit in beats. Defaults to a sixteenth note. */
  quantizeUnit?: number;
}

export interface ExtractedNotes {
  /** Notes straight out of basic-pitch, sorted but not merged or quantized. */
  raw: NoteEventTime[];
  /** Notes after merging overlaps and quantizing to the beat grid. */
  deduced: NoteEventTime[];
}

/**
 * Wraps basic-pitch's frame/onset/contour output into a stream of monophonic-ish
 * notes, applying the merging + quantization logic from converter/test.ts.
 */
export class NoteExtractor {
  extract(
    frames: number[][],
    onsets: number[][],
    options: ExtractOptions,
  ): ExtractedNotes {
    const rawNotes = outputToNotesPoly(frames, onsets, 0.25, 0.25, 5);
    const raw = noteFramesToTime(rawNotes);
    const sorted = [...raw].sort(
      (a, b) =>
        a.startTimeSeconds - b.startTimeSeconds || a.pitchMidi - b.pitchMidi,
    );
    const merged = this.merge(sorted);
    const deduced = this.quantize(merged, options);
    return { raw, deduced };
  }

  private merge(sortedNotes: NoteEventTime[]): NoteEventTime[] {
    let active: NoteEventTime | null = null;
    const result: NoteEventTime[] = [];
    for (const note of sortedNotes) {
      if (!active) {
        active = { ...note };
        continue;
      }
      if (note.startTimeSeconds === active.startTimeSeconds) {
        if (note.pitchMidi === active.pitchMidi) {
          active.durationSeconds = Math.max(
            active.durationSeconds,
            note.durationSeconds,
          );
        }
        continue;
      }
      if (
        note.pitchMidi === active.pitchMidi &&
        note.startTimeSeconds < active.startTimeSeconds + active.durationSeconds
      ) {
        active.durationSeconds =
          note.startTimeSeconds +
          note.durationSeconds -
          active.startTimeSeconds;
        continue;
      }
      if (
        Math.abs(note.pitchMidi - active.pitchMidi) > MAX_PITCH_JUMP_SEMITONES
      ) {
        continue;
      }
      result.push(active);
      active = { ...note };
    }
    if (active) result.push(active);
    return result;
  }

  private quantize(
    notes: NoteEventTime[],
    options: ExtractOptions,
  ): NoteEventTime[] {
    const unitSeconds = ((options.quantizeUnit ?? 0.25) * 60) / options.bpm;
    return notes.map((n) => {
      const start = Math.round(n.startTimeSeconds / unitSeconds) * unitSeconds;
      const dur = Math.max(
        unitSeconds,
        Math.round(n.durationSeconds / unitSeconds) * unitSeconds,
      );
      return { ...n, startTimeSeconds: start, durationSeconds: dur };
    });
  }
}
