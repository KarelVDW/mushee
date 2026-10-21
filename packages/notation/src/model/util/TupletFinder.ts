import { BEAT_EPSILON, type Duration } from '../Duration'
import type { Measure } from '../Measure'
import type { Note } from '../Note'
import { Tuplet } from '../Tuplet'

export class TupletFinder {
    readonly tuplets: Tuplet[] = []
    readonly tupletByNote = new Map<Note, Tuplet>()

    constructor(private measure: Measure) {
        this.tuplets = []
        this.tupletByNote = new Map()
        let currentNotes: Note[] = []
        // A member of the open group, standing for the ratio the group is written under.
        let currentRatio: Duration | null = null
        let totalDuration = 0
        let maxBaseBeats = 0

        for (const note of this.measure.notes) {
            // Ignore non-tuplet notes (ratio 1/1)
            if (!note.duration.isTuplet) {
                if (currentNotes.length > 0) {
                    this.tuplets.push(new Tuplet(this.measure, currentNotes))
                    currentNotes = []
                    currentRatio = null
                    totalDuration = 0
                    maxBaseBeats = 0
                }
                continue
            }

            // Ratio changed — save current set and start fresh
            if (currentRatio && !currentRatio.sameRatioAs(note.duration)) {
                /* v8 ignore next -- currentRatio is set only alongside a non-empty currentNotes (both reset together), so this is always true here */
                if (currentNotes.length > 0) {
                    this.tuplets.push(new Tuplet(this.measure, currentNotes))
                }
                currentNotes = []
                totalDuration = 0
                maxBaseBeats = 0
            }

            currentRatio = note.duration
            // The group spans normalNotes of its base unit. The base isn't stored, so estimate
            // it as the largest undotted member value seen: never smaller than the true base,
            // so an over-estimate falls back to the trailing push (still one group) instead of
            // splitting a group whose first slot is subdivided (e.g. 16, 16, 8, 8). Sizing per
            // group still keeps back-to-back tuplets of the same ratio apart.
            maxBaseBeats = Math.max(maxBaseBeats, note.duration.baseBeats)
            currentNotes.push(note)
            totalDuration += note.duration.effectiveBeats

            // Set is complete when total duration reaches the expected span
            if (totalDuration >= note.duration.ratio.normalNotes * maxBaseBeats - BEAT_EPSILON) {
                this.tuplets.push(new Tuplet(this.measure, currentNotes))
                currentNotes = []
                currentRatio = null
                totalDuration = 0
                maxBaseBeats = 0
            }
        }

        // Push any remaining incomplete set
        if (currentNotes.length > 0) this.tuplets.push(new Tuplet(this.measure, currentNotes))

        // Build reverse lookup
        for (const tuplet of this.tuplets) {
            for (const note of tuplet.notes) {
                this.tupletByNote.set(note, tuplet)
            }
        }
    }
}
