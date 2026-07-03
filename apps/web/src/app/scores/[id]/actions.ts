import type { ReactNode } from 'react'

import type { ClefType, DurationType } from '@/components/notation'
import { type Note, Pitch, type Score } from '@/model'

/**
 * A single editing operation on the score, performed relative to the active note.
 *
 * Actions are pure intent: they delegate to the model's own mutators (`Score.replace`,
 * `setDuration`, `setClef`, …) and return the note that should become active afterward.
 * They never touch React, autosave, or playback — the {@link ScoreManipulator} owns that
 * orchestration. Listeners (keyboard handlers, control-bar buttons) live in the page and
 * dispatch into the manipulator, which runs the matching action here.
 */
export interface ScoreAction {
    id: string
    /** Human-readable name (tooltips / future command palette). */
    label: string
    /**
     * Apply the action and return the note to select next (the same note when the action
     * leaves the selection in place). `arg` carries the action's parameter — a duration,
     * accidental token, bpm, clef, key, or pitch; parameterless actions ignore it.
     */
    execute: (score: Score, selectedNote: Note, arg?: unknown) => Note
    /**
     * When true and multiple notes are selected, the action is applied to every selected note
     * (each independently). Only safe for 1:1 edits that preserve a note's duration/position —
     * pitch and per-note state toggles — never for duration-changing edits, which would ripple.
     */
    bulk?: boolean
    /** Optional button content, derived from the current score + selection. */
    display?: (props: { score: Score; selectedNote: Note }) => ReactNode
}

// --- Navigation ---

export const MOVE_PREVIOUS: ScoreAction = {
    id: 'move-previous',
    label: 'Select previous note',
    execute: (_score, note) => note.getPrevious() ?? note,
}

export const MOVE_NEXT: ScoreAction = {
    id: 'move-next',
    label: 'Select next note',
    execute: (_score, note) => note.getNext() ?? note,
}

// --- Pitch editing ---

export const RAISE_PITCH: ScoreAction = {
    id: 'raise-pitch',
    label: 'Raise pitch',
    bulk: true,
    execute: (score, note) => {
        const raised = note.pitch?.raised()
        const pitch = raised ? note.keySignature.spell(raised) : undefined
        const [newNote] = score.replace([note], [note.clone({ pitch })])
        return newNote
    },
}

export const LOWER_PITCH: ScoreAction = {
    id: 'lower-pitch',
    label: 'Lower pitch',
    bulk: true,
    execute: (score, note) => {
        const lowered = note.pitch?.lowered()
        const pitch = lowered ? note.keySignature.spell(lowered) : undefined
        const [newNote] = score.replace([note], [note.clone({ pitch })])
        return newNote
    },
}

export const CLEAR_PITCH: ScoreAction = {
    id: 'clear-pitch',
    label: 'Clear pitch',
    bulk: true,
    execute: (score, note) => {
        const [newNote] = score.replace([note], [note.clone({ pitch: undefined })])
        return newNote
    },
}

/** Set the active note's pitch directly (click-to-pitch on the staff). `arg`: the new {@link Pitch}. */
export const CHANGE_PITCH: ScoreAction = {
    id: 'change-pitch',
    label: 'Change pitch',
    execute: (score, note, arg) => {
        const [newNote] = score.replace([note], [note.clone({ pitch: arg as Pitch })])
        return newNote
    },
}

/** `arg`: an accidental token (`'#'`, `'b'`, or `undefined` for natural). */
export const SET_ACCIDENTAL: ScoreAction = {
    id: 'set-accidental',
    label: 'Set accidental',
    bulk: true,
    execute: (score, note, arg) => {
        const accidental = arg as string | undefined
        const [newNote] = score.replace([note], [note.clone({ pitch: note.pitch?.withAccidental(accidental) })])
        return newNote
    },
}

// --- Duration editing ---

/** `arg`: the target {@link DurationType}. */
export const SET_DURATION: ScoreAction = {
    id: 'set-duration',
    label: 'Set duration',
    execute: (score, note, arg) => score.setDuration(note, { type: arg as DurationType, dots: 0 }) ?? note,
}

export const TOGGLE_DOT: ScoreAction = {
    id: 'toggle-dot',
    label: 'Toggle dotted',
    execute: (score, note) => score.setDuration(note, { dots: note.duration.dots > 0 ? 0 : 1 }) ?? note,
}

export const TOGGLE_TUPLET: ScoreAction = {
    id: 'toggle-tuplet',
    label: 'Toggle triplet',
    execute: (score, note) => score.toggleTuplet(note) ?? note,
}

export const TOGGLE_TIE: ScoreAction = {
    id: 'toggle-tie',
    label: 'Toggle tie',
    bulk: true,
    execute: (score, note) => {
        const tie = note.tiesForward ? undefined : ('start' as const)
        const [newNote] = score.replace([note], [note.clone({ tie })])
        return newNote
    },
}

export const TOGGLE_REST: ScoreAction = {
    id: 'toggle-rest',
    label: 'Toggle rest',
    bulk: true,
    execute: (score, note) => {
        const pitch = note.isRest ? new Pitch({ name: 'B', octave: 4 }) : undefined
        const [newNote] = score.replace([note], [note.clone({ pitch })])
        return newNote
    },
}

// --- Measure context (clef / key / tempo at the active note; selection stays put) ---

/** `arg`: bpm. */
export const SET_TEMPO: ScoreAction = {
    id: 'set-tempo',
    label: 'Set tempo',
    execute: (score, note, arg) => {
        score.setTempo(note, arg as number)
        return note
    },
}

/** `arg`: the target {@link ClefType}. */
export const SET_CLEF: ScoreAction = {
    id: 'set-clef',
    label: 'Set clef',
    execute: (score, note, arg) => {
        score.setClef(note, arg as ClefType)
        return note
    },
}

/** `arg`: number of fifths (positive = sharps, negative = flats). */
export const SET_KEY: ScoreAction = {
    id: 'set-key',
    label: 'Set key signature',
    execute: (score, note, arg) => {
        score.setKeySignature(note, arg as number)
        return note
    },
}

/** Every editing action, in control-bar / keyboard order. */
export const SCORE_ACTIONS: ScoreAction[] = [
    MOVE_PREVIOUS,
    MOVE_NEXT,
    RAISE_PITCH,
    LOWER_PITCH,
    CLEAR_PITCH,
    CHANGE_PITCH,
    SET_ACCIDENTAL,
    SET_DURATION,
    TOGGLE_DOT,
    TOGGLE_TUPLET,
    TOGGLE_TIE,
    TOGGLE_REST,
    SET_TEMPO,
    SET_CLEF,
    SET_KEY,
]
