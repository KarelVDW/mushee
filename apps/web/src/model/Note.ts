import { Duration } from './Duration'
import type { Measure } from './Measure'
import { Pitch } from './Pitch'

export class Note {
    readonly id: string
    private _measure: Measure | undefined
    readonly duration: Duration
    readonly pitch: Pitch | undefined
    readonly tie: boolean
    private _tempo: number | undefined

    constructor(value: { duration: Duration; pitch?: Pitch; tie?: boolean; tempo?: number }) {
        this.id = crypto.randomUUID()
        this.duration = value.duration
        this.pitch = value.pitch
        this.tie = value.tie ?? false
        this._tempo = value.tempo
    }

    get measure() {
        if (!this._measure) throw new Error('Note is not assigned to measure')
        return this._measure
    }

    setMeasure(measure: Measure | undefined) {
        this._measure = measure
    }

    get tempo(): number | undefined {
        return this._tempo
    }

    setTempo(value: number | undefined) {
        this._tempo = value
    }

    get isRest(): boolean {
        return !this.pitch
    }

    get inTuplet(): boolean {
        return this.duration.ratio.numerator !== 1
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

    clone(overrides: { duration?: Duration; pitch?: Pitch; tie?: boolean }) {
        return new Note({
            duration: overrides.duration || this.duration,
            pitch: 'pitch' in overrides ? overrides.pitch : this.pitch,
            tie: 'tie' in overrides ? overrides.tie : this.tie,
        })
    }
}
