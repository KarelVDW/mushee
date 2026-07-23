import type { TieType } from '../components/types'
import type { Clef } from './Clef'
import { Duration } from './Duration'
import type { KeySignature } from './KeySignature'
import { NoteLayout } from './layout/NoteLayout'
import type { Measure } from './Measure'
import { Pitch } from './Pitch'
import { NoteWidth } from './width/NoteWidth'

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
     */
    get layout(): NoteLayout {
        if (this._measure) return this._measure.layout.noteLayoutFor(this)
        this._detachedLayout ||= new NoteLayout(this, {
            accidentalGlyph: this.pitch?.accidentalGlyph,
            width: new NoteWidth(this, this.pitch?.accidentalGlyph),
        })
        return this._detachedLayout
    }

    get measure() {
        if (!this._measure) throw new Error('Note is not assigned to measure')
        return this._measure
    }

    setMeasure(measure: Measure | undefined) {
        this._measure = measure
    }

    get isRest(): boolean {
        return !this.pitch
    }

    get inTuplet(): boolean {
        return this.duration.ratio.actualNotes !== 1
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

    get tiesForward(): boolean {
        return this.tie === 'start' || this.tie === 'start-stop'
    }

    get tiesBack(): boolean {
        return this.tie === 'stop' || this.tie === 'start-stop'
    }

    get stemDir(): 'up' | 'down' {
        if (this.isRest) return 'up'
        return this.line >= 3 ? 'down' : 'up'
    }

    // --- Navigation (thin delegates; the traversal lives on Score) ---

    getNext(): Note | null {
        return this.measure.score.nextNote(this)
    }

    getPrevious(): Note | null {
        return this.measure.score.previousNote(this)
    }

    clone(overrides: { duration?: Duration; pitch?: Pitch; tie?: TieType }) {
        return new Note({
            duration: overrides.duration || this.duration,
            pitch: 'pitch' in overrides ? overrides.pitch : this.pitch,
            tie: 'tie' in overrides ? overrides.tie : this.tie,
        })
    }
}
