import { pitched, rest } from '@test/helpers'
import { describe, expect, it } from 'vitest'

import type { MidiPlayer, ScheduledNote } from '@/lib/MidiPlayer'
import { ScoreScheduler } from '@/lib/ScoreScheduler'
import { Duration } from '@/model/Duration'
import { Instrument } from '@/model/Instrument'
import { Note } from '@/model/Note'
import { Pitch } from '@/model/Pitch'
import { Score } from '@/model/Score'

/** Minimal MidiPlayer stand-in: a settable clock plus a recording `schedule`. */
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

/** Build a score whose measures contain exactly the given notes (no rest-filling). */
function scoreWithNotes(...measuresNotes: Note[][]): Score {
    const score = new Score()
    measuresNotes.forEach((notes, i) => {
        const m = score.addMeasure(i)
        if (notes.length) m.addNotes(notes)
    })
    return score
}

describe('ScoreScheduler', () => {
    it('tick() returns true (done) when no score is set', () => {
        const { player } = fakePlayer()
        const scheduler = new ScoreScheduler(player)
        expect(scheduler.tick()).toBe(true)
    })

    it('endTime is -1 until scheduling completes, then equals the last note end', () => {
        const { player, raw } = fakePlayer()
        const scheduler = new ScoreScheduler(player)
        scheduler.score = scoreWithNotes([pitched('C', 4), pitched('D', 4), pitched('E', 4), pitched('F', 4)])
        scheduler.reset()

        expect(scheduler.endTime).toBe(-1)

        // 4 quarter notes at 90bpm => each lasts 60/90 = 0.666...s.
        raw.currentTime = 0
        expect(scheduler.tick()).toBe(false) // schedules up to look-ahead
        // Advance the clock past the end so the loop walks off the end of the measures.
        raw.currentTime = 100
        expect(scheduler.tick()).toBe(true)
        expect(scheduler.endTime).toBeCloseTo((4 * 60) / 90, 5)
    })

    it('schedules a midi note per pitched note and skips rests', () => {
        const { player, scheduled, raw } = fakePlayer()
        const scheduler = new ScoreScheduler(player)
        scheduler.score = scoreWithNotes([pitched('C', 4), rest('q'), pitched('E', 4), rest('q')])
        scheduler.reset()

        raw.currentTime = 100
        scheduler.tick()

        // Two pitched notes scheduled; four timeline entries recorded.
        expect(scheduled).toHaveLength(2)
        expect(scheduler.entries).toHaveLength(4)
        const cMidi = new Pitch({ name: 'C', octave: 4 }).toMidi()
        expect(scheduled[0].midi).toBe(cMidi)
        expect(scheduled[0].startTime).toBeCloseTo(0, 5)
        // The third entry (index 2) is the E note, which starts after 2 quarter beats.
        expect(scheduled[1].startTime).toBeCloseTo((2 * 60) / 90, 5)
    })

    it('applies the instrument chromatic transpose to the scheduled midi', () => {
        const { player, scheduled, raw } = fakePlayer()
        const scheduler = new ScoreScheduler(player)
        const score = scoreWithNotes([pitched('C', 4)])
        // Clarinet sounds a major second below written pitch (chromaticTranspose === -2).
        // seedInstrument keeps the written pitch as-is so the transpose is observable at schedule time
        // (setInstrument would rewrite the note to preserve the sounding pitch instead).
        score.seedInstrument(Instrument.Clarinet)
        expect(Instrument.Clarinet.chromaticTranspose).not.toBe(0)
        scheduler.score = score
        scheduler.reset()
        raw.currentTime = 100
        scheduler.tick()
        const expected = new Pitch({ name: 'C', octave: 4 }).toMidi() + Instrument.Clarinet.chromaticTranspose
        expect(scheduled[0].midi).toBe(expected)
        expect(scheduled[0].instrument).toBe(Instrument.Clarinet)
    })

    it('records the correct timeline entry fields', () => {
        const { player, raw } = fakePlayer()
        const scheduler = new ScoreScheduler(player)
        scheduler.score = scoreWithNotes([pitched('C', 4, 'h'), pitched('E', 4, 'h')])
        scheduler.reset()
        raw.currentTime = 100
        scheduler.tick()

        expect(scheduler.entries[0]).toMatchObject({ startTime: 0, beatSpan: 2, measureIndex: 0, beat: 0 })
        expect(scheduler.entries[1].beat).toBe(2)
        expect(scheduler.entries[0].duration).toBeCloseTo((2 * 60) / 90, 5)
    })

    it('respects a measure-start tempo marking', () => {
        const { player, raw } = fakePlayer()
        const scheduler = new ScoreScheduler(player)
        const score = scoreWithNotes([pitched('C', 4), pitched('D', 4), pitched('E', 4), pitched('F', 4)])
        const firstMeasure = score.firstMeasure
        if (!firstMeasure) throw new Error('expected a first measure')
        firstMeasure.setTempo(0, 120)
        scheduler.score = score
        scheduler.reset()

        raw.currentTime = 100
        scheduler.tick()
        // At 120bpm a quarter note lasts 0.5s; the second entry starts then.
        expect(scheduler.entries[1].startTime).toBeCloseTo(0.5, 5)
    })

    it('picks up the first-measure tempo during reset()', () => {
        const { player, raw } = fakePlayer()
        const scheduler = new ScoreScheduler(player)
        const score = scoreWithNotes([pitched('C', 4), pitched('D', 4)])
        const firstMeasure = score.firstMeasure
        if (!firstMeasure) throw new Error('expected a first measure')
        firstMeasure.setTempo(0, 60)
        scheduler.score = score
        scheduler.reset()

        raw.currentTime = 100
        scheduler.tick()
        // 60bpm => quarter note lasts 1s.
        expect(scheduler.entries[0].duration).toBeCloseTo(1, 5)
    })

    it('respects a mid-measure tempo change (beat > 0)', () => {
        const { player, raw } = fakePlayer()
        const scheduler = new ScoreScheduler(player)
        const score = scoreWithNotes([pitched('C', 4), pitched('D', 4), pitched('E', 4), pitched('F', 4)])
        const m = score.firstMeasure
        if (!m) throw new Error('expected a first measure')
        m.setTempo(2, 180) // change tempo at beat 2
        scheduler.score = score
        scheduler.reset()

        raw.currentTime = 100
        scheduler.tick()
        // First two notes at 90bpm (0.666s each), the rest at 180bpm (0.333s each).
        const q90 = 60 / 90
        const q180 = 60 / 180
        expect(scheduler.entries[2].startTime).toBeCloseTo(2 * q90, 5)
        expect(scheduler.entries[3].startTime).toBeCloseTo(2 * q90 + q180, 5)
    })

    it('extends a forward-tied note over its tied continuation for audio duration', () => {
        const { player, scheduled, raw } = fakePlayer()
        const scheduler = new ScoreScheduler(player)
        const score = new Score()
        const m = score.addMeasure(0)
        const start = new Note({ duration: new Duration({ type: 'q' }), pitch: new Pitch({ name: 'C', octave: 4 }), tie: 'start' })
        const stop = new Note({ duration: new Duration({ type: 'q' }), pitch: new Pitch({ name: 'C', octave: 4 }), tie: 'stop' })
        m.addNotes([start, stop])
        scheduler.score = score
        scheduler.reset()

        raw.currentTime = 100
        scheduler.tick()

        // Only the tie-start note sounds (the tie-stop note tiesBack and is not re-struck).
        expect(scheduled).toHaveLength(1)
        // Its audio duration spans both quarter notes => 2 * 60/90.
        expect(scheduled[0].duration).toBeCloseTo((2 * 60) / 90, 5)
    })

    it('getTiedAudioDuration stops at the end of the chain when no next note exists', () => {
        const { player, scheduled, raw } = fakePlayer()
        const scheduler = new ScoreScheduler(player)
        const score = new Score()
        const m = score.addMeasure(0)
        // A lone tie-start note with no following note: the while loop breaks at getNext()===null.
        const lonely = new Note({ duration: new Duration({ type: 'q' }), pitch: new Pitch({ name: 'C', octave: 4 }), tie: 'start' })
        m.addNotes([lonely])
        scheduler.score = score
        scheduler.reset()

        raw.currentTime = 100
        scheduler.tick()
        expect(scheduled).toHaveLength(1)
        expect(scheduled[0].duration).toBeCloseTo(60 / 90, 5)
    })

    it('does not re-strike a tie-stop note (tiesBack skips midi)', () => {
        const { player, scheduled, raw } = fakePlayer()
        const scheduler = new ScoreScheduler(player)
        const score = new Score()
        const m = score.addMeasure(0)
        const stop = new Note({ duration: new Duration({ type: 'q' }), pitch: new Pitch({ name: 'C', octave: 4 }), tie: 'stop' })
        m.addNotes([stop])
        scheduler.score = score
        scheduler.reset()

        raw.currentTime = 100
        scheduler.tick()
        expect(scheduled).toHaveLength(0)
        // Still recorded in the timeline so the cursor advances over it.
        expect(scheduler.entries).toHaveLength(1)
    })

    it('advances measureIdx when the current measure is exhausted, and finishes', () => {
        const { player, scheduled, raw } = fakePlayer()
        const scheduler = new ScoreScheduler(player)
        scheduler.score = scoreWithNotes([pitched('C', 4)], [pitched('D', 4)])
        scheduler.reset()

        raw.currentTime = 100
        const done = scheduler.tick()
        expect(scheduled).toHaveLength(2)
        expect(scheduler.entries.map((e) => e.measureIndex)).toEqual([0, 1])
        expect(done).toBe(true)
    })

    it('schedules incrementally as the clock advances within the look-ahead window', () => {
        const { player, scheduled, raw } = fakePlayer()
        const scheduler = new ScoreScheduler(player)
        scheduler.score = scoreWithNotes([pitched('C', 4), pitched('D', 4), pitched('E', 4), pitched('F', 4)])
        scheduler.reset()

        raw.currentTime = 0
        scheduler.tick()
        const afterFirst = scheduled.length
        // Only the note(s) within now + LOOK_AHEAD are scheduled, not all four.
        expect(afterFirst).toBeGreaterThanOrEqual(1)
        expect(afterFirst).toBeLessThan(4)

        // Advance the clock; more notes come into the window.
        raw.currentTime = 60 / 90
        scheduler.tick()
        expect(scheduled.length).toBeGreaterThan(afterFirst)
    })

    it('reset() is a no-op tempo-wise when no score is set', () => {
        const { player } = fakePlayer()
        const scheduler = new ScoreScheduler(player)
        expect(() => scheduler.reset()).not.toThrow()
        // Stays at default bpm; tick() is immediately done with no score.
        expect(scheduler.tick()).toBe(true)
    })

    it('reset() handles an empty score with no first measure', () => {
        const { player } = fakePlayer()
        const scheduler = new ScoreScheduler(player)
        scheduler.score = new Score() // no measures => firstMeasure is null
        expect(() => scheduler.reset()).not.toThrow()
    })

    it('startNote begins playback at the selected note, mid-measure', () => {
        const { player, scheduled, raw } = fakePlayer()
        const scheduler = new ScoreScheduler(player)
        const score = scoreWithNotes([pitched('C', 4), pitched('D', 4), pitched('E', 4), pitched('F', 4)])
        scheduler.score = score
        scheduler.startNote = score.measures[0].notes[2] // start at the E
        scheduler.reset()

        raw.currentTime = 100
        scheduler.tick()

        // Only the E and F sound; the first entry sits at time 0 and reports its true beat.
        const eMidi = new Pitch({ name: 'E', octave: 4 }).toMidi()
        expect(scheduled.map((n) => n.midi)).toEqual([eMidi, new Pitch({ name: 'F', octave: 4 }).toMidi()])
        expect(scheduler.entries.map((e) => e.beat)).toEqual([2, 3])
        expect(scheduler.entries[0].startTime).toBeCloseTo(0, 5)
    })

    it('startNote can begin in a later measure', () => {
        const { player, scheduled, raw } = fakePlayer()
        const scheduler = new ScoreScheduler(player)
        const score = scoreWithNotes([pitched('C', 4)], [pitched('D', 4)])
        scheduler.score = score
        scheduler.startNote = score.measures[1].notes[0]
        scheduler.reset()

        raw.currentTime = 100
        scheduler.tick()
        expect(scheduled.map((n) => n.midi)).toEqual([new Pitch({ name: 'D', octave: 4 }).toMidi()])
        expect(scheduler.entries.map((e) => e.measureIndex)).toEqual([1])
    })

    it('startNote seeds the tempo prevailing at the start note (carried from an earlier marking)', () => {
        const { player, raw } = fakePlayer()
        const scheduler = new ScoreScheduler(player)
        const score = scoreWithNotes([pitched('C', 4), pitched('D', 4)], [pitched('E', 4), pitched('F', 4)])
        score.measures[0].setTempo(0, 60) // carries into measure 1
        scheduler.score = score
        scheduler.startNote = score.measures[1].notes[0]
        scheduler.reset()

        raw.currentTime = 100
        scheduler.tick()
        // 60bpm carried forward => the start note's quarter lasts 1s.
        expect(scheduler.entries[0].duration).toBeCloseTo(1, 5)
    })

    it('startNote from a different score is ignored (falls back to the top)', () => {
        const { player, scheduled, raw } = fakePlayer()
        const scheduler = new ScoreScheduler(player)
        scheduler.score = scoreWithNotes([pitched('C', 4), pitched('D', 4)])
        // A stale selection left over from another score must not redirect playback.
        const otherScore = scoreWithNotes([pitched('G', 4)])
        scheduler.startNote = otherScore.measures[0].notes[0]
        scheduler.reset()

        raw.currentTime = 100
        scheduler.tick()
        expect(scheduled).toHaveLength(2)
        expect(scheduler.entries[0].measureIndex).toBe(0)
    })

    it('reset() clears prior entries and re-reads tempo', () => {
        const { player, raw } = fakePlayer()
        const scheduler = new ScoreScheduler(player)
        scheduler.score = scoreWithNotes([pitched('C', 4)])
        scheduler.reset()
        raw.currentTime = 100
        scheduler.tick()
        expect(scheduler.entries.length).toBeGreaterThan(0)

        scheduler.reset()
        expect(scheduler.entries).toHaveLength(0)
        expect(scheduler.endTime).toBe(-1)
    })
})
