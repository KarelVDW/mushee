import { BravuraFont } from './bravura_glyphs'
import { GLYPH_SCALE } from './GlyphScale'

type OutlineCommand = 'm' | 'l' | 'q' | 'b' | 'z'

/** Coordinates each VexFlow outline command takes (x, y pairs). */
const ARITY: Record<OutlineCommand, number> = { m: 2, l: 2, q: 4, b: 6, z: 0 }
/** The SVG path command each outline command becomes. */
const SVG_COMMAND: Record<OutlineCommand, string> = { m: 'M', l: 'L', q: 'Q', b: 'C', z: 'Z' }

/**
 * Glyph metrics and outlines of the Bravura (SMuFL) font. The layout engine measures
 * glyphs through `width`, the renderer draws them through `svgPath`; both read the font's
 * VexFlow compact outlines through one tokenizer and cache what they derive.
 *
 * VexFlow outline format, in font units with y pointing up:
 *   m x y                   — moveTo
 *   l x y                   — lineTo
 *   q eX eY cX cY           — quadratic bezier (endpoint first, then control point)
 *   b eX eY c1X c1Y c2X c2Y — cubic bezier (endpoint first, then control points)
 *   z                       — closePath
 */
export class Bravura {
    /** Outline widths in font units, per glyph. */
    private static readonly widths = new Map<string, number>()
    /** SVG path data, per glyph and scale. */
    private static readonly paths = new Map<string, string>()

    /** The visual width of a glyph in pixels, from its outline's horizontal extent. */
    static width(name: string, scale: number = GLYPH_SCALE): number {
        let width = Bravura.widths.get(name)
        if (width === undefined) {
            const outline = Bravura.outline(name)
            if (outline === undefined) throw new Error(`Bravura has no glyph named "${name}"`)
            let xMin = Infinity
            let xMax = -Infinity
            for (const { coordinates } of Bravura.commands(outline)) {
                for (let i = 0; i < coordinates.length; i += 2) {
                    if (coordinates[i] < xMin) xMin = coordinates[i]
                    if (coordinates[i] > xMax) xMax = coordinates[i]
                }
            }
            width = xMax - xMin
            Bravura.widths.set(name, width)
        }
        return width * scale
    }

    /**
     * The glyph as an SVG path `d` attribute at `scale`, or '' for a glyph the font lacks.
     * SVG lists control points before the endpoint, so q/b coordinates are reordered, and
     * y is negated (font units are y-up, SVG is y-down).
     */
    static svgPath(name: string, scale: number = GLYPH_SCALE): string {
        const key = `${name}@${scale}`
        let path = Bravura.paths.get(key)
        if (path === undefined) {
            const outline = Bravura.outline(name)
            path = outline
                ? Bravura.commands(outline)
                      .map(({ command, coordinates }) => Bravura.svgSegment(command, coordinates, scale))
                      .join(' ')
                : ''
            Bravura.paths.set(key, path)
        }
        return path
    }

    private static outline(name: string): string | undefined {
        return (BravuraFont.glyphs as Record<string, { o: string } | undefined>)[name]?.o
    }

    /** The outline's commands with their coordinates, in font units; unknown tokens are skipped. */
    private static commands(outline: string): Array<{ command: OutlineCommand; coordinates: number[] }> {
        const parts = outline.split(' ')
        const commands: Array<{ command: OutlineCommand; coordinates: number[] }> = []
        let i = 0
        while (i < parts.length) {
            const token = parts[i++]
            if (!Object.hasOwn(ARITY, token)) continue
            const command = token as OutlineCommand
            const coordinates = parts.slice(i, i + ARITY[command]).map((part) => parseFloat(part))
            i += ARITY[command]
            commands.push({ command, coordinates })
        }
        return commands
    }

    private static svgSegment(command: OutlineCommand, coordinates: number[], scale: number): string {
        const points: string[] = []
        for (let i = 0; i < coordinates.length; i += 2) points.push(`${coordinates[i] * scale} ${-coordinates[i + 1] * scale}`)
        // The outline gives a curve's endpoint first; SVG wants it last.
        if (command === 'q' || command === 'b') points.push(points.shift() as string)
        return [SVG_COMMAND[command], ...points].join(' ')
    }
}
