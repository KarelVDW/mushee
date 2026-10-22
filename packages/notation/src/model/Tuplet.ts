import type { Measure } from './Measure'
import type { Note } from './Note'

/**
 * A group of notes written under one tuplet ratio. Derived per measure version
 * by TupletFinder — instances are stable for as long as the measure's content
 * doesn't change. Semantic (editing operations clip and collapse groups); its
 * geometry is context-dependent and lives in the layout layer
 * (`MeasureLayout.tupletLayoutFor`).
 */
export class Tuplet {
    constructor(
        readonly measure: Measure,
        readonly notes: Note[],
    ) {}

    get firstNote() {
        return this.notes[0]
    }

    get lastNote() {
        return this.notes[this.notes.length - 1]
    }
}
