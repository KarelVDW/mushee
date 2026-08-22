/**
 * A detected note event on the raw performance timeline.
 *
 * Historically imported from `@spotify/basic-pitch`; the shape outlived the
 * provider (removed 2026-08-22 — see the eval README's provider-consolidation
 * logs) because every segmenter, cleanup step and the MusicXML builder speak
 * it. `pitchBends` is kept for compatibility with note-level providers; no
 * current producer emits it.
 */
export interface NoteEventTime {
  startTimeSeconds: number;
  durationSeconds: number;
  pitchMidi: number;
  amplitude: number;
  pitchBends?: number[];
}
