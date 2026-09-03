import type {
    DurationType,
    MxmlAttributes,
    MxmlBarStyle,
    MxmlClefSign,
    MxmlMeasure,
    MxmlMeasureEntry,
    MxmlNote,
    MxmlNoteType,
    MxmlPartList,
    MxmlPitch,
    MxmlStep,
    ScorePartwise,
} from '../../components/types'
import { BEAT_EPSILON, Duration } from '../Duration'
import type { Measure } from '../Measure'
import { Note } from '../Note'
import { Pitch } from '../Pitch'
import type { Score } from '../Score'
import { TimeSignature } from '../TimeSignature'
import { DurationSpeller } from './DurationSpeller'
import type { ImportedScore } from './ImportedScore'
import { ScoreDeserializer } from './ScoreDeserializer'

const DIVISIONS = 12 // divisions per quarter note in the JSON handed to ScoreDeserializer

const NOTE_TYPES: Record<string, DurationType> = { whole: 'w', half: 'h', quarter: 'q', eighth: '8', '16th': '16' }
const MXML_TYPES: Record<DurationType, MxmlNoteType> = { w: 'whole', h: 'half', q: 'quarter', '8': 'eighth', '16': '16th' }
/** Quarter-note beats of every MusicXML note-type value — for metronome marks in other units. */
const TYPE_BEATS: Record<string, number> = {
    maxima: 32,
    long: 16,
    breve: 8,
    whole: 4,
    half: 2,
    quarter: 1,
    eighth: 0.5,
    '16th': 0.25,
    '32nd': 0.125,
    '64th': 0.0625,
}
const BAR_STYLES: Record<string, MxmlBarStyle> = {
    regular: 'regular',
    'light-light': 'light-light',
    'light-heavy': 'light-heavy',
    'heavy-heavy': 'light-heavy',
    none: 'none',
}
const STEPS = new Set(['A', 'B', 'C', 'D', 'E', 'F', 'G'])

const WARN_PARTS = (name: string, others: number) =>
    `Only the first part (“${name}”) was imported; ${others} other ${others === 1 ? 'part was' : 'parts were'} left out.`
const WARN_VOICES = 'Only the first voice of the part was imported.'
const WARN_CHORDS = 'Chords were reduced to their top note.'
const WARN_GRACE = 'Grace and cue notes were left out.'
const WARN_SIMPLIFIED = 'Some note values were rewritten with the nearest supported ones.'
const WARN_DROPPED = 'Some notes could not be read and were left out.'
const WARN_SHORT = 'Notes shorter than a sixteenth were left out.'
const WARN_OVERFLOW = 'Some bars held more than their time signature allows; the overflow was trimmed.'

/**
 * Reads a MusicXML document (partwise or timewise) into a Score. The model holds a
 * single melodic voice, so the importer keeps the first part's first voice on its
 * first staff, reduces chords to their top note, drops grace notes, and rewrites
 * note values it cannot express (32nds, breves, inconsistent type/duration pairs)
 * with the metrical speller — every such reduction is reported as a warning.
 *
 * The document is first normalized into the same MusicXML-JSON the API stores,
 * then built through ScoreDeserializer, so everything an import can produce is by
 * construction something the editor can load. A final pass fits each bar to its
 * time signature: short bars are padded with rests (a short opening bar is treated
 * as a pickup), overfull bars are trimmed.
 */
export class MusicXmlImporter {
    private readonly warnings = new Set<string>()
    private divisions = 1
    private voice: string | undefined
    private timeSignature = new TimeSignature(4, 4)
    /** Beats emitted so far in the bar being read — the metrical position the speller needs. */
    private fill = 0
    private entries: MxmlMeasureEntry[] = []
    /** The written pieces of the last emitted note, so a following chord note can raise its pitch. */
    private lastNote: MxmlNote[] = []

    constructor(readonly xml: string) {}

    toScore(): ImportedScore {
        const document = new DOMParser().parseFromString(this.xml, 'application/xml')
        if (document.querySelector('parsererror')) throw new Error('The file is not well-formed XML.')
        const root = document.documentElement
        if (root.tagName !== 'score-partwise' && root.tagName !== 'score-timewise') throw new Error('The file is not a MusicXML score.')

        const { partList, partId } = this.readPartList(root)
        const measures = this.measuresOf(root, partId)
        if (!measures.length) throw new Error('The score has no measures.')

        const input: ScorePartwise = {
            partList,
            parts: [{ id: partId, measures: measures.map((entries, index) => this.readMeasure(entries, index)) }],
        }
        const score = new ScoreDeserializer(input).toScore()
        this.fit(score)
        return { score, title: this.readTitle(root), warnings: [...this.warnings] }
    }

    // --- Header ---

    private readTitle(root: Element): string | undefined {
        const work = this.child(root, 'work')
        return (work && this.text(work, 'work-title')) || this.text(root, 'movement-title')
    }

    private readPartList(root: Element): { partList: MxmlPartList; partId: string } {
        const partList = this.child(root, 'part-list')
        const scoreParts = partList ? this.children(partList, 'score-part') : []
        const first = scoreParts[0]
        const partId = first?.getAttribute('id') ?? this.firstPartId(root)
        const partName = (first && this.text(first, 'part-name')) ?? 'Piano'
        if (scoreParts.length > 1) this.warn(WARN_PARTS(partName, scoreParts.length - 1))

        const scoreInstrument = first && this.child(first, 'score-instrument')
        const instrumentName = scoreInstrument && this.text(scoreInstrument, 'instrument-name')
        const midiInstrument = first && this.child(first, 'midi-instrument')
        const midiProgram = midiInstrument && this.number(midiInstrument, 'midi-program')
        return {
            partId,
            partList: {
                scoreParts: [
                    {
                        id: partId,
                        partName,
                        ...(instrumentName && { scoreInstrument: { id: `${partId}-I1`, instrumentName } }),
                        ...(midiProgram !== undefined &&
                            midiProgram >= 1 &&
                            midiProgram <= 128 && { midiInstrument: { id: `${partId}-I1`, midiProgram: Math.round(midiProgram) } }),
                    },
                ],
            },
        }
    }

    /** The id of the first `<part>` in the body — for documents without a part-list. */
    private firstPartId(root: Element): string {
        const holder = root.tagName === 'score-partwise' ? root : (this.child(root, 'measure') ?? root)
        return this.child(holder, 'part')?.getAttribute('id') ?? 'P1'
    }

    /** The entry elements of every measure of `partId`, whichever way the document is organized. */
    private measuresOf(root: Element, partId: string): Element[][] {
        if (root.tagName === 'score-partwise') {
            const part = this.children(root, 'part').find((p) => p.getAttribute('id') === partId)
            return part ? this.children(part, 'measure').map((measure) => Array.from(measure.children)) : []
        }
        return this.children(root, 'measure').map((measure) => {
            const part = this.children(measure, 'part').find((p) => p.getAttribute('id') === partId)
            return part ? Array.from(part.children) : []
        })
    }

    // --- Measures ---

    private readMeasure(elements: Element[], index: number): MxmlMeasure {
        this.fill = 0
        this.entries = []
        this.lastNote = []
        for (const element of elements) {
            switch (element.tagName) {
                case 'attributes':
                    this.readAttributes(element)
                    break
                case 'direction':
                case 'sound':
                    this.readTempo(element)
                    break
                case 'note':
                    this.readNote(element)
                    break
                case 'forward':
                    this.readForward(element)
                    break
                case 'barline':
                    this.readBarline(element)
                    break
            }
        }
        return { number: String(index + 1), entries: this.entries }
    }

    private readAttributes(element: Element) {
        const attributes: MxmlAttributes = { _type: 'attributes' }
        const divisions = this.number(element, 'divisions')
        if (divisions && divisions > 0) this.divisions = divisions

        const key = this.child(element, 'key')
        const fifths = key && this.number(key, 'fifths')
        if (key && fifths !== undefined) {
            const mode = this.text(key, 'mode')
            attributes.key = [{ fifths: Math.max(-7, Math.min(7, Math.round(fifths))), ...(mode && { mode }) }]
        }

        const time = this.child(element, 'time')
        if (time && !this.child(time, 'senza-misura')) {
            // Additive meters ("3+2") are summed — the model draws a single numerator.
            const beats = (this.text(time, 'beats') ?? '')
                .split('+')
                .map((part) => Number(part))
                .reduce((sum, part) => sum + part, 0)
            const beatType = this.number(time, 'beat-type')
            if (
                Number.isInteger(beats) &&
                beats >= 1 &&
                beats <= 99 &&
                beatType &&
                Number.isInteger(beatType) &&
                beatType >= 1 &&
                beatType <= 99
            ) {
                attributes.time = [{ beats: String(beats), beatType: String(beatType) }]
                this.timeSignature = new TimeSignature(beats, beatType)
            }
        }

        // Only the first staff is imported, so only its clef matters.
        const clef = this.children(element, 'clef').find((c) => (c.getAttribute('number') ?? '1') === '1')
        const sign = clef && this.text(clef, 'sign')
        if (clef && sign) {
            attributes.clef = [
                { sign: sign as MxmlClefSign, line: this.number(clef, 'line'), clefOctaveChange: this.number(clef, 'clef-octave-change') },
            ]
        }

        if (attributes.key || attributes.time || attributes.clef) this.entries.push(attributes)
    }

    /** A tempo from `<sound tempo>` (quarter-note bpm) or, failing that, a metronome mark converted to quarters. */
    private readTempo(element: Element) {
        const sound = element.tagName === 'sound' ? element : this.child(element, 'sound')
        let bpm = sound ? Number(sound.getAttribute('tempo')) : NaN
        if (!(bpm > 0)) {
            const directionType = this.child(element, 'direction-type')
            const metronome = directionType && this.child(directionType, 'metronome')
            if (metronome) {
                const unitBeats = TYPE_BEATS[this.text(metronome, 'beat-unit') ?? '']
                const perMinute = this.number(metronome, 'per-minute')
                const dots = this.children(metronome, 'beat-unit-dot').length
                if (unitBeats && perMinute && perMinute > 0) bpm = perMinute * unitBeats * (2 - 1 / Math.pow(2, dots))
            }
        }
        if (bpm > 0) this.entries.push({ _type: 'direction', sound: { tempo: Math.max(1, Math.min(500, Math.round(bpm))) } })
    }

    private readNote(element: Element) {
        if (this.child(element, 'grace') || this.child(element, 'cue')) return this.warn(WARN_GRACE)
        if (!this.inImportedVoice(element)) return this.warn(WARN_VOICES)

        const pitchElement = this.child(element, 'pitch')
        const pitch = pitchElement && this.readPitch(pitchElement)
        if (pitchElement && !pitch) return this.warn(WARN_DROPPED)

        if (this.child(element, 'chord') && this.lastNote.length && pitch) {
            // A chord note shares the previous note's time; keep whichever pitch is higher.
            const top = this.lastNote[0].pitch
            if (!top || MusicXmlImporter.midiOf(pitch) > MusicXmlImporter.midiOf(top))
                this.lastNote.forEach((piece) => (piece.pitch = pitch))
            return this.warn(WARN_CHORDS)
        }

        // A whole-bar rest carries no written value: leave the bar empty and let the fit pass pad it.
        if (this.child(element, 'rest')?.getAttribute('measure') === 'yes') {
            this.lastNote = []
            return
        }

        const duration = this.number(element, 'duration')
        if (!duration || duration <= 0) return this.warn(WARN_DROPPED)
        const beats = duration / this.divisions

        const timeModification = this.child(element, 'time-modification')
        const actualNotes = timeModification && this.number(timeModification, 'actual-notes')
        const normalNotes = timeModification && this.number(timeModification, 'normal-notes')
        const ratio =
            actualNotes &&
            normalNotes &&
            Number.isInteger(actualNotes) &&
            Number.isInteger(normalNotes) &&
            actualNotes >= 1 &&
            normalNotes >= 1
                ? { actualNotes, normalNotes }
                : undefined

        const type = NOTE_TYPES[this.text(element, 'type') ?? '']
        const dots = this.children(element, 'dot').length
        let durations: Duration[]
        if (type) {
            const written = new Duration({ type, dots, ratio })
            durations = Math.abs(written.effectiveBeats - beats) < BEAT_EPSILON ? [written] : this.simplify(beats, ratio)
        } else durations = this.simplify(beats, ratio)
        if (!durations.length) return this.warn(WARN_SHORT)

        const ties = this.readTies(element)
        const pieces = durations.map((written, i): MxmlNote => {
            const back = i > 0 || ties.stop
            const forward = i < durations.length - 1 || ties.start
            const tie =
                pitch && (back || forward)
                    ? [...(back ? [{ type: 'stop' as const }] : []), ...(forward ? [{ type: 'start' as const }] : [])]
                    : undefined
            return { ...this.noteEntry(written, pitch), ...(tie && { tie }) }
        })
        this.entries.push(...pieces)
        this.lastNote = pieces
        this.fill += durations.reduce((sum, d) => sum + d.effectiveBeats, 0)
    }

    /** An invisible rest of the given duration, when it belongs to the imported voice. */
    private readForward(element: Element) {
        if (!this.inImportedVoice(element)) return
        const duration = this.number(element, 'duration')
        if (!duration || duration <= 0) return
        const rests = new DurationSpeller(this.timeSignature).spell(this.fill, duration / this.divisions)
        this.entries.push(...rests.map((written) => this.noteEntry(written, undefined)))
        this.lastNote = []
        this.fill += rests.reduce((sum, d) => sum + d.effectiveBeats, 0)
    }

    private readBarline(element: Element) {
        if ((element.getAttribute('location') ?? 'right') !== 'right') return
        const style = this.text(element, 'bar-style')
        if (style) this.entries.push({ _type: 'barline', location: 'right', barStyle: BAR_STYLES[style] ?? 'regular' })
    }

    /** Whether a note/forward sits on the first staff in the voice being imported (the first one seen). */
    private inImportedVoice(element: Element): boolean {
        if ((this.text(element, 'staff') ?? '1') !== '1') return false
        const voice = this.text(element, 'voice') ?? this.voice ?? '1'
        this.voice ??= voice
        return voice === this.voice
    }

    private readPitch(element: Element): MxmlPitch | undefined {
        const step = this.text(element, 'step')
        const octave = this.number(element, 'octave')
        if (!step || !STEPS.has(step) || octave === undefined) return undefined
        // Microtonal alterations round to the nearest semitone.
        const alter = Math.max(-2, Math.min(2, Math.round(this.number(element, 'alter') ?? 0)))
        return { step: step as MxmlStep, ...(alter !== 0 && { alter }), octave: Math.max(0, Math.min(9, Math.round(octave))) }
    }

    private readTies(element: Element): { start: boolean; stop: boolean } {
        let ties = this.children(element, 'tie')
        if (!ties.length) {
            const notations = this.child(element, 'notations')
            ties = notations ? this.children(notations, 'tied') : []
        }
        const types = ties.map((tie) => tie.getAttribute('type'))
        return { start: types.includes('start'), stop: types.includes('stop') }
    }

    /** Rewrite a span the file's own note value can't express: tuplet space greedily, plain time metrically. */
    private simplify(beats: number, ratio: { actualNotes: number; normalNotes: number } | undefined): Duration[] {
        this.warn(WARN_SIMPLIFIED)
        return ratio ? Duration.fromBeats(beats, ratio) : new DurationSpeller(this.timeSignature).spell(this.fill, beats)
    }

    private noteEntry(written: Duration, pitch: MxmlPitch | undefined): MxmlNote {
        return {
            _type: 'note',
            ...(pitch ? { pitch } : { rest: {} }),
            duration: Math.round(written.effectiveBeats * DIVISIONS),
            voice: '1',
            type: MXML_TYPES[written.type],
            ...(written.dots > 0 && { dot: written.dots }),
            ...(written.ratio.actualNotes !== 1 && { timeModification: written.ratio }),
        }
    }

    private static midiOf(pitch: MxmlPitch): number {
        return new Pitch({ name: pitch.step, alter: pitch.alter, octave: pitch.octave }).toMidi()
    }

    // --- Fitting bars to their meter ---

    private fit(score: Score) {
        for (const measure of score.measures) {
            if (measure.beats > measure.maxBeats + BEAT_EPSILON) this.trim(measure)
            if (measure.beats < measure.maxBeats - BEAT_EPSILON) {
                const rests = measure.timeSignature.fillRests(measure.beats).map((duration) => new Note({ duration }))
                // A short opening bar with notes is a pickup: its rests lead in, so the notes end on the barline.
                const pickup = measure === score.firstMeasure && measure.notes.some((note) => note.pitch)
                measure.addNotes(pickup ? rests.reverse() : rests, pickup ? 'start' : 'end')
            }
        }
    }

    private trim(measure: Measure) {
        this.warn(WARN_OVERFLOW)
        let offset = 0
        for (const [index, note] of measure.notes.entries()) {
            const end = offset + note.duration.effectiveBeats
            if (end > measure.maxBeats + BEAT_EPSILON) {
                const space = measure.maxBeats - offset
                const durations = space > BEAT_EPSILON ? Duration.fromBeats(space, note.inTuplet ? note.duration.ratio : undefined) : []
                measure.replaceNotes(
                    measure.notes.slice(index),
                    durations.map((duration) => note.clone({ duration })),
                )
                return
            }
            offset = end
        }
    }

    // --- DOM access ---

    private warn(message: string) {
        this.warnings.add(message)
    }

    private children(element: Element, name: string): Element[] {
        return Array.from(element.children).filter((child) => child.tagName === name)
    }

    private child(element: Element, name: string): Element | undefined {
        return Array.from(element.children).find((child) => child.tagName === name)
    }

    /** Trimmed text of the named child, or undefined when absent or blank. */
    private text(element: Element, name: string): string | undefined {
        const value = this.child(element, name)?.textContent?.trim()
        return value || undefined
    }

    /** Numeric text of the named child, or undefined when absent or not a finite number. */
    private number(element: Element, name: string): number | undefined {
        const text = this.text(element, name)
        if (text === undefined) return undefined
        const value = Number(text)
        return Number.isFinite(value) ? value : undefined
    }
}
