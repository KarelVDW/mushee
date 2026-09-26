import { Instrument } from '@mushee/notation/model/Instrument'
import { Score } from '@mushee/notation/model/Score'
import { TimeSignature } from '@mushee/notation/model/TimeSignature'
import { makeScore } from '@mushee/notation/testing'
import { Metronome } from '@mushee/playback/Metronome'
import type { MidiPlayer, ScheduledNote } from '@mushee/playback/MidiPlayer'
import { describe, expect, it } from 'vitest'

function fakePlayer() {
    const scheduled: ScheduledNote[] = []
    const player = {
        currentTime: 0,
        schedule(note: ScheduledNote) {
            scheduled.push(note)
        },
    }
    return { player: player as unknown as MidiPlayer, scheduled, raw: player }
}

describe('Metronome', () => {
    it('tick() returns true when no score is set', () => {
        const { player } = fakePlayer()
        const metro = new Metronome(player)
        expect(metro.tick()).toBe(true)
    })

    it('schedules one woodblock click per beat at the active tempo', () => {
        const { player, scheduled, raw } = fakePlayer()
        const metro = new Metronome(player)
        metro.score = makeScore(1) // 4/4 measure
        metro.reset()

        raw.currentTime = 100
        const done = metro.tick()

        // 4 beats in the measure => 4 clicks.
        expect(scheduled).toHaveLength(4)
        expect(scheduled.every((n) => n.instrument === Instrument.Woodblock)).toBe(true)
        // The downbeat is accented (higher pitch); the other beats share the plain click.
        expect(scheduled.map((n) => n.midi)).toEqual([108, 96, 96, 96])
        // After the only measure is exhausted (measureIdx walks off), tick reports done.
        expect(done).toBe(true)
        // Default 90bpm => one click per 60/90 s.
        expect(scheduled[1].startTime).toBeCloseTo(60 / 90, 5)
    })

    it('spaces clicks across multiple measures', () => {
        const { player, scheduled, raw } = fakePlayer()
        const metro = new Metronome(player)
        metro.score = makeScore(2)
        metro.reset()

        raw.currentTime = 100
        metro.tick()
        expect(scheduled).toHaveLength(8)
    })

    it('uses a measure-start tempo for the click interval', () => {
        const { player, scheduled, raw } = fakePlayer()
        const metro = new Metronome(player)
        const score = makeScore(1)
        const firstMeasure = score.firstMeasure
        if (!firstMeasure) throw new Error('expected a first measure')
        firstMeasure.setTempo(0, 120)
        metro.score = score
        metro.reset()

        raw.currentTime = 100
        metro.tick()
        // 120bpm => one click per 0.5s.
        expect(scheduled[1].startTime).toBeCloseTo(0.5, 5)
    })

    it('reset() walks back to find the active tempo from startMeasureIndex', () => {
        const { player, scheduled, raw } = fakePlayer()
        const metro = new Metronome(player)
        const score = makeScore(3)
        // Tempo set on measure 0 carries forward; start ticking from measure 2.
        score.measures[0].setTempo(0, 60)
        metro.score = score
        metro.startMeasureIndex = 2
        metro.reset()

        raw.currentTime = 100
        metro.tick()
        // First click of measure 2 lands at the engine's nextClickTime origin (0),
        // and the interval reflects the inherited 60bpm tempo (1s per beat).
        expect(scheduled[1].startTime).toBeCloseTo(1, 5)
        // Only measure 2's four beats are scheduled.
        expect(scheduled).toHaveLength(4)
    })

    it('startMeasureIndex skips earlier measures entirely', () => {
        const { player, scheduled, raw } = fakePlayer()
        const metro = new Metronome(player)
        metro.score = makeScore(2)
        metro.startMeasureIndex = 1
        metro.reset()

        raw.currentTime = 100
        metro.tick()
        // Only the second measure's beats are scheduled.
        expect(scheduled).toHaveLength(4)
    })

    it('startBeat begins ticking mid-measure so clicks stay aligned with audio', () => {
        const { player, scheduled, raw } = fakePlayer()
        const metro = new Metronome(player)
        metro.score = makeScore(1) // 4/4 measure
        metro.startBeat = 2
        metro.reset()

        raw.currentTime = 100
        metro.tick()
        // Beats 2 and 3 remain in the measure => 2 clicks, the first at the audio origin.
        expect(scheduled).toHaveLength(2)
        expect(scheduled[0].startTime).toBeCloseTo(0, 5)
        expect(scheduled[1].startTime).toBeCloseTo(60 / 90, 5)
    })

    it('schedules incrementally within the look-ahead window', () => {
        const { player, scheduled, raw } = fakePlayer()
        const metro = new Metronome(player)
        metro.score = makeScore(1)
        metro.reset()

        raw.currentTime = 0
        expect(metro.tick()).toBe(false)
        const afterFirst = scheduled.length
        expect(afterFirst).toBeGreaterThanOrEqual(1)
        expect(afterFirst).toBeLessThan(4)

        raw.currentTime = 60 / 90
        metro.tick()
        expect(scheduled.length).toBeGreaterThan(afterFirst)
    })

    it('reset() picks the highest-beat tempo when a measure has several (sort comparator)', () => {
        const { player, scheduled, raw } = fakePlayer()
        const metro = new Metronome(player)
        const score = makeScore(2)
        // Two tempos in measure 0: reset() sorts them and keeps the later (beat 2 => 180bpm) one.
        score.measures[0].setTempo(0, 60)
        score.measures[0].addTempo(2, 180)
        // Start at measure 1 (no beat-0 tempo there) so reset's inherited 180bpm is what ticks use.
        metro.score = score
        metro.startMeasureIndex = 1
        metro.reset()
        raw.currentTime = 100
        metro.tick()
        // The carried-forward 180bpm tempo sets the click interval.
        expect(scheduled[1].startTime).toBeCloseTo(60 / 180, 5)
    })

    it('reset() returns early (no tempo lookup) when no score is set', () => {
        const { player } = fakePlayer()
        const metro = new Metronome(player)
        // No score assigned. reset() must not throw and tick() reports done immediately.
        expect(() => metro.reset()).not.toThrow()
        expect(metro.tick()).toBe(true)
    })

    it('reset() skips missing measures while walking back for the active tempo', () => {
        const { player, scheduled, raw } = fakePlayer()
        const metro = new Metronome(player)
        const score = makeScore(2)
        // Tempo lives on measure 0; start beyond the end so the walk-back hits an
        // out-of-range index (continue) before finding it.
        score.measures[0].setTempo(0, 60)
        metro.score = score
        metro.startMeasureIndex = 5 // past the 2 real measures
        metro.reset()

        // Ticking from an out-of-range measure index produces no clicks (measure missing => done).
        raw.currentTime = 100
        expect(metro.tick()).toBe(true)
        expect(scheduled).toHaveLength(0)
        // But the walk-back still found the 60bpm tempo from measure 0.
        expect((metro as unknown as { bpm: number }).bpm).toBe(60)
    })

    it('reset() restores defaults (default bpm with no tempo markings)', () => {
        const { player, scheduled, raw } = fakePlayer()
        const metro = new Metronome(player)
        metro.score = makeScore(1)
        metro.reset()
        raw.currentTime = 100
        metro.tick()
        // No tempo marking => default 90bpm interval.
        expect(scheduled[1].startTime).toBeCloseTo(60 / 90, 5)
    })

    describe('meter-aware pulse', () => {
        /** A score of `count` measures in the given meter, filled with rests (the meter is set before filling, so nothing rebars). */
        function scoreIn(beatAmount: number, beatType: number, count = 1) {
            const score = new Score()
            for (let i = 0; i < count; i++) {
                const measure = score.addMeasure()
                if (i === 0) score.setTimeSignature(measure, new TimeSignature(beatAmount, beatType))
                measure.complete()
            }
            return score
        }

        it('clicks twice a bar in 6/8 — on each dotted quarter, the first accented', () => {
            const { player, scheduled, raw } = fakePlayer()
            const metro = new Metronome(player)
            metro.score = scoreIn(6, 8)
            metro.reset()

            raw.currentTime = 100
            metro.tick()
            // 90 quarter-bpm => a dotted quarter every 1s.
            expect(scheduled.map((n) => n.startTime)).toEqual([0, 1])
            expect(scheduled.map((n) => n.midi)).toEqual([108, 96])
        })

        it('clicks once per eighth in 7/8 and once per half in 2/2', () => {
            const seven = fakePlayer()
            const metro7 = new Metronome(seven.player)
            metro7.score = scoreIn(7, 8)
            metro7.reset()
            seven.raw.currentTime = 100
            metro7.tick()
            expect(seven.scheduled).toHaveLength(7)
            expect(seven.scheduled[1].startTime).toBeCloseTo(60 / 90 / 2, 5)

            const two = fakePlayer()
            const metro2 = new Metronome(two.player)
            metro2.score = scoreIn(2, 2)
            metro2.reset()
            two.raw.currentTime = 100
            metro2.tick()
            expect(two.scheduled).toHaveLength(2)
            expect(two.scheduled[1].startTime).toBeCloseTo((2 * 60) / 90, 5)
        })

        it('accents the downbeat of every measure across a multi-measure pass', () => {
            const { player, scheduled, raw } = fakePlayer()
            const metro = new Metronome(player)
            metro.score = scoreIn(6, 8, 3)
            metro.reset()

            raw.currentTime = 100
            metro.tick()
            expect(scheduled.map((n) => n.midi)).toEqual([108, 96, 108, 96, 108, 96])
        })

        it('starting off the pulse grid waits for the next pulse instead of clicking at once', () => {
            const { player, scheduled, raw } = fakePlayer()
            const metro = new Metronome(player)
            metro.score = scoreIn(6, 8, 2)
            metro.startBeat = 1 // the third eighth of the first group — mid-pulse
            metro.reset()

            raw.currentTime = 100
            metro.tick()
            // Half a beat (0.5 quarter = 1/3 s at 90bpm) until the second dotted quarter, then the next bar's downbeat.
            expect(scheduled[0].startTime).toBeCloseTo(1 / 3, 5)
            expect(scheduled[0].midi).toBe(96)
            expect(scheduled[1].startTime).toBeCloseTo(1 / 3 + 1, 5)
            expect(scheduled[1].midi).toBe(108)
        })

        it('syncTo skips elapsed pulses so a mid-pass join schedules only upcoming clicks', () => {
            const { player, scheduled, raw } = fakePlayer()
            const metro = new Metronome(player)
            metro.score = scoreIn(6, 8, 2)
            metro.reset()
            // 2.5s in: the clicks at 0, 1 and 2 have passed; the next is the second bar's second pulse at 3s.
            metro.syncTo(2.5)

            raw.currentTime = 100
            metro.tick()
            expect(scheduled.map((n) => n.startTime)).toEqual([3])
            expect(scheduled[0].midi).toBe(96)
        })

        it('syncTo is a no-op without a score', () => {
            const { player, scheduled } = fakePlayer()
            const metro = new Metronome(player)
            metro.syncTo(5)
            expect(scheduled).toHaveLength(0)
        })

        it('a mid-measure tempo marking takes effect at its beat', () => {
            const { player, scheduled, raw } = fakePlayer()
            const metro = new Metronome(player)
            const score = makeScore(1)
            score.measures[0].setTempo(0, 60)
            score.measures[0].addTempo(2, 120)
            metro.score = score
            metro.reset()

            raw.currentTime = 100
            metro.tick()
            // Beats 0,1 at 60bpm (1s apart), beats 2,3 at 120bpm (0.5s apart).
            expect(scheduled.map((n) => n.startTime)).toEqual([0, 1, 2, 2.5])
        })
    })
})
