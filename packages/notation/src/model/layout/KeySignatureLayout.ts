import { getGlyphWidth, getYForNote } from '../../components'
import type { Clef } from '../Clef'
import type { KeyAccidental } from '../KeySignature'
import { Pitch } from '../Pitch'
import type { KeySignatureWidth } from '../width/KeySignatureWidth'

/** One octave in staff-line units (7 diatonic steps ÷ 2). */
const OCTAVE_LINES = 3.5
/** Horizontal gap between adjacent accidentals (matches KeySignatureWidth). */
const ACCIDENTAL_GAP = 2

/**
 * Positions a key signature's drawn accidentals on the staff. Context — the
 * clef in effect, the contextual drawn accidentals (incl. cancellation
 * naturals), and the computed width — is passed in by the layout layer.
 */
export class KeySignatureLayout {
    readonly id = crypto.randomUUID()
    readonly accidentals: { glyphName: string; x: number; y: number }[]

    constructor(context: { clef: Clef; drawnAccidentals: KeyAccidental[]; width: KeySignatureWidth }) {
        // Position each accidental on the line of the note it alters, under the clef in effect at this key's beat.
        const items = context.drawnAccidentals
        const rawLines = items.map((a) => context.clef.lineFor(new Pitch({ name: a.name, octave: a.octave })))

        // Shift the whole accidental block by whole octaves so it sits on the staff (lines 1–5). Anchoring
        // only the first accidental lets the zig-zag tail fall off-staff under tenor/C clefs, so instead
        // pick the octave shift whose [min, max] span pokes least outside the staff (preferring higher on a tie,
        // matching the convention of the first accidental sitting near the top). Treble needs no shift.
        let shift = 0
        if (rawLines.length > 0) {
            const min = Math.min(...rawLines)
            const max = Math.max(...rawLines)
            let bestOverflow = Infinity
            for (let k = 4; k >= -4; k--) {
                const s = k * OCTAVE_LINES
                const overflow = Math.max(0, max + s - 5) + Math.max(0, 1 - (min + s))
                if (overflow < bestOverflow) {
                    bestOverflow = overflow
                    shift = s
                }
            }
        }

        let x = context.width.paddingLeft
        this.accidentals = items.map((a, i) => {
            const glyphX = x
            x += getGlyphWidth(a.glyphName) + ACCIDENTAL_GAP
            return { glyphName: a.glyphName, x: glyphX, y: getYForNote(rawLines[i] + shift) }
        })
    }
}
