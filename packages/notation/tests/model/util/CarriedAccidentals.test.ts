import { CarriedAccidentals } from '@mushee/notation/model/util/CarriedAccidentals'
import { p } from '@mushee/notation/testing'
import { describe, expect, it } from 'vitest'

describe('CarriedAccidentals', () => {
    it('reads a fresh bar against the key signature', () => {
        const carried = new CarriedAccidentals(2) // D major: F♯, C♯
        expect(carried.fifths).toBe(2)
        expect(carried.prevailing('F', 4)).toBe(1)
        expect(carried.prevailing('G', 4)).toBe(0)
        expect(carried.draws(p('F', 4, 1))).toBe(false) // key-implied
        expect(carried.draws(p('F', 4))).toBe(true) // F♮ contradicts the key
    })

    it('carries a recorded alteration on its (name, octave) only', () => {
        const carried = new CarriedAccidentals(0)
        carried.record(p('G', 4, 1))
        expect(carried.prevailing('G', 4)).toBe(1)
        expect(carried.draws(p('G', 4, 1))).toBe(false) // already sounding in the bar
        expect(carried.draws(p('G', 4))).toBe(true) // now needs a natural
        expect(carried.draws(p('G', 5, 1))).toBe(true) // another octave is another slot
    })

    it('a later record on the same slot replaces the carried alteration', () => {
        const carried = new CarriedAccidentals(0)
        carried.record(p('B', 4, -1))
        carried.record(p('B', 4))
        expect(carried.prevailing('B', 4)).toBe(0)
    })

    it('reset enters a new key and cancels everything carried', () => {
        const carried = new CarriedAccidentals(0)
        carried.record(p('F', 4, 1))
        carried.reset(-1) // F major: B♭
        expect(carried.fifths).toBe(-1)
        expect(carried.prevailing('F', 4)).toBe(0)
        expect(carried.prevailing('B', 4)).toBe(-1)
    })
})
