import { BeamLayout } from './layout/BeamLayout'
import { Measure } from './Measure'
import { Note } from './Note'

export class Beam {
    private _noteSet: Set<Note>
    private _indexMap: Map<Note, number>
    private _layout: BeamLayout | undefined
    constructor(
        private measure: Measure,
        readonly notes: Note[],
        readonly stemDir: 'up' | 'down'
    ) {
        this._noteSet = new Set(notes)
        this._indexMap = new Map(notes.map((n, i) => [n, i]))
    }

    get layout() {
        if (!this._layout) this._layout = new BeamLayout(this)
        return this._layout
    }

    get firstNote() {
        return this.notes[0]
    }

    get lastNote() {
        return this.notes[this.notes.length - 1]
    }

    getIndex(note: Note) {
        return this._indexMap.get(note) ?? null
    }

    hasNote(note: Note) {
        return this._noteSet.has(note)
    }
}
