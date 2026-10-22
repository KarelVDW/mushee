import type { GlyphName } from '../../engraving/Bravura'
import type { Measure } from '../Measure'
import type { Note } from '../Note'
import { Pitch } from '../Pitch'
import { CarriedAccidentals } from '../util/CarriedAccidentals'

/**
 * Resolves which accidental glyph each note in a measure actually draws — a
 * presentation decision (the semantic alteration lives on the pitch). A note
 * shows an accidental when its alteration differs from what is currently in
 * effect for its pitch: the key signature, overridden by any earlier
 * accidental on the same (name, octave) in the bar ({@link CarriedAccidentals},
 * the rule the accidental minimizer counts by). A mid-measure key change
 * resets the carried accidentals.
 */
export class DisplayedAccidentals {
    readonly byNote: Map<Note, GlyphName | undefined>

    constructor(measure: Measure) {
        const result = new Map<Note, GlyphName | undefined>()
        const carried = new CarriedAccidentals(measure.keySignature.fifths)
        for (const note of measure.notes) {
            if (!note.pitch) {
                result.set(note, undefined)
                continue
            }
            const fifths = measure.keyAtOrBefore(measure.beatOffsetOf(note)).fifths
            if (fifths !== carried.fifths) carried.reset(fifths) // a new key signature cancels carried accidentals
            if (carried.draws(note.pitch)) {
                result.set(note, Pitch.glyphForAlter(note.pitch.alter))
                carried.record(note.pitch)
            } else {
                result.set(note, undefined)
            }
        }
        this.byNote = result
    }
}
