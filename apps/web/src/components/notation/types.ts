// --- Input types (declarative score description) ---

export type Clef = 'treble' | 'bass';
export type Duration = 'w' | 'h' | 'q' | '8' | '16';
export type StemDirection = 'up' | 'down' | 'auto';
export type BarlineType = 'single' | 'double' | 'end' | 'none';

export interface NoteInput {
  keys: string[]; // e.g. ['C#/5'], ['B/4']
  duration: Duration;
}

export interface VoiceInput {
  notes: NoteInput[];
  stem?: StemDirection;
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

export interface LayoutMeasure {
  x: number;
  width: number;
  clef?: LayoutGlyph;
  timeSignature?: LayoutTimeSignature;
  notes: LayoutNote[];
  beams: LayoutBeamSegment[][];
}

export interface LayoutResult {
  width: number;
  height: number;
  staffLines: LayoutLine[];
  measures: LayoutMeasure[];
  barlines: LayoutBarline[];
}
