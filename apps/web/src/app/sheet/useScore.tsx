import { useRef, useState } from 'react'

import type { ScorePartwise } from '@/components/notation/types'
import { Score } from '@/model'

const initialScoreData: ScorePartwise = {
    partList: { scoreParts: [{ id: 'P1', partName: 'Piano' }] },
    parts: [
        {
            id: 'P1',
            measures: [
                {
                    number: '1',
                    entries: [
                        { _type: 'attributes', divisions: 12, clef: [{ sign: 'G', line: 2 }], time: [{ beats: '4', beatType: '4' }] },
                        { _type: 'note', pitch: { step: 'C', alter: 1, octave: 5 }, duration: 4, voice: '1', type: 'eighth', timeModification: { actualNotes: 3, normalNotes: 2 } },
                        { _type: 'note', pitch: { step: 'B', octave: 4 }, duration: 4, voice: '1', type: 'eighth', timeModification: { actualNotes: 3, normalNotes: 2 } },
                        { _type: 'note', pitch: { step: 'E', octave: 4 }, duration: 4, voice: '1', type: 'eighth', timeModification: { actualNotes: 3, normalNotes: 2 } },
                        { _type: 'note', pitch: { step: 'C', octave: 5 }, duration: 3, voice: '1', type: '16th' },
                        { _type: 'note', pitch: { step: 'C', octave: 5 }, duration: 3, voice: '1', type: '16th' },
                        { _type: 'note', pitch: { step: 'C', octave: 5 }, duration: 3, voice: '1', type: '16th' },
                        { _type: 'note', pitch: { step: 'C', octave: 5 }, duration: 3, voice: '1', type: '16th' },
                        { _type: 'note', pitch: { step: 'G', alter: 1, octave: 4 }, duration: 12, voice: '1', type: 'quarter' },
                        { _type: 'note', pitch: { step: 'G', alter: 1, octave: 4 }, duration: 12, voice: '1', type: 'quarter' },
                    ],
                },
                {
                    number: '2',
                    entries: [
                        { _type: 'note', pitch: { step: 'D', octave: 5 }, duration: 48, voice: '1', type: 'whole', tie: [{ type: 'start' }] },
                    ],
                },
                {
                    number: '3',
                    entries: [
                        { _type: 'note', pitch: { step: 'D', octave: 5 }, duration: 48, voice: '1', type: 'whole' },
                    ],
                },
                {
                    number: '4',
                    entries: [
                        { _type: 'note', pitch: { step: 'D', octave: 5 }, duration: 18, voice: '1', type: 'quarter', dot: 1 },
                        { _type: 'note', pitch: { step: 'C', octave: 5 }, duration: 6, voice: '1', type: 'eighth' },
                        { _type: 'note', pitch: { step: 'E', octave: 5 }, duration: 12, voice: '1', type: 'quarter' },
                        { _type: 'note', pitch: { step: 'B', octave: 4 }, duration: 6, voice: '1', type: 'eighth' },
                        { _type: 'note', pitch: { step: 'F', octave: 5 }, duration: 3, voice: '1', type: '16th' },
                        { _type: 'note', pitch: { step: 'F', octave: 5 }, duration: 3, voice: '1', type: '16th' },
                        { _type: 'barline', location: 'right', barStyle: 'light-heavy' },
                    ],
                },
            ],
        },
    ],
}

export function useScore() {
    const [, setUpdatedAt] = useState(Date.now())
    const scoreRef = useRef(Score.fromInput(initialScoreData, () => setUpdatedAt(scoreRef.current.touchedAt)))
    return scoreRef.current
}
