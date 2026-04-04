import { TieLayout } from './layout/TieLayout'
import type { Note } from './Note'

export class Tie {
    private _layout: TieLayout | undefined

    constructor(
        readonly note: Note,
        readonly nextNote: Note,
    ) {}

    get layout() {
        this._layout ||= new TieLayout(this)
        return this._layout
    }

    invalidateLayout() {
        this._layout = undefined
    }
}
