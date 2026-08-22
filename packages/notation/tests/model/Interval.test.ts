import { Interval } from '@mushee/notation/model/Interval'
import { describe, expect, it } from 'vitest'

describe('Interval', () => {
    describe('fromParts (degree + quality + octaves + direction)', () => {
        it('builds the classic sizes', () => {
            expect(Interval.fromParts(2, 'major')).toEqual(new Interval(2, 1))
            expect(Interval.fromParts(2, 'minor')).toEqual(new Interval(1, 1))
            expect(Interval.fromParts(3, 'major')).toEqual(new Interval(4, 2))
            expect(Interval.fromParts(5, 'perfect')).toEqual(new Interval(7, 4))
            expect(Interval.fromParts(8, 'perfect')).toEqual(new Interval(12, 7))
            expect(Interval.fromParts(1, 'perfect')).toEqual(new Interval(0, 0))
        })

        it('augments and diminishes both interval classes', () => {
            expect(Interval.fromParts(4, 'augmented')).toEqual(new Interval(6, 3)) // tritone as aug 4th
            expect(Interval.fromParts(5, 'diminished')).toEqual(new Interval(6, 4)) // tritone as dim 5th
            expect(Interval.fromParts(1, 'augmented')).toEqual(new Interval(1, 0))
            expect(Interval.fromParts(7, 'diminished')).toEqual(new Interval(9, 6)) // major-class dim = −2
            expect(Interval.fromParts(6, 'augmented')).toEqual(new Interval(10, 5))
        })

        it('adds whole octaves and applies direction to both components', () => {
            expect(Interval.fromParts(2, 'major', 1)).toEqual(new Interval(14, 8))
            expect(Interval.fromParts(3, 'minor', 0, -1)).toEqual(new Interval(-3, -2))
            expect(Interval.fromParts(4, 'perfect', 2, -1)).toEqual(new Interval(-29, -17))
        })

        it('rejects out-of-range degrees and qualities the degree does not have', () => {
            expect(() => Interval.fromParts(0, 'perfect')).toThrow('degree out of range')
            expect(() => Interval.fromParts(9, 'perfect')).toThrow('degree out of range')
            expect(() => Interval.fromParts(2.5, 'major')).toThrow('degree out of range')
            expect(() => Interval.fromParts(3, 'perfect')).toThrow('no perfect quality')
            expect(() => Interval.fromParts(5, 'major')).toThrow('no major quality')
            expect(() => Interval.fromParts(4, 'minor')).toThrow('no minor quality')
        })
    })

    describe('fromSemitones (nearest-key letter distance)', () => {
        it('picks the conventional interval for each semitone count', () => {
            expect(Interval.fromSemitones(0)).toEqual(new Interval(0, 0))
            expect(Interval.fromSemitones(1)).toEqual(new Interval(1, 1)) // minor 2nd, not aug unison
            expect(Interval.fromSemitones(2)).toEqual(new Interval(2, 1))
            expect(Interval.fromSemitones(4)).toEqual(new Interval(4, 2))
            expect(Interval.fromSemitones(7)).toEqual(new Interval(7, 4))
            expect(Interval.fromSemitones(12)).toEqual(new Interval(12, 7))
            expect(Interval.fromSemitones(-2)).toEqual(new Interval(-2, -1))
            expect(Interval.fromSemitones(-12)).toEqual(new Interval(-12, -7))
        })
    })

    describe('betweenKeys (tonic-to-tonic, forced up or down)', () => {
        it('moves up within the octave above, down within the octave below', () => {
            expect(Interval.betweenKeys(0, 1, 1)).toEqual(new Interval(7, 4)) // C → G up: perfect 5th
            expect(Interval.betweenKeys(0, 1, -1)).toEqual(new Interval(-5, -3)) // C → G down: perfect 4th
            expect(Interval.betweenKeys(0, 6, 1)).toEqual(new Interval(6, 3)) // C → F♯ up: aug 4th
            expect(Interval.betweenKeys(-5, 0, -1)).toEqual(new Interval(-1, -1)) // D♭ → C down: minor 2nd
            expect(Interval.betweenKeys(-7, 0, 1)).toEqual(new Interval(1, 0)) // C♭ → C up: aug unison
        })

        it('same-tonic keys are a unison — including enharmonic pairs twelve fifths apart', () => {
            expect(Interval.betweenKeys(2, 2, 1)).toEqual(new Interval(0, 0))
            expect(Interval.betweenKeys(-5, 7, 1)).toEqual(new Interval(0, 0)) // D♭ major → C♯ major
            expect(Interval.betweenKeys(7, -5, -1)).toEqual(new Interval(0, 0))
        })
    })

    describe('isUnison', () => {
        it('is true only when nothing moves', () => {
            expect(new Interval(0, 0).isUnison).toBe(true)
            expect(new Interval(1, 0).isUnison).toBe(false)
            expect(new Interval(0, 6).isUnison).toBe(false)
        })
    })
})
