import { CLEF_DEFS } from '@/components/notation/constants'
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

import type { KeySignature } from '../KeySignature'
import { Measure } from '../Measure'
import { Note } from '../Note'
import { Score } from '../Score'
import { TimeSignature } from '../TimeSignature'

export class MeasureSerializer {
    constructor(readonly measure: Measure) {}

    serialize() {
        const entries: MxmlMeasureEntry[] = []

        const previousMeasure = this.measure.score.getPreviousMeasure(this.measure)
        // The clef entering this measure is the one *leaving* the previous measure (its last clef), so
        // a clef carried forward across measures isn't re-emitted as a redundant change.
        const previousClefType = previousMeasure?.lastClef.type
        // Key/clef entering this measure is the one *leaving* the previous measure (its last one), so a
        // value carried forward isn't re-emitted as a redundant change. Before measure 1, key defaults to C (0).
        const previousKeyFifths = previousMeasure?.lastKey.fifths ?? 0
        const previousTimeSignature = previousMeasure?.timeSignature
        // An explicit leading clef/key is a carry-forward boundary and must be emitted even when it equals
        // the carried-in value, or the boundary is lost on reload (it would deserialize as inherited).
        const clefChanged = this.measure.leadingClefExplicit || previousClefType !== this.measure.clef.type
        const keyChanged = this.measure.leadingKeyExplicit || previousKeyFifths !== this.measure.keySignature.fifths
        const timeSignatureChanged =
            previousTimeSignature?.beatAmount !== this.measure.timeSignature.beatAmount ||
            previousTimeSignature?.beatType !== this.measure.timeSignature.beatType
        // Emit <transpose> alongside the first measure's attributes when the score's instrument transposes.
        const isFirstMeasure = previousMeasure === null
        const instrument = this.measure.score.instrument
        const includeTranspose = isFirstMeasure && (instrument.chromaticTranspose !== 0 || instrument.diatonicTranspose !== 0)
        if (clefChanged || keyChanged || timeSignatureChanged || includeTranspose) {
            entries.push({
                _type: 'attributes' as const,
                divisions: DIVISIONS,
                ...(clefChanged && { clef: [MeasureSerializer.clefToMxmlClef(this.measure.clef.type)] }),
                ...(timeSignatureChanged && { time: [MeasureSerializer.timeSignatureToMxmlTime(this.measure.timeSignature)] }),
                ...(keyChanged && { key: [MeasureSerializer.keyToMxmlKey(this.measure.keySignature)] }),
                ...(includeTranspose && {
                    transpose: { chromatic: instrument.chromaticTranspose, diatonic: instrument.diatonicTranspose },
                }),
            })
        }

        // Mid-measure clef changes serialize as inline <attributes>, each emitted just before the first
        // note at or after its beat — so a clef whose beat no longer coincides with a note start (after a
        // note edit) is still written and re-anchors to that note on reload. The leading clef is above.
        const midClefs = this.measure.midMeasureClefs
        let nextClef = 0
        const emitClef = (type: ClefType) =>
            entries.push({ _type: 'attributes' as const, divisions: DIVISIONS, clef: [MeasureSerializer.clefToMxmlClef(type)] })
        const midKeys = this.measure.midMeasureKeySignatures
        let nextKey = 0
        const emitKey = (key: KeySignature) =>
            entries.push({ _type: 'attributes' as const, divisions: DIVISIONS, key: [MeasureSerializer.keyToMxmlKey(key)] })

        for (const note of this.measure.notes) {
            const beat = this.measure.beatOffsetOf(note)
            while (nextClef < midClefs.length && midClefs[nextClef].beatPosition <= beat) emitClef(midClefs[nextClef++].type)
            while (nextKey < midKeys.length && midKeys[nextKey].beatPosition <= beat) emitKey(midKeys[nextKey++])
            const tempoAtBeat = this.measure.tempoAtBeat(beat)
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
        // Clef/key changes past the last note's beat still carry into the next measure — emit them so they round-trip.
        while (nextClef < midClefs.length) emitClef(midClefs[nextClef++].type)
        while (nextKey < midKeys.length) emitKey(midKeys[nextKey++])

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

    private static clefToMxmlClef(clef: ClefType): { sign: MxmlClefSign; line: number; clefOctaveChange?: number } {
        const def = CLEF_DEFS[clef]
        return { sign: def.sign, line: def.line, ...(def.octaveChange !== 0 && { clefOctaveChange: def.octaveChange }) }
    }

    private static keyToMxmlKey(key: KeySignature): { fifths: number; mode?: string } {
        return { fifths: key.fifths, ...(key.mode && { mode: key.mode }) }
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
    constructor(readonly score: Score) {}

    toInput(): ScorePartwise {
        const measures = this.score.measures.map((measure) => new MeasureSerializer(measure).serialize())
        const instrument = this.score.instrument
        return {
            partList: {
                scoreParts: [
                    {
                        id: 'P1',
                        partName: instrument.displayName,
                        scoreInstrument: { id: 'P1-I1', instrumentName: instrument.displayName },
                        midiInstrument: { id: 'P1-I1', midiProgram: instrument.gmProgram + 1 },
                    },
                ],
            },
            parts: [{ id: 'P1', measures }],
        }
    }
}
