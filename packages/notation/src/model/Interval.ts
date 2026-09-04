/** Interval qualities: perfect-class degrees (1, 4, 5, 8) take perfect; the others major/minor. */
export type IntervalQuality = 'perfect' | 'major' | 'minor' | 'augmented' | 'diminished'

/** Semitone size of the perfect/major interval for each degree 1..8. */
const BASE_SEMITONES = [0, 2, 4, 5, 7, 9, 11, 12] as const

/** Degrees whose plain quality is perfect (their major/minor variants don't exist). */
const PERFECT_DEGREES = new Set([1, 4, 5, 8])

/**
 * A musical interval as a (chromatic, diatonic) pair — the exact convention
 * {@link Pitch.transposed} and {@link KeySignature.transposedFifths} consume: chromatic is
 * the signed distance in semitones, diatonic the signed distance in letter steps (C → E =
 * +2). An immutable value object (tier 1); the constructors below cover the three ways the
 * editor lets a user name a transposition.
 */
export class Interval {
    constructor(
        readonly chromatic: number,
        readonly diatonic: number,
    ) {}

    /** Whether this interval moves nothing (a plain unison — no transposition to apply). */
    get isUnison(): boolean {
        return this.chromatic === 0 && this.diatonic === 0
    }

    /**
     * Build from named parts: a degree 1..8, its quality, extra whole octaves, and a
     * direction (+1 up, −1 down). Throws on a quality the degree doesn't have (perfect
     * third, major fifth) — the UI constrains its options to the degree's valid set.
     */
    static fromParts(degree: number, quality: IntervalQuality, octaves = 0, direction: 1 | -1 = 1): Interval {
        if (!Number.isInteger(degree) || degree < 1 || degree > 8) throw new Error(`Interval degree out of range: ${degree}`)
        const perfectClass = PERFECT_DEGREES.has(degree)
        if (quality === 'perfect' && !perfectClass) throw new Error(`Degree ${degree} has no perfect quality`)
        if ((quality === 'major' || quality === 'minor') && perfectClass) throw new Error(`Degree ${degree} has no ${quality} quality`)
        const adjust = quality === 'augmented' ? 1 : quality === 'diminished' ? (perfectClass ? -1 : -2) : quality === 'minor' ? -1 : 0
        const chromatic = BASE_SEMITONES[degree - 1] + adjust + octaves * 12
        const diatonic = degree - 1 + octaves * 7
        return new Interval(direction * chromatic, direction * diatonic)
    }

    /**
     * Build from a bare semitone count, choosing the letter distance that lands nearest on
     * the circle of fifths (m2 for one semitone, not an augmented unison) — the spelling a
     * later minimize-accidentals pass would pick anyway.
     */
    static fromSemitones(semitones: number): Interval {
        return new Interval(semitones, Math.round((semitones * 7) / 12))
    }

    /**
     * The interval from one key's tonic to another's, as fifths on the circle (+1 = one
     * fifth sharper), forced `up` (within the octave above) or `down` (the octave below).
     * Keys with the same tonic pitch — equal, or enharmonic pairs twelve fifths apart like
     * D♭/C♯ — give a unison: there is no distance to move.
     */
    static betweenKeys(fromFifths: number, toFifths: number, direction: 1 | -1): Interval {
        const delta = toFifths - fromFifths
        if (delta % 12 === 0) return new Interval(0, 0)
        // Tonic distance on the circle: each fifth is +7 semitones / +4 letter steps, folded
        // into one octave upward, then shifted down an octave for a downward transposition.
        const chromaticUp = (((delta * 7) % 12) + 12) % 12
        const diatonicUp = (((delta * 4) % 7) + 7) % 7
        return direction > 0 ? new Interval(chromaticUp, diatonicUp) : new Interval(chromaticUp - 12, diatonicUp - 7)
    }
}
