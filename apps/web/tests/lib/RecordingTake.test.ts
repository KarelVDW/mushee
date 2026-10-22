import type { Note } from '@mushee/notation/model'
import type { MxmlMeasure } from '@mushee/notation/model/io/MusicXml'
import { MeasureSerializer } from '@mushee/notation/model/io/ScoreSerializer'
import { clef, fill, makeScore, pitched, rest } from '@mushee/notation/testing'
import { describe, expect, it } from 'vitest'

import { RecordingTake } from '@/lib/RecordingTake'

/** The wire form of a 4/4 measure holding `notes` — what the gateway streams back. */
function transcribed(notes: Note[]): MxmlMeasure {
    return new MeasureSerializer(fill(makeScore(1), 0, notes)).serialize()
}

const spelled = (notes: readonly Note[]): Array<string | null> => notes.map((n) => (n.pitch ? `${n.pitch.name}${n.pitch.octave}` : null))

describe('RecordingTake', () => {
    it('begins by displacing the start measure and adopting its tempo marking, then appends after it', () => {
        const score = makeScore(3)
        score.setTempo(score.measures[1].firstNote, 132)
        const displaced = score.measures[1]
        const take = new RecordingTake(score, 1, clef('treble'))

        take.begin()
        expect(score.measures).toHaveLength(4)
        expect(score.measures[2]).toBe(displaced)
        expect(score.measures[1].tempoAtBeat(0)?.bpm).toBe(132)

        take.appendMeasure()
        take.appendMeasure()
        expect(score.measures).toHaveLength(6)
        expect(score.measures[4]).toBe(displaced)
    })

    it('writes an update into the measure at the take-relative key and reports the beats its notes cover', () => {
        const score = makeScore(3)
        const take = new RecordingTake(score, 1, clef('treble'))
        take.begin()

        const covered = take.applyUpdate({ 0: transcribed([pitched('C', 5), pitched('D', 5, 'h'), rest()]) })
        expect(spelled(score.measures[1].notes)).toEqual(['C5', 'D5', null])
        // Up to the end of the last pitched note; the trailing rest covers nothing.
        expect(covered).toEqual([{ measureIndex: 1, coveredBeats: 3 }])
    })

    it('skips measures that are gone and updates without notes, and reports nothing for all-rest measures', () => {
        const score = makeScore(1)
        const take = new RecordingTake(score, 0, clef('treble'))
        take.begin()
        const before = score.measures[0].notes

        const covered = take.applyUpdate({
            0: transcribed([rest('w')]),
            7: transcribed([pitched('C', 5, 'w')]),
            1: { ...transcribed([rest('w')]), entries: [] },
        })
        expect(covered).toEqual([])
        expect(score.measures).toHaveLength(2)
        expect(score.measures[0].notes).not.toBe(before) // the all-rest update was still written
        expect(spelled(score.measures[0].notes)).toEqual([null])
    })

    it('pulls the take onto the clef it records into, locking the shift from the first pitched update', () => {
        const score = makeScore(1)
        const take = new RecordingTake(score, 0, clef('treble'))
        take.begin()
        take.appendMeasure()

        // Whistled two octaves above the treble staff.
        take.applyUpdate({ 0: transcribed([pitched('B', 6, 'w')]) })
        expect(spelled(score.measures[0].notes)).toEqual(['B4'])

        // A later update keeps that shift, even where re-deciding would pick another one.
        take.applyUpdate({ 1: transcribed([pitched('B', 5, 'w')]) })
        expect(spelled(score.measures[1].notes)).toEqual(['B3'])
    })

    it('waits for an update with pitches before deciding the shift', () => {
        const score = makeScore(1)
        const take = new RecordingTake(score, 0, clef('bass'))
        take.begin()
        take.appendMeasure()

        take.applyUpdate({ 0: transcribed([rest('w')]) })
        take.applyUpdate({ 1: transcribed([pitched('D', 5, 'w')]) })
        expect(spelled(score.measures[1].notes)).toEqual(['D3'])
    })

    describe('where a take starts', () => {
        it('records into the selected note’s measure and clef', () => {
            const score = makeScore(3)
            score.setClef(score.measures[1].firstNote, 'bass')
            const take = RecordingTake.startingAt(score, score.measures[1].notes[2])
            expect(take?.startIndex).toBe(1)
            take?.begin()
            // Bass clef: a whistled pitch lands on the bass staff.
            take?.applyUpdate({ 0: transcribed([pitched('D', 5, 'w')]) })
            expect(spelled(score.measures[1].notes)).toEqual(['D3'])
        })

        it('with nothing selected, carries on after the last bar that holds a pitched note', () => {
            const score = makeScore(4)
            fill(score, 1, [pitched('C', 5, 'w')])
            expect(RecordingTake.startingAt(score, null)?.startIndex).toBe(2)
        })

        it('starts at bar 1 of an empty score, and after the final bar when it is written', () => {
            expect(RecordingTake.startingAt(makeScore(2), null)?.startIndex).toBe(0)
            const full = makeScore(2)
            fill(full, 1, [pitched('C', 5, 'w')])
            const take = RecordingTake.startingAt(full, null)
            expect(take?.startIndex).toBe(2)
            take?.begin()
            expect(full.measures).toHaveLength(3)
        })

        it('takes the clef in effect where it starts — the last bar’s when it appends', () => {
            const score = makeScore(2)
            score.setClef(score.measures[1].firstNote, 'bass')
            fill(score, 1, [pitched('C', 3, 'w')])
            const take = RecordingTake.startingAt(score, null)
            take?.begin()
            take?.applyUpdate({ 0: transcribed([pitched('D', 5, 'w')]) })
            expect(spelled(score.measures[2].notes)).toEqual(['D3'])
        })

        it('has nowhere to start in a score without bars', () => {
            expect(RecordingTake.startingAt(makeScore(0), null)).toBeNull()
        })
    })

    describe('after the take', () => {
        it('reports the bars it added and whether it wrote any pitch', () => {
            const score = makeScore(2)
            const take = new RecordingTake(score, 1, clef('treble'))
            expect(take.measures).toEqual([])
            take.begin()
            take.appendMeasure()
            expect(take.measures).toEqual([score.measures[1], score.measures[2]])
            expect(take.wrotePitchedNotes).toBe(false)
            take.applyUpdate({ 1: transcribed([pitched('C', 5, 'w')]) })
            expect(take.wrotePitchedNotes).toBe(true)
        })

        it('carries on from the bar it displaced', () => {
            const score = makeScore(2)
            const displaced = score.measures[1]
            const take = new RecordingTake(score, 1, clef('treble'))
            expect(take.noteAfter()).toBeNull() // not begun: nothing to carry on from
            take.begin()
            take.appendMeasure()
            expect(take.noteAfter()).toBe(displaced.firstNote)
            expect(score.measures).toHaveLength(4)
        })

        it('adds one empty bar after a take that ran off the end of the score', () => {
            const score = makeScore(1)
            fill(score, 0, [pitched('C', 5, 'w')])
            const take = RecordingTake.startingAt(score, null)
            take?.begin()
            const after = take?.noteAfter()
            expect(score.measures).toHaveLength(3)
            expect(after).toBe(score.measures[2].firstNote)
            expect(after?.isRest).toBe(true)
            // Asking again finds the same bar.
            expect(take?.noteAfter()).toBe(after)
            expect(score.measures).toHaveLength(3)
        })

        it('takes an empty take back out, tempo marking and all', () => {
            const score = makeScore(2)
            score.setTempo(score.measures[1].firstNote, 132)
            const displaced = score.measures[1]
            const take = new RecordingTake(score, 1, clef('treble'))
            take.begin()
            take.appendMeasure()
            expect(take.discardIfEmpty()).toBe(true)
            expect(score.measures).toHaveLength(2)
            expect(score.measures[1]).toBe(displaced)
            expect(displaced.tempoAtBeat(0)?.bpm).toBe(132)
            expect(take.measures).toEqual([])
            expect(take.discardIfEmpty()).toBe(false)
        })

        it('keeps a take that wrote notes', () => {
            const score = makeScore(1)
            const take = new RecordingTake(score, 0, clef('treble'))
            take.begin()
            take.applyUpdate({ 0: transcribed([pitched('C', 5, 'w')]) })
            expect(take.discardIfEmpty()).toBe(false)
            expect(score.measures).toHaveLength(2)
        })
    })
})
