import { memo } from 'react'

import type { Tempo } from '@/model/Tempo'

import { GLYPH_SCALE } from './constants'
import { Glyph } from './Glyph'
import { getGlyphWidth } from './glyph-utils'

const TEMPO_NOTE_STEM_HEIGHT = 14
const TEMPO_FONT_SIZE = 10
const TEMPO_TEXT_GAP = 3

interface TempoMarkingProps {
    tempo: Tempo
    onClick: (e: React.MouseEvent<SVGGElement>) => void
    layoutId: string
}

export const TempoMarking = memo(
    function TempoMarking({ tempo, onClick }: TempoMarkingProps) {
        const { x, y } = tempo.layout
        const { bpm } = tempo
        const nhWidth = getGlyphWidth('noteheadBlack', GLYPH_SCALE)
        const stemX = x + nhWidth
        const stemY2 = y - TEMPO_NOTE_STEM_HEIGHT

        const textX = stemX + TEMPO_TEXT_GAP

        return (
            <g
                onClick={(e) => { e.stopPropagation(); onClick(e) }}
                style={{ cursor: 'pointer' }}
            >
                <rect
                    x={x - 2}
                    y={stemY2 - 2}
                    width={nhWidth + 40}
                    height={TEMPO_NOTE_STEM_HEIGHT + 4}
                    fill="transparent"
                />
                <line x1={stemX} y1={y} x2={stemX} y2={stemY2} stroke="#000" strokeWidth={1.2} />
                <Glyph name="noteheadBlack" x={x} y={y} />
                <text
                    x={textX}
                    y={y}
                    fontSize={TEMPO_FONT_SIZE}
                    fontFamily="system-ui, sans-serif"
                    fontWeight={600}
                    dominantBaseline="central"
                    fill="#000"
                    style={{ userSelect: 'none' }}
                >
                    = {bpm}
                </text>
            </g>
        )
    },
)
