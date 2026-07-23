import { getYForLine } from '@mushee/notation/components'
import { STAVE_LINE_DISTANCE } from '@mushee/notation/components/constants'
import type { ClefType } from '@mushee/notation/components/types'
import { KeySignatureLayout } from '@mushee/notation/model/layout/KeySignatureLayout'
import { Measure } from '@mushee/notation/model/Measure'
import { Score } from '@mushee/notation/model/Score'
import { TimeSignature } from '@mushee/notation/model/TimeSignature'
import { KeySignatureWidth } from '@mushee/notation/model/width/KeySignatureWidth'
import { describe, expect, it } from 'vitest'

const bar = (clef: ClefType, fifths: number) => new Measure(new Score(), clef, new TimeSignature(4, 4), { keyFifths: fifths })

/** Build the layout the way MeasureLayout does: explicit clef + drawn accidentals + width context. */
function layoutFor(m: Measure): KeySignatureLayout {
    const drawnAccidentals = m.keySignature.drawnAccidentals
    return new KeySignatureLayout({ clef: m.clef, drawnAccidentals, width: new KeySignatureWidth(drawnAccidentals) })
}

const TOP = getYForLine(0) // top staff line
const BOTTOM = getYForLine(4) // bottom staff line

describe('KeySignatureLayout', () => {
    it('draws a treble G-major sharp on the top staff line', () => {
        const layout = layoutFor(bar('treble', 1))
        expect(layout.accidentals).toHaveLength(1)
        expect(layout.accidentals[0].y).toBe(TOP) // F# sits on the top line
    })

    it('keeps common-key accidentals on (or one space off) the staff across every clef', () => {
        const clefs: ClefType[] = [
            'treble',
            'bass',
            'alto',
            'tenor',
            'soprano',
            'mezzoSoprano',
            'baritoneF',
            'baritoneC',
            'subBass',
            'treble8va',
            'bass8vb',
        ]
        for (const clef of clefs) {
            for (const fifths of [-4, -3, -2, -1, 1, 2, 3, 4]) {
                for (const a of layoutFor(bar(clef, fifths)).accidentals) {
                    expect(a.y).toBeGreaterThanOrEqual(TOP - STAVE_LINE_DISTANCE)
                    expect(a.y).toBeLessThanOrEqual(BOTTOM + STAVE_LINE_DISTANCE)
                }
            }
        }
    })

    it('does not drop a 7-sharp signature below the staff under the tenor clef (regression)', () => {
        // Anchoring only the first accidental used to push the tail a full line below the bottom staff line.
        for (const a of layoutFor(bar('tenor', 7)).accidentals) {
            expect(a.y).toBeLessThanOrEqual(BOTTOM + STAVE_LINE_DISTANCE)
        }
    })

    it('produces no accidentals (and skips the octave-shift search) for C major with nothing to cancel', () => {
        // fifths 0 with no preceding key → drawnAccidentals is empty → rawLines is empty → the
        // octave-shift loop is skipped entirely and no accidental glyphs are laid out.
        const m = bar('treble', 0)
        expect(m.keySignature.drawnAccidentals).toHaveLength(0)
        expect(layoutFor(m).accidentals).toHaveLength(0)
    })

    it('is reachable through the keySignature.layout delegate for a drawn key in a score', () => {
        const score = new Score()
        // Mark the key explicit so addMeasure's carry-forward doesn't demote it to the inherited C major.
        const measure = new Measure(score, 'treble', new TimeSignature(4, 4), { keyFifths: 2, leadingKeyExplicit: true })
        measure.complete()
        score.addMeasure(undefined, measure)
        const viaDelegate = measure.keySignature.layout
        expect(viaDelegate.accidentals).toHaveLength(2)
        // Same instance on repeated access within one layout snapshot.
        expect(measure.keySignature.layout).toBe(viaDelegate)
    })
})
