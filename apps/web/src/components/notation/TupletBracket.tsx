import { TUPLET_BRACKET_HEIGHT, TUPLET_NUMBER_GAP, TUPLET_NUMBER_SCALE } from './constants'
import { Glyph } from './Glyph'
import type { LayoutTuplet } from './types'

interface TupletBracketProps {
    layout: LayoutTuplet
}

export function TupletBracket({ layout }: TupletBracketProps) {
    const { x1, x2, y, location, numberGlyphs, bracketed } = layout
    const centerX = (x1 + x2) / 2
    const numberHalfWidth = TUPLET_NUMBER_GAP

    return (
        <g> 
            {bracketed && (
                <>
                    {/* Left vertical tick */}
                    <rect
                        x={x1}
                        y={location === 1 ? y : y - TUPLET_BRACKET_HEIGHT}
                        width={1}
                        height={TUPLET_BRACKET_HEIGHT}
                        fill="#000"
                    />
                    {/* Left horizontal line */}
                    {centerX - numberHalfWidth > x1 && (
                        <rect
                            x={x1}
                            y={y}
                            width={centerX - numberHalfWidth - x1}
                            height={1}
                            fill="#000"
                        />
                    )}
                    {/* Right horizontal line */}
                    {x2 > centerX + numberHalfWidth && (
                        <rect
                            x={centerX + numberHalfWidth}
                            y={y}
                            width={x2 - (centerX + numberHalfWidth)}
                            height={1}
                            fill="#000"
                        />
                    )}
                    {/* Right vertical tick */}
                    <rect
                        x={x2}
                        y={location === 1 ? y : y - TUPLET_BRACKET_HEIGHT}
                        width={1}
                        height={TUPLET_BRACKET_HEIGHT}
                        fill="#000"
                    />
                </>
            )}

            {/* Number glyphs */}
            {numberGlyphs.map((glyph, i) => (
                <Glyph
                    key={i}
                    name={glyph.glyphName}
                    x={glyph.x}
                    y={glyph.y}
                    scale={TUPLET_NUMBER_SCALE}
                />
            ))}
        </g>
    )
}
