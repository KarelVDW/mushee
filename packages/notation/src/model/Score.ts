import { last, sumBy } from 'lodash-es'

import { SCORE_WIDTH } from '../engraving/constants'
import { BEAT_EPSILON, Duration } from './Duration'
import { Instrument } from './Instrument'
import type { Interval } from './Interval'
import type { MxmlMeasure, ScorePatch } from './io/MusicXml'
import { MeasureSerializer, ScoreSerializer } from './io/ScoreSerializer'
import { KeySignature } from './KeySignature'
import { ScoreLayout } from './layout/ScoreLayout'
import { Measure } from './Measure'
import { Note } from './Note'
import { TimeSignature } from './TimeSignature'
import type { ClefType, DurationType } from './types'
import { AccidentalMinimizer } from './util/AccidentalMinimizer'
import { Derived } from './util/Derived'
import { MeasureRebar } from './util/MeasureRebar'

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
    /** Tempo assumed before any explicit marking. */
    static readonly DEFAULT_BPM = 90

    readonly measures: Measure[] = []
    private _version = 0
    private _instrument: Instrument = Instrument.Piano
    private readonly _onChange?: () => void

    // Persistence dirty-tracking (cleared by flushDirty)
    private _dirtyMeasures = new Set<Measure>()
    private _structureChanged = false
    private _instrumentDirty = false

    private _layoutState: { version: number; width: number; layout: ScoreLayout } | null = null
    private _layoutWidth = SCORE_WIDTH

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

    /** Seconds from the top of the score to the start of each measure, indexed by measure position. */
    private readonly _measureStartSeconds = new Derived(
        () => this._version,
        () => {
            const starts: number[] = []
            let seconds = 0
            this.measures.forEach((measure, index) => {
                starts.push(seconds)
                seconds += this.secondsInto(measure, index, measure.maxBeats)
            })
            return starts
        },
    )

    /** Tie connections: each tie-starting note mapped to the note it sustains into. */
    private readonly _tiePartners = new Derived(
        () => this._version,
        () => {
            // A tie sustains a pitch: the partner is the next note only when it sounds the same
            // (C♯ to D♭ included). A 'start' left facing a rest or another pitch — by tying the wrong
            // note, or by editing the note after it — is a dangling mark: not drawn, not sounded,
            // and the following note is a fresh attack. Kept on the note so it re-binds if the
            // neighbour changes back.
            const map = new Map<Note, Note>()
            for (const measure of this.measures) {
                for (const note of measure.notes) {
                    const partner = note.tiesForward ? this.tieableSuccessor(note) : null
                    if (partner) map.set(note, partner)
                }
            }
            return map
        },
    )

    constructor(onChange?: () => void) {
        this._onChange = onChange
    }

    /**
     * A new score's starting point for `instrument`: one measure completed the way the editor
     * completes one (four quarter rests in 4/4), marked at `bpm`. New scores open at 120 on
     * purpose — DEFAULT_BPM is only what a score without any marking is assumed to play at.
     */
    static blank(instrument: Instrument, bpm = 120): Score {
        const score = new Score()
        score._instrument = instrument
        const measure = score.addMeasure().complete()
        score.setTempo(measure.firstNote, bpm)
        return score
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

    /**
     * The width the layout packs rows against — a presentation input to the `layout`
     * gateway (responsive reflow on narrow viewports), never semantic state: it is not
     * serialized and changing it moves neither the version nor the dirty tracking.
     */
    get layoutWidth(): number {
        return this._layoutWidth
    }

    /** Change the layout width. Notifies the owner (so views re-read `layout`) without dirtying the score. */
    setLayoutWidth(width: number) {
        if (width === this._layoutWidth) return
        this._layoutWidth = width
        this._onChange?.()
    }

    /** The current layout snapshot, rebuilt lazily when the version or layout width moves (unchanged parts are reused). */
    get layout(): ScoreLayout {
        if (this._layoutState?.version !== this._version || this._layoutState.width !== this._layoutWidth) {
            this._layoutState = {
                version: this._version,
                width: this._layoutWidth,
                layout: new ScoreLayout(this, this._layoutState?.layout, this._layoutWidth),
            }
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
     * The rewrite is {@link transpose}'s whole-score path: keys land in the drawable
     * range (B major for alto sax is written in A♭, not G♯) and the notes are
     * respelled for them. Note identities change — callers holding a Note ref
     * (e.g. the editor's active note) need to re-resolve by position.
     */
    setInstrument(instrument: Instrument) {
        if (this._instrument === instrument) return

        const deltaChromatic = this._instrument.chromaticTranspose - instrument.chromaticTranspose
        const deltaDiatonic = this._instrument.diatonicTranspose - instrument.diatonicTranspose
        if (deltaChromatic !== 0 || deltaDiatonic !== 0) this.transposeWholeScore(deltaChromatic, deltaDiatonic)

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

    /** How long `note` sounds, in beats: its own value plus every note its tie chain sustains into. */
    tiedBeats(note: Note): number {
        let beats = note.duration.effectiveBeats
        for (let partner = this.tiePartner(note); partner; partner = this.tiePartner(partner)) beats += partner.duration.effectiveBeats
        return beats
    }

    /**
     * Whether a tie from `note` would bind: it and the note after it are pitched and sound the
     * same (C♯ to D♭ included). The editor offers tying on only where this holds.
     */
    canTieForward(note: Note): boolean {
        return this.tieableSuccessor(note) !== null
    }

    /** The note a tie from `note` would sustain into — the tie rule {@link canTieForward} and the tie map share. */
    private tieableSuccessor(note: Note): Note | null {
        if (!note.pitch) return null
        const next = this.nextNote(note)
        return next?.pitch && next.pitch.toMidi() === note.pitch.toMidi() ? next : null
    }

    // --- Navigation (the single traversal implementation; Note/Measure delegate here) ---

    getNextMeasure(measure: Measure): Measure | null {
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

    /** Insert a new, empty measure at `index` (default: the end) in the context carried into that position. */
    addMeasure(index = this.measures.length): Measure {
        const measure = this.insertMeasure(index, this.createMeasure(index))
        this.touch()
        return measure
    }

    /** Append a measure built elsewhere (the deserializer, the importers) as the new last measure. */
    appendMeasure(measure: Measure): Measure {
        this.insertMeasure(this.measures.length, measure)
        this.touch()
        return measure
    }

    /** A new, empty measure for position `index`, in the context carried into it. Not yet in the score. */
    private createMeasure(index: number): Measure {
        const previous = this.measures[index - 1]
        const displaced = previous ? undefined : this.measures[index]
        if (displaced) {
            // Inserted at the very start (e.g. a take recorded from measure one): nothing
            // carries in, so the new measure takes over the leading context of the measure
            // it pushes aside — which then simply inherits it instead of restating it.
            const measure = new Measure(this, displaced.clef.type, displaced.timeSignature, {
                keyFifths: displaced.keySignature.fifths,
                keyMode: displaced.keySignature.mode,
                leadingClefExplicit: displaced.leadingClefExplicit,
                leadingKeyExplicit: displaced.leadingKeyExplicit,
            })
            if (displaced.leadingClefExplicit) displaced.makeLeadingClefInherited()
            if (displaced.leadingKeyExplicit) displaced.makeLeadingKeyInherited()
            return measure
        }
        // Inherit the clef and key *leaving* the previous measure (its last ones carry forward).
        const inheritedKey = previous?.lastKey
        return new Measure(this, previous?.lastClef.type ?? 'treble', previous?.timeSignature ?? new TimeSignature(4, 4), {
            keyFifths: inheritedKey?.fifths ?? 0,
            keyMode: inheritedKey?.mode,
        })
    }

    /** Splice `measure` in at `index` and settle barlines and carried context around it. No touch — the calling mutator owns it. */
    private insertMeasure(index: number, measure: Measure): Measure {
        this.measures.splice(index, 0, measure)
        const previous = this.measures[index - 1]
        if (this.measures[index + 1]) {
            // Mid-score insertion — only freshly created measures arrive here, so the barline is positional.
            measure.setEndBarline('single')
        } else {
            // Appended at the end: the final barline moves to the new measure. Only the
            // positional 'end' on the previous measure is demoted — an explicit double/none stays,
            // and so does an explicit style an appended measure was built with (from a loaded score).
            if (previous?.endBarline === 'end') previous.setEndBarline('single')
            if (measure.endBarline === undefined) measure.setEndBarline('end')
        }
        this.propagateContext()
        this._structureChanged = true
        return measure
    }

    /**
     * Insert an empty measure at `index` that takes over the displaced measure's
     * tempo. A recording take starts in this measure and must sound at the bpm
     * prevailing where the cursor was — but that bpm is often marked at the start
     * of the very measure being pushed aside (a score's opening marking when the
     * take begins at measure one), where the engines' walk-back can't see it. The
     * marking moves onto the new measure, so the take and playback of the finished
     * piece keep their bpm instead of falling back to the default.
     */
    addMeasureAdoptingTempo(index: number): Measure {
        const displaced = this.measures[index]
        const measure = this.insertMeasure(index, this.createMeasure(index))
        const marking = displaced?.tempoAtBeat(0)
        if (displaced && marking) {
            displaced.removeTempo(0)
            measure.setTempo(0, marking.bpm)
        }
        this.touch()
        return measure
    }

    removeLastMeasure() {
        const measure = this.lastMeasure
        if (measure) this.removeMeasures([measure])
    }

    /**
     * Remove `measures` (in any order, anywhere in the score; ones not in the score are
     * ignored). The music that followed keeps sounding as it did: a clef, key or tempo change
     * carried by a removed measure is re-marked on the first surviving measure after it when
     * that measure only inherited it, and the piece's final barline moves onto the new last
     * measure (an explicit double/none style it already carries is preserved).
     */
    removeMeasures(measures: Measure[]) {
        const removed = new Set(measures.filter((m) => this.measures.includes(m)))
        if (removed.size === 0) return
        // The context each surviving successor of a removed run enters with — captured before the
        // run disappears, so the run's own changes can be carried onto it afterwards.
        const successors = this.measures
            .filter((m, i) => !removed.has(m) && i > 0 && removed.has(this.measures[i - 1]))
            .map((m) => ({
                measure: m,
                clefType: m.clef.type,
                key: m.keySignature,
                bpm: this.tempoEntering(m),
            }))
        const survivors = this.measures.filter((m) => !removed.has(m))
        this.measures.splice(0, this.measures.length, ...survivors)
        this.propagateContext()
        for (const { measure, clefType, key, bpm } of successors) {
            if (measure.clef.type !== clefType) measure.setClef(0, clefType)
            if (!measure.keySignature.sameKeyAs(key.fifths, key.mode)) measure.setKeySignature(0, key.fifths, key.mode)
            if (!measure.tempoAtBeat(0) && this.tempoEntering(measure) !== bpm) measure.setTempo(0, bpm)
        }
        this.propagateContext()
        const newLast = last(this.measures)
        if (newLast && (newLast.endBarline === undefined || newLast.endBarline === 'single')) {
            newLast.setEndBarline('end')
        }
        this._structureChanged = true
        this.touch()
    }

    /**
     * The bpm in effect when `measure` begins, before any marking of its own. Walks the live
     * measure list (not the version-keyed tempo map) because it runs mid-mutation.
     */
    private tempoEntering(measure: Measure): number {
        let bpm = Score.DEFAULT_BPM
        for (const previous of this.measures.slice(0, this.measures.indexOf(measure))) {
            const latest = previous.lastTempo
            if (latest) bpm = latest.bpm
        }
        return bpm
    }

    /**
     * Change the time signature from `measure` onward, mirroring key-signature semantics:
     * the new meter applies through the run of measures sharing the current one — up to
     * the next specified change (the first following measure whose signature differs) or
     * the end of the score. Setting the meter already in effect is a no-op, and setting
     * the one carried in from before `measure` erases the boundary (the runs merge).
     *
     * The whole run is rebarred by {@link MeasureRebar}: its content flows across the new
     * barlines, splitting with ties where it straddles, so measure and note identities in
     * the run may change — callers holding a Note ref re-resolve by position.
     */
    setTimeSignature(measure: Measure, timeSignature: TimeSignature) {
        const start = this.getIndexForMeasure(measure)
        if (timeSignature.equals(measure.timeSignature)) return
        let end = start + 1
        while (end < this.measures.length && this.measures[end].timeSignature.equals(measure.timeSignature)) end++
        const rebar = new MeasureRebar(this.measures.slice(start, end), timeSignature, end === this.measures.length)
        this.measures.splice(start, end - start, ...rebar.measures)
        this.propagateContext()
        rebar.applyMarks(() => this.propagateContext())
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
            if (KeySignature.same(carried, fifths, mode)) measure.makeLeadingKeyInherited()
            else measure.setKeySignature(0, fifths, mode)
        } else measure.setKeySignature(beat, fifths, mode)
        this.propagateContext()
        this.touch()
    }

    /**
     * Transpose by `interval` — the user-facing transposition. With no `notes` the whole
     * score moves: every key signature is re-keyed (folded back into the drawable −7..7
     * range, taking the enharmonic key when the raw result overflows) and every note
     * follows; with a selection only those notes
     * move and the keys stay. Either way the rewritten notes are then respelled to draw the
     * fewest accidentals under the keys now in effect, so the result is always cleanly
     * spelled — and matches what a preview built the same way shows.
     *
     * Rewrites go through the `replace` path, so note identities change; the returned notes are
     * the final replacements, index-aligned with the transposed notes in score order.
     */
    transpose(interval: Interval, notes?: Note[]): Note[] {
        if (interval.isUnison) return notes ?? this.measures.flatMap((m) => m.notes)
        // Below this boundary the primitives take the interval's (chromatic, diatonic) pair.
        const { chromatic, diatonic } = interval
        const transposed = notes ? this.transposeNotes(notes, chromatic, diatonic) : this.transposeWholeScore(chromatic, diatonic)
        this.touch()
        return transposed
    }

    /**
     * The whole-score rewrite {@link transpose} and {@link setInstrument} share: every key is
     * re-keyed (an inherited leading key promoted so it survives propagation, overflow folded to
     * the enharmonic key), then every note moves and is respelled for the keys now in effect.
     * No touch — the calling mutator owns it.
     */
    private transposeWholeScore(chromatic: number, diatonic: number): Note[] {
        for (const measure of this.measures) measure.transposeKeySignatures(chromatic, diatonic)
        // A score that starts in inherited C major now carries a transposed leading key that
        // is still marked inherited — promote it to an explicit boundary before propagation,
        // or propagateContext would reset it to the default C.
        const first = this.firstMeasure
        if (first && !first.leadingKeyExplicit && first.keySignature.fifths !== 0) {
            first.setKeySignature(0, first.keySignature.fifths, first.keySignature.mode)
        }
        // Fold overflowed keys to their enharmonic equivalent. Inherited leading keys are
        // skipped: propagation below re-derives them from the explicit boundaries.
        for (const measure of this.measures) {
            for (const key of [...measure.keySignatures]) {
                if (key.beatPosition === 0 && !measure.leadingKeyExplicit) continue
                const normalized = KeySignature.normalizedFifths(key.fifths)
                if (normalized !== key.fifths) measure.setKeySignature(key.beatPosition, normalized, key.mode)
            }
        }
        this.propagateContext()
        return this.transposeNotes(
            this.measures.flatMap((m) => m.notes),
            chromatic,
            diatonic,
        )
    }

    /** Move `notes` by (chromatic, diatonic) and respell them for the keys in effect. No touch. */
    private transposeNotes(notes: Note[], chromatic: number, diatonic: number): Note[] {
        if (!notes.length) return notes
        const transposed = this.replaceNotes(
            notes,
            notes.map((note) => note.clone(note.pitch ? { pitch: note.pitch.transposed(chromatic, diatonic) } : {})),
        )
        return this.respell(transposed)
    }

    /**
     * Redraw the music with the fewest possible accidentals. Applied to the whole score (no
     * `notes`), each key-signature region is first re-keyed to whichever key draws the least
     * ink over its notes; then every note is respelled enharmonically (A♭ ↔ G♯) to fit.
     * Applied to a selection, the key signatures stay and only those notes are respelled.
     *
     * Respelled notes change identity (rewrites go through the `replace` path); the returned
     * notes are the final ones, index-aligned with the input (or with all notes in score order).
     */
    minimizeAccidentals(notes?: Note[]): Note[] {
        const respelled = notes ? this.respell(notes) : this.minimizeWholeScore()
        this.touch()
        return respelled
    }

    /** {@link minimizeAccidentals} over the whole score — re-key every region, then respell every note — without the touch. */
    private minimizeWholeScore(): Note[] {
        // A mid-measure key that merely restates the key in force is invisible, but it would
        // resurface as a boundary once a leading key moves — and a second pass would then carve
        // the bar differently. Every key is about to be re-decided, so drop such latent restatements first.
        for (const measure of this.measures) {
            const visible = new Set(measure.midMeasureKeySignatures)
            for (const key of [...measure.keySignatures]) {
                if (key.beatPosition > 0 && !visible.has(key)) measure.setKeySignature(key.beatPosition, key.fifths, key.mode)
            }
        }
        for (const region of this.keyRegions()) {
            if (!region.notes.length) continue
            const best = AccidentalMinimizer.bestFifths(region.notes, region.key.fifths)
            if (best !== region.key.fifths) region.key.measure.setKeySignature(region.key.beatPosition, best)
        }
        this.propagateContext()
        return this.respell(this.measures.flatMap((m) => m.notes))
    }

    /**
     * The score's key regions: each key boundary (the score's start, an explicit leading
     * key, or a mid-measure change) with the notes it governs, in score order.
     */
    private keyRegions(): { key: KeySignature; notes: Note[] }[] {
        const regions: { key: KeySignature; notes: Note[] }[] = []
        for (const measure of this.measures) {
            if (regions.length === 0 || measure.leadingKeyExplicit) regions.push({ key: measure.keySignature, notes: [] })
            const midKeys = measure.midMeasureKeySignatures
            let nextKey = 0
            for (const note of measure.notes) {
                const beat = measure.beatOffsetOf(note)
                while (nextKey < midKeys.length && midKeys[nextKey].beatPosition <= beat) {
                    regions.push({ key: midKeys[nextKey++], notes: [] })
                }
                regions[regions.length - 1].notes.push(note)
            }
            while (nextKey < midKeys.length) regions.push({ key: midKeys[nextKey++], notes: [] })
        }
        return regions
    }

    /**
     * Respell `notes` to draw the fewest accidentals under the keys currently in effect,
     * leaving every other note (and all key signatures) alone. Whole measures are walked so
     * carried-accidental state is faithful. Returns the notes in their final identity,
     * index-aligned with the input.
     */
    private respell(notes: Note[]): Note[] {
        if (!notes.length) return notes
        const measures = [...new Set(notes.map((note) => note.measure))].sort(
            (a, b) => this.getIndexForMeasure(a) - this.getIndexForMeasure(b),
        )
        const minimizer = new AccidentalMinimizer(
            measures.flatMap((m) => m.notes),
            new Set(notes),
            (note) => note.keySignature.fifths,
        )
        // One single-note replace per respelled note: a replace inserts its values at the first
        // target's position, so scattered notes can't share one call without reordering the bar.
        return notes.map((note) => {
            const pitch = minimizer.respelled.get(note)
            /* v8 ignore next -- defensive: replace of one note for one equal-duration note always returns exactly that note */
            return pitch ? (this.replaceNotes([note], [note.clone({ pitch })])[0] ?? note) : note
        })
    }

    /**
     * The tempo (BPM) sounding at `beat` of `measure`: the nearest marking at or before it in the
     * measure, else the tempo carried in from earlier measures, else the default.
     */
    bpmAtBeat(measure: Measure, beat: number): number {
        const local = measure.tempoAtOrBefore(beat)
        if (local) return local.bpm
        /* v8 ignore next -- defensive: tempoMap has one entry per measure index, so the lookup is always defined for an in-score measure */
        return this._tempoMap.value[this.getIndexForMeasure(measure)] ?? Score.DEFAULT_BPM
    }

    /**
     * Seconds from the top of the score to `beat` of `measure` — the one clock playback, the
     * metronome and export share. Every marking takes effect at its exact beat (the default
     * tempo before the first), each measure lasts its meter's length, and a `beat` past the
     * measure's end rolls on into the measures after it (past the last one, at the tempo the
     * score ends in).
     */
    secondsAt(measure: Measure, beat: number): number {
        let index = this.getIndexForMeasure(measure)
        let remaining = beat
        while (index < this.measures.length - 1 && remaining >= this.measures[index].maxBeats) {
            remaining -= this.measures[index].maxBeats
            index++
        }
        return this._measureStartSeconds.value[index] + this.secondsInto(this.measures[index], index, remaining)
    }

    /**
     * Where `beats` after the start of `start` falls: the measure and the beat within it, each
     * measure counted at its meter's length — or null when that lies past the score's last
     * measure. A position exactly on a barline belongs to the measure it opens.
     */
    positionAfter(start: Measure, beats: number): { measure: Measure; beat: number } | null {
        let remaining = beats
        for (let index = this.getIndexForMeasure(start); index < this.measures.length; index++) {
            const measure = this.measures[index]
            if (remaining < measure.maxBeats) return { measure, beat: remaining }
            remaining -= measure.maxBeats
        }
        return null
    }

    /** Seconds from the start of `measure` (at position `index`) to `beat` in it, integrated over its markings. */
    private secondsInto(measure: Measure, index: number, beat: number): number {
        let seconds = 0
        let end = beat
        // Walk back through the markings before `beat`: each one sounds from its beat to `end`.
        for (let marking = measure.tempoBefore(end); marking; marking = measure.tempoBefore(end)) {
            seconds += ((end - marking.beatPosition) * 60) / marking.bpm
            end = marking.beatPosition
        }
        return seconds + (end * 60) / this._tempoMap.value[index]
    }

    /** The tempo (BPM) sounding at `note` ({@link bpmAtBeat} at its onset), or the default without a note. */
    bpmAt(note: Note | null | undefined): number {
        return note ? this.bpmAtBeat(note.measure, note.measure.beatOffsetOf(note)) : Score.DEFAULT_BPM
    }

    /**
     * Change a note's written duration (type and/or dots; omitted parts keep the
     * note's current value). Inside a tuplet the change stays in the group's ratio
     * and is clipped to the group's end — freed slot space is padded with tuplet
     * rests by `replace` — so the group's span never changes. A change that covers
     * the whole group from its first slot reads better as plain notation, so it
     * leaves tuplet space. A clip may need several tied values (half a subdivided
     * group from its second slot). Returns the note to select next, or null without
     * a note, for a value that can't be dotted, or when the clipped span can't be
     * written at all (a sixth of a beat left by a lone 16th-triplet).
     */
    setDuration(note: Note | null | undefined, value: { type?: DurationType; dots?: number }): Note | null {
        if (!note) return null
        const ratio = note.duration.ratio
        const type = value.type ?? note.duration.type
        const dots = value.dots ?? note.duration.dots
        if (dots > 0 && !Duration.canDot(type)) return null
        let durations = [new Duration({ type, dots, ratio })]
        const tuplet = note.measure.tupletGroupOf(note)
        if (tuplet) {
            const index = tuplet.notes.indexOf(note)
            const remainder = sumBy(tuplet.notes.slice(index), (n) => n.duration.effectiveBeats)
            if (durations[0].effectiveBeats > remainder + BEAT_EPSILON) {
                durations = index === 0 ? Duration.fromBeats(remainder) : Duration.fromBeats(remainder, ratio)
            }
        }
        if (!durations.length) return null
        const values = durations.map((d, i) =>
            note.clone({ duration: d, ...(note.pitch && i < durations.length - 1 && { tie: 'start' as const }) }),
        )
        /* v8 ignore next -- defensive: replace always returns at least one note for a non-empty target */
        return this.replace([note], values)[0] ?? null
    }

    /**
     * Toggle the note between plain and triplet notation. A plain note becomes three
     * notes of the next-shorter value (3:2) — its pitch on the first, rests after. A
     * note inside a tuplet collapses the whole group back to plain notes of the same
     * total length, carrying the selected note's pitch — tied across several values
     * when an incomplete group's length needs them. Returns the note to select
     * next, or null when nothing changed (no shorter value exists, or the group's
     * length isn't representable in plain notes).
     */
    toggleTuplet(note: Note | null | undefined): Note | null {
        if (!note) return null
        const tuplet = note.measure.tupletGroupOf(note)
        if (tuplet) {
            const totalBeats = sumBy(tuplet.notes, (n) => n.duration.effectiveBeats)
            const durations = Duration.fromBeats(totalBeats)
            if (Math.abs(sumBy(durations, (d) => d.beats) - totalBeats) > BEAT_EPSILON) return null
            const values = durations.map(
                (d, i) =>
                    new Note({ duration: d, pitch: note.pitch, ...(note.pitch && i < durations.length - 1 && { tie: 'start' as const }) }),
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

    /**
     * Write `values` over the consecutive notes `targets`, from the first target's position: a
     * longer span takes in the notes that follow (appending a measure past the end), a shorter
     * one is padded with rests, and values flow across barlines as tied pieces. Returns the
     * written notes in score order.
     */
    replace(targets: Note[], values: Note[]): Note[] {
        const written = this.replaceNotes(targets, values)
        this.touch()
        return written
    }

    /** {@link replace} without the touch — the building block of the composite mutators. */
    private replaceNotes(targets: Note[], values: Note[]): Note[] {
        if (!targets.length) throw new Error('Replace targets can not be empty')
        if (!values.length) throw new Error('Replace values can not be empty')
        let targetBeats = sumBy(targets, (n) => n.duration.effectiveBeats)
        let valueBeats = sumBy(values, (n) => n.duration.effectiveBeats)

        while (targetBeats < valueBeats - BEAT_EPSILON) {
            const lastTarget = targets[targets.length - 1]
            let nextNote = lastTarget.getNext()
            if (!nextNote) {
                this.insertMeasure(this.measures.length, this.createMeasure(this.measures.length)).complete()
                nextNote = lastTarget.getNext()
            }
            /* v8 ignore next -- defensive: a measure was just appended and filled, so the next note always exists here */
            if (!nextNote) throw new Error('Trouble finding next note')
            targets = [...targets, nextNote]
            targetBeats += nextNote.duration.effectiveBeats
        }
        if (targetBeats > valueBeats + BEAT_EPSILON) {
            // The gap sits at the end of the replaced range. Plain rests when the gap is a plain
            // length; otherwise the gap is a tuplet fraction — of the notes being written (a pasted
            // triplet over a plain quarter) or of the notes being replaced (a shortened triplet
            // note) — and is padded in whichever tuplet space fills it exactly.
            const gap = targetBeats - valueBeats
            const candidates = [undefined, values[values.length - 1].duration.ratio, targets[targets.length - 1].duration.ratio]
            const fills = candidates.map((ratio) => Duration.fromBeats(gap, ratio))
            const exact = fills.find((rests) => Math.abs(sumBy(rests, (d) => d.effectiveBeats) - gap) < BEAT_EPSILON)
            values = [...values, ...(exact ?? fills[2]).map((d) => new Note({ duration: d }))]
            valueBeats += gap
        }
        const targetsByMeasure = new Map<Measure, Note[]>()
        for (const note of targets) {
            const group = targetsByMeasure.get(note.measure)
            if (group) group.push(note)
            else targetsByMeasure.set(note.measure, [note])
        }
        let replaceValues = [...values]
        const allNewNotes = []
        for (const [measure, notes] of targetsByMeasure) {
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
                        (d, i) =>
                            new Note({ duration: d, pitch: note.pitch, ...(i !== remainderDurations.length - 1 && { tie: 'start' }) }),
                    )
                }
            }
            measure.replaceNotes(notes, newNotes)
            // Whatever the padding above could not express exactly, the bar settles itself in tuplet space
            // (Measure.complete), leaving at most a sub-sixteenth residue rather than a hole a rest could fill.
            if (measure.beats < measure.maxBeats - BEAT_EPSILON) measure.complete()
            replaceValues = [...remainderNotes, ...replaceValues]
            allNewNotes.push(...newNotes)
        }
        return allNewNotes
    }

    // --- Persistence dirty-tracking ---

    private clearDirty() {
        this._dirtyMeasures.clear()
        this._structureChanged = false
        this._instrumentDirty = false
    }

    /**
     * Have the next flush send the part list, though the instrument was seeded rather than set —
     * for a score rebuilt from a snapshot whose instrument differs from the one last saved.
     */
    markInstrumentDirty(): void {
        this._instrumentDirty = true
    }

    /** Serialize dirty state, then clear it. Returns null if nothing changed. */
    flushDirty(): ScorePatch | null {
        const hasMeasureChanges = this._structureChanged || this._dirtyMeasures.size > 0
        if (!hasMeasureChanges && !this._instrumentDirty) return null

        const result: ScorePatch = {}

        if (this._instrumentDirty) result.partList = new ScoreSerializer(this).partList()

        if (this._structureChanged) {
            result.allMeasures = this.measures.map((m) => new MeasureSerializer(m).serialize())
        } else if (this._dirtyMeasures.size > 0) {
            const measures: Record<string, MxmlMeasure> = {}
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

    /**
     * Put a failed flush back on the dirty pile so the next flush retries it.
     * flushDirty clears state before the save request settles; without this,
     * a failed save silently drops those edits. Merging with edits made since
     * is safe: a structure change subsumes per-measure dirt, and per-measure
     * dirt is a set union.
     */
    redirty(patch: ScorePatch): void {
        if (patch.partList) this._instrumentDirty = true
        if (patch.allMeasures) this._structureChanged = true
        if (patch.measures) {
            for (const key of Object.keys(patch.measures)) {
                const measure = this.measures[Number(key)]
                if (measure) this._dirtyMeasures.add(measure)
            }
        }
    }
}
