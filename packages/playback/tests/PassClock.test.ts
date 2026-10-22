import { Instrument } from '@mushee/notation/model/Instrument'
import type { Note } from '@mushee/notation/model/Note'
import { Score } from '@mushee/notation/model/Score'
import { pitched } from '@mushee/notation/testing'
import { Metronome } from '@mushee/playback/Metronome'
import { PassClock } from '@mushee/playback/PassClock'
import { ScoreScheduler } from '@mushee/playback/ScoreScheduler'
import type { Tickable } from '@mushee/playback/Ticker'
import { describe, expect, it } from 'vitest'

import { fakePlayer } from './fakePlayer'

/** Three measures of 4/4 at 60bpm (one quarter a second), each holding `notes()`. */
function scoreAt60(notes: () => Note[]): Score {
    const score = new Score()
    for (let i = 0; i < 3; i++) score.addMeasure(i).addNotes(notes())
    score.measures[0].setTempo(0, 60) // carries through the score
    return score
}

const quarters = () => [pitched('C', 4), pitched('D', 4), pitched('E', 4), pitched('F', 4)]
const halves = () => [pitched('C', 4, 'h'), pitched('D', 4, 'h')]

/**
 * Drive `units` once per 60 Hz frame while the player's clock runs from `from`
 * to `to` seconds, as the Ticker does. Returns how many notes a frame scheduled
 * to start before its own clock reading — notes that would sound late, at once.
 */
function playFrames(fake: ReturnType<typeof fakePlayer>, units: Tickable[], from: number, to: number): number {
    let late = 0
    for (let frame = 0; from + frame / 60 < to; frame++) {
        const now = from + frame / 60
        fake.player.currentTime = now
        const before = fake.scheduled.length
        for (const unit of units) unit.tick()
        late += fake.scheduled.slice(before).filter((note) => note.startTime < now - 1e-9).length
    }
    return late
}

const onsets = (fake: ReturnType<typeof fakePlayer>, instrument?: Instrument) =>
    fake.scheduled.filter((n) => !instrument || n.instrument === instrument).map((n) => n.startTime)

describe('PassClock', () => {
    it('reads 0 at the start position and seconds from there on the score clock', () => {
        const { player } = fakePlayer()
        const clock = new PassClock(player)
        clock.start(scoreAt60(quarters), 1, 2)
        expect(clock.timeAt(1, 2)).toBe(0)
        expect(clock.timeAt(2, 0)).toBeCloseTo(2, 9)
        expect(clock.timeAt(0, 0)).toBeCloseTo(-6, 9)
    })

    it('reads a position whose measure an edit removed as the end of the score', () => {
        const { player } = fakePlayer()
        const clock = new PassClock(player)
        const score = scoreAt60(quarters)
        clock.start(score, 0, 0)
        score.removeMeasures([score.measures[2]])
        expect(clock.timeAt(2, 1)).toBeCloseTo(8, 9)
    })

    it('throws when read before a pass started', () => {
        const { player } = fakePlayer()
        expect(() => new PassClock(player).timeAt(0, 0)).toThrow()
    })

    describe('an edit mid-pass keeps the pass clock running', () => {
        it('a faster tempo upstream speeds up only what is still to come — nothing lands in the past', () => {
            const fake = fakePlayer()
            const scheduler = new ScoreScheduler(fake.player)
            const score = scoreAt60(quarters)
            scheduler.cue(score)
            scheduler.reset()

            expect(playFrames(fake, [scheduler], 0, 4.5)).toBe(0) // into the second measure: its C at 4s has sounded
            score.measures[0].setTempo(0, 240) // four times faster, upstream of the play position
            expect(playFrames(fake, [scheduler], 4.5, 8)).toBe(0)

            // The D keeps the time it was due at; everything after it runs at the new tempo.
            const expected = [0, 1, 2, 3, 4, 5, 5.25, 5.5, 5.75, 6, 6.25, 6.5]
            expect(onsets(fake)).toHaveLength(expected.length)
            onsets(fake).forEach((t, i) => expect(t).toBeCloseTo(expected[i], 9))
            // The cursor carries on from where it was rather than leaping ahead.
            const position = scheduler.positionAt(5.1)
            expect(position?.measureIndex).toBe(1)
            expect(position?.beat).toBeCloseTo(1.4, 9)
        })

        it('a slower tempo upstream leaves no silence: the next note keeps its time', () => {
            const fake = fakePlayer()
            const scheduler = new ScoreScheduler(fake.player)
            const score = scoreAt60(quarters)
            scheduler.cue(score)
            scheduler.reset()

            playFrames(fake, [scheduler], 0, 4.5)
            score.measures[0].setTempo(0, 30) // half the speed
            playFrames(fake, [scheduler], 4.5, 18)

            const expected = [0, 1, 2, 3, 4, 5, 7, 9, 11, 13, 15, 17]
            expect(onsets(fake)).toHaveLength(expected.length)
            onsets(fake).forEach((t, i) => expect(t).toBeCloseTo(expected[i], 9))
        })

        it('removing a measure before the play position does not jump the clock', () => {
            const fake = fakePlayer()
            const scheduler = new ScoreScheduler(fake.player)
            const score = scoreAt60(quarters)
            score.addMeasure(3).addNotes(quarters())
            score.measures[0].setTempo(0, 30) // the first measure lasts 8s, the rest 4s each
            score.measures[1].setTempo(0, 60)
            scheduler.cue(score)
            scheduler.reset()

            expect(playFrames(fake, [scheduler], 0, 8.5)).toBe(0) // the second measure's C at 8s has sounded
            score.removeMeasures([score.measures[0]])
            expect(playFrames(fake, [scheduler], 8.5, 16)).toBe(0)

            // The walk goes by measure index, so it carries on in what was the third measure —
            // on the clock, from the 9s the next note was due at, one quarter a second.
            const later = onsets(fake).slice(5)
            expect(later).toHaveLength(7)
            later.forEach((t, i) => expect(t).toBeCloseTo(9 + i, 9))
        })

        it('a metronome playing alone re-anchors on its next click', () => {
            const fake = fakePlayer()
            const metronome = new Metronome(fake.player)
            const score = scoreAt60(quarters)
            metronome.cue(score)
            metronome.reset()

            playFrames(fake, [metronome], 0, 4.5)
            score.measures[0].setTempo(0, 240)
            expect(playFrames(fake, [metronome], 4.5, 8)).toBe(0)

            const expected = [0, 1, 2, 3, 4, 5, 5.25, 5.5, 5.75, 6, 6.25, 6.5]
            expect(onsets(fake)).toHaveLength(expected.length)
            onsets(fake).forEach((t, i) => expect(t).toBeCloseTo(expected[i], 9))
        })

        it.each([
            ['faster', 240],
            ['slower', 15],
        ])('a metronome following the scheduler stays on the notes through a %s tempo edit', (_, bpm) => {
            // Half notes: the scheduler has walked to the D at beat 2 while the next click is due at beat 1,
            // so each unit's next event sits at a different point when the edit lands.
            const fake = fakePlayer()
            const scheduler = new ScoreScheduler(fake.player)
            const metronome = new Metronome(fake.player)
            const score = scoreAt60(halves)
            scheduler.cue(score)
            metronome.cue(score, 0, 0, scheduler.clock)
            scheduler.reset()
            metronome.reset()

            playFrames(fake, [scheduler, metronome], 0, 4.5)
            score.measures[0].setTempo(0, bpm)
            expect(playFrames(fake, [scheduler, metronome], 4.5, 40)).toBe(0)

            const clicks = onsets(fake, Metronome.INSTRUMENT)
            const notes = onsets(fake, Instrument.Piano)
            expect(clicks).toHaveLength(12)
            expect(notes).toHaveLength(6)
            // Every note lands on a click: the half notes on beats 0 and 2.
            notes.forEach((t) => expect(clicks.some((c) => Math.abs(c - t) < 1e-9)).toBe(true))
            // Both run in order, the click due at 5s keeping its time.
            expect(clicks).toEqual([...clicks].sort((a, b) => a - b))
            expect(clicks[5]).toBeCloseTo(5, 9)
        })
    })
})
