import type { Instrument, Note, Score } from '@/model'

import { SCORE_ACTIONS, type ScoreAction } from './actions'

/** Keyboard shortcut → action, built once from the actions that declare a `defaultKey`. */
const ACTIONS_BY_KEY = new Map<string, ScoreAction>()
for (const action of SCORE_ACTIONS) {
    if (action.defaultKey) ACTIONS_BY_KEY.set(action.defaultKey, action)
}

/** Guard so a malformed anchor/focus pair can never spin the range walk forever. */
const MAX_RANGE = 100_000

/**
 * The editor's controller: it owns the current score and the note selection, turns mouse and
 * keyboard events into {@link ScoreAction}s, and runs them. After every operation it autosaves
 * (debounced, supplied by the page) and notifies subscribers so React re-renders.
 *
 * Selection is a contiguous run of notes from an anchor to a focus (see the fields below).
 * A bulk-flagged action applied to a multi-note selection runs on every selected note.
 *
 * It is a `useSyncExternalStore` source — {@link subscribe} + {@link getSnapshot} expose a
 * monotonic version that bumps on any selection or score change. The page reads the live
 * `score` / `selectedNote` / `selectedNotes` off the instance after each notification.
 *
 * Score-wide structure (add/remove measure, set tempo at a position, change instrument) lives
 * in dedicated methods rather than the action array, because those operations don't act on a
 * single selected note.
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
    private save: () => void = () => {}

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
    attach(score: Score, save: () => void): void {
        this._score = score
        this.save = save
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
     * Run an action against the selection, then autosave and re-render. A bulk-flagged action with
     * more than one note selected applies to every selected note (each a 1:1 edit), and the
     * selection is re-anchored on the resulting notes; otherwise it acts on the active note alone.
     */
    run(action: ScoreAction, arg?: unknown): void {
        const score = this._score
        if (!score || !this._selectedNote) return
        const targets = action.bulk && this._selectedNotes.length > 1 ? this._selectedNotes : [this._selectedNote]
        const results = targets.map((note) => action.execute(score, note, arg))
        const first = results[0]
        const last = results[results.length - 1]
        if (first && last) this.setRange(first, last)
        this.save()
        this.emit()
    }

    /**
     * Dispatch a keydown: Cmd/Ctrl+C/V copy & paste, shift+arrows extend the selection, Escape
     * collapses it, else run a bound action. Keys typed into form fields (the title / popover
     * inputs) are left alone so they keep their native behavior.
     */
    handleKeyDown = (e: KeyboardEvent): void => {
        const target = e.target
        if (target instanceof HTMLElement && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
            return
        }
        if (e.metaKey || e.ctrlKey) {
            const key = e.key.toLowerCase()
            if (key === 'c') {
                e.preventDefault()
                this.copy()
            } else if (key === 'v') {
                e.preventDefault()
                this.paste()
            }
            return
        }
        if (e.shiftKey && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
            e.preventDefault()
            this.extendSelectionByStep(e.key === 'ArrowRight' ? 1 : -1)
            return
        }
        if (e.key === 'Escape') {
            if (this._selectedNotes.length <= 1) return
            e.preventDefault()
            this.collapseSelection()
            return
        }
        const action = ACTIONS_BY_KEY.get(e.key)
        if (!action) return
        e.preventDefault()
        this.run(action)
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

    /**
     * Paste the clipboard over the current selection: the selected run is replaced with fresh
     * clones of the copied notes (beat-matched by `Score.replace` — extending over following notes
     * or padding with rests as needed). The pasted notes become the new selection.
     */
    paste(): void {
        const score = this._score
        if (!score || !this._selectedNote || this._clipboard.length === 0) return
        const targets = this._selectedNotes.length > 0 ? this._selectedNotes : [this._selectedNote]
        const pasted = score.replace(
            targets,
            this._clipboard.map((note) => note.clone({})),
        )
        const first = pasted[0]
        const last = pasted[pasted.length - 1]
        if (first && last) this.setRange(first, last)
        this.save()
        this.emit()
    }

    // --- Structure (operate on the score as a whole, not the active note) ---

    addMeasure(): void {
        if (!this._score) return
        this._score.addMeasure().complete()
        this.save()
    }

    removeMeasure(): void {
        if (!this._score) return
        this._score.removeLastMeasure()
        this.setSingle(this._score.lastMeasure?.lastNote ?? null)
        this.save()
        this.emit()
    }

    /** Set a tempo at an explicit position (the in-score tempo marking popover). */
    setTempoAt(measureIndex: number, beatPosition: number, bpm: number): void {
        const measure = this._score?.measures[measureIndex]
        if (!this._score || !measure) return
        this._score.setTempo(measure.noteAtBeat(beatPosition), bpm)
        this.save()
    }

    /**
     * Switch the lead instrument. `Score.setInstrument` rewrites every note (transposition),
     * invalidating the active-note ref, so we re-resolve it at the same (measure, index).
     */
    setInstrument(instrument: Instrument): void {
        const score = this._score
        if (!score) return
        const note = this._selectedNote
        const measureIdx = note ? note.measure.index : null
        const noteIdx = note ? note.measure.notes.indexOf(note) : null
        score.setInstrument(instrument)
        if (measureIdx !== null && noteIdx !== null && noteIdx >= 0) {
            this.setSingle(score.measures[measureIdx]?.notes[noteIdx] ?? null)
        }
        this.save()
        this.emit()
    }
}
