import { makeScore, pitched } from '@test/helpers'
import { describe, expect, it } from 'vitest'

import { RAISE_PITCH, SET_DURATION, TOGGLE_REST } from '@/app/scores/[id]/actions'
import { ScoreManipulator } from '@/app/scores/[id]/ScoreManipulator'
import type { Note } from '@/model'

/** A one-measure score of four pitched quarter notes (C5 D5 E5 F5), attached to a manipulator. */
function setupPitched(): { manipulator: ScoreManipulator; notes: Note[] } {
    const score = makeScore(1)
    const measure = score.firstMeasure
    if (!measure) throw new Error('expected a measure')
    const notes = score.replace(measure.notes, [pitched('C', 5), pitched('D', 5), pitched('E', 5), pitched('F', 5)])
    const manipulator = new ScoreManipulator()
    manipulator.attach(score, () => undefined)
    return { manipulator, notes }
}

/** Every note in the score, in score order. */
function allNotes(manipulator: ScoreManipulator): Note[] {
    return manipulator.score?.measures.flatMap((m) => m.notes) ?? []
}

const ids = (notes: Note[]): string[] => notes.map((n) => n.id)

describe('ScoreManipulator selection', () => {
    it('attaches with the first note selected', () => {
        const { manipulator, notes } = setupPitched()
        expect(manipulator.selectedNote).toBe(notes[0])
        expect(ids(manipulator.selectedNotes)).toEqual([notes[0].id])
    })

    it('extends a selection forward into a contiguous run (focus = the far end)', () => {
        const { manipulator, notes } = setupPitched()
        manipulator.select(notes[0])
        manipulator.extendSelectionTo(notes[2])
        expect(ids(manipulator.selectedNotes)).toEqual([notes[0].id, notes[1].id, notes[2].id])
        expect(manipulator.selectedNote).toBe(notes[2])
    })

    it('normalizes a backward extension to score order', () => {
        const { manipulator, notes } = setupPitched()
        manipulator.select(notes[2])
        manipulator.extendSelectionTo(notes[0])
        expect(ids(manipulator.selectedNotes)).toEqual([notes[0].id, notes[1].id, notes[2].id])
        expect(manipulator.selectedNote).toBe(notes[0]) // focus stays where the user dragged to
    })

    it('spans measures when anchor and focus are in different measures', () => {
        const score = makeScore(2)
        const manipulator = new ScoreManipulator()
        manipulator.attach(score, () => undefined)
        const notes = allNotes(manipulator) // 8 quarter rests across two measures
        manipulator.select(notes[2])
        manipulator.extendSelectionTo(notes[5])
        expect(ids(manipulator.selectedNotes)).toEqual(ids(notes.slice(2, 6)))
    })

    it('steps the focus by one note while keeping the anchor (shift+arrows)', () => {
        const { manipulator, notes } = setupPitched()
        manipulator.select(notes[0])
        manipulator.extendSelectionByStep(1)
        expect(ids(manipulator.selectedNotes)).toEqual([notes[0].id, notes[1].id])
        manipulator.extendSelectionByStep(-1)
        expect(ids(manipulator.selectedNotes)).toEqual([notes[0].id])
    })

    it('collapses a multi-note selection back onto the active note', () => {
        const { manipulator, notes } = setupPitched()
        manipulator.select(notes[0])
        manipulator.extendSelectionTo(notes[2])
        manipulator.collapseSelection()
        expect(manipulator.selectedNote).toBe(notes[2])
        expect(manipulator.selectedNotes).toHaveLength(1)
    })

    it('re-renders subscribers on a selection change', () => {
        const { manipulator, notes } = setupPitched()
        let calls = 0
        manipulator.subscribe(() => calls++)
        manipulator.select(notes[1])
        expect(calls).toBe(1)
    })
})

describe('ScoreManipulator bulk actions', () => {
    it('applies a bulk action to every selected note and re-anchors on the results', () => {
        const { manipulator, notes } = setupPitched()
        const before = notes.slice(0, 3).map((n) => n.pitch?.line ?? 0)
        manipulator.select(notes[0])
        manipulator.extendSelectionTo(notes[2])
        manipulator.run(RAISE_PITCH) // bulk

        const after = manipulator.selectedNotes
        expect(after).toHaveLength(3)
        expect(after.map((n) => n.pitch?.line ?? 0)).toEqual(before.map((line) => line + 0.5))
        // The fourth note was outside the selection and is untouched.
        expect(allNotes(manipulator)[3]?.pitch?.line).toBe(notes[3].pitch?.line)
    })

    it('turns a whole selected run into rests (bulk toggle-rest)', () => {
        const { manipulator, notes } = setupPitched()
        manipulator.select(notes[0])
        manipulator.extendSelectionTo(notes[1])
        manipulator.run(TOGGLE_REST) // bulk
        expect(manipulator.selectedNotes).toHaveLength(2)
        expect(manipulator.selectedNotes.every((n) => n.isRest)).toBe(true)
    })

    it('runs a non-bulk action on the active note only and collapses the selection', () => {
        const { manipulator, notes } = setupPitched()
        manipulator.select(notes[0])
        manipulator.extendSelectionTo(notes[2])
        manipulator.run(SET_DURATION, 'h') // not bulk-flagged
        expect(manipulator.selectedNotes).toHaveLength(1)
    })
})
