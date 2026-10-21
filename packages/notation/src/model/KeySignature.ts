import type { KeySignatureLayout } from './layout/KeySignatureLayout'
import type { Measure } from './Measure'
import { Pitch, type PitchStep } from './Pitch'

/** Order of sharps and flats in key signatures */
const SHARP_ORDER: readonly PitchStep[] = ['F', 'C', 'G', 'D', 'A', 'E', 'B']
const FLAT_ORDER: readonly PitchStep[] = ['B', 'E', 'A', 'D', 'G', 'C', 'F']

/**
 * Canonical pitch (name + octave) each sharp/flat occupies in a treble-clef key signature.
 * KeySignatureLayout positions them via the active clef and normalizes by octaves into the staff.
 */
const SHARP_PITCHES: ReadonlyArray<{ name: PitchStep; octave: number }> = [
    { name: 'F', octave: 5 },
    { name: 'C', octave: 5 },
    { name: 'G', octave: 5 },
    { name: 'D', octave: 5 },
    { name: 'A', octave: 4 },
    { name: 'E', octave: 5 },
    { name: 'B', octave: 4 },
]
const FLAT_PITCHES: ReadonlyArray<{ name: PitchStep; octave: number }> = [
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
    name: PitchStep
    octave: number
}

/**
 * A key signature anchored in a measure, like a {@link Clef}: the leading key sits at beat 0,
 * further ones are mid-measure changes. A key's identity is (fifths, mode) — see
 * {@link sameKeyAs}: C major and A minor share fifths 0 yet are different keys to propagation,
 * redundancy checks and serialization. Only `fifths` (positive = sharps, negative = flats)
 * shapes accidentals and rendering. Its drawn form (cancellation naturals) depends on the
 * *preceding* key, so its layout is context-dependent and lives in the layout layer (delegated below).
 */
export class KeySignature {
    readonly id = crypto.randomUUID()

    constructor(
        readonly measure: Measure,
        readonly beatPosition: number,
        readonly fifths: number,
        readonly mode?: string,
    ) {}

    /** Delegates into the current ScoreLayout — context-dependent, never cached here. */
    get layout(): KeySignatureLayout {
        return this.measure.layout.keyLayoutFor(this)
    }

    /** Whether this is the key (fifths, mode) — a key's identity, mode included. */
    sameKeyAs(fifths: number, mode?: string): boolean {
        return KeySignature.same(this, fifths, mode)
    }

    /**
     * {@link sameKeyAs} for a key that may be absent or a plain `{ fifths, mode }` value: no key
     * at all is C major with no mode — what a score assumes before its first key signature.
     */
    static same(key: { fifths: number; mode?: string } | undefined, fifths: number, mode?: string): boolean {
        return (key?.fifths ?? 0) === fifths && key?.mode === mode
    }

    /** Fifths of the key in effect immediately before this one — the previous measure's last key, or the key earlier in this measure. */
    get precedingFifths(): number {
        if (this.beatPosition > 0) return this.measure.keyBefore(this.beatPosition).fifths
        return this.measure.getPrevious()?.lastKey.fifths ?? 0
    }

    /** Note names that are sharp in this key */
    get sharps(): PitchStep[] {
        if (this.fifths <= 0) return []
        return SHARP_ORDER.slice(0, this.fifths)
    }

    /** Note names that are flat in this key */
    get flats(): PitchStep[] {
        if (this.fifths >= 0) return []
        return FLAT_ORDER.slice(0, -this.fifths)
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
    alterForNote(noteName: PitchStep): number {
        return KeySignature.alterInKey(this.fifths, noteName)
    }

    /** Semitone alteration a key of `fifths` applies to a note name — {@link alterForNote} without an instance. */
    static alterInKey(fifths: number, noteName: PitchStep): number {
        if (fifths > 0 && SHARP_ORDER.indexOf(noteName) < fifths) return 1
        if (fifths < 0 && FLAT_ORDER.indexOf(noteName) < -fifths) return -1
        return 0
    }

    /**
     * Spell a (line-derived, natural) pitch according to this key — e.g. an F entered in G major becomes
     * F♯. Only the alteration is set: whether an accidental is drawn is decided later, in context, by the
     * layout layer (here none, as the key implies it). Used when entering notes by staff position (click / arrow keys).
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

    /**
     * Fold a fifths count into the drawable −7..7 range by swapping to the enharmonic key
     * (twelve fifths away, e.g. G♯ major +8 → A♭ major −4). Values already in range are
     * kept — even where an enharmonic partner would be simpler; picking the *nicest* key is
     * the accidental minimizer's job, this only repairs overflow from a transposition.
     */
    static normalizedFifths(fifths: number): number {
        let result = fifths
        while (result > 7) result -= 12
        while (result < -7) result += 12
        return result
    }
}
