// --- Internal types (used by the model and layout) ---

export type Clef = 'treble' | 'bass';
export type DurationType = 'w' | 'h' | 'q' | '8' | '16';
export type StemDirection = 'up' | 'down' | 'auto';
export type BarlineType = 'single' | 'double' | 'end' | 'none';

// --- MusicXML JSON types (input/output format, mirrors MusicXML 4.0) ---

export type MxmlStep = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G';
export type MxmlNoteType = 'whole' | 'half' | 'quarter' | 'eighth' | '16th';
export type MxmlStemValue = 'up' | 'down' | 'none' | 'double';
export type MxmlClefSign = 'G' | 'F' | 'C' | 'percussion' | 'TAB' | 'none';
export type MxmlStartStop = 'start' | 'stop';
export type MxmlBarStyle = 'regular' | 'light-light' | 'light-heavy' | 'none';
export type MxmlBeamValue = 'begin' | 'continue' | 'end' | 'forward hook' | 'backward hook';

export interface MxmlPitch {
  step: MxmlStep;
  alter?: number; // semitones: -1 = flat, 1 = sharp, -2 = double flat, 2 = double sharp
  octave: number;
}

export interface MxmlRest {
  measure?: boolean;
}

export interface MxmlTimeModification {
  actualNotes: number; // e.g. 3 for a triplet
  normalNotes: number; // e.g. 2 for a triplet
}

export interface MxmlTie {
  type: MxmlStartStop;
}

export interface MxmlBeam {
  number?: number; // 1-8, default 1
  value: MxmlBeamValue;
}

export interface MxmlNote {
  _type: 'note';
  pitch?: MxmlPitch;
  rest?: MxmlRest;
  duration: number; // in divisions
  tie?: MxmlTie[];
  voice?: string;
  type?: MxmlNoteType;
  dot?: number; // count of <dot> elements
  stem?: MxmlStemValue;
  staff?: number;
  timeModification?: MxmlTimeModification;
  beam?: MxmlBeam[];
}

export interface MxmlKey {
  fifths: number; // negative = flats, positive = sharps
  mode?: string;  // 'major' | 'minor' etc.
}

export interface MxmlTime {
  beats: string;    // e.g. '4', '3+2'
  beatType: string; // e.g. '4', '8'
}

export interface MxmlClef {
  sign: MxmlClefSign;
  line?: number;
  number?: number; // staff number
}

export interface MxmlAttributes {
  _type: 'attributes';
  divisions?: number;
  key?: MxmlKey[];
  time?: MxmlTime[];
  staves?: number;
  clef?: MxmlClef[];
}

export interface MxmlBarline {
  _type: 'barline';
  location?: 'left' | 'right' | 'middle';
  barStyle?: MxmlBarStyle;
}

export interface MxmlDirection {
  _type: 'direction';
  sound?: { tempo?: number };
}

export interface MxmlBackup {
  _type: 'backup';
  duration: number;
}

export interface MxmlForward {
  _type: 'forward';
  duration: number;
  voice?: string;
  staff?: number;
}

export type MxmlMeasureEntry = MxmlNote | MxmlAttributes | MxmlBarline | MxmlDirection | MxmlBackup | MxmlForward;

export interface MxmlMeasure {
  number: string;
  entries: MxmlMeasureEntry[];
}

export interface MxmlScorePart {
  id: string;
  partName: string;
}

export interface MxmlPartList {
  scoreParts: MxmlScorePart[];
}

export interface MxmlPart {
  id: string;
  measures: MxmlMeasure[];
}

export interface ScorePartwise {
  partList: MxmlPartList;
  parts: MxmlPart[];
}

// --- Layout output types (pre-computed positions for rendering) ---

export interface LayoutLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface LayoutGlyph {
  glyphName: string;
  x: number;
  y: number;
}

export interface LayoutTimeSignature {
  top: LayoutGlyph[];
  bottom: LayoutGlyph[];
}


export interface LayoutBarline {
  x: number;
  y: number;
  height: number;
  type: BarlineType;
}

