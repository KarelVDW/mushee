import { BEAM_LEVEL_STRIDE, BEAM_MAX_SLOPE, BEAM_WIDTH, PARTIAL_BEAM_LENGTH } from '@mushee/notation/components/constants'
import { Duration } from '@mushee/notation/model/Duration'
import { Note } from '@mushee/notation/model/Note'
import { Pitch } from '@mushee/notation/model/Pitch'
import { Score } from '@mushee/notation/model/Score'
import { describe, expect, it } from 'vitest'

/** An eighth note at the given pitch (used to form beam groups). */
const eighth = (name = 'C', octave = 4) => new Note({ duration: new Duration({ type: '8' }), pitch: new Pitch({ name, octave }) })

/** A sixteenth note at the given pitch (forms secondary beams). */
const sixteenth = (name = 'C', octave = 4) => new Note({ duration: new Duration({ type: '16' }), pitch: new Pitch({ name, octave }) })

/** Build a fresh single-measure score, add the notes, and return the (single) beam plus its members. */
function beamFrom(notes: Note[]) {
    const score = new Score()
    const measure = score.addMeasure()
    measure.addNotes(notes)
    const beam = measure.layout.beams[0]
    if (!beam) throw new Error('expected a beam to form')
    return { score, measure, beam }
}

describe('BeamLayout', () => {
    it('builds a primary beam with positive thickness for an upward (low) beam', () => {
        // Two low eighths (C4, line 0) → stems up.
        const { beam } = beamFrom([eighth('C', 4), eighth('C', 4)])
        expect(beam.stemDir).toBe('up')

        const { primary } = beam
        // x2 is to the right of x1: the beam spans from first to last stem.
        expect(primary.x2).toBeGreaterThan(primary.x1)
        // Up-stem beams carry positive thickness (dirSign = +1).
        expect(primary.thickness).toBe(BEAM_WIDTH)
    })

    it('builds a primary beam with negative thickness for a downward (high) beam', () => {
        // Two high eighths (E5, line 4) → stems down.
        const { beam } = beamFrom([eighth('E', 5), eighth('E', 5)])
        expect(beam.stemDir).toBe('down')

        const { primary } = beam
        expect(primary.x2).toBeGreaterThan(primary.x1)
        // Down-stem beams carry negative thickness (dirSign = -1).
        expect(primary.thickness).toBe(-BEAM_WIDTH)
    })

    it('primary beam x endpoints match the first/last stem x positions', () => {
        const { measure, beam } = beamFrom([eighth('C', 4), eighth('C', 4)])
        const { primary } = beam

        const first = beam.firstNote
        const last = beam.lastNote
        const firstStem = first.layout.getStem(beam.stemDir)
        const lastStem = last.layout.getStem(beam.stemDir)
        if (!firstStem || !lastStem) throw new Error('expected stems')

        const expectedX1 = measure.layout.getXForElement(first) + firstStem.x
        const expectedX2 = measure.layout.getXForElement(last) + lastStem.x
        expect(primary.x1).toBeCloseTo(expectedX1)
        expect(primary.x2).toBeCloseTo(expectedX2)
    })

    it('a level beam (equal pitches) has zero slope: primary y1 === y2', () => {
        const { beam } = beamFrom([eighth('C', 4), eighth('C', 4)])
        const { primary } = beam
        expect(primary.y2).toBeCloseTo(primary.y1)
    })

    it('a rising beam (up stems) produces a non-zero, clamped slope', () => {
        // First note low (C4), second higher (A4) → with up stems the beam tilts.
        const { beam } = beamFrom([eighth('C', 4), eighth('A', 4)])
        expect(beam.stemDir).toBe('up')
        const { primary } = beam

        const dx = primary.x2 - primary.x1
        const slope = (primary.y2 - primary.y1) / dx
        // Slope is non-zero (the beam tilts) and never exceeds the configured maximum.
        expect(Math.abs(slope)).toBeGreaterThan(0)
        expect(Math.abs(slope)).toBeLessThanOrEqual(BEAM_MAX_SLOPE + 1e-9)
    })

    it('clamps a steep pitch jump to the maximum beam slope', () => {
        // An extreme jump (C4 → C6, both up-stemmable region) would over-tilt without clamping.
        const { beam } = beamFrom([eighth('C', 4), eighth('B', 4)])
        const { primary } = beam
        const dx = primary.x2 - primary.x1
        const slope = Math.abs((primary.y2 - primary.y1) / dx)
        expect(slope).toBeLessThanOrEqual(BEAM_MAX_SLOPE + 1e-9)
    })

    it('getStem returns repositioned stems whose y2 lies on the beam line', () => {
        const { measure, beam } = beamFrom([eighth('C', 4), eighth('A', 4)])
        const { primary } = beam
        const slope = (primary.y2 - primary.y1) / (primary.x2 - primary.x1)

        for (const n of beam.notes) {
            const stem = beam.getStem(n)
            if (!stem) throw new Error('expected stem from beam layout')
            // The repositioned stem tip sits exactly on the primary beam line. The stored
            // stem.x is note-relative, so reconstruct the absolute beam x to evaluate the line.
            const original = n.layout.getStem(beam.stemDir)
            if (!original) throw new Error('expected original stem')
            const absStemX = measure.layout.getXForElement(n) + original.x
            const expectedY = primary.y1 + (absStemX - primary.x1) * slope
            expect(stem.y2).toBeCloseTo(expectedY)
            // y1 (the notehead anchor) is preserved from the original note stem.
            expect(stem.y1).toBeCloseTo(original.y1)
        }
    })

    it('getStem returns undefined for a note not in the beam', () => {
        const { beam } = beamFrom([eighth('C', 4), eighth('C', 4)])
        expect(beam.getStem(eighth('C', 4))).toBeUndefined()
    })

    it('raises an up-beam so every stem reaches it (no stem pokes above the beam)', () => {
        // A descending up-stem group forces the beamFirstY adjustment branch (stemDir up).
        const { measure, beam } = beamFrom([eighth('A', 4), eighth('C', 4)])
        expect(beam.stemDir).toBe('up')
        const { primary } = beam
        const slope = (primary.y2 - primary.y1) / (primary.x2 - primary.x1)

        for (const n of beam.notes) {
            const original = n.layout.getStem('up')
            if (!original) throw new Error('expected stem')
            const stemX = measure.layout.getXForElement(n) + original.x
            const beamY = primary.y1 + (stemX - primary.x1) * slope
            // Up-stems point upward (smaller y). The beam must sit at or above every stem tip.
            expect(beamY).toBeLessThanOrEqual(original.y2 + 1e-6)
        }
    })

    it('lowers a down-beam so every stem reaches it (no stem pokes below the beam)', () => {
        // A descending down-stem group: the later (lower) note's natural stem tip sits below
        // the halved-slope beam line, forcing the beamFirstY downward adjustment (stemDir down).
        const { measure, beam } = beamFrom([eighth('E', 5), eighth('C', 5)])
        expect(beam.stemDir).toBe('down')
        const { primary } = beam
        const slope = (primary.y2 - primary.y1) / (primary.x2 - primary.x1)

        for (const n of beam.notes) {
            const original = n.layout.getStem('down')
            if (!original) throw new Error('expected stem')
            const stemX = measure.layout.getXForElement(n) + original.x
            const beamY = primary.y1 + (stemX - primary.x1) * slope
            // Down-stems point downward (larger y). The beam must sit at or below every stem tip.
            expect(beamY).toBeGreaterThanOrEqual(original.y2 - 1e-6)
        }
    })

    describe('secondary (sixteenth) beams', () => {
        it('two sixteenths produce one full secondary beam offset from the primary', () => {
            const { beam } = beamFrom([sixteenth('C', 4), sixteenth('C', 4)])
            const { primary, secondaries } = beam
            expect(secondaries).toHaveLength(1)

            const sec = secondaries[0]
            // The full secondary spans the whole group (first to last stem).
            expect(sec.x1).toBeCloseTo(primary.x1)
            expect(sec.x2).toBeCloseTo(primary.x2)
            // Same thickness/sign as the primary.
            expect(sec.thickness).toBe(primary.thickness)
            // For an up beam the secondary sits below the primary by one level stride.
            expect(sec.y1).toBeCloseTo(primary.y1 + BEAM_LEVEL_STRIDE)
        })

        it('down-beam secondary sits above the primary by one level stride', () => {
            const { beam } = beamFrom([sixteenth('E', 5), sixteenth('E', 5)])
            expect(beam.stemDir).toBe('down')
            const { primary, secondaries } = beam
            expect(secondaries).toHaveLength(1)
            // dirSign = -1 → beamY = beamFirstY - STRIDE.
            expect(secondaries[0].y1).toBeCloseTo(primary.y1 - BEAM_LEVEL_STRIDE)
        })

        it('eighth then sixteenth: a trailing partial beam points left from the last stem', () => {
            // [8, 16] within one beat: only the second note has a secondary beam, and it is
            // not the first note (i !== 0) → partial stub points left (partialDir = -1).
            const { beam } = beamFrom([eighth('C', 4), sixteenth('C', 4)])
            expect(beam.notes).toHaveLength(2)
            const { secondaries } = beam
            expect(secondaries).toHaveLength(1)

            const stub = secondaries[0]
            // Stub length is PARTIAL_BEAM_LENGTH pointing left.
            expect(stub.x2 - stub.x1).toBeCloseTo(-PARTIAL_BEAM_LENGTH)
        })

        it('sixteenth then eighth: a leading partial beam points right from the first stem', () => {
            // [16, 8] within one beat: only the first note has a secondary beam, and it IS
            // the first note (i === 0) → partial stub points right (partialDir = +1).
            const { beam } = beamFrom([sixteenth('C', 4), eighth('C', 4)])
            expect(beam.notes).toHaveLength(2)
            const { secondaries } = beam
            expect(secondaries).toHaveLength(1)

            const stub = secondaries[0]
            expect(stub.x2 - stub.x1).toBeCloseTo(PARTIAL_BEAM_LENGTH)
        })

        it('partial-beam y endpoints follow the beam slope', () => {
            // A sloped group with a trailing partial: stub y2 offset = partialDir * length * slope.
            const { beam } = beamFrom([eighth('C', 4), sixteenth('G', 4)])
            const { primary, secondaries } = beam
            const slope = (primary.y2 - primary.y1) / (primary.x2 - primary.x1)
            expect(secondaries).toHaveLength(1)
            const stub = secondaries[0]
            // partialDir = -1 (trailing), so x runs left and y follows slope accordingly.
            expect(stub.y2 - stub.y1).toBeCloseTo((stub.x2 - stub.x1) * slope)
        })

        it('mixed group [16,16,8] produces a full secondary over the two sixteenths only', () => {
            // First two notes have secondary beams and are adjacent → one full segment; the
            // eighth ends the run. segStart !== stemX so the else-branch (full segment) is taken.
            const { measure, beam } = beamFrom([sixteenth('C', 4), sixteenth('C', 4), eighth('C', 4)])
            expect(beam.notes).toHaveLength(3)
            const { secondaries } = beam
            expect(secondaries).toHaveLength(1)

            const sec = secondaries[0]
            const n0 = beam.notes[0]
            const n1 = beam.notes[1]
            const s0 = n0.layout.getStem(beam.stemDir)
            const s1 = n1.layout.getStem(beam.stemDir)
            if (!s0 || !s1) throw new Error('expected stems')
            const x0 = measure.layout.getXForElement(n0) + s0.x
            const x1 = measure.layout.getXForElement(n1) + s1.x
            // Full segment spans the two sixteenth stems, not a fixed partial length.
            expect(sec.x1).toBeCloseTo(x0)
            expect(sec.x2).toBeCloseTo(x1)
        })

        it('eighth notes alone produce no secondary beams', () => {
            const { beam } = beamFrom([eighth('C', 4), eighth('C', 4)])
            expect(beam.secondaries).toHaveLength(0)
        })
    })
})
