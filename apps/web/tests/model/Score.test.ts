import { makeScore, pitched } from '@test/helpers'
import { describe, expect, it } from 'vitest'

import { MAX_MEASURES_PER_ROW } from '@/components/notation/constants'
import { Duration } from '@/model/Duration'
import { Instrument } from '@/model/Instrument'
import { Measure } from '@/model/Measure'
import { Note } from '@/model/Note'
import { Pitch } from '@/model/Pitch'
import { Score } from '@/model/Score'
import { TimeSignature } from '@/model/TimeSignature'

describe('Score', () => {
    describe('version & onChange', () => {
        it('every score-level mutation bumps the version and fires onChange', () => {
            let calls = 0
            const score = new Score(() => calls++)
            const before = score.version
            score.addMeasure()
            expect(score.version).toBeGreaterThan(before)
            expect(calls).toBe(1)
        })

        it('measure-content mutations bump the score version without firing onChange', () => {
            let calls = 0
            const score = new Score(() => calls++)
            const m = score.addMeasure()
            calls = 0
            const before = score.version
            m.setTempo(0, 120) // measure-level mutation goes through measureChanged
            expect(score.version).toBeGreaterThan(before)
            expect(calls).toBe(0)
        })

        it('a score without an onChange callback mutates without error', () => {
            const score = new Score()
            expect(() => score.addMeasure()).not.toThrow()
        })
    })

    describe('layout gateway', () => {
        it('returns the same layout instance while the version is unchanged', () => {
            const score = makeScore(1)
            expect(score.layout).toBe(score.layout)
        })

        it('rebuilds the layout (new instance, new id) after a mutation', () => {
            const score = makeScore(1)
            const before = score.layout
            score.addMeasure()
            const after = score.layout
            expect(after).not.toBe(before)
            expect(after.id).not.toBe(before.id)
        })

        it('reuses unmutated sub-layouts across a rebuild', () => {
            const score = makeScore(2)
            const [m0, m1] = score.measures
            const row0 = score.layout.rows[0]
            const m0Layout = m0.layout
            const m1Layout = m1.layout
            m1.setTempo(0, 120) // width-neutral content change in m1 only
            expect(score.layout.rows[0]).toBe(row0) // row inputs unchanged → same instance
            expect(m0.layout).toBe(m0Layout) // untouched measure keeps its layout
            expect(m1.layout).not.toBe(m1Layout) // mutated measure gets a new one
            expect(m1.layout.id).not.toBe(m1Layout.id)
        })
    })

    describe('addMeasure', () => {
        it('adds a fresh measure to an empty score', () => {
            const score = new Score()
            const m = score.addMeasure()
            expect(score.measures).toContain(m)
            expect(score.firstMeasure).toBe(m)
            expect(score.lastMeasure).toBe(m)
        })

        it('defaults to treble clef, C major and 4/4 on an empty score', () => {
            const score = new Score()
            const m = score.addMeasure()
            expect(m.clef.type).toBe('treble')
            expect(m.keySignature.fifths).toBe(0)
            expect(m.timeSignature.maxBeats).toBe(4)
        })

        it('inherits clef, key (incl. mode) and time signature from the previous measure', () => {
            const score = new Score()
            const a = score.addMeasure()
            a.complete()
            a.setTimeSignature(new TimeSignature(3, 4))
            score.setClef(a.firstNote, 'bass')
            score.setKeySignature(a.firstNote, 3, 'minor')
            const b = score.addMeasure()
            expect(b.clef.type).toBe('bass')
            expect(b.keySignature.fifths).toBe(3)
            expect(b.keySignature.mode).toBe('minor')
            expect(b.timeSignature).toBe(a.timeSignature) // value object shared across measures
        })

        it('end barline is "end" on the last measure, "single" on others', () => {
            const score = new Score()
            const a = score.addMeasure()
            const b = score.addMeasure()
            expect(a.endBarline).toBe('single')
            expect(b.endBarline).toBe('end')
        })

        it('preserves an explicit barline on the previous measure when appending (only positional "end" is demoted)', () => {
            const score = new Score()
            const a = score.addMeasure()
            a.setEndBarline('double')
            score.addMeasure()
            expect(a.endBarline).toBe('double')
        })

        it('preserves an explicit barline on a pre-built measure inserted mid-score', () => {
            const score = makeScore(2)
            const withDouble = new Measure(score, 'treble', new TimeSignature(4, 4), { endBarline: 'double' })
            withDouble.complete()
            score.addMeasure(1, withDouble)
            expect(withDouble.endBarline).toBe('double')
            expect(score.lastMeasure?.endBarline).toBe('end')
        })

        it('preserves an explicit barline on a pre-built measure appended at the end', () => {
            const score = makeScore(1)
            const withNone = new Measure(score, 'treble', new TimeSignature(4, 4), { endBarline: 'none' })
            withNone.complete()
            score.addMeasure(undefined, withNone)
            expect(withNone.endBarline).toBe('none')
        })

        it('triggers a row rebuild when the measure no longer fits', () => {
            const score = makeScore(MAX_MEASURES_PER_ROW + 1)
            expect(score.layout.rows.length).toBeGreaterThanOrEqual(2)
        })
    })

    describe('removeLastMeasure', () => {
        it('removes the last measure and re-applies the end barline', () => {
            const score = makeScore(2)
            const lastBefore = score.lastMeasure
            if (!lastBefore) throw new Error('expected lastMeasure')
            score.removeLastMeasure()
            expect(score.measures).not.toContain(lastBefore)
            expect(score.lastMeasure?.endBarline).toBe('end')
        })

        it('preserves an explicit style on the new last measure instead of forcing "end"', () => {
            const score = makeScore(3)
            score.measures[1].setEndBarline('double')
            score.removeLastMeasure()
            expect(score.lastMeasure?.endBarline).toBe('double')
        })

        it('drops the row when its last measure is removed', () => {
            const score = makeScore(MAX_MEASURES_PER_ROW + 1)
            const rowsBefore = score.layout.rows.length
            score.removeLastMeasure()
            expect(score.layout.rows.length).toBeLessThanOrEqual(rowsBefore)
        })

        it('is a no-op (does not crash) when the score is empty', () => {
            const score = new Score()
            expect(() => score.removeLastMeasure()).not.toThrow()
        })
    })

    describe('navigation', () => {
        it('getNextMeasure / getPreviousMeasure', () => {
            const score = makeScore(3)
            const [a, b, c] = score.measures
            expect(score.getNextMeasure(a)).toBe(b)
            expect(score.getNextMeasure(b)).toBe(c)
            expect(score.getNextMeasure(c)).toBeNull()
            expect(score.getPreviousMeasure(c)).toBe(b)
            expect(score.getPreviousMeasure(a)).toBeNull()
        })

        it('getNextMeasure() with no arg returns first measure', () => {
            const score = makeScore(2)
            expect(score.getNextMeasure()).toBe(score.firstMeasure)
        })

        it('getNextMeasure returns null for a measure not in the index map', () => {
            const score = makeScore(1)
            const stray = new Measure(score, 'treble', new TimeSignature(4, 4))
            expect(score.getNextMeasure(stray)).toBeNull()
        })

        it('nextNote walks within a measure, across measures, and off the end', () => {
            const score = makeScore(2)
            const [m0, m1] = score.measures
            const first = m0.firstNote
            const lastOfM0 = m0.lastNote
            const lastOfScore = m1.lastNote
            if (!first || !lastOfM0 || !lastOfScore) throw new Error('expected notes')
            expect(score.nextNote(first)).toBe(m0.notes[1])
            expect(score.nextNote(lastOfM0)).toBe(m1.firstNote)
            expect(score.nextNote(lastOfScore)).toBeNull()
        })

        it('previousNote walks within a measure, across measures, and off the start', () => {
            const score = makeScore(2)
            const [m0, m1] = score.measures
            const firstOfM1 = m1.firstNote
            const firstOfScore = m0.firstNote
            if (!firstOfM1 || !firstOfScore) throw new Error('expected notes')
            expect(score.previousNote(m0.notes[1])).toBe(firstOfScore)
            expect(score.previousNote(firstOfM1)).toBe(m0.lastNote)
            expect(score.previousNote(firstOfScore)).toBeNull()
        })

        it('nextNote / previousNote are null when the adjacent measure is empty', () => {
            const score = new Score()
            const m0 = score.addMeasure()
            m0.complete()
            score.addMeasure() // empty: no notes
            const last = m0.lastNote
            if (!last) throw new Error('expected last note')
            expect(score.nextNote(last)).toBeNull()
            const score2 = new Score()
            score2.addMeasure() // empty
            const m = score2.addMeasure()
            m.complete()
            const first = m.firstNote
            if (!first) throw new Error('expected first note')
            expect(score2.previousNote(first)).toBeNull()
        })
    })

    describe('row layout reactions', () => {
        it('a 5th measure goes onto a new row (MAX_MEASURES_PER_ROW = 4)', () => {
            const score = makeScore(MAX_MEASURES_PER_ROW + 1)
            expect(score.layout.rows.length).toBe(2)
            expect(score.layout.rows[0].measures.length).toBe(MAX_MEASURES_PER_ROW)
            expect(score.layout.rows[1].measures.length).toBe(1)
        })

        it('first measure of every row showsClef = true', () => {
            const score = makeScore(MAX_MEASURES_PER_ROW + 1)
            for (const row of score.layout.rows) {
                expect(row.measures[0].layout.showsClef).toBe(true)
            }
        })

        it('first measure of subsequent rows still showsClef even though prev clef matches', () => {
            const score = makeScore(MAX_MEASURES_PER_ROW + 1)
            // 2nd row first measure inherited treble clef but should still display it
            expect(score.layout.rows[1].measures[0].layout.showsClef).toBe(true)
        })
    })

    describe('replace()', () => {
        it('rejects empty target list', () => {
            const score = makeScore(1)
            expect(() => score.replace([], [pitched('C', 4)])).toThrow()
        })

        it('rejects empty value list', () => {
            const score = makeScore(1)
            const m = score.firstMeasure
            if (!m) throw new Error('expected firstMeasure')
            const target = m.firstNote
            if (!target) throw new Error('expected firstNote')
            expect(() => score.replace([target], [])).toThrow()
        })

        it('replaces a single rest with a pitched quarter note', () => {
            const score = makeScore(1)
            const m = score.firstMeasure
            if (!m) throw new Error('expected firstMeasure')
            const target = m.firstNote
            if (!target) throw new Error('expected firstNote')
            const value = pitched('C', 4)
            const newNotes = score.replace([target], [value])
            expect(newNotes.length).toBeGreaterThan(0)
            // beat count preserved
            expect(m.beats).toBeCloseTo(m.maxBeats)
        })

        it('pads a too-short replacement with rests in the freed space', () => {
            const score = makeScore(1)
            const m = score.firstMeasure
            if (!m) throw new Error('expected firstMeasure')
            const target = m.firstNote // a quarter rest (1 beat)
            if (!target) throw new Error('expected firstNote')
            score.replace([target], [pitched('C', 4, '8')]) // half the space
            expect(m.beats).toBeCloseTo(m.maxBeats)
            expect(m.notes[0].duration.type).toBe('8')
            expect(m.notes[1].duration.type).toBe('8')
            expect(m.notes[1].isRest).toBe(true)
        })

        it('extends across measure boundary if values exceed targets', () => {
            const score = makeScore(2)
            const m1 = score.measures[0]
            const target = m1.firstNote
            if (!target) throw new Error('expected firstNote')
            // single quarter rest target, replace with a whole note (4 beats)
            const longValue = new Note({ duration: new Duration({ type: 'w' }) })
            score.replace([target], [longValue])
            // the score shouldn't lose total beats; both measures still complete
            expect(m1.beats).toBeCloseTo(m1.maxBeats)
        })

        it('appends a new measure when the replacement overruns the only measure', () => {
            const score = makeScore(1)
            expect(score.measures).toHaveLength(1)
            const target = score.measures[0].lastNote // last quarter rest, only 1 free beat after it
            if (!target) throw new Error('expected last note')
            // A whole note (4 beats) overruns the last beat of the only measure, forcing a new measure.
            score.replace([target], [new Note({ duration: new Duration({ type: 'w' }) })])
            expect(score.measures.length).toBeGreaterThan(1)
            expect(score.measures[0].beats).toBeCloseTo(score.measures[0].maxBeats)
            expect(score.lastMeasure?.beats).toBeCloseTo(score.lastMeasure?.maxBeats ?? 0)
        })

        it('splits an overrunning note into a remainder of several tied durations in the next bar', () => {
            const score = makeScore(2)
            const m1 = score.measures[0]
            const m2 = score.measures[1]
            const lastOfM1 = m1.lastNote
            if (!lastOfM1) throw new Error('expected last note of measure 1')
            // Reshape the tail of measure 1 to end on a 16th note (0.25 free beat at the boundary).
            score.replace([lastOfM1], [new Note({ duration: new Duration({ type: '8', dots: 1 }) }), new Note({ duration: new Duration({ type: '16' }) })])
            const sixteenth = m1.lastNote
            if (!sixteenth) throw new Error('expected 16th note')
            expect(sixteenth.duration.type).toBe('16')
            // Replace that 16th with a half note (2 beats): 0.25 fills measure 1, the 1.75-beat remainder
            // lands in measure 2 and must decompose into a dotted-quarter tied to a sixteenth.
            score.replace([sixteenth], [new Note({ duration: new Duration({ type: 'h' }), pitch: new Pitch({ name: 'C', octave: 5 }) })])
            expect(m1.beats).toBeCloseTo(m1.maxBeats)
            expect(m2.beats).toBeCloseTo(m2.maxBeats)
            // Measure 2 opens with the multi-part remainder: a dotted quarter tied onward, then a sixteenth.
            const head = m2.firstNote
            expect(head?.duration.type).toBe('q')
            expect(head?.duration.dots).toBe(1)
            expect(head?.tie).toBe('start')
            expect(head?.pitch?.name).toBe('C')
            expect(m2.notes[1]?.duration.type).toBe('16')
        })
    })

    describe('replace across a measure boundary', () => {
        it('splits a value note that overruns the bar: the overflow is tied into the next measure', () => {
            const score = makeScore(2)
            const m1 = score.measures[0]
            const m2 = score.measures[1]
            const lastOfM1 = m1.lastNote // the quarter rest at beat 3
            if (!lastOfM1) throw new Error('expected last note of measure 1')
            // A half note (2 beats) placed in the final beat of measure 1 must straddle into measure 2.
            const newNotes = score.replace([lastOfM1], [pitched('C', 5, 'h')])
            expect(newNotes.length).toBeGreaterThan(0)
            // Beat totals are preserved in both measures.
            expect(m1.beats).toBeCloseTo(m1.maxBeats)
            expect(m2.beats).toBeCloseTo(m2.maxBeats)
            // The tail of measure 1 is the start of a tie...
            const m1Tail = m1.lastNote
            expect(m1Tail?.tie).toBe('start')
            expect(m1Tail?.pitch?.name).toBe('C')
            // ...continued by the head of measure 2 carrying the same pitch.
            const m2Head = m2.firstNote
            expect(m2Head?.pitch?.name).toBe('C')
            // The semantic tie pairing connects the two halves.
            if (!m1Tail) throw new Error('expected tail note')
            expect(score.tiePartner(m1Tail)).toBe(m2Head)
        })
    })

    describe('setDuration', () => {
        function scoreWithTriplet() {
            const score = makeScore(1)
            const m = score.firstMeasure
            if (!m?.firstNote) throw new Error('expected firstNote')
            const [note] = score.replace([m.firstNote], [pitched('C', 4)])
            const first = score.toggleTuplet(note)
            if (!first) throw new Error('expected triplet first note')
            return { score, m, first }
        }

        it('changes a plain note like before (dots reset on type change)', () => {
            const score = makeScore(1)
            const m = score.firstMeasure
            if (!m?.firstNote) throw new Error('expected firstNote')
            const newNote = score.setDuration(m.firstNote, { type: 'h', dots: 0 })
            expect(newNote?.duration.type).toBe('h')
            expect(m.beats).toBeCloseTo(m.maxBeats)
        })

        it('lengthening the 2nd triplet note stays in tuplet space, consuming the 3rd slot', () => {
            const { score, m, first } = scoreWithTriplet()
            const newNote = score.setDuration(m.notes[1], { type: 'q' })
            expect(newNote?.duration.type).toBe('q')
            expect(newNote?.duration.ratio).toEqual({ actualNotes: 3, normalNotes: 2 })
            expect(m.tupletGroupOf(first)?.notes).toHaveLength(2) // eighth + quarter triplet
            expect(m.beats).toBeCloseTo(m.maxBeats)
        })

        it('shortening the 2nd triplet note pads the freed slot space with a tuplet rest', () => {
            const { score, m, first } = scoreWithTriplet()
            const newNote = score.setDuration(m.notes[1], { type: '16' })
            expect(newNote?.duration.type).toBe('16')
            expect(newNote?.duration.ratio).toEqual({ actualNotes: 3, normalNotes: 2 })
            const group = m.tupletGroupOf(first)
            expect(group?.notes).toHaveLength(4) // 8th, 16th, 16th rest, 8th
            expect(group?.notes[2].isRest).toBe(true)
            expect(m.beats).toBeCloseTo(m.maxBeats)
        })

        it('a duration that does not fit before the group end is clipped to the remaining slots', () => {
            const { score, m, first } = scoreWithTriplet()
            const newNote = score.setDuration(m.notes[2], { type: 'q' }) // last slot: only an eighth fits
            expect(newNote?.duration.type).toBe('8')
            expect(m.tupletGroupOf(first)?.notes).toHaveLength(3)
            expect(m.beats).toBeCloseTo(m.maxBeats)
        })

        it('a duration covering the whole group from its first slot leaves tuplet space', () => {
            const { score, m, first } = scoreWithTriplet()
            const newNote = score.setDuration(first, { type: 'h' })
            expect(newNote?.duration.type).toBe('q') // group spanned a quarter
            expect(newNote?.inTuplet).toBe(false)
            expect(newNote?.pitch?.name).toBe('C')
            expect(m.tuplets).toHaveLength(0)
            expect(m.beats).toBeCloseTo(m.maxBeats)
        })

        it('dotting a triplet note works in tuplet space', () => {
            const { score, m, first } = scoreWithTriplet()
            const newNote = score.setDuration(m.notes[1], { dots: 1 })
            expect(newNote?.duration.dots).toBe(1)
            const group = m.tupletGroupOf(first)
            expect(group?.notes).toHaveLength(3) // 8th, dotted 8th, 16th rest
            expect(group?.notes[2].duration.type).toBe('16')
            expect(m.beats).toBeCloseTo(m.maxBeats)
        })

        it('returns null without a note', () => {
            const score = makeScore(1)
            expect(score.setDuration(null, { type: 'q' })).toBeNull()
        })
    })

    describe('toggleTuplet', () => {
        function scoreWithPitchedFirstNote() {
            const score = makeScore(1)
            const m = score.firstMeasure
            if (!m?.firstNote) throw new Error('expected firstNote')
            const [note] = score.replace([m.firstNote], [pitched('C', 4)])
            return { score, m, note }
        }

        it('wraps a quarter note into a triplet of eighths (pitch first, rests after)', () => {
            const { score, m, note } = scoreWithPitchedFirstNote()
            const newNote = score.toggleTuplet(note)
            if (!newNote) throw new Error('expected toggleTuplet to return a note')
            expect(newNote.duration.type).toBe('8')
            expect(newNote.duration.ratio).toEqual({ actualNotes: 3, normalNotes: 2 })
            expect(newNote.pitch?.name).toBe('C')
            const tuplet = m.tupletGroupOf(newNote)
            expect(tuplet?.notes).toHaveLength(3)
            expect(tuplet?.notes.slice(1).every((n) => n.isRest)).toBe(true)
            expect(m.beats).toBeCloseTo(m.maxBeats)
        })

        it('does not consume the note following the tuplet', () => {
            const { score, m, note } = scoreWithPitchedFirstNote()
            const following = m.notes[1]
            score.toggleTuplet(note)
            expect(m.notes).toContain(following)
            expect(m.notes).toHaveLength(6) // 3 triplet notes + 3 original quarter rests
        })

        it('collapses the tuplet group back to a plain note of the same length', () => {
            const { score, m, note } = scoreWithPitchedFirstNote()
            const tripletNote = score.toggleTuplet(note)
            const flattened = score.toggleTuplet(tripletNote)
            if (!flattened) throw new Error('expected toggleTuplet to return a note')
            expect(flattened.duration.type).toBe('q')
            expect(flattened.duration.ratio).toEqual({ actualNotes: 1, normalNotes: 1 })
            expect(flattened.pitch?.name).toBe('C')
            expect(m.notes).toHaveLength(4)
            expect(m.beats).toBeCloseTo(m.maxBeats)
        })

        it('keeps a dotted duration: a dotted quarter becomes three dotted eighths', () => {
            const score = makeScore(1)
            const m = score.firstMeasure
            if (!m?.firstNote) throw new Error('expected firstNote')
            const [dotted] = score.replace([m.firstNote], [new Note({ duration: new Duration({ type: 'q', dots: 1 }) })])
            const newNote = score.toggleTuplet(dotted)
            expect(newNote?.duration.type).toBe('8')
            expect(newNote?.duration.dots).toBe(1)
            expect(m.beats).toBeCloseTo(m.maxBeats)
        })

        it('returns null for a 16th note (no shorter value to divide into)', () => {
            const score = makeScore(1)
            const m = score.firstMeasure
            if (!m?.firstNote) throw new Error('expected firstNote')
            const [sixteenth] = score.replace([m.firstNote], [pitched('C', 4, '16')])
            const before = m.notes.length
            expect(score.toggleTuplet(sixteenth)).toBeNull()
            expect(m.notes).toHaveLength(before)
        })

        it('returns null without a note', () => {
            const score = makeScore(1)
            expect(score.toggleTuplet(null)).toBeNull()
        })
    })

    describe('dirty tracking', () => {
        it('flushDirty returns null when nothing changed', () => {
            const score = makeScore(1)
            score.clearDirty()
            expect(score.flushDirty()).toBeNull()
        })

        it('flushDirty returns allMeasures after a structure change', () => {
            const score = makeScore(1)
            score.clearDirty()
            score.addMeasure() // structure changes are tracked automatically
            const result = score.flushDirty()
            expect(result?.allMeasures).toHaveLength(2)
            expect(result?.measures).toBeUndefined()
        })

        it('flushDirty returns a measures map for content-only changes', () => {
            const score = makeScore(2)
            score.clearDirty()
            const first = score.firstMeasure
            if (!first) throw new Error('expected firstMeasure')
            first.setTempo(0, 120) // content mutation marks the measure dirty automatically
            const result = score.flushDirty()
            expect(result?.measures).toBeDefined()
            expect(Object.keys(result?.measures ?? {})).toEqual(['0'])
            expect(result?.allMeasures).toBeUndefined()
        })

        it('flushDirty clears the dirty state (second flush is null)', () => {
            const score = makeScore(1)
            expect(score.flushDirty()).not.toBeNull()
            expect(score.flushDirty()).toBeNull()
        })

        it('clearDirty drops pending changes without serializing them', () => {
            const score = makeScore(1)
            score.clearDirty()
            expect(score.flushDirty()).toBeNull()
        })

        it('redirty restores a failed measures flush so the next flush retries it', () => {
            const score = makeScore(2)
            score.clearDirty()
            const first = score.firstMeasure
            if (!first) throw new Error('expected firstMeasure')
            first.setTempo(0, 120)
            const failed = score.flushDirty()
            expect(score.flushDirty()).toBeNull()
            score.redirty(failed!)
            const retried = score.flushDirty()
            expect(Object.keys(retried?.measures ?? {})).toEqual(['0'])
        })

        it('redirty restores structure and instrument flushes', () => {
            const score = makeScore(1)
            score.clearDirty()
            score.redirty({ allMeasures: [], partList: {} })
            const retried = score.flushDirty()
            expect(retried?.allMeasures).toHaveLength(1)
            expect(retried?.partList).toBeDefined()
        })

        it('redirty ignores measure indices that no longer exist', () => {
            const score = makeScore(1)
            score.clearDirty()
            score.redirty({ measures: { '5': {} } })
            expect(score.flushDirty()).toBeNull()
        })
    })

    describe('setInstrument', () => {
        it('preserves tie pairings across transposition', () => {
            const score = makeScore(1)
            const m = score.firstMeasure
            if (!m) throw new Error('expected firstMeasure')
            const target = m.firstNote
            if (!target) throw new Error('expected firstNote')
            score.replace(
                [target],
                [
                    new Note({ duration: new Duration({ type: 'h' }), pitch: new Pitch({ name: 'C', octave: 5 }), tie: 'start' }),
                    new Note({ duration: new Duration({ type: 'h' }), pitch: new Pitch({ name: 'C', octave: 5 }), tie: 'stop' }),
                ],
            )
            score.setInstrument(Instrument.Trumpet)
            expect(m.notes[0].tie).toBe('start')
            expect(m.notes[1].tie).toBe('stop')
            expect(score.tiePartner(m.notes[0])).toBe(m.notes[1])
        })

        it('preserves sounding pitch (concert C → trumpet writes D = sounds C)', () => {
            const score = makeScore(1)
            const m = score.firstMeasure
            if (!m) throw new Error('expected firstMeasure')
            const target = m.firstNote
            if (!target) throw new Error('expected firstNote')
            score.replace([target], [pitched('C', 5)])
            const noteBefore = m.firstNote
            if (!noteBefore) throw new Error('expected firstNote')
            const pitchBefore = noteBefore.pitch
            if (!pitchBefore) throw new Error('expected pitch')
            const soundingBefore = pitchBefore.toMidi() + score.instrument.chromaticTranspose
            score.setInstrument(Instrument.Trumpet)
            const noteAfter = m.firstNote
            if (!noteAfter) throw new Error('expected firstNote')
            const pitchAfter = noteAfter.pitch
            if (!pitchAfter) throw new Error('expected pitch')
            const soundingAfter = pitchAfter.toMidi() + score.instrument.chromaticTranspose
            expect(soundingAfter).toBe(soundingBefore)
            // Trumpet writes D5 to sound C5
            expect(pitchAfter.name).toBe('D')
            expect(pitchAfter.octave).toBe(5)
        })

        it('round-trips: piano → trumpet → piano restores the original note', () => {
            const score = makeScore(1)
            const m = score.firstMeasure
            if (!m) throw new Error('expected firstMeasure')
            const target = m.firstNote
            if (!target) throw new Error('expected firstNote')
            score.replace([target], [pitched('F', 4)])
            const noteBefore = m.firstNote
            if (!noteBefore) throw new Error('expected firstNote')
            const before = noteBefore.pitch
            if (!before) throw new Error('expected pitch')
            score.setInstrument(Instrument.Trumpet)
            score.setInstrument(Instrument.Piano)
            const noteAfter = m.firstNote
            if (!noteAfter) throw new Error('expected firstNote')
            const after = noteAfter.pitch
            if (!after) throw new Error('expected pitch')
            expect(after.name).toBe(before.name)
            expect(after.octave).toBe(before.octave)
            expect(after.alter).toBe(before.alter)
        })

        it('transposes the key signature', () => {
            const score = makeScore(1)
            const m = score.firstMeasure
            if (!m) throw new Error('expected firstMeasure')
            m.setKeySignature(0, 0) // explicit C major on the leading key
            score.setInstrument(Instrument.Trumpet)
            // Concert C major (0) → trumpet writes D major (2 fifths)
            expect(m.keySignature.fifths).toBe(2)
        })

        it('does nothing when switching to the same instrument', () => {
            const score = makeScore(1)
            const m = score.firstMeasure
            if (!m) throw new Error('expected firstMeasure')
            const target = m.firstNote
            if (!target) throw new Error('expected firstNote')
            score.replace([target], [pitched('C', 5)])
            const noteBefore = m.firstNote
            if (!noteBefore) throw new Error('expected firstNote')
            const before = noteBefore.pitch
            if (!before) throw new Error('expected pitch')
            const versionBefore = score.version
            score.setInstrument(Instrument.Piano)
            const noteAfter = m.firstNote
            if (!noteAfter) throw new Error('expected firstNote')
            expect(noteAfter.pitch).toBe(before)
            expect(score.version).toBe(versionBefore) // early return: no touch
        })

        it('does not transpose when both instruments share the same transposition', () => {
            const score = makeScore(1)
            const m = score.firstMeasure
            if (!m) throw new Error('expected firstMeasure')
            const target = m.firstNote
            if (!target) throw new Error('expected firstNote')
            score.replace([target], [pitched('C', 5)])
            score.setInstrument(Instrument.Trumpet)
            const noteTrumpet = m.firstNote
            if (!noteTrumpet) throw new Error('expected firstNote')
            const afterTrumpet = noteTrumpet.pitch
            if (!afterTrumpet) throw new Error('expected pitch')
            // Soprano sax is also B♭ (same chromatic/diatonic as trumpet)
            score.setInstrument(Instrument.SopranoSaxophone)
            const noteSax = m.firstNote
            if (!noteSax) throw new Error('expected firstNote')
            const afterSax = noteSax.pitch
            if (!afterSax) throw new Error('expected pitch')
            expect(afterSax.name).toBe(afterTrumpet.name)
            expect(afterSax.octave).toBe(afterTrumpet.octave)
            expect(afterSax.alter).toBe(afterTrumpet.alter)
        })
    })

    describe('setClef', () => {
        it('sets the leading clef when the active note is at beat 0', () => {
            const score = makeScore(1)
            const m = score.firstMeasure
            if (!m) throw new Error('expected firstMeasure')
            score.setClef(m.firstNote, 'bass')
            expect(m.clef.type).toBe('bass')
        })

        it('adds a mid-measure clef change at the active note beat', () => {
            const score = makeScore(1)
            const m = score.firstMeasure
            if (!m) throw new Error('expected firstMeasure')
            const note = m.noteAtBeat(2)
            score.setClef(note, 'alto')
            expect(m.clef.type).toBe('treble')
            expect(m.clefAtOrBefore(2).type).toBe('alto')
        })

        it('propagates a clef change forward to following measures', () => {
            const score = makeScore(2)
            const first = score.firstMeasure
            if (!first) throw new Error('expected firstMeasure')
            score.setClef(first.firstNote, 'bass')
            // Measure 2 carries the bass clef forward and so does not redundantly display it.
            expect(score.measures[1].clef.type).toBe('bass')
            expect(score.measures[1].layout.showsClef).toBe(false)
        })

        it('stops propagation at the next explicit clef change', () => {
            const score = makeScore(3)
            score.setClef(score.measures[0].firstNote, 'bass')
            score.setClef(score.measures[2].firstNote, 'alto')
            expect(score.measures[0].clef.type).toBe('bass')
            expect(score.measures[1].clef.type).toBe('bass') // carries from measure 0
            expect(score.measures[2].clef.type).toBe('alto') // explicit boundary
        })

        it('repositions notes when the clef changes (same pitch, new staff line)', () => {
            const score = makeScore(1)
            const m = score.firstMeasure
            if (!m) throw new Error('expected firstMeasure')
            const note = m.firstNote
            if (!note) throw new Error('expected firstNote')
            score.replace([note], [pitched('C', 4)])
            const target = m.firstNote
            if (!target) throw new Error('expected note')
            const trebleLine = target.line
            score.setClef(target, 'bass')
            expect(target.line).toBe(trebleLine + 6) // +6 half-lines for bass
        })

        it('ignores a null note', () => {
            const score = makeScore(1)
            expect(() => score.setClef(null, 'bass')).not.toThrow()
        })

        it('demotes a leading clef to inherited when set back to the carried type', () => {
            const score = makeScore(2)
            const second = score.measures[1]
            score.setClef(second.firstNote, 'bass') // explicit boundary on measure 2
            expect(second.leadingClefExplicit).toBe(true)
            expect(second.layout.showsClef).toBe(true)
            // Measure 2 carries treble from measure 1; setting it back to treble clears the boundary.
            score.setClef(second.firstNote, 'treble')
            expect(second.leadingClefExplicit).toBe(false)
            expect(second.clef.type).toBe('treble')
            expect(second.layout.showsClef).toBe(false)
        })

        it('demotes the first measure leading clef when set to the default treble', () => {
            const score = makeScore(1)
            const m = score.firstMeasure
            if (!m) throw new Error('expected firstMeasure')
            score.setClef(m.firstNote, 'bass')
            expect(m.leadingClefExplicit).toBe(true)
            // The first measure carries in the default treble, so treble demotes to inherited.
            score.setClef(m.firstNote, 'treble')
            expect(m.leadingClefExplicit).toBe(false)
            expect(m.clef.type).toBe('treble')
        })

        it('removes a mid-measure clef set to the clef already in effect there', () => {
            const score = makeScore(1)
            const m = score.firstMeasure
            if (!m) throw new Error('expected firstMeasure')
            score.setClef(m.noteAtBeat(2), 'bass')
            expect(m.clefAtBeat(2)?.type).toBe('bass')
            // Active clef before beat 2 is the treble leading clef — setting beat 2 to treble drops it.
            score.setClef(m.noteAtBeat(2), 'treble')
            expect(m.clefAtBeat(2)).toBeUndefined()
        })

        it('stops drawing a mid-measure clef that became a no-op after the leading clef changed', () => {
            const score = makeScore(1)
            const m = score.firstMeasure
            if (!m) throw new Error('expected firstMeasure')
            score.setClef(m.noteAtBeat(2), 'bass') // treble -> bass at beat 2
            expect(m.midMeasureClefs).toHaveLength(1)
            score.setClef(m.firstNote, 'bass') // leading becomes bass; the beat-2 bass is now a bass->bass no-op
            expect(m.clef.type).toBe('bass')
            expect(m.midMeasureClefs).toHaveLength(0) // not drawn / serialized
            // The intent is not destroyed: reverting the leading clef re-exposes the mid-measure change.
            score.setClef(m.firstNote, 'treble')
            expect(m.midMeasureClefs.map((c) => c.type)).toEqual(['bass'])
        })

        it('a direct measure.setClef does NOT propagate to later measures (Score op required)', () => {
            const score = makeScore(2)
            const [m0, m1] = score.measures
            m0.setClef(0, 'bass') // measure-level mutation: this measure only
            expect(m0.clef.type).toBe('bass')
            expect(m1.clef.type).toBe('treble') // unchanged — carry-forward is a Score responsibility
            const note = m0.firstNote
            if (!note) throw new Error('expected note')
            score.setClef(note, 'alto') // the Score-level op propagates
            expect(m1.clef.type).toBe('alto')
        })
    })

    describe('setKeySignature', () => {
        it('sets the leading key when the active note is at beat 0', () => {
            const score = makeScore(1)
            const m = score.firstMeasure
            if (!m) throw new Error('expected firstMeasure')
            score.setKeySignature(m.firstNote, 2)
            expect(m.keySignature.fifths).toBe(2)
        })

        it('adds a mid-measure key change at the active note beat', () => {
            const score = makeScore(1)
            const m = score.firstMeasure
            if (!m) throw new Error('expected firstMeasure')
            score.setKeySignature(m.noteAtBeat(2), 1)
            expect(m.keySignature.fifths).toBe(0)
            expect(m.keyAtOrBefore(2).fifths).toBe(1)
        })

        it('propagates a key change forward to following measures', () => {
            const score = makeScore(2)
            score.setKeySignature(score.measures[0].firstNote, 3)
            expect(score.measures[1].keySignature.fifths).toBe(3)
            expect(score.measures[1].layout.showsKeySignature).toBe(false) // carried, not redundantly displayed
        })

        it('stops propagation at the next explicit key change', () => {
            const score = makeScore(3)
            score.setKeySignature(score.measures[0].firstNote, 3)
            score.setKeySignature(score.measures[2].firstNote, -2)
            expect(score.measures[0].keySignature.fifths).toBe(3)
            expect(score.measures[1].keySignature.fifths).toBe(3) // carries from measure 0
            expect(score.measures[2].keySignature.fifths).toBe(-2) // explicit boundary
        })

        it('demotes a leading key to inherited when set back to the carried value', () => {
            const score = makeScore(2)
            const second = score.measures[1]
            score.setKeySignature(second.firstNote, 2) // explicit boundary
            expect(second.leadingKeyExplicit).toBe(true)
            expect(second.layout.showsKeySignature).toBe(true)
            score.setKeySignature(second.firstNote, 0) // back to the carried C major
            expect(second.leadingKeyExplicit).toBe(false)
            expect(second.keySignature.fifths).toBe(0)
            expect(second.layout.showsKeySignature).toBe(false)
        })

        it('demotes the first measure leading key when set to the default C major', () => {
            const score = makeScore(1)
            const m = score.firstMeasure
            if (!m) throw new Error('expected firstMeasure')
            score.setKeySignature(m.firstNote, 2)
            expect(m.leadingKeyExplicit).toBe(true)
            // Nothing carries into the first measure, so C major (0, no mode) demotes to inherited.
            score.setKeySignature(m.firstNote, 0)
            expect(m.leadingKeyExplicit).toBe(false)
            expect(m.keySignature.fifths).toBe(0)
        })

        it('repositions accidentals without moving notes when the key changes', () => {
            const score = makeScore(1)
            const m = score.firstMeasure
            if (!m) throw new Error('expected firstMeasure')
            const note = m.firstNote
            if (!note) throw new Error('expected firstNote')
            score.replace([note], [pitched('F', 5)]) // natural F
            const target = m.firstNote
            if (!target) throw new Error('expected note')
            const lineBefore = target.line
            expect(target.layout.accidental).toBeUndefined() // C major: natural F shows nothing
            score.setKeySignature(target, 1) // G major: F is now sharp by key
            expect(target.line).toBe(lineBefore) // position unchanged
            expect(target.layout.accidental?.glyphName).toBe('accidentalNatural') // a natural is added
        })

        it('ignores a null note', () => {
            const score = makeScore(1)
            expect(() => score.setKeySignature(null, 2)).not.toThrow()
        })

        it('keeps a relative major↔minor change (same fifths, different mode) as an explicit boundary', () => {
            const score = makeScore(2)
            score.setKeySignature(score.measures[0].firstNote, 0, 'minor') // A minor (0 fifths)
            score.setKeySignature(score.measures[1].firstNote, 0, 'major') // C major: same fifths, different mode
            expect(score.measures[1].leadingKeyExplicit).toBe(true)
            expect(score.measures[1].keySignature.mode).toBe('major')
        })

        it('a direct measure.setKeySignature does NOT propagate to later measures', () => {
            const score = makeScore(2)
            const [m0, m1] = score.measures
            m0.setKeySignature(0, 3) // measure-level mutation: this measure only
            expect(m0.keySignature.fifths).toBe(3)
            expect(m1.keySignature.fifths).toBe(0) // unchanged — carry-forward is a Score responsibility
        })

        describe('cancellation naturals', () => {
            it('draws naturals for the old accidentals when switching back to C major', () => {
                const score = makeScore(2)
                score.setKeySignature(score.measures[0].firstNote, 1) // G major (F♯)
                score.setKeySignature(score.measures[1].firstNote, 0) // back to C major
                const second = score.measures[1]
                const drawn = second.keySignature.drawnAccidentals
                expect(drawn).toHaveLength(1)
                expect(drawn[0].glyphName).toBe('accidentalNatural')
                expect(drawn[0].name).toBe('F')
                expect(second.layout.showsKeySignature).toBe(true)
                // The cancellation key is laid out (spaced) even though C major has no sharps/flats of its own.
                expect(() => second.layout.getXForElement(second.keySignature)).not.toThrow()
            })

            it('draws no cancellation naturals when switching to a non-C key (D major → G major)', () => {
                const score = makeScore(2)
                score.setKeySignature(score.measures[0].firstNote, 2) // D major (F♯, C♯)
                score.setKeySignature(score.measures[1].firstNote, 1) // G major (F♯)
                const drawn = score.measures[1].keySignature.drawnAccidentals
                expect(drawn.map((a) => [a.glyphName, a.name])).toEqual([['accidentalSharp', 'F']]) // just G major's F♯
            })

            it('draws no naturals when the key carries forward unchanged', () => {
                const score = makeScore(2)
                score.setKeySignature(score.measures[0].firstNote, 1) // G major, carries into measure 1
                expect(score.measures[1].keySignature.drawnAccidentals.every((a) => a.glyphName !== 'accidentalNatural')).toBe(true)
            })

            it('draws naturals for a mid-measure change back to C major', () => {
                const score = makeScore(1)
                const m = score.firstMeasure
                if (!m) throw new Error('expected firstMeasure')
                score.setKeySignature(m.firstNote, 1) // leading G major
                score.setKeySignature(m.noteAtBeat(2), 0) // mid-measure back to C
                const midKey = m.keyAtBeat(2)
                if (!midKey) throw new Error('expected mid-measure key')
                expect(midKey.drawnAccidentals.map((a) => a.glyphName)).toEqual(['accidentalNatural'])
            })

            it('refreshes a later cancellation when an earlier key changes', () => {
                const score = makeScore(2)
                score.setKeySignature(score.measures[0].firstNote, 1) // G major
                score.setKeySignature(score.measures[1].firstNote, 0) // C major cancels F♯
                expect(score.measures[1].keySignature.layout.accidentals).toHaveLength(1) // 1 natural
                score.setKeySignature(score.measures[0].firstNote, 2) // earlier key → D major (F♯, C♯)
                expect(score.measures[1].keySignature.layout.accidentals).toHaveLength(2) // now cancels both
            })
        })
    })

    describe('seedInstrument', () => {
        it('sets the instrument without marking the score dirty', () => {
            const score = makeScore(1)
            score.clearDirty()
            score.seedInstrument(Instrument.Flute)
            expect(score.instrument).toBe(Instrument.Flute)
            // Unlike setInstrument, seeding is for deserialization and leaves nothing to flush.
            expect(score.flushDirty()).toBeNull()
        })
    })

    describe('addMeasure at an interior index', () => {
        it('inserting before an existing measure gives the new measure a single end barline', () => {
            const score = makeScore(1)
            const original = score.firstMeasure
            if (!original) throw new Error('expected firstMeasure')
            const inserted = score.addMeasure(0)
            expect(score.measures[0]).toBe(inserted)
            expect(score.measures[1]).toBe(original)
            // The inserted measure is no longer last, so it carries a single barline; the tail keeps "end".
            expect(inserted.endBarline).toBe('single')
            expect(score.lastMeasure?.endBarline).toBe('end')
        })

        it('accepts a pre-built measure instead of synthesizing one', () => {
            const score = makeScore(1)
            const prebuilt = new Measure(score, 'treble', new TimeSignature(3, 4))
            const result = score.addMeasure(score.measures.length, prebuilt)
            // The supplied measure object is appended directly rather than a freshly inherited one.
            expect(result).toBe(prebuilt)
            expect(score.lastMeasure).toBe(prebuilt)
            // Its own time signature is kept (time is not rewritten by carry-forward).
            expect(prebuilt.timeSignature.beatAmount).toBe(3)
            expect(prebuilt.index).toBe(1)
        })
    })

    describe('addMeasureAdoptingTempo', () => {
        it('moves a leading tempo marking from the displaced measure onto the new one', () => {
            const score = makeScore(1)
            const displaced = score.firstMeasure
            if (!displaced) throw new Error('expected firstMeasure')
            score.setTempo(displaced.firstNote, 120)

            const inserted = score.addMeasureAdoptingTempo(0)

            expect(score.measures[0]).toBe(inserted)
            expect(inserted.tempoAtBeat(0)?.bpm).toBe(120)
            expect(displaced.tempoAtBeat(0)).toBeUndefined()
            // The take's measure — and everything after it — sounds at the adopted bpm.
            inserted.complete()
            expect(score.bpmAt(inserted.firstNote)).toBe(120)
            expect(score.bpmAt(displaced.firstNote)).toBe(120)
        })

        it('leaves a mid-measure marking with the displaced measure', () => {
            const score = makeScore(1)
            const displaced = score.firstMeasure
            if (!displaced) throw new Error('expected firstMeasure')
            score.setTempo(displaced.noteAtBeat(2), 160) // beat 2, not a leading marking

            const inserted = score.addMeasureAdoptingTempo(0)

            expect(inserted.tempoAtBeat(0)).toBeUndefined()
            expect(displaced.tempoAtBeat(2)?.bpm).toBe(160)
        })

        it('adds no marking when the displaced measure has none', () => {
            const score = makeScore(2)
            score.setTempo(score.measures[0].firstNote, 144)

            // Displacing measure 1 (unmarked): the bpm keeps carrying in from measure 0.
            const inserted = score.addMeasureAdoptingTempo(1)

            expect(inserted.tempoAtBeat(0)).toBeUndefined()
            inserted.complete()
            expect(score.bpmAt(inserted.firstNote)).toBe(144)
        })

        it('appends like addMeasure when no measure is displaced', () => {
            const score = makeScore(1)
            const inserted = score.addMeasureAdoptingTempo(score.measures.length)
            expect(score.lastMeasure).toBe(inserted)
            expect(inserted.tempoAtBeat(0)).toBeUndefined()
        })
    })

    describe('measure lookup guards', () => {
        it('getIndexForMeasure throws for a measure not in this score', () => {
            const score = makeScore(1)
            const stray = new Measure(score, 'treble', new TimeSignature(4, 4))
            expect(() => score.getIndexForMeasure(stray)).toThrow('Measure not part of this score')
        })

        it('layout.rowFor throws for a measure that is not part of any row', () => {
            const score = makeScore(1)
            const stray = new Measure(score, 'treble', new TimeSignature(4, 4))
            expect(() => score.layout.rowFor(stray)).toThrow('Measure not part of a row')
        })
    })

    describe('tempo', () => {
        it('setTempo on a note adds a marking that bpmAt reads back', () => {
            const score = makeScore(1)
            const m = score.firstMeasure
            if (!m) throw new Error('expected firstMeasure')
            const note = m.firstNote
            if (!note) throw new Error('expected firstNote')
            score.setTempo(note, 132)
            expect(m.tempoAtBeat(0)?.bpm).toBe(132)
            expect(score.bpmAt(note)).toBe(132)
        })

        it('setTempo with undefined removes the marking at the note beat', () => {
            const score = makeScore(1)
            const m = score.firstMeasure
            if (!m) throw new Error('expected firstMeasure')
            const note = m.firstNote
            if (!note) throw new Error('expected firstNote')
            score.setTempo(note, 132)
            expect(m.tempoAtBeat(0)).toBeDefined()
            score.setTempo(note, undefined)
            expect(m.tempoAtBeat(0)).toBeUndefined()
        })

        it('setTempo is a no-op for a null note', () => {
            const score = makeScore(1)
            expect(() => score.setTempo(null, 100)).not.toThrow()
        })

        it('bpmAt returns the default when given no note', () => {
            const score = makeScore(1)
            expect(score.bpmAt(null)).toBe(Score.DEFAULT_BPM)
        })

        it('bpmAt defaults to DEFAULT_BPM with no markings anywhere', () => {
            const score = makeScore(2)
            const note = score.measures[1].firstNote
            expect(score.bpmAt(note)).toBe(Score.DEFAULT_BPM)
        })

        it('bpmAt carries a previous measure tempo forward via the tempo map', () => {
            const score = makeScore(2)
            const first = score.measures[0].firstNote
            score.setTempo(first, 144) // marking only in measure 0
            const laterNote = score.measures[1].firstNote
            if (!laterNote) throw new Error('expected note in measure 1')
            // Measure 1 has no local marking; the BPM entering it carries from measure 0.
            expect(score.bpmAt(laterNote)).toBe(144)
        })

        it('a local mid-measure marking overrides the carried-forward tempo', () => {
            const score = makeScore(1)
            const m = score.firstMeasure
            if (!m) throw new Error('expected firstMeasure')
            score.setTempo(m.firstNote, 100) // beat 0
            const midNote = m.noteAtBeat(2)
            score.setTempo(midNote, 180) // beat 2
            // Reading at the beat-2 note returns the nearest marking at/before it.
            expect(score.bpmAt(midNote)).toBe(180)
            // Reading at beat 0 still returns the earlier marking.
            expect(score.bpmAt(m.firstNote)).toBe(100)
        })

        it('returns the cached tempo map on a second read without mutation', () => {
            const score = makeScore(2)
            score.setTempo(score.measures[0].firstNote, 110)
            const laterNote = score.measures[1].firstNote
            if (!laterNote) throw new Error('expected note')
            const first = score.bpmAt(laterNote) // builds and caches the tempo map
            const second = score.bpmAt(laterNote) // reads from cache
            expect(first).toBe(110)
            expect(second).toBe(110)
        })
    })

    describe('flushDirty instrument changes', () => {
        it('emits a partList when the instrument changed', () => {
            const score = makeScore(1)
            score.clearDirty()
            score.setInstrument(Instrument.Trumpet)
            const result = score.flushDirty()
            expect(result?.partList).toBeDefined()
            const scoreParts = (result?.partList as { scoreParts: Array<Record<string, unknown>> }).scoreParts
            expect(scoreParts[0].partName).toBe('Trumpet')
            const midi = scoreParts[0].midiInstrument as { midiProgram: number }
            // gmProgram is 0-indexed here, +1 in MusicXML.
            expect(midi.midiProgram).toBe(Instrument.Trumpet.gmProgram + 1)
        })

        it('emits only a partList (no measure entries) when the instrument changes on an empty score', () => {
            const score = new Score()
            // No measures means no notes to transpose, so nothing is marked measure-dirty.
            score.setInstrument(Instrument.Trumpet)
            expect(score.instrument).toBe(Instrument.Trumpet)
            const result = score.flushDirty()
            expect(result?.partList).toBeDefined()
            expect(result?.measures).toBeUndefined()
            expect(result?.allMeasures).toBeUndefined()
        })

        it('skips a dirty measure that is no longer part of the score index', () => {
            const score = makeScore(1)
            score.clearDirty()
            const stray = new Measure(score, 'treble', new TimeSignature(4, 4))
            // A stray measure's content mutations still mark it dirty, but it has no index.
            stray.addTempo(0, 100)
            const result = score.flushDirty()
            // The only dirty measure has no index, so the measures map is present but empty.
            expect(result?.measures).toEqual({})
        })
    })

    describe('empty-score edge cases', () => {
        it('firstMeasure and lastMeasure are null', () => {
            const score = new Score()
            expect(score.firstMeasure).toBeNull()
            expect(score.lastMeasure).toBeNull()
        })

        it('getPreviousMeasure returns null for a measure with no index', () => {
            const score = makeScore(1)
            const stray = new Measure(score, 'treble', new TimeSignature(4, 4))
            expect(score.getPreviousMeasure(stray)).toBeNull()
        })
    })

    describe('removeLastMeasure with an empty trailing measure', () => {
        it('does not crash when the new last measure has no notes', () => {
            const score = new Score()
            const first = score.addMeasure() // not completed: no notes
            const second = score.addMeasure() // not completed: no notes
            expect(first.notes).toHaveLength(0)
            expect(() => score.removeLastMeasure()).not.toThrow()
            expect(score.lastMeasure).toBe(first)
            expect(score.measures).not.toContain(second)
        })
    })
})
