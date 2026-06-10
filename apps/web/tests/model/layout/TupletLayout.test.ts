import { describe, expect, it } from 'vitest'

import { TUPLET_OFFSET } from '@/components/notation/constants'
import { Duration } from '@/model/Duration'
import { Note } from '@/model/Note'
import { Pitch } from '@/model/Pitch'
import { Score } from '@/model/Score'
import type { Tuplet } from '@/model/Tuplet'

const TRIPLET = { actualNotes: 3, normalNotes: 2 }

/** A note in a 3:2 triplet of the given type, pitched (or a rest when name is omitted). */
function tripletNote(type: '8' | 'q', name?: string, octave = 4): Note {
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
        // The single digit sits roughly centred between x1 and x2.
        const mid = (layout.x1 + layout.x2) / 2
        expect(layout.numberGlyphs[0].x).toBeLessThan(mid)
    })

    it('a low (stem-up) triplet brackets above the staff with location 1', () => {
        // C4 (line 0 < 3) → stems up → bracket placed above (min stem-tip minus offset).
        const notes = [tripletNote('8', 'C'), tripletNote('8', 'C'), tripletNote('8', 'C')]
        const tuplet = tupletOf(notes)
        const layout = tuplet.layout
        expect(layout.location).toBe(1)
        const stemTips = notes.map((n) => n.layout.stem?.y2 ?? n.layout.noteY)
        expect(layout.y).toBe(Math.min(...stemTips) - TUPLET_OFFSET)
        expect(layout.numberGlyphs[0].y).toBe(layout.y)
    })

    it('a high (stem-down) triplet brackets below the staff with location -1', () => {
        // A5 (line 5.5 >= 3) → stems down → bracket placed below (max stem-tip plus offset).
        const notes = [tripletNote('8', 'A', 5), tripletNote('8', 'A', 5), tripletNote('8', 'A', 5)]
        const tuplet = tupletOf(notes)
        const layout = tuplet.layout
        expect(notes.every((n) => n.stemDir === 'down')).toBe(true)
        expect(layout.location).toBe(-1)
        const stemTips = notes.map((n) => n.layout.stem?.y2 ?? n.layout.noteY)
        expect(layout.y).toBe(Math.max(...stemTips) + TUPLET_OFFSET)
    })

    it('chooses the majority stem direction (down) when more notes point down', () => {
        // Two high (down) notes vs one low (up) note → upCount 1 < 3/2 → group stems down.
        const notes = [tripletNote('8', 'A', 5), tripletNote('8', 'A', 5), tripletNote('8', 'C', 4)]
        const tuplet = tupletOf(notes)
        expect(notes.filter((n) => n.stemDir === 'up')).toHaveLength(1)
        expect(tuplet.layout.location).toBe(-1)
    })

    it('is not bracketed when every note is a flagless beamable note (all eighth rests)', () => {
        // Eighth rests are beamable yet draw no flag, so an all-rest triplet needs no bracket.
        const notes = [tripletNote('8'), tripletNote('8'), tripletNote('8')]
        const tuplet = tupletOf(notes)
        expect(notes.every((n) => n.layout.flag === undefined && n.duration.isBeamable)).toBe(true)
        expect(tuplet.layout.bracketed).toBe(false)
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
})
