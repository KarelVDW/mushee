import { describe, expect, it } from 'vitest'

import { TimeSignature } from '@/model/TimeSignature'

describe('TimeSignature', () => {
    it('stores beatAmount and beatType', () => {
        const ts = new TimeSignature(4, 4)
        expect(ts.beatAmount).toBe(4)
        expect(ts.beatType).toBe(4)
    })

    it('maxBeats expresses total in quarter-note units', () => {
        expect(new TimeSignature(4, 4).maxBeats).toBe(4)
        expect(new TimeSignature(3, 4).maxBeats).toBe(3)
        expect(new TimeSignature(6, 8).maxBeats).toBe(3)
        expect(new TimeSignature(12, 8).maxBeats).toBe(6)
        expect(new TimeSignature(2, 2).maxBeats).toBe(4)
    })

    it('beatsDigits and beatTypeDigits split into individual digits', () => {
        const ts = new TimeSignature(12, 8)
        expect(ts.beatsDigits).toEqual(['1', '2'])
        expect(ts.beatTypeDigits).toEqual(['8'])
    })

    it('lazily creates a single TimeSignatureWidth instance', () => {
        const ts = new TimeSignature(4, 4)
        const w1 = ts.width
        const w2 = ts.width
        expect(w1).toBe(w2)
    })

    it('measure getter throws when measure is unset', () => {
        const ts = new TimeSignature(4, 4)
        expect(() => ts.measure).toThrow('TimeSignature is not assigned to a measure')
    })

    it('invalidateLayout clears the cached layout', () => {
        const ts = new TimeSignature(4, 4)
        const l1 = ts.layout
        ts.invalidateLayout()
        const l2 = ts.layout
        expect(l1).not.toBe(l2)
    })
})
