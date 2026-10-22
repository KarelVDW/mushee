import { type Accidental, type DurationType, Note, type Pitch, type Score } from '@mushee/notation/model'

import type { PitchScope } from '@/components/editor/pitchScope'

/**
 * A single editing operation on the score, performed relative to the selection.
 *
 * Actions are pure intent: they delegate to the model's own mutators (`Score.replace`,
 * `setDuration`, `toggleTuplet`, …) and return the note(s) to select afterward.
 * They never touch React, autosave, or playback — the {@link ScoreManipulator} owns that
 * orchestration. Listeners (keyboard handlers, dock buttons) live in the page and
 * dispatch into the manipulator, which runs the matching action here.
 *
 * An action comes in one of two shapes: `execute` acts on the active note alone (a
 * multi-note selection collapses onto it), while `executeBulk` receives the whole
 * selection and owns how it is applied. `A` is the type of the action's parameter
 * (`void` for a parameterless action), so the compiler checks every dispatch site.
 */
interface ScoreActionBase {
    id: string
    /** Human-readable name (tooltips / future command palette). */
    label: string
}

/** An action on the active note alone. Returns the note to select next. */
interface SingleNoteAction<A = void> extends ScoreActionBase {
    execute: (score: Score, selectedNote: Note, arg: A) => Note
    executeBulk?: never
}

/**
 * An action on the whole selection at once (a single selection arrives as a one-note
 * array). Returns the notes to re-anchor the selection on, in score order.
 */
interface BulkAction<A = void> extends ScoreActionBase {
    execute?: never
    executeBulk: (score: Score, selectedNotes: Note[], arg: A) => Note[]
}

export type ScoreAction<A = void> = SingleNoteAction<A> | BulkAction<A>

/**
 * The dispatch-site argument list for an action taking `A`: empty for a parameterless action,
 * otherwise exactly one `A`. Wrapped in a tuple so a union `A` doesn't distribute.
 */
export type ActionArgs<A> = [A] extends [void] ? [] : [A]

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
            notes.map((note) => note.steppedBy(1)),
        ),
}

export const LOWER_PITCH: ScoreAction = {
    id: 'lower-pitch',
    label: 'Lower pitch',
    executeBulk: (score, notes) =>
        score.replace(
            notes,
            notes.map((note) => note.steppedBy(-1)),
        ),
}

/**
 * Remove the notes: clear their pitches to rests, and restructure every
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

/** Set the active note's pitch directly (click-to-pitch on the staff). */
export const CHANGE_PITCH: ScoreAction<Pitch> = {
    id: 'change-pitch',
    label: 'Change pitch',
    execute: (score, note, pitch) => {
        const [newNote] = score.replace([note], [note.clone({ pitch })])
        return newNote
    },
}

/** Takes an {@link Accidental} token (`'#'`, `'b'`, or `undefined` for natural). */
export const SET_ACCIDENTAL: ScoreAction<Accidental | undefined> = {
    id: 'set-accidental',
    label: 'Set accidental',
    executeBulk: (score, notes, accidental) =>
        score.replace(
            notes,
            notes.map((note) => note.clone({ pitch: note.pitch?.withAccidental(accidental) })),
        ),
}

/**
 * Respell the music with the fewest possible accidentals, in the given {@link PitchScope}:
 * `'selection'` respells the selected run in place (key signatures untouched); `'score'`
 * re-keys every key region to the cheapest signature and all notes follow. The manipulator
 * picks the scope from the selection (ScoreManipulator.selectionNarrowsPitchOps).
 * `Score.minimizeAccidentals` returns replacements index-aligned with its input, so the
 * selection is re-anchored onto the same musical positions it covered before.
 */
export const MINIMIZE_ACCIDENTALS: ScoreAction<PitchScope> = {
    id: 'minimize-accidentals',
    label: 'Minimize accidentals',
    executeBulk: (score, notes, scope) => {
        if (scope === 'selection') return score.minimizeAccidentals(notes)
        const all = score.measures.flatMap((measure) => measure.notes)
        const indexOf = new Map(all.map((note, i) => [note, i]))
        const result = score.minimizeAccidentals()
        return notes.map((note) => result[indexOf.get(note) ?? -1]).filter((note): note is Note => note !== undefined)
    },
}

// --- Duration editing ---

/** Takes the target {@link DurationType}. */
export const SET_DURATION: ScoreAction<DurationType> = {
    id: 'set-duration',
    label: 'Set duration',
    execute: (score, note, type) => score.setDuration(note, { type, dots: 0 }) ?? note,
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
    // Tying on is offered only where a tie can bind (Score.canTieForward) — a tie into a rest or
    // another pitch would be a dangling mark. Untying is always allowed.
    executeBulk: (score, notes) =>
        score.replace(
            notes,
            notes.map((note) => {
                if (note.tiesForward) return note.clone({ tie: undefined })
                return score.canTieForward(note) ? note.clone({ tie: 'start' as const }) : note
            }),
        ),
}

/** A rest becomes a note on the middle line of the clef in effect there; a note becomes a rest. */
export const TOGGLE_REST: ScoreAction = {
    id: 'toggle-rest',
    label: 'Toggle rest',
    executeBulk: (score, notes) =>
        score.replace(
            notes,
            notes.map((note) => note.clone({ pitch: note.isRest ? note.clef.middleLinePitch : undefined })),
        ),
}
