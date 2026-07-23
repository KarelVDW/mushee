import { difference, sumBy } from 'lodash-es'

import type { BarlineType, ClefType } from '../components/types'
import { Clef } from './Clef'
import { KeySignature } from './KeySignature'
import type { MeasureLayout } from './layout/MeasureLayout'
import { Note } from './Note'
import type { Score } from './Score'
import { Tempo } from './Tempo'
import { TimeSignature } from './TimeSignature'
import { Tuplet } from './Tuplet'
import { BeatPositionedList } from './util/BeatPositionedList'
import { Derived } from './util/Derived'
import { TupletFinder } from './util/TupletFinder'

/**
 * A bar of music: notes plus its beat-positioned context (clefs, key
 * signatures, tempos), the time signature value, and the end barline. Purely
 * semantic — geometry, widths, beams, and displayed accidentals live in the
 * layout layer.
 *
 * Every public mutator ends in exactly one `touch()` (the single choke point,
 * see ARCHITECTURE.md); derived state recomputes lazily off the version.
 */
export class Measure {
    readonly id = crypto.randomUUID()
    private _version = 0
    private _notes: Note[] = []
    private _clefs: Clef[] = []
    private _leadingClefExplicit: boolean
    private _keySignatures: KeySignature[] = []
    private _leadingKeyExplicit: boolean
    private _tempos: Tempo[] = []
    private _timeSignature: TimeSignature
    private _endBarline?: BarlineType

    private readonly _clefList = new BeatPositionedList<Clef>(() => this._clefs)
    private readonly _keyList = new BeatPositionedList<KeySignature>(() => this._keySignatures)
    private readonly _tempoList = new BeatPositionedList<Tempo>(() => this._tempos)

    private readonly _beatData = new Derived(
        () => this._version,
        () => {
            const offsets = new Map<Note, number>()
            let beat = 0
            for (const note of this._notes) {
                offsets.set(note, beat)
                beat += note.duration.effectiveBeats
            }
            return offsets
        },
    )

    private readonly _tupletData = new Derived(
        () => this._version,
        () => new TupletFinder(this),
    )

    constructor(
        readonly score: Score,
        clefType: ClefType,
        timeSignature: TimeSignature,
        value?: {
            /** Number of sharps (+) / flats (−) for the leading key signature; default 0 (C major). */
            keyFifths?: number
            keyMode?: string
            endBarline?: BarlineType
            /** Marks the leading clef as an intentional change (carry-forward boundary), not an inherited one. */
            leadingClefExplicit?: boolean
            /** Marks the leading key signature as an intentional change (carry-forward boundary). */
            leadingKeyExplicit?: boolean
        },
    ) {
        // The measure owns its clefs and key signatures (like its tempos): the leading one sits at beat 0,
        // further ones are mid-measure changes.
        this._clefs = [new Clef(this, 0, clefType)]
        this._leadingClefExplicit = value?.leadingClefExplicit ?? false
        this._keySignatures = [new KeySignature(this, 0, value?.keyFifths ?? 0, value?.keyMode)]
        this._leadingKeyExplicit = value?.leadingKeyExplicit ?? false
        this._timeSignature = timeSignature
        this._endBarline = value?.endBarline
    }

    /** Version of this measure's semantic content; bumped by the mutation choke point. */
    get version(): number {
        return this._version
    }

    /** The single mutation choke point — every public mutator ends here exactly once. */
    private touch() {
        this._version++
        this.score.measureChanged(this)
    }

    get index(): number {
        return this.score.getIndexForMeasure(this)
    }

    /** Delegates into the current ScoreLayout (the measure must be part of the score). */
    get layout(): MeasureLayout {
        return this.score.layout.measureLayoutFor(this)
    }

    // --- Notes ---

    get notes() {
        return this._notes
    }

    get firstNote(): Note | null {
        return this._notes[0] ?? null
    }

    get lastNote(): Note | null {
        return this._notes[this._notes.length - 1] ?? null
    }

    get beats(): number {
        return sumBy(this._notes, (n) => n.duration.effectiveBeats)
    }

    get maxBeats(): number {
        return this._timeSignature.maxBeats
    }

    beatOffsetOf(el: Note | Clef | KeySignature): number {
        // Clefs and key signatures carry their own beat so mid-measure changes sort and space at the right position.
        if (el instanceof Clef || el instanceof KeySignature) return el.beatPosition
        return this._beatData.value.get(el) ?? 0
    }

    /** Find the note whose beat range contains the given (continuous) beat value. */
    noteAtBeat(beat: number): Note | null {
        for (let i = this._notes.length - 1; i >= 0; i--) {
            const note = this._notes[i]
            const offset = this._beatData.value.get(note)
            /* v8 ignore next -- the `offset !== undefined` guard is defensive: _beatData is derived from this same _notes array at the current version, so every note has an offset */
            if (offset !== undefined && offset <= beat) return note
        }
        return null
    }

    get tuplets(): Tuplet[] {
        return this._tupletData.value.tuplets
    }

    tupletGroupOf(note: Note): Tuplet | undefined {
        return this._tupletData.value.tupletByNote.get(note)
    }

    removeNotes(notes: Note[]) {
        this._notes = difference(this._notes, notes)
        notes.forEach((n) => n.setMeasure(undefined))
        this.touch()
        return this
    }

    addNotes(notes: Note[], position: 'start' | 'end' = 'end') {
        this._notes = position === 'end' ? [...this._notes, ...notes] : [...notes, ...this._notes]
        notes.forEach((n) => n.setMeasure(this))
        this.touch()
        return this
    }

    replaceNotes(targets: Note[], values: Note[]) {
        if (!targets.length) throw new Error('Replace targets can not be empty')
        if (targets.some((n) => n.measure.id !== this.id)) throw new Error('Cannot replace notes not belonging to this measure')
        const startIndex = this.notes.findIndex((n) => n.id === targets[0].id)
        if (startIndex < 0) throw new Error('Cannot find startIndex for replace')
        const diff = difference(this._notes, targets)
        this._notes = [...diff.slice(0, startIndex), ...values, ...diff.slice(startIndex)]
        targets.forEach((n) => n.setMeasure(undefined))
        values.forEach((n) => n.setMeasure(this))
        this.touch()
        return this
    }

    complete() {
        if (this.beats >= this.maxBeats) return
        this.addNotes(this._timeSignature.fillRests(this.beats).map((d) => new Note({ duration: d })))
        return this
    }

    // --- Clefs (leading at beat 0 + optional mid-measure changes) ---

    get clefs(): Clef[] {
        return this._clefs
    }

    /** The leading clef shown at the start of the measure (the clef at beat 0). */
    get clef(): Clef {
        const leading = this._clefList.leading
        if (!leading) throw new Error('Measure has no leading clef')
        return leading
    }

    clefAtBeat(beatPosition: number): Clef | undefined {
        return this._clefList.at(beatPosition)
    }

    /** The clef in effect at `beatPosition` within this measure — the latest at or before it. */
    clefAtOrBefore(beatPosition: number): Clef {
        return this._clefList.atOrBefore(beatPosition) ?? this.clef
    }

    /** The last (highest-beat) clef in the measure — the one carried into the next measure. */
    get lastClef(): Clef {
        return this._clefList.last ?? this.clef
    }

    /** The clef in effect just before `beatPosition` (ignoring any clef exactly at it). */
    clefBefore(beatPosition: number): Clef {
        return this._clefList.before(beatPosition) ?? this.clef
    }

    /**
     * Mid-measure clef changes that actually change the active clef, in beat order. A stored clef
     * equal to the one already in effect before it (e.g. left behind when the leading clef is set to
     * the same type) is a no-op: it is kept in `_clefs` so the intent re-emerges if context changes,
     * but it is not drawn or serialized.
     */
    get midMeasureClefs(): Clef[] {
        return this._clefList.midMeasureChanges((active, clef) => active.type !== clef.type)
    }

    /** Whether the leading clef is an intentional change (a carry-forward boundary). */
    get leadingClefExplicit(): boolean {
        return this._leadingClefExplicit
    }

    addClef(beatPosition: number, type: ClefType) {
        this._clefs.push(new Clef(this, beatPosition, type))
        this.touch()
    }

    removeClef(beatPosition: number) {
        this._clefs = this._clefs.filter((c) => c.beatPosition !== beatPosition)
        this.touch()
    }

    /**
     * Add or replace the clef at `beatPosition`. Beat 0 marks the leading clef as an explicit change.
     * A mid-measure clef equal to the clef already in effect there is redundant, so it is removed instead.
     * Note: carry-forward into later measures is a Score responsibility (`Score.setClef`).
     */
    setClef(beatPosition: number, type: ClefType) {
        this._clefs = this._clefs.filter((c) => c.beatPosition !== beatPosition)
        if (beatPosition > 0 && this.clefBefore(beatPosition).type === type) {
            // Redundant mid-measure change — leave the position governed by the preceding clef.
        } else {
            this._clefs.push(new Clef(this, beatPosition, type))
            if (beatPosition === 0) this._leadingClefExplicit = true
        }
        this.touch()
    }

    /** Demote the leading clef to inherited (no longer a carry-forward boundary). */
    makeLeadingClefInherited() {
        this._leadingClefExplicit = false
        this.touch()
    }

    // --- Key signatures (parallels clefs: a leading key at beat 0 + optional mid-measure changes) ---

    get keySignatures(): KeySignature[] {
        return this._keySignatures
    }

    /** The leading key signature at the start of the measure (the key at beat 0). */
    get keySignature(): KeySignature {
        const leading = this._keyList.leading
        if (!leading) throw new Error('Measure has no leading key signature')
        return leading
    }

    keyAtBeat(beatPosition: number): KeySignature | undefined {
        return this._keyList.at(beatPosition)
    }

    /** The key signature in effect at `beatPosition` within this measure — the latest at or before it. */
    keyAtOrBefore(beatPosition: number): KeySignature {
        return this._keyList.atOrBefore(beatPosition) ?? this.keySignature
    }

    /** The last (highest-beat) key signature in the measure — the one carried into the next measure. */
    get lastKey(): KeySignature {
        return this._keyList.last ?? this.keySignature
    }

    /** The key signature in effect just before `beatPosition` (ignoring any key exactly at it). */
    keyBefore(beatPosition: number): KeySignature {
        return this._keyList.before(beatPosition) ?? this.keySignature
    }

    /**
     * Mid-measure key changes that actually change the active key, in beat order. A stored key equal to
     * the one already in effect before it is a no-op: kept in `_keySignatures` (so the intent re-emerges
     * if context changes) but not drawn or serialized.
     */
    get midMeasureKeySignatures(): KeySignature[] {
        return this._keyList.midMeasureChanges((active, key) => active.fifths !== key.fifths)
    }

    /** Whether the leading key signature is an intentional change (a carry-forward boundary). */
    get leadingKeyExplicit(): boolean {
        return this._leadingKeyExplicit
    }

    addKeySignature(beatPosition: number, fifths: number, mode?: string) {
        this._keySignatures.push(new KeySignature(this, beatPosition, fifths, mode))
        this.touch()
    }

    removeKeySignature(beatPosition: number) {
        this._keySignatures = this._keySignatures.filter((k) => k.beatPosition !== beatPosition)
        this.touch()
    }

    /**
     * Add or replace the key signature at `beatPosition`. Beat 0 marks the leading key as an explicit change.
     * A mid-measure key equal to the one already in effect there is redundant, so it is removed instead.
     * Note: carry-forward into later measures is a Score responsibility (`Score.setKeySignature`).
     */
    setKeySignature(beatPosition: number, fifths: number, mode?: string) {
        this._keySignatures = this._keySignatures.filter((k) => k.beatPosition !== beatPosition)
        if (beatPosition > 0 && this.keyBefore(beatPosition).fifths === fifths) {
            // Redundant mid-measure change — leave the position governed by the preceding key.
        } else {
            this._keySignatures.push(new KeySignature(this, beatPosition, fifths, mode))
            if (beatPosition === 0) this._leadingKeyExplicit = true
        }
        this.touch()
    }

    /** Demote the leading key signature to inherited (no longer a carry-forward boundary). */
    makeLeadingKeyInherited() {
        this._leadingKeyExplicit = false
        this.touch()
    }

    /** Re-key every key signature in the measure by a (chromatic, diatonic) interval — for instrument transposition. */
    transposeKeySignatures(chromatic: number, diatonic: number) {
        this._keySignatures = this._keySignatures.map(
            (k) => new KeySignature(this, k.beatPosition, KeySignature.transposedFifths(k.fifths, chromatic, diatonic), k.mode),
        )
        this.touch()
    }

    /**
     * Carry-forward applicators, driven by `Score.propagateContext()`: set the inherited leading
     * clef/key without marking it explicit. No touch — the calling Score mutator owns the version
     * bump, and inherited values don't change the measure's serialized form (no dirty marking).
     * The version still moves (via the internal bump) so stale layouts rebuild.
     */
    applyInheritedClef(type: ClefType) {
        if (this._leadingClefExplicit || this.clef.type === type) return
        this._clefs = [new Clef(this, 0, type), ...this._clefs.filter((c) => c.beatPosition !== 0)]
        this._version++
    }

    applyInheritedKey(fifths: number, mode?: string) {
        if (this._leadingKeyExplicit || (this.keySignature.fifths === fifths && this.keySignature.mode === mode)) return
        this._keySignatures = [new KeySignature(this, 0, fifths, mode), ...this._keySignatures.filter((k) => k.beatPosition !== 0)]
        this._version++
    }

    // --- Time signature & barline ---

    get timeSignature() {
        return this._timeSignature
    }

    setTimeSignature(timeSignature: TimeSignature) {
        this._timeSignature = timeSignature
        this.touch()
    }

    get endBarline() {
        return this._endBarline
    }

    setEndBarline(barLine: BarlineType | undefined) {
        this._endBarline = barLine
        this.touch()
    }

    // --- Tempos ---

    get tempos(): Tempo[] {
        return this._tempos
    }

    addTempo(beatPosition: number, bpm: number) {
        this._tempos.push(new Tempo(this, beatPosition, bpm))
        this.touch()
    }

    removeTempo(beatPosition: number) {
        this._tempos = this._tempos.filter((t) => t.beatPosition !== beatPosition)
        this.touch()
    }

    setTempo(beatPosition: number, bpm: number) {
        this._tempos = this._tempos.filter((t) => t.beatPosition !== beatPosition)
        this._tempos.push(new Tempo(this, beatPosition, bpm))
        this.touch()
    }

    tempoAtBeat(beatPosition: number): Tempo | undefined {
        return this._tempoList.at(beatPosition)
    }

    /** The tempo marking in effect at `beatPosition` within this measure — the latest at or before it, if any. */
    tempoAtOrBefore(beatPosition: number): Tempo | undefined {
        return this._tempoList.atOrBefore(beatPosition)
    }

    /** The last (highest-beat) tempo marking in this measure — the one that carries into the next measure. */
    get lastTempo(): Tempo | undefined {
        return this._tempoList.last
    }

    // --- Navigation (thin delegates; the traversal lives on Score) ---

    getNextNote(note?: Note): Note | null {
        if (!note) return this.firstNote
        const idx = this._notes.indexOf(note)
        if (idx === -1 || idx >= this._notes.length - 1) return null
        return this._notes[idx + 1]
    }

    getPreviousNote(note: Note): Note | null {
        const idx = this._notes.indexOf(note)
        if (idx <= 0) return null
        return this._notes[idx - 1]
    }

    getNext(): Measure | null {
        return this.score.getNextMeasure(this)
    }

    getPrevious(): Measure | null {
        return this.score.getPreviousMeasure(this)
    }
}
