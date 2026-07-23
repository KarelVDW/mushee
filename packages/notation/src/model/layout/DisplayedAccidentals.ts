import type { Measure } from '../Measure'
import type { Note } from '../Note'
import { Pitch } from '../Pitch'

/**
 * Resolves which accidental glyph each note in a measure actually draws — a
 * presentation decision (the semantic alteration lives on the pitch). A note
 * shows an accidental when its alteration differs from what is currently in
 * effect for its pitch: the key signature, overridden by any earlier
 * accidental on the same (name, octave) in the bar. A mid-measure key change
 * resets the carried accidentals.
 */
export class DisplayedAccidentals {
    readonly byNote: Map<Note, string | undefined>

    constructor(measure: Measure) {
        const result = new Map<Note, string | undefined>()
        const inEffect = new Map<string, number>() // "name+octave" -> alteration currently sounding in the bar
        let keyFifths = measure.keySignature.fifths
        for (const note of measure.notes) {
            if (!note.pitch) {
                result.set(note, undefined)
                continue
            }
            const key = measure.keyAtOrBefore(measure.beatOffsetOf(note))
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
        this.byNote = result
    }
}
