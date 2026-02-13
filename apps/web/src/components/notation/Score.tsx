'use client'

import { useMemo } from 'react'

import { Barline } from './Barline'
import { computeLayout } from './layout'
import { Measure } from './Measure'
import { StaffLines } from './StaffLines'
import type { ScoreInput } from './types'

interface ScoreProps {
    input: ScoreInput
    width?: number
    height?: number
}

export function Score({ input, width = 600, height = 160 }: ScoreProps) {
    const layout = useMemo(() => computeLayout(input, width, height), [input, width, height])

    return (
        <svg width={width} height={height} viewBox={`0 0 ${layout.width} ${layout.height}`} xmlns="http://www.w3.org/2000/svg">
            <StaffLines lines={layout.staffLines} />

            {layout.measures.map((measure, i) => (
                <Measure key={i} layout={measure} />
            ))}

            {layout.barlines.map((barline, i) => (
                <Barline key={i} layout={barline} />
            ))}
        </svg>
    )
}
