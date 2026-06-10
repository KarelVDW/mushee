import { describe, expect, it } from 'vitest'

import { getYForLine } from '@/components/notation'
import { STAVE_LINE_DISTANCE } from '@/components/notation/constants'
import type { ClefType } from '@/components/notation/types'
import { Measure } from '@/model/Measure'
import { Score } from '@/model/Score'
import { TimeSignature } from '@/model/TimeSignature'

const bar = (clef: ClefType, fifths: number) => new Measure(new Score(), clef, new TimeSignature(4, 4), { keyFifths: fifths })

const TOP = getYForLine(0) // top staff line
const BOTTOM = getYForLine(4) // bottom staff line

describe('KeySignatureLayout', () => {
    it('draws a treble G-major sharp on the top staff line', () => {
        const m = bar('treble', 1)
        expect(m.keySignature.layout.accidentals).toHaveLength(1)
        expect(m.keySignature.layout.accidentals[0].y).toBe(TOP) // F# sits on the top line
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
                for (const a of bar(clef, fifths).keySignature.layout.accidentals) {
                    expect(a.y).toBeGreaterThanOrEqual(TOP - STAVE_LINE_DISTANCE)
                    expect(a.y).toBeLessThanOrEqual(BOTTOM + STAVE_LINE_DISTANCE)
                }
            }
        }
    })

    it('does not drop a 7-sharp signature below the staff under the tenor clef (regression)', () => {
        // Anchoring only the first accidental used to push the tail a full line below the bottom staff line.
        for (const a of bar('tenor', 7).keySignature.layout.accidentals) {
            expect(a.y).toBeLessThanOrEqual(BOTTOM + STAVE_LINE_DISTANCE)
        }
    })

    it('produces no accidentals (and skips the octave-shift search) for C major with nothing to cancel', () => {
        // fifths 0 with no preceding key → drawnAccidentals is empty → rawLines is empty → the
        // octave-shift loop is skipped entirely and no accidental glyphs are laid out.
        const m = bar('treble', 0)
        expect(m.keySignature.drawnAccidentals).toHaveLength(0)
        expect(m.keySignature.layout.accidentals).toHaveLength(0)
    })
})
