import { KeySignature } from '../KeySignature'
import type { Pitch, PitchStep } from '../Pitch'

/**
 * The bar's accidental-carry rule, written once for the engraver (`DisplayedAccidentals`)
 * and the speller (`AccidentalMinimizer`), so what the speller counts is what gets drawn.
 * A pitch draws an accidental when its alteration differs from the one prevailing on its
 * (name, octave): the last one recorded in the bar, else the key signature's. A bar line
 * starts a fresh instance; a key change resets it.
 */
export class CarriedAccidentals {
    /** "name+octave" → the alteration last written on that line in the bar. */
    private readonly carried = new Map<string, number>()

    constructor(private _fifths: number) {}

    /** The key (fifths) the carried accidentals are read against. */
    get fifths(): number {
        return this._fifths
    }

    /** Enter a new key: it cancels every carried accidental. */
    reset(fifths: number): void {
        this._fifths = fifths
        this.carried.clear()
    }

    /** The alteration in effect for `name` at `octave`: the carried one, else the key's. */
    prevailing(name: PitchStep, octave: number): number {
        return this.carried.get(name + octave) ?? KeySignature.alterInKey(this._fifths, name)
    }

    /** Whether writing `pitch` here takes an accidental. */
    draws(pitch: Pitch): boolean {
        return pitch.alter !== this.prevailing(pitch.name, pitch.octave)
    }

    /** Note `pitch` as written: its alteration now carries on its (name, octave) for the rest of the bar. */
    record(pitch: Pitch): void {
        this.carried.set(pitch.name + pitch.octave, pitch.alter)
    }
}
