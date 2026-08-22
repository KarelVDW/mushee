import { Instrument, type Note, type Score } from '@mushee/notation/model'
import { makeScore, pitched } from '@mushee/notation/testing'
import { beforeEach, describe, expect, it } from 'vitest'

import { RAISE_PITCH, REMOVE_NOTE, SET_DURATION, TOGGLE_REST } from '@/app/scores/[id]/actions'
import { EDITOR_COMMANDS } from '@/app/scores/[id]/commands'
import { ManipulationHistoryManager } from '@/app/scores/[id]/ManipulationHistoryManager'
import { ScoreManipulator } from '@/app/scores/[id]/ScoreManipulator'
import { Keybindings } from '@/lib/Keybindings'

beforeEach(() => {
    localStorage.clear()
})

/** A one-measure score of four pitched quarter notes (C5 D5 E5 F5), attached to a manipulator. */
function setupPitched(): { manipulator: ScoreManipulator; notes: Note[]; saves: Score[] } {
    const score = makeScore(1)
    const measure = score.firstMeasure
    if (!measure) throw new Error('expected a measure')
    const notes = score.replace(measure.notes, [pitched('C', 5), pitched('D', 5), pitched('E', 5), pitched('F', 5)])
    // A platform-pinned keymap so Mod means Ctrl regardless of the machine running the tests.
    const manipulator = new ScoreManipulator(new Keybindings(EDITOR_COMMANDS, { storageKey: 'test:editor-shortcuts', isMac: false }))
    const saves: Score[] = []
    manipulator.attach(score, (s) => saves.push(s))
    return { manipulator, notes, saves }
}

/** Every note in the score, in score order. */
function allNotes(manipulator: ScoreManipulator): Note[] {
    return manipulator.score?.measures.flatMap((m) => m.notes) ?? []
}

const pitchNames = (notes: Note[]): Array<string | undefined> => notes.map((n) => n.pitch?.name)

describe('ScoreManipulator undo/redo', () => {
    it('has no history right after attach', () => {
        const { manipulator } = setupPitched()
        expect(manipulator.canUndo).toBe(false)
        expect(manipulator.canRedo).toBe(false)
        expect(manipulator.undo()).toBe(false)
        expect(manipulator.redo()).toBe(false)
    })

    it('undoes an edit back to the prior state and re-selects the edited position', () => {
        const { manipulator, notes } = setupPitched() // C5 D5 E5 F5
        manipulator.select(notes[1])
        manipulator.run(RAISE_PITCH)
        expect(allNotes(manipulator)[1].pitch?.name).not.toBe('D')
        expect(manipulator.canUndo).toBe(true)

        expect(manipulator.undo()).toBe(true)
        expect(pitchNames(allNotes(manipulator))).toEqual(['C', 'D', 'E', 'F'])
        // The selection returns to the note the edit was made on (by position — identities changed).
        expect(manipulator.selectedNote).toBe(allNotes(manipulator)[1])
        expect(manipulator.canUndo).toBe(false)
        expect(manipulator.canRedo).toBe(true)
    })

    it('redo reapplies an undone edit', () => {
        const { manipulator, notes } = setupPitched()
        manipulator.select(notes[1])
        manipulator.run(RAISE_PITCH)
        const raised = allNotes(manipulator)[1].pitch
        manipulator.undo()

        expect(manipulator.redo()).toBe(true)
        expect(allNotes(manipulator)[1].pitch?.name).toBe(raised?.name)
        expect(manipulator.canRedo).toBe(false)
        expect(manipulator.canUndo).toBe(true)
    })

    it('a new edit clears the redo trail', () => {
        const { manipulator, notes } = setupPitched()
        manipulator.select(notes[1])
        manipulator.run(RAISE_PITCH)
        manipulator.undo()
        expect(manipulator.canRedo).toBe(true)

        manipulator.select(allNotes(manipulator)[0])
        manipulator.run(TOGGLE_REST)
        expect(manipulator.canRedo).toBe(false)
    })

    it('walks a multi-step trail back and forward again', () => {
        const { manipulator, notes } = setupPitched() // C5 D5 E5 F5
        manipulator.select(notes[0])
        manipulator.run(RAISE_PITCH) // step 1
        manipulator.run(SET_DURATION, 'h') // step 2
        manipulator.select(allNotes(manipulator)[1])
        manipulator.run(REMOVE_NOTE) // step 3

        manipulator.undo()
        manipulator.undo()
        manipulator.undo()
        expect(pitchNames(allNotes(manipulator))).toEqual(['C', 'D', 'E', 'F'])
        expect(allNotes(manipulator).map((n) => n.duration.type)).toEqual(['q', 'q', 'q', 'q'])

        manipulator.redo()
        manipulator.redo()
        manipulator.redo()
        expect(allNotes(manipulator)[0].duration.type).toBe('h')
        expect(allNotes(manipulator)[1].isRest).toBe(true)
    })

    it('selection moves alone never become history steps', () => {
        const { manipulator, notes } = setupPitched()
        manipulator.select(notes[2])
        manipulator.extendSelectionTo(notes[3])
        manipulator.selectAll()
        manipulator.collapseSelection()
        expect(manipulator.canUndo).toBe(false)
    })

    it('a mutation that changes nothing semantically is not a step', () => {
        const { manipulator } = setupPitched()
        // Setting the clef the measure already has bumps the version but round-trips identically.
        manipulator.setClefAt(0, 'treble')
        expect(manipulator.canUndo).toBe(false)
    })

    it('returns the cursor to where each state left it, in both directions', () => {
        const { manipulator, notes } = setupPitched()
        manipulator.select(notes[2])
        manipulator.run(RAISE_PITCH)
        manipulator.select(allNotes(manipulator)[0]) // navigate away after the edit

        manipulator.undo()
        expect(manipulator.selectedNote).toBe(allNotes(manipulator)[2]) // back at the edit
        manipulator.redo()
        expect(manipulator.selectedNote).toBe(allNotes(manipulator)[0]) // back where undo was pressed
    })

    it('undoes structural changes (added measures)', () => {
        const { manipulator } = setupPitched()
        manipulator.addMeasure()
        expect(manipulator.score?.measures).toHaveLength(2)
        manipulator.undo()
        expect(manipulator.score?.measures).toHaveLength(1)
        manipulator.redo()
        expect(manipulator.score?.measures).toHaveLength(2)
    })

    it('undoes a time-signature change through the rebar round-trip', () => {
        const { manipulator } = setupPitched()
        manipulator.setTimeSignatureAt(0, 3, 4)
        expect(manipulator.score?.firstMeasure?.timeSignature.beatAmount).toBe(3)
        manipulator.undo()
        expect(manipulator.score?.firstMeasure?.timeSignature.beatAmount).toBe(4)
        expect(pitchNames(allNotes(manipulator))).toEqual(['C', 'D', 'E', 'F'])
    })

    it('undoes an instrument switch including its transposition, and marks it for persistence', () => {
        const { manipulator } = setupPitched()
        manipulator.setInstrument(Instrument.Trumpet) // B♭: rewrites every written pitch
        const transposed = pitchNames(allNotes(manipulator))
        expect(transposed).not.toEqual(['C', 'D', 'E', 'F'])

        manipulator.undo()
        expect(manipulator.score?.instrument).toBe(Instrument.Piano)
        expect(pitchNames(allNotes(manipulator))).toEqual(['C', 'D', 'E', 'F'])
        // The seeded instrument must reach the autosave payload, or the server keeps the trumpet.
        expect(manipulator.score?.flushDirty()?.partList).toBeDefined()

        manipulator.redo()
        expect(manipulator.score?.instrument).toBe(Instrument.Trumpet)
        expect(pitchNames(allNotes(manipulator))).toEqual(transposed)
    })

    it('caps the trail at MAX_STEPS', () => {
        const { manipulator, notes } = setupPitched()
        manipulator.select(notes[0])
        for (let i = 0; i < ManipulationHistoryManager.MAX_STEPS + 5; i++) manipulator.run(TOGGLE_REST)
        let undone = 0
        while (manipulator.undo()) undone++
        expect(undone).toBe(ManipulationHistoryManager.MAX_STEPS)
    })

    it('folds out-of-band score changes (the recording pipeline) into one undo step', () => {
        const { manipulator } = setupPitched()
        const score = manipulator.score
        if (!score?.firstMeasure) throw new Error('expected a score')
        // Two direct writes, like streamed transcription updates — no manipulator involved.
        score.replace([score.firstMeasure.notes[0]], [pitched('G', 5)])
        score.replace([score.firstMeasure.notes[1]], [pitched('A', 5)])
        expect(manipulator.canUndo).toBe(true)

        manipulator.undo()
        expect(pitchNames(allNotes(manipulator))).toEqual(['C', 'D', 'E', 'F'])
        expect(manipulator.canUndo).toBe(false)
    })

    it('peels only the tracked edit off out-of-band changes made before it', () => {
        const { manipulator } = setupPitched()
        const score = manipulator.score
        if (!score?.firstMeasure) throw new Error('expected a score')
        score.replace([score.firstMeasure.notes[0]], [pitched('G', 5)]) // out-of-band
        manipulator.select(allNotes(manipulator)[3])
        manipulator.run(TOGGLE_REST) // tracked edit on F5

        manipulator.undo()
        expect(pitchNames(allNotes(manipulator))).toEqual(['G', 'D', 'E', 'F']) // out-of-band change kept
        manipulator.undo()
        expect(pitchNames(allNotes(manipulator))).toEqual(['C', 'D', 'E', 'F'])
    })

    it('out-of-band changes void the redo trail', () => {
        const { manipulator, notes } = setupPitched()
        manipulator.select(notes[1])
        manipulator.run(RAISE_PITCH)
        manipulator.undo()
        expect(manipulator.canRedo).toBe(true)

        const score = manipulator.score
        if (!score?.firstMeasure) throw new Error('expected a score')
        score.replace([score.firstMeasure.notes[0]], [pitched('G', 5)])
        expect(manipulator.canRedo).toBe(false)
        expect(manipulator.redo()).toBe(false)
        expect(allNotes(manipulator)[0].pitch?.name).toBe('G')
    })

    it('refuses to travel while historyLocked (a live recording)', () => {
        const { manipulator, notes } = setupPitched()
        manipulator.select(notes[1])
        manipulator.run(RAISE_PITCH)

        manipulator.historyLocked = true
        expect(manipulator.canUndo).toBe(false)
        expect(manipulator.undo()).toBe(false)

        manipulator.historyLocked = false
        expect(manipulator.canUndo).toBe(true)
        expect(manipulator.undo()).toBe(true)
    })

    it('autosaves the restored score instance after travel', () => {
        const { manipulator, notes, saves } = setupPitched()
        const original = manipulator.score
        manipulator.select(notes[1])
        manipulator.run(RAISE_PITCH)
        manipulator.undo()

        const lastSaved = saves[saves.length - 1]
        expect(lastSaved).toBe(manipulator.score)
        expect(lastSaved).not.toBe(original)
        // The rebuilt score is fully structure-dirty, so the flush carries the whole document.
        expect(lastSaved.flushDirty()?.allMeasures).toBeDefined()
    })

    it('re-attaching a score starts the history over', () => {
        const { manipulator, notes } = setupPitched()
        manipulator.select(notes[1])
        manipulator.run(RAISE_PITCH)
        expect(manipulator.canUndo).toBe(true)

        manipulator.attach(makeScore(1), () => undefined)
        expect(manipulator.canUndo).toBe(false)
        expect(manipulator.canRedo).toBe(false)
    })
})

describe('ScoreManipulator undo/redo keyboard dispatch', () => {
    /** Run a synthetic keydown through the manipulator and report whether it consumed it. */
    function press(manipulator: ScoreManipulator, init: KeyboardEventInit): boolean {
        const event = new KeyboardEvent('keydown', { cancelable: true, ...init })
        manipulator.handleKeyDown(event)
        return event.defaultPrevented
    }

    it('undoes with Mod+Z and redoes with Mod+Shift+Z', () => {
        const { manipulator, notes } = setupPitched()
        manipulator.select(notes[1])
        manipulator.run(RAISE_PITCH)
        const raised = allNotes(manipulator)[1].pitch?.name

        expect(press(manipulator, { code: 'KeyZ', key: 'z', ctrlKey: true })).toBe(true)
        expect(allNotes(manipulator)[1].pitch?.name).toBe('D')
        expect(press(manipulator, { code: 'KeyZ', key: 'Z', ctrlKey: true, shiftKey: true })).toBe(true)
        expect(allNotes(manipulator)[1].pitch?.name).toBe(raised)
    })

    it('leaves Mod+Z to the browser when there is nothing to undo', () => {
        const { manipulator } = setupPitched()
        expect(press(manipulator, { code: 'KeyZ', key: 'z', ctrlKey: true })).toBe(false)
        expect(press(manipulator, { code: 'KeyZ', key: 'Z', ctrlKey: true, shiftKey: true })).toBe(false)
    })
})
