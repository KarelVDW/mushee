import type { ScorePartwise } from '@mushee/notation/components/types'
import type { Score } from '@mushee/notation/model'
import { ScoreDeserializer } from '@mushee/notation/model/util/ScoreDeserializer'
import { ScoreSerializer } from '@mushee/notation/model/util/ScoreSerializer'

/** A note's place as positions — the identity that survives a snapshot round-trip. */
export interface NoteAddress {
    measureIndex: number
    noteIndex: number
}

/** The selection as positions: the anchor (fixed end) and the focus (the active note). */
export interface SelectionAddress {
    anchor: NoteAddress
    focus: NoteAddress
}

/** A past state brought back to life: a freshly built Score plus the selection it carried. */
export interface RestoredState {
    score: Score
    selection: SelectionAddress | null
}

/** One history step: the whole score in serialized form, plus where the selection sat. */
interface HistoryEntry {
    json: string
    selection: SelectionAddress | null
}

/**
 * Undo/redo for the editor, memento-style: each step stores the whole score in its
 * serialized persistence form rather than an inverse operation. The model's mutators are
 * too entangled to invert reliably — `replace` beat-matches and splits ties, a
 * time-signature change rebars whole measure runs, an instrument switch rewrites every
 * note — while the serializer round-trip is the already-proven lossless path every score
 * takes through the API. Snapshots are compact JSON strings (no live object graph is
 * retained), so a full history of even a large score stays around a megabyte.
 *
 * Steps are detected through the score's semantic `version`: selection moves cost
 * nothing, and serialization only runs when a manipulation actually changed something.
 * A mutation whose result round-trips to the identical form (a set to the same value)
 * never becomes a step. Changes made outside tracked manipulations — the recording
 * pipeline writes into the score directly — are folded into one implicit step at the
 * next history interaction, so undoing right after a take removes the whole take.
 */
export class ManipulationHistoryManager {
    /** How many steps back the editor can travel. */
    static readonly MAX_STEPS = 23

    private undoStack: HistoryEntry[] = []
    private redoStack: HistoryEntry[] = []
    /** The score as of the last step boundary — what the next step's undo entry will hold. */
    private currentJson: string | null = null
    private currentVersion = -1

    /** Start over on a freshly attached score: it becomes the (un-undoable) baseline. */
    reset(score: Score): void {
        this.undoStack = []
        this.redoStack = []
        this.currentJson = this.serialize(score)
        this.currentVersion = score.version
    }

    /** Whether a step back exists — including pending out-of-band changes (a finished take). */
    canUndo(score: Score): boolean {
        return this.currentJson !== null && (this.undoStack.length > 0 || score.version !== this.currentVersion)
    }

    /** Whether an undone step can be reapplied. Out-of-band changes void the redo trail. */
    canRedo(score: Score): boolean {
        return this.currentJson !== null && this.redoStack.length > 0 && score.version === this.currentVersion
    }

    /**
     * Run one manipulation as an undoable step. `selection` is the selection going in —
     * where the cursor returns to when the step is undone. A mutation that doesn't change
     * the score's serialized form registers nothing.
     */
    track(score: Score, selection: SelectionAddress | null, mutate: () => void): void {
        this.recordStep(score, selection) // out-of-band changes become their own step first
        mutate()
        this.recordStep(score, selection)
    }

    /** Step back. Returns the state to adopt, or null when there is nothing to undo. */
    undo(score: Score, selection: SelectionAddress | null, onChange?: () => void): RestoredState | null {
        this.recordStep(score, selection) // pending out-of-band changes become the step being undone
        const entry = this.undoStack.pop()
        if (!entry || this.currentJson === null) return null
        this.pushCapped(this.redoStack, { json: this.currentJson, selection })
        return this.restore(entry, onChange)
    }

    /** Reapply the last undone step. Returns the state to adopt, or null when there is none. */
    redo(score: Score, selection: SelectionAddress | null, onChange?: () => void): RestoredState | null {
        this.recordStep(score, selection) // out-of-band changes wrote a new present — this voids the redo trail
        const entry = this.redoStack.pop()
        if (!entry || this.currentJson === null) return null
        this.pushCapped(this.undoStack, { json: this.currentJson, selection })
        return this.restore(entry, onChange)
    }

    /**
     * Record everything that happened to the score since the last boundary as one step.
     * No-op while the score still sits at that boundary, or when the changes round-trip
     * to the identical serialized form (a same-value set bumps the version only).
     */
    private recordStep(score: Score, selection: SelectionAddress | null): void {
        if (this.currentJson === null || score.version === this.currentVersion) return
        const json = this.serialize(score)
        this.currentVersion = score.version
        if (json === this.currentJson) return
        this.pushCapped(this.undoStack, { json: this.currentJson, selection })
        this.redoStack = []
        this.currentJson = json
    }

    /** Push, dropping the oldest step beyond {@link MAX_STEPS} — the history's memory bound. */
    private pushCapped(stack: HistoryEntry[], entry: HistoryEntry): void {
        stack.push(entry)
        if (stack.length > ManipulationHistoryManager.MAX_STEPS) stack.shift()
    }

    /** Rebuild a snapshot into a live Score and make it the new boundary. */
    private restore(entry: HistoryEntry, onChange?: () => void): RestoredState {
        const score = new ScoreDeserializer(JSON.parse(entry.json) as ScorePartwise).toScore(onChange)
        this.currentJson = entry.json
        this.currentVersion = score.version
        return { score, selection: entry.selection }
    }

    private serialize(score: Score): string {
        return JSON.stringify(new ScoreSerializer(score).toInput())
    }
}
