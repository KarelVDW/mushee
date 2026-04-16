
import type {
    BarlineType,
    ClefType,
    DurationType,
    MxmlBarStyle,
    MxmlNoteType,
    ScorePartwise,
    TieType
} from '@/components/notation/types'

import { Clef } from '../Clef'
import { Duration } from '../Duration'
import { KeySignature } from '../KeySignature'
import { Measure } from '../Measure'
import { Note } from '../Note'
import { Pitch } from '../Pitch'
import { Score } from '../Score'
import { TimeSignature } from '../TimeSignature'

export class ScoreDeserializer {
    constructor(readonly input: ScorePartwise) {}

    toScore(onChange?: (() => void)): Score {
        const score = new Score(onChange)
        const part = this.input.parts[0]
        if (!part) return score

        for (let mi = 0; mi < part.measures.length; mi++) {
            const mxmlMeasure = part.measures[mi]
            let clef: Clef | undefined
            let timeSignature: TimeSignature | undefined
            let keySignature: KeySignature | undefined
            let endBarline: BarlineType | undefined
            let pendingTempo: number | undefined
            const notes: Note[] = []
            const tempos: Array<{ noteIndex: number; bpm: number }> = []

            for (const entry of mxmlMeasure.entries) {
                switch (entry._type) {
                    case 'attributes': {
                        const c = entry.clef?.[0]
                        if (c) clef = ScoreDeserializer.mxmlClefToClef(c.sign, c.line)
                        const t = entry.time?.[0]
                        if (t) timeSignature = new TimeSignature(Number(t.beats), Number(t.beatType))
                        const k = entry.key?.[0]
                        if (k) keySignature = new KeySignature(k.fifths, k.mode)
                        break
                    }
                    case 'barline': {
                        if (entry.barStyle) endBarline = ScoreDeserializer.mxmlBarStyleToBarlineType(entry.barStyle)
                        break
                    }
                    case 'direction': {
                        if (entry.sound?.tempo !== undefined) pendingTempo = entry.sound.tempo
                        break
                    }
                    case 'note': {
                        if (pendingTempo !== undefined) {
                            tempos.push({ noteIndex: notes.length, bpm: pendingTempo })
                            pendingTempo = undefined
                        }
                        const pitch = entry.pitch
                            ? new Pitch({
                                  name: entry.pitch.step,
                                  alter: entry.pitch.alter ?? 0,
                                  accidental: ScoreDeserializer.alterToAccidental(entry.pitch.alter),
                                  octave: entry.pitch.octave,
                              })
                            : undefined
                        const ratio = entry.timeModification
                            ? { actualNotes: entry.timeModification.actualNotes, normalNotes: entry.timeModification.normalNotes }
                            : undefined
                        const tie = ScoreDeserializer.mxmlTieToTieType(entry.tie)
                        notes.push(
                            new Note({
                                duration: new Duration({
                                    type: entry.type ? ScoreDeserializer.mxmlNoteTypeToDurationType(entry.type) : 'q',
                                    dots: entry.dot,
                                    ratio,
                                }),
                                pitch,
                                tie,
                            }),
                        )
                        break
                    }
                }
            }

            const measure = new Measure(score, mi, { keySignature, endBarline })
            measure.setClef(clef)
            measure.setTimeSignature(timeSignature)
            if (notes.length > 0) measure.addNotes(notes)
            for (const { noteIndex, bpm } of tempos) {
                const note = notes[noteIndex]
                if (note) measure.addTempo(measure.beatOffsetOf(note), bpm)
            }
            score.addMeasure(measure)
        }
        return score
    }

    // --- MusicXML ↔ Internal type conversions ---

    private static readonly NOTE_TYPE_MAP: Record<MxmlNoteType, DurationType> = {
        whole: 'w',
        half: 'h',
        quarter: 'q',
        eighth: '8',
        '16th': '16',
    }

    private static mxmlNoteTypeToDurationType(type: MxmlNoteType): DurationType {
        return ScoreDeserializer.NOTE_TYPE_MAP[type]
    }

    private static alterToAccidental(alter: number | undefined): string | undefined {
        switch (alter) {
            case 1:
                return '#'
            case -1:
                return 'b'
            case 2:
                return '##'
            case -2:
                return 'bb'
            default:
                return undefined
        }
    }

    private static mxmlClefToClef(sign: string, line?: number): Clef {
        const type: ClefType = sign === 'F' && (line === 4 || line === undefined) ? 'bass' : 'treble'
        return new Clef(type)
    }
    
    private static mxmlBarStyleToBarlineType(style: MxmlBarStyle): BarlineType {
        switch (style) {
            case 'light-light':
                return 'double'
            case 'light-heavy':
                return 'end'
            case 'none':
                return 'none'
            default:
                return 'single'
        }
    }

    private static mxmlTieToTieType(ties: Array<{ type: 'start' | 'stop' }> | undefined): TieType | undefined {
        if (!ties?.length) return undefined
        const hasStart = ties.some((t) => t.type === 'start')
        const hasStop = ties.some((t) => t.type === 'stop')
        if (hasStart && hasStop) return 'start-stop'
        if (hasStart) return 'start'
        if (hasStop) return 'stop'
        return undefined
    }

}
