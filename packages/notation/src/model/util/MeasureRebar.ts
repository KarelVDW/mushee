import { sumBy } from 'lodash-es'

import type { BarlineType, TieType } from '../../components/types'
import { BEAT_EPSILON, Duration } from '../Duration'
import { Measure } from '../Measure'
import { Note } from '../Note'
import type { Score } from '../Score'
import type { TimeSignature } from '../TimeSignature'

// One reflowable span of time: a single source note, or the tied chain the old barlines split it into.
interface Unit {
    notes: Note[]
    ratio: { actualNotes: number; normalNotes: number }
    // Effective (tuplet-adjusted) beats.
    beats: number
    tiesBack: boolean
    tiesForward: boolean
}

// A clef/key/tempo marking lifted to region-absolute beats, re-anchored after the reflow.
interface Mark {
    beat: number
    apply: (measure: Measure, beatPosition: number) => void
}

// Rebars a run of measures under a new time signature: the content flows across the new barlines,
// coalescing what the old barlines split and re-splitting with ties where it straddles new ones.
export class MeasureRebar {
    readonly measures: Measure[] = []

    private readonly score: Score
    private readonly timeSignature: TimeSignature
    private readonly capacity: number
    private readonly marks: Mark[]

    // The measure being filled: its notes so far and their effective beats.
    private pending: Note[] = []
    private fill = 0

    constructor(region: Measure[], timeSignature: TimeSignature, regionEndsScore: boolean) {
        this.score = region[0].score
        this.timeSignature = timeSignature
        this.capacity = timeSignature.maxBeats

        const { units, marks, barlines } = this.extract(region)
        this.marks = marks.sort((a, b) => a.beat - b.beat)
        for (const unit of units) this.flow(unit)
        if (this.pending.length > 0 || this.measures.length === 0) this.closeMeasure()
        this.measures[this.measures.length - 1].complete()

        for (const measure of this.measures) measure.setEndBarline('single')
        const finalStyle = region[region.length - 1].endBarline
        this.measures[this.measures.length - 1].setEndBarline(finalStyle ?? (regionEndsScore ? 'end' : 'single'))
        for (const barline of barlines) this.applyBarline(barline)
    }

    // The caller must have put `measures` into the score already, and `onApplied` must restore
    // carry-forward context so each mark's redundancy checks see the marks applied before it.
    applyMarks(onApplied: () => void) {
        for (const mark of this.marks) {
            const index = Math.min(Math.floor((mark.beat + BEAT_EPSILON) / this.capacity), this.measures.length - 1)
            const local = mark.beat - index * this.capacity
            mark.apply(this.measures[index], local < BEAT_EPSILON ? 0 : local)
            onApplied()
        }
    }

    private extract(region: Measure[]) {
        const units: Unit[] = []
        const marks: Mark[] = []
        const barlines: Array<{ beat: number; style: BarlineType }> = []
        let cursor = 0
        for (const [index, measure] of region.entries()) {
            // Leading clefs/keys are lifted only when explicit; inherited ones re-emerge via carry-forward.
            if (measure.leadingClefExplicit) {
                const type = measure.clef.type
                marks.push({ beat: cursor, apply: (m, beat) => m.setClef(beat, type) })
            }
            for (const clef of measure.clefs) {
                if (clef.beatPosition > 0) {
                    const type = clef.type
                    marks.push({ beat: cursor + clef.beatPosition, apply: (m, beat) => m.setClef(beat, type) })
                }
            }
            if (measure.leadingKeyExplicit) {
                const { fifths, mode } = measure.keySignature
                marks.push({ beat: cursor, apply: (m, beat) => m.setKeySignature(beat, fifths, mode) })
            }
            for (const key of measure.keySignatures) {
                if (key.beatPosition > 0) {
                    const { fifths, mode } = key
                    marks.push({ beat: cursor + key.beatPosition, apply: (m, beat) => m.setKeySignature(beat, fifths, mode) })
                }
            }
            for (const tempo of measure.tempos) {
                const { bpm } = tempo
                marks.push({ beat: cursor + tempo.beatPosition, apply: (m, beat) => m.setTempo(beat, bpm) })
            }
            for (const note of measure.notes) {
                const chained = index > 0 && note === measure.firstNote && MeasureRebar.chainsBack(units[units.length - 1], note)
                if (chained) {
                    const unit = units[units.length - 1]
                    unit.notes.push(note)
                    unit.beats += note.duration.effectiveBeats
                    unit.tiesForward = note.tiesForward
                } else {
                    units.push({
                        notes: [note],
                        ratio: note.duration.ratio,
                        beats: note.duration.effectiveBeats,
                        tiesBack: note.tiesBack,
                        tiesForward: note.tiesForward,
                    })
                }
            }
            cursor += measure.beats
            // Only explicit interior styles are lifted; the run's final barline is restored separately.
            if (index < region.length - 1 && measure.endBarline && measure.endBarline !== 'single') {
                barlines.push({ beat: cursor, style: measure.endBarline })
            }
        }
        return { units, marks, barlines }
    }

    // Whether the old barline split one logical note into this tied pair: same pitch and tuplet ratio.
    private static chainsBack(prev: Unit | undefined, note: Note): boolean {
        if (!prev?.tiesForward) return false
        const a = prev.notes[0].pitch
        const b = note.pitch
        if (!a || !b || a.name !== b.name || a.octave !== b.octave || a.alter !== b.alter) return false
        return prev.ratio.actualNotes === note.duration.ratio.actualNotes && prev.ratio.normalNotes === note.duration.ratio.normalNotes
    }

    private flow(unit: Unit) {
        if (unit.notes.length === 1 && unit.beats <= this.capacity - this.fill + BEAT_EPSILON) {
            // An unsplit single note keeps its identity and exact written form (e.g. dots).
            this.pending.push(unit.notes[0])
            this.fill += unit.beats
        } else {
            const ratio = unit.ratio.actualNotes !== 1 ? unit.ratio : undefined
            let remaining = unit.beats
            let firstChunk = true
            while (remaining > BEAT_EPSILON) {
                const space = Math.min(this.capacity - this.fill, remaining)
                const durations = Duration.fromBeats(space, ratio)
                if (durations.length === 0) {
                    // Nothing writable fits the sliver of space left — re-cut from the next measure.
                    /* v8 ignore next -- defensive: a cut from the start of a fresh measure always decomposes, so this cannot repeat; guards the loop against spinning out empty measures */
                    if (this.fill === 0) break
                    this.closeMeasure()
                    continue
                }
                const taken = sumBy(durations, (d) => d.effectiveBeats)
                const residue = remaining - taken
                // A residue nothing can write, even from a fresh measure, would recur forever
                // and must not be tied into: drop it and let this chunk end the unit.
                remaining = residue > BEAT_EPSILON && Duration.fromBeats(Math.min(residue, this.capacity), ratio).length > 0 ? residue : 0
                this.pending.push(...this.pieces(unit, durations, firstChunk, remaining <= BEAT_EPSILON))
                this.fill += taken
                firstChunk = false
                if (remaining > BEAT_EPSILON) this.closeMeasure()
            }
        }
        if (this.fill >= this.capacity - BEAT_EPSILON) this.closeMeasure()
    }

    // The written notes for one chunk of a unit, tied together and to the unit's neighbours.
    private pieces(unit: Unit, durations: Duration[], firstChunk: boolean, lastChunk: boolean): Note[] {
        const pitch = unit.notes[0].pitch
        return durations.map((duration, i) => {
            const first = firstChunk && i === 0
            const last = lastChunk && i === durations.length - 1
            return new Note({
                duration,
                pitch,
                tie: pitch && MeasureRebar.tieType(!first || unit.tiesBack, !last || unit.tiesForward),
            })
        })
    }

    private static tieType(back: boolean, forward: boolean): TieType | undefined {
        if (back && forward) return 'start-stop'
        if (forward) return 'start'
        if (back) return 'stop'
        return undefined
    }

    private closeMeasure() {
        // Clef and key are placeholders; carry-forward propagation and the re-anchored marks set the real ones.
        const measure = new Measure(this.score, 'treble', this.timeSignature)
        measure.addNotes(this.pending)
        this.measures.push(measure)
        this.pending = []
        this.fill = 0
    }

    // Restore an interior explicit barline where its absolute boundary still falls on a new barline.
    private applyBarline(barline: { beat: number; style: BarlineType }) {
        const boundary = Math.round(barline.beat / this.capacity)
        if (boundary > 0 && boundary < this.measures.length && Math.abs(boundary * this.capacity - barline.beat) < BEAT_EPSILON) {
            this.measures[boundary - 1].setEndBarline(barline.style)
        }
    }
}
