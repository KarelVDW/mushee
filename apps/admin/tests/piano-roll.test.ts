import { describe, expect, it } from 'vitest'

import type { ScoreDocument, ScoreEntry } from '../src/lib/api'
import { buildPianoRoll, pitchLabel } from '../src/lib/piano-roll'

function note(step: string, octave: number, duration: number, extra?: Partial<ScoreEntry>): ScoreEntry {
    return { _type: 'note', pitch: { step, octave }, duration, ...extra }
}

function rest(duration: number): ScoreEntry {
    return { _type: 'note', rest: {}, duration }
}

function doc(measures: ScoreEntry[][], partCount = 1): ScoreDocument {
    return {
        partList: { scoreParts: [{ id: 'P1', partName: 'Piano' }] },
        parts: Array.from({ length: partCount }, (_, p) => ({
            id: `P${p + 1}`,
            measures: measures.map((entries, i) => ({ number: String(i + 1), entries })),
        })),
    }
}

describe('buildPianoRoll', () => {
    it('places sequential notes on a quarter-note time axis (12 divisions default)', () => {
        const roll = buildPianoRoll(doc([[note('C', 4, 12), note('E', 4, 12), rest(12), note('G', 4, 24)]]))
        expect(roll.notes).toEqual([
            { start: 0, duration: 1, midi: 60, partIndex: 0 },
            { start: 1, duration: 1, midi: 64, partIndex: 0 },
            { start: 3, duration: 2, midi: 67, partIndex: 0 },
        ])
        expect(roll.end).toBe(5)
        expect(roll.minMidi).toBe(60)
        expect(roll.maxMidi).toBe(67)
    })

    it('applies alter to the midi pitch', () => {
        const roll = buildPianoRoll(doc([[{ _type: 'note', pitch: { step: 'F', octave: 4, alter: 1 }, duration: 12 }]]))
        expect(roll.notes[0].midi).toBe(66)
    })

    it('respects a divisions change from attributes', () => {
        const roll = buildPianoRoll(
            doc([[{ _type: 'attributes', divisions: 480 }, note('C', 4, 480), note('D', 4, 240)]]),
        )
        expect(roll.notes).toEqual([
            { start: 0, duration: 1, midi: 60, partIndex: 0 },
            { start: 1, duration: 0.5, midi: 62, partIndex: 0 },
        ])
    })

    it('merges tie-stop notes into the started note', () => {
        const roll = buildPianoRoll(
            doc([
                [note('A', 4, 48, { tie: [{ type: 'start' }] })],
                [note('A', 4, 24, { tie: [{ type: 'stop' }] }), note('B', 4, 24)],
            ]),
        )
        expect(roll.notes).toEqual([
            { start: 0, duration: 6, midi: 69, partIndex: 0 },
            { start: 6, duration: 2, midi: 71, partIndex: 0 },
        ])
    })

    it('records measure starts from the first part', () => {
        const roll = buildPianoRoll(doc([[note('C', 4, 48)], [note('D', 4, 48)], [note('E', 4, 48)]]))
        expect(roll.measureStarts).toEqual([0, 4, 8])
    })

    it('handles empty and raw documents gracefully', () => {
        expect(buildPianoRoll({}).notes).toEqual([])
        expect(buildPianoRoll({ parts: [] }).end).toBe(0)
    })
})

describe('pitchLabel', () => {
    it('names middle C and accidentals', () => {
        expect(pitchLabel(60)).toBe('C4')
        expect(pitchLabel(66)).toBe('F♯4')
        expect(pitchLabel(69)).toBe('A4')
        expect(pitchLabel(21)).toBe('A0')
    })
})
