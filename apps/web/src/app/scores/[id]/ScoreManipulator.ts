import type { Instrument, Note, Score } from '@/model'

import { SCORE_ACTIONS, type ScoreAction } from './actions'

/** Keyboard shortcut → action, built once from the actions that declare a `defaultKey`. */
const ACTIONS_BY_KEY = new Map<string, ScoreAction>()
for (const action of SCORE_ACTIONS) {
    if (action.defaultKey) ACTIONS_BY_KEY.set(action.defaultKey, action)
}

/**
 * The editor's controller: it owns the active note and the current score, turns mouse and
 * keyboard events into {@link ScoreAction}s, and runs them. After every operation it autosaves
 * (debounced, supplied by the page) and notifies subscribers so React re-renders.
 *
 * It is a `useSyncExternalStore` source — {@link subscribe} + {@link getSnapshot} expose a
 * monotonic version that bumps on any selection or score change. The page reads the live
 * `score` / `selectedNote` off the instance after each notification.
 *
 * Score-wide structure (add/remove measure, set tempo at a position, change instrument) lives
 * in dedicated methods rather than the action array, because those operations don't act on a
 * single selected note.
 */
export class ScoreManipulator {
    private _score: Score | null = null
    private _selectedNote: Note | null = null
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

    get selectedNote(): Note | null {
        return this._selectedNote
    }

    /** Bind a freshly loaded score and its (debounced) autosave, selecting the first note. */
    attach(score: Score, save: () => void): void {
        this._score = score
        this.save = save
        this._selectedNote = score.firstMeasure?.firstNote ?? null
        this.emit()
    }

    // --- Selection ---

    select(note: Note | null): void {
        this._selectedNote = note
        this.emit()
    }

    // --- Action dispatch ---

    /** Run an action against the current selection, then autosave and re-render. */
    run(action: ScoreAction, arg?: unknown): void {
        if (!this._score || !this._selectedNote) return
        this._selectedNote = action.execute(this._score, this._selectedNote, arg)
        this.save()
        this.emit()
    }

    /** Dispatch a keydown to the action bound to its key, if any. */
    handleKeyDown = (e: KeyboardEvent): void => {
        const action = ACTIONS_BY_KEY.get(e.key)
        if (!action) return
        e.preventDefault()
        this.run(action)
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
        this._selectedNote = this._score.lastMeasure?.lastNote ?? null
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
            this._selectedNote = score.measures[measureIdx]?.notes[noteIdx] ?? null
        }
        this.save()
        this.emit()
    }
}
