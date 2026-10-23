import { Glyph } from '@mushee/notation/components'
import { BARLINE_GAP, BARLINE_THICK_WIDTH, BARLINE_THIN_WIDTH, NUM_STAFF_LINES } from '@mushee/notation/engraving/constants'
import { GLYPH_SCALE } from '@mushee/notation/engraving/GlyphScale'

const WIDTH = 160
const HEIGHT = 40
/** Staff spacing of the mark: 8px, so the five lines fill the 40px height with 4px to spare. */
const SPACE = 8
const STAFF_TOP = (HEIGHT - (NUM_STAFF_LINES - 1) * SPACE) / 2
/** The engraver's glyph scale is set for 10px staff spaces; this staff is a size smaller. */
const SCALE = GLYPH_SCALE * (SPACE / 10)
/** The final barline at the right edge: the thick stroke, then the thin one BARLINE_GAP before it. */
const THICK_X = WIDTH - BARLINE_THICK_WIDTH
const THIN_X = THICK_X - BARLINE_GAP - BARLINE_THIN_WIDTH
/** The whole rest's width at this scale (Bravura's restWhole is 406 font units wide), centred in the bar. */
const REST_WIDTH = 406 * SCALE

/**
 * The missing-score mark: one empty bar — five quiet `outline_variant` staff lines closed by a
 * final barline, with a whole rest hanging from the fourth line in notation ink. A bar of
 * silence says "nothing here" without reading as a fault. Decorative.
 */
export function RestBarMark() {
    const lineY = (index: number) => STAFF_TOP + index * SPACE + 0.5
    return (
        <svg aria-hidden width={WIDTH} height={HEIGHT} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} xmlns="http://www.w3.org/2000/svg">
            {Array.from({ length: NUM_STAFF_LINES }, (_, i) => (
                <line key={i} x1={0} x2={THIN_X + BARLINE_THIN_WIDTH} y1={lineY(i)} y2={lineY(i)} strokeWidth={1} className="stroke-outline-variant" />
            ))}
            <rect
                x={THIN_X}
                y={STAFF_TOP}
                width={BARLINE_THIN_WIDTH}
                height={(NUM_STAFF_LINES - 1) * SPACE + 1}
                className="fill-outline-variant"
            />
            <rect
                x={THICK_X}
                y={STAFF_TOP}
                width={BARLINE_THICK_WIDTH}
                height={(NUM_STAFF_LINES - 1) * SPACE + 1}
                className="fill-outline-variant"
            />
            {/* Hangs from the fourth line up — the second from the top. */}
            <Glyph name="restWhole" x={(THIN_X - REST_WIDTH) / 2} y={lineY(1)} scale={SCALE} />
        </svg>
    )
}
