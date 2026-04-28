
import type {
    BarlineType,
    ClefType,
    DurationType,
    MxmlBarStyle,
    MxmlClefSign,
    MxmlMeasureEntry,
    MxmlNoteType,
    MxmlStep,
    ScorePartwise,
    TieType,
} from '@/components/notation/types'

const DIVISIONS = 12 // divisions per quarter note

import { Measure } from '../Measure'
import { Note } from '../Note'
import { Score } from '../Score'
import { TimeSignature } from '../TimeSignature'

export class MeasureSerializer {
    constructor(readonly measure: Measure) {
    }

    serialize() {
        const entries: MxmlMeasureEntry[] = []

        const previousClef = this.measure.score.getPreviousMeasure(this.measure)?.clef
        const clefChanged = previousClef?.type !== this.measure.clef.type
        if (clefChanged || this.measure.timeSignature || this.measure.keySignature) {
            entries.push({
                _type: 'attributes' as const,
                divisions: DIVISIONS,
                ...(clefChanged && { clef: [MeasureSerializer.clefToMxmlClef(this.measure.clef.type)] }),
                ...(this.measure.timeSignature && { time: [MeasureSerializer.timeSignatureToMxmlTime(this.measure.timeSignature)] }),
                ...(this.measure.keySignature && {
                    key: [{ fifths: this.measure.keySignature.fifths, ...(this.measure.keySignature.mode && { mode: this.measure.keySignature.mode }) }],
                }),
            })
        }

        for (const note of this.measure.notes) {
            const tempoAtBeat = this.measure.tempoAtBeat(this.measure.beatOffsetOf(note))
            if (tempoAtBeat) {
                entries.push({ _type: 'direction' as const, sound: { tempo: tempoAtBeat.bpm } })
            }
            entries.push({
                _type: 'note' as const,
                ...(note.pitch
                    ? {
                          pitch: {
                              step: note.pitch.name as MxmlStep,
                              ...(note.pitch.alter !== 0 && { alter: note.pitch.alter }),
                              octave: note.pitch.octave,
                          },
                      }
                    : { rest: {} }),
                duration: MeasureSerializer.computeDivisions(note),
                voice: '1',
                type: MeasureSerializer.durationTypeToMxmlNoteType(note.duration.type),
                ...(note.duration.dots > 0 && { dot: note.duration.dots }),
                ...(note.tie && { tie: MeasureSerializer.tieTypeToMxmlTie(note.tie) }),
                ...(note.inTuplet && {
                    timeModification: {
                        actualNotes: note.duration.ratio.actualNotes,
                        normalNotes: note.duration.ratio.normalNotes,
                    },
                }),
            })
        }

        if (this.measure.endBarline && this.measure.endBarline !== 'single') {
            entries.push({
                _type: 'barline' as const,
                location: 'right' as const,
                barStyle: MeasureSerializer.barlineTypeToMxmlBarStyle(this.measure.endBarline),
            })
        }

        return { number: String(this.measure.score.getIndexForMeasure(this.measure) + 1), entries }
    }

    private static readonly DURATION_TYPE_MAP: Record<DurationType, MxmlNoteType> = {
        w: 'whole',
        h: 'half',
        q: 'quarter',
        '8': 'eighth',
        '16': '16th',
    }

    private static durationTypeToMxmlNoteType(type: DurationType): MxmlNoteType {
        return MeasureSerializer.DURATION_TYPE_MAP[type]
    }

    private static clefToMxmlClef(clef: ClefType): { sign: MxmlClefSign; line: number } {
        return clef === 'bass' ? { sign: 'F', line: 4 } : { sign: 'G', line: 2 }
    }

    private static barlineTypeToMxmlBarStyle(type: BarlineType): MxmlBarStyle {
        switch (type) {
            case 'double':
                return 'light-light'
            case 'end':
                return 'light-heavy'
            case 'none':
                return 'none'
            default:
                return 'regular'
        }
    }

    private static timeSignatureToMxmlTime(ts: TimeSignature): { beats: string; beatType: string } {
        return { beats: String(ts.beatAmount), beatType: String(ts.beatType) }
    }

    private static tieTypeToMxmlTie(tie: TieType): Array<{ type: 'start' | 'stop' }> {
        switch (tie) {
            case 'start':
                return [{ type: 'start' }]
            case 'stop':
                return [{ type: 'stop' }]
            case 'start-stop':
                return [{ type: 'stop' }, { type: 'start' }]
        }
    }

    private static computeDivisions(note: Note): number {
        const base: Record<DurationType, number> = { w: 48, h: 24, q: 12, '8': 6, '16': 3 }
        let dur = base[note.duration.type]
        if (note.duration.dots > 0) dur = dur * (2 - 1 / Math.pow(2, note.duration.dots))
        if (note.inTuplet) dur = dur * (note.duration.ratio.normalNotes / note.duration.ratio.actualNotes)
        return Math.round(dur)
    }
}

export class ScoreSerializer {
    constructor(readonly score: Score) {
    }

    toInput(): ScorePartwise {
        const measures = this.score.measures.map((measure) => new MeasureSerializer(measure).serialize())
        return {
            partList: { scoreParts: [{ id: 'P1', partName: 'Part 1' }] },
            parts: [{ id: 'P1', measures }],
        }
    }
}
