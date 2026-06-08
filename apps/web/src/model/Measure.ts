import { compact, difference, sumBy } from 'lodash-es'

import { BARLINE_GAP, BARLINE_THICK_WIDTH, BARLINE_THIN_WIDTH, MAX_MEASURES_PER_ROW, SCORE_WIDTH } from '@/components/notation/constants'
import type { BarlineType, ClefType } from '@/components/notation/types'

import { Beam } from './Beam'
import { Clef } from './Clef'
import type { KeySignature } from './KeySignature'
import { MeasureLayout } from './layout/MeasureLayout'
import { Note } from './Note'
import { PhysicalElement } from './PhysicalElement'
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
    private _keySignature?: KeySignature
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
            keySignature?: KeySignature
            endBarline?: BarlineType
            /** Marks the leading clef as an intentional change (carry-forward boundary), not an inherited one. */
            leadingClefExplicit?: boolean
        },
    ) {
        // The measure owns its clefs (like its tempos): the leading clef sits at beat 0, further clefs are mid-measure changes.
        this._clefs = [new Clef(this, 0, clefType)]
        this._leadingExplicit = value?.leadingClefExplicit ?? false
        this._timeSignature = timeSignature
        this._timeSignature.setMeasure(this)
        this._keySignature = value?.keySignature
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
        // Clefs carry their own beat so mid-measure changes sort and space at the right position.
        if (el instanceof Clef) return el.beatPosition
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
        this.rebuildPhysicalElements()
    }

    /** Invalidate every note's layout — their staff positions depend on the active clef. */
    invalidateNoteLayouts() {
        for (const note of this._notes) note.invalidateLayout()
    }

    get showsClef() {
        return this._showsClef
    }

    get timeSignature() {
        return this._timeSignature
    }

    get showsTimeSignature() {
        return this._showsTimeSignature
    }

    get keySignature() {
        return this._keySignature
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

    setKeySignature(keySignature: KeySignature | undefined) {
        this._keySignature = keySignature
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
            this._showsTimeSignature ? this._timeSignature : undefined,
            ...this.midMeasureClefs,
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
