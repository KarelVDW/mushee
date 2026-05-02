import { describe, expect, it } from 'vitest'

import { Clef } from '@/model/Clef'
import { Measure } from '@/model/Measure'
import { Score } from '@/model/Score'
import { Tempo } from '@/model/Tempo'
import { TimeSignature } from '@/model/TimeSignature'

describe('Tempo', () => {
    it('stores measure, beatPosition, bpm', () => {
        const score = new Score()
        const m = new Measure(score, new Clef('treble'), new TimeSignature(4, 4))
        const t = new Tempo(m, 0, 120)
        expect(t.measure).toBe(m)
        expect(t.beatPosition).toBe(0)
        expect(t.bpm).toBe(120)
    })

    it('layout is lazy and stable', () => {
        const score = new Score()
        const m = new Measure(score, new Clef('treble'), new TimeSignature(4, 4))
        const t = new Tempo(m, 0, 120)
        expect(t.layout).toBe(t.layout)
    })

    it('invalidateLayout clears cached layout', () => {
        const score = new Score()
        const m = new Measure(score, new Clef('treble'), new TimeSignature(4, 4))
        const t = new Tempo(m, 0, 120)
        const l1 = t.layout
        t.invalidateLayout()
        expect(t.layout).not.toBe(l1)
    })
})
