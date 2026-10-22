import { TEMPO_MARKING_Y } from '@mushee/notation/engraving/constants'
import { Measure } from '@mushee/notation/model/Measure'
import { Score } from '@mushee/notation/model/Score'
import { Tempo } from '@mushee/notation/model/Tempo'
import { TimeSignature } from '@mushee/notation/model/TimeSignature'
import { makeScore } from '@mushee/notation/testing'
import { describe, expect, it } from 'vitest'

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

    it("is laid out by its measure's layout: the marking's x at its beat, rebuilt when the measure changes", () => {
        const score = makeScore(1)
        const m = score.measures[0]
        m.setTempo(2, 120)
        const t = m.tempoAtBeat(2) as Tempo
        const before = m.layout.tempoLayoutFor(t)
        expect(m.layout.tempoLayoutFor(t)).toBe(before)
        expect(before.x).toBe(m.layout.getXForBeat(2))
        expect(before.y).toBe(TEMPO_MARKING_Y)
        m.setTempo(0, 90) // any change to the measure rebuilds its layout
        expect(m.tempos).toContain(t)
        expect(m.layout.tempoLayoutFor(t)).not.toBe(before)
    })

    it('a measure layout refuses a tempo that is not its own', () => {
        const score = makeScore(2)
        score.measures[1].setTempo(0, 90)
        const stranger = score.measures[1].tempos[0]
        expect(() => score.measures[0].layout.tempoLayoutFor(stranger)).toThrow('Tempo not part of this measure layout')
    })

    it("is written in the measure's felt beat: ♩ = 90 in 4/4, ♩. = 60 in 6/8, half = 45 in 2/2", () => {
        const score = new Score()
        const quarter = new Tempo(new Measure(score, 'treble', new TimeSignature(4, 4)), 0, 90)
        expect(quarter.pulse).toMatchObject({ type: 'q', dots: 0 })
        expect(quarter.pulseBpm).toBe(90)

        const compound = new Tempo(new Measure(score, 'treble', new TimeSignature(6, 8)), 0, 90)
        expect(compound.pulse).toMatchObject({ type: 'q', dots: 1 })
        expect(compound.pulseBpm).toBe(60)

        expect(new Tempo(new Measure(score, 'treble', new TimeSignature(2, 2)), 0, 90).pulseBpm).toBe(45)
    })

    it('rounds the written bpm to a whole number', () => {
        const score = new Score()
        // 100 quarter-bpm in 6/8 is 66.67 dotted quarters a minute.
        expect(new Tempo(new Measure(score, 'treble', new TimeSignature(6, 8)), 0, 100).pulseBpm).toBe(67)
    })
})
