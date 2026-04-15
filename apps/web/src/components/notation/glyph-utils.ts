import { BravuraFont } from '../../origin/fonts/bravura_glyphs'
import { GLYPH_SCALE } from './constants'

/**
 * Convert a VexFlow compact outline string to an SVG path `d` attribute.
 *
 * VexFlow outline format:
 *   m x y           — moveTo
 *   l x y           — lineTo
 *   q eX eY cX cY   — quadratic bezier (endpoint first, then control point)
 *   b eX eY c1X c1Y c2X c2Y — cubic bezier (endpoint first, then control points)
 *   z               — closePath
 *
 * SVG path format expects control points before endpoints, so q/b args are reordered.
 * Y values are negated (font units are Y-up, SVG is Y-down).
 */
export function outlineToSvgPath(outline: string, scale: number): string {
    const parts = outline.split(' ')
    const segments: string[] = []
    let i = 0

    while (i < parts.length) {
        const cmd = parts[i++]

        switch (cmd) {
            case 'm': {
                const x = parseFloat(parts[i++]) * scale
                const y = -parseFloat(parts[i++]) * scale
                segments.push(`M ${x} ${y}`)
                break
            }
            case 'l': {
                const x = parseFloat(parts[i++]) * scale
                const y = -parseFloat(parts[i++]) * scale
                segments.push(`L ${x} ${y}`)
                break
            }
            case 'q': {
                // VexFlow: endpoint first (eX eY), then control point (cX cY)
                // SVG Q: control point first, then endpoint
                const eX = parseFloat(parts[i++]) * scale
                const eY = -parseFloat(parts[i++]) * scale
                const cX = parseFloat(parts[i++]) * scale
                const cY = -parseFloat(parts[i++]) * scale
                segments.push(`Q ${cX} ${cY} ${eX} ${eY}`)
                break
            }
            case 'b': {
                // VexFlow: endpoint first (eX eY), then cp1 (c1X c1Y), then cp2 (c2X c2Y)
                // SVG C: cp1 first, then cp2, then endpoint
                const eX = parseFloat(parts[i++]) * scale
                const eY = -parseFloat(parts[i++]) * scale
                const c1X = parseFloat(parts[i++]) * scale
                const c1Y = -parseFloat(parts[i++]) * scale
                const c2X = parseFloat(parts[i++]) * scale
                const c2Y = -parseFloat(parts[i++]) * scale
                segments.push(`C ${c1X} ${c1Y} ${c2X} ${c2Y} ${eX} ${eY}`)
                break
            }
            case 'z':
                segments.push('Z')
                break
            default:
                // skip unknown tokens
                break
        }
    }

    return segments.join(' ')
}

/** Cached visual outline widths in font units (parsed once per glyph). */
const outlineWidthCache = new Map<string, number>()

function getOutlineWidth(name: string): number {
    let w = outlineWidthCache.get(name)
    if (w !== undefined) return w

    const glyph = BravuraFont.glyphs[name as keyof typeof BravuraFont.glyphs]
    const parts = glyph.o.split(' ')

    let xMin = Infinity
    let xMax = -Infinity

    let i = 0
    while (i < parts.length) {
        switch (parts[i++]) {
            case 'm':
            case 'l': {
                const x = parseFloat(parts[i++])
                i++ // skip y
                if (x < xMin) xMin = x
                if (x > xMax) xMax = x
                break
            }
            case 'q': {
                const eX = parseFloat(parts[i++]); i++
                const cX = parseFloat(parts[i++]); i++
                if (eX < xMin) xMin = eX; if (eX > xMax) xMax = eX
                if (cX < xMin) xMin = cX; if (cX > xMax) xMax = cX
                break
            }
            case 'b': {
                const eX = parseFloat(parts[i++]); i++
                const c1X = parseFloat(parts[i++]); i++
                const c2X = parseFloat(parts[i++]); i++
                if (eX < xMin) xMin = eX; if (eX > xMax) xMax = eX
                if (c1X < xMin) xMin = c1X; if (c1X > xMax) xMax = c1X
                if (c2X < xMin) xMin = c2X; if (c2X > xMax) xMax = c2X
                break
            }
        }
    }

    w = xMax - xMin
    outlineWidthCache.set(name, w)
    return w
}

/** Get the visual rendered width of a glyph in pixels (from outline bounds). */
export function getGlyphWidth(name: string, scale: number = GLYPH_SCALE): number {
    return getOutlineWidth(name) * scale
}

