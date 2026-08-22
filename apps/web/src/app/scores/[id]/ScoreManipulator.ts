import type { ClefType } from '@mushee/notation/components'
import type { Instrument, Note, Score } from '@mushee/notation/model'
import { TimeSignature } from '@mushee/notation/model'

import { Keybindings } from '@/lib/Keybindings'

import { MINIMIZE_ACCIDENTALS, REMOVE_NOTE, type ScoreAction } from './actions'
import { EDITOR_COMMANDS, type EditorCommand } from './commands'
import { ManipulationHistoryManager, type NoteAddress, type RestoredState, type SelectionAddress } from './ManipulationHistoryManager'

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
 * Score-wide structure (add/remove measure, set tempo at a position, change instrument) lives
 * in dedicated methods rather than the action array, because those operations don't act on a
 * single selected note.
 *
 * Every mutation runs through {@link manipulate}, which registers it as one step with the
 * {@link ManipulationHistoryManager}; {@link undo}/{@link redo} travel that history by
 * swapping in a rebuilt Score (note identities change wholesale, so the selection is
 * re-resolved by position).
 */
export class ScoreManipulator {
    private _score: Score | null = null
    // Selection is the contiguous run from `_anchorNote` (the fixed end, where a drag/shift
    // started) to `_selectedNote` (the moving end — the "active" note used by the cursor, control
    // bar, and preview). `_selectedNotes` is that run in score order, recomputed only on a
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
    readonly history = new ManipulationHistoryManager()
    /**
     * Set while a recording take is writing into the score (the page toggles it): history
     * travel would swap the Score instance out from under the transport's live refs, so
     * undo/redo refuse until the take ends — the take then becomes one undoable step itself.
     */
    historyLocked = false

    /** The keyboard map — command defaults plus the user's persisted overrides — driving {@link handleKeyDown}. */
    constructor(readonly keybindings: Keybindings<EditorCommand> = new Keybindings(EDITOR_COMMANDS)) {}

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

    /** The active note: the moving end of the selection (cursor / control-bar / preview anchor). */
    get selectedNote(): Note | null {
        return this._selectedNote
    }

    /** Every selected note in score order (one entry for a single selection). Stable per selection. */
    get selectedNotes(): Note[] {
        return this._selectedNotes
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
     * action acts on the active note alone.
     */
    run(action: ScoreAction, arg?: unknown): void {
        const score = this._score
        const selected = this._selectedNote
        if (!score || !selected) return
        this.manipulate(() => {
            const results = action.executeBulk
                ? action.executeBulk(score, this._selectedNotes, arg)
                : [action.execute(score, selected, arg)]
            const first = results[0]
            const last = results[results.length - 1]
            if (first && last) this.setRange(first, last)
        })
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
        const command = this.keybindings.resolve(e)
        if (!command || command.run(this) === false) return
        e.preventDefault()
    }

    // --- Clipboard ---

    /** Whether {@link paste} would do anything (drives a future paste button's enabled state). */
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
        this.manipulate(() => {
            const targets = this._selectedNotes.length > 0 ? this._selectedNotes : [selected]
            const pasted = score.replace(
                targets,
                this._clipboard.map((note) => note.clone({})),
            )
            const first = pasted[0]
            const last = pasted[pasted.length - 1]
            if (first && last) this.setRange(first, last)
        })
        this.save(score)
        this.emit()
    }

    // --- Structure (operate on the score as a whole, not the active note) ---

    addMeasure(): void {
        const score = this._score
        if (!score) return
        this.manipulate(() => score.addMeasure().complete())
        this.save(score)
    }

    removeMeasure(): void {
        const score = this._score
        if (!score) return
        this.manipulate(() => {
            score.removeLastMeasure()
            this.setSingle(score.lastMeasure?.lastNote ?? null)
        })
        this.save(score)
        this.emit()
    }

    /** Set a tempo at an explicit position (the in-score tempo marking popover). */
    setTempoAt(measureIndex: number, beatPosition: number, bpm: number): void {
        const score = this._score
        const measure = score?.measures[measureIndex]
        if (!score || !measure) return
        this.manipulate(() => score.setTempo(measure.noteAtBeat(beatPosition), bpm))
        this.save(score)
    }

    /** Change the clef from the start of a measure (the in-score clef glyph popover). */
    setClefAt(measureIndex: number, type: ClefType): void {
        const score = this._score
        const measure = score?.measures[measureIndex]
        if (!score || !measure) return
        this.manipulate(() => score.setClef(measure.noteAtBeat(0), type))
        this.save(score)
    }

    /** Change the key signature from the start of a measure (the in-score key glyph popover). */
    setKeyAt(measureIndex: number, fifths: number): void {
        const score = this._score
        const measure = score?.measures[measureIndex]
        if (!score || !measure) return
        this.manipulate(() => score.setKeySignature(measure.noteAtBeat(0), fifths))
        this.save(score)
    }

    /** Change the time signature from a measure (the in-score glyph or dock popover). */
    setTimeSignatureAt(measureIndex: number, beatAmount: number, beatType: number): void {
        const score = this._score
        const measure = score?.measures[measureIndex]
        if (!score || !measure) return
        const version = score.version
        this.manipulate(() => {
            score.setTimeSignature(measure, new TimeSignature(beatAmount, beatType))
            if (score.version === version) return // same meter — nothing changed
            // Rebarring may have replaced the selected note (split or merged across the new
            // barlines); re-anchor on it if it survived, else on the start of the changed measure.
            const selected = this._selectedNote
            const survived = selected && score.measures.includes(selected.measure)
            this.setSingle(survived ? selected : (score.measures[Math.min(measureIndex, score.measures.length - 1)]?.firstNote ?? null))
        })
        if (score.version === version) return
        this.save(score)
        this.emit()
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
     * Run minimize-accidentals with its scope rule (a multi-note selection respells in
     * place; otherwise the whole score is re-keyed), then flash the affected range. The
     * single entry point shared by the header/dock buttons and the keyboard shortcut.
     */
    minimizeAccidentals(): void {
        if (!this._score || !this._selectedNote) return
        const wholeScore = this._selectedNotes.length <= 1
        this.run(MINIMIZE_ACCIDENTALS)
        this.onPitchHighlight?.(wholeScore ? 'all' : [...this._selectedNotes])
    }

    /**
     * Transpose by a (chromatic, diatonic) interval — the transpose popover's Apply.
     * `scope: 'score'` moves everything including key signatures; `'selection'` moves only
     * the selected run. `Score.transpose` rewrites the affected notes (identities change),
     * so the selection is re-anchored: onto the returned replacements for a selection, or
     * re-resolved at the same (measure, index) for the whole score — like setInstrument.
     */
    transpose(chromatic: number, diatonic: number, scope: 'score' | 'selection'): void {
        const score = this._score
        if (!score) return
        const selectionScope = scope === 'selection' && this._selectedNotes.length > 0
        this.manipulate(() => {
            if (selectionScope) {
                const result = score.transpose(chromatic, diatonic, this._selectedNotes)
                const first = result[0]
                const last = result[result.length - 1]
                if (first && last) this.setRange(first, last)
            } else {
                const note = this._selectedNote
                const measureIdx = note ? note.measure.index : null
                const noteIdx = note ? note.measure.notes.indexOf(note) : null
                score.transpose(chromatic, diatonic)
                if (measureIdx !== null && noteIdx !== null && noteIdx >= 0) {
                    this.setSingle(score.measures[measureIdx]?.notes[noteIdx] ?? null)
                }
            }
        })
        this.save(score)
        this.emit()
        this.onPitchHighlight?.(selectionScope ? [...this._selectedNotes] : 'all')
    }

    /**
     * Switch the lead instrument. `Score.setInstrument` rewrites every note (transposition),
     * invalidating the active-note ref, so we re-resolve it at the same (measure, index).
     */
    setInstrument(instrument: Instrument): void {
        const score = this._score
        if (!score) return
        this.manipulate(() => {
            const note = this._selectedNote
            const measureIdx = note ? note.measure.index : null
            const noteIdx = note ? note.measure.notes.indexOf(note) : null
            score.setInstrument(instrument)
            if (measureIdx !== null && noteIdx !== null && noteIdx >= 0) {
                this.setSingle(score.measures[measureIdx]?.notes[noteIdx] ?? null)
            }
        })
        this.save(score)
        this.emit()
    }

    // --- History (undo / redo) ---

    /** Whether a step back exists. False while a recording locks history travel. */
    get canUndo(): boolean {
        return !this.historyLocked && this._score !== null && this.history.canUndo(this._score)
    }

    /** Whether an undone step can be reapplied. False while a recording locks history travel. */
    get canRedo(): boolean {
        return !this.historyLocked && this._score !== null && this.history.canRedo(this._score)
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
        if (!score || this.historyLocked) return false
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
        if (restored.score.instrument !== previous.instrument) restored.score.redirty({ partList: {} })
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
