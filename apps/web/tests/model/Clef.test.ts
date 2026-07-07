import { clef } from '@test/helpers'
import { describe, expect, it } from 'vitest'

import type { ClefType } from '@/components/notation/types'
import { Pitch } from '@/model/Pitch'

describe('Clef', () => {
    it('stores type', () => {
        expect(clef('treble').type).toBe('treble')
    })

    it('stores beatPosition (0 for the leading clef, the beat for mid-measure clefs)', () => {
        expect(clef('treble').beatPosition).toBe(0)
        expect(clef('bass', 2).beatPosition).toBe(2)
    })

    it('belongs to the measure that created it', () => {
        const c = clef('treble')
        expect(c.measure.clef).toBe(c)
    })

    it('has a unique id', () => {
        expect(clef('treble').id).not.toBe(clef('treble').id)
    })

    it('lazily creates a single ClefWidth instance (context-free, cached forever)', () => {
        const c = clef('treble')
        expect(c.width).toBe(c.width)
    })

    it('lazily creates a single ClefLayout instance (context-free, cached forever)', () => {
        const c = clef('treble')
        expect(c.layout).toBe(c.layout)
    })

    it('computes width and layout for every supported clef type', () => {
        for (const type of ['treble', 'bass', 'alto', 'tenor'] as ClefType[]) {
            const c = clef(type)
            expect(c.width.total).toBeGreaterThan(0)
            expect(typeof c.layout.glyphName).toBe('string')
        }
    })

    it('throws if width is requested for an unconfigured clef type', () => {
        expect(() => clef('percussion' as ClefType).width).toThrow('Unknown clef type: percussion')
    })

    describe('lineFor (clef-aware staff position)', () => {
        const p = new Pitch({ name: 'C', octave: 4 })

        it('treble matches the pitch base line', () => {
            expect(clef('treble').lineFor(p)).toBe(p.line)
        })

        it('shifts the pitch down the staff for lower clefs (bass +6, tenor +4, alto +3)', () => {
            expect(clef('bass').lineFor(p)).toBe(p.line + 6)
            expect(clef('tenor').lineFor(p)).toBe(p.line + 4)
            expect(clef('alto').lineFor(p)).toBe(p.line + 3)
        })

        it('covers the C-clef family (soprano +1 … baritone +5)', () => {
            expect(clef('soprano').lineFor(p)).toBe(p.line + 1)
            expect(clef('mezzoSoprano').lineFor(p)).toBe(p.line + 2)
            expect(clef('baritoneC').lineFor(p)).toBe(p.line + 5)
        })

        it('shifts by whole octaves for octave clefs (8 = ±3.5, 15 = ±7)', () => {
            expect(clef('treble8vb').lineFor(p)).toBe(clef('treble').lineFor(p) + 3.5)
            expect(clef('treble8va').lineFor(p)).toBe(clef('treble').lineFor(p) - 3.5)
            expect(clef('treble15mb').lineFor(p)).toBe(clef('treble').lineFor(p) + 7)
            expect(clef('bass8vb').lineFor(p)).toBe(clef('bass').lineFor(p) + 3.5)
            expect(clef('bass15ma').lineFor(p)).toBe(clef('bass').lineFor(p) - 7)
        })
    })

    describe('pitchForLine (inverse of lineFor)', () => {
        it('round-trips a pitch through any clef', () => {
            for (const type of ['treble', 'bass', 'alto', 'tenor', 'treble8vb', 'bass15ma'] as ClefType[]) {
                const c = clef(type)
                const p = new Pitch({ name: 'E', octave: 4 })
                const restored = c.pitchForLine(c.lineFor(p))
                expect(restored.name).toBe(p.name)
                expect(restored.octave).toBe(p.octave)
            }
        })
    })

    describe('octavesToCenter (octave normalization for recorded audio)', () => {
        const pitches = (...specs: Array<[string, number]>) => specs.map(([name, octave]) => new Pitch({ name, octave }))

        it('returns 0 for an empty list', () => {
            expect(clef('treble').octavesToCenter([])).toBe(0)
        })

        it('leaves pitches already centered on the staff alone', () => {
            // B4 sits on the treble middle line.
            expect(clef('treble').octavesToCenter(pitches(['B', 4]))).toBe(0)
            expect(clef('treble').octavesToCenter(pitches(['G', 4], ['B', 4], ['D', 5]))).toBe(0)
        })

        it('pulls a whistled take (1-2 octaves high) down onto the treble staff', () => {
            expect(clef('treble').octavesToCenter(pitches(['B', 6], ['C', 7], ['A', 6]))).toBe(-2)
            expect(clef('treble').octavesToCenter(pitches(['B', 5], ['C', 6]))).toBe(-1)
        })

        it('lifts a low hummed take up onto the treble staff', () => {
            expect(clef('treble').octavesToCenter(pitches(['B', 2], ['A', 2], ['C', 3]))).toBe(2)
        })

        it('centers on the clef actually in use, not on treble', () => {
            // D3 sits on the bass middle line: a bass-range take needs no shift there…
            expect(clef('bass').octavesToCenter(pitches(['D', 3], ['F', 3], ['B', 2]))).toBe(0)
            // …while the same take on a treble staff comes up an octave or two.
            expect(clef('treble').octavesToCenter(pitches(['D', 3], ['F', 3], ['B', 2]))).toBeGreaterThan(0)
        })

        it('decides by the median, so a single outlier cannot drag the take away', () => {
            expect(clef('treble').octavesToCenter(pitches(['B', 4], ['A', 4], ['C', 5], ['C', 8]))).toBe(0)
        })
    })
})
