import { memo } from 'react'

import type { Tempo } from '../model/Tempo'
import { BeatUnit, beatUnitWidth } from './BeatUnit'
import { NOTATION_INK } from './constants'

const TEMPO_NOTE_STEM_HEIGHT = 14
const TEMPO_FONT_SIZE = 10
const TEMPO_TEXT_GAP = 3

interface TempoMarkingProps {
    tempo: Tempo
    /** Omit to render the marking inert (read-only consumers). */
    onClick?: (e: React.MouseEvent<SVGGElement>) => void
    layoutId: string
}

/** A metronome mark written in the measure's felt beat: `♩ = 90` in 4/4, `♩. = 60` in 6/8. */
export const TempoMarking = memo(function TempoMarking({ tempo, onClick }: TempoMarkingProps) {
    const { y } = tempo.layout
    const noteWidth = beatUnitWidth(tempo.pulse)
    const stemY2 = y - TEMPO_NOTE_STEM_HEIGHT
    const textX = noteWidth + TEMPO_TEXT_GAP

    return (
        <g
            onClick={
                onClick &&
                ((e) => {
                    e.stopPropagation()
                    onClick(e)
                })
            }
            style={onClick ? { cursor: 'pointer' } : undefined}>
            {onClick && <rect x={-2} y={stemY2 - 2} width={noteWidth + 40} height={TEMPO_NOTE_STEM_HEIGHT + 4} fill="transparent" />}
            <g transform={`translate(0, ${y})`}>
                <BeatUnit duration={tempo.pulse} />
            </g>
            <text
                x={textX}
                y={y}
                fontSize={TEMPO_FONT_SIZE}
                fontFamily="system-ui, sans-serif"
                fontWeight={600}
                dominantBaseline="central"
                fill={NOTATION_INK}
                style={{ userSelect: 'none' }}>
                = {tempo.pulseBpm}
            </text>
        </g>
    )
})
