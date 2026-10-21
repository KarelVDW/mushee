/**
 * The MusicXML-JSON the recording pipeline emits: notes (pitched or rest) and
 * one attributes entry with divisions and time — the recorder-emitted subset of
 * the editor's wire format, packages/notation/src/model/io/MusicXml.ts (same
 * names, fewer shapes and fields). Hand-kept because the API's CommonJS build
 * cannot consume the notation package's TS source; the compile-time pin in
 * test/recordings/recording-editor-contract.test.ts fails `tsc` if this drifts
 * from being assignable to the editor's types. Replaced by a type import in the
 * compiled-notation follow-up.
 */

export type MxmlStep = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G'
export type MxmlNoteType = 'whole' | 'half' | 'quarter' | 'eighth' | '16th'
export type MxmlStartStop = 'start' | 'stop'

export interface MxmlPitch {
    step: MxmlStep
    alter?: number
    octave: number
}

/** `<rest/>` — emitted without attributes. */
export type MxmlRest = Record<never, never>

export interface MxmlTie {
    type: MxmlStartStop
}

export interface MxmlNote {
    _type: 'note'
    pitch?: MxmlPitch
    rest?: MxmlRest
    duration: number
    tie?: MxmlTie[]
    voice?: string
    type?: MxmlNoteType
    dot?: number
}

export interface MxmlTime {
    beats: string
    beatType: string
}

export interface MxmlAttributes {
    _type: 'attributes'
    divisions?: number
    time?: MxmlTime[]
}

export type MxmlMeasureEntry = MxmlNote | MxmlAttributes

export interface MxmlMeasure {
    number: string
    entries: MxmlMeasureEntry[]
}
