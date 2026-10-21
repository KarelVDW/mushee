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
    amplitude: number
    /**
     * The unrounded contour pitch (MIDI, A=440), consumed only by notation
     * spelling (voice-notation.ts). Every note-rewriting step spread-copies, so
     * it survives the extractor; field-by-field copies must carry it explicitly.
     */
    pitchMidiFloat?: number
}
