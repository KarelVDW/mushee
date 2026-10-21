// --- Internal types (used by the model and layout) ---

export type ClefSign = 'G' | 'F' | 'C'
export type ClefType =
    // G (treble) family
    | 'treble'
    | 'treble8va'
    | 'treble8vb'
    | 'treble15ma'
    | 'treble15mb'
    // C family
    | 'soprano'
    | 'mezzoSoprano'
    | 'alto'
    | 'tenor'
    | 'baritoneC'
    // F (bass) family
    | 'baritoneF'
    | 'bass'
    | 'bass8va'
    | 'bass8vb'
    | 'bass15ma'
    | 'bass15mb'
    | 'subBass'
export type DurationType = 'w' | 'h' | 'q' | '8' | '16'
export type StemDirection = 'up' | 'down' | 'auto'
export type BarlineType = 'single' | 'double' | 'end' | 'none'
export type TieType = 'start' | 'stop' | 'start-stop'

// --- Layout output types (pre-computed positions for rendering) ---

export interface LayoutLine {
    x1: number
    y1: number
    x2: number
    y2: number
}

export interface LayoutGlyph {
    glyphName: string
    x: number
    y: number
}

export interface LayoutTimeSignature {
    top: LayoutGlyph[]
    bottom: LayoutGlyph[]
}

export interface LayoutBarline {
    x: number
    y: number
    height: number
    type: BarlineType
}
