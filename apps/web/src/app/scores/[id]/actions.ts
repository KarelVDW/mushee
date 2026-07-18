import type { ReactNode } from 'react'

import type { ClefType, DurationType } from '@/components/notation'
import { Note, Pitch, type Score } from '@/model'

/**
 * A single editing operation on the score, performed relative to the selection.
 *
 * Actions are pure intent: they delegate to the model's own mutators (`Score.replace`,
 * `setDuration`, `setClef`, …) and return the note(s) to select afterward.
 * They never touch React, autosave, or playback — the {@link ScoreManipulator} owns that
 * orchestration. Listeners (keyboard handlers, control-bar buttons) live in the page and
 * dispatch into the manipulator, which runs the matching action here.
 *
 * An action comes in one of two shapes: `execute` acts on the active note alone (a
 * multi-note selection collapses onto it), while `executeBulk` receives the whole
 * selection and owns how it is applied. `arg` carries the action's parameter — a
 * duration, accidental token, bpm, clef, key, or pitch; parameterless actions ignore it.
 */
interface ScoreActionBase {
    id: string
    /** Human-readable name (tooltips / future command palette). */
    label: string
    /** Optional button content, derived from the current score + selection. */
    display?: (props: { score: Score; selectedNote: Note }) => ReactNode
}

/** An action on the active note alone. Returns the note to select next. */
interface SingleNoteAction extends ScoreActionBase {
    execute: (score: Score, selectedNote: Note, arg?: unknown) => Note
    executeBulk?: never
}

/**
 * An action on the whole selection at once (a single selection arrives as a one-note
 * array). Returns the notes to re-anchor the selection on, in score order.
 */
interface BulkAction extends ScoreActionBase {
    execute?: never
    executeBulk: (score: Score, selectedNotes: Note[], arg?: unknown) => Note[]
}

export type ScoreAction = SingleNoteAction | BulkAction

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
    executeBulk: (score, notes) =>
        score.replace(
            notes,
            notes.map((note) => {
                const raised = note.pitch?.raised()
                return note.clone({ pitch: raised ? note.keySignature.spell(raised) : undefined })
            }),
        ),
}

export const LOWER_PITCH: ScoreAction = {
    id: 'lower-pitch',
    label: 'Lower pitch',
    executeBulk: (score, notes) =>
        score.replace(
            notes,
            notes.map((note) => {
                const lowered = note.pitch?.lowered()
                return note.clone({ pitch: lowered ? note.keySignature.spell(lowered) : undefined })
            }),
        ),
}

export const CLEAR_PITCH: ScoreAction = {
    id: 'clear-pitch',
    label: 'Clear pitch',
    executeBulk: (score, notes) =>
        score.replace(
            notes,
            notes.map((note) => note.clone({ pitch: undefined })),
        ),
}

/**
 * Remove the notes: clear their pitches like {@link CLEAR_PITCH}, and restructure every
 * measure that is left holding only rests back to its time signature's natural rhythm —
 * the same fill a freshly added measure gets (four quarter rests in 4/4). The
 * Backspace/delete gesture.
 */
export const REMOVE_NOTE: ScoreAction = {
    id: 'remove-note',
    label: 'Remove note',
    executeBulk: (score, notes) => {
        const cleared = score.replace(
            notes,
            notes.map((note) => note.clone({ pitch: undefined })),
        )
        // Capture positions first: a restructure below replaces (detaches) a measure's notes.
        const positions = cleared.map((note) => ({ measure: note.measure, beat: note.measure.beatOffsetOf(note) }))
        for (const measure of new Set(positions.map((p) => p.measure))) {
            if (measure.notes.some((note) => !note.isRest)) continue
            score.replace(
                measure.notes,
                measure.timeSignature.fillRests(0).map((d) => new Note({ duration: d })),
            )
        }
        // Re-anchor each result at its beat — the cleared note itself, or the rest that replaced it.
        return positions.map((p) => p.measure.noteAtBeat(p.beat)).filter((note): note is Note => note !== null)
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
    executeBulk: (score, notes, arg) => {
        const accidental = arg as string | undefined
        return score.replace(
            notes,
            notes.map((note) => note.clone({ pitch: note.pitch?.withAccidental(accidental) })),
        )
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
    executeBulk: (score, notes) =>
        score.replace(
            notes,
            notes.map((note) => note.clone({ tie: note.tiesForward ? undefined : ('start' as const) })),
        ),
}

export const TOGGLE_REST: ScoreAction = {
    id: 'toggle-rest',
    label: 'Toggle rest',
    executeBulk: (score, notes) =>
        score.replace(
            notes,
            notes.map((note) => note.clone({ pitch: note.isRest ? new Pitch({ name: 'B', octave: 4 }) : undefined })),
        ),
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
    REMOVE_NOTE,
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
