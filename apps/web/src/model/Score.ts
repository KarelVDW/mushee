import { compact, groupBy, keyBy, last, sumBy } from 'lodash-es'

import type { ClefType, DurationType } from '@/components/notation/types'

import { Duration } from './Duration'
import { Instrument } from './Instrument'
import { ScoreLayout } from './layout/ScoreLayout'
import { Measure } from './Measure'
import { Note } from './Note'
import { TimeSignature } from './TimeSignature'
import { Derived } from './util/Derived'
import { MeasureSerializer } from './util/ScoreSerializer'

/** Tolerance for beat-sum comparisons — tuplet beats (e.g. thirds) don't sum exactly in floating point. */
const BEAT_EPSILON = 0.001

/**
 * The score: an ordered list of measures plus the lead instrument. Purely
 * semantic — row packing, ties-as-geometry, and all other ink live in the
 * layout layer behind the `layout` gateway.
 *
 * Mutations flow through single choke points (`touch` for score-level ops,
 * `measureChanged` for measure content) that bump `version`; all derived state
 * recomputes lazily off that version (see ARCHITECTURE.md).
 */
export class Score {
    /** Tempo assumed before any explicit marking — matches the playback engines' fallback. */
    static readonly DEFAULT_BPM = 90

    readonly measures: Measure[] = []
    private _version = 0
    private _instrument: Instrument = Instrument.Piano
    private readonly _onChange?: () => void

    // Persistence dirty-tracking (cleared by flushDirty)
    private _dirtyMeasures = new Set<Measure>()
    private _structureChanged = false
    private _instrumentDirty = false

    private _layoutState: { version: number; layout: ScoreLayout } | null = null

    private readonly _indexByMeasure = new Derived(
        () => this._version,
        () => new Map(this.measures.map((m, i) => [m, i])),
    )

    /** BPM in effect entering each measure, indexed by measure position. */
    private readonly _tempoMap = new Derived(
        () => this._version,
        () => {
            const map: number[] = []
            let current = Score.DEFAULT_BPM
            for (const measure of this.measures) {
                map.push(current)
                const latest = measure.lastTempo
                if (latest) current = latest.bpm
            }
            return map
        },
    )

    /** Tie connections: each tie-starting note mapped to the note it sustains into. */
    private readonly _tiePartners = new Derived(
        () => this._version,
        () => {
            const map = new Map<Note, Note>()
            for (const measure of this.measures) {
                for (const note of measure.notes) {
                    if (!note.tiesForward) continue
                    const next = this.nextNote(note)
                    if (next) map.set(note, next)
                }
            }
            return map
        },
    )

    constructor(onChange?: () => void) {
        this._onChange = onChange
    }

    /** Version of the whole score's semantic content; any mutation moves it. */
    get version(): number {
        return this._version
    }

    /** Choke point for score-level mutations: bump the version and notify the owner. */
    private touch() {
        this._version++
        this._onChange?.()
    }

    /** Choke point for measure-content mutations (called by Measure.touch). */
    measureChanged(measure: Measure) {
        this._version++
        this._dirtyMeasures.add(measure)
    }

    get instrument(): Instrument {
        return this._instrument
    }

    /** The current layout snapshot, rebuilt lazily when the version moves (unchanged parts are reused). */
    get layout(): ScoreLayout {
        if (this._layoutState?.version !== this._version) {
            this._layoutState = { version: this._version, layout: new ScoreLayout(this, this._layoutState?.layout) }
        }
        return this._layoutState.layout
    }

    /**
     * Switch the score's lead instrument. Notes are stored as written pitch
     * (MusicXML semantics), so to preserve the actual sounding music when the
     * new instrument has a different transposition we rewrite every note and
     * key signature by `oldTranspose − newTranspose`. Trumpet writing C5 (sounds
     * B♭4) becomes a flute written B♭4 (still sounds B♭4) — the audience hears
     * the same music; the trumpeter's "do" becomes the flutist's "si bémol".
     *
     * The note rewrite goes through `replace` so tie tracking stays consistent.
     * Note identities change — callers holding a Note ref (e.g. the editor's
     * active note) need to re-resolve by position.
     */
    setInstrument(instrument: Instrument) {
        if (this._instrument === instrument) return

        const deltaChromatic = this._instrument.chromaticTranspose - instrument.chromaticTranspose
        const deltaDiatonic = this._instrument.diatonicTranspose - instrument.diatonicTranspose

        if (deltaChromatic !== 0 || deltaDiatonic !== 0) {
            const targets: Note[] = []
            const values: Note[] = []
            for (const measure of this.measures) {
                measure.transposeKeySignatures(deltaChromatic, deltaDiatonic)
                for (const note of measure.notes) {
                    targets.push(note)
                    values.push(note.clone(note.pitch ? { pitch: note.pitch.transposed(deltaChromatic, deltaDiatonic) } : {}))
                }
            }
            if (targets.length > 0) this.replace(targets, values)
            // Re-propagate the transposed key signatures forward (inherited leading keys follow the explicit ones).
            this.propagateContext()
        }

        this._instrument = instrument
        this._instrumentDirty = true
        this.touch()
    }

    /** Set the initial instrument without marking the score dirty — for deserialization only. */
    seedInstrument(instrument: Instrument) {
        this._instrument = instrument
    }

    get firstMeasure(): Measure | null {
        return this.measures[0] ?? null
    }

    get lastMeasure(): Measure | null {
        return this.measures[this.measures.length - 1] ?? null
    }

    getIndexForMeasure(measure: Measure): number {
        const index = this._indexByMeasure.value.get(measure)
        if (index === undefined) throw new Error('Measure not part of this score')
        return index
    }

    /** The note a tie-starting note sustains into, or null when it has no tie or no successor. */
    tiePartner(note: Note): Note | null {
        return this._tiePartners.value.get(note) ?? null
    }

    // --- Navigation (the single traversal implementation; Note/Measure delegate here) ---

    getNextMeasure(measure?: Measure): Measure | null {
        if (!measure) return this.firstMeasure
        const measureIndex = this._indexByMeasure.value.get(measure)
        if (measureIndex === undefined) return null
        return this.measures[measureIndex + 1] ?? null
    }

    getPreviousMeasure(measure: Measure): Measure | null {
        const measureIndex = this._indexByMeasure.value.get(measure)
        if (measureIndex === undefined || measureIndex < 1) return null
        return this.measures[measureIndex - 1]
    }

    nextNote(note: Note): Note | null {
        return note.measure.getNextNote(note) ?? this.getNextMeasure(note.measure)?.firstNote ?? null
    }

    previousNote(note: Note): Note | null {
        return note.measure.getPreviousNote(note) ?? this.getPreviousMeasure(note.measure)?.lastNote ?? null
    }

    // --- Structure mutations ---

    addMeasure(index = this.measures.length, measure?: Measure) {
        if (!measure) {
            const previous = this.measures[index - 1]
            // Inherit the clef and key *leaving* the previous measure (its last ones carry forward).
            const inheritedClefType = previous?.lastClef.type ?? 'treble'
            const inheritedKey = previous?.lastKey
            const inheritedTimeSignature = previous?.timeSignature ?? new TimeSignature(4, 4)
            measure = new Measure(this, inheritedClefType, inheritedTimeSignature, {
                keyFifths: inheritedKey?.fifths ?? 0,
                keyMode: inheritedKey?.mode,
            })
        }
        this.measures.splice(index, 0, measure)
        const previousMeasure = index > 0 ? this.measures[index - 1] : undefined
        const nextMeasure = this.measures[index + 1]
        if (nextMeasure) {
            // Mid-score insertion: default the new measure's barline, but never overwrite an
            // explicit style it was built with (e.g. a double barline from a loaded score).
            if (measure.endBarline === undefined) measure.setEndBarline('single')
        } else {
            // Appended at the end: the final barline moves to the new measure. Only the
            // positional 'end' on the previous measure is demoted — an explicit double/none stays.
            if (previousMeasure?.endBarline === 'end') previousMeasure.setEndBarline('single')
            if (measure.endBarline === undefined) measure.setEndBarline('end')
        }
        this.propagateContext()
        this._structureChanged = true
        this.touch()
        return measure
    }

    removeLastMeasure() {
        this.measures.pop()
        const newLast = last(this.measures)
        // The piece's final barline moves to the new last measure, but an explicit
        // style (double/none/end) it already carries is preserved.
        if (newLast && (newLast.endBarline === undefined || newLast.endBarline === 'single')) {
            newLast.setEndBarline('end')
        }
        this._structureChanged = true
        this.touch()
    }

    /**
     * Eagerly propagate inherited leading clefs/keys forward across measures (semantic
     * carry-forward — the serializer depends on it). Called by the score-level mutators
     * that can change measure context; never a side effect of layout.
     */
    private propagateContext() {
        let clefType: ClefType = 'treble'
        let keyFifths = 0
        let keyMode: string | undefined
        for (const measure of this.measures) {
            measure.applyInheritedClef(clefType)
            measure.applyInheritedKey(keyFifths, keyMode)
            clefType = measure.lastClef.type
            keyFifths = measure.lastKey.fifths
            keyMode = measure.lastKey.mode
        }
    }

    // --- Content mutations ---

    setTempo(note: Note | null | undefined, bpm: number | undefined) {
        if (!note) return
        const measure = note.measure
        const beat = measure.beatOffsetOf(note)
        if (bpm === undefined) measure.removeTempo(beat)
        else measure.setTempo(beat, bpm)
        this.touch()
    }

    setClef(note: Note | null | undefined, type: ClefType) {
        if (!note) return
        const measure = note.measure
        const beat = measure.beatOffsetOf(note)
        if (beat === 0) {
            const carriedIn = this.getPreviousMeasure(measure)?.lastClef.type ?? 'treble'
            if (type === carriedIn) measure.makeLeadingClefInherited()
            else measure.setClef(0, type)
        } else measure.setClef(beat, type)
        this.propagateContext()
        this.touch()
    }

    setKeySignature(note: Note | null | undefined, fifths: number, mode?: string) {
        if (!note) return
        const measure = note.measure
        const beat = measure.beatOffsetOf(note)
        if (beat === 0) {
            const carried = this.getPreviousMeasure(measure)?.lastKey
            // Demote to inherited only when nothing changes; a relative major↔minor switch (same fifths,
            // different mode) is still a real boundary and must be kept explicit so the mode is preserved.
            if (fifths === (carried?.fifths ?? 0) && mode === carried?.mode) measure.makeLeadingKeyInherited()
            else measure.setKeySignature(0, fifths, mode)
        } else measure.setKeySignature(beat, fifths, mode)
        this.propagateContext()
        this.touch()
    }

    /** The tempo (BPM) sounding at `note`: the nearest marking at or before it, else the default. */
    bpmAt(note: Note | null | undefined): number {
        if (!note) return Score.DEFAULT_BPM
        const measure = note.measure
        const local = measure.tempoAtOrBefore(measure.beatOffsetOf(note))
        if (local) return local.bpm
        /* v8 ignore next -- defensive: tempoMap has one entry per measure index, so the lookup is always defined for an in-score measure */
        return this._tempoMap.value[this.getIndexForMeasure(measure)] ?? Score.DEFAULT_BPM
    }

    /**
     * Change a note's written duration (type and/or dots; omitted parts keep the
     * note's current value). Inside a tuplet the change stays in the group's ratio
     * and is clipped to the group's end — freed slot space is padded with tuplet
     * rests by `replace` — so the group's span never changes. A change that covers
     * the whole group from its first slot reads better as plain notation, so it
     * leaves tuplet space. Returns the note to select next, or null without a note.
     */
    setDuration(note: Note | null | undefined, value: { type?: DurationType; dots?: number }): Note | null {
        if (!note) return null
        const ratio = note.duration.ratio
        let durations = [new Duration({ type: value.type ?? note.duration.type, dots: value.dots ?? note.duration.dots, ratio })]
        const tuplet = note.measure.tupletGroupOf(note)
        if (tuplet) {
            /* v8 ignore next -- defensive: `note` came from this same tuplet, so getIndex always finds it */
            const index = tuplet.getIndex(note) ?? 0
            const remainder = sumBy(tuplet.notes.slice(index), (n) => n.duration.effectiveBeats)
            if (durations[0].effectiveBeats > remainder + BEAT_EPSILON) {
                durations = index === 0 ? Duration.fromBeats(remainder) : Duration.fromBeats(remainder, ratio)
            }
        }
        /* v8 ignore next -- defensive: durations starts with one element and is only re-decomposed from a positive remainder, so it is never empty */
        if (!durations.length) return null
        /* v8 ignore next -- the tie-spread branch never fires: a tuplet clip always reduces to a single written duration (durations.length === 1) */
        const values = durations.map((d, i) => note.clone({ duration: d, ...(note.pitch && i < durations.length - 1 && { tie: 'start' as const }) }))
        /* v8 ignore next -- defensive: replace always returns at least one note for a non-empty target */
        return this.replace([note], values)[0] ?? null
    }

    /**
     * Toggle the note between plain and triplet notation. A plain note becomes three
     * notes of the next-shorter value (3:2) — its pitch on the first, rests after. A
     * note inside a tuplet collapses the whole group back to plain notes of the same
     * total length, carrying the selected note's pitch. Returns the note to select
     * next, or null when nothing changed (no shorter value exists, or the group's
     * length isn't representable in plain notes).
     */
    toggleTuplet(note: Note | null | undefined): Note | null {
        if (!note) return null
        const tuplet = note.measure.tupletGroupOf(note)
        if (tuplet) {
            const totalBeats = sumBy(tuplet.notes, (n) => n.duration.effectiveBeats)
            const durations = Duration.fromBeats(totalBeats)
            /* v8 ignore next -- defensive: a tuplet group always spans 2× a plain note value, which decomposes exactly, so the sum always matches */
            if (Math.abs(sumBy(durations, (d) => d.beats) - totalBeats) > BEAT_EPSILON) return null
            /* v8 ignore next 3 -- the tie-spread branch never fires: the collapsed group total is a single written duration (durations.length === 1) */
            const values = durations.map(
                (d, i) => new Note({ duration: d, pitch: note.pitch, ...(note.pitch && i < durations.length - 1 && { tie: 'start' as const }) }),
            )
            /* v8 ignore next -- defensive: replace always returns at least one note */
            return this.replace(tuplet.notes, values)[0] ?? null
        }
        const durations = note.duration.tripletDivision()
        if (!durations) return null
        const values = durations.map((d, i) => new Note({ duration: d, pitch: i === 0 ? note.pitch : undefined }))
        /* v8 ignore next -- defensive: replace always returns at least one note */
        return this.replace([note], values)[0] ?? null
    }

    replace(targets: Note[], values: Note[]) {
        if (!targets.length) throw new Error('Replace targets can not be empty')
        if (!values.length) throw new Error('Replace values can not be empty')
        let targetBeats = sumBy(targets, (n) => n.duration.effectiveBeats)
        let valueBeats = sumBy(values, (n) => n.duration.effectiveBeats)

        while (targetBeats < valueBeats - BEAT_EPSILON) {
            const lastTarget = targets[targets.length - 1]
            let nextNote = lastTarget.getNext()
            if (!nextNote) this.addMeasure().complete()
            nextNote = lastTarget.getNext()
            /* v8 ignore next -- defensive: a measure was just appended and filled, so the next note always exists here */
            if (!nextNote) throw new Error('Trouble finding next note')
            targets = compact([...targets, nextNote])
            targetBeats += nextNote.duration.effectiveBeats
        }
        if (targetBeats > valueBeats + BEAT_EPSILON) {
            // The gap sits at the end of the replaced range — pad in that note's space:
            // inside a tuplet it is a fraction no plain duration can express.
            const ratio = targets[targets.length - 1].duration.ratio
            values = [...values, ...Duration.fromBeats(targetBeats - valueBeats, ratio).map((d) => new Note({ duration: d }))]
            valueBeats += targetBeats - valueBeats
        }
        const measuresById = keyBy(
            targets.map((n) => n.measure),
            (m) => m.id,
        )
        const targetsByMeasure = groupBy(targets, (n) => n.measure.id)
        let replaceValues = [...values]
        const allNewNotes = []
        for (const [measureId, notes] of Object.entries(targetsByMeasure)) {
            const measure = measuresById[measureId]
            const newNotes = []
            let freeBeats = sumBy(notes, (n) => n.duration.effectiveBeats)
            let remainderNotes: Note[] = []
            while (freeBeats > BEAT_EPSILON) {
                const note = replaceValues.shift()
                /* v8 ignore next -- defensive: values are padded to cover the full target span, so they never run out before freeBeats does */
                if (!note) break
                const noteBeats = note.duration.effectiveBeats
                if (noteBeats <= freeBeats + BEAT_EPSILON) {
                    newNotes.push(note)
                    freeBeats -= noteBeats
                } else {
                    const remainderBeats = noteBeats - freeBeats
                    newNotes.push(...Duration.fromBeats(freeBeats).map((d) => new Note({ duration: d, pitch: note.pitch, tie: 'start' })))
                    freeBeats = 0
                    const remainderDurations = Duration.fromBeats(remainderBeats)
                    remainderNotes = remainderDurations.map(
                        (d, i) => new Note({ duration: d, pitch: note.pitch, ...(i != remainderDurations.length - 1 && { tie: 'start' }) }),
                    )
                }
            }
            measure.replaceNotes(notes, newNotes)
            replaceValues = [...remainderNotes, ...replaceValues]
            allNewNotes.push(...newNotes)
        }
        this.touch()
        return allNewNotes
    }

    // --- Persistence dirty-tracking ---

    clearDirty() {
        this._dirtyMeasures.clear()
        this._structureChanged = false
        this._instrumentDirty = false
    }

    /** Serialize dirty state, then clear it. Returns null if nothing changed. */
    flushDirty(): { measures?: Record<string, unknown>; allMeasures?: unknown[]; partList?: Record<string, unknown> } | null {
        const hasMeasureChanges = this._structureChanged || this._dirtyMeasures.size > 0
        if (!hasMeasureChanges && !this._instrumentDirty) return null

        const result: { measures?: Record<string, unknown>; allMeasures?: unknown[]; partList?: Record<string, unknown> } = {}

        if (this._instrumentDirty) {
            result.partList = {
                scoreParts: [
                    {
                        id: 'P1',
                        partName: this._instrument.displayName,
                        scoreInstrument: { id: 'P1-I1', instrumentName: this._instrument.displayName },
                        midiInstrument: { id: 'P1-I1', midiProgram: this._instrument.gmProgram + 1 },
                    },
                ],
            }
        }

        if (this._structureChanged) {
            result.allMeasures = this.measures.map((m) => new MeasureSerializer(m).serialize())
        } else if (this._dirtyMeasures.size > 0) {
            const measures: Record<string, unknown> = {}
            for (const measure of this._dirtyMeasures) {
                const index = this._indexByMeasure.value.get(measure)
                if (index !== undefined) {
                    measures[String(index)] = new MeasureSerializer(measure).serialize()
                }
            }
            result.measures = measures
        }

        this.clearDirty()
        return result
    }
}
