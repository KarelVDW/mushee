import { CLEF_DEFS } from '../../components/constants'
import { Duration } from '../Duration'
import { Instrument } from '../Instrument'
import { Measure } from '../Measure'
import { Note } from '../Note'
import { Pitch } from '../Pitch'
import { Score } from '../Score'
import { TimeSignature } from '../TimeSignature'
import type { BarlineType, ClefType, TieType } from '../types'
import { BARLINE_TYPE, DURATION_TYPE, type MxmlMeasure, type MxmlNote, type ScorePartwise } from './MusicXml'

/** Default staff line per clef sign when MusicXML omits <line>. */
const DEFAULT_CLEF_LINE: Record<string, number> = { G: 2, F: 4, C: 3 }

export class ScoreDeserializer {
    constructor(readonly input: ScorePartwise) {}

    toScore(onChange?: () => void): Score {
        const score = new Score(onChange)
        const scorePart = this.input.partList?.scoreParts?.[0]
        if (scorePart) {
            // The instrument name is the identity: many instruments share one General MIDI program
            // (bass clarinet and clarinet, French horn and horn in C), so resolving by program first
            // would swap the instrument — and its transposition — on every reload. The program only
            // decides for foreign files whose part name we don't know.
            const program = scorePart.midiInstrument?.midiProgram
            const instrumentName = scorePart.scoreInstrument?.instrumentName ?? scorePart.partName
            const named = instrumentName ? Instrument.findByDisplayName(instrumentName) : undefined
            const resolved = named ?? (program !== undefined ? Instrument.byGmProgram(program - 1) : Instrument.Piano)
            score.seedInstrument(resolved)
        }
        const part = this.input.parts[0]
        if (!part) return score

        let activeClefType: ClefType = 'treble'
        let activeKeyFifths = 0
        let activeKeyMode: string | undefined
        let activeTimeSignature: TimeSignature = new TimeSignature(4, 4)
        for (let mi = 0; mi < part.measures.length; mi++) {
            const mxmlMeasure = part.measures[mi]
            let leadingClefType: ClefType | undefined
            let leadingKeyFifths: number | undefined
            let leadingKeyMode: string | undefined
            let timeSignature: TimeSignature | undefined
            let endBarline: BarlineType | undefined
            let pendingTempo: number | undefined
            const notes: Note[] = []
            const tempos: Array<{ noteIndex: number; bpm: number }> = []
            const clefChanges: Array<{ noteIndex: number; type: ClefType }> = []
            const keyChanges: Array<{ noteIndex: number; fifths: number; mode?: string }> = []

            for (const entry of mxmlMeasure.entries) {
                switch (entry._type) {
                    case 'attributes': {
                        const c = entry.clef?.[0]
                        if (c) {
                            const type = ScoreDeserializer.mxmlClefToType(c.sign, c.line, c.clefOctaveChange)
                            // A clef before any notes is the measure's leading clef; after notes, a mid-measure change.
                            if (notes.length === 0) leadingClefType = type
                            else clefChanges.push({ noteIndex: notes.length, type })
                        }
                        const t = entry.time?.[0]
                        if (t) timeSignature = new TimeSignature(Number(t.beats), Number(t.beatType))
                        const k = entry.key?.[0]
                        if (k) {
                            // A key before any notes is the measure's leading key; after notes, a mid-measure change.
                            if (notes.length === 0) {
                                leadingKeyFifths = k.fifths
                                leadingKeyMode = k.mode
                            } else keyChanges.push({ noteIndex: notes.length, fifths: k.fifths, mode: k.mode })
                        }
                        break
                    }
                    case 'barline': {
                        if (entry.barStyle) {
                            const parsed = BARLINE_TYPE[entry.barStyle]
                            // 'single' is the implicit default everywhere in the model; keep it as undefined
                            // so the positional defaults (e.g. the end-of-piece barline) still apply.
                            endBarline = parsed === 'single' ? undefined : parsed
                        }
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
                        notes.push(ScoreDeserializer.mxmlNoteToNote(entry))
                        break
                    }
                }
            }

            if (leadingClefType) activeClefType = leadingClefType
            if (leadingKeyFifths !== undefined) {
                activeKeyFifths = leadingKeyFifths
                activeKeyMode = leadingKeyMode
            }
            if (timeSignature) activeTimeSignature = timeSignature
            const measure = new Measure(score, activeClefType, activeTimeSignature, {
                keyFifths: activeKeyFifths,
                keyMode: activeKeyMode,
                endBarline,
                // A clef/key declared in this measure's attributes is an explicit carry-forward boundary.
                leadingClefExplicit: leadingClefType !== undefined,
                leadingKeyExplicit: leadingKeyFifths !== undefined,
            })
            if (notes.length > 0) measure.addNotes(notes)
            for (const { noteIndex, bpm } of tempos) {
                const note = notes[noteIndex]
                /* v8 ignore else -- defensive: a tempo is only recorded with the index of a note pushed right after it, so `note` is always defined */
                if (note) measure.addTempo(measure.beatOffsetOf(note), bpm)
            }
            for (const { noteIndex, type } of clefChanges) {
                const note = notes[noteIndex]
                if (note) measure.addClef(measure.beatOffsetOf(note), type)
                else {
                    // A clef in trailing <attributes> (after the last note) applies to nothing in this measure
                    // but carries forward — anchor it just past the last note so it becomes lastClef.
                    /* v8 ignore else -- defensive: a clef change is only recorded when notes exist, and notes never shrink, so notes.length > 0 always holds here */
                    if (notes.length > 0) {
                        const lastNote = notes[notes.length - 1]
                        measure.addClef(measure.beatOffsetOf(lastNote) + lastNote.duration.effectiveBeats, type)
                    }
                }
            }
            for (const { noteIndex, fifths, mode } of keyChanges) {
                const note = notes[noteIndex]
                if (note) measure.addKeySignature(measure.beatOffsetOf(note), fifths, mode)
                else {
                    /* v8 ignore else -- defensive: a key change is only recorded when notes exist, and notes never shrink, so notes.length > 0 always holds here */
                    if (notes.length > 0) {
                        const lastNote = notes[notes.length - 1]
                        measure.addKeySignature(measure.beatOffsetOf(lastNote) + lastNote.duration.effectiveBeats, fifths, mode)
                    }
                }
            }
            score.addMeasure(undefined, measure)
        }
        return score
    }

    /**
     * Extract the `<note>` entries of a single MxmlMeasure as Note[]. Attributes,
     * barlines, and direction entries are ignored. Use this when applying a
     * streamed measure update (e.g. from the recording gateway) onto an
     * existing Score via `score.replace([measure.firstNote], notes)`.
     */
    static mxmlMeasureToNotes(measure: MxmlMeasure): Note[] {
        const notes: Note[] = []
        for (const entry of measure.entries) {
            if (entry._type === 'note') notes.push(ScoreDeserializer.mxmlNoteToNote(entry))
        }
        return notes
    }

    // --- MusicXML ↔ Internal type conversions ---

    private static mxmlNoteToNote(entry: MxmlNote): Note {
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
        return new Note({
            duration: new Duration({
                type: entry.type ? DURATION_TYPE[entry.type] : 'q',
                dots: entry.dot,
                ratio,
            }),
            pitch,
            tie,
        })
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

    private static mxmlClefToType(sign: string, line?: number, octaveChange?: number): ClefType {
        const resolvedLine = line ?? DEFAULT_CLEF_LINE[sign] ?? 2
        const oc = octaveChange ?? 0
        for (const [type, def] of Object.entries(CLEF_DEFS)) {
            if (def.sign === sign && def.line === resolvedLine && def.octaveChange === oc) return type as ClefType
        }
        return 'treble'
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
