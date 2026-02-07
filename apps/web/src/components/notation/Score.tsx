'use client'

import { useMemo } from 'react'

import { computeLayout } from './layout'
import { Stave } from './Stave'
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
            {layout.staves.map((stave, i) => (
                <Stave key={i} layout={stave} />
            ))}
        </svg>
    )
}
