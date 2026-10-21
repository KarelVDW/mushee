import type { Clef } from './Clef'
import type { Duration } from './Duration'
import type { KeySignature } from './KeySignature'
import { NoteLayout } from './layout/NoteLayout'
import { NoteWidth } from './layout/NoteWidth'
import type { Measure } from './Measure'
import type { Pitch } from './Pitch'
import { STAFF_MIDDLE_LINE } from './staffLines'
import type { StemDirection, TieType } from './types'

/**
 * A note or rest. Content (duration, pitch, tie) is immutable — edits replace
 * notes via `Score.replace` — but a note migrates between measures, so the
 * measure link uses attach/detach (the only class that does; see
 * ARCHITECTURE.md).
 */
export class Note {
    readonly id: string
    private _measure: Measure | undefined
    readonly duration: Duration
    readonly pitch: Pitch | undefined
    readonly tie: TieType | undefined
    private _previewClef: Clef | undefined
    private _detachedLayout: NoteLayout | null = null

    constructor(value: { duration: Duration; pitch?: Pitch; tie?: TieType }) {
        this.id = crypto.randomUUID()
        this.duration = value.duration
        this.pitch = value.pitch
        this.tie = value.tie
    }

    /**
     * The note's layout. Attached notes delegate into the current ScoreLayout;
     * a detached note (the editor's ghost/preview note) gets a standalone
     * snapshot, cached forever since its content and preview clef are fixed.
     * Without a bar to read context from, a detached note draws no accidental.
     */
    get layout(): NoteLayout {
        if (this._measure) return this._measure.layout.noteLayoutFor(this)
        this._detachedLayout ||= new NoteLayout(this, { width: new NoteWidth(this, undefined) })
        return this._detachedLayout
    }

    get measure() {
        if (!this._measure) throw new Error('Note is not assigned to measure')
        return this._measure
    }

    /** Whether the note currently belongs to a measure (replaced/removed notes are detached). */
    get isAttached(): boolean {
        return this._measure !== undefined
    }

    setMeasure(measure: Measure | undefined) {
        this._measure = measure
    }

    get isRest(): boolean {
        return !this.pitch
    }

    get inTuplet(): boolean {
        return this.duration.isTuplet
    }

    /** Whether the triplet toggle can act here: collapse the group it is in, or split it into a triplet. */
    get canToggleTuplet(): boolean {
        return this.inTuplet || !!this.duration.tripletDivision()
    }

    /**
     * Render this note as if under `clef`, bypassing measure resolution. Used for
     * detached preview notes (the editor's ghost note), which aren't part of a
     * measure's note sequence and so have no beat from which to resolve a clef.
     */
    previewUnder(clef: Clef): this {
        this._previewClef = clef
        this._detachedLayout = null
        return this
    }

    get clef(): Clef {
        if (this._previewClef) return this._previewClef
        return this.measure.clefAtOrBefore(this.measure.beatOffsetOf(this))
    }

    /** The key signature in effect at this note (the active key at its beat). */
    get keySignature(): KeySignature {
        return this.measure.keyAtOrBefore(this.measure.beatOffsetOf(this))
    }

    get line(): number {
        if (!this.pitch) return this.duration.restLine
        if (this._previewClef) return this._previewClef.lineFor(this.pitch)
        return this._measure ? this.clef.lineFor(this.pitch) : this.pitch.line
    }

    /** The tie mark for a note bound to its predecessor (`back`) and/or its successor (`forward`). */
    static tieFor(back: boolean, forward: boolean): TieType | undefined {
        if (back && forward) return 'start-stop'
        if (forward) return 'start'
        if (back) return 'stop'
        return undefined
    }

    get tiesForward(): boolean {
        return this.tie === 'start' || this.tie === 'start-stop'
    }

    /**
     * Whether this note sounds as the continuation of a tie rather than a fresh
     * attack. An explicit 'stop' only exists on imported notes (MusicXML); ties
     * created in the model or editor carry just 'start' on the first note, so
     * the back-link is derived from the predecessor, mirroring `Score.tiePartner`.
     */
    get tiesBack(): boolean {
        if (!this._measure) return this.tie === 'stop' || this.tie === 'start-stop'
        // Bound by the predecessor's tie (same sounding pitch — see Score.tiePartner). An explicit 'stop'
        // from an import counts only when the note before it actually ties in; otherwise it is an attack.
        const previous = this.getPrevious()
        return previous !== null && this._measure.score.tiePartner(previous) === this
    }

    /** The stem rule: a note (or a beamed run's average line) on or above the middle line stems down. */
    static stemDirectionFor(line: number): StemDirection {
        return line >= STAFF_MIDDLE_LINE ? 'down' : 'up'
    }

    get stemDir(): StemDirection {
        if (this.isRest) return 'up'
        return Note.stemDirectionFor(this.line)
    }

    // --- Navigation (thin delegates; the traversal lives on Score) ---

    getNext(): Note | null {
        return this.measure.score.nextNote(this)
    }

    getPrevious(): Note | null {
        return this.measure.score.previousNote(this)
    }

    /**
     * This note moved one staff step up (+1) or down (−1), spelled in the key in effect here
     * (an F stepped to in G major is F♯). A rest stays a rest. Returns a new note, as edits do.
     */
    steppedBy(direction: 1 | -1): Note {
        const stepped = this.pitch && (direction > 0 ? this.pitch.raised() : this.pitch.lowered())
        return this.clone({ pitch: stepped ? this.keySignature.spell(stepped) : undefined })
    }

    clone(overrides: { duration?: Duration; pitch?: Pitch; tie?: TieType }) {
        return new Note({
            duration: overrides.duration || this.duration,
            pitch: 'pitch' in overrides ? overrides.pitch : this.pitch,
            tie: 'tie' in overrides ? overrides.tie : this.tie,
        })
    }
}
