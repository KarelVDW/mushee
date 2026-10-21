/**
 * The MusicXML-JSON wire format: the score document the API stores and the editor
 * saves, loads and streams. Field names mirror MusicXML 4.0 elements (camelCased,
 * `_type` naming the entry element); ScoreSerializer writes it, ScoreDeserializer
 * reads it, and the file codecs translate it to and from real MusicXML.
 */
import type { BarlineType, DurationType } from '../../components/types'

/** Divisions per quarter note in every document the editor writes. */
export const DIVISIONS = 12

// --- MusicXML JSON types (input/output format, the subset Solkey stores) ---

export type MxmlStep = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G'
export type MxmlNoteType = 'whole' | 'half' | 'quarter' | 'eighth' | '16th'
export type MxmlClefSign = 'G' | 'F' | 'C' | 'percussion' | 'TAB' | 'none'
export type MxmlStartStop = 'start' | 'stop'
export type MxmlBarStyle = 'regular' | 'light-light' | 'light-heavy' | 'none'

/** The `<type>` each model note value is written as. */
export const MXML_NOTE_TYPE: Record<DurationType, MxmlNoteType> = { w: 'whole', h: 'half', q: 'quarter', '8': 'eighth', '16': '16th' }

/** The model note value of each `<type>` — the inverse of MXML_NOTE_TYPE. */
export const DURATION_TYPE: Record<MxmlNoteType, DurationType> = { whole: 'w', half: 'h', quarter: 'q', eighth: '8', '16th': '16' }

/** The `<bar-style>` each model barline is written as. */
export const BAR_STYLE: Record<BarlineType, MxmlBarStyle> = { single: 'regular', double: 'light-light', end: 'light-heavy', none: 'none' }

/** The model barline of each `<bar-style>` — the inverse of BAR_STYLE. */
export const BARLINE_TYPE: Record<MxmlBarStyle, BarlineType> = {
    regular: 'single',
    'light-light': 'double',
    'light-heavy': 'end',
    none: 'none',
}

export interface MxmlPitch {
    step: MxmlStep
    alter?: number // semitones: -1 = flat, 1 = sharp, -2 = double flat, 2 = double sharp
    octave: number
}

/** `<rest/>` — stored without attributes. */
export type MxmlRest = Record<never, never>

export interface MxmlTimeModification {
    actualNotes: number // e.g. 3 for a triplet
    normalNotes: number // e.g. 2 for a triplet
}

export interface MxmlTie {
    type: MxmlStartStop
}

export interface MxmlNote {
    _type: 'note'
    pitch?: MxmlPitch
    rest?: MxmlRest
    duration: number // in divisions
    tie?: MxmlTie[]
    voice?: string
    type?: MxmlNoteType
    dot?: number // count of <dot> elements
    timeModification?: MxmlTimeModification
}

export interface MxmlKey {
    fifths: number // negative = flats, positive = sharps
    mode?: string // 'major' | 'minor' etc.
}

export interface MxmlTime {
    beats: string // e.g. '4', '3+2'
    beatType: string // e.g. '4', '8'
}

export interface MxmlClef {
    sign: MxmlClefSign
    line?: number
    clefOctaveChange?: number // +1 = 8va, -1 = 8vb, +2 = 15ma, -2 = 15mb
}

export interface MxmlTranspose {
    /** Semitones: written + chromatic = sounding. Trumpet B♭ = -2, French Horn = -7, Piccolo = +12 (or 0 with octave-change=1). */
    chromatic: number
    /** Letter steps shifted: written + diatonic = sounding (in step-space). Trumpet B♭ = -1. */
    diatonic?: number
    /** Additional whole-octave shift on top of chromatic/diatonic. Piccolo = 1, Contrabass = -1. */
    octaveChange?: number
}

export interface MxmlAttributes {
    _type: 'attributes'
    divisions?: number
    key?: MxmlKey[]
    time?: MxmlTime[]
    clef?: MxmlClef[]
    transpose?: MxmlTranspose
}

export interface MxmlBarline {
    _type: 'barline'
    location?: 'left' | 'right' | 'middle'
    barStyle?: MxmlBarStyle
}

export interface MxmlDirection {
    _type: 'direction'
    /** The written metronome mark (`♩. = 60`); `sound.tempo` carries the same tempo in quarter-note bpm. */
    metronome?: { beatUnit: MxmlNoteType; beatUnitDots: number; perMinute: number }
    sound?: { tempo?: number }
}

export type MxmlMeasureEntry = MxmlNote | MxmlAttributes | MxmlBarline | MxmlDirection

export interface MxmlMeasure {
    number: string
    entries: MxmlMeasureEntry[]
}

export interface MxmlScoreInstrument {
    id: string
    instrumentName: string
}

export interface MxmlMidiInstrument {
    id: string
    /** 1-indexed General MIDI program (MusicXML convention). */
    midiProgram: number
}

export interface MxmlScorePart {
    id: string
    partName: string
    scoreInstrument?: MxmlScoreInstrument
    midiInstrument?: MxmlMidiInstrument
}

export interface MxmlPartList {
    scoreParts: MxmlScorePart[]
}

export interface MxmlPart {
    id: string
    measures: MxmlMeasure[]
}

export interface ScorePartwise {
    partList: MxmlPartList
    parts: MxmlPart[]
}
