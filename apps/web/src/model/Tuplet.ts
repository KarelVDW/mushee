import type { TupletLayout } from './layout/TupletLayout'
import type { Measure } from './Measure'
import { Note } from './Note'

/**
 * A group of notes written under one tuplet ratio. Derived per measure version
 * by TupletFinder — instances are stable for as long as the measure's content
 * doesn't change. Semantic (editing operations clip and collapse groups); its
 * geometry is context-dependent and lives in the layout layer.
 */
export class Tuplet {
    private _indexMap: Map<Note, number>

    constructor(
        readonly measure: Measure,
        readonly notes: Note[],
    ) {
        this._indexMap = new Map(notes.map((n, i) => [n, i]))
    }

    /** Delegates into the current ScoreLayout — context-dependent, never cached here. */
    get layout(): TupletLayout {
        return this.measure.layout.tupletLayoutFor(this)
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
}
