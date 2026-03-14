import { useRef, useState } from 'react'

import { ScoreInput } from '@/components/notation'
import { Score } from '@/model'

const initialScoreData: ScoreInput = {
    measures: [
        {
            clef: 'treble',
            timeSignature: '4/4',
            voices: [
                {
                    notes: [
                        { keys: [{ name: 'C', accidental: '#', octave: 5 }], duration: '8' },
                        { keys: [{ name: 'B', octave: 4 }], duration: '8' },
                        { keys: [{ name: 'E', octave: 4 }], duration: '8' },
                        { keys: [{ name: 'C', octave: 5 }], duration: '16' },
                        { keys: [{ name: 'C', octave: 5 }], duration: '16' },
                        { keys: [{ name: 'C', octave: 5 }], duration: '16' },
                        { keys: [{ name: 'C', octave: 5 }], duration: '16' },
                        { keys: [{ name: 'G', accidental: '#', octave: 4 }], duration: 'q' },
                        { keys: [{ name: 'G', accidental: '#', octave: 4 }], duration: 'q' },
                    ],
                    tuplets: [{ startIndex: 0, count: 3, notesOccupied: 2 }],
                },
            ],
        },
        {
            voices: [
                {
                    notes: [{ keys: [{ name: 'D', octave: 5 }], duration: 'w', tie: true }],
                },
            ],
        },
        {
            voices: [
                {
                    notes: [{ keys: [{ name: 'D', octave: 5 }], duration: 'w' }],
                },
            ],
        },
        {
            voices: [
                {
                    notes: [
                        { keys: [{ name: 'D', octave: 5 }], duration: 'q', dots: 1 },
                        { keys: [{ name: 'C', octave: 5 }], duration: '8' },
                        { keys: [{ name: 'E', octave: 5 }], duration: 'q' },
                        { keys: [{ name: 'B', octave: 4 }], duration: '8' },
                        { keys: [{ name: 'F', octave: 5 }], duration: '16' },
                        { keys: [{ name: 'F', octave: 5 }], duration: '16' },
                    ],
                },
            ],
            endBarline: 'end',
        },
    ],
}

export function useScore() {
    const [, setUpdatedAt] = useState(Date.now())
    const scoreRef = useRef(Score.fromInput(initialScoreData, () => setUpdatedAt(scoreRef.current.touchedAt)))
    return scoreRef.current
}
