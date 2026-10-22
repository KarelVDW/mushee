import { Duration, Interval, Note, Pitch } from '@mushee/notation/model'
import { makeScore, pitched } from '@mushee/notation/testing'
import { beforeEach, describe, expect, it } from 'vitest'

import {
    LOWER_PITCH,
    MOVE_NEXT,
    MOVE_PREVIOUS,
    RAISE_PITCH,
    REMOVE_NOTE,
    SET_ACCIDENTAL,
    SET_DURATION,
    TOGGLE_REST,
} from '@/app/scores/[id]/actions'
import { EDITOR_COMMANDS } from '@/app/scores/[id]/commands'
import { EditorSpeech, KeyboardHelpText } from '@/app/scores/[id]/EditorAnnouncer'
import { ScoreManipulator, UNDO_CHANGE_LABEL, UNDO_DELETE_LABEL, type UndoOffer } from '@/app/scores/[id]/ScoreManipulator'
import { Keybindings, Shortcut } from '@/lib/Keybindings'

import { allNotes, setupPitched } from './editorFixtures'

beforeEach(() => {
    localStorage.clear()
})

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

    it('selects every note in the score, anchored at the first', () => {
        const score = makeScore(2)
        const manipulator = new ScoreManipulator()
        manipulator.attach(score, () => undefined)
        const notes = allNotes(manipulator)
        manipulator.select(notes[3])
        manipulator.selectAll()
        expect(ids(manipulator.selectedNotes)).toEqual(ids(notes))
        expect(manipulator.selectedNote).toBe(notes[notes.length - 1])
        // The anchor is the first note: shrinking by a step trims from the far end.
        manipulator.extendSelectionByStep(-1)
        expect(ids(manipulator.selectedNotes)).toEqual(ids(notes.slice(0, -1)))
    })

    it('re-renders subscribers on a selection change', () => {
        const { manipulator, notes } = setupPitched()
        let calls = 0
        manipulator.subscribe(() => calls++)
        manipulator.select(notes[1])
        expect(calls).toBe(1)
    })
})

describe('ScoreManipulator quiet selection, edit count and announcements', () => {
    it('a quiet select marks the selection until the next ordinary one', () => {
        const { manipulator, notes } = setupPitched()
        expect(manipulator.selectionIsQuiet).toBe(false)
        manipulator.select(notes[2], { quiet: true })
        expect(manipulator.selectedNote).toBe(notes[2])
        expect(manipulator.selectionIsQuiet).toBe(true)
        manipulator.select(notes[1])
        expect(manipulator.selectionIsQuiet).toBe(false)
        manipulator.select(notes[1], { quiet: true })
        manipulator.extendSelectionTo(notes[3])
        expect(manipulator.selectionIsQuiet).toBe(false)
        // Clearing quietly is just clearing.
        manipulator.select(null, { quiet: true })
        expect(manipulator.selectionIsQuiet).toBe(false)
    })

    it('counts edits that change the score and history travel, not navigation', () => {
        const { manipulator } = setupPitched()
        expect(manipulator.editCount).toBe(0)
        manipulator.run(MOVE_NEXT)
        expect(manipulator.editCount).toBe(0)
        manipulator.run(RAISE_PITCH)
        expect(manipulator.editCount).toBe(1)
        manipulator.undo()
        expect(manipulator.editCount).toBe(2)
        manipulator.redo()
        expect(manipulator.editCount).toBe(3)
        // Nothing to travel to: no count.
        manipulator.redo()
        expect(manipulator.editCount).toBe(3)
    })

    it('announces through the registered live region, and stays silent without one', () => {
        const { manipulator } = setupPitched()
        expect(() => manipulator.announce('Recording')).not.toThrow()
        const said: string[] = []
        manipulator.onAnnounce = (text) => said.push(text)
        manipulator.announce('Count-in')
        expect(said).toEqual(['Count-in'])
        expect(manipulator.requestTransport('toggle')).toBe(false)
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

    it('toggles a rest into a note on the middle line of the clef in effect (D3 under bass)', () => {
        const { manipulator, notes } = setupPitched()
        manipulator.select(notes[0])
        manipulator.run(TOGGLE_REST) // C5 → rest
        manipulator.setClefAt(0, 'bass')
        manipulator.run(TOGGLE_REST) // rest → note
        const pitch = manipulator.selectedNote?.pitch
        expect(`${pitch?.name}${pitch?.octave}`).toBe('D3')
    })

    it('runs a non-bulk action on the active note only and collapses the selection', () => {
        const { manipulator, notes } = setupPitched()
        manipulator.select(notes[0])
        manipulator.extendSelectionTo(notes[2])
        manipulator.run(SET_DURATION, 'h') // not bulk-flagged
        expect(manipulator.selectedNotes).toHaveLength(1)
    })
})

describe('ScoreManipulator remove-note measure reset', () => {
    /** A one-measure score holding two pitched half notes (C5 D5), attached to a manipulator. */
    function setupHalves(): { manipulator: ScoreManipulator; notes: Note[] } {
        const score = makeScore(1)
        const measure = score.firstMeasure
        if (!measure) throw new Error('expected a measure')
        const notes = score.replace(measure.notes, [pitched('C', 5, 'h'), pitched('D', 5, 'h')])
        const manipulator = new ScoreManipulator()
        manipulator.attach(score, () => undefined)
        return { manipulator, notes }
    }

    it('resets a measure to the default rhythm when removing leaves it holding only rests', () => {
        const { manipulator, notes } = setupHalves()
        manipulator.select(notes[1])
        manipulator.run(REMOVE_NOTE) // leaves [rest h, C5 h] — rhythm kept
        manipulator.select(allNotes(manipulator)[0])
        manipulator.run(REMOVE_NOTE) // last pitch removed — rhythm resets
        const measure = manipulator.score?.firstMeasure
        expect(measure?.notes.map((n) => n.duration.type)).toEqual(['q', 'q', 'q', 'q'])
        expect(measure?.notes.every((n) => n.isRest)).toBe(true)
        // The selection lands on the rest at the removed note's beat.
        expect(manipulator.selectedNote).toBe(measure?.notes[0])
    })

    it('keeps the rhythm when a pitched note remains in the measure', () => {
        const { manipulator, notes } = setupHalves()
        manipulator.select(notes[1])
        manipulator.run(REMOVE_NOTE)
        const measure = manipulator.score?.firstMeasure
        expect(measure?.notes.map((n) => n.duration.type)).toEqual(['h', 'h'])
        expect(measure?.notes[0]?.pitch?.name).toBe('C')
        expect(measure?.notes[1]?.isRest).toBe(true)
    })

    it('removes a whole selected run and re-anchors the selection on the reset rests', () => {
        const { manipulator, notes } = setupHalves()
        manipulator.select(notes[0])
        manipulator.extendSelectionTo(notes[1]) // both halves — the removal empties the measure
        manipulator.run(REMOVE_NOTE)
        const measure = manipulator.score?.firstMeasure
        expect(measure?.notes.map((n) => n.duration.type)).toEqual(['q', 'q', 'q', 'q'])
        expect(measure?.notes.every((n) => n.isRest)).toBe(true)
        // The selection spans the rests at the removed notes' beats (0 through 2).
        expect(manipulator.selectedNotes).toEqual(measure?.notes.slice(0, 3))
    })

    it('resets every emptied measure of a selection spanning multiple measures', () => {
        const score = makeScore(2)
        const [m1, m2] = score.measures
        score.replace(m1.notes, [pitched('C', 5, 'h'), pitched('D', 5, 'h')])
        score.replace(m2.notes, [pitched('E', 5, 'h'), pitched('F', 5, 'h')])
        const manipulator = new ScoreManipulator()
        manipulator.attach(score, () => undefined)
        manipulator.select(m1.notes[0])
        manipulator.extendSelectionTo(m2.notes[1])
        manipulator.run(REMOVE_NOTE)
        expect(m1.notes.map((n) => n.duration.type)).toEqual(['q', 'q', 'q', 'q'])
        expect(m2.notes.map((n) => n.duration.type)).toEqual(['q', 'q', 'q', 'q'])
        // Beat 0 of the first measure through beat 2 of the second.
        expect(manipulator.selectedNotes).toEqual([...m1.notes, ...m2.notes.slice(0, 3)])
    })
})

describe('ScoreManipulator delete selection', () => {
    /** A score of `count` all-rest measures (four quarter rests each), attached to a manipulator. */
    function setupRests(count: number): ScoreManipulator {
        const manipulator = new ScoreManipulator(new Keybindings(EDITOR_COMMANDS, { storageKey: 'test:editor-shortcuts', isMac: false }))
        manipulator.attach(makeScore(count), () => undefined)
        return manipulator
    }

    it('clears pitches (never removes measures) when the selection holds a pitched note', () => {
        const { manipulator, notes } = setupPitched()
        manipulator.select(notes[0])
        manipulator.extendSelectionTo(notes[3]) // the whole (only) measure, pitched
        manipulator.deleteSelection()
        expect(manipulator.score?.measures).toHaveLength(1)
        expect(allNotes(manipulator).every((n) => n.isRest)).toBe(true)
    })

    it('removes a measure covered whole by an all-rest selection and lands on what took its place', () => {
        const manipulator = setupRests(3)
        const [m0, m1, m2] = manipulator.score?.measures ?? []
        manipulator.select(m1.notes[0])
        manipulator.extendSelectionTo(m1.notes[3])
        manipulator.deleteSelection()
        expect(manipulator.score?.measures).toEqual([m0, m2])
        expect(manipulator.selectedNote).toBe(m2.notes[0])
        expect(manipulator.selectedNotes).toEqual([m2.notes[0]])
    })

    it('lands on the final note when the removed measures were the tail', () => {
        const manipulator = setupRests(3)
        const [m0, m1, m2] = manipulator.score?.measures ?? []
        manipulator.select(m1.notes[0])
        manipulator.extendSelectionTo(m2.notes[3])
        manipulator.deleteSelection()
        expect(manipulator.score?.measures).toEqual([m0])
        expect(manipulator.selectedNote).toBe(m0.notes[3])
    })

    it('removes only the whole measures and keeps the partially selected rests selected', () => {
        const manipulator = setupRests(3)
        const [m0, m1, m2] = manipulator.score?.measures ?? []
        manipulator.select(m0.notes[2])
        manipulator.extendSelectionTo(m1.notes[3]) // last two rests of m0 + all of m1
        manipulator.deleteSelection()
        expect(manipulator.score?.measures).toEqual([m0, m2])
        // The partial rests go through the regular remove path (the measure stays four quarter rests).
        expect(m0.notes.map((n) => n.duration.type)).toEqual(['q', 'q', 'q', 'q'])
        expect(manipulator.selectedNotes).toEqual(m0.notes.slice(2))
    })

    it('keeps one measure when the whole score is selected', () => {
        const manipulator = setupRests(3)
        const [m0] = manipulator.score?.measures ?? []
        manipulator.selectAll()
        manipulator.deleteSelection()
        expect(manipulator.score?.measures).toEqual([m0])
        // The surviving measure's rests go through the regular remove path and stay selected.
        expect(manipulator.selectedNotes).toEqual(m0.notes)
    })

    it('behaves like remove-note when the rest selection covers no whole measure', () => {
        const manipulator = setupRests(2)
        const [m0, m1] = manipulator.score?.measures ?? []
        manipulator.select(m0.notes[1])
        manipulator.extendSelectionTo(m1.notes[2])
        manipulator.deleteSelection()
        expect(manipulator.score?.measures).toEqual([m0, m1])
        expect(manipulator.selectedNotes).toEqual([...m0.notes.slice(1), ...m1.notes.slice(0, 3)])
    })

    it('registers the removal as a single undoable step', () => {
        const manipulator = setupRests(3)
        const [, m1] = manipulator.score?.measures ?? []
        manipulator.select(m1.notes[0])
        manipulator.extendSelectionTo(m1.notes[3])
        manipulator.deleteSelection()
        expect(manipulator.score?.measures).toHaveLength(2)
        expect(manipulator.undo()).toBe(true)
        expect(manipulator.score?.measures).toHaveLength(3)
        expect(manipulator.canUndo).toBe(false)
    })

    it('is what Backspace and the remove-note command run', () => {
        const manipulator = setupRests(2)
        const [m0, m1] = manipulator.score?.measures ?? []
        manipulator.select(m1.notes[0])
        manipulator.extendSelectionTo(m1.notes[3])
        const event = new KeyboardEvent('keydown', { cancelable: true, code: 'Backspace', key: 'Backspace' })
        manipulator.handleKeyDown(event)
        expect(event.defaultPrevented).toBe(true)
        expect(manipulator.score?.measures).toEqual([m0])
    })
})

describe('ScoreManipulator clipboard', () => {
    const pitchNames = (notes: Note[]): Array<string | undefined> => notes.map((n) => n.pitch?.name)

    it('reports nothing to paste until something is copied', () => {
        const { manipulator } = setupPitched()
        expect(manipulator.canPaste).toBe(false)
        manipulator.copy()
        expect(manipulator.canPaste).toBe(true)
    })

    it('copies a range and pastes it over the active note, overwriting forward', () => {
        const { manipulator, notes } = setupPitched() // C5 D5 E5 F5
        manipulator.select(notes[0])
        manipulator.extendSelectionTo(notes[1]) // copy C5 D5
        manipulator.copy()

        manipulator.select(notes[2]) // paste onto E5 (single selection) → overwrites E5 F5
        manipulator.paste()

        expect(pitchNames(allNotes(manipulator))).toEqual(['C', 'D', 'C', 'D'])
        // The two pasted notes are the new selection.
        expect(pitchNames(manipulator.selectedNotes)).toEqual(['C', 'D'])
    })

    it('replaces a selected range with the pasted clip', () => {
        const { manipulator, notes } = setupPitched()
        manipulator.select(notes[0]) // copy a single note (C5)
        manipulator.copy()

        manipulator.select(notes[2])
        manipulator.extendSelectionTo(notes[3]) // select E5 F5
        manipulator.paste() // one copied beat replaces a two-beat selection → C5 + padding rest

        const after = allNotes(manipulator)
        expect(after[2]?.pitch?.name).toBe('C')
        expect(after[3]?.isRest).toBe(true)
    })

    it('pastes independent clones — editing a paste does not change the clipboard', () => {
        const { manipulator, notes } = setupPitched()
        manipulator.select(notes[0])
        manipulator.copy()
        manipulator.select(notes[2])
        manipulator.paste()
        manipulator.run(RAISE_PITCH) // mutate the pasted note
        manipulator.select(notes[1])
        manipulator.paste() // clipboard is unaffected — still the original C5
        expect(allNotes(manipulator)[1]?.pitch?.name).toBe('C')
    })

    it('does nothing when the clipboard is empty', () => {
        const { manipulator } = setupPitched()
        const before = pitchNames(allNotes(manipulator))
        manipulator.paste()
        expect(pitchNames(allNotes(manipulator))).toEqual(before)
    })

    it('cut copies the selection and removes it from the score', () => {
        const { manipulator, notes } = setupPitched() // C5 D5 E5 F5
        manipulator.select(notes[0])
        manipulator.extendSelectionTo(notes[1]) // cut C5 D5
        manipulator.cut()

        expect(
            allNotes(manipulator)
                .slice(0, 2)
                .every((n) => n.isRest),
        ).toBe(true)
        expect(manipulator.canPaste).toBe(true)

        manipulator.select(allNotes(manipulator)[2]) // paste onto E5 → overwrites E5 F5
        manipulator.paste()
        expect(pitchNames(allNotes(manipulator))).toEqual([undefined, undefined, 'C', 'D'])
    })
})

describe('ScoreManipulator keyboard dispatch', () => {
    /** Run a synthetic keydown through the manipulator and report whether it consumed it. */
    function press(manipulator: ScoreManipulator, init: KeyboardEventInit): boolean {
        const event = new KeyboardEvent('keydown', { cancelable: true, ...init })
        manipulator.handleKeyDown(event)
        return event.defaultPrevented
    }

    it('runs the command bound to a keystroke and consumes it', () => {
        const { manipulator, notes } = setupPitched()
        expect(press(manipulator, { code: 'ArrowRight', key: 'ArrowRight' })).toBe(true)
        expect(manipulator.selectedNote).toBe(notes[1])
    })

    it('matches on the physical key with exact modifiers', () => {
        const { manipulator, notes } = setupPitched()
        expect(press(manipulator, { code: 'ArrowRight', key: 'ArrowRight', metaKey: true })).toBe(false)
        expect(manipulator.selectedNote).toBe(notes[0])
    })

    it('copies and pastes with the platform modifier', () => {
        const { manipulator, notes } = setupPitched() // C5 D5 E5 F5
        manipulator.select(notes[0])
        expect(press(manipulator, { code: 'KeyC', key: 'c', ctrlKey: true })).toBe(true)
        manipulator.select(notes[2])
        expect(press(manipulator, { code: 'KeyV', key: 'v', ctrlKey: true })).toBe(true)
        expect(allNotes(manipulator)[2]?.pitch?.name).toBe('C')
    })

    it('selects all with the platform modifier and consumes the keystroke', () => {
        const { manipulator } = setupPitched()
        expect(press(manipulator, { code: 'KeyA', key: 'a', ctrlKey: true })).toBe(true)
        expect(manipulator.selectedNotes).toHaveLength(4)
    })

    it('cuts with the platform modifier', () => {
        const { manipulator, notes } = setupPitched() // C5 D5 E5 F5
        manipulator.select(notes[1])
        expect(press(manipulator, { code: 'KeyX', key: 'x', ctrlKey: true })).toBe(true)
        expect(allNotes(manipulator)[1]?.isRest).toBe(true)
        expect(manipulator.canPaste).toBe(true)
    })

    it('extends the selection with shift+arrows and collapses it with Escape', () => {
        const { manipulator } = setupPitched()
        press(manipulator, { code: 'ArrowRight', key: 'ArrowRight', shiftKey: true })
        press(manipulator, { code: 'ArrowRight', key: 'ArrowRight', shiftKey: true })
        expect(manipulator.selectedNotes).toHaveLength(3)
        expect(press(manipulator, { code: 'Escape', key: 'Escape' })).toBe(true)
        expect(manipulator.selectedNotes).toHaveLength(1)
        // With nothing to collapse, Escape is left to the browser (it dismisses dialogs).
        expect(press(manipulator, { code: 'Escape', key: 'Escape' })).toBe(false)
    })

    it('toggles the active note to a rest with the default R binding', () => {
        const { manipulator, notes } = setupPitched()
        manipulator.select(notes[1])
        expect(press(manipulator, { code: 'KeyR', key: 'r' })).toBe(true)
        expect(manipulator.selectedNote?.isRest).toBe(true)
    })

    it('dispatches to a rebound key and releases the old one', () => {
        const { manipulator } = setupPitched()
        const shortcut = Shortcut.fromEvent(new KeyboardEvent('keydown', { code: 'KeyJ', key: 'j' }))
        if (!shortcut) throw new Error('expected a bindable shortcut')
        manipulator.keybindings.rebind('toggle-rest', shortcut)

        expect(press(manipulator, { code: 'KeyR', key: 'r' })).toBe(false)
        expect(manipulator.selectedNote?.isRest).toBe(false)
        expect(press(manipulator, { code: 'KeyJ', key: 'j' })).toBe(true)
        expect(manipulator.selectedNote?.isRest).toBe(true)
    })

    it('hands Space, ⇧Space and ⇧R to the page transport, and leaves them to the browser without one', () => {
        const { manipulator } = setupPitched()
        expect(press(manipulator, { code: 'Space', key: ' ' })).toBe(false)
        const requests: string[] = []
        manipulator.onTransportRequest = (request) => {
            requests.push(request)
            return request !== 'from-start'
        }
        expect(press(manipulator, { code: 'Space', key: ' ' })).toBe(true)
        expect(press(manipulator, { code: 'KeyR', key: 'R', shiftKey: true })).toBe(true)
        // Declined by the page: the keystroke stays the browser's.
        expect(press(manipulator, { code: 'Space', key: ' ', shiftKey: true })).toBe(false)
        expect(requests).toEqual(['toggle', 'record', 'from-start'])
    })

    it('lets Space press a focused button instead of the transport', () => {
        const { manipulator } = setupPitched()
        const requests: string[] = []
        manipulator.onTransportRequest = (request) => {
            requests.push(request)
            return true
        }
        for (const html of [
            '<button>Undo</button>',
            '<a href="/x">x</a>',
            '<div role="switch" tabindex="0"></div>',
            '<button><span>x</span></button>',
        ]) {
            const host = document.createElement('div')
            host.innerHTML = html
            const target = (host.querySelector('span') ?? host.firstElementChild) as HTMLElement
            host.addEventListener('keydown', manipulator.handleKeyDown)
            const event = new KeyboardEvent('keydown', { code: 'Space', key: ' ', cancelable: true, bubbles: true })
            target.dispatchEvent(event)
            expect(event.defaultPrevented, html).toBe(false)
        }
        expect(requests).toEqual([])
        // ⇧R doesn't yield: no control takes it natively.
        const host = document.createElement('div')
        host.innerHTML = '<button>Undo</button>'
        host.addEventListener('keydown', manipulator.handleKeyDown)
        const event = new KeyboardEvent('keydown', { code: 'KeyR', key: 'R', shiftKey: true, cancelable: true, bubbles: true })
        host.querySelector('button')?.dispatchEvent(event)
        expect(event.defaultPrevented).toBe(true)
        expect(requests).toEqual(['record'])
    })

    it('Escape stops a running take first; with no take it collapses the selection as before', () => {
        const { manipulator } = setupPitched()
        let recording = true
        manipulator.onTransportRequest = (request) => {
            if (request !== 'stop-recording' || !recording) return false
            recording = false
            return true
        }
        press(manipulator, { code: 'ArrowRight', key: 'ArrowRight', shiftKey: true })
        expect(manipulator.selectedNotes).toHaveLength(2)
        // The take claims Escape ahead of the collapse binding.
        expect(press(manipulator, { code: 'Escape', key: 'Escape' })).toBe(true)
        expect(recording).toBe(false)
        expect(manipulator.selectedNotes).toHaveLength(2)
        // Nothing running: Escape reaches its own binding again.
        expect(press(manipulator, { code: 'Escape', key: 'Escape' })).toBe(true)
        expect(manipulator.selectedNotes).toHaveLength(1)
        // A modified Escape is never the take's.
        recording = true
        expect(press(manipulator, { code: 'Escape', key: 'Escape', shiftKey: true })).toBe(false)
        expect(recording).toBe(true)
    })

    it('leaves keys typed into form fields alone', () => {
        const { manipulator, notes } = setupPitched()
        const input = document.createElement('input')
        input.addEventListener('keydown', manipulator.handleKeyDown)
        const event = new KeyboardEvent('keydown', { code: 'ArrowRight', key: 'ArrowRight', cancelable: true })
        input.dispatchEvent(event)
        expect(event.defaultPrevented).toBe(false)
        expect(manipulator.selectedNote).toBe(notes[0])
    })
})

describe('ScoreManipulator in-score attribute setters', () => {
    it('sets a clef from the start of the given measure', () => {
        const { manipulator } = setupPitched()
        manipulator.setClefAt(0, 'bass')
        expect(allNotes(manipulator)[0].clef.type).toBe('bass')
    })

    it('sets a key signature from the start of the given measure', () => {
        const { manipulator } = setupPitched()
        manipulator.setKeyAt(0, 3)
        expect(allNotes(manipulator)[0].keySignature.fifths).toBe(3)
    })

    it('sets a tempo at an explicit beat position', () => {
        const { manipulator } = setupPitched()
        manipulator.setTempoAt(0, 0, 132)
        expect(manipulator.score?.bpmAt(allNotes(manipulator)[0])).toBe(132)
    })

    it('ignores out-of-range measure indexes', () => {
        const { manipulator } = setupPitched()
        manipulator.setClefAt(9, 'bass')
        manipulator.setKeyAt(9, 3)
        manipulator.setTempoAt(9, 0, 132)
        expect(allNotes(manipulator)[0].clef.type).toBe('treble')
    })

    it('reports the active note position as its measure index and beat offset', () => {
        const { manipulator, notes } = setupPitched()
        manipulator.select(notes[2])
        expect(manipulator.activePosition).toEqual({ measureIndex: 0, beat: 2 })
        manipulator.select(null)
        expect(manipulator.activePosition).toBeNull()
    })

    it('applies a mid-measure clef change at the active position (the dock path)', () => {
        const { manipulator, notes } = setupPitched()
        manipulator.select(notes[2])
        const at = manipulator.activePosition
        if (!at) throw new Error('expected an active position')
        manipulator.setClefAt(at.measureIndex, 'bass', at.beat)
        expect(allNotes(manipulator).map((n) => n.clef.type)).toEqual(['treble', 'treble', 'bass', 'bass'])
    })

    it('keeps a range selection across a measure-context edit', () => {
        const { manipulator, notes } = setupPitched()
        manipulator.select(notes[1])
        manipulator.extendSelectionTo(notes[3])
        const at = manipulator.activePosition
        if (!at) throw new Error('expected an active position')
        manipulator.setKeyAt(at.measureIndex, 2, at.beat)
        expect(ids(manipulator.selectedNotes)).toEqual([notes[1].id, notes[2].id, notes[3].id])
    })

    it('collapses a range selection onto the active note when the meter changes (rebarring)', () => {
        const { manipulator, notes } = setupPitched()
        manipulator.select(notes[0])
        manipulator.extendSelectionTo(notes[1])
        manipulator.setTimeSignatureAt(0, 3, 4)
        expect(manipulator.score?.firstMeasure?.timeSignature.beatAmount).toBe(3)
        expect(ids(manipulator.selectedNotes)).toEqual([notes[1].id])
    })
})

describe('ScoreManipulator pitch operations (transpose / minimize accidentals)', () => {
    const spellings = (manipulator: ScoreManipulator): string[] =>
        allNotes(manipulator).map((n) =>
            n.pitch
                ? `${n.pitch.name}${n.pitch.alter > 0 ? '#'.repeat(n.pitch.alter) : 'b'.repeat(-n.pitch.alter)}${n.pitch.octave}`
                : 'rest',
        )

    it('transposes the whole score (keys included) and re-anchors the active note by position', () => {
        const { manipulator, notes } = setupPitched()
        manipulator.select(notes[1]) // D5
        manipulator.transpose(Interval.fromParts(2, 'major'), 'score')
        expect(manipulator.score?.firstMeasure?.keySignature.fifths).toBe(2) // C → D major
        expect(spellings(manipulator)).toEqual(['D5', 'E5', 'F#5', 'G5'])
        expect(manipulator.selectedNote).toBe(allNotes(manipulator)[1]) // same position, new identity
    })

    it('transposes only the selection, leaving the key in place, and keeps it selected', () => {
        const { manipulator, notes } = setupPitched()
        manipulator.select(notes[0])
        manipulator.extendSelectionTo(notes[1])
        manipulator.transpose(Interval.fromParts(2, 'major'), 'selection')
        expect(manipulator.score?.firstMeasure?.keySignature.fifths).toBe(0)
        expect(spellings(manipulator)).toEqual(['D5', 'E5', 'E5', 'F5'])
        expect(ids(manipulator.selectedNotes)).toEqual(ids(allNotes(manipulator).slice(0, 2)))
    })

    it('only a multi-note selection narrows a pitch operation: a single note transposes the whole score', () => {
        const { manipulator } = setupPitched() // C5 selected
        expect(manipulator.selectionNarrowsPitchOps).toBe(false)
        manipulator.transpose(Interval.fromParts(2, 'major'), 'selection')
        expect(manipulator.score?.firstMeasure?.keySignature.fifths).toBe(2) // re-keyed: the whole score moved
        expect(spellings(manipulator)).toEqual(['D5', 'E5', 'F#5', 'G5'])

        manipulator.select(allNotes(manipulator)[0])
        manipulator.extendSelectionTo(allNotes(manipulator)[1])
        expect(manipulator.selectionNarrowsPitchOps).toBe(true)
    })

    it('a transpose is one undoable step', () => {
        const { manipulator } = setupPitched()
        manipulator.transpose(Interval.fromParts(2, 'major'), 'score')
        expect(manipulator.canUndo).toBe(true)
        manipulator.undo()
        expect(spellings(manipulator)).toEqual(['C5', 'D5', 'E5', 'F5'])
        expect(manipulator.score?.firstMeasure?.keySignature.fifths).toBe(0)
    })

    it('minimize-accidentals on a single-note selection re-keys the whole score and keeps the selection put', () => {
        const { manipulator } = setupPitched()
        const score = manipulator.score
        if (!score?.firstMeasure) throw new Error('expected a score')
        // Rewrite to an unambiguous E-major melody spelled with accidentals in C major.
        score.replace(score.firstMeasure.notes, [
            new Note({ duration: new Duration({ type: 'q' }), pitch: new Pitch({ name: 'G', octave: 4, alter: 1 }) }),
            new Note({ duration: new Duration({ type: 'q' }), pitch: new Pitch({ name: 'C', octave: 5, alter: 1 }) }),
            new Note({ duration: new Duration({ type: 'q' }), pitch: new Pitch({ name: 'D', octave: 5, alter: 1 }) }),
            new Note({ duration: new Duration({ type: 'q' }), pitch: new Pitch({ name: 'F', octave: 4, alter: 1 }) }),
        ])
        manipulator.select(allNotes(manipulator)[2])
        manipulator.minimizeAccidentals()
        expect(manipulator.score?.firstMeasure?.keySignature.fifths).toBe(4)
        expect(manipulator.selectedNote).toBe(allNotes(manipulator)[2])
    })

    it('minimize-accidentals on a multi-note selection respells in place without re-keying', () => {
        const { manipulator } = setupPitched()
        const score = manipulator.score
        if (!score?.firstMeasure) throw new Error('expected a score')
        score.setKeySignature(score.firstMeasure.firstNote, -1) // F major
        score.replace(
            [score.firstMeasure.notes[0]],
            [new Note({ duration: new Duration({ type: 'q' }), pitch: new Pitch({ name: 'A', octave: 4, alter: 1 }) })],
        )
        const notes = allNotes(manipulator)
        manipulator.select(notes[0])
        manipulator.extendSelectionTo(notes[1])
        manipulator.minimizeAccidentals()
        expect(manipulator.score?.firstMeasure?.keySignature.fifths).toBe(-1)
        expect(spellings(manipulator)[0]).toBe('Bb4') // A♯ → B♭ (in key)
        expect(ids(manipulator.selectedNotes)).toEqual(ids(allNotes(manipulator).slice(0, 2)))
    })

    it('flashes the whole score after a whole-score operation, the selection after a selection-scoped one', () => {
        const { manipulator } = setupPitched()
        const flashes: Array<Note[] | 'all'> = []
        manipulator.onPitchHighlight = (notes) => flashes.push(notes)

        manipulator.minimizeAccidentals() // single-note selection → whole score
        expect(flashes).toEqual(['all'])

        manipulator.transpose(Interval.fromParts(2, 'major'), 'score')
        expect(flashes).toEqual(['all', 'all'])

        const notes = allNotes(manipulator)
        manipulator.select(notes[0])
        manipulator.extendSelectionTo(notes[1])
        manipulator.transpose(Interval.fromParts(2, 'major'), 'selection')
        expect(flashes).toHaveLength(3)
        // The flash carries the replacement identities — the notes now living in the score.
        expect(flashes[2]).toEqual(allNotes(manipulator).slice(0, 2))

        manipulator.minimizeAccidentals() // multi-note selection → that selection
        expect(flashes).toHaveLength(4)
        expect(flashes[3]).toEqual(manipulator.selectedNotes)
    })

    it('minimize-accidentals via the manipulator method needs a selection to act on', () => {
        const manipulator = new ScoreManipulator()
        let fired = 0
        manipulator.onPitchHighlight = () => fired++
        manipulator.minimizeAccidentals() // no score attached
        expect(fired).toBe(0)
    })

    it('the transpose command defers to the registered popover opener and declines without one', () => {
        const { manipulator } = setupPitched()
        const command = EDITOR_COMMANDS.find((c) => c.id === 'transpose')
        if (!command) throw new Error('expected the transpose command')
        expect(command.run(manipulator)).toBe(false) // nothing registered: leave the key to the browser
        let opened = 0
        manipulator.onTransposeRequest = () => {
            opened++
        }
        command.run(manipulator)
        expect(opened).toBe(1)
    })
})

describe('ScoreManipulator autosave', () => {
    it('saves a real change and never a move that changed nothing', () => {
        const { manipulator, saves } = setupPitched()
        manipulator.run(MOVE_NEXT)
        manipulator.run(MOVE_PREVIOUS)
        expect(saves).toHaveLength(0)
        manipulator.run(RAISE_PITCH)
        expect(saves).toHaveLength(1)
    })
})

describe('ScoreManipulator undo offers', () => {
    function withOffers() {
        const setup = setupPitched()
        const offers: UndoOffer[] = []
        setup.manipulator.onUndoOffer = (offer) => offers.push(offer)
        return { ...setup, offers }
    }

    it('offers removing a bar that held notes, naming it — never an empty one, nor the only bar', () => {
        const { manipulator, offers } = withOffers()
        manipulator.addMeasure()
        manipulator.removeMeasure() // the added bar: rests only
        expect(offers).toEqual([])
        manipulator.removeMeasure() // the only bar left: refused
        expect(manipulator.score?.measures).toHaveLength(1)
        expect(offers).toEqual([])

        manipulator.addMeasure()
        manipulator.select(manipulator.score?.lastMeasure?.firstNote ?? null)
        manipulator.run(TOGGLE_REST) // a pitched note in bar 2
        manipulator.removeMeasure()
        expect(offers).toEqual([{ message: 'Removed bar 2.', undoLabel: UNDO_CHANGE_LABEL, step: manipulator.editCount }])
    })

    it('offers a delete from the selection actions, and only when asked', () => {
        const { manipulator, notes, offers } = withOffers()
        manipulator.select(notes[0])
        manipulator.deleteSelection() // Backspace: no offer
        expect(offers).toEqual([])
        manipulator.select(allNotes(manipulator)[1])
        manipulator.deleteSelection({ offerUndo: true })
        expect(offers.at(-1)).toMatchObject({ message: 'Deleted the note.', undoLabel: UNDO_DELETE_LABEL })
        const [, , third, fourth] = allNotes(manipulator)
        manipulator.select(third)
        manipulator.extendSelectionTo(fourth)
        manipulator.deleteSelection({ offerUndo: true })
        expect(offers.at(-1)?.message).toBe('Deleted 2 notes.')
        // A rest alone, in a bar it doesn't cover whole: nothing changes, nothing is offered.
        const count = offers.length
        manipulator.select(allNotes(manipulator)[0])
        manipulator.deleteSelection({ offerUndo: true })
        expect(offers).toHaveLength(count)
    })

    it('offers removing whole bars from the selection actions', () => {
        const manipulator = new ScoreManipulator()
        manipulator.attach(makeScore(4), () => undefined)
        const offers: UndoOffer[] = []
        manipulator.onUndoOffer = (offer) => offers.push(offer)
        const measures = manipulator.score?.measures ?? []
        manipulator.select(measures[1].firstNote)
        manipulator.extendSelectionTo(measures[1].notes[measures[1].notes.length - 1])
        manipulator.deleteSelection({ offerUndo: true })
        expect(offers.at(-1)).toMatchObject({ message: 'Removed the bar.', undoLabel: UNDO_DELETE_LABEL })
        manipulator.selectAll()
        manipulator.deleteSelection({ offerUndo: true }) // three bars selected, one is kept
        expect(offers.at(-1)?.message).toBe('Removed 2 bars.')
    })

    it('offers a transpose, simplifying sharps and flats and a meter change — each only when it changed something', () => {
        const { manipulator, offers } = withOffers()
        manipulator.transpose(Interval.fromSemitones(2), 'score')
        expect(offers.at(-1)?.message).toBe('Moved 2 half steps higher.')
        manipulator.transpose(Interval.fromSemitones(-1), 'score')
        expect(offers.at(-1)?.message).toBe('Moved 1 half step lower.')
        manipulator.transpose(new Interval(0, 1), 'score')
        expect(offers.at(-1)?.message).toBe('Respelled the notes.')
        const before = offers.length
        manipulator.transpose(new Interval(0, 0), 'score') // no move at all
        expect(offers).toHaveLength(before)

        manipulator.setTimeSignatureAt(0, 3, 4)
        expect(offers.at(-1)).toEqual({
            message: 'Changed to 3/4 — bars regrouped.',
            undoLabel: UNDO_CHANGE_LABEL,
            step: manipulator.editCount,
        })
        const afterMeter = offers.length
        manipulator.setTimeSignatureAt(0, 3, 4) // the same meter
        expect(offers).toHaveLength(afterMeter)

        const { manipulator: plain, offers: plainOffers } = withOffers()
        plain.minimizeAccidentals() // C major, nothing to respell
        expect(plainOffers).toEqual([])
        plain.selectAll()
        plain.run(SET_ACCIDENTAL, '#')
        plain.collapseSelection()
        plain.minimizeAccidentals()
        expect(plainOffers.at(-1)?.message).toBe('Tidied sharps and flats.')
    })

    it('undoes the offered step only while it is still the latest', () => {
        const { manipulator, offers } = withOffers()
        manipulator.transpose(Interval.fromSemitones(2), 'score')
        const stale = offers[0]
        manipulator.run(RAISE_PITCH) // a newer edit
        expect(manipulator.undoStep(stale.step)).toBe(false)
        manipulator.transpose(Interval.fromSemitones(2), 'score')
        const fresh = offers.at(-1)
        if (!fresh) throw new Error('expected an offer')
        const before = manipulator.editCount
        expect(manipulator.undoStep(fresh.step)).toBe(true)
        expect(manipulator.editCount).toBe(before + 1)
    })

    it('stays silent without a listener', () => {
        const { manipulator } = setupPitched()
        expect(() => manipulator.transpose(Interval.fromSemitones(2), 'score')).not.toThrow()
    })
})

describe('ScoreManipulator speech', () => {
    function listening() {
        const setup = setupPitched()
        const said: string[] = []
        setup.manipulator.onAnnounce = (text) => said.push(text)
        return { ...setup, said }
    }

    it('names a picked note and where it sits, and a run by its size and bars', () => {
        const { manipulator, notes, said } = listening()
        manipulator.select(notes[2])
        expect(said.at(-1)).toBe('E, quarter note. Bar 1, beat 3.')
        manipulator.extendSelectionTo(notes[3])
        expect(said.at(-1)).toBe('2 notes selected, bar 1.')
        manipulator.addMeasure()
        manipulator.selectAll()
        expect(said.at(-1)).toBe('8 notes selected, bars 1 to 2.')
        manipulator.collapseSelection()
        expect(said.at(-1)).toBe('Quarter rest. Bar 2, beat 4.')
        manipulator.select(allNotes(manipulator)[0])
        manipulator.extendSelectionByStep(1)
        expect(said.at(-1)).toBe('2 notes selected, bar 1.')
    })

    it('reads a move, a pitch edit, a length edit and any other edit back in plain words', () => {
        const { manipulator, said } = listening()
        manipulator.run(MOVE_NEXT)
        expect(said.at(-1)).toBe('D, quarter note. Bar 1, beat 2.')
        manipulator.run(RAISE_PITCH)
        expect(said.at(-1)).toBe('E.')
        manipulator.run(SET_ACCIDENTAL, '#')
        expect(said.at(-1)).toBe('E sharp.')
        manipulator.run(SET_DURATION, '8')
        expect(said.at(-1)).toBe('Eighth note.')
        manipulator.run(TOGGLE_REST)
        expect(said.at(-1)).toBe('Eighth rest.')

        // A move that goes nowhere (back from the first note) and an edit of a run say nothing.
        manipulator.select(allNotes(manipulator)[0])
        const afterSelect = said.length
        manipulator.run(MOVE_PREVIOUS)
        expect(said).toHaveLength(afterSelect)
        manipulator.selectAll()
        manipulator.run(RAISE_PITCH)
        expect(said).toHaveLength(afterSelect + 1) // just the select-all
    })

    it('counts beats in the felt pulse: two to a bar of 6/8', () => {
        const { manipulator, said } = listening()
        manipulator.setTimeSignatureAt(0, 6, 8)
        const secondBeat = allNotes(manipulator).find((note) => note.measure.beatOffsetOf(note) === 1.5)
        if (!secondBeat) throw new Error('expected a note on the second dotted-quarter beat')
        manipulator.select(secondBeat)
        expect(said.at(-1)).toMatch(new RegExp(`Bar ${secondBeat.measure.index + 1}, beat 2\\.$`))
        const offBeat = allNotes(manipulator).find((note) => note.measure.beatOffsetOf(note) === 1)
        if (!offBeat) throw new Error('expected a note between the two beats')
        manipulator.select(offBeat)
        expect(said.at(-1)).toMatch(/, beat 1\.$/)
    })

    it('stays quiet for quiet selections and while a recording holds the history', () => {
        const { manipulator, notes, said } = listening()
        manipulator.select(notes[1], { quiet: true })
        manipulator.select(null)
        expect(said).toEqual([])
        const release = manipulator.lockHistory()
        manipulator.select(notes[2])
        expect(said).toEqual([])
        release()
        manipulator.select(notes[2])
        expect(said).toHaveLength(1)
    })
})

describe('KeyboardHelpText', () => {
    it('says the default keys in words', () => {
        const { manipulator } = setupPitched()
        expect(KeyboardHelpText.of(manipulator.keybindings)).toBe(
            'Left and right arrows move between notes. Up and down change the pitch. The Keyboard shortcuts button lists them all.',
        )
    })

    it('follows a rebound key and drops the sentence of an unbound one', () => {
        const { manipulator } = setupPitched()
        const keys = manipulator.keybindings
        keys.rebind(MOVE_NEXT.id, Shortcut.parse('KeyJ', false, 'j'))
        keys.rebind(LOWER_PITCH.id, Shortcut.parse('KeyK', false, 'k'))
        expect(KeyboardHelpText.of(keys)).toBe(
            'Left arrow and J move between notes. Up arrow and K change the pitch. The Keyboard shortcuts button lists them all.',
        )
        keys.unbind(RAISE_PITCH.id)
        expect(KeyboardHelpText.of(keys)).toBe('Left arrow and J move between notes. The Keyboard shortcuts button lists them all.')
    })
})

describe('EditorSpeech', () => {
    it('says nothing for an empty selection', () => {
        expect(EditorSpeech.selection([])).toBeNull()
    })
})
