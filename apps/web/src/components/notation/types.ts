// --- Input types (declarative score description) ---

export type Clef = 'treble' | 'bass';
export type Duration = 'w' | 'h' | 'q' | '8' | '16';
export type StemDirection = 'up' | 'down' | 'auto';

export interface NoteInput {
  keys: string[]; // e.g. ['C#/5'], ['B/4']
  duration: Duration;
}

export interface VoiceInput {
  notes: NoteInput[];
  stem?: StemDirection;
}

export interface StaveInput {
  clef?: Clef;
  timeSignature?: string; // e.g. '4/4', '3/4'
  voices: VoiceInput[];
}

export interface ScoreInput {
  staves: StaveInput[];
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

export interface LayoutStave {
  x: number;
  y: number;
  width: number;
  staffLines: LayoutLine[];
  clef?: LayoutGlyph;
  timeSignature?: LayoutTimeSignature;
  notes: LayoutNote[];
}

export interface LayoutResult {
  width: number;
  height: number;
  staves: LayoutStave[];
}
