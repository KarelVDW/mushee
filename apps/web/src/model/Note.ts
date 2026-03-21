import { Duration } from './Duration'
import { NoteLayout } from './layout/NoteLayout'
import type { Measure } from './Measure'
import { Pitch } from './Pitch'
import { Tempo } from './Tempo'
import { Tie } from './Tie'

export class Note {
    readonly id: string
    private _measure: Measure | undefined
    readonly duration: Duration
    readonly pitch: Pitch | undefined
    readonly tie: boolean
    private _tempo: Tempo | undefined
    readonly layout: NoteLayout

    constructor(value: { duration: Duration; pitch?: Pitch; tie?: boolean; tempo?: number }) {
        this.id = crypto.randomUUID()
        this.duration = value.duration
        this.pitch = value.pitch
        this.tie = value.tie ?? false
        this._tempo = value.tempo !== undefined ? new Tempo(this, value.tempo) : undefined
        this.layout = new NoteLayout(this)
    }

    get measure() {
        if (!this._measure) throw new Error('Note is not assigned to measure')
        return this._measure
    }

    setMeasure(measure: Measure | undefined) {
        this._measure = measure
    }

    get tempo(): Tempo | undefined {
        return this._tempo
    }

    setTempo(bpm: number | undefined) {
        this._tempo = bpm !== undefined ? new Tempo(this, bpm) : undefined
    }

    get isRest(): boolean {
        return !this.pitch
    }

    get inTuplet(): boolean {
        return this.duration.ratio.numerator !== 1
    }

    get beatOffset() {
        return this.measure.beatOffsetOf(this)
    }

    get tupletGroup() {
        return this.measure.tupletGroupOf(this)
    }

    get beam() {
        return this.measure.beamOf(this)
    }

    get tieToNext(): Tie | undefined {
        if (!this.tie) return undefined
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

    clone(overrides: { duration?: Duration; pitch?: Pitch; tie?: boolean }) {
        return new Note({
            duration: overrides.duration || this.duration,
            pitch: 'pitch' in overrides ? overrides.pitch : this.pitch,
            tie: 'tie' in overrides ? overrides.tie : this.tie,
        })
    }
}
