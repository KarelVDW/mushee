import { BEAT_EPSILON } from '../Duration'
import type { Measure } from '../Measure'
import type { Note } from '../Note'
import { Tuplet } from '../Tuplet'

/** Groups a measure's consecutive same-ratio notes into Tuplets, closing a group when it spans normalNotes of its base value. */
export class TupletFinder {
    readonly tuplets: Tuplet[] = []
    readonly tupletByNote = new Map<Note, Tuplet>()

    constructor(measure: Measure) {
        let currentNotes: Note[] = []
        let totalDuration = 0
        let maxBaseBeats = 0
        const flush = () => {
            if (currentNotes.length) this.tuplets.push(new Tuplet(measure, currentNotes))
            currentNotes = []
            totalDuration = 0
            maxBaseBeats = 0
        }

        for (const note of measure.notes) {
            // A plain (1:1) note ends any open group and belongs to none.
            if (!note.duration.isTuplet) {
                flush()
                continue
            }

            // Ratio changed — close the open group and start fresh
            if (currentNotes.length && !currentNotes[0].duration.sameRatioAs(note.duration)) flush()

            // The group spans normalNotes of its base unit. The base isn't stored, so estimate
            // it as the largest undotted member value seen: never smaller than the true base,
            // so an over-estimate falls back to the trailing flush (still one group) instead of
            // splitting a group whose first slot is subdivided (e.g. 16, 16, 8, 8). Sizing per
            // group still keeps back-to-back tuplets of the same ratio apart.
            maxBaseBeats = Math.max(maxBaseBeats, note.duration.baseBeats)
            currentNotes.push(note)
            totalDuration += note.duration.effectiveBeats

            // The group is complete when its total duration reaches the expected span
            if (totalDuration >= note.duration.ratio.normalNotes * maxBaseBeats - BEAT_EPSILON) flush()
        }

        // Close any remaining incomplete group
        flush()

        // Build reverse lookup
        for (const tuplet of this.tuplets) {
            for (const note of tuplet.notes) {
                this.tupletByNote.set(note, tuplet)
            }
        }
    }
}
