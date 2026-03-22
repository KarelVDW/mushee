import { useRef, useState } from 'react'

import type { ScorePartwise } from '@/components/notation/types'
import { Score } from '@/model'

export function useScore(initialData: ScorePartwise) {
    const [, setUpdatedAt] = useState(Date.now())
    const scoreRef = useRef(Score.fromInput(initialData, () => setUpdatedAt(scoreRef.current.touchedAt)))
    return scoreRef.current
}
