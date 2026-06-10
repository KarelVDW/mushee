import { KeySignatureLayout } from './layout/KeySignatureLayout'
import type { Measure } from './Measure'
import { Pitch } from './Pitch'
import { KeySignatureWidth } from './width/KeySignatureWidth'

/** Order of sharps and flats in key signatures */
const SHARP_ORDER = ['F', 'C', 'G', 'D', 'A', 'E', 'B'] as const
const FLAT_ORDER = ['B', 'E', 'A', 'D', 'G', 'C', 'F'] as const

/**
 * Canonical pitch (name + octave) each sharp/flat occupies in a treble-clef key signature.
 * KeySignatureLayout positions them via the active clef and normalizes by octaves into the staff.
 */
const SHARP_PITCHES: ReadonlyArray<{ name: string; octave: number }> = [
    { name: 'F', octave: 5 },
    { name: 'C', octave: 5 },
    { name: 'G', octave: 5 },
    { name: 'D', octave: 5 },
    { name: 'A', octave: 4 },
    { name: 'E', octave: 5 },
    { name: 'B', octave: 4 },
]
const FLAT_PITCHES: ReadonlyArray<{ name: string; octave: number }> = [
    { name: 'B', octave: 4 },
    { name: 'E', octave: 5 },
    { name: 'A', octave: 4 },
    { name: 'D', octave: 5 },
    { name: 'G', octave: 4 },
    { name: 'C', octave: 5 },
    { name: 'F', octave: 4 },
]

export interface KeyAccidental {
    glyphName: 'accidentalSharp' | 'accidentalFlat' | 'accidentalNatural'
    name: string
    octave: number
}

/**
 * A key signature anchored in a measure, like a {@link Clef}: the leading key sits at beat 0, further
 * ones are mid-measure changes. Its identity for propagation is `fifths` (positive = sharps, negative =
 * flats); `mode` is carried for serialization but does not affect accidentals or rendering.
 */
export class KeySignature {
    readonly id = crypto.randomUUID()
    private _layout: KeySignatureLayout | null = null
    private _width: KeySignatureWidth | null = null

    constructor(
        readonly measure: Measure,
        readonly beatPosition: number,
        readonly fifths: number,
        readonly mode?: string,
    ) {}

    get width() {
        if (!this._width) this._width = new KeySignatureWidth(this)
        return this._width
    }

    get layout() {
        if (!this._layout) this._layout = new KeySignatureLayout(this)
        return this._layout
    }

    invalidateLayout() {
        this._layout = null
    }

    /** Clear cached width and layout — the drawn accidentals (incl. cancellation naturals) depend on context. */
    invalidate() {
        this._width = null
        this._layout = null
    }

    /** Fifths of the key in effect immediately before this one — the previous measure's last key, or the key earlier in this measure. */
    get precedingFifths(): number {
        if (this.beatPosition > 0) return this.measure.keyBefore(this.beatPosition).fifths
        return this.measure.getPrevious()?.lastKey.fifths ?? 0
    }

    /** Note names that are sharp in this key */
    get sharps(): string[] {
        if (this.fifths <= 0) return []
        return SHARP_ORDER.slice(0, this.fifths) as unknown as string[]
    }

    /** Note names that are flat in this key */
    get flats(): string[] {
        if (this.fifths >= 0) return []
        return FLAT_ORDER.slice(0, -this.fifths) as unknown as string[]
    }

    /** The accidentals drawn for this key, in left-to-right order, with the pitch each occupies. */
    get accidentals(): KeyAccidental[] {
        return KeySignature.accidentalsForFifths(this.fifths)
    }

    /** The accidentals (glyph + canonical treble pitch) a key of `fifths` draws, left to right. */
    static accidentalsForFifths(fifths: number): KeyAccidental[] {
        if (fifths > 0) return SHARP_PITCHES.slice(0, fifths).map((p) => ({ glyphName: 'accidentalSharp', ...p }))
        if (fifths < 0) return FLAT_PITCHES.slice(0, -fifths).map((p) => ({ glyphName: 'accidentalFlat', ...p }))
        return []
    }

    /**
     * The accidentals actually drawn on the staff for this key in context. Only a switch *to* C major draws
     * cancellation naturals (one for each of the preceding key's sharps/flats, to mark the transition); every
     * other key just draws its own accidentals.
     */
    get drawnAccidentals(): KeyAccidental[] {
        if (this.fifths !== 0) return this.accidentals
        const preceding = this.precedingFifths
        if (preceding === 0) return [] // C major with nothing before it to cancel
        return KeySignature.accidentalsForFifths(preceding).map((a) => ({ glyphName: 'accidentalNatural', name: a.name, octave: a.octave }))
    }

    /** Semitone alteration this key signature applies to the given note name (+1 sharp, −1 flat, 0 natural). */
    alterForNote(noteName: string): number {
        if (this.sharps.includes(noteName)) return 1
        if (this.flats.includes(noteName)) return -1
        return 0
    }

    /**
     * Spell a (line-derived, natural) pitch according to this key — e.g. an F entered in G major becomes
     * F♯. The alteration is implied by the key, so no explicit accidental is attached (the displayed
     * accidental is derived later). Used when entering notes by staff position (click / arrow keys).
     */
    spell(pitch: Pitch): Pitch {
        const alter = this.alterForNote(pitch.name)
        return alter === 0 ? pitch : new Pitch({ name: pitch.name, octave: pitch.octave, alter })
    }

    /**
     * Number of fifths after shifting by the given (chromatic, diatonic) interval.
     * fifthsDelta = 7·chromatic − 12·diatonic — the circle-of-fifths formula (up a M2 adds +2, a P5 +1, an octave 0).
     */
    static transposedFifths(fifths: number, chromatic: number, diatonic: number): number {
        return fifths + (7 * chromatic - 12 * diatonic)
    }
}
