import { memo } from 'react'

import type { Duration } from '../model/Duration'
import { BeatUnit, beatUnitWidth } from './BeatUnit'
import { NOTATION_INK } from './constants'

const TEMPO_FONT_SIZE = 10
const TEMPO_TEXT_GAP = 3
/** How far the click target reaches past the note, over the `= 90` text. */
export const TEMPO_TEXT_HIT_WIDTH = 40

interface TempoMarkingProps {
    /** Row-local y of the marking's notehead centre (its TempoLayout). */
    y: number
    /** The felt beat the marking is written in (Tempo.pulse). */
    pulse: Duration
    /** The bpm counted in that beat (Tempo.pulseBpm). */
    pulseBpm: number
}

/** A metronome mark written in the measure's felt beat: `♩ = 90` in 4/4, `♩. = 60` in 6/8. */
export const TempoMarking = memo(function TempoMarking({ y, pulse, pulseBpm }: TempoMarkingProps) {
    const textX = beatUnitWidth(pulse) + TEMPO_TEXT_GAP

    return (
        <>
            <g transform={`translate(0, ${y})`}>
                <BeatUnit duration={pulse} />
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
                = {pulseBpm}
            </text>
        </>
    )
})
