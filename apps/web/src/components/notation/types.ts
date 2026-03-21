// --- Input types (declarative score description) ---

export type Clef = 'treble' | 'bass';
export type DurationType = 'w' | 'h' | 'q' | '8' | '16';
export type StemDirection = 'up' | 'down' | 'auto';
export type BarlineType = 'single' | 'double' | 'end' | 'none';

export interface NoteInput {
  keys: Array<{ name: string; accidental?: string | undefined; octave: number }>; // e.g. ['C#/5'], ['B/4']
  duration: DurationType;
  dots?: number; // 1 = dotted, 2 = double-dotted
  tie?: boolean; // tie this note to the next note event
  tempo?: number; // BPM value; if present, a tempo marking is shown above this note
}

export interface TupletInput {
  startIndex: number; // first note index in voice.notes
  count: number; // number of notes in the tuplet
  notesOccupied?: number; // time denominator, defaults to 2
  showRatio?: boolean; // show "3:2" instead of just "3"
}

export interface VoiceInput {
  notes: NoteInput[];
  stem?: StemDirection;
  tuplets?: TupletInput[];
}

export interface MeasureInput {
  clef?: Clef;
  timeSignature?: string; // e.g. '4/4', '3/4'
  voices: VoiceInput[];
  endBarline?: BarlineType; // default: 'single'
}

export interface ScoreInput {
  measures: MeasureInput[];
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

