import { Duration } from '@mushee/notation/model/Duration'
import { Instrument } from '@mushee/notation/model/Instrument'
import { Note } from '@mushee/notation/model/Note'
import { Pitch } from '@mushee/notation/model/Pitch'
import { Score } from '@mushee/notation/model/Score'
import { pitched, rest } from '@mushee/notation/testing'
import { Metronome } from '@mushee/playback/Metronome'
import { ScoreScheduler } from '@mushee/playback/ScoreScheduler'
import { describe, expect, it } from 'vitest'

import { fakePlayer } from './fakePlayer'

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
    it('with no score, reset() is safe and tick() reports done', () => {
        const { player } = fakePlayer()
        const scheduler = new ScoreScheduler(player)
        expect(() => scheduler.reset()).not.toThrow()
        expect(scheduler.tick()).toBe(true)
    })

    it('has not finished while still scheduling, and finishes once the last note ends', () => {
        const { player } = fakePlayer()
        const scheduler = new ScoreScheduler(player)
        scheduler.cue(scoreWithNotes([pitched('C', 4), pitched('D', 4), pitched('E', 4), pitched('F', 4)]))
        scheduler.reset()

        expect(scheduler.hasFinishedAt(100)).toBe(false)

        // 4 quarter notes at 90bpm => each lasts 60/90 = 0.666...s.
        player.currentTime = 0
        expect(scheduler.tick()).toBe(false) // schedules up to look-ahead
        expect(scheduler.hasFinishedAt(100)).toBe(false)
        // Advance the clock past the end so the loop walks off the end of the measures.
        player.currentTime = 100
        expect(scheduler.tick()).toBe(true)
        expect(scheduler.hasFinishedAt((4 * 60) / 90 - 0.01)).toBe(false)
        expect(scheduler.hasFinishedAt((4 * 60) / 90)).toBe(true)
    })

    it('schedules a midi note per pitched note and skips rests', () => {
        const { player, scheduled } = fakePlayer()
        const scheduler = new ScoreScheduler(player)
        scheduler.cue(scoreWithNotes([pitched('C', 4), rest('q'), pitched('E', 4), rest('q')]))
        scheduler.reset()

        player.currentTime = 100
        scheduler.tick()

        // Two pitched notes scheduled; the rests still carry the position along.
        expect(scheduled).toHaveLength(2)
        expect(scheduler.positionAt(60 / 90)).toEqual({ measureIndex: 0, beat: 1 })
        expect(scheduler.positionAt((3 * 60) / 90)).toEqual({ measureIndex: 0, beat: 3 })
        const cMidi = new Pitch({ name: 'C', octave: 4 }).toMidi()
        expect(scheduled[0].midi).toBe(cMidi)
        expect(scheduled[0].startTime).toBeCloseTo(0, 5)
        // The third entry (index 2) is the E note, which starts after 2 quarter beats.
        expect(scheduled[1].startTime).toBeCloseTo((2 * 60) / 90, 5)
    })

    it('applies the instrument chromatic transpose to the scheduled midi', () => {
        const { player, scheduled } = fakePlayer()
        const scheduler = new ScoreScheduler(player)
        const score = scoreWithNotes([pitched('C', 4)])
        // Clarinet sounds a major second below written pitch (chromaticTranspose === -2).
        // seedInstrument keeps the written pitch as-is so the transpose is observable at schedule time
        // (setInstrument would rewrite the note to preserve the sounding pitch instead).
        score.seedInstrument(Instrument.Clarinet)
        expect(Instrument.Clarinet.chromaticTranspose).not.toBe(0)
        scheduler.cue(score)
        scheduler.reset()
        player.currentTime = 100
        scheduler.tick()
        const expected = new Pitch({ name: 'C', octave: 4 }).toMidi() + Instrument.Clarinet.chromaticTranspose
        expect(scheduled[0].midi).toBe(expected)
        expect(scheduled[0].instrument).toBe(Instrument.Clarinet)
    })

    it('positions the pass through each note by interpolating its beats over its time', () => {
        const { player } = fakePlayer()
        const scheduler = new ScoreScheduler(player)
        scheduler.cue(scoreWithNotes([pitched('C', 4, 'h'), pitched('E', 4, 'h')]))
        scheduler.reset()
        player.currentTime = 100
        scheduler.tick()

        expect(scheduler.positionAt(0)).toEqual({ measureIndex: 0, beat: 0 })
        // Halfway through the first half note.
        expect(scheduler.positionAt(60 / 90)?.beat).toBeCloseTo(1, 9)
        // The latest note that has begun wins: the E from its onset on.
        expect(scheduler.positionAt((2 * 60) / 90)).toEqual({ measureIndex: 0, beat: 2 })
        expect(scheduler.positionAt((3 * 60) / 90)?.beat).toBeCloseTo(3, 9)
    })

    it('has no position before the first onset', () => {
        const { player } = fakePlayer()
        const scheduler = new ScoreScheduler(player)
        scheduler.cue(scoreWithNotes([pitched('C', 4)]))
        scheduler.reset()
        player.currentTime = 100
        scheduler.tick()
        expect(scheduler.positionAt(-1)).toBeNull()
    })

    it("holds the position at a note's end until the next onset (an underfull measure leaves a gap)", () => {
        const { player } = fakePlayer()
        const scheduler = new ScoreScheduler(player)
        scheduler.cue(scoreWithNotes([pitched('C', 4)], [pitched('D', 4)]))
        scheduler.reset()
        player.currentTime = 100
        scheduler.tick()

        // The C ends at beat 1; the measure still lasts four beats before the D.
        expect(scheduler.positionAt((3 * 60) / 90)).toEqual({ measureIndex: 0, beat: 1 })
        expect(scheduler.positionAt((4 * 60) / 90)).toEqual({ measureIndex: 1, beat: 0 })
    })

    it('respects a measure-start tempo marking', () => {
        const { player, scheduled } = fakePlayer()
        const scheduler = new ScoreScheduler(player)
        const score = scoreWithNotes([pitched('C', 4), pitched('D', 4), pitched('E', 4), pitched('F', 4)])
        const firstMeasure = score.firstMeasure
        if (!firstMeasure) throw new Error('expected a first measure')
        firstMeasure.setTempo(0, 120)
        scheduler.cue(score)
        scheduler.reset()

        player.currentTime = 100
        scheduler.tick()
        // At 120bpm a quarter note lasts 0.5s; the second note starts then.
        expect(scheduled[1].startTime).toBeCloseTo(0.5, 5)
    })

    it('picks up the first-measure tempo during reset()', () => {
        const { player, scheduled } = fakePlayer()
        const scheduler = new ScoreScheduler(player)
        const score = scoreWithNotes([pitched('C', 4), pitched('D', 4)])
        const firstMeasure = score.firstMeasure
        if (!firstMeasure) throw new Error('expected a first measure')
        firstMeasure.setTempo(0, 60)
        scheduler.cue(score)
        scheduler.reset()

        player.currentTime = 100
        scheduler.tick()
        // 60bpm => quarter note lasts 1s.
        expect(scheduled[0].duration).toBeCloseTo(1, 5)
    })

    it('respects a mid-measure tempo change (beat > 0)', () => {
        const { player, scheduled } = fakePlayer()
        const scheduler = new ScoreScheduler(player)
        const score = scoreWithNotes([pitched('C', 4), pitched('D', 4), pitched('E', 4), pitched('F', 4)])
        const m = score.firstMeasure
        if (!m) throw new Error('expected a first measure')
        m.setTempo(2, 180) // change tempo at beat 2
        scheduler.cue(score)
        scheduler.reset()

        player.currentTime = 100
        scheduler.tick()
        // First two notes at 90bpm (0.666s each), the rest at 180bpm (0.333s each).
        const q90 = 60 / 90
        const q180 = 60 / 180
        expect(scheduled[2].startTime).toBeCloseTo(2 * q90, 5)
        expect(scheduled[3].startTime).toBeCloseTo(2 * q90 + q180, 5)
    })

    it('a marking between onsets takes effect at its exact beat', () => {
        const { player, scheduled } = fakePlayer()
        const scheduler = new ScoreScheduler(player)
        const score = scoreWithNotes([pitched('C', 4, 'h'), pitched('E', 4, 'h')])
        score.measures[0].setTempo(0, 60)
        score.measures[0].addTempo(1, 120) // mid-way through the C
        scheduler.cue(score)
        scheduler.reset()

        player.currentTime = 100
        scheduler.tick()
        // The C: one beat at 60bpm (1s) + one at 120bpm (0.5s).
        expect(scheduled[0].duration).toBeCloseTo(1.5, 5)
        expect(scheduled[1].startTime).toBeCloseTo(1.5, 5)
        expect(scheduled[1].duration).toBeCloseTo(1, 5)
    })

    it('metronome clicks land on the note onsets when a marking sits between them', () => {
        const notes = fakePlayer()
        const clicks = fakePlayer()
        const score = scoreWithNotes([pitched('C', 4), pitched('D', 4), pitched('E', 4), pitched('F', 4)])
        score.measures[0].setTempo(0, 60)
        score.measures[0].addTempo(1.5, 120) // between the D and E onsets
        const scheduler = new ScoreScheduler(notes.player)
        const metronome = new Metronome(clicks.player)
        scheduler.cue(score)
        metronome.cue(score)
        scheduler.reset()
        metronome.reset()

        notes.player.currentTime = 100
        clicks.player.currentTime = 100
        scheduler.tick()
        metronome.tick()
        expect(notes.scheduled.map((n) => n.startTime)).toEqual([0, 1, 1.75, 2.25])
        expect(clicks.scheduled.map((n) => n.startTime)).toEqual(notes.scheduled.map((n) => n.startTime))
    })

    it('starting at a note keeps every later onset where playing from the top puts it', () => {
        const score = scoreWithNotes(
            [pitched('C', 4), pitched('D', 4), pitched('E', 4), pitched('F', 4)],
            [pitched('G', 4, 'h'), pitched('A', 4, 'h')],
        )
        score.measures[0].setTempo(0, 60)
        score.measures[0].addTempo(2.5, 150)
        score.measures[1].addTempo(1, 75)
        const onsets = (startNote: Note | null) => {
            const { player, scheduled } = fakePlayer()
            const scheduler = new ScoreScheduler(player)
            scheduler.cue(score, startNote)
            scheduler.reset()
            player.currentTime = 100
            scheduler.tick()
            return scheduled.map((n) => n.startTime)
        }

        const fromTop = onsets(null)
        const fromE = onsets(score.measures[0].notes[2])
        const shared = fromTop.slice(2).map((t) => t - fromTop[2])
        expect(fromE).toHaveLength(shared.length)
        fromE.forEach((t, i) => expect(t).toBeCloseTo(shared[i], 9))
    })

    it('extends a forward-tied note over its tied continuation for audio duration', () => {
        const { player, scheduled } = fakePlayer()
        const scheduler = new ScoreScheduler(player)
        const score = new Score()
        const m = score.addMeasure(0)
        const start = new Note({ duration: new Duration({ type: 'q' }), pitch: new Pitch({ name: 'C', octave: 4 }), tie: 'start' })
        const stop = new Note({ duration: new Duration({ type: 'q' }), pitch: new Pitch({ name: 'C', octave: 4 }), tie: 'stop' })
        m.addNotes([start, stop])
        scheduler.cue(score)
        scheduler.reset()

        player.currentTime = 100
        scheduler.tick()

        // Only the tie-start note sounds (the tie-stop note tiesBack and is not re-struck).
        expect(scheduled).toHaveLength(1)
        // Its audio duration spans both quarter notes => 2 * 60/90.
        expect(scheduled[0].duration).toBeCloseTo((2 * 60) / 90, 5)
    })

    it('does not re-strike the continuation of a start-only tie (no explicit stop, as the editor creates)', () => {
        const { player, scheduled } = fakePlayer()
        const scheduler = new ScoreScheduler(player)
        const score = new Score()
        const m = score.addMeasure(0)
        // Editor- and model-created ties only mark 'start' on the first note.
        const start = new Note({ duration: new Duration({ type: 'q' }), pitch: new Pitch({ name: 'C', octave: 4 }), tie: 'start' })
        const continuation = new Note({ duration: new Duration({ type: 'q' }), pitch: new Pitch({ name: 'C', octave: 4 }) })
        m.addNotes([start, continuation])
        scheduler.cue(score)
        scheduler.reset()

        player.currentTime = 100
        scheduler.tick()

        expect(scheduled).toHaveLength(1)
        expect(scheduled[0].duration).toBeCloseTo((2 * 60) / 90, 5)
        // The continuation is still on the timeline, so the cursor advances over it.
        expect(scheduler.positionAt(60 / 90)).toEqual({ measureIndex: 0, beat: 1 })
    })

    it("a tie chain across a barline holds at each measure's tempo", () => {
        const { player, scheduled } = fakePlayer()
        const scheduler = new ScoreScheduler(player)
        const held = new Note({ duration: new Duration({ type: 'h' }), pitch: new Pitch({ name: 'C', octave: 4 }), tie: 'start' })
        const into = new Note({ duration: new Duration({ type: 'h' }), pitch: new Pitch({ name: 'C', octave: 4 }) })
        const score = scoreWithNotes([pitched('E', 4, 'h'), held], [into, rest('h')])
        score.measures[1].setTempo(0, 120)
        scheduler.cue(score)
        scheduler.reset()

        player.currentTime = 100
        scheduler.tick()
        // Two beats at the default 90bpm, then two at 120bpm.
        expect(scheduled.map((n) => n.midi)).toEqual([64, 60])
        expect(scheduled[1].startTime).toBeCloseTo((2 * 60) / 90, 5)
        expect(scheduled[1].duration).toBeCloseTo((2 * 60) / 90 + (2 * 60) / 120, 5)
    })

    it('a lone tie-start note sounds for its own length', () => {
        const { player, scheduled } = fakePlayer()
        const scheduler = new ScoreScheduler(player)
        const score = new Score()
        const m = score.addMeasure(0)
        const lonely = new Note({ duration: new Duration({ type: 'q' }), pitch: new Pitch({ name: 'C', octave: 4 }), tie: 'start' })
        m.addNotes([lonely])
        scheduler.cue(score)
        scheduler.reset()

        player.currentTime = 100
        scheduler.tick()
        expect(scheduled).toHaveLength(1)
        expect(scheduled[0].duration).toBeCloseTo(60 / 90, 5)
    })

    it('does not re-strike a tie-stop note whose predecessor ties in, but strikes a stop with no tie behind it', () => {
        const { player, scheduled } = fakePlayer()
        const scheduler = new ScoreScheduler(player)
        const score = new Score()
        const m = score.addMeasure(0)
        const start = new Note({ duration: new Duration({ type: 'q' }), pitch: new Pitch({ name: 'C', octave: 4 }), tie: 'start' })
        const stop = new Note({ duration: new Duration({ type: 'q' }), pitch: new Pitch({ name: 'C', octave: 4 }), tie: 'stop' })
        // A stray 'stop' after a different pitch is not a continuation of anything: it must sound.
        const stray = new Note({ duration: new Duration({ type: 'q' }), pitch: new Pitch({ name: 'E', octave: 4 }), tie: 'stop' })
        m.addNotes([start, stop, stray])
        scheduler.cue(score)
        scheduler.reset()

        player.currentTime = 100
        scheduler.tick()
        expect(scheduled.map((s) => s.midi)).toEqual([60, 64]) // C once (held through its tie), then E
        // Every note is on the timeline, so the cursor advances over the silent continuation too.
        expect(scheduler.positionAt(60 / 90)).toEqual({ measureIndex: 0, beat: 1 })
        expect(scheduler.positionAt((2 * 60) / 90)).toEqual({ measureIndex: 0, beat: 2 })
    })

    it('advances measureIdx when the current measure is exhausted, and finishes', () => {
        const { player, scheduled } = fakePlayer()
        const scheduler = new ScoreScheduler(player)
        scheduler.cue(scoreWithNotes([pitched('C', 4)], [pitched('D', 4)]))
        scheduler.reset()

        player.currentTime = 100
        const done = scheduler.tick()
        expect(scheduled).toHaveLength(2)
        // The D opens the second measure, four beats in.
        expect(scheduled[1].startTime).toBeCloseTo((4 * 60) / 90, 5)
        expect(scheduler.positionAt((4 * 60) / 90)).toEqual({ measureIndex: 1, beat: 0 })
        expect(done).toBe(true)
    })

    it('schedules incrementally as the clock advances within the look-ahead window', () => {
        const { player, scheduled } = fakePlayer()
        const scheduler = new ScoreScheduler(player)
        scheduler.cue(scoreWithNotes([pitched('C', 4), pitched('D', 4), pitched('E', 4), pitched('F', 4)]))
        scheduler.reset()

        player.currentTime = 0
        scheduler.tick()
        const afterFirst = scheduled.length
        // Only the note(s) within now + Ticker.LOOK_AHEAD are scheduled, not all four.
        expect(afterFirst).toBeGreaterThanOrEqual(1)
        expect(afterFirst).toBeLessThan(4)

        // Advance the clock; more notes come into the window.
        player.currentTime = 60 / 90
        scheduler.tick()
        expect(scheduled.length).toBeGreaterThan(afterFirst)
    })

    it('reset() handles an empty score with no first measure', () => {
        const { player } = fakePlayer()
        const scheduler = new ScoreScheduler(player)
        scheduler.cue(new Score()) // no measures => firstMeasure is null
        expect(() => scheduler.reset()).not.toThrow()
    })

    it('startNote begins playback at the selected note, mid-measure', () => {
        const { player, scheduled } = fakePlayer()
        const scheduler = new ScoreScheduler(player)
        const score = scoreWithNotes([pitched('C', 4), pitched('D', 4), pitched('E', 4), pitched('F', 4)])
        scheduler.cue(score, score.measures[0].notes[2]) // start at the E
        scheduler.reset()

        player.currentTime = 100
        scheduler.tick()

        // Only the E and F sound; the E sits at time 0 and reports its true beat.
        const eMidi = new Pitch({ name: 'E', octave: 4 }).toMidi()
        expect(scheduled.map((n) => n.midi)).toEqual([eMidi, new Pitch({ name: 'F', octave: 4 }).toMidi()])
        expect(scheduled[0].startTime).toBeCloseTo(0, 5)
        expect(scheduler.positionAt(0)).toEqual({ measureIndex: 0, beat: 2 })
        expect(scheduler.positionAt(60 / 90)).toEqual({ measureIndex: 0, beat: 3 })
    })

    it('startNote can begin in a later measure', () => {
        const { player, scheduled } = fakePlayer()
        const scheduler = new ScoreScheduler(player)
        const score = scoreWithNotes([pitched('C', 4)], [pitched('D', 4)])
        scheduler.cue(score, score.measures[1].notes[0])
        scheduler.reset()

        player.currentTime = 100
        scheduler.tick()
        expect(scheduled.map((n) => n.midi)).toEqual([new Pitch({ name: 'D', octave: 4 }).toMidi()])
        expect(scheduler.positionAt(0)).toEqual({ measureIndex: 1, beat: 0 })
    })

    it('startNote seeds the tempo prevailing at the start note (carried from an earlier marking)', () => {
        const { player, scheduled } = fakePlayer()
        const scheduler = new ScoreScheduler(player)
        const score = scoreWithNotes([pitched('C', 4), pitched('D', 4)], [pitched('E', 4), pitched('F', 4)])
        score.measures[0].setTempo(0, 60) // carries into measure 1
        scheduler.cue(score, score.measures[1].notes[0])
        scheduler.reset()

        player.currentTime = 100
        scheduler.tick()
        // 60bpm carried forward => the start note's quarter lasts 1s.
        expect(scheduled[0].duration).toBeCloseTo(1, 5)
    })

    it('startNote from a different score is ignored (falls back to the top)', () => {
        const { player, scheduled } = fakePlayer()
        const scheduler = new ScoreScheduler(player)
        // A stale selection left over from another score must not redirect playback.
        const otherScore = scoreWithNotes([pitched('G', 4)])
        scheduler.cue(scoreWithNotes([pitched('C', 4), pitched('D', 4)]), otherScore.measures[0].notes[0])
        scheduler.reset()

        player.currentTime = 100
        scheduler.tick()
        expect(scheduled).toHaveLength(2)
        expect(scheduler.positionAt(0)).toEqual({ measureIndex: 0, beat: 0 })
    })

    it('reset() starts the timeline over', () => {
        const { player } = fakePlayer()
        const scheduler = new ScoreScheduler(player)
        scheduler.cue(scoreWithNotes([pitched('C', 4)]))
        scheduler.reset()
        player.currentTime = 100
        scheduler.tick()
        expect(scheduler.positionAt(0)).not.toBeNull()
        expect(scheduler.hasFinishedAt(100)).toBe(true)

        scheduler.reset()
        expect(scheduler.positionAt(0)).toBeNull()
        expect(scheduler.hasFinishedAt(100)).toBe(false)
    })
})
