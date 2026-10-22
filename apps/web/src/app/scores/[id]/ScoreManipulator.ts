import type { Accidental, ClefType, DurationType, Instrument, Interval, KeySignature, Measure, Note, Score } from '@mushee/notation/model'
import { TimeSignature } from '@mushee/notation/model'

import type { PitchScope } from '@/components/editor/pitchScope'
import { Keybindings } from '@/lib/Keybindings'

import { type ActionArgs, MINIMIZE_ACCIDENTALS, REMOVE_NOTE, type ScoreAction } from './actions'
import { EDITOR_COMMANDS, type EditorCommand } from './commands'
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
     * started in. Null only without a score.
     */
    get settingsPosition(): ScorePosition | null {
        const active = this.activePosition
        if (active) return active
        const score = this._score
        if (!score || score.measures.length === 0) return null
        const takeStart = this.lockCount > 0 ? this.clearedFromMeasure : null
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

    /** Change the clef at {@link settingsPosition} (the dock's clef chip). */
    changeClef(type: ClefType): void {
        const at = this.settingsPosition
        if (at) this.setClefAt(at.measureIndex, type, at.beat)
    }

    /** Change the key signature at {@link settingsPosition} (the dock's key chip). */
    changeKey(fifths: number): void {
        const at = this.settingsPosition
        if (at) this.setKeyAt(at.measureIndex, fifths, at.beat)
    }

    /** Change the meter of the measure at {@link settingsPosition} (the dock's time chip). */
    changeTimeSignature(beatAmount: number, beatType: number): void {
        const at = this.settingsPosition
        if (at) this.setTimeSignatureAt(at.measureIndex, beatAmount, beatType)
    }

    /** Set the tempo at {@link settingsPosition}, in quarter-note bpm (the dock's tempo chip). */
    changeTempo(bpm: number): void {
        const at = this.settingsPosition
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

    /** Bind a freshly loaded score and its (debounced) autosave, selecting the first note. */
    attach(score: Score, save: (score: Score) => void): void {
        this._score = score
        this.save = save
        this.history.reset(score)
        this.setSingle(score.firstMeasure?.firstNote ?? null)
        this.emit()
    }

    // --- Selection ---

    /** Collapse the selection onto a single note (or clear it). The note becomes anchor + focus. */
    select(note: Note | null): void {
        // Clearing remembers where the selection was — a take clears it as it starts, and the
        // dock keeps showing that bar's settings (see settingsPosition).
        this.clearedFromMeasure = note ? null : (this.addressOf(this._selectedNote)?.measureIndex ?? this.clearedFromMeasure)
        this.setSingle(note)
        this.emit()
    }

    /** Extend the selection so it spans from the current anchor to `focus` (drag / shift-click). */
    extendSelectionTo(focus: Note): void {
        if (!this._anchorNote) {
            this.select(focus)
            return
        }
        this.setRange(this._anchorNote, focus)
        this.emit()
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
    }

    private setSingle(note: Note | null): void {
        this._anchorNote = note
        this._selectedNote = note
        this._selectedNotes = note ? [note] : []
    }

    private setRange(anchor: Note, focus: Note): void {
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
    run<A>(action: ScoreAction<A>, ...args: ActionArgs<NoInfer<A>>): void {
        const score = this._score
        const selected = this._selectedNote
        if (!score || !selected) return
        // The first pitch edit retires the dock's how-to-move-a-note hint (before the commit's emit re-renders).
        if (action.movesPitch) this.moveNoteHint.markSeen()
        this.commit(() => this.execute(action, this._selectedNotes, selected, ...args))
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
    deleteSelection(): void {
        const score = this._score
        if (!score || !this._selectedNote) return
        const covered = this._selectedNotes.some((note) => !note.isRest) ? [] : this.measuresCoveredWhole()
        const removable = covered.length === score.measures.length ? covered.slice(1) : covered
        if (removable.length === 0) {
            this.run(REMOVE_NOTE)
            return
        }
        this.commit(() => {
            const landingIndex = removable[0].index
            const kept = this._selectedNotes.filter((note) => !removable.includes(note.measure))
            score.removeMeasures(removable)
            if (kept.length > 0) this.execute(REMOVE_NOTE, kept, kept[kept.length - 1])
            else this.setSingle(score.measures[landingIndex]?.firstNote ?? score.lastMeasure?.lastNote ?? null)
        })
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
     */
    private commit(mutate: () => void): void {
        const score = this._score
        if (!score) return
        this.manipulate(mutate)
        this.save(score)
        this.emit()
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
        // A key no shortcut can be recorded on (the Menu key) reaches its command by name.
        const command = this.keybindings.resolve(e) ?? this.keybindings.commands.find((c) => c.alternateKey?.key === e.key) ?? null
        if (!command || command.run(this) === false) return
        e.preventDefault()
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

    removeMeasure(): void {
        const score = this._score
        // A score always has at least one bar; the UI disables the control too, this keeps every path honest.
        if (!score || score.measures.length <= 1) return
        this.commit(() => {
            score.removeLastMeasure()
            this.setSingle(score.lastMeasure?.lastNote ?? null)
        })
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
        this.commit(() => {
            score.setTimeSignature(measure, new TimeSignature(beatAmount, beatType))
            if (score.version === version) return // same meter — nothing changed
            // Rebarring may have replaced the selected note (split or merged across the new
            // barlines); re-anchor on it if it survived, else on the start of the changed measure.
            const selected = this._selectedNote
            const survived = selected && score.measures.includes(selected.measure)
            this.setSingle(survived ? selected : (score.measures[Math.min(measureIndex, score.measures.length - 1)]?.firstNote ?? null))
        })
    }

    /**
     * Opens the transpose popover — registered by the page, since the popover is view
     * state the manipulator doesn't own. Lets the transpose keyboard shortcut live in the
     * command list like any other; unset (editor not mounted), the keystroke is declined.
     */
    onTransposeRequest?: () => void

    /**
     * Page-registered feedback hook: a pitch operation (transpose / minimize accidentals)
     * just rewrote this range — flash it. Called after the mutation, so a notes array holds
     * the replacement identities.
     */
    onPitchHighlight?: (notes: Note[] | 'all') => void

    /**
     * Run minimize-accidentals with its scope rule (a selection that
     * {@link selectionNarrowsPitchOps narrows pitch operations} respells in place; otherwise the
     * whole score is re-keyed), then flash the affected range. The single entry point shared by
     * the header/dock buttons and the keyboard shortcut.
     */
    minimizeAccidentals(): void {
        if (!this._score || !this._selectedNote) return
        const scope: PitchScope = this.selectionNarrowsPitchOps ? 'selection' : 'score'
        this.run(MINIMIZE_ACCIDENTALS, scope)
        this.onPitchHighlight?.(scope === 'score' ? 'all' : [...this._selectedNotes])
    }

    /**
     * Transpose by `interval` — the transpose popover's Apply.
     * `scope: 'score'` moves everything including key signatures; `'selection'` moves only
     * the selected run, and is ignored unless the selection
     * {@link selectionNarrowsPitchOps narrows pitch operations} (a single note means the whole
     * score). `Score.transpose` rewrites the affected notes (identities change), so the
     * selection is re-anchored: onto the returned replacements for a selection, or re-resolved
     * at the same (measure, index) for the whole score — like setInstrument.
     */
    transpose(interval: Interval, scope: PitchScope): void {
        const score = this._score
        if (!score) return
        const selectionScope = scope === 'selection' && this.selectionNarrowsPitchOps
        this.commit(() => {
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
        this.onPitchHighlight?.(selectionScope ? [...this._selectedNotes] : 'all')
    }

    /**
     * Switch the lead instrument. `Score.setInstrument` rewrites every note (transposition),
     * invalidating the active-note ref, so we re-resolve it at the same (measure, index).
     */
    setInstrument(instrument: Instrument): void {
        const score = this._score
        if (!score) return
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
        else this.setSingle(restored.score.firstMeasure?.firstNote ?? null)
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
