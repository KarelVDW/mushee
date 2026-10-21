import { CLEF_DEFS } from '../../components/constants'
import type { BarlineType, ClefType, TieType } from '../../components/types'
import type { Duration } from '../Duration'
import type { KeySignature } from '../KeySignature'
import { Measure } from '../Measure'
import { Score } from '../Score'
import { TimeSignature } from '../TimeSignature'
import {
    DIVISIONS,
    MXML_NOTE_TYPE,
    type MxmlBarStyle,
    type MxmlClefSign,
    type MxmlMeasureEntry,
    type MxmlNote,
    type MxmlPitch,
    type MxmlStep,
    type MxmlTie,
    type ScorePartwise,
} from './MusicXml'

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
        const previousKeyMode = previousMeasure?.lastKey.mode
        const previousTimeSignature = previousMeasure?.timeSignature
        // An explicit leading clef/key is a carry-forward boundary and must be emitted even when it equals
        // the carried-in value, or the boundary is lost on reload (it would deserialize as inherited).
        const clefChanged = this.measure.leadingClefExplicit || previousClefType !== this.measure.clef.type
        // The mode (major/minor, from imported files) is part of the key: C major and A minor share fifths=0.
        const keyChanged =
            this.measure.leadingKeyExplicit ||
            previousKeyFifths !== this.measure.keySignature.fifths ||
            previousKeyMode !== this.measure.keySignature.mode
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
                entries.push({
                    _type: 'direction' as const,
                    metronome: {
                        beatUnit: MXML_NOTE_TYPE[tempoAtBeat.pulse.type],
                        beatUnitDots: tempoAtBeat.pulse.dots,
                        perMinute: tempoAtBeat.pulseBpm,
                    },
                    sound: { tempo: tempoAtBeat.bpm },
                })
            }
            const pitch: MxmlPitch | undefined = note.pitch && {
                step: note.pitch.name as MxmlStep,
                ...(note.pitch.alter !== 0 && { alter: note.pitch.alter }),
                octave: note.pitch.octave,
            }
            entries.push(ScoreSerializer.noteEntry(note.duration, pitch, note.tie && MeasureSerializer.tieTypeToMxmlTie(note.tie)))
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
            /* v8 ignore next 2 -- only reachable for 'single', but the caller guards `endBarline !== 'single'`, so this default never runs */
            default:
                return 'regular'
        }
    }

    private static timeSignatureToMxmlTime(ts: TimeSignature): { beats: string; beatType: string } {
        return { beats: String(ts.beatAmount), beatType: String(ts.beatType) }
    }

    private static tieTypeToMxmlTie(tie: TieType): MxmlTie[] {
        switch (tie) {
            case 'start':
                return [{ type: 'start' }]
            case 'stop':
                return [{ type: 'stop' }]
            case 'start-stop':
                return [{ type: 'stop' }, { type: 'start' }]
        }
    }
}

export class ScoreSerializer {
    constructor(readonly score: Score) {}

    /**
     * One `<note>` entry of the wire format — shared by the serializer and the MusicXML
     * importer, so both write a note value the same way. Keys are in the order saved
     * documents have always had them, keeping re-saved JSON byte-identical.
     */
    static noteEntry(duration: Duration, pitch: MxmlPitch | undefined, tie?: MxmlTie[]): MxmlNote {
        const { actualNotes, normalNotes } = duration.ratio
        return {
            _type: 'note',
            ...(pitch ? { pitch } : { rest: {} }),
            // effectiveBeats × DIVISIONS, multiplied in this order so a value that falls between
            // divisions (a double-dotted 16th triplet is 3.5) rounds the way saved documents have it.
            duration: Math.round(duration.beats * DIVISIONS * (normalNotes / actualNotes)),
            voice: '1',
            type: MXML_NOTE_TYPE[duration.type],
            ...(duration.dots > 0 && { dot: duration.dots }),
            ...(tie && { tie }),
            ...(actualNotes !== 1 && { timeModification: { actualNotes, normalNotes } }),
        }
    }

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
