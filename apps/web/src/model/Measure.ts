import { compact, difference, sumBy } from 'lodash-es'

import { BARLINE_GAP, BARLINE_THICK_WIDTH, BARLINE_THIN_WIDTH, MAX_MEASURES_PER_ROW, SCORE_WIDTH } from '@/components/notation/constants'
import type { BarlineType, ClefType } from '@/components/notation/types'

import { Beam } from './Beam'
import { Clef } from './Clef'
import { KeySignature } from './KeySignature'
import { MeasureLayout } from './layout/MeasureLayout'
import { Note } from './Note'
import { PhysicalElement } from './PhysicalElement'
import { Pitch } from './Pitch'
import type { Score } from './Score'
import { Tempo } from './Tempo'
import { TimeSignature } from './TimeSignature'
import { Tuplet } from './Tuplet'
import { BeamFinder } from './util/BeamFinder'
import { TupletFinder } from './util/TupletFinder'

export class Measure {
    readonly id = crypto.randomUUID()
    private _notes: Note[] = []
    private _clefs: Clef[] = []
    private _leadingExplicit = false
    private _showsClef: boolean = false
    private _timeSignature: TimeSignature
    private _showsTimeSignature: boolean = false
    private _keySignatures: KeySignature[] = []
    private _leadingKeyExplicit = false
    private _showsKeySignature: boolean = false
    private _accidentalGlyphs: Map<Note, string | undefined> | null = null
    private _endBarline?: BarlineType
    private _tempos: Tempo[] = []
    private _tuplets: Tuplet[] = []
    private _beams: Beam[] = []
    private _beatOffsets = new Map<PhysicalElement, number>()
    private _tupletByNote = new Map<Note, Tuplet>()
    private _beamByNote = new Map<Note, Beam>()
    private _noteSet = new Set<Note>()
    private _layout: MeasureLayout | null = null
    private _physicalElements: PhysicalElement[] = []
    private _minimalWidth: number = 0

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
        this._leadingExplicit = value?.leadingClefExplicit ?? false
        this._keySignatures = [new KeySignature(this, 0, value?.keyFifths ?? 0, value?.keyMode)]
        this._leadingKeyExplicit = value?.leadingKeyExplicit ?? false
        this._timeSignature = timeSignature
        this._timeSignature.setMeasure(this)
        this._endBarline = value?.endBarline
    }

    get index(): number {
        return this.score.getIndexForMeasure(this)
    }

    setShowsClef(value: boolean) {
        if (this._showsClef === value) return
        this._showsClef = value
        this.rebuildPhysicalElements()
    }

    get layout() {
        this._layout ||= new MeasureLayout(this)
        return this._layout
    }

    invalidateLayout() {
        this._layout = null
    }

    get tuplets() {
        return this._tuplets
    }

    get beams() {
        return this._beams
    }

    get physicalElements() {
        return this._physicalElements
    }

    get minimalWidth() {
        return this._minimalWidth
    }

    beatOffsetOf(el: PhysicalElement): number {
        // Clefs and key signatures carry their own beat so mid-measure changes sort and space at the right position.
        if (el instanceof Clef || el instanceof KeySignature) return el.beatPosition
        const offset = this._beatOffsets.get(el)
        return offset ?? 0
    }

    tupletGroupOf(note: Note): Tuplet | undefined {
        return this._tupletByNote.get(note)
    }

    beamOf(note: Note): Beam | undefined {
        return this._beamByNote.get(note)
    }

    /** Find the note whose beat range contains the given (continuous) beat value. */
    noteAtBeat(beat: number): Note | null {
        for (let i = this._notes.length - 1; i >= 0; i--) {
            const note = this._notes[i]
            const offset = this._beatOffsets.get(note)
            if (offset !== undefined && offset <= beat) return note
        }
        return null
    }

    get notes() {
        return this._notes
    }

    hasNote(note: Note | undefined | null): boolean {
        return note != null && this._noteSet.has(note)
    }

    get clefs(): Clef[] {
        return this._clefs
    }

    /** The leading clef shown at the start of the measure (the clef at beat 0). */
    get clef(): Clef {
        return this._clefs.find((c) => c.beatPosition === 0) ?? this._clefs[0]
    }

    clefAtBeat(beatPosition: number): Clef | undefined {
        return this._clefs.find((c) => c.beatPosition === beatPosition)
    }

    /** The clef in effect at `beatPosition` within this measure — the latest at or before it. */
    clefAtOrBefore(beatPosition: number): Clef {
        let active = this.clef
        for (const clef of this._clefs) {
            if (clef.beatPosition <= beatPosition && clef.beatPosition >= active.beatPosition) active = clef
        }
        return active
    }

    /** The last (highest-beat) clef in the measure — the one carried into the next measure. */
    get lastClef(): Clef {
        let latest = this.clef
        for (const clef of this._clefs) {
            if (clef.beatPosition > latest.beatPosition) latest = clef
        }
        return latest
    }

    /** The clef in effect just before `beatPosition` (ignoring any clef exactly at it). */
    clefBefore(beatPosition: number): Clef {
        let active = this.clef
        for (const clef of this._clefs) {
            if (clef.beatPosition < beatPosition && clef.beatPosition >= active.beatPosition) active = clef
        }
        return active
    }

    /**
     * Mid-measure clef changes that actually change the active clef, in beat order. A stored clef
     * equal to the one already in effect before it (e.g. left behind when the leading clef is set to
     * the same type) is a no-op: it is kept in `_clefs` so the intent re-emerges if context changes,
     * but it is not drawn or serialized.
     */
    get midMeasureClefs(): Clef[] {
        return this._clefs
            .filter((c) => c.beatPosition > 0 && this.clefBefore(c.beatPosition).type !== c.type)
            .sort((a, b) => a.beatPosition - b.beatPosition)
    }

    /** Whether the leading clef is an intentional change (a carry-forward boundary). */
    get leadingClefExplicit(): boolean {
        return this._leadingExplicit
    }

    addClef(beatPosition: number, type: ClefType) {
        this._clefs.push(new Clef(this, beatPosition, type))
    }

    removeClef(beatPosition: number) {
        this._clefs = this._clefs.filter((c) => c.beatPosition !== beatPosition)
    }

    /**
     * Add or replace the clef at `beatPosition`. Beat 0 marks the leading clef as an explicit change.
     * A mid-measure clef equal to the clef already in effect there is redundant, so it is removed instead.
     */
    setClef(beatPosition: number, type: ClefType) {
        this.removeClef(beatPosition)
        if (beatPosition > 0 && this.clefBefore(beatPosition).type === type) {
            // Redundant mid-measure change — leave the position governed by the preceding clef.
        } else {
            this.addClef(beatPosition, type)
            if (beatPosition === 0) this._leadingExplicit = true
        }
        this.invalidateNoteLayouts()
        this.invalidateKeyLayouts()
        this.rebuildPhysicalElements()
    }

    /** Demote the leading clef to inherited (no longer a carry-forward boundary). */
    makeLeadingClefInherited() {
        this._leadingExplicit = false
    }

    /** Carry-forward: set the inherited leading clef without marking it explicit (used by Score). */
    setLeadingClefType(type: ClefType) {
        if (this.clef.type === type) return
        this.removeClef(0)
        this._clefs.unshift(new Clef(this, 0, type))
        this.invalidateNoteLayouts()
        this.invalidateKeyLayouts()
        this.rebuildPhysicalElements()
    }

    /** Invalidate every note's layout — their staff positions depend on the active clef. */
    invalidateNoteLayouts() {
        for (const note of this._notes) note.invalidateLayout()
    }

    /** Invalidate every key signature's layout — accidental staff positions depend on the active clef. */
    invalidateKeyLayouts() {
        for (const key of this._keySignatures) key.invalidateLayout()
    }

    /**
     * Refresh key signatures' cached width and layout, then re-space the measure. Their drawn accidentals
     * include cancellation naturals that depend on the *preceding* key, so this is re-run during row
     * rebuilds (where carry-forward can change what each key cancels).
     */
    refreshKeySignatures() {
        for (const key of this._keySignatures) key.invalidate()
        this.rebuildPhysicalElements()
    }

    get showsClef() {
        return this._showsClef
    }

    // --- Key signatures (parallels clefs: a leading key at beat 0 + optional mid-measure changes) ---

    get keySignatures(): KeySignature[] {
        return this._keySignatures
    }

    /** The leading key signature at the start of the measure (the key at beat 0). */
    get keySignature(): KeySignature {
        return this._keySignatures.find((k) => k.beatPosition === 0) ?? this._keySignatures[0]
    }

    keyAtBeat(beatPosition: number): KeySignature | undefined {
        return this._keySignatures.find((k) => k.beatPosition === beatPosition)
    }

    /** The key signature in effect at `beatPosition` within this measure — the latest at or before it. */
    keyAtOrBefore(beatPosition: number): KeySignature {
        let active = this.keySignature
        for (const key of this._keySignatures) {
            if (key.beatPosition <= beatPosition && key.beatPosition >= active.beatPosition) active = key
        }
        return active
    }

    /** The last (highest-beat) key signature in the measure — the one carried into the next measure. */
    get lastKey(): KeySignature {
        let latest = this.keySignature
        for (const key of this._keySignatures) {
            if (key.beatPosition > latest.beatPosition) latest = key
        }
        return latest
    }

    /** The key signature in effect just before `beatPosition` (ignoring any key exactly at it). */
    keyBefore(beatPosition: number): KeySignature {
        let active = this.keySignature
        for (const key of this._keySignatures) {
            if (key.beatPosition < beatPosition && key.beatPosition >= active.beatPosition) active = key
        }
        return active
    }

    /**
     * Mid-measure key changes that actually change the active key, in beat order. A stored key equal to
     * the one already in effect before it is a no-op: kept in `_keySignatures` (so the intent re-emerges
     * if context changes) but not drawn or serialized.
     */
    get midMeasureKeySignatures(): KeySignature[] {
        return this._keySignatures
            .filter((k) => k.beatPosition > 0 && this.keyBefore(k.beatPosition).fifths !== k.fifths)
            .sort((a, b) => a.beatPosition - b.beatPosition)
    }

    /** Whether the leading key signature is an intentional change (a carry-forward boundary). */
    get leadingKeyExplicit(): boolean {
        return this._leadingKeyExplicit
    }

    addKeySignature(beatPosition: number, fifths: number, mode?: string) {
        this._keySignatures.push(new KeySignature(this, beatPosition, fifths, mode))
        // The accidental cache can already be built (NoteWidth reads displayed accidentals) — refresh it.
        this.invalidateNoteAccidentals()
    }

    removeKeySignature(beatPosition: number) {
        this._keySignatures = this._keySignatures.filter((k) => k.beatPosition !== beatPosition)
        this.invalidateNoteAccidentals()
    }

    /**
     * Add or replace the key signature at `beatPosition`. Beat 0 marks the leading key as an explicit change.
     * A mid-measure key equal to the one already in effect there is redundant, so it is removed instead.
     */
    setKeySignature(beatPosition: number, fifths: number, mode?: string) {
        this.removeKeySignature(beatPosition)
        if (beatPosition > 0 && this.keyBefore(beatPosition).fifths === fifths) {
            // Redundant mid-measure change — leave the position governed by the preceding key.
        } else {
            this.addKeySignature(beatPosition, fifths, mode)
            if (beatPosition === 0) this._leadingKeyExplicit = true
        }
        this.invalidateNoteAccidentals()
        this.rebuildPhysicalElements()
    }

    /** Demote the leading key signature to inherited (no longer a carry-forward boundary). */
    makeLeadingKeyInherited() {
        this._leadingKeyExplicit = false
    }

    /** Carry-forward: set the inherited leading key without marking it explicit (used by Score). */
    setLeadingKey(fifths: number, mode?: string) {
        if (this.keySignature.fifths === fifths && this.keySignature.mode === mode) return
        this.removeKeySignature(0)
        this._keySignatures.unshift(new KeySignature(this, 0, fifths, mode))
        this.invalidateNoteAccidentals()
        this.rebuildPhysicalElements()
    }

    setShowsKeySignature(value: boolean) {
        if (this._showsKeySignature === value) return
        this._showsKeySignature = value
        this.rebuildPhysicalElements()
    }

    get showsKeySignature() {
        return this._showsKeySignature
    }

    /** Re-key every key signature in the measure by a (chromatic, diatonic) interval — for instrument transposition. */
    transposeKeySignatures(chromatic: number, diatonic: number) {
        this._keySignatures = this._keySignatures.map(
            (k) => new KeySignature(this, k.beatPosition, KeySignature.transposedFifths(k.fifths, chromatic, diatonic), k.mode),
        )
        this.invalidateNoteAccidentals()
        this.rebuildPhysicalElements()
    }

    /**
     * Displayed accidental glyph for a note in this measure, or undefined if none is drawn. Full
     * measure-aware: a note shows an accidental when its alteration differs from what is currently in
     * effect for its pitch — the key signature, overridden by any earlier accidental on the same
     * (name, octave) in the bar. A mid-measure key change resets the carried accidentals.
     */
    accidentalGlyphFor(note: Note): string | undefined {
        if (!this._accidentalGlyphs) this._accidentalGlyphs = this._computeAccidentals()
        return this._accidentalGlyphs.get(note)
    }

    private _computeAccidentals(): Map<Note, string | undefined> {
        const result = new Map<Note, string | undefined>()
        const inEffect = new Map<string, number>() // "name+octave" -> alteration currently sounding in the bar
        let keyFifths = this.keySignature.fifths
        for (const note of this._notes) {
            if (!note.pitch) {
                result.set(note, undefined)
                continue
            }
            const key = this.keyAtOrBefore(this.beatOffsetOf(note))
            if (key.fifths !== keyFifths) {
                inEffect.clear() // a new key signature cancels carried accidentals
                keyFifths = key.fifths
            }
            const id = `${note.pitch.name}${note.pitch.octave}`
            const prevailing = inEffect.has(id) ? (inEffect.get(id) as number) : key.alterForNote(note.pitch.name)
            if (note.pitch.alter !== prevailing) {
                result.set(note, Pitch.glyphForAlter(note.pitch.alter))
                inEffect.set(id, note.pitch.alter)
            } else {
                result.set(note, undefined)
            }
        }
        return result
    }

    /** Invalidate every note's accidental — display depends on the active key and prior notes in the bar. */
    invalidateNoteAccidentals() {
        this._accidentalGlyphs = null
        for (const note of this._notes) note.invalidateWidth()
    }

    get timeSignature() {
        return this._timeSignature
    }

    get showsTimeSignature() {
        return this._showsTimeSignature
    }

    get endBarline() {
        return this._endBarline
    }

    get barlineWidth(): number {
        const type = this._endBarline ?? 'single'
        switch (type) {
            case 'none':
                return 0
            case 'single':
                return BARLINE_THIN_WIDTH
            case 'double':
                return BARLINE_THIN_WIDTH + BARLINE_GAP + BARLINE_THIN_WIDTH
            case 'end':
                return BARLINE_THIN_WIDTH + BARLINE_GAP + BARLINE_THICK_WIDTH
        }
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

    setTimeSignature(timeSignature: TimeSignature) {
        this._timeSignature = timeSignature
        this._timeSignature.setMeasure(this)
        this.rebuildPhysicalElements()
    }

    setShowsTimeSignature(value: boolean) {
        if (this._showsTimeSignature === value) return
        this._showsTimeSignature = value
        this.rebuildPhysicalElements()
    }

    setEndBarline(barLine: BarlineType | undefined) {
        this._endBarline = barLine
        this.rebuildPhysicalElements()
    }

    get tempos(): Tempo[] {
        return this._tempos
    }

    addTempo(beatPosition: number, bpm: number) {
        this._tempos.push(new Tempo(this, beatPosition, bpm))
    }

    removeTempo(beatPosition: number) {
        this._tempos = this._tempos.filter((t) => t.beatPosition !== beatPosition)
    }

    setTempo(beatPosition: number, bpm: number) {
        this.removeTempo(beatPosition)
        this.addTempo(beatPosition, bpm)
    }

    tempoAtBeat(beatPosition: number): Tempo | undefined {
        return this._tempos.find((t) => t.beatPosition === beatPosition)
    }

    /** The tempo marking in effect at `beatPosition` within this measure — the latest at or before it, if any. */
    tempoAtOrBefore(beatPosition: number): Tempo | undefined {
        let active: Tempo | undefined
        for (const tempo of this._tempos) {
            if (tempo.beatPosition <= beatPosition && (!active || tempo.beatPosition > active.beatPosition)) active = tempo
        }
        return active
    }

    /** The last (highest-beat) tempo marking in this measure — the one that carries into the next measure. */
    get lastTempo(): Tempo | undefined {
        let latest: Tempo | undefined
        for (const tempo of this._tempos) {
            if (!latest || tempo.beatPosition > latest.beatPosition) latest = tempo
        }
        return latest
    }

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

    removeNotes(notes: Note[]) {
        this._notes = difference(this._notes, notes)
        notes.forEach((n) => n.setMeasure(undefined))
        this.recompute()
        return this
    }

    addNotes(notes: Note[], position: 'start' | 'end' = 'end') {
        this._notes = position === 'end' ? [...this._notes, ...notes] : [...notes, ...this._notes]
        notes.forEach((n) => n.setMeasure(this))
        this.recompute()
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
        this.recompute()
        return this
    }

    complete() {
        if (this.beats >= this.maxBeats) return
        this.addNotes(this._timeSignature.fillRests(this.beats).map((d) => new Note({ duration: d })))
        return this
    }

    private recompute() {
        // rebuild note set and beat offsets
        this._noteSet = new Set(this._notes)
        this._beatOffsets = new Map()
        let beat = 0
        for (const note of this._notes) {
            this._beatOffsets.set(note, beat)
            beat += note.duration.effectiveBeats
        }
        // displayed accidentals depend on note order/content within the bar
        this._accidentalGlyphs = null
        for (const note of this._notes) note.invalidateWidth()
        // find tuplets
        const tupletFinder = new TupletFinder(this)
        this._tuplets = tupletFinder.tuplets
        this._tupletByNote = tupletFinder.tupletByNote
        // invalidate old beam notes
        this._beams.forEach((b) => b.notes.forEach((n) => n.invalidateLayout()))
        // find beams
        const beamFinder = new BeamFinder(this)
        this._beams = beamFinder.beams
        this._beamByNote = beamFinder.beamByNote
        // invalidate new beam notes
        this._beams.forEach((b) => b.notes.forEach((n) => n.invalidateLayout()))
        // invalidate layout
        this.rebuildPhysicalElements()
    }

    private rebuildPhysicalElements() {
        this._physicalElements = compact([
            this._showsClef ? this.clef : undefined,
            this._showsKeySignature && this.keySignature.drawnAccidentals.length > 0 ? this.keySignature : undefined,
            this._showsTimeSignature ? this._timeSignature : undefined,
            ...this.midMeasureClefs,
            ...this.midMeasureKeySignatures,
            ...this._notes,
        ])
        const widthSum = sumBy(this._physicalElements, (el) => el.width.total) + this.barlineWidth
        const absoluteMinimum = SCORE_WIDTH / (MAX_MEASURES_PER_ROW + 1)
        const previousMinimalWidth = this._minimalWidth
        this._minimalWidth = widthSum > absoluteMinimum ? widthSum : absoluteMinimum
        this._layout = null
        if (this._minimalWidth !== previousMinimalWidth) {
            this.score.onMeasureWidthChanged(this)
        }
    }
}
