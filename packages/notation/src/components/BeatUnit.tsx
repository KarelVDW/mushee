'use client'

import type { Duration } from '../model/Duration'
import { DOT_RADIUS, DOTTED_FLAG_SCALE, GLYPH_SCALE, NOTATION_INK } from './constants'
import { Glyph } from './Glyph'
import { getGlyphWidth } from './glyphUtils'

const STEM_HEIGHT = 14
const STEM_WIDTH = 1.2
const DOT_GAP = 3

/** Horizontal extent of `BeatUnit` for `duration`, so text can follow the glyph. */
export function beatUnitWidth(duration: Duration): number {
    const notehead = getGlyphWidth(duration.noteheadGlyph, GLYPH_SCALE)
    const flag = duration.flagGlyph('up')
    const flagWidth = flag ? getGlyphWidth(flag, duration.dots > 0 ? DOTTED_FLAG_SCALE : GLYPH_SCALE) : 0
    return Math.max(notehead, flagWidth) + duration.dots * (DOT_GAP + 2 * DOT_RADIUS)
}

/**
 * A small stem-up note standing for a beat value — the note in a metronome
 * mark (`♩. = 60`). Drawn at the origin with the notehead centre on y = 0, in
 * the score's glyph scale; wrap it in a translated `<g>` or a sized `<svg>`.
 */
export function BeatUnit({ duration, fill = NOTATION_INK }: { duration: Duration; fill?: string }) {
    const noteheadWidth = getGlyphWidth(duration.noteheadGlyph, GLYPH_SCALE)
    const stemX = noteheadWidth - STEM_WIDTH / 2
    const stemTop = -STEM_HEIGHT
    const flag = duration.flagGlyph('up')
    let dotX = noteheadWidth + DOT_GAP + DOT_RADIUS
    return (
        <g>
            <Glyph name={duration.noteheadGlyph} x={0} y={0} fill={fill} />
            {duration.type !== 'w' && <line x1={stemX} y1={0} x2={stemX} y2={stemTop} stroke={fill} strokeWidth={STEM_WIDTH} />}
            {flag && <Glyph name={flag} x={stemX} y={stemTop} scale={duration.dots > 0 ? DOTTED_FLAG_SCALE : GLYPH_SCALE} fill={fill} />}
            {Array.from({ length: duration.dots }, (_, i) => {
                const cx = dotX
                dotX += DOT_GAP + 2 * DOT_RADIUS
                return <circle key={i} cx={cx} cy={-DOT_RADIUS} r={DOT_RADIUS} fill={fill} />
            })}
        </g>
    )
}
