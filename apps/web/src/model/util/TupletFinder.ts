import { Measure } from '../Measure'
import { Note } from '../Note'
import { Tuplet } from '../Tuplet'

export class TupletFinder {
    readonly tuplets: Tuplet[] = []
    readonly tupletByNote = new Map<Note, Tuplet>()

    constructor(private measure: Measure) {
        this.tuplets = []
        this.tupletByNote = new Map()
        let currentNotes: Note[] = []
        let currentRatio: { actualNotes: number; normalNotes: number } | null = null
        let totalDuration = 0

        for (const note of this.measure.notes) {
            const { actualNotes, normalNotes } = note.duration.ratio

            // Ignore non-tuplet notes (ratio 1/1)
            if (actualNotes === 1 && normalNotes === 1) {
                if (currentNotes.length > 0) {
                    this.tuplets.push(new Tuplet(this.measure, currentNotes))
                    currentNotes = []
                    currentRatio = null
                    totalDuration = 0
                }
                continue
            }

            // Ratio changed — save current set and start fresh
            if (currentRatio && (currentRatio.actualNotes !== actualNotes || currentRatio.normalNotes !== normalNotes)) {
                if (currentNotes.length > 0) {
                    this.tuplets.push(new Tuplet(this.measure, currentNotes))
                }
                currentNotes = []
                totalDuration = 0
            }

            currentRatio = { actualNotes, normalNotes }
            currentNotes.push(note)
            totalDuration += note.duration.effectiveBeats

            // Set is complete when total duration reaches the normalNotes
            if (totalDuration >= normalNotes - 0.001) {
                this.tuplets.push(new Tuplet(this.measure, currentNotes))
                currentNotes = []
                currentRatio = null
                totalDuration = 0
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
