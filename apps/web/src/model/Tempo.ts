import { TempoLayout } from './layout/TempoLayout'
import type { Note } from './Note'

export class Tempo {
    private _layout: TempoLayout | undefined

    constructor(
        readonly note: Note,
        readonly bpm: number,
    ) {}

    get layout() {
        this._layout ||= new TempoLayout(this)
        return this._layout
    }
}
