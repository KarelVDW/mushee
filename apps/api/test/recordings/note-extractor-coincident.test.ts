import { describe, expect, it } from 'vitest'

import { NoteExtractor } from '../../src/recordings/pipeline/note-extractor'

const n = (start: number, dur: number, midi: number, amp = 0.5) => ({
    startTimeSeconds: start,
    durationSeconds: dur,
    pitchMidi: midi,
    amplitude: amp,
})

describe('NoteExtractor.collapseCoincident', () => {
    it('merges two same-pitch notes snapped onto the same slot into one spanning both', () => {
        const out = NoteExtractor.collapseCoincident([n(11.2, 0.17, 68), n(11.2, 0.35, 68), n(11.55, 0.35, 68)])
        expect(out).toHaveLength(2)
        expect(out[0]).toMatchObject({ startTimeSeconds: 11.2, durationSeconds: 0.35, pitchMidi: 68 })
    })

    it('keeps the longer note when two different pitches share an onset (never a chord)', () => {
        const out = NoteExtractor.collapseCoincident([n(1, 0.2, 60), n(1, 0.5, 62)])
        expect(out).toEqual([n(1, 0.5, 62)])
    })

    it('leaves distinct onsets untouched', () => {
        const notes = [n(0, 0.5, 60), n(0.5, 0.5, 60), n(1, 0.5, 62)]
        expect(NoteExtractor.collapseCoincident(notes)).toEqual(notes)
    })
})
