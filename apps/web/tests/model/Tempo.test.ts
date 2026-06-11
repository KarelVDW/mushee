import { describe, expect, it } from 'vitest'

import { Measure } from '@/model/Measure'
import { Score } from '@/model/Score'
import { Tempo } from '@/model/Tempo'
import { TimeSignature } from '@/model/TimeSignature'

describe('Tempo', () => {
    it('stores measure, beatPosition, bpm', () => {
        const score = new Score()
        const m = new Measure(score, 'treble', new TimeSignature(4, 4))
        const t = new Tempo(m, 0, 120)
        expect(t.measure).toBe(m)
        expect(t.beatPosition).toBe(0)
        expect(t.bpm).toBe(120)
    })

    it('has a unique id', () => {
        const score = new Score()
        const m = new Measure(score, 'treble', new TimeSignature(4, 4))
        expect(new Tempo(m, 0, 120).id).not.toBe(new Tempo(m, 0, 120).id)
    })

    it('layout is context-free and cached forever (same instance on every read)', () => {
        const score = new Score()
        const m = new Measure(score, 'treble', new TimeSignature(4, 4))
        const t = new Tempo(m, 0, 120)
        expect(t.layout).toBe(t.layout)
    })
})
