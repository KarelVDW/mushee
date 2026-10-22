import {
    TUPLET_BRACKET_HEIGHT,
    TUPLET_BRACKET_THICKNESS,
    TUPLET_NUMBER_CLEARANCE,
    TUPLET_NUMBER_SCALE,
    TUPLET_OFFSET,
} from '@mushee/notation/engraving/constants'
import { Duration } from '@mushee/notation/model/Duration'
import { DigitRun } from '@mushee/notation/model/layout/DigitRun'
import { TupletLayout } from '@mushee/notation/model/layout/TupletLayout'
import { Note } from '@mushee/notation/model/Note'
import { Pitch, type PitchStep } from '@mushee/notation/model/Pitch'
import { Score } from '@mushee/notation/model/Score'
import type { Tuplet } from '@mushee/notation/model/Tuplet'
import { describe, expect, it } from 'vitest'

const TRIPLET = { actualNotes: 3, normalNotes: 2 }

/** A note in a 3:2 triplet of the given type, pitched (or a rest when name is omitted). */
function tripletNote(type: '8' | 'q', name?: PitchStep, octave = 4): Note {
    return new Note({
        duration: new Duration({ type, ratio: TRIPLET }),
        pitch: name ? new Pitch({ name, octave }) : undefined,
    })
}

/** Build a one-measure score holding the given triplet notes and return the discovered tuplet. */
function tupletOf(notes: Note[]): Tuplet {
    const score = new Score()
    const m = score.addMeasure()
    m.addNotes(notes)
    const tuplet = m.tuplets[0]
    if (!tuplet) throw new Error('expected a tuplet')
    return tuplet
}

describe('TupletLayout', () => {
    it('runs left to right with the "3" numerator centred between the endpoints', () => {
        const tuplet = tupletOf([tripletNote('8', 'C'), tripletNote('8', 'C'), tripletNote('8', 'C')])
        const layout = tuplet.layout
        expect(layout.x2).toBeGreaterThan(layout.x1)
        expect(layout.numberGlyphs).toHaveLength(1)
        expect(layout.numberGlyphs[0].glyphName).toBe('timeSig3')
        // The digit is centred between x1 and x2, at the tuplet-number scale.
        const mid = (layout.x1 + layout.x2) / 2
        expect(layout.numberGlyphs[0].x).toBeCloseTo(mid - new DigitRun(3, TUPLET_NUMBER_SCALE).width / 2)
        expect(layout.numberGlyphs[0].scale).toBe(TUPLET_NUMBER_SCALE)
    })

    it('a low (stem-up) triplet brackets above the staff, its ticks hanging down toward the notes', () => {
        // C4 (line 0 < 3) → stems up → bracket placed above (min stem-tip minus offset).
        const notes = [tripletNote('8', 'C'), tripletNote('8', 'C'), tripletNote('8', 'C')]
        const tuplet = tupletOf(notes)
        const layout = tuplet.layout
        const [leftTick, leftLine, rightLine, rightTick] = layout.bracket
        expect(layout.bracket).toHaveLength(4)
        expect(leftTick).toEqual({ x: layout.x1, y: layout.y, width: TUPLET_BRACKET_THICKNESS, height: TUPLET_BRACKET_HEIGHT })
        expect(rightTick).toEqual({ x: layout.x2, y: layout.y, width: TUPLET_BRACKET_THICKNESS, height: TUPLET_BRACKET_HEIGHT })
        // The line runs from tick to tick at the bracket's y, split around the number.
        expect(leftLine).toMatchObject({ x: layout.x1, y: layout.y, height: TUPLET_BRACKET_THICKNESS })
        expect(rightLine.x + rightLine.width).toBeCloseTo(layout.x2)
        expect(rightLine.y).toBe(layout.y)
        const stemTips = notes.map((n) => n.layout.stem?.y2 ?? n.layout.noteY)
        expect(layout.y).toBe(Math.min(...stemTips) - TUPLET_OFFSET)
        expect(layout.numberGlyphs[0].y).toBe(layout.y)
    })

    it('a high (stem-down) triplet brackets below the staff, its ticks rising toward the notes', () => {
        // A5 (line 5.5 >= 3) → stems down → bracket placed below (max stem-tip plus offset).
        const notes = [tripletNote('8', 'A', 5), tripletNote('8', 'A', 5), tripletNote('8', 'A', 5)]
        const tuplet = tupletOf(notes)
        const layout = tuplet.layout
        expect(notes.every((n) => n.stemDir === 'down')).toBe(true)
        const [leftTick, , , rightTick] = layout.bracket
        expect(leftTick).toMatchObject({ x: layout.x1, y: layout.y - TUPLET_BRACKET_HEIGHT, height: TUPLET_BRACKET_HEIGHT })
        expect(rightTick).toMatchObject({ x: layout.x2, y: layout.y - TUPLET_BRACKET_HEIGHT, height: TUPLET_BRACKET_HEIGHT })
        const stemTips = notes.map((n) => n.layout.stem?.y2 ?? n.layout.noteY)
        expect(layout.y).toBe(Math.max(...stemTips) + TUPLET_OFFSET)
    })

    it('chooses the majority stem direction (down) when more notes point down', () => {
        // Two high (down) notes vs one low (up) note → upCount 1 < 3/2 → group stems down.
        const notes = [tripletNote('8', 'A', 5), tripletNote('8', 'A', 5), tripletNote('8', 'C', 4)]
        const tuplet = tupletOf(notes)
        expect(notes.filter((n) => n.stemDir === 'up')).toHaveLength(1)
        const stemTips = notes.map((n) => n.layout.stem?.y2 ?? n.layout.noteY)
        expect(tuplet.layout.y).toBe(Math.max(...stemTips) + TUPLET_OFFSET) // placed below, like an all-down group
        expect(tuplet.layout.bracket[0].y).toBe(tuplet.layout.y - TUPLET_BRACKET_HEIGHT)
    })

    it('is not bracketed when every note is a flagless beamable note (all eighth rests)', () => {
        // Eighth rests are beamable yet draw no flag, so an all-rest triplet needs no bracket.
        const notes = [tripletNote('8'), tripletNote('8'), tripletNote('8')]
        const tuplet = tupletOf(notes)
        expect(notes.every((n) => n.layout.flag === undefined && n.duration.isBeamable)).toBe(true)
        expect(tuplet.layout.bracketed).toBe(false)
        expect(tuplet.layout.bracket).toEqual([])
        expect(tuplet.layout.numberGlyphs).toHaveLength(1) // the number still shows
    })

    it('is bracketed when notes are not beamable (quarter triplet)', () => {
        // Quarter notes are not beamable → the all-beamed condition fails → bracket is drawn.
        const notes = [tripletNote('q', 'C'), tripletNote('q', 'C'), tripletNote('q', 'C')]
        const tuplet = tupletOf(notes)
        expect(notes.every((n) => n.duration.isBeamable)).toBe(false)
        expect(tuplet.layout.bracketed).toBe(true)
    })

    it('falls back to the notehead Y for a stemless note (a rest inside the triplet)', () => {
        // An eighth rest has no stem; the bracket math must use its noteY instead of a stem tip.
        const restNote = tripletNote('8') // no pitch → rest, no stem
        const notes = [restNote, tripletNote('8', 'C'), tripletNote('8', 'C')]
        const tuplet = tupletOf(notes)
        expect(restNote.layout.stem).toBeUndefined()
        const stemTips = notes.map((n) => n.layout.stem?.y2 ?? n.layout.noteY)
        // The stem-up group anchors the bracket to the minimum tip, which includes the rest's noteY.
        expect(tuplet.layout.y).toBe(Math.min(...stemTips) - TUPLET_OFFSET)
    })

    it('opens the bracket around a multi-digit number: a 12-tuplet line clears both digits', () => {
        const twelfth = () =>
            new Note({ duration: new Duration({ type: '16', ratio: { actualNotes: 12, normalNotes: 8 } }), pitch: new Pitch({ name: 'C', octave: 4 }) })
        const tuplet = tupletOf(Array.from({ length: 12 }, twelfth))
        const layout = tuplet.layout
        expect(layout.numberGlyphs.map((g) => g.glyphName)).toEqual(['timeSig1', 'timeSig2'])
        const [, leftLine, rightLine] = layout.bracket
        const numberWidth = new DigitRun(12, TUPLET_NUMBER_SCALE).width
        const numberStart = layout.numberGlyphs[0].x
        const numberEnd = numberStart + numberWidth
        expect(leftLine.x + leftLine.width).toBeCloseTo(numberStart - TUPLET_NUMBER_CLEARANCE)
        expect(rightLine.x).toBeCloseTo(numberEnd + TUPLET_NUMBER_CLEARANCE)
        expect(leftLine.x + leftLine.width).toBeLessThan(numberStart)
        expect(rightLine.x).toBeGreaterThan(numberEnd)
    })

    it('leaves out a line half too short to draw beside the number (direct construction)', () => {
        // Every member placed at x 0: the span is one notehead, narrower than the number plus its clearance.
        const notes = [tripletNote('q', 'C'), tripletNote('q', 'C'), tripletNote('q', 'C')]
        const tuplet = tupletOf(notes)
        const layout = new TupletLayout(tuplet, { xOf: () => 0, layoutOf: (n) => n.layout })
        expect(layout.bracket).toHaveLength(2) // the two ticks only
        expect(layout.bracket.every((rect) => rect.height === TUPLET_BRACKET_HEIGHT)).toBe(true)
    })
})
