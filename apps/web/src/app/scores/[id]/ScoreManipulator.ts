import type { Accidental, ClefType, DurationType, Instrument, Interval, KeySignature, Measure, Note, Score } from '@mushee/notation/model'
import { TimeSignature } from '@mushee/notation/model'

import type { PitchScope } from '@/components/editor/pitchScope'
import { Keybindings } from '@/lib/Keybindings'

import {
    type ActionArgs,
    MINIMIZE_ACCIDENTALS,
    REMOVE_NOTE,
    type ScoreAction,
    SET_ACCIDENTAL,
    SET_DURATION,
    TOGGLE_DOT,
    TOGGLE_TUPLET,
} from './actions'
import { EDITOR_COMMANDS, type EditorCommand } from './commands'
import { EditorSpeech } from './EditorAnnouncer'
import { ManipulationHistoryManager, type NoteAddress, type RestoredState, type SelectionAddress } from './ManipulationHistoryManager'
import { MOVE_NOTE_HINT_KEY, OneTimeHint } from './OneTimeHint'

/** A spot in the score: a measure and a beat offset inside it. */
export interface ScorePosition {
    measureIndex: number
    beat: number
}

/** The score-level settings in effect at one position (see {@link ScoreManipulator.settings}). */
export interface ScoreSettings {
    clef: ClefType
    key: KeySignature
    timeSignature: TimeSignature
    /** Quarter-note bpm, as the model keeps it. */
    bpm: number
}

/**
 * What the keyboard asks of the transport (see {@link ScoreManipulator.requestTransport}):
 * play / pause — or stop a running take — (Space), play from the top (⇧Space), start or stop
 * a take (⇧R), and stop a running take only (Escape).
 */
export type TransportRequest = 'toggle' | 'from-start' | 'record' | 'stop-recording'

/**
 * A big edit that just committed, offered back in an Undo toast (see
 * {@link ScoreManipulator.onUndoOffer}): what happened in plain words, the Undo button's
 * accessible name — never the bare 'Undo' the header's history button already has — and the
 * step it takes back.
 */
export interface UndoOffer {
    message: string
    undoLabel: string
    /** {@link ScoreManipulator.editCount} as the edit committed; {@link ScoreManipulator.undoStep} takes it back only while it is the latest. */
    step: number
}

/** The Undo toast's button name after a delete from the selection actions. */
export const UNDO_DELETE_LABEL = 'Undo delete'
/** The Undo toast's button name after any other big edit. */
export const UNDO_CHANGE_LABEL = 'Undo this change'

/** Actions whose single-note result is read back as its length ('Eighth note.'), not its pitch. */
const LENGTH_ACTIONS: ReadonlySet<unknown> = new Set([SET_DURATION, TOGGLE_DOT, TOGGLE_TUPLET])

/** Controls a key press activates natively — Space presses a focused button, toggles a switch. */
const NATIVELY_ACTIVATED =
    'button, a[href], select, summary, [role="button"], [role="switch"], [role="option"], [role="checkbox"], [role="tab"]'

/** Guard so a malformed anchor/focus pair can never spin the range walk forever. */
const MAX_RANGE = 100_000

/**
 * The editor's controller: it owns the current score and the note selection, turns mouse and
 * keyboard events into {@link ScoreAction}s, and runs them. After every operation it autosaves
 * (debounced, supplied by the page) and notifies subscribers so React re-renders.
 *
 * Selection is a contiguous run of notes from an anchor to a focus (see the fields below).
 * A bulk action receives the whole selection at once; a single-note action acts on the
 * active note alone.
 *
 * It is a `useSyncExternalStore` source — {@link subscribe} + {@link getSnapshot} expose a
 * monotonic version that bumps on any selection or score change. The page reads the live
 * `score` / `selectedNote` / `selectedNotes` off the instance after each notification.
 *
 * Score-wide structure (add/remove measure, change instrument) and measure-context edits
 * (clef / key / meter / tempo at a position — the in-score glyph popovers and the dock alike)
 * live in dedicated methods rather than as actions, because they act on a position rather
 * than on the selected notes. Clef / key / tempo leave the selection as it is; a meter change
 * rebars, so it re-anchors on the active note (or the changed measure's first note).
 *
 * Every public mutator runs through {@link commit}, so each edit is tracked as one step with
 * the {@link ManipulationHistoryManager}, autosaved, and announced; {@link undo}/{@link redo}
 * travel that history by swapping in a rebuilt Score (note identities change wholesale, so
 * the selection is re-resolved by position).
 */
export class ScoreManipulator {
    private _score: Score | null = null
    // Selection is the contiguous run from `_anchorNote` (the fixed end, where a drag/shift
    // started) to `_selectedNote` (the moving end — the "active" note used by the cursor, dock,
    // and preview). `_selectedNotes` is that run in score order, recomputed only on a
    // selection change so its array reference stays stable for memoized rendering.
    private _anchorNote: Note | null = null
    private _selectedNote: Note | null = null
    private _selectedNotes: Note[] = []
    // Internal copy/paste buffer: detached note snapshots (no measure), frozen at copy time so
    // later edits to the originals don't change what gets pasted.
    private _clipboard: Note[] = []
    private _version = 0
    private readonly listeners = new Set<() => void>()
    private save: (score: Score) => void = () => {}
    private readonly history = new ManipulationHistoryManager()
    /** Outstanding {@link lockHistory} holds; history travel refuses while any is held. */
    private lockCount = 0
    /** The measure the selection was in when it was last cleared (a take starting), for {@link settingsPosition}. */
    private clearedFromMeasure: number | null = null
    /** Whether the current selection was made quietly (see {@link select}). */
    private _quietSelection = false
    /** Whether the current selection is the editor's own opening one (see {@link selectionIsInitial}). */
    private _initialSelection = false
    /** Bumped by every committed edit that changed the score and every undo / redo (see {@link editCount}). */
    private _editCount = 0

    constructor(
        /** The keyboard map — command defaults plus the user's persisted overrides — driving {@link handleKeyDown}. */
        readonly keybindings: Keybindings<EditorCommand> = new Keybindings(EDITOR_COMMANDS),
        /** The dock's first-selection hint; the first pitch edit marks it seen. */
        readonly moveNoteHint: OneTimeHint = new OneTimeHint(MOVE_NOTE_HINT_KEY),
    ) {}

    // --- External store (for useSyncExternalStore) ---

    subscribe = (listener: () => void): (() => void) => {
        this.listeners.add(listener)
        return () => this.listeners.delete(listener)
    }

    getSnapshot = (): number => this._version

    private emit(): void {
        this._version++
        for (const listener of this.listeners) listener()
    }

    /** Re-render hook for in-place score mutations; wire this as the score's `onChange`. */
    onScoreChange = (): void => this.emit()

    get score(): Score | null {
        return this._score
    }

    /** The active note: the moving end of the selection (cursor / dock / preview anchor). */
    get selectedNote(): Note | null {
        return this._selectedNote
    }

    /** Every selected note in score order (one entry for a single selection). Stable per selection. */
    get selectedNotes(): Note[] {
        return this._selectedNotes
    }

    /**
     * Whether the selection narrows a pitch operation to itself. Only a multi-note run does: a
     * single selected note is just the cursor, so a pitch operation then means the whole score.
     * The one threshold minimize-accidentals, transpose and the transpose popover's scope
     * choice share.
     */
    get selectionNarrowsPitchOps(): boolean {
        return this._selectedNotes.length > 1
    }

    /**
     * Where the active note sits — its measure index and beat offset — for the measure-context
     * setters below, so a dock clef/key/tempo change lands mid-measure at the active note.
     */
    get activePosition(): ScorePosition | null {
        const note = this._selectedNote
        const at = this.addressOf(note)
        return note && at ? { measureIndex: at.measureIndex, beat: note.measure.beatOffsetOf(note) } : null
    }

    /**
     * Where the dock's clef / key / time / tempo chips read their values and apply a change: the
     * active note's position. With nothing selected it is the opening of bar 1 — the score's
     * real opening values, never a made-up default — except while a recording holds the history
     * (a take clears the selection as it starts): then it is the opening of the bar the take
     * started in, shown but not changed (see {@link historyLocked}). Null only without a score.
     */
    get settingsPosition(): ScorePosition | null {
        const active = this.activePosition
        if (active) return active
        const score = this._score
        if (!score || score.measures.length === 0) return null
        const takeStart = this.historyLocked ? this.clearedFromMeasure : null
        return { measureIndex: takeStart === null ? 0 : Math.min(takeStart, score.measures.length - 1), beat: 0 }
    }

    /** The clef, key, meter and tempo in effect at {@link settingsPosition} — what the dock's score chips show. */
    get settings(): ScoreSettings | null {
        const score = this._score
        const at = this.settingsPosition
        const measure = at && score?.measures[at.measureIndex]
        if (!score || !at || !measure) return null
        return {
            clef: measure.clefAtOrBefore(at.beat).type,
            key: measure.keyAtOrBefore(at.beat),
            timeSignature: measure.timeSignature,
            bpm: score.bpmAtBeat(measure, at.beat),
        }
    }

    /**
     * Whether a recording holds the history ({@link lockHistory}) — it is writing notes into
     * the score. The dock's clef / key / time / tempo chips keep showing their values meanwhile,
     * but stay off: a change would land in the bars the recording is still filling.
     */
    get historyLocked(): boolean {
        return this.lockCount > 0
    }

    /** Where the dock's chips may change the score's settings: {@link settingsPosition}, unless a recording holds the history. */
    private get editableSettingsPosition(): ScorePosition | null {
        return this.historyLocked ? null : this.settingsPosition
    }

    /** Change the clef at {@link settingsPosition} (the dock's clef chip). Declined while a recording runs. */
    changeClef(type: ClefType): void {
        const at = this.editableSettingsPosition
        if (at) this.setClefAt(at.measureIndex, type, at.beat)
    }

    /** Change the key signature at {@link settingsPosition} (the dock's key chip). Declined while a recording runs. */
    changeKey(fifths: number): void {
        const at = this.editableSettingsPosition
        if (at) this.setKeyAt(at.measureIndex, fifths, at.beat)
    }

    /** Change the meter of the measure at {@link settingsPosition} (the dock's time chip). Declined while a recording runs. */
    changeTimeSignature(beatAmount: number, beatType: number): void {
        const at = this.editableSettingsPosition
        if (at) this.setTimeSignatureAt(at.measureIndex, beatAmount, beatType)
    }

    /** Set the tempo at {@link settingsPosition}, in quarter-note bpm (the dock's tempo chip). Declined while a recording runs. */
    changeTempo(bpm: number): void {
        const at = this.editableSettingsPosition
        if (at) this.setTempoAt(at.measureIndex, at.beat, bpm)
    }

    /** Whether a run of several notes is selected (not just the one note the cursor is on). */
    get isRangeSelected(): boolean {
        return this._selectedNotes.length > 1
    }

    /**
     * What every selected note has in common, read through `read` — or null when the notes
     * differ (a mixed run) or nothing is selected. `undefined` is a real shared value (no
     * accidental), distinct from null.
     */
    private sharedBySelection<T>(read: (note: Note) => T): T | null {
        const [first, ...rest] = this._selectedNotes
        if (!first) return null
        const value = read(first)
        return rest.every((note) => read(note) === value) ? value : null
    }

    /** Whether Tie would do anything: TOGGLE_TIE unties a tied note, and ties one only where the tie can bind. */
    get canTie(): boolean {
        const score = this._score
        return !!score && this._selectedNotes.some((note) => note.tiesForward || score.canTieForward(note))
    }

    /** The note length every selected note shares, or null for a mixed run (no length option pressed). */
    get selectionDuration(): DurationType | null {
        return this.sharedBySelection((note) => note.duration.type)
    }

    /** Whether every selected note is dotted. */
    get selectionDotted(): boolean {
        return this.sharedBySelection((note) => note.duration.dots > 0) === true
    }

    /** Whether every selected note sits in a triplet. */
    get selectionInTuplet(): boolean {
        return this.sharedBySelection((note) => note.inTuplet) === true
    }

    /** The accidental every selected note shares (`undefined` = none), or null for a mixed run. */
    get selectionAccidental(): Accidental | undefined | null {
        return this.sharedBySelection((note) => note.pitch?.accidental)
    }

    /**
     * Bind a freshly loaded score and its (debounced) autosave, selecting the first note — the
     * editor's opening selection, so the keys and the dock have somewhere to act (see
     * {@link selectionIsInitial}).
     */
    attach(score: Score, save: (score: Score) => void): void {
        this._score = score
        this.save = save
        this.history.reset(score)
        this.setInitial(score.firstMeasure?.firstNote ?? null)
        this.emit()
    }

    // --- Selection ---

    /**
     * Collapse the selection onto a single note (or clear it). The note becomes anchor + focus.
     * A `quiet` selection is one the editor made for the user rather than one they asked for —
     * the bar after a finished take — so it neither previews the note's pitch nor stops what is
     * playing (see {@link selectionIsQuiet}). `initial` puts the editor's opening selection back
     * as it was (a take that never got going), still not one the user made (see
     * {@link selectionIsInitial}).
     */
    select(note: Note | null, { quiet = false, initial = false }: { quiet?: boolean; initial?: boolean } = {}): void {
        // Clearing remembers where the selection was — a take clears it as it starts, and the
        // dock keeps showing that bar's settings (see settingsPosition).
        this.clearedFromMeasure = note ? null : (this.addressOf(this._selectedNote)?.measureIndex ?? this.clearedFromMeasure)
        if (initial) this.setInitial(note)
        else this.setSingle(note)
        this._quietSelection = quiet && note !== null
        this.emit()
        if (note && !quiet) this.speakSelection()
    }

    /** Whether the current selection was made by a quiet {@link select}: no preview, no stopping playback. */
    get selectionIsQuiet(): boolean {
        return this._quietSelection
    }

    /**
     * Whether the selection is still the one the editor opened the score with — the first note,
     * selected on {@link attach} (or after a history step that carried no selection) — rather
     * than one the user made. Record treats it as no selection (see {@link recordingStartNote}).
     * The user's first select, move or edit clears it.
     */
    get selectionIsInitial(): boolean {
        return this._initialSelection
    }

    /**
     * The note Record starts a take at: the selected note's bar — but not the editor's own
     * opening selection, which would put the take in front of the music already written. Null
     * then, and with nothing selected: the take carries on after the last bar that holds notes
     * (RecordingTake.startingAt). The Record button's label and the take both read it, so they agree.
     */
    get recordingStartNote(): Note | null {
        return this._initialSelection ? null : this._selectedNote
    }

    /** Extend the selection so it spans from the current anchor to `focus` (drag / shift-click). */
    extendSelectionTo(focus: Note): void {
        if (!this._anchorNote) {
            this.select(focus)
            return
        }
        this.setRange(this._anchorNote, focus)
        this.emit()
        this.speakSelection()
    }

    /** Grow/shrink the selection by one note in score order, keeping the anchor (shift+arrows). */
    extendSelectionByStep(direction: 1 | -1): void {
        const focus = this._selectedNote
        if (!focus) return
        const next = direction > 0 ? focus.getNext() : focus.getPrevious()
        if (next) this.extendSelectionTo(next)
    }

    /** Collapse a multi-note selection back onto the active note (Escape). */
    collapseSelection(): void {
        if (this._selectedNote) this.select(this._selectedNote)
    }

    /** Select every note in the score (⌘A / the selection menu), anchored at the first note. */
    selectAll(): void {
        const first = this._score?.firstMeasure?.firstNote ?? null
        const last = this._score?.lastMeasure?.lastNote ?? null
        if (!first || !last) return
        this.setRange(first, last)
        this.emit()
        this.speakSelection()
    }

    private setSingle(note: Note | null): void {
        this._quietSelection = false
        this._initialSelection = false
        this._anchorNote = note
        this._selectedNote = note
        this._selectedNotes = note ? [note] : []
    }

    /** {@link setSingle}, marked as the editor's opening selection (see {@link selectionIsInitial}). */
    private setInitial(note: Note | null): void {
        this.setSingle(note)
        this._initialSelection = note !== null
    }

    private setRange(anchor: Note, focus: Note): void {
        this._quietSelection = false
        this._initialSelection = false
        this._anchorNote = anchor
        this._selectedNote = focus
        this._selectedNotes = this.notesBetween(anchor, focus)
    }

    /** The contiguous run of notes from `a` to `b` inclusive, returned in score order. */
    private notesBetween(a: Note, b: Note): Note[] {
        if (a === b) return [a]
        const [start, end] = this.comparePosition(a, b) <= 0 ? [a, b] : [b, a]
        const range: Note[] = []
        let cur: Note | null = start
        for (let guard = 0; cur && guard < MAX_RANGE; guard++) {
            range.push(cur)
            if (cur === end) return range
            cur = cur.getNext()
        }
        // Walked off the end without meeting `end` (shouldn't happen within one score) — degrade
        // to a single-note selection rather than returning a bogus run.
        return [a]
    }

    /** Order two notes by score position: negative if `a` precedes `b`. */
    private comparePosition(a: Note, b: Note): number {
        const byMeasure = a.measure.index - b.measure.index
        if (byMeasure !== 0) return byMeasure
        return a.measure.notes.indexOf(a) - b.measure.notes.indexOf(b)
    }

    // --- Action dispatch ---

    /**
     * Run an action against the selection, then autosave and re-render. A bulk action receives
     * every selected note and returns the notes to re-anchor the selection on; a single-note
     * action acts on the active note alone. The argument is required exactly when the action
     * takes one (see {@link ActionArgs}); `A` is inferred from the action alone.
     */
    run<A>(action: ScoreAction<A>, ...args: ActionArgs<NoInfer<A>>): boolean {
        const score = this._score
        const selected = this._selectedNote
        if (!score || !selected) return false
        // The first pitch edit retires the dock's how-to-move-a-note hint (before the commit's emit re-renders).
        if (action.movesPitch) this.moveNoteHint.markSeen()
        const changed = this.commit(() => this.execute(action, this._selectedNotes, selected, ...args))
        this.speakResult(action, changed, selected)
        return changed
    }

    /**
     * Read back what a run did, for a screen reader: a move (nothing changed) names the note
     * it landed on; a single-note edit names what it changed — the pitch, the length, or the
     * note as a whole. Edits of a run and the big edits stay quiet here: their Undo toast speaks.
     */
    private speakResult<A>(action: ScoreAction<A>, changed: boolean, before: Note): void {
        const note = this._selectedNote
        if (!note) return
        if (!changed) {
            if (note !== before) this.speakSelection()
            return
        }
        if (this._selectedNotes.length !== 1 || action === MINIMIZE_ACCIDENTALS) return
        if (action.movesPitch || action === SET_ACCIDENTAL) this.speak(EditorSpeech.pitch(note))
        else if (LENGTH_ACTIONS.has(action)) this.speak(EditorSpeech.noteLength(note))
        else this.speak(EditorSpeech.note(note))
    }

    /** Say the selection through the live region (see {@link speak}). */
    private speakSelection(): void {
        const text = EditorSpeech.selection(this._selectedNotes)
        if (text) this.speak(text)
    }

    /**
     * Say a selection or edit message — except while a recording holds the history: the take
     * clears the selection and rewrites bars as it goes, and has its own announcements.
     */
    private speak(text: string): void {
        if (!this.historyLocked) this.announce(text)
    }

    /** Apply an action to `notes` (bulk) or to `active` alone, then re-anchor the selection on its results. */
    private execute<A>(action: ScoreAction<A>, notes: Note[], active: Note, ...args: ActionArgs<A>): void {
        const score = this._score
        if (!score) return
        // ActionArgs already proved the argument's presence at the call site; for a
        // parameterless action this reads `undefined`, which is what `void` stands for.
        const arg = args[0] as A
        const results = action.executeBulk ? action.executeBulk(score, notes, arg) : [action.execute(score, active, arg)]
        const first = results[0]
        const last = results[results.length - 1]
        if (first && last) this.setRange(first, last)
    }

    /**
     * Delete the selection (Backspace, the selection popover's Delete). Normally that clears the
     * selected pitches to rests ({@link REMOVE_NOTE}). A selection holding nothing but rests has
     * no pitch left to clear, so there the measures it covers whole are removed from the score —
     * the way to take measures out of the middle (or the end) of a piece. Rests in a partially
     * covered measure are handled as before, and the score always keeps at least one measure
     * (a whole-score selection removes all but the first). The selection lands on whatever now
     * starts at the first removed position (or on the piece's final note when the tail was removed).
     */
    deleteSelection({ offerUndo = false }: { offerUndo?: boolean } = {}): void {
        const score = this._score
        if (!score || !this._selectedNote) return
        const covered = this._selectedNotes.some((note) => !note.isRest) ? [] : this.measuresCoveredWhole()
        const removable = covered.length === score.measures.length ? covered.slice(1) : covered
        if (removable.length === 0) {
            const pitched = this._selectedNotes.filter((note) => !note.isRest).length
            if (this.run(REMOVE_NOTE) && offerUndo && pitched > 0) {
                this.offerUndo(pitched === 1 ? 'Deleted the note.' : `Deleted ${pitched} notes.`, UNDO_DELETE_LABEL)
            }
            return
        }
        this.commit(() => {
            const landingIndex = removable[0].index
            const kept = this._selectedNotes.filter((note) => !removable.includes(note.measure))
            score.removeMeasures(removable)
            if (kept.length > 0) this.execute(REMOVE_NOTE, kept, kept[kept.length - 1])
            else this.setSingle(score.measures[landingIndex]?.firstNote ?? score.lastMeasure?.lastNote ?? null)
        })
        if (offerUndo) this.offerUndo(removable.length === 1 ? 'Removed the bar.' : `Removed ${removable.length} bars.`, UNDO_DELETE_LABEL)
    }

    /** The measures every note of which is selected, in score order (the selection is contiguous). */
    private measuresCoveredWhole(): Measure[] {
        const selected = new Set(this._selectedNotes)
        const measures = [...new Set(this._selectedNotes.map((note) => note.measure))]
        return measures.filter((measure) => measure.notes.every((note) => selected.has(note)))
    }

    /**
     * The one path every public mutator takes: run `mutate` as an undoable step, autosave the
     * score, and notify subscribers — so no edit can be tracked without being saved or announced.
     * Returns whether the score changed.
     */
    private commit(mutate: () => void): boolean {
        const score = this._score
        if (!score) return false
        const version = score.version
        // An edit or a move is the user acting where the selection is: it is theirs from now on.
        this._initialSelection = false
        this.manipulate(mutate)
        // Navigation runs through here too, but changes nothing: only a real change counts, and
        // only a real change is saved — so moving around never reads as "Saving…".
        const changed = score.version !== version
        if (changed) {
            this._editCount++
            this.save(score)
        }
        this.emit()
        return changed
    }

    /**
     * How many edits (and undo / redo steps) this editor has run. A surface tied to "the latest
     * step" — the after-take summary, whose Undo must only ever take the take back — compares it
     * to tell when another step has come along.
     */
    get editCount(): number {
        return this._editCount
    }

    /** Run one mutation as an undoable step (no-ops — navigation actions — register nothing). */
    private manipulate(mutate: () => void): void {
        const score = this._score
        if (!score) return
        this.history.track(score, this.selectionAddress(), mutate)
    }

    /**
     * Dispatch a keydown: resolve it against the keybindings and run the matching command.
     * Keys typed into form fields (the title / popover inputs) are left alone so they keep
     * their native behavior, as is any keystroke whose command declined it (returned `false`).
     */
    handleKeyDown = (e: KeyboardEvent): void => {
        const target = e.target
        if (target instanceof HTMLElement && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
            return
        }
        // A key a fixed command claims first (Escape stopping a take) gets its say before the
        // key's own binding; declined, the key carries on to that binding.
        const unmodified = !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey
        const first = unmodified ? this.keybindings.commands.find((c) => c.preemptKey?.key === e.key) : undefined
        if (first && first.run(this) !== false) {
            e.preventDefault()
            return
        }
        // A key no shortcut can be recorded on (the Menu key) reaches its command by name, as does
        // a key named by the character it types ('?') — never under ⌘ / Ctrl, which mean something
        // else ('⌘?' is the Mac's Help menu), though AltGr (Ctrl+Alt) still types characters.
        const commandHeld = e.metaKey || (e.ctrlKey && !e.altKey)
        const named = commandHeld ? undefined : this.keybindings.commands.find((c) => c.alternateKey?.key === e.key)
        const command = this.keybindings.resolve(e) ?? named ?? null
        if (!command) return
        // Space on a focused button presses the button, as the browser intends.
        if (command.yieldsToControls && target instanceof Element && target.closest(NATIVELY_ACTIVATED)) return
        if (command.run(this) === false) return
        e.preventDefault()
    }

    /**
     * The transport, reached from the keyboard — registered by the page, which owns playback
     * and recording, like {@link onTransposeRequest}. Returns whether it acted; unset (editor
     * not mounted) every request is declined.
     */
    onTransportRequest?: (request: TransportRequest) => boolean

    /** Ask the page's transport to act (the Playback shortcuts). Declined — left to the browser — when it can't. */
    requestTransport(request: TransportRequest): boolean {
        return this.onTransportRequest?.(request) ?? false
    }

    /**
     * The editor's one polite live region (contract C11), registered by EditorAnnouncer: what
     * a screen reader hears about the recording, and (W4) about selection and edits.
     */
    onAnnounce?: (text: string) => void

    /** Say `text` through the editor's live region (debounced there, so a burst reads as its last line). */
    announce(text: string): void {
        this.onAnnounce?.(text)
    }

    /**
     * Big edits offer themselves back — registered by the page, which raises the Undo toast:
     * removing a bar that held notes, a delete from the selection actions, transposing,
     * simplifying sharps and flats, changing the meter. Single-note edits never do.
     */
    onUndoOffer?: (offer: UndoOffer) => void

    private offerUndo(message: string, undoLabel: string = UNDO_CHANGE_LABEL): void {
        this.onUndoOffer?.({ message, undoLabel, step: this._editCount })
    }

    /**
     * Undo the step an {@link UndoOffer} names — only while it is still the latest one, so an
     * Undo pressed after a newer edit can never take back the wrong thing. Returns whether
     * anything was undone.
     */
    undoStep(step: number): boolean {
        return step === this._editCount && this.undo()
    }

    /**
     * Opens the selection actions (copy / paste / delete) over the selection — registered by
     * the page, which owns the popover, like {@link onTransposeRequest}.
     */
    onSelectionMenuRequest?: () => void

    /**
     * Ask for the selection actions from the keyboard (Shift+F10, the Menu key). Declined —
     * left to the browser — with nothing selected or no editor listening.
     */
    requestSelectionMenu(): boolean {
        if (!this._selectedNote || !this.onSelectionMenuRequest) return false
        this.onSelectionMenuRequest()
        return true
    }

    // --- Clipboard ---

    /** Whether {@link paste} would do anything (drives the SelectionPopover's Paste enabled state). */
    get canPaste(): boolean {
        return this._clipboard.length > 0
    }

    /** Snapshot the selected notes into the clipboard as detached clones. */
    copy(): void {
        this._clipboard = this._selectedNotes.map((note) => note.clone({}))
    }

    /** Copy the selection into the clipboard, then remove it from the score (⌘X). */
    cut(): void {
        if (this._selectedNotes.length === 0) return
        this.copy()
        this.run(REMOVE_NOTE)
    }

    /**
     * Paste the clipboard over the current selection: the selected run is replaced with fresh
     * clones of the copied notes (beat-matched by `Score.replace` — extending over following notes
     * or padding with rests as needed). The pasted notes become the new selection.
     */
    paste(): void {
        const score = this._score
        const selected = this._selectedNote
        if (!score || !selected || this._clipboard.length === 0) return
        this.commit(() => {
            const targets = this._selectedNotes.length > 0 ? this._selectedNotes : [selected]
            const pasted = score.replace(
                targets,
                this._clipboard.map((note) => note.clone({})),
            )
            const first = pasted[0]
            const last = pasted[pasted.length - 1]
            if (first && last) this.setRange(first, last)
        })
    }

    // --- Structure (operate on the score as a whole, not the active note) ---

    addMeasure(): void {
        const score = this._score
        if (!score) return
        this.commit(() => score.addMeasure().complete())
    }

    /** Remove the last bar (the canvas's 'Remove last bar'); one that held notes offers an Undo. */
    removeMeasure(): void {
        const score = this._score
        // A score always has at least one bar; the UI disables the control too, this keeps every path honest.
        if (!score || score.measures.length <= 1) return
        const bar = score.measures.length
        const heldNotes = score.lastMeasure?.notes.some((note) => !note.isRest) ?? false
        const changed = this.commit(() => {
            score.removeLastMeasure()
            this.setSingle(score.lastMeasure?.lastNote ?? null)
        })
        if (changed && heldNotes) this.offerUndo(`Removed bar ${bar}.`)
    }

    /** Set a tempo at an explicit position (the in-score tempo marking popover, or the dock at {@link activePosition}). */
    setTempoAt(measureIndex: number, beatPosition: number, bpm: number): void {
        const score = this._score
        const measure = score?.measures[measureIndex]
        if (!score || !measure) return
        this.commit(() => score.setTempo(measure.noteAtBeat(beatPosition), bpm))
    }

    /**
     * Change the clef at a position: from the start of a measure (the in-score clef glyph
     * popover), or mid-measure at a beat (the dock, at {@link activePosition}).
     */
    setClefAt(measureIndex: number, type: ClefType, beat = 0): void {
        const score = this._score
        const measure = score?.measures[measureIndex]
        if (!score || !measure) return
        this.commit(() => score.setClef(measure.noteAtBeat(beat), type))
    }

    /**
     * Change the key signature at a position: from the start of a measure (the in-score key
     * glyph popover), or mid-measure at a beat (the dock, at {@link activePosition}).
     */
    setKeyAt(measureIndex: number, fifths: number, beat = 0): void {
        const score = this._score
        const measure = score?.measures[measureIndex]
        if (!score || !measure) return
        this.commit(() => score.setKeySignature(measure.noteAtBeat(beat), fifths))
    }

    /** Change the time signature from a measure (the in-score glyph or dock popover). */
    setTimeSignatureAt(measureIndex: number, beatAmount: number, beatType: number): void {
        const score = this._score
        const measure = score?.measures[measureIndex]
        if (!score || !measure) return
        const version = score.version
        const changed = this.commit(() => {
            score.setTimeSignature(measure, new TimeSignature(beatAmount, beatType))
            if (score.version === version) return // same meter — nothing changed
            // Rebarring may have replaced the selected note (split or merged across the new
            // barlines); re-anchor on it if it survived, else on the start of the changed measure.
            const selected = this._selectedNote
            const survived = selected && score.measures.includes(selected.measure)
            this.setSingle(survived ? selected : (score.measures[Math.min(measureIndex, score.measures.length - 1)]?.firstNote ?? null))
        })
        if (changed) this.offerUndo(`Changed to ${beatAmount}/${beatType} — bars regrouped.`)
    }

    /**
     * Opens the transpose popover — registered by the page, since the popover is view
     * state the manipulator doesn't own. Lets the transpose keyboard shortcut live in the
     * command list like any other; unset (editor not mounted), the keystroke is declined.
     */
    onTransposeRequest?: () => void

    /**
     * Opens the keyboard shortcuts list ('?') — registered by the page, which owns the dialog,
     * like {@link onTransposeRequest}; only where the list is offered (desktop). Unset, the
     * keystroke is declined.
     */
    onShortcutsRequest?: () => void

    /**
     * Page-registered feedback hook, the editor's one "this just changed" signal: an edit just
     * landed on this range — a pitch operation (transpose / minimize accidentals) rewrote it, or
     * a recording wrote it ({@link flashRange}) — so flash it. Called after the mutation, so a
     * notes array holds the replacement identities.
     */
    onRangeFlash?: (notes: Note[] | 'all') => void

    /**
     * Flash `notes` as just changed, through {@link onRangeFlash} — for edits made outside the
     * manipulator's own operations: the bars a recording just added. Nothing to flash, no flash.
     */
    flashRange(notes: Note[]): void {
        if (notes.length > 0) this.onRangeFlash?.(notes)
    }

    /**
     * Run minimize-accidentals with its scope rule (a selection that
     * {@link selectionNarrowsPitchOps narrows pitch operations} respells in place; otherwise the
     * whole score is re-keyed), then flash the affected range. The single entry point shared by
     * the header/dock buttons and the keyboard shortcut.
     */
    minimizeAccidentals(): void {
        if (!this._score || !this._selectedNote) return
        const scope: PitchScope = this.selectionNarrowsPitchOps ? 'selection' : 'score'
        // The pass rewrites the notes it looks at even where the spelling stays; only a
        // spelling (or key) that really changed is worth an Undo.
        const before = this.spelling()
        this.run(MINIMIZE_ACCIDENTALS, scope)
        this.onRangeFlash?.(scope === 'score' ? 'all' : [...this._selectedNotes])
        if (this.spelling() !== before) this.offerUndo('Tidied sharps and flats.')
    }

    /** How the score is spelled — every bar's key and every note's written pitch — to tell a respelling that changed something. */
    private spelling(): string {
        return (this._score?.measures ?? [])
            .map((measure) => {
                const notes = measure.notes.map((note) => (note.pitch ? `${note.pitch.name}${note.pitch.alter}${note.pitch.octave}` : '-'))
                return `${measure.keyAtOrBefore(0).fifths}:${notes.join(',')}`
            })
            .join(';')
    }

    /**
     * Transpose by `interval` — the transpose popover's Apply.
     * `scope: 'score'` moves everything including key signatures; `'selection'` moves only
     * the selected run, and is ignored unless the selection
     * {@link selectionNarrowsPitchOps narrows pitch operations} (a single note means the whole
     * score). `Score.transpose` rewrites the affected notes (identities change), so the
     * selection is re-anchored: onto the returned replacements for a selection, or re-resolved
     * at the same (measure, index) for the whole score — like setInstrument. Declined while a
     * recording runs: it would move the bars already written while the take keeps writing later
     * ones at the pitch it locked in as it started.
     */
    transpose(interval: Interval, scope: PitchScope): void {
        const score = this._score
        if (!score || this.historyLocked) return
        const selectionScope = scope === 'selection' && this.selectionNarrowsPitchOps
        const changed = this.commit(() => {
            if (selectionScope) {
                const result = score.transpose(interval, this._selectedNotes)
                const first = result[0]
                const last = result[result.length - 1]
                if (first && last) this.setRange(first, last)
            } else {
                const at = this.addressOf(this._selectedNote)
                score.transpose(interval)
                if (at) this.setSingle(this.noteAt(at))
            }
        })
        this.onRangeFlash?.(selectionScope ? [...this._selectedNotes] : 'all')
        if (changed) this.offerUndo(ScoreManipulator.movedWords(interval))
    }

    /** What a transposition did, in the transpose popover's words: 'Moved 2 half steps higher.' */
    private static movedWords(interval: Interval): string {
        const steps = Math.abs(interval.chromatic)
        if (steps === 0) return 'Respelled the notes.'
        return `Moved ${steps} half ${steps === 1 ? 'step' : 'steps'} ${interval.chromatic > 0 ? 'higher' : 'lower'}.`
    }

    /**
     * Switch the lead instrument. `Score.setInstrument` rewrites every note (transposition),
     * invalidating the active-note ref, so we re-resolve it at the same (measure, index).
     * Declined while a recording runs, like {@link transpose}.
     */
    setInstrument(instrument: Instrument): void {
        const score = this._score
        if (!score || this.historyLocked) return
        this.commit(() => {
            const at = this.addressOf(this._selectedNote)
            score.setInstrument(instrument)
            if (at) this.setSingle(this.noteAt(at))
        })
    }

    // --- History (undo / redo) ---

    /**
     * Hold history travel off while a recording take writes into the score — from the take's
     * start until its socket has drained the last transcription updates. Undoing meanwhile
     * would swap the Score instance out from under the transport's live refs, and the late
     * updates would land in a score the editor no longer shows. The take then becomes one
     * undoable step itself. Returns the release; it is idempotent, and holds from overlapping
     * takes count separately, so an earlier take's release never unlocks a later take.
     */
    lockHistory(): () => void {
        this.lockCount++
        this.emit()
        let released = false
        return () => {
            if (released) return
            released = true
            this.lockCount--
            this.emit()
        }
    }

    /** Whether a step back exists. False while a recording locks history travel. */
    get canUndo(): boolean {
        return this.lockCount === 0 && this._score !== null && this.history.canUndo(this._score)
    }

    /** Whether an undone step can be reapplied. False while a recording locks history travel. */
    get canRedo(): boolean {
        return this.lockCount === 0 && this._score !== null && this.history.canRedo(this._score)
    }

    /** Step back one manipulation (⌘Z). Returns whether anything was undone. */
    undo(): boolean {
        return this.travel('undo')
    }

    /** Reapply the last undone manipulation (⇧⌘Z). Returns whether anything was redone. */
    redo(): boolean {
        return this.travel('redo')
    }

    private travel(direction: 'undo' | 'redo'): boolean {
        const score = this._score
        if (!score || this.lockCount > 0) return false
        const address = this.selectionAddress()
        const restored =
            direction === 'undo'
                ? this.history.undo(score, address, this.onScoreChange)
                : this.history.redo(score, address, this.onScoreChange)
        if (!restored) return false
        this._editCount++
        this.adopt(restored, score)
        return true
    }

    /**
     * Swap a restored past state in for the live score. The snapshot rebuilt a fresh Score,
     * so note and measure identities changed wholesale: the selection is re-resolved by
     * position, and the presentation width is carried over. A fresh deserialization is
     * already fully structure-dirty (its measures were added one by one), so the autosave
     * persists the restored music; only the instrument — seeded, not set — needs an explicit
     * dirty mark when the step changed it.
     */
    private adopt(restored: RestoredState, previous: Score): void {
        restored.score.setLayoutWidth(previous.layoutWidth)
        if (restored.score.instrument !== previous.instrument) restored.score.markInstrumentDirty()
        this._score = restored.score
        const anchor = this.noteAt(restored.selection?.anchor)
        const focus = this.noteAt(restored.selection?.focus)
        if (anchor && focus) this.setRange(anchor, focus)
        else this.setInitial(restored.score.firstMeasure?.firstNote ?? null)
        this.save(restored.score)
        this.emit()
    }

    /** The live selection as positional addresses (or null when nothing is selected). */
    private selectionAddress(): SelectionAddress | null {
        const anchor = this.addressOf(this._anchorNote)
        const focus = this.addressOf(this._selectedNote)
        return anchor && focus ? { anchor, focus } : null
    }

    /**
     * A note's positional address — the identity that survives a history snapshot
     * round-trip. Selected notes are normally attached, but out-of-band writes (the
     * recording pipeline) can replace them under the selection; a note detached that
     * way — or left in a measure no longer part of the score — has no address.
     */
    private addressOf(note: Note | null): NoteAddress | null {
        if (!note?.isAttached || !this._score?.measures.includes(note.measure)) return null
        return { measureIndex: note.measure.index, noteIndex: note.measure.notes.indexOf(note) }
    }

    /** Resolve an address in the current score, clamped to the nearest existing note. */
    private noteAt(address: NoteAddress | null | undefined): Note | null {
        const score = this._score
        if (!address || !score) return null
        const measure = score.measures[Math.min(address.measureIndex, score.measures.length - 1)]
        if (!measure) return null
        return measure.notes[Math.min(address.noteIndex, measure.notes.length - 1)] ?? null
    }
}
