import { makeScore, pitched } from '@mushee/notation/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { LOWER_PITCH, RAISE_PITCH, SET_ACCIDENTAL, TOGGLE_REST } from '@/app/scores/[id]/actions'
import { EDITOR_COMMANDS, LENGTH_NEEDS_ONE_NOTE } from '@/app/scores/[id]/commands'
import {
    NEEDS_A_NOTE,
    NoteToolStates,
    REST_HAS_NO_PITCH,
    RESTS_HAVE_NO_PITCH,
    ScoreSettingsWords,
    STOP_RECORDING_FIRST,
    TIE_NEEDS_SAME_PITCH,
} from '@/app/scores/[id]/NoteToolParts'
import { MOVE_NOTE_HINT_KEY, OneTimeHint } from '@/app/scores/[id]/OneTimeHint'
import { ScoreManipulator } from '@/app/scores/[id]/ScoreManipulator'
import { Keybindings } from '@/lib/Keybindings'

import { allNotes, setupPitched } from './editorFixtures'

beforeEach(() => {
    localStorage.clear()
})

afterEach(() => {
    vi.restoreAllMocks()
})

/** A manipulator over `count` measures, the first holding the given notes (the rest: quarter rests). */
function setup(notes = [pitched('C', 5), pitched('D', 5), pitched('E', 5), pitched('F', 5)], count = 1) {
    const score = makeScore(count)
    const first = score.firstMeasure
    if (!first) throw new Error('expected a measure')
    score.replace(first.notes, notes)
    const manipulator = new ScoreManipulator(new Keybindings(EDITOR_COMMANDS, { storageKey: 'test:tools', isMac: false }))
    manipulator.attach(score, () => undefined)
    return { manipulator, score, notes: allNotes(manipulator) }
}

const keydown = (init: KeyboardEventInit) => new KeyboardEvent('keydown', { cancelable: true, ...init })

describe('ScoreManipulator settings position', () => {
    it('reads and writes at the active note', () => {
        const { manipulator, notes } = setup()
        manipulator.select(notes[2])
        expect(manipulator.settingsPosition).toEqual({ measureIndex: 0, beat: 2 })
        expect(manipulator.settings).toMatchObject({ clef: 'treble', timeSignature: { beatAmount: 4, beatType: 4 } })
        expect(manipulator.settings?.key.fifths).toBe(0)
    })

    it("with nothing selected shows bar 1's real values — never a made-up default tempo or meter", () => {
        const { manipulator, score } = setup()
        manipulator.setTempoAt(0, 0, 108)
        manipulator.setTimeSignatureAt(0, 3, 4)
        manipulator.select(null)
        expect(manipulator.settingsPosition).toEqual({ measureIndex: 0, beat: 0 })
        expect(manipulator.settings?.bpm).toBe(108)
        expect(manipulator.settings?.timeSignature).toMatchObject({ beatAmount: 3, beatType: 4 })
        // …and a change there lands at bar 1, beat 0.
        manipulator.changeKey(2)
        manipulator.changeClef('bass')
        manipulator.changeTempo(72)
        expect(score.firstMeasure?.keySignature.fifths).toBe(2)
        expect(score.firstMeasure?.clef.type).toBe('bass')
        expect(manipulator.settings?.bpm).toBe(72)
        manipulator.changeTimeSignature(2, 4)
        expect(score.firstMeasure?.timeSignature).toMatchObject({ beatAmount: 2, beatType: 4 })
    })

    it('while a take holds the history, follows the bar the take started in', () => {
        const { manipulator } = setup(undefined, 3)
        manipulator.setTimeSignatureAt(2, 6, 8)
        manipulator.select(manipulator.score?.measures[2].firstNote ?? null) // a rest in bar 3 (6/8)
        const release = manipulator.lockHistory()
        manipulator.select(null) // the take clears the selection as it starts
        expect(manipulator.settingsPosition).toEqual({ measureIndex: 2, beat: 0 })
        expect(manipulator.settings?.timeSignature).toMatchObject({ beatAmount: 6, beatType: 8 })
        release()
        expect(manipulator.settingsPosition).toEqual({ measureIndex: 0, beat: 0 })
    })

    it('shows but never changes the settings while a take holds the history', () => {
        const { manipulator, score } = setup(undefined, 2)
        manipulator.setTempoAt(0, 0, 100)
        manipulator.select(score.measures[1].firstNote)
        const release = manipulator.lockHistory()
        manipulator.select(null)
        expect(manipulator.historyLocked).toBe(true)
        const version = score.version
        // The take is still writing into bar 2: every dock change is declined.
        manipulator.changeClef('bass')
        manipulator.changeKey(2)
        manipulator.changeTimeSignature(3, 4)
        manipulator.changeTempo(72)
        expect(score.version).toBe(version)
        expect(score.measures[1].clef.type).toBe('treble')
        expect(manipulator.settings).toMatchObject({ clef: 'treble', bpm: 100, timeSignature: { beatAmount: 4, beatType: 4 } })
        // …a note picked mid-take included.
        manipulator.select(score.measures[1].firstNote)
        manipulator.changeKey(2)
        expect(score.version).toBe(version)
        // The chips say why they are off.
        expect(new NoteToolStates(manipulator).scoreSettings).toEqual({ active: false, disabled: true, reason: STOP_RECORDING_FIRST })

        release()
        expect(manipulator.historyLocked).toBe(false)
        expect(new NoteToolStates(manipulator).scoreSettings).toEqual({ active: false, disabled: false })
        manipulator.changeKey(2)
        expect(score.measures[1].keySignature.fifths).toBe(2)
    })

    it('is null without a score', () => {
        const manipulator = new ScoreManipulator()
        expect(manipulator.settingsPosition).toBeNull()
        expect(manipulator.settings).toBeNull()
        // Nothing to change: no throw.
        manipulator.changeClef('bass')
        manipulator.changeKey(1)
        manipulator.changeTimeSignature(3, 4)
        manipulator.changeTempo(100)
    })
})

describe('ScoreManipulator selection reads', () => {
    it('reports what a run shares, and null where it is mixed', () => {
        const { manipulator, notes } = setup([pitched('C', 5, 'h'), pitched('D', 5), pitched('E', 5)])
        manipulator.select(notes[1])
        manipulator.extendSelectionTo(notes[2])
        expect(manipulator.isRangeSelected).toBe(true)
        expect(manipulator.selectionDuration).toBe('q')
        expect(manipulator.selectionAccidental).toBeUndefined() // both natural: a shared "none"
        manipulator.extendSelectionTo(notes[0])
        expect(manipulator.selectionDuration).toBeNull() // half + quarters
        expect(manipulator.selectionDotted).toBe(false)
        expect(manipulator.selectionInTuplet).toBe(false)
    })

    it('tells a mixed accidental (null) from a shared natural (undefined)', () => {
        const { manipulator, notes } = setup()
        manipulator.select(notes[0])
        manipulator.extendSelectionTo(notes[1])
        expect(manipulator.selectionAccidental).toBeUndefined()
        manipulator.select(notes[0])
        manipulator.run(SET_ACCIDENTAL, '#') // sharpen C5 alone
        manipulator.extendSelectionTo(allNotes(manipulator)[1])
        expect(manipulator.selectionAccidental).toBeNull()
        manipulator.collapseSelection()
        manipulator.select(allNotes(manipulator)[0])
        expect(manipulator.selectionAccidental).toBe('#')
    })

    it('has nothing to share with nothing selected', () => {
        const { manipulator } = setup()
        manipulator.select(null)
        expect(manipulator.selectionDuration).toBeNull()
        expect(manipulator.selectionAccidental).toBeNull()
        expect(manipulator.isRangeSelected).toBe(false)
        expect(manipulator.canTie).toBe(false)
    })

    it('offers Tie only where it would bind', () => {
        const { manipulator, notes } = setup([pitched('C', 5), pitched('C', 5), pitched('E', 5), pitched('F', 5)])
        manipulator.select(notes[0])
        expect(manipulator.canTie).toBe(true)
        manipulator.select(notes[1])
        expect(manipulator.canTie).toBe(false)
        expect(new ScoreManipulator().canTie).toBe(false)
    })
})

describe('length keys on a run', () => {
    it('decline — the keystroke is left alone and no note changes', () => {
        const { manipulator, notes } = setup()
        manipulator.select(notes[0])
        manipulator.extendSelectionTo(notes[1])
        for (const init of [
            { code: 'KeyH', key: 'h' },
            { code: 'Period', key: '.' },
            { code: 'Digit3', key: '3' },
        ]) {
            const event = keydown(init)
            manipulator.handleKeyDown(event)
            expect(event.defaultPrevented).toBe(false)
        }
        expect(allNotes(manipulator).map((note) => note.duration.type)).toEqual(['q', 'q', 'q', 'q'])
    })

    it('still act on a single note', () => {
        const { manipulator } = setupPitched()
        const event = keydown({ code: 'KeyH', key: 'h' })
        manipulator.handleKeyDown(event)
        expect(event.defaultPrevented).toBe(true)
        expect(manipulator.selectedNote?.duration.type).toBe('h')
    })
})

describe('selection menu from the keyboard', () => {
    it('is declined until the editor registers, and with nothing selected', () => {
        const { manipulator } = setup()
        expect(manipulator.requestSelectionMenu()).toBe(false)
        const open = vi.fn()
        manipulator.onSelectionMenuRequest = open
        manipulator.select(null)
        expect(manipulator.requestSelectionMenu()).toBe(false)
        expect(open).not.toHaveBeenCalled()
    })

    it('opens on Shift+F10 and on the Menu key', () => {
        const { manipulator } = setup()
        const open = vi.fn()
        manipulator.onSelectionMenuRequest = open
        const shiftF10 = keydown({ code: 'F10', key: 'F10', shiftKey: true })
        manipulator.handleKeyDown(shiftF10)
        const menuKey = keydown({ code: 'ContextMenu', key: 'ContextMenu' })
        manipulator.handleKeyDown(menuKey)
        expect(open).toHaveBeenCalledTimes(2)
        expect(shiftF10.defaultPrevented).toBe(true)
        expect(menuKey.defaultPrevented).toBe(true)
    })
})

describe('the shortcuts list from the keyboard', () => {
    it("opens on '?' however the layout types it, and is declined until the editor registers", () => {
        const { manipulator } = setup()
        // US layout: Shift+Slash types '?'.
        const unregistered = keydown({ code: 'Slash', key: '?', shiftKey: true })
        manipulator.handleKeyDown(unregistered)
        expect(unregistered.defaultPrevented).toBe(false)

        const open = vi.fn()
        manipulator.onShortcutsRequest = open
        const us = keydown({ code: 'Slash', key: '?', shiftKey: true })
        manipulator.handleKeyDown(us)
        // AZERTY: Shift+Comma (physical KeyM) types it; an AltGr layout types it with Ctrl+Alt.
        const azerty = keydown({ code: 'KeyM', key: '?', shiftKey: true })
        manipulator.handleKeyDown(azerty)
        const altGr = keydown({ code: 'Minus', key: '?', ctrlKey: true, altKey: true })
        manipulator.handleKeyDown(altGr)
        expect(open).toHaveBeenCalledTimes(3)
        expect([us, azerty, altGr].every((event) => event.defaultPrevented)).toBe(true)
    })

    it("leaves '/' and ⌘ / Ctrl + '?' alone", () => {
        const { manipulator } = setup()
        const open = vi.fn()
        manipulator.onShortcutsRequest = open
        for (const init of [
            { code: 'Slash', key: '/' },
            { code: 'Slash', key: '?', shiftKey: true, metaKey: true },
            { code: 'Slash', key: '?', shiftKey: true, ctrlKey: true },
        ]) {
            const event = keydown(init)
            manipulator.handleKeyDown(event)
            expect(event.defaultPrevented).toBe(false)
        }
        expect(open).not.toHaveBeenCalled()
    })
})

describe('the transpose shortcut', () => {
    it('opens the popover, but declines on a score of rests — nothing to move', () => {
        const { manipulator } = setup([pitched('C', 5), pitched('D', 5), pitched('E', 5), pitched('F', 5)])
        const open = vi.fn()
        manipulator.onTransposeRequest = open
        const withNotes = keydown({ code: 'KeyT', key: 'T', shiftKey: true })
        manipulator.handleKeyDown(withNotes)
        expect(open).toHaveBeenCalledTimes(1)
        expect(withNotes.defaultPrevented).toBe(true)

        const empty = new ScoreManipulator(new Keybindings(EDITOR_COMMANDS, { storageKey: 'test:tools', isMac: false }))
        empty.attach(makeScore(1), () => undefined)
        empty.onTransposeRequest = open
        const onRests = keydown({ code: 'KeyT', key: 'T', shiftKey: true })
        empty.handleKeyDown(onRests)
        expect(open).toHaveBeenCalledTimes(1)
        expect(onRests.defaultPrevented).toBe(false)
    })
})

describe('the move-a-note hint', () => {
    it('stays until the first pitch edit, then is gone for good on this device', () => {
        const { manipulator } = setup()
        expect(manipulator.moveNoteHint.pending).toBe(true)
        manipulator.run(TOGGLE_REST) // not a pitch move
        expect(manipulator.moveNoteHint.pending).toBe(true)
        manipulator.run(RAISE_PITCH)
        expect(manipulator.moveNoteHint.pending).toBe(false)
        expect(new OneTimeHint(MOVE_NOTE_HINT_KEY).pending).toBe(false)
    })

    it('teaches only on a pitched note: a selected rest leaves it pending for the first real note', () => {
        const rests = makeScore(1)
        const manipulator = new ScoreManipulator(new Keybindings(EDITOR_COMMANDS, { storageKey: 'test:tools', isMac: false }))
        manipulator.attach(rests, () => undefined)
        // An all-rest score (the first empty score) selects its first rest: no "To move a note" line.
        expect(manipulator.selectedNote?.isRest).toBe(true)
        expect(new NoteToolStates(manipulator).moveNoteHint).toBe(false)
        expect(manipulator.moveNoteHint.pending).toBe(true)

        const { manipulator: pitchedEditor } = setup()
        expect(pitchedEditor.selectedNote?.isRest).toBe(false)
        expect(new NoteToolStates(pitchedEditor).moveNoteHint).toBe(true)
        pitchedEditor.select(null)
        expect(new NoteToolStates(pitchedEditor).moveNoteHint).toBe(false)
    })

    it('shows again next visit when storage is unavailable — and never throws', () => {
        vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
            throw new Error('blocked')
        })
        vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
            throw new Error('blocked')
        })
        const hint = new OneTimeHint('test:hint')
        expect(hint.pending).toBe(true)
        hint.markSeen()
        expect(hint.pending).toBe(false)
        hint.markSeen() // idempotent
        expect(new OneTimeHint('test:hint').pending).toBe(true)
    })
})

describe('Higher / Lower on rests', () => {
    it('turn a lone rest into a note on the middle line, spelled in the key', () => {
        const { manipulator, notes } = setup(undefined, 2)
        manipulator.select(notes[4])
        manipulator.run(RAISE_PITCH)
        expect(manipulator.selectedNote?.pitch).toMatchObject({ name: 'B', alter: 0, octave: 4 })
        expect(manipulator.moveNoteHint.pending).toBe(false)

        manipulator.changeKey(-1) // F major from bar 2: its middle line is B flat
        manipulator.select(allNotes(manipulator)[5])
        manipulator.run(LOWER_PITCH)
        expect(manipulator.selectedNote?.pitch).toMatchObject({ name: 'B', alter: -1, octave: 4 })
    })

    it('leave the rests in a run silent while its notes move', () => {
        const { manipulator, notes } = setup(undefined, 2)
        manipulator.select(notes[3])
        manipulator.extendSelectionTo(notes[4])
        manipulator.run(RAISE_PITCH)
        const [moved, rest] = manipulator.selectedNotes
        expect(moved.pitch?.name).toBe('G')
        expect(rest.isRest).toBe(true)
    })
})

describe('NoteToolStates', () => {
    it('turns every note tool off with nothing selected, saying why', () => {
        const { manipulator } = setup()
        manipulator.select(null)
        const tools = new NoteToolStates(manipulator)
        for (const state of [
            tools.duration,
            tools.dotted,
            tools.triplet,
            tools.rest,
            tools.tie,
            tools.accidental,
            tools.pitch,
            tools.simplify,
        ]) {
            expect(state).toMatchObject({ disabled: true, reason: NEEDS_A_NOTE })
        }
        expect(tools.duration.value).toBeNull()
    })

    it('presses what the single selected note is', () => {
        const { manipulator } = setupPitched()
        const tools = new NoteToolStates(manipulator)
        expect(tools.duration).toMatchObject({ value: 'q', disabled: false })
        expect(tools.accidental).toMatchObject({ value: undefined, disabled: false })
        expect(tools.rest).toMatchObject({ active: false, disabled: false })
        expect(tools.dotted).toMatchObject({ active: false, disabled: false })
        expect(tools.triplet.disabled).toBe(false)
        expect(tools.pitch.disabled).toBe(false)
    })

    it('turns the length tools off on a run, with the reason, but keeps the others', () => {
        const { manipulator, notes } = setup()
        manipulator.select(notes[0])
        manipulator.extendSelectionTo(notes[1])
        const tools = new NoteToolStates(manipulator)
        for (const state of [tools.duration, tools.dotted, tools.triplet]) {
            expect(state).toMatchObject({ disabled: true, reason: LENGTH_NEEDS_ONE_NOTE })
        }
        expect(tools.duration.value).toBe('q')
        expect(tools.rest.disabled).toBe(false)
        expect(tools.accidental.disabled).toBe(false)
    })

    it('says why Tie is off, and leaves a tool off without a reason where none needs saying', () => {
        const { manipulator, notes } = setup([pitched('C', 5, '16'), pitched('D', 5), pitched('E', 5), pitched('F', 5)])
        manipulator.select(notes[0])
        const tools = new NoteToolStates(manipulator)
        expect(tools.tie).toMatchObject({ disabled: true, reason: TIE_NEEDS_SAME_PITCH })
        // A sixteenth can't take a dot: off, nothing to explain beyond the tooltip's name.
        expect(tools.dotted).toEqual({ active: false, disabled: true })
    })

    it('turns sharp or flat off on rests, saying how to make one a note; Higher / Lower stay on for a lone rest', () => {
        const { manipulator, notes } = setup(undefined, 2)
        manipulator.select(notes[4]) // bar 2's first rest
        const lone = new NoteToolStates(manipulator)
        expect(lone.accidental).toMatchObject({ disabled: true, reason: REST_HAS_NO_PITCH })
        expect(lone.pitch).toEqual({ active: false, disabled: false })

        manipulator.extendSelectionTo(notes[5])
        const run = new NoteToolStates(manipulator)
        expect(run.pitch).toMatchObject({ disabled: true, reason: RESTS_HAVE_NO_PITCH })
        expect(run.accidental).toMatchObject({ disabled: true, reason: RESTS_HAVE_NO_PITCH })
        // Simplify still acts on a selection of rests (a run narrows it, there's simply nothing to respell).
        expect(run.simplify).toEqual({ active: false, disabled: false })

        // A run that holds a note keeps every pitch tool.
        manipulator.select(notes[3])
        manipulator.extendSelectionTo(notes[4])
        const mixed = new NoteToolStates(manipulator)
        expect(mixed.pitch.disabled).toBe(false)
        expect(mixed.accidental.disabled).toBe(false)
    })

    it('presses Rest on a selected rest, but not on the first, empty score — where a press still makes it a note', () => {
        const { manipulator, notes } = setup(undefined, 2)
        manipulator.select(notes[4]) // bar 2's first rest, in a score with notes
        expect(new NoteToolStates(manipulator).rest).toEqual({ active: true, disabled: false })

        const rests = makeScore(1)
        const empty = new ScoreManipulator(new Keybindings(EDITOR_COMMANDS, { storageKey: 'test:tools', isMac: false }))
        empty.attach(rests, () => undefined)
        // The editor's default selection on a score of rests: Rest stays unpressed, and still acts.
        expect(empty.selectedNote?.isRest).toBe(true)
        expect(new NoteToolStates(empty).rest).toEqual({ active: false, disabled: false })
        empty.run(TOGGLE_REST)
        expect(empty.selectedNote?.isRest).toBe(false)
        expect(new NoteToolStates(empty).rest).toEqual({ active: false, disabled: false })
        // Back to all rests: still unpressed — the empty score again.
        empty.run(TOGGLE_REST)
        expect(empty.selectedNote?.isRest).toBe(true)
        expect(new NoteToolStates(empty).rest.active).toBe(false)
    })

    it('enables Tie where it binds', () => {
        const { manipulator, notes } = setup([pitched('C', 5), pitched('C', 5), pitched('E', 5), pitched('F', 5)])
        manipulator.select(notes[0])
        expect(new NoteToolStates(manipulator).tie).toEqual({ active: false, disabled: false })
    })
})

describe('ScoreSettingsWords', () => {
    it('says a simple meter and its tempo plainly', () => {
        const { manipulator } = setup()
        manipulator.setTempoAt(0, 0, 120)
        const settings = manipulator.settings
        if (!settings) throw new Error('expected settings')
        const words = new ScoreSettingsWords(settings)
        expect(words.clefLabel).toBe('Clef: Treble')
        expect(words.keyLabel).toBe('Key: C major')
        expect(words.timeLabel).toBe('Time signature: 4/4')
        expect(words.pulseIsQuarter).toBe(true)
        expect(words.pulseBpm).toBe(120)
        expect(words.tempoLabel).toBe('Tempo: 120 bpm')
    })

    it('counts a compound meter in its felt beat, and names a minor key as minor', () => {
        const { manipulator, score } = setup()
        manipulator.setTimeSignatureAt(0, 6, 8)
        manipulator.setTempoAt(0, 0, 120)
        score.setKeySignature(score.firstMeasure?.firstNote, 0, 'minor')
        const settings = manipulator.settings
        if (!settings) throw new Error('expected settings')
        const words = new ScoreSettingsWords(settings)
        expect(words.pulseIsQuarter).toBe(false)
        expect(words.pulseBpm).toBe(80)
        expect(words.tempoLabel).toBe('Tempo: 80 dotted-quarter bpm')
        expect(words.key).toBe('A minor')
    })
})
