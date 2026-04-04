import type { TieType } from '@/components/notation/types'

import { Duration } from './Duration'
import { NoteLayout } from './layout/NoteLayout'
import type { Measure } from './Measure'
import { Pitch } from './Pitch'
import { Tie } from './Tie'

export class Note {
    readonly id: string
    private _measure: Measure | undefined
    readonly duration: Duration
    readonly pitch: Pitch | undefined
    readonly tie: TieType | undefined
    private _layout: NoteLayout | null = null

    constructor(value: { duration: Duration; pitch?: Pitch; tie?: TieType }) {
        this.id = crypto.randomUUID()
        this.duration = value.duration
        this.pitch = value.pitch
        this.tie = value.tie
    }

    get layout() {
        if (!this._layout) this._layout = new NoteLayout(this)
        return this._layout
    }

    invalidateLayout() {
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

    get beatOffset() {
        return this.measure.beatOffsetOf(this)
    }

    get tuplet() {
        return this.measure.tupletGroupOf(this)
    }

    get beam() {
        return this.measure.beamOf(this)
    }

    get tiesForward(): boolean {
        return this.tie === 'start' || this.tie === 'start-stop'
    }

    get tiesBack(): boolean {
        return this.tie === 'stop' || this.tie === 'start-stop'
    }

    get tieToNext(): Tie | undefined {
        if (!this.tiesForward) return undefined
        const next = this.getNext()
        if (!next) return undefined
        return new Tie(this, next)
    }

    get stemDir(): 'up' | 'down' {
        if (this.isRest) return 'up'
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        return this.beam?.stemDir ?? (this.pitch!.line >= 3 ? 'down' : 'up')
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
