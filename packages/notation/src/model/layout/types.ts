// The layout engine's output primitives: positions pre-computed for the renderer.

import type { BarlineType } from '../types'

export interface LayoutGlyph {
    glyphName: string
    x: number
    y: number
    /** Glyph scale when it differs from the default engraving scale. */
    scale?: number
}

export interface LayoutLine {
    x1: number
    y1: number
    x2: number
    y2: number
}

export interface LayoutStem {
    x: number
    y1: number
    y2: number
}

/** A beam line and its thickness, signed by stem direction (positive for stems up). */
export type LayoutBeamSegment = LayoutLine & { thickness: number }

export interface LayoutBarline {
    x: number
    y: number
    height: number
    type: BarlineType
}
