import type { ClefType } from '@mushee/notation/components/types'
import { Clef } from '@mushee/notation/model/Clef'
import { Duration } from '@mushee/notation/model/Duration'
import { KeySignature } from '@mushee/notation/model/KeySignature'
import { MeasureLayout } from '@mushee/notation/model/layout/MeasureLayout'
import { Measure } from '@mushee/notation/model/Measure'
import { Note } from '@mushee/notation/model/Note'
import { Pitch } from '@mushee/notation/model/Pitch'
import { Score } from '@mushee/notation/model/Score'
import { TimeSignature } from '@mushee/notation/model/TimeSignature'
import { defaults, makeScore, pitched, rest } from '@mushee/notation/testing'
import { describe, expect, it } from 'vitest'

describe('Measure', () => {
    describe('construction', () => {
        it('attaches the leading clef and stores the time signature', () => {
            const score = new Score()
            const { clefType, timeSignature } = defaults()
            const m = new Measure(score, clefType, timeSignature)
            expect(m.clef.measure).toBe(m)
            expect(m.clef.type).toBe(clefType)
            expect(m.timeSignature).toBe(timeSignature)
        })

        it('starts with no notes, no tempos, no tuplets', () => {
            const score = new Score()
            const m = new Measure(score, ...(Object.values(defaults()) as [ClefType, TimeSignature]))
            expect(m.notes).toEqual([])
            expect(m.tempos).toEqual([])
            expect(m.tuplets).toEqual([])
        })

        it('exposes the leading key signature and end barline', () => {
            const score = new Score()
            const { clefType, timeSignature } = defaults()
            const m = new Measure(score, clefType, timeSignature, { keyFifths: 2, endBarline: 'end' })
            expect(m.keySignature.fifths).toBe(2)
            expect(m.keySignature.beatPosition).toBe(0)
            expect(m.endBarline).toBe('end')
        })

        it('honours explicit leading clef/key flags from the constructor', () => {
            const score = new Score()
            const { clefType, timeSignature } = defaults()
            const plain = new Measure(score, clefType, timeSignature)
            expect(plain.leadingClefExplicit).toBe(false)
            expect(plain.leadingKeyExplicit).toBe(false)
            const explicit = new Measure(score, clefType, timeSignature, { leadingClefExplicit: true, leadingKeyExplicit: true })
            expect(explicit.leadingClefExplicit).toBe(true)
            expect(explicit.leadingKeyExplicit).toBe(true)
        })

        it('has a unique id', () => {
            const score = new Score()
            const a = new Measure(score, 'treble', new TimeSignature(4, 4))
            const b = new Measure(score, 'treble', new TimeSignature(4, 4))
            expect(a.id).not.toBe(b.id)
        })
    })

    describe('version', () => {
        it('every public mutator bumps the version exactly once', () => {
            const score = new Score()
            const m = new Measure(score, 'treble', new TimeSignature(4, 4))
            let v = m.version
            const expectBump = () => {
                expect(m.version).toBe(v + 1)
                v = m.version
            }
            m.addNotes([rest('q')])
            expectBump()
            m.setTempo(0, 120)
            expectBump()
            m.setEndBarline('double')
            expectBump()
            m.setClef(0, 'bass')
            expectBump()
            m.setKeySignature(0, 1)
            expectBump()
        })

        it('reading derived state does not move the version', () => {
            const score = makeScore(1)
            const m = score.measures[0]
            const v = m.version
            void m.beats
            void m.tuplets
            void m.layout
            expect(m.version).toBe(v)
        })
    })

    describe('layout gateway', () => {
        it('delegates into the current ScoreLayout and is stable without mutation', () => {
            const score = makeScore(1)
            const m = score.measures[0]
            expect(m.layout).toBe(m.layout)
        })

        it('a content mutation yields a new layout instance (new id)', () => {
            const score = makeScore(1)
            const m = score.measures[0]
            const before = m.layout
            m.addNotes([rest('q')])
            expect(m.layout).not.toBe(before)
            expect(m.layout.id).not.toBe(before.id)
        })

        it('throws for a measure that was never added to the score', () => {
            const score = makeScore(1)
            const stray = new Measure(score, 'treble', new TimeSignature(4, 4))
            expect(() => stray.layout).toThrow('Measure not part of this score layout')
        })
    })

    describe('barline width (MeasureLayout.barlineWidth)', () => {
        it('returns 0 for none', () => {
            expect(MeasureLayout.barlineWidth('none')).toBe(0)
        })

        it('end barline is wider than single, double wider than single', () => {
            expect(MeasureLayout.barlineWidth('end')).toBeGreaterThan(MeasureLayout.barlineWidth('single'))
            expect(MeasureLayout.barlineWidth('double')).toBeGreaterThan(MeasureLayout.barlineWidth('single'))
        })

        it('defaults to single barline width when unset', () => {
            expect(MeasureLayout.barlineWidth(undefined)).toBe(MeasureLayout.barlineWidth('single'))
        })
    })

    describe('beats / maxBeats', () => {
        it('beats sums effectiveBeats of notes', () => {
            const score = makeScore(1)
            const m = score.firstMeasure
            if (!m) throw new Error('expected firstMeasure')
            // Default complete() fills measure to maxBeats (4)
            expect(m.beats).toBeCloseTo(m.maxBeats)
        })

        it('maxBeats reflects time signature', () => {
            const score = new Score()
            const m = new Measure(score, 'treble', new TimeSignature(3, 4))
            expect(m.maxBeats).toBe(3)
        })
    })

    describe('addNotes / removeNotes / replaceNotes', () => {
        it('addNotes appends and assigns measure', () => {
            const score = new Score()
            const m = new Measure(score, 'treble', new TimeSignature(4, 4))
            const n = rest('q')
            m.addNotes([n])
            expect(m.notes).toContain(n)
            expect(n.measure).toBe(m)
        })

        it('addNotes at "start" prepends', () => {
            const score = new Score()
            const m = new Measure(score, 'treble', new TimeSignature(4, 4))
            const a = rest('q')
            const b = rest('q')
            m.addNotes([a])
            m.addNotes([b], 'start')
            expect(m.notes[0]).toBe(b)
        })

        it('removeNotes detaches measure from removed notes', () => {
            const score = new Score()
            const m = new Measure(score, 'treble', new TimeSignature(4, 4))
            const n = rest('q')
            m.addNotes([n])
            m.removeNotes([n])
            expect(m.notes).not.toContain(n)
            expect(() => n.measure).toThrow()
        })

        it('replaceNotes throws when targets are not in this measure', () => {
            const score = new Score()
            const m1 = new Measure(score, 'treble', new TimeSignature(4, 4))
            const m2 = new Measure(score, 'treble', new TimeSignature(4, 4))
            const n = rest('q')
            m2.addNotes([n])
            expect(() => m1.replaceNotes([n], [rest('q')])).toThrow()
        })

        it('replaceNotes throws when targets is empty', () => {
            const score = new Score()
            const m = new Measure(score, 'treble', new TimeSignature(4, 4))
            expect(() => m.replaceNotes([], [rest('q')])).toThrow()
        })

        it('replaceNotes preserves position of replacement', () => {
            const score = new Score()
            const m = new Measure(score, 'treble', new TimeSignature(4, 4))
            const a = rest('q')
            const b = rest('q')
            const c = rest('q')
            m.addNotes([a, b, c])
            const replacement = rest('h')
            m.replaceNotes([b], [replacement])
            expect(m.notes).toEqual([a, replacement, c])
        })

        it('replaceNotes throws when a target belongs to this measure but is not in its note list', () => {
            const score = new Score()
            const m = new Measure(score, 'treble', new TimeSignature(4, 4))
            m.addNotes([rest('q')])
            // A note whose measure is set to m (passes the ownership check) but was never added to _notes.
            const orphan = rest('q')
            orphan.setMeasure(m)
            expect(() => m.replaceNotes([orphan], [rest('q')])).toThrow('Cannot find startIndex for replace')
        })
    })

    describe('beatOffsetOf and noteAtBeat', () => {
        it('beatOffsetOf returns cumulative beat positions', () => {
            const score = new Score()
            const m = new Measure(score, 'treble', new TimeSignature(4, 4))
            const n1 = rest('q') // 1 beat
            const n2 = rest('h') // 2 beats
            const n3 = rest('q') // 1 beat
            m.addNotes([n1, n2, n3])
            expect(m.beatOffsetOf(n1)).toBe(0)
            expect(m.beatOffsetOf(n2)).toBeCloseTo(1)
            expect(m.beatOffsetOf(n3)).toBeCloseTo(3)
        })

        it('beatOffsetOf reads the stored beat of clefs and key signatures', () => {
            const score = new Score()
            const m = new Measure(score, 'treble', new TimeSignature(4, 4))
            m.addClef(2, 'bass')
            m.addKeySignature(3, 1)
            const midClef = m.clefAtBeat(2)
            const midKey = m.keyAtBeat(3)
            if (!midClef || !midKey) throw new Error('expected mid-measure clef and key')
            expect(m.beatOffsetOf(midClef)).toBe(2)
            expect(m.beatOffsetOf(midKey)).toBe(3)
        })

        it('beatOffsetOf falls back to 0 for a note that is not in the measure', () => {
            const score = new Score()
            const m = new Measure(score, 'treble', new TimeSignature(4, 4))
            m.addNotes([rest('q')])
            expect(m.beatOffsetOf(rest('q'))).toBe(0)
        })

        it('noteAtBeat returns the note whose range contains the beat', () => {
            const score = new Score()
            const m = new Measure(score, 'treble', new TimeSignature(4, 4))
            const n1 = rest('q')
            const n2 = rest('h')
            const n3 = rest('q')
            m.addNotes([n1, n2, n3])
            expect(m.noteAtBeat(0)).toBe(n1)
            expect(m.noteAtBeat(1)).toBe(n2)
            expect(m.noteAtBeat(2.5)).toBe(n2)
            expect(m.noteAtBeat(3)).toBe(n3)
        })

        it('noteAtBeat returns null when no note begins at or before the beat', () => {
            const score = new Score()
            const m = new Measure(score, 'treble', new TimeSignature(4, 4))
            m.addNotes([rest('q')])
            // The first note sits at beat 0; a negative beat precedes every note.
            expect(m.noteAtBeat(-1)).toBeNull()
        })

        it('noteAtBeat returns null on an empty measure', () => {
            const score = new Score()
            const m = new Measure(score, 'treble', new TimeSignature(4, 4))
            expect(m.noteAtBeat(0)).toBeNull()
        })
    })

    describe('navigation', () => {
        it('getNextNote / getPreviousNote', () => {
            const score = new Score()
            const m = new Measure(score, 'treble', new TimeSignature(4, 4))
            const n1 = rest('q')
            const n2 = rest('q')
            m.addNotes([n1, n2])
            expect(m.getNextNote(n1)).toBe(n2)
            expect(m.getNextNote(n2)).toBeNull()
            expect(m.getPreviousNote(n2)).toBe(n1)
            expect(m.getPreviousNote(n1)).toBeNull()
        })

        it('getNextNote without arg returns firstNote', () => {
            const score = new Score()
            const m = new Measure(score, 'treble', new TimeSignature(4, 4))
            const n = rest('q')
            m.addNotes([n])
            expect(m.getNextNote()).toBe(n)
        })

        it('getNextNote / getPreviousNote return null for a foreign note', () => {
            const score = new Score()
            const m = new Measure(score, 'treble', new TimeSignature(4, 4))
            m.addNotes([rest('q'), rest('q')])
            expect(m.getNextNote(rest('q'))).toBeNull()
            expect(m.getPreviousNote(rest('q'))).toBeNull()
        })

        it('getNext / getPrevious delegate to the score', () => {
            const score = makeScore(2)
            const [a, b] = score.measures
            expect(a.getNext()).toBe(b)
            expect(b.getNext()).toBeNull()
            expect(b.getPrevious()).toBe(a)
            expect(a.getPrevious()).toBeNull()
        })
    })

    describe('tempo management', () => {
        it('addTempo / removeTempo / setTempo', () => {
            const score = new Score()
            const m = new Measure(score, 'treble', new TimeSignature(4, 4))
            m.addTempo(0, 120)
            expect(m.tempos).toHaveLength(1)
            expect(m.tempoAtBeat(0)?.bpm).toBe(120)
            m.setTempo(0, 90)
            expect(m.tempos).toHaveLength(1)
            expect(m.tempoAtBeat(0)?.bpm).toBe(90)
            m.removeTempo(0)
            expect(m.tempos).toHaveLength(0)
        })

        it('tempoAtOrBefore returns the latest marking at or before a beat, undefined when none precede', () => {
            const score = new Score()
            const m = new Measure(score, 'treble', new TimeSignature(4, 4))
            m.addTempo(0, 90)
            m.addTempo(2, 120)
            expect(m.tempoAtOrBefore(0)?.bpm).toBe(90)
            expect(m.tempoAtOrBefore(1)?.bpm).toBe(90)
            expect(m.tempoAtOrBefore(2)?.bpm).toBe(120)
            expect(m.tempoAtOrBefore(3)?.bpm).toBe(120)
        })

        it('tempoAtOrBefore is undefined when no marking precedes the beat', () => {
            const score = new Score()
            const m = new Measure(score, 'treble', new TimeSignature(4, 4))
            m.addTempo(2, 120)
            expect(m.tempoAtOrBefore(1)).toBeUndefined()
        })

        it('lastTempo is the highest-beat marking, undefined when there are none', () => {
            const score = new Score()
            const m = new Measure(score, 'treble', new TimeSignature(4, 4))
            expect(m.lastTempo).toBeUndefined()
            m.addTempo(0, 90)
            m.addTempo(3, 60)
            m.addTempo(1, 120) // out of order; lastTempo must still be the beat-3 marking
            expect(m.lastTempo?.bpm).toBe(60)
            expect(m.lastTempo?.beatPosition).toBe(3)
        })
    })

    describe('clef management', () => {
        it('seeds the leading clef at beat 0 from the constructor', () => {
            const score = new Score()
            const m = new Measure(score, 'treble', new TimeSignature(4, 4))
            expect(m.clefs).toHaveLength(1)
            expect(m.clef.type).toBe('treble')
            expect(m.clef.beatPosition).toBe(0)
        })

        it('addClef appends a mid-measure clef change', () => {
            const score = new Score()
            const m = new Measure(score, 'treble', new TimeSignature(4, 4))
            m.addClef(2, 'bass')
            expect(m.clefs).toHaveLength(2)
            expect(m.clefAtBeat(2)?.type).toBe('bass')
        })

        it('setClef(0) replaces the leading clef and marks it explicit', () => {
            const score = new Score()
            const m = new Measure(score, 'treble', new TimeSignature(4, 4))
            m.setClef(0, 'bass')
            expect(m.clefs).toHaveLength(1)
            expect(m.clef.type).toBe('bass')
            expect(m.leadingClefExplicit).toBe(true)
        })

        it('setClef drops a mid-measure change equal to the clef already in effect', () => {
            const score = new Score()
            const m = new Measure(score, 'treble', new TimeSignature(4, 4))
            m.setClef(2, 'treble') // same as the leading treble → redundant, not stored
            expect(m.clefAtBeat(2)).toBeUndefined()
            expect(m.midMeasureClefs).toHaveLength(0)
        })

        it('makeLeadingClefInherited demotes the explicit flag', () => {
            const score = new Score()
            const m = new Measure(score, 'treble', new TimeSignature(4, 4))
            m.setClef(0, 'bass')
            expect(m.leadingClefExplicit).toBe(true)
            m.makeLeadingClefInherited()
            expect(m.leadingClefExplicit).toBe(false)
            expect(m.clef.type).toBe('bass') // the clef itself is untouched
        })

        it('clef falls back to the first stored clef when none sits at beat 0', () => {
            const score = new Score()
            const m = new Measure(score, 'treble', new TimeSignature(4, 4))
            m.addClef(2, 'bass') // a mid-measure clef
            m.removeClef(0) // drop the leading clef so nothing remains at beat 0
            // The getter falls back to the first remaining clef rather than throwing.
            expect(m.clef).toBe(m.clefs[0])
            expect(m.clef.beatPosition).toBe(2)
        })

        it('clef throws when the measure has no clefs at all', () => {
            const score = new Score()
            const m = new Measure(score, 'treble', new TimeSignature(4, 4))
            m.removeClef(0)
            expect(() => m.clef).toThrow('Measure has no leading clef')
            expect(() => m.lastClef).toThrow('Measure has no leading clef') // fallback re-enters clef
        })

        it('clefAtOrBefore returns the active clef at a beat', () => {
            const score = new Score()
            const m = new Measure(score, 'treble', new TimeSignature(4, 4))
            m.addClef(2, 'bass')
            expect(m.clefAtOrBefore(0).type).toBe('treble')
            expect(m.clefAtOrBefore(1).type).toBe('treble')
            expect(m.clefAtOrBefore(2).type).toBe('bass')
            expect(m.clefAtOrBefore(3).type).toBe('bass')
        })

        it('clefAtOrBefore falls back to the leading clef when nothing precedes the beat', () => {
            const score = new Score()
            const m = new Measure(score, 'treble', new TimeSignature(4, 4))
            m.addClef(2, 'bass')
            m.removeClef(0) // only the beat-2 clef remains
            expect(m.clefAtOrBefore(1).beatPosition).toBe(2) // fallback: the first stored clef
        })

        it('clefBefore ignores a clef exactly at the beat', () => {
            const score = new Score()
            const m = new Measure(score, 'treble', new TimeSignature(4, 4))
            m.addClef(2, 'bass')
            expect(m.clefBefore(2).type).toBe('treble')
            expect(m.clefBefore(3).type).toBe('bass')
            expect(m.clefBefore(0).type).toBe('treble') // nothing strictly before beat 0 → leading clef
        })

        it('lastClef is the highest-beat clef (carried into the next measure)', () => {
            const score = new Score()
            const m = new Measure(score, 'treble', new TimeSignature(4, 4))
            expect(m.lastClef.type).toBe('treble')
            m.addClef(2, 'bass')
            expect(m.lastClef.type).toBe('bass')
        })

        it('a mid-measure clef is spaced in the layout so notes make room', () => {
            const score = makeScore(1)
            const m = score.firstMeasure
            if (!m) throw new Error('expected firstMeasure')
            m.setClef(2, 'bass')
            const midClef = m.clefAtBeat(2)
            if (!midClef) throw new Error('expected mid-measure clef')
            expect(() => m.layout.getXForElement(midClef)).not.toThrow()
            expect(m.layout.getXForElement(midClef)).toBeGreaterThan(m.layout.getXForElement(m.clef))
        })

        it('sorts multiple mid-measure clef changes by beat', () => {
            const score = new Score()
            const m = new Measure(score, 'treble', new TimeSignature(4, 4))
            // Insert out of beat order; midMeasureClefs must return them sorted.
            m.addClef(3, 'alto')
            m.addClef(1, 'bass')
            expect(m.midMeasureClefs.map((c) => c.beatPosition)).toEqual([1, 3])
            expect(m.midMeasureClefs.map((c) => c.type)).toEqual(['bass', 'alto'])
        })
    })

    describe('key signature management', () => {
        it('seeds a leading key (default C major) at beat 0 from the constructor', () => {
            const score = new Score()
            const m = new Measure(score, 'treble', new TimeSignature(4, 4))
            expect(m.keySignatures).toHaveLength(1)
            expect(m.keySignature.fifths).toBe(0)
            expect(m.keySignature.beatPosition).toBe(0)
        })

        it('honours an explicit leading key from the constructor', () => {
            const score = new Score()
            const m = new Measure(score, 'treble', new TimeSignature(4, 4), { keyFifths: 2 })
            expect(m.keySignature.fifths).toBe(2)
        })

        it('addKeySignature appends a mid-measure key change', () => {
            const score = new Score()
            const m = new Measure(score, 'treble', new TimeSignature(4, 4))
            m.addKeySignature(2, -3)
            expect(m.keyAtBeat(2)?.fifths).toBe(-3)
        })

        it('setKeySignature(0) replaces the leading key and marks it explicit', () => {
            const score = new Score()
            const m = new Measure(score, 'treble', new TimeSignature(4, 4))
            m.setKeySignature(0, 1)
            expect(m.keySignatures.filter((k) => k.beatPosition === 0)).toHaveLength(1)
            expect(m.keySignature.fifths).toBe(1)
            expect(m.leadingKeyExplicit).toBe(true)
        })

        it('setKeySignature drops a mid-measure change equal to the key already in effect', () => {
            const score = new Score()
            const m = new Measure(score, 'treble', new TimeSignature(4, 4), { keyFifths: 1 }) // leading G major
            m.setKeySignature(2, 1) // same as the carried-in G major → redundant, not stored at beat 2
            expect(m.keyAtBeat(2)).toBeUndefined()
            expect(m.midMeasureKeySignatures).toHaveLength(0)
        })

        it('makeLeadingKeyInherited demotes the explicit flag', () => {
            const score = new Score()
            const m = new Measure(score, 'treble', new TimeSignature(4, 4))
            m.setKeySignature(0, 2)
            expect(m.leadingKeyExplicit).toBe(true)
            m.makeLeadingKeyInherited()
            expect(m.leadingKeyExplicit).toBe(false)
            expect(m.keySignature.fifths).toBe(2) // the key itself is untouched
        })

        it('keySignature falls back to the first stored key when none sits at beat 0', () => {
            const score = new Score()
            const m = new Measure(score, 'treble', new TimeSignature(4, 4))
            m.addKeySignature(2, 2) // a mid-measure key
            m.removeKeySignature(0) // drop the leading key so nothing remains at beat 0
            expect(m.keySignature).toBe(m.keySignatures[0])
            expect(m.keySignature.beatPosition).toBe(2)
        })

        it('keySignature throws when the measure has no keys at all', () => {
            const score = new Score()
            const m = new Measure(score, 'treble', new TimeSignature(4, 4))
            m.removeKeySignature(0)
            expect(() => m.keySignature).toThrow('Measure has no leading key signature')
            expect(() => m.lastKey).toThrow('Measure has no leading key signature')
        })

        it('keyAtOrBefore returns the active key at a beat', () => {
            const score = new Score()
            const m = new Measure(score, 'treble', new TimeSignature(4, 4))
            m.addKeySignature(2, 1)
            expect(m.keyAtOrBefore(0).fifths).toBe(0)
            expect(m.keyAtOrBefore(1).fifths).toBe(0)
            expect(m.keyAtOrBefore(2).fifths).toBe(1)
            expect(m.keyAtOrBefore(3).fifths).toBe(1)
        })

        it('keyAtOrBefore falls back to the leading key when nothing precedes the beat', () => {
            const score = new Score()
            const m = new Measure(score, 'treble', new TimeSignature(4, 4))
            m.addKeySignature(2, 1)
            m.removeKeySignature(0) // only the beat-2 key remains
            expect(m.keyAtOrBefore(1).beatPosition).toBe(2) // fallback: the first stored key
        })

        it('keyBefore ignores a key exactly at the beat', () => {
            const score = new Score()
            const m = new Measure(score, 'treble', new TimeSignature(4, 4))
            m.addKeySignature(2, 1)
            expect(m.keyBefore(2).fifths).toBe(0)
            expect(m.keyBefore(3).fifths).toBe(1)
            expect(m.keyBefore(0).fifths).toBe(0) // nothing strictly before beat 0 → leading key
        })

        it('lastKey is the highest-beat key (carried into the next measure)', () => {
            const score = new Score()
            const m = new Measure(score, 'treble', new TimeSignature(4, 4))
            expect(m.lastKey.fifths).toBe(0)
            m.addKeySignature(2, -2)
            expect(m.lastKey.fifths).toBe(-2)
        })

        it('midMeasureKeySignatures excludes a change equal to the key already in effect', () => {
            const score = new Score()
            const m = new Measure(score, 'treble', new TimeSignature(4, 4), { keyFifths: 1 })
            m.addKeySignature(2, 1) // same as leading G major → a no-op, not drawn
            expect(m.midMeasureKeySignatures).toHaveLength(0)
            m.addKeySignature(3, 2) // a real change
            expect(m.midMeasureKeySignatures.map((k) => k.fifths)).toEqual([2])
        })

        it('sorts multiple mid-measure key changes by beat', () => {
            const score = new Score()
            const m = new Measure(score, 'treble', new TimeSignature(4, 4))
            m.addKeySignature(3, -2) // out of order
            m.addKeySignature(1, 2)
            expect(m.midMeasureKeySignatures.map((k) => k.beatPosition)).toEqual([1, 3])
            expect(m.midMeasureKeySignatures.map((k) => k.fifths)).toEqual([2, -2])
        })

        it('a mid-measure key is spaced in the layout so notes make room', () => {
            const score = makeScore(1)
            const m = score.firstMeasure
            if (!m) throw new Error('expected firstMeasure')
            m.setKeySignature(2, 3)
            const midKey = m.keyAtBeat(2)
            if (!midKey) throw new Error('expected mid-measure key')
            expect(() => m.layout.getXForElement(midKey)).not.toThrow()
        })

        it('repositions key-signature accidentals when the clef changes', () => {
            const score = makeScore(1)
            const m = score.firstMeasure
            if (!m) throw new Error('expected firstMeasure')
            m.setKeySignature(0, 1) // G major: one sharp
            const trebleY = m.keySignature.layout.accidentals[0].y
            m.setClef(0, 'bass')
            const bassY = m.keySignature.layout.accidentals[0].y
            expect(bassY).not.toBe(trebleY) // the F# sits on a different line under the bass clef
        })

        it('transposeKeySignatures re-keys every key in the measure', () => {
            const score = new Score()
            const m = new Measure(score, 'treble', new TimeSignature(4, 4), { keyFifths: 0, keyMode: 'major' })
            m.addKeySignature(2, 1)
            m.transposeKeySignatures(2, 1) // up a major 2nd: +2 fifths
            expect(m.keySignature.fifths).toBe(2)
            expect(m.keySignature.mode).toBe('major') // mode survives the rewrite
            expect(m.keyAtBeat(2)?.fifths).toBe(3)
        })
    })

    describe('inherited carry-forward applicators', () => {
        it('applyInheritedClef rewrites the leading clef without marking it explicit or dirty', () => {
            const score = makeScore(1)
            const m = score.measures[0]
            score.clearDirty()
            const v = m.version
            m.applyInheritedClef('bass')
            expect(m.clef.type).toBe('bass')
            expect(m.leadingClefExplicit).toBe(false)
            expect(m.version).toBeGreaterThan(v) // stale layouts must rebuild
            // Inherited values don't change the serialized form → nothing marked dirty.
            expect(score.flushDirty()).toBeNull()
        })

        it('applyInheritedClef is a no-op on an explicit leading clef or an equal type', () => {
            const score = new Score()
            const m = new Measure(score, 'treble', new TimeSignature(4, 4))
            const v = m.version
            m.applyInheritedClef('treble') // same type → no-op
            expect(m.version).toBe(v)
            m.setClef(0, 'bass') // explicit boundary
            const v2 = m.version
            m.applyInheritedClef('alto')
            expect(m.clef.type).toBe('bass') // explicit wins
            expect(m.version).toBe(v2)
        })

        it('applyInheritedKey rewrites the leading key without marking it explicit', () => {
            const score = new Score()
            const m = new Measure(score, 'treble', new TimeSignature(4, 4))
            const v = m.version
            m.applyInheritedKey(3, 'minor')
            expect(m.keySignature.fifths).toBe(3)
            expect(m.keySignature.mode).toBe('minor')
            expect(m.leadingKeyExplicit).toBe(false)
            expect(m.version).toBeGreaterThan(v)
        })

        it('applyInheritedKey applies when only the mode differs', () => {
            const score = new Score()
            const m = new Measure(score, 'treble', new TimeSignature(4, 4), { keyFifths: 0, keyMode: 'major' })
            m.applyInheritedKey(0, 'minor') // same fifths, different mode → still applied
            expect(m.keySignature.mode).toBe('minor')
        })

        it('applyInheritedKey is a no-op on an explicit leading key or an equal key', () => {
            const score = new Score()
            const m = new Measure(score, 'treble', new TimeSignature(4, 4), { keyFifths: 1, keyMode: 'major' })
            const v = m.version
            m.applyInheritedKey(1, 'major') // identical → no-op
            expect(m.version).toBe(v)
            m.setKeySignature(0, 2) // explicit boundary
            const v2 = m.version
            m.applyInheritedKey(-1)
            expect(m.keySignature.fifths).toBe(2) // explicit wins
            expect(m.version).toBe(v2)
        })
    })

    describe('complete()', () => {
        it('fills empty measure with rests up to maxBeats', () => {
            const score = new Score()
            const m = new Measure(score, 'treble', new TimeSignature(4, 4))
            m.complete()
            expect(m.beats).toBeCloseTo(4)
            expect(m.notes.every((n) => n.isRest)).toBe(true)
        })

        it('does nothing when already full', () => {
            const score = new Score()
            const m = new Measure(score, 'treble', new TimeSignature(4, 4))
            m.addNotes([new Note({ duration: new Duration({ type: 'w' }) })])
            const before = m.notes.length
            m.complete()
            expect(m.notes.length).toBe(before)
        })
    })

    describe('firstNote / lastNote', () => {
        it('reflect first and last entries, null when empty', () => {
            const score = new Score()
            const m = new Measure(score, 'treble', new TimeSignature(4, 4))
            expect(m.firstNote).toBeNull()
            expect(m.lastNote).toBeNull()
            const a = rest('q')
            const b = rest('q')
            m.addNotes([a, b])
            expect(m.firstNote).toBe(a)
            expect(m.lastNote).toBe(b)
        })
    })

    describe('index', () => {
        it('reports the measure position within its score', () => {
            const score = makeScore(3)
            expect(score.measures[0].index).toBe(0)
            expect(score.measures[2].index).toBe(2)
        })
    })

    describe('tuplets', () => {
        it('tupletGroupOf finds the group of a tuplet note, undefined for plain notes', () => {
            const score = makeScore(1)
            const m = score.measures[0]
            const first = m.firstNote
            if (!first) throw new Error('expected firstNote')
            const [placed] = score.replace([first], [pitched('C', 4)])
            const tripletFirst = score.toggleTuplet(placed)
            if (!tripletFirst) throw new Error('expected triplet note')
            expect(m.tuplets).toHaveLength(1)
            expect(m.tupletGroupOf(tripletFirst)).toBe(m.tuplets[0])
            const plain = m.lastNote
            if (!plain) throw new Error('expected last note')
            expect(m.tupletGroupOf(plain)).toBeUndefined()
        })

        it('tuplet groups are stable between reads without a mutation', () => {
            const score = makeScore(1)
            const m = score.measures[0]
            const first = m.firstNote
            if (!first) throw new Error('expected firstNote')
            const [placed] = score.replace([first], [pitched('C', 4)])
            score.toggleTuplet(placed)
            expect(m.tuplets[0]).toBe(m.tuplets[0])
            expect(m.tuplets).toBe(m.tuplets) // derived per version, not rebuilt per read
        })
    })

    describe('beams (via layout)', () => {
        it('beamFor returns the beam group of a beamed note, undefined otherwise', () => {
            const score = makeScore(1)
            const m = score.measures[0]
            const first = m.firstNote
            if (!first) throw new Error('expected firstNote')
            // Two consecutive eighths beam together.
            score.replace([first], [pitched('C', 5, '8'), pitched('D', 5, '8')])
            const [a, b] = m.notes
            const beam = m.layout.beamFor(a)
            expect(beam).toBeDefined()
            expect(beam?.notes).toContain(a)
            expect(beam?.notes).toContain(b)
            expect(m.layout.beams).toContain(beam)
            // A rest is not beamed.
            const lastRest = m.lastNote
            if (!lastRest) throw new Error('expected rest')
            expect(m.layout.beamFor(lastRest)).toBeUndefined()
        })
    })

    describe('displayed accidentals across a mid-measure key change (via layout)', () => {
        it('clears carried accidentals when a new key takes effect mid-bar', () => {
            const score = makeScore(1)
            const m = score.measures[0]
            // F# (explicit accidental) in C major, then a mid-measure switch to a key, then F again.
            const fSharp = new Note({ duration: new Duration({ type: 'q' }), pitch: new Pitch({ name: 'F', alter: 1, octave: 5 }) })
            const a = pitched('A', 4, 'q')
            const fAfterKey = new Note({ duration: new Duration({ type: 'q' }), pitch: new Pitch({ name: 'F', alter: 0, octave: 5 }) })
            const b = pitched('B', 4, 'q')
            m.replaceNotes(m.notes, [fSharp, a, fAfterKey, b])
            m.addKeySignature(2, 1) // G major at beat 2: F is sharp by key
            // First F shows a sharp (differs from C-major natural).
            expect(fSharp.layout.accidental?.glyphName).toBe('accidentalSharp')
            // The key change at beat 2 resets the carried sharp; the natural F after it now differs
            // from the G-major key (which expects F#), so it shows a natural.
            expect(fAfterKey.layout.accidental?.glyphName).toBe('accidentalNatural')
        })
    })

    describe('shows flags (computed by the layout)', () => {
        it('the first measure shows clef and time signature', () => {
            const score = makeScore(2)
            expect(score.measures[0].layout.showsClef).toBe(true)
            expect(score.measures[0].layout.showsTimeSignature).toBe(true)
            // The second measure repeats nothing.
            expect(score.measures[1].layout.showsTimeSignature).toBe(false)
        })

        it('a time signature change makes the measure show it again', () => {
            const score = makeScore(2)
            const m1 = score.measures[1]
            m1.setTimeSignature(new TimeSignature(3, 4))
            expect(m1.layout.showsTimeSignature).toBe(true)
        })
    })

    describe('setTimeSignature', () => {
        it('replaces the time signature value', () => {
            const score = new Score()
            const m = new Measure(score, 'treble', new TimeSignature(4, 4))
            expect(m.maxBeats).toBe(4)
            const threeFour = new TimeSignature(3, 4)
            m.setTimeSignature(threeFour)
            expect(m.timeSignature).toBe(threeFour)
            expect(m.maxBeats).toBe(3)
        })
    })

    describe('setEndBarline', () => {
        it('stores the barline type', () => {
            const score = new Score()
            const m = new Measure(score, 'treble', new TimeSignature(4, 4))
            expect(m.endBarline).toBeUndefined()
            m.setEndBarline('double')
            expect(m.endBarline).toBe('double')
            m.setEndBarline(undefined)
            expect(m.endBarline).toBeUndefined()
        })
    })

    describe('beatOffsetOf type dispatch', () => {
        it('treats Clef and KeySignature subclasses by their stored beat, notes by accumulation', () => {
            const score = new Score()
            const m = new Measure(score, 'treble', new TimeSignature(4, 4))
            const n = rest('h')
            m.addNotes([rest('q'), n])
            expect(m.beatOffsetOf(n)).toBe(1)
            expect(m.beatOffsetOf(m.clef)).toBe(0)
            expect(m.beatOffsetOf(m.keySignature)).toBe(0)
            expect(m.clef).toBeInstanceOf(Clef)
            expect(m.keySignature).toBeInstanceOf(KeySignature)
        })
    })
})
