import type { TieType } from '@/components/notation/types'

import type { Clef } from './Clef'
import { Duration } from './Duration'
import type { KeySignature } from './KeySignature'
import { NoteLayout } from './layout/NoteLayout'
import type { Measure } from './Measure'
import { Pitch } from './Pitch'
import { NoteWidth } from './width/NoteWidth'

export class Note {
    readonly id: string
    private _measure: Measure | undefined
    readonly duration: Duration
    readonly pitch: Pitch | undefined
    readonly tie: TieType | undefined
    private _width: NoteWidth | null = null
    private _layout: NoteLayout | null = null
    private _previewClef: Clef | undefined

    constructor(value: { duration: Duration; pitch?: Pitch; tie?: TieType }) {
        this.id = crypto.randomUUID()
        this.duration = value.duration
        this.pitch = value.pitch
        this.tie = value.tie
    }

    get width() {
        if (!this._width) this._width = new NoteWidth(this)
        return this._width
    }

    get layout() {
        if (!this._layout) this._layout = new NoteLayout(this)
        return this._layout
    }

    invalidateLayout() {
        this._layout = null
    }

    /** Clear cached width (and layout, which depends on it) — the displayed accidental, hence width, is key-dependent. */
    invalidateWidth() {
        this._width = null
        this._layout = null
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

    get beats() {
        return this.duration.effectiveBeats
    }

    /** The tempo (BPM) sounding at this note — the active marking at or before it. */
    get bpm(): number {
        return this.measure.score.bpmAt(this)
    }

    /**
     * Render this note as if under `clef`, bypassing measure resolution. Used for
     * detached preview notes (the editor's ghost note), which aren't part of a
     * measure's note sequence and so have no beat from which to resolve a clef.
     */
    previewUnder(clef: Clef): this {
        this._previewClef = clef
        this._layout = null
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

    /**
     * The accidental glyph drawn for this note (key- and measure-aware), or undefined if none. A detached
     * or preview note has no measure context, so it falls back to its pitch's own accidental.
     */
    get displayAccidentalGlyph(): string | undefined {
        if (!this.pitch) return undefined
        if (this._previewClef || !this._measure) return this.pitch.accidentalGlyph
        return this.measure.accidentalGlyphFor(this)
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

    // --- Navigation ---

    getNext(): Note | null {
        const nextInMeasure = this.measure.getNextNote(this)
        if (nextInMeasure) return nextInMeasure
        const nextMeasure = this.measure.getNext()
        return nextMeasure?.getNextNote() ?? null
    }

    getPrevious(): Note | null {
        const prevInMeasure = this.measure.getPreviousNote(this)
        if (prevInMeasure) return prevInMeasure
        const prevMeasure = this.measure.getPrevious()
        return prevMeasure?.lastNote ?? null
    }

    clone(overrides: { duration?: Duration; pitch?: Pitch; tie?: TieType }) {
        return new Note({
            duration: overrides.duration || this.duration,
            pitch: 'pitch' in overrides ? overrides.pitch : this.pitch,
            tie: 'tie' in overrides ? overrides.tie : this.tie,
        })
    }
}
