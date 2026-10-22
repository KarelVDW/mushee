import { STAVE_LINE_DISTANCE } from '@mushee/notation/engraving/constants'
import { KeySignatureLayout } from '@mushee/notation/model/layout/KeySignatureLayout'
import { KeySignatureWidth } from '@mushee/notation/model/layout/KeySignatureWidth'
import { Staff } from '@mushee/notation/model/layout/Staff'
import { Measure } from '@mushee/notation/model/Measure'
import { Score } from '@mushee/notation/model/Score'
import { TimeSignature } from '@mushee/notation/model/TimeSignature'
import type { ClefType } from '@mushee/notation/model/types'
import { key, makeScore } from '@mushee/notation/testing'
import { describe, expect, it } from 'vitest'

const bar = (clef: ClefType, fifths: number) => new Measure(new Score(), clef, new TimeSignature(4, 4), { keyFifths: fifths })

/** Build the layout the way MeasureLayout does: explicit clef + drawn accidentals + width context. */
function layoutFor(m: Measure): KeySignatureLayout {
    const drawnAccidentals = KeySignatureLayout.drawnAccidentalsFor(m.keySignature)
    return new KeySignatureLayout({ clef: m.clef, width: new KeySignatureWidth(drawnAccidentals) })
}

const TOP = Staff.yForStaffLine(0) // top staff line
const BOTTOM = Staff.yForStaffLine(4) // bottom staff line

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
        expect(KeySignatureLayout.drawnAccidentalsFor(m.keySignature)).toHaveLength(0)
        expect(layoutFor(m).accidentals).toHaveLength(0)
    })

    it('is reachable through the keySignature.layout delegate for a drawn key in a score', () => {
        const score = new Score()
        // Mark the key explicit so addMeasure's carry-forward doesn't demote it to the inherited C major.
        const measure = new Measure(score, 'treble', new TimeSignature(4, 4), { keyFifths: 2, leadingKeyExplicit: true })
        measure.complete()
        score.appendMeasure(measure)
        const viaDelegate = measure.keySignature.layout
        expect(viaDelegate.accidentals).toHaveLength(2)
        // Same instance on repeated access within one layout snapshot.
        expect(measure.keySignature.layout).toBe(viaDelegate)
    })

    describe('drawnAccidentalsFor (context-aware)', () => {
        const glyphsAndNames = (accidentals: ReturnType<typeof KeySignatureLayout.drawnAccidentalsFor>) =>
            accidentals.map((a) => [a.glyphName, a.name])

        it('a non-C key draws its own accidentals', () => {
            expect(KeySignatureLayout.drawnAccidentalsFor(key(2)).map((a) => a.glyphName)).toEqual(['accidentalSharp', 'accidentalSharp'])
        })

        it('C major with nothing before it draws nothing (the first measure has nothing carrying in)', () => {
            expect(KeySignatureLayout.drawnAccidentalsFor(key(0))).toEqual([])
            expect(KeySignatureLayout.drawnAccidentalsFor(makeScore(1).measures[0].keySignature)).toEqual([])
        })

        it('a switch to C major draws one cancellation natural per accidental of the previous measure’s last key', () => {
            const score = makeScore(2)
            score.setKeySignature(score.measures[0].firstNote, -2) // B♭ major (B♭, E♭)
            score.setKeySignature(score.measures[1].firstNote, 0) // back to C major
            expect(glyphsAndNames(KeySignatureLayout.drawnAccidentalsFor(score.measures[1].keySignature))).toEqual([
                ['accidentalNatural', 'B'],
                ['accidentalNatural', 'E'],
            ])
        })

        it('a mid-measure switch to C major cancels the key earlier in the same measure', () => {
            const score = makeScore(1)
            const m = score.measures[0]
            score.setKeySignature(m.firstNote, 2) // leading D major (F♯, C♯)
            score.setKeySignature(m.noteAtBeat(2), 0) // mid-measure C major
            const midKey = m.keyAtBeat(2)
            if (!midKey) throw new Error('expected mid-measure key')
            expect(glyphsAndNames(KeySignatureLayout.drawnAccidentalsFor(midKey))).toEqual([
                ['accidentalNatural', 'F'],
                ['accidentalNatural', 'C'],
            ])
        })
    })
})
