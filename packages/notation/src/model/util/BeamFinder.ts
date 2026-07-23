import { Measure } from '../Measure'
import { Note } from '../Note'

export interface BeamGroup {
    notes: Note[]
    stemDir: 'up' | 'down'
}

/**
 * Groups a measure's beamable notes (eighths/sixteenths) into beam groups:
 * runs unbroken by rests, beat boundaries, or tuplet edges, each with the stem
 * direction the group shares. Pure grouping — the geometry is BeamLayout's job.
 */
export class BeamFinder {
    readonly groups: BeamGroup[] = []

    constructor(private measure: Measure) {
        let currentNotes: Note[] = []
        let beat = 0

        const flushGroup = () => {
            if (currentNotes.length >= 2) {
                const avgLine = currentNotes.reduce((sum, n) => sum + n.line, 0) / currentNotes.length
                const stemDir: 'up' | 'down' = avgLine >= 3 ? 'down' : 'up'
                this.groups.push({ notes: currentNotes, stemDir })
            }
            currentNotes = []
        }

        for (const note of this.measure.notes) {
            if (!note.duration.isBeamable || note.isRest) {
                flushGroup()
                beat += note.duration.effectiveBeats
                continue
            }

            if (currentNotes.length > 0) {
                const tuplet = measure.tupletGroupOf(note)
                const prevNote = currentNotes[currentNotes.length - 1]
                const prevTuplet = measure.tupletGroupOf(prevNote)
                const sameTuplet = prevTuplet !== undefined && prevTuplet === tuplet

                if (!sameTuplet) {
                    const eitherInTuplet = prevNote.inTuplet || note.inTuplet
                    if (eitherInTuplet) {
                        flushGroup()
                    } else {
                        const prevBeat = beat - prevNote.duration.effectiveBeats
                        const prevBeatBoundary = Math.floor(prevBeat)
                        const nextBeatBoundary = Math.floor(beat)

                        if (nextBeatBoundary > prevBeatBoundary) {
                            flushGroup()
                        }
                    }
                }
            }

            currentNotes.push(note)
            beat += note.duration.effectiveBeats
        }

        flushGroup()
    }
}
