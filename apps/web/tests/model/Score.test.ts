import { makeScore, pitched } from '@test/helpers'
import { describe, expect, it } from 'vitest'

import { MAX_MEASURES_PER_ROW } from '@/components/notation/constants'
import { Duration } from '@/model/Duration'
import { Instrument } from '@/model/Instrument'
import { Note } from '@/model/Note'
import { Pitch } from '@/model/Pitch'
import { Score } from '@/model/Score'

describe('Score', () => {
    describe('addMeasure', () => {
        it('adds a fresh measure to an empty score', () => {
            const score = new Score()
            const m = score.addMeasure()
            expect(score.measures).toContain(m)
            expect(score.firstMeasure).toBe(m)
            expect(score.lastMeasure).toBe(m)
        })

        it('inherits clef and time signature from previous measure', () => {
            const score = new Score()
            const a = score.addMeasure()
            const b = score.addMeasure()
            expect(b.clef.type).toBe(a.clef.type)
            expect(b.timeSignature.beatAmount).toBe(a.timeSignature.beatAmount)
        })

        it('end barline is "end" on the last measure, "single" on others', () => {
            const score = new Score()
            const a = score.addMeasure()
            const b = score.addMeasure()
            expect(a.endBarline).toBe('single')
            expect(b.endBarline).toBe('end')
        })

        it('triggers a row rebuild', () => {
            const score = makeScore(MAX_MEASURES_PER_ROW + 1)
            expect(score.rows.length).toBeGreaterThanOrEqual(2)
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

        it('drops the row when its last measure is removed', () => {
            const score = makeScore(MAX_MEASURES_PER_ROW + 1)
            const rowsBefore = score.rows.length
            score.removeLastMeasure()
            expect(score.rows.length).toBeLessThanOrEqual(rowsBefore)
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
    })

    describe('row layout reactions', () => {
        it('a 5th measure goes onto a new row (MAX_MEASURES_PER_ROW = 4)', () => {
            const score = makeScore(MAX_MEASURES_PER_ROW + 1)
            expect(score.rows.length).toBe(2)
            expect(score.rows[0].measures.length).toBe(MAX_MEASURES_PER_ROW)
            expect(score.rows[1].measures.length).toBe(1)
        })

        it('first measure of every row showsClef = true', () => {
            const score = makeScore(MAX_MEASURES_PER_ROW + 1)
            for (const row of score.rows) {
                expect(row.firstMeasures.showsClef).toBe(true)
            }
        })

        it('first measure of subsequent rows still showsClef even though prev clef matches', () => {
            const score = makeScore(MAX_MEASURES_PER_ROW + 1)
            // 2nd row first measure inherited treble clef but should still display it
            expect(score.rows[1].firstMeasures.showsClef).toBe(true)
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
    })

    describe('totalNotes', () => {
        it('counts notes across all measures', () => {
            const score = makeScore(2)
            const expected = score.measures.reduce((s, m) => s + m.notes.length, 0)
            expect(score.totalNotes).toBe(expected)
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
            score.markStructureChanged()
            const result = score.flushDirty()
            expect(result?.allMeasures).toBeDefined()
        })

        it('flushDirty returns measures map for non-structure changes', () => {
            const score = makeScore(2)
            score.clearDirty()
            const first = score.firstMeasure
            if (!first) throw new Error('expected firstMeasure')
            score.markMeasureDirty(first)
            const result = score.flushDirty()
            expect(result?.measures).toBeDefined()
        })
    })

    describe('layout invalidation', () => {
        it('invalidateLayout clears cached score layout', () => {
            const score = makeScore(1)
            const a = score.layout
            score.invalidateLayout()
            const b = score.layout
            expect(a).not.toBe(b)
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
            expect(score.getTieByNote(m.notes[0])).toBeDefined()
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
            score.setInstrument(Instrument.Piano)
            const noteAfter = m.firstNote
            if (!noteAfter) throw new Error('expected firstNote')
            expect(noteAfter.pitch).toBe(before)
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

        it('propagates a clef change forward to following measures (tempo-style)', () => {
            const score = makeScore(2)
            const first = score.firstMeasure
            if (!first) throw new Error('expected firstMeasure')
            score.setClef(first.firstNote, 'bass')
            // Measure 2 carries the bass clef forward and so does not redundantly display it.
            expect(score.measures[1].clef.type).toBe('bass')
            expect(score.measures[1].showsClef).toBe(false)
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
            expect(second.showsClef).toBe(true)
            // Measure 2 carries treble from measure 1; setting it back to treble clears the boundary.
            score.setClef(second.firstNote, 'treble')
            expect(second.leadingClefExplicit).toBe(false)
            expect(second.clef.type).toBe('treble')
            expect(second.showsClef).toBe(false)
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
            expect(score.measures[1].showsKeySignature).toBe(false) // carried, not redundantly displayed
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
            expect(second.showsKeySignature).toBe(true)
            score.setKeySignature(second.firstNote, 0) // back to the carried C major
            expect(second.leadingKeyExplicit).toBe(false)
            expect(second.keySignature.fifths).toBe(0)
            expect(second.showsKeySignature).toBe(false)
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
            expect(target.displayAccidentalGlyph).toBeUndefined() // C major: natural F shows nothing
            score.setKeySignature(target, 1) // G major: F is now sharp by key
            expect(target.line).toBe(lineBefore) // position unchanged
            expect(target.displayAccidentalGlyph).toBe('accidentalNatural') // a natural is added
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
                expect(second.showsKeySignature).toBe(true)
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
                expect(score.measures[1].keySignature.layout.accidentals).toHaveLength(1) // 1 natural (caches layout)
                score.setKeySignature(score.measures[0].firstNote, 2) // earlier key → D major (F♯, C♯)
                expect(score.measures[1].keySignature.layout.accidentals).toHaveLength(2) // now cancels both
            })
        })
    })
})
