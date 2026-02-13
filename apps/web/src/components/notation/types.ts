// --- Input types (declarative score description) ---

export type Clef = 'treble' | 'bass';
export type Duration = 'w' | 'h' | 'q' | '8' | '16';
export type StemDirection = 'up' | 'down' | 'auto';
export type BarlineType = 'single' | 'double' | 'end' | 'none';

export interface NoteInput {
  keys: string[]; // e.g. ['C#/5'], ['B/4']
  duration: Duration;
  dots?: number; // 1 = dotted, 2 = double-dotted
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

export interface LayoutNote {
  x: number;
  y: number;
  glyphName: string;
  accidental?: LayoutGlyph;
  stem?: { x: number; y1: number; y2: number };
  flag?: LayoutGlyph;
  dots?: { x: number; y: number }[];
  ledgerLines: LayoutLine[];
}

export interface LayoutTimeSignature {
  top: LayoutGlyph[];
  bottom: LayoutGlyph[];
}

/** A single beam line (filled parallelogram) */
export interface LayoutBeamSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  thickness: number;
}

export interface LayoutBarline {
  x: number;
  y: number;
  height: number;
  type: BarlineType;
}

export interface LayoutTuplet {
  x1: number;
  x2: number;
  y: number;
  location: 1 | -1; // 1 = above, -1 = below
  numberGlyphs: LayoutGlyph[];
  bracketed: boolean;
}

export interface LayoutMeasure {
  x: number;
  width: number;
  clef?: LayoutGlyph;
  timeSignature?: LayoutTimeSignature;
  notes: LayoutNote[];
  beams: LayoutBeamSegment[][];
  tuplets: LayoutTuplet[];
}

export interface LayoutResult {
  width: number;
  height: number;
  staffLines: LayoutLine[];
  measures: LayoutMeasure[];
  barlines: LayoutBarline[];
}
