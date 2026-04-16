import { Beam } from '../Beam'
import { Measure } from '../Measure'
import { Note } from '../Note'

export class BeamFinder {
    readonly beams: Beam[] = []
    readonly beamByNote = new Map<Note, Beam>()

    constructor(private measure: Measure) {
        this.beams = []
        this.beamByNote = new Map()
        let currentNotes: Note[] = []
        let beat = 0

        const flushGroup = () => {
            if (currentNotes.length >= 2) {
                const avgLine = currentNotes.reduce((sum, n) => sum + (n.pitch?.line ?? 0), 0) / currentNotes.length
                const stemDir: 'up' | 'down' = avgLine >= 3 ? 'down' : 'up'
                const beam = new Beam(this.measure, currentNotes, stemDir)
                this.beams.push(beam)
                for (const n of currentNotes) {
                    this.beamByNote.set(n, beam)
                }
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
