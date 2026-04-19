export type MxmlStep = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G';
export type MxmlNoteType = 'whole' | 'half' | 'quarter' | 'eighth' | '16th';
export type MxmlClefSign = 'G' | 'F' | 'C' | 'percussion' | 'TAB' | 'none';
export type MxmlStartStop = 'start' | 'stop';
export type MxmlBarStyle = 'regular' | 'light-light' | 'light-heavy' | 'none';

export interface MxmlPitch {
  step: MxmlStep;
  alter?: number;
  octave: number;
}

export interface MxmlRest {
  measure?: boolean;
}

export interface MxmlTie {
  type: MxmlStartStop;
}

export interface MxmlNote {
  _type: 'note';
  pitch?: MxmlPitch;
  rest?: MxmlRest;
  duration: number;
  tie?: MxmlTie[];
  voice?: string;
  type?: MxmlNoteType;
  dot?: number;
}

export interface MxmlKey {
  fifths: number;
  mode?: string;
}

export interface MxmlTime {
  beats: string;
  beatType: string;
}

export interface MxmlClef {
  sign: MxmlClefSign;
  line?: number;
  number?: number;
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

export type MxmlMeasureEntry =
  | MxmlNote
  | MxmlAttributes
  | MxmlBarline
  | MxmlDirection;

export interface MxmlMeasure {
  number: string;
  entries: MxmlMeasureEntry[];
}
