/**
 * A detected note event on the raw performance timeline.
 *
 * Historically imported from `@spotify/basic-pitch`; the shape outlived the
 * provider (removed 2026-08-22 — see the eval README's provider-consolidation
 * logs) because every segmenter, cleanup step and the MusicXML builder speak
 * it.
 */
export interface NoteEventTime {
    startTimeSeconds: number
    durationSeconds: number
    pitchMidi: number
    /**
     * Note SALIENCE: the provider's peak per-frame confidence (0–1) on every
     * current producer — not a level measurement (the name is basic-pitch's).
     * Under reverb the two part ways: confidence collapses while level does not.
     */
    amplitude: number
    /**
     * The unrounded contour pitch (MIDI, A=440), consumed only by notation
     * spelling (voice-notation.ts) — and read only when the locked profile routes
     * voice. The instrument segmenters attach it too (E1), but `MxmlBuilder` does
     * not spell instrument takes today. Every note-rewriting step spread-copies,
     * so it survives the extractor; field-by-field copies must carry it explicitly.
     */
    pitchMidiFloat?: number
    /**
     * Where the PERFORMED note behind a quantised note ends, in seconds — set by
     * `NoteExtractor.quantize` on the notes it writes, absent on raw notes. The
     * written length is floor-snapped to a standard value (whole note at most),
     * so it can end long before the sound does; the streaming commit
     * (`RecordingPipeline.emitFromExtracted`) waits on this end too, because a
     * note committed while it still sounds is never lengthened afterwards.
     */
    performedEndSeconds?: number
}
