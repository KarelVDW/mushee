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

/** The tuplet's layout, as its measure's layout builds it. */
function layoutOf(tuplet: Tuplet): TupletLayout {
    return tuplet.measure.layout.tupletLayoutFor(tuplet)
}

describe('TupletLayout', () => {
    it('runs left to right with the "3" numerator centred between the endpoints', () => {
        const tuplet = tupletOf([tripletNote('8', 'C'), tripletNote('8', 'C'), tripletNote('8', 'C')])
        const layout = layoutOf(tuplet)
        expect(layout.x2).toBeGreaterThan(layout.x1)
        expect(layout.numberGlyphs).toHaveLength(1)
        expect(layout.numberGlyphs[0].glyphName).toBe('timeSig3')
        // The digit is centred between x1 and x2, at the tuplet-number scale.
        const mid = (layout.x1 + layout.x2) / 2
        expect(layout.numberGlyphs[0].x).toBeCloseTo(mid - new DigitRun(3, TUPLET_NUMBER_SCALE).width / 2)
        expect(layout.numberGlyphs[0].scale).toBe(TUPLET_NUMBER_SCALE)
    })

    it('a low (stem-up) triplet brackets above the staff, its ticks hanging down toward the notes', () => {
        // C4 (line 0 < 3) → stems up → bracket placed above (min stem-tip minus offset). Quarters: no beam joins them.
        const notes = [tripletNote('q', 'C'), tripletNote('q', 'C'), tripletNote('q', 'C')]
        const tuplet = tupletOf(notes)
        const layout = layoutOf(tuplet)
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
        const notes = [tripletNote('q', 'A', 5), tripletNote('q', 'A', 5), tripletNote('q', 'A', 5)]
        const tuplet = tupletOf(notes)
        const layout = layoutOf(tuplet)
        expect(notes.every((n) => n.stemDir === 'down')).toBe(true)
        const [leftTick, , , rightTick] = layout.bracket
        expect(leftTick).toMatchObject({ x: layout.x1, y: layout.y - TUPLET_BRACKET_HEIGHT, height: TUPLET_BRACKET_HEIGHT })
        expect(rightTick).toMatchObject({ x: layout.x2, y: layout.y - TUPLET_BRACKET_HEIGHT, height: TUPLET_BRACKET_HEIGHT })
        const stemTips = notes.map((n) => n.layout.stem?.y2 ?? n.layout.noteY)
        expect(layout.y).toBe(Math.max(...stemTips) + TUPLET_OFFSET)
    })

    it('chooses the majority stem direction (down) when more notes point down', () => {
        // Two high (down) notes vs one low (up) note, unbeamed → upCount 1 < 3/2 → group stems down.
        const notes = [tripletNote('q', 'A', 5), tripletNote('q', 'A', 5), tripletNote('q', 'C', 4)]
        const tuplet = tupletOf(notes)
        expect(notes.filter((n) => n.stemDir === 'up')).toHaveLength(1)
        const stemTips = notes.map((n) => n.layout.stem?.y2 ?? n.layout.noteY)
        expect(layoutOf(tuplet).y).toBe(Math.max(...stemTips) + TUPLET_OFFSET) // placed below, like an all-down group
        expect(layoutOf(tuplet).bracket[0].y).toBe(layoutOf(tuplet).y - TUPLET_BRACKET_HEIGHT)
    })

    it('a beamed eighth triplet draws the number only, beyond the beam', () => {
        const notes = [tripletNote('8', 'C'), tripletNote('8', 'C'), tripletNote('8', 'C')]
        const tuplet = tupletOf(notes)
        const beam = notes[0].measure.layout.beamFor(notes[0])
        if (!beam) throw new Error('expected the triplet to be beamed')
        expect(notes.every((n) => n.measure.layout.beamFor(n) === beam)).toBe(true)
        expect(layoutOf(tuplet).bracketed).toBe(false)
        expect(layoutOf(tuplet).bracket).toEqual([])
        expect(layoutOf(tuplet).numberGlyphs).toHaveLength(1) // the number still shows
        // Stems up: the number sits above the beam line, not among the stems.
        expect(layoutOf(tuplet).y).toBeCloseTo(Math.min(beam.primary.y1, beam.primary.y2) - TUPLET_OFFSET)
    })

    it('places the number above the beam when a beam overrides a note’s own stem (C4, C4, C6)', () => {
        // C6 on its own would stem down; under the group's up beam its stem rises to the beam.
        const notes = [tripletNote('8', 'C'), tripletNote('8', 'C'), tripletNote('8', 'C', 6)]
        const tuplet = tupletOf(notes)
        const measureLayout = notes[0].measure.layout
        const beam = measureLayout.beamFor(notes[2])
        if (!beam) throw new Error('expected the triplet to be beamed')
        expect(notes[2].stemDir).toBe('down')
        expect(measureLayout.stemDirFor(notes[2])).toBe('up')
        const beamTop = Math.min(beam.primary.y1, beam.primary.y2)
        expect(layoutOf(tuplet).y).toBeCloseTo(beamTop - TUPLET_OFFSET)
        expect(layoutOf(tuplet).bracketed).toBe(false)
    })

    it('brackets an all-rest triplet: no beam joins it (eighth rests)', () => {
        const notes = [tripletNote('8'), tripletNote('8'), tripletNote('8')]
        const tuplet = tupletOf(notes)
        expect(notes.every((n) => n.measure.layout.beamFor(n) === undefined)).toBe(true)
        expect(layoutOf(tuplet).bracketed).toBe(true)
        expect(layoutOf(tuplet).numberGlyphs).toHaveLength(1)
    })

    it('is bracketed when notes are not beamable (quarter triplet)', () => {
        // Quarter notes are never beamed → nothing joins the group → bracket is drawn.
        const notes = [tripletNote('q', 'C'), tripletNote('q', 'C'), tripletNote('q', 'C')]
        const tuplet = tupletOf(notes)
        expect(notes.every((n) => n.duration.isBeamable)).toBe(false)
        expect(layoutOf(tuplet).bracketed).toBe(true)
    })

    it('falls back to the notehead Y for a stemless note (a rest inside the triplet)', () => {
        // An eighth rest has no stem; the bracket math must use its noteY instead of a stem tip.
        const restNote = tripletNote('8') // no pitch → rest, no stem
        const notes = [restNote, tripletNote('8', 'C'), tripletNote('8', 'C')]
        const tuplet = tupletOf(notes)
        expect(restNote.layout.stem).toBeUndefined()
        const stemTips = notes.map((n) => n.layout.stem?.y2 ?? n.layout.noteY)
        // The stem-up group anchors the bracket to the minimum tip, which includes the rest's noteY.
        expect(layoutOf(tuplet).y).toBe(Math.min(...stemTips) - TUPLET_OFFSET)
    })

    it('opens the bracket around a multi-digit number: a 12-tuplet line clears both digits', () => {
        const twelfth = () =>
            new Note({
                duration: new Duration({ type: '16', ratio: { actualNotes: 12, normalNotes: 8 } }),
                pitch: new Pitch({ name: 'C', octave: 4 }),
            })
        // A rest mid-group splits the beam, so the group is bracketed.
        const rest16 = new Note({ duration: new Duration({ type: '16', ratio: { actualNotes: 12, normalNotes: 8 } }) })
        const tuplet = tupletOf(Array.from({ length: 12 }, (_, i) => (i === 5 ? rest16 : twelfth())))
        expect(layoutOf(tuplet).bracketed).toBe(true)
        const layout = layoutOf(tuplet)
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
        const layout = new TupletLayout(tuplet, {
            xOf: () => 0,
            layoutOf: (n) => n.layout,
            stemOf: (n) => n.layout.stem,
            stemDirOf: (n) => n.stemDir,
            beamOf: () => undefined,
        })
        expect(layout.bracket).toHaveLength(2) // the two ticks only
        expect(layout.bracket.every((rect) => rect.height === TUPLET_BRACKET_HEIGHT)).toBe(true)
    })
})
