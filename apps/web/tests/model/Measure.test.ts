import { describe, expect, it } from 'vitest'

import { defaults, makeScore, pitched, rest } from '@test/helpers'
import { Clef } from '@/model/Clef'
import { Duration } from '@/model/Duration'
import { KeySignature } from '@/model/KeySignature'
import { Measure } from '@/model/Measure'
import { Note } from '@/model/Note'
import { Score } from '@/model/Score'
import { TimeSignature } from '@/model/TimeSignature'

describe('Measure', () => {
    describe('construction', () => {
        it('attaches clef and time signature to the measure', () => {
            const score = new Score()
            const { clef, timeSignature } = defaults()
            const m = new Measure(score, clef, timeSignature)
            expect(clef.measure).toBe(m)
            expect(timeSignature.measure).toBe(m)
        })

        it('starts with no notes, no tempos, no tuplets, no beams', () => {
            const score = new Score()
            const m = new Measure(score, ...Object.values(defaults()) as [Clef, TimeSignature])
            expect(m.notes).toEqual([])
            expect(m.tempos).toEqual([])
            expect(m.tuplets).toEqual([])
            expect(m.beams).toEqual([])
        })

        it('exposes optional key signature and end barline', () => {
            const score = new Score()
            const { clef, timeSignature } = defaults()
            const k = new KeySignature(2)
            const m = new Measure(score, clef, timeSignature, { keySignature: k, endBarline: 'end' })
            expect(m.keySignature).toBe(k)
            expect(m.endBarline).toBe('end')
        })

        it('has a unique id', () => {
            const score = new Score()
            const a = new Measure(score, new Clef('treble'), new TimeSignature(4, 4))
            const b = new Measure(score, new Clef('treble'), new TimeSignature(4, 4))
            expect(a.id).not.toBe(b.id)
        })
    })

    describe('barline width', () => {
        it('returns 0 for none', () => {
            const score = new Score()
            const m = new Measure(score, new Clef('treble'), new TimeSignature(4, 4), { endBarline: 'none' })
            expect(m.barlineWidth).toBe(0)
        })

        it('end barline is wider than single', () => {
            const score = new Score()
            const single = new Measure(score, new Clef('treble'), new TimeSignature(4, 4), { endBarline: 'single' })
            const end = new Measure(score, new Clef('treble'), new TimeSignature(4, 4), { endBarline: 'end' })
            expect(end.barlineWidth).toBeGreaterThan(single.barlineWidth)
        })

        it('defaults to single barline width when unset', () => {
            const score = new Score()
            const m = new Measure(score, new Clef('treble'), new TimeSignature(4, 4))
            const single = new Measure(score, new Clef('treble'), new TimeSignature(4, 4), { endBarline: 'single' })
            expect(m.barlineWidth).toBe(single.barlineWidth)
        })
    })

    describe('beats / maxBeats', () => {
        it('beats sums effectiveBeats of notes', () => {
            const score = makeScore(1)
            const m = score.firstMeasure!
            // Default complete() fills measure to maxBeats (4)
            expect(m.beats).toBeCloseTo(m.maxBeats)
        })

        it('maxBeats reflects time signature', () => {
            const score = new Score()
            const m = new Measure(score, new Clef('treble'), new TimeSignature(3, 4))
            expect(m.maxBeats).toBe(3)
        })
    })

    describe('addNotes / removeNotes / replaceNotes', () => {
        it('addNotes appends and assigns measure', () => {
            const score = new Score()
            const m = new Measure(score, new Clef('treble'), new TimeSignature(4, 4))
            const n = rest('q')
            m.addNotes([n])
            expect(m.notes).toContain(n)
            expect(n.measure).toBe(m)
        })

        it('addNotes at "start" prepends', () => {
            const score = new Score()
            const m = new Measure(score, new Clef('treble'), new TimeSignature(4, 4))
            const a = rest('q')
            const b = rest('q')
            m.addNotes([a])
            m.addNotes([b], 'start')
            expect(m.notes[0]).toBe(b)
        })

        it('removeNotes detaches measure from removed notes', () => {
            const score = new Score()
            const m = new Measure(score, new Clef('treble'), new TimeSignature(4, 4))
            const n = rest('q')
            m.addNotes([n])
            m.removeNotes([n])
            expect(m.notes).not.toContain(n)
            expect(() => n.measure).toThrow()
        })

        it('replaceNotes throws when targets are not in this measure', () => {
            const score = new Score()
            const m1 = new Measure(score, new Clef('treble'), new TimeSignature(4, 4))
            const m2 = new Measure(score, new Clef('treble'), new TimeSignature(4, 4))
            const n = rest('q')
            m2.addNotes([n])
            expect(() => m1.replaceNotes([n], [rest('q')])).toThrow()
        })

        it('replaceNotes throws when targets is empty', () => {
            const score = new Score()
            const m = new Measure(score, new Clef('treble'), new TimeSignature(4, 4))
            expect(() => m.replaceNotes([], [rest('q')])).toThrow()
        })

        it('replaceNotes preserves position of replacement', () => {
            const score = new Score()
            const m = new Measure(score, new Clef('treble'), new TimeSignature(4, 4))
            const a = rest('q')
            const b = rest('q')
            const c = rest('q')
            m.addNotes([a, b, c])
            const replacement = rest('h')
            m.replaceNotes([b], [replacement])
            expect(m.notes).toEqual([a, replacement, c])
        })
    })

    describe('beatOffsetOf and noteAtBeat', () => {
        it('beatOffsetOf returns cumulative beat positions', () => {
            const score = new Score()
            const m = new Measure(score, new Clef('treble'), new TimeSignature(4, 4))
            const n1 = rest('q') // 1 beat
            const n2 = rest('h') // 2 beats
            const n3 = rest('q') // 1 beat
            m.addNotes([n1, n2, n3])
            expect(m.beatOffsetOf(n1)).toBe(0)
            expect(m.beatOffsetOf(n2)).toBeCloseTo(1)
            expect(m.beatOffsetOf(n3)).toBeCloseTo(3)
        })

        it('noteAtBeat returns the note whose range contains the beat', () => {
            const score = new Score()
            const m = new Measure(score, new Clef('treble'), new TimeSignature(4, 4))
            const n1 = rest('q')
            const n2 = rest('h')
            const n3 = rest('q')
            m.addNotes([n1, n2, n3])
            expect(m.noteAtBeat(0)).toBe(n1)
            expect(m.noteAtBeat(1)).toBe(n2)
            expect(m.noteAtBeat(2.5)).toBe(n2)
            expect(m.noteAtBeat(3)).toBe(n3)
        })
    })

    describe('navigation', () => {
        it('getNextNote / getPreviousNote', () => {
            const score = new Score()
            const m = new Measure(score, new Clef('treble'), new TimeSignature(4, 4))
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
            const m = new Measure(score, new Clef('treble'), new TimeSignature(4, 4))
            const n = rest('q')
            m.addNotes([n])
            expect(m.getNextNote()).toBe(n)
        })
    })

    describe('tempo management', () => {
        it('addTempo / removeTempo / setTempo', () => {
            const score = new Score()
            const m = new Measure(score, new Clef('treble'), new TimeSignature(4, 4))
            m.addTempo(0, 120)
            expect(m.tempos).toHaveLength(1)
            expect(m.tempoAtBeat(0)?.bpm).toBe(120)
            m.setTempo(0, 90)
            expect(m.tempos).toHaveLength(1)
            expect(m.tempoAtBeat(0)?.bpm).toBe(90)
            m.removeTempo(0)
            expect(m.tempos).toHaveLength(0)
        })
    })

    describe('complete()', () => {
        it('fills empty measure with rests up to maxBeats', () => {
            const score = new Score()
            const m = new Measure(score, new Clef('treble'), new TimeSignature(4, 4))
            m.complete()
            expect(m.beats).toBeCloseTo(4)
            expect(m.notes.every((n) => n.isRest)).toBe(true)
        })

        it('does nothing when already full', () => {
            const score = new Score()
            const m = new Measure(score, new Clef('treble'), new TimeSignature(4, 4))
            m.addNotes([new Note({ duration: new Duration({ type: 'w' }) })])
            const before = m.notes.length
            m.complete()
            expect(m.notes.length).toBe(before)
        })
    })

    describe('minimalWidth', () => {
        it('is 0 immediately after raw construction (documents current behavior)', () => {
            // Note: Measure._minimalWidth is only computed by rebuildPhysicalElements(),
            // which is not invoked from the constructor. A Measure created via
            // Score.addMeasure() ends up calling setEndBarline(), which triggers it.
            // Direct construction leaves minimalWidth at 0 — a latent footgun for any
            // code that consults minimalWidth before mutating the measure.
            const score = new Score()
            const m = new Measure(score, new Clef('treble'), new TimeSignature(4, 4))
            expect(m.minimalWidth).toBe(0)
        })

        it('snaps to absolute minimum (SCORE_WIDTH / 5 = 200) after first rebuild', () => {
            const score = new Score()
            const m = new Measure(score, new Clef('treble'), new TimeSignature(4, 4))
            m.setEndBarline('single') // triggers rebuildPhysicalElements
            expect(m.minimalWidth).toBe(200)
        })

        it('grows with the number of notes when wide enough', () => {
            const score = new Score()
            const m = new Measure(score, new Clef('treble'), new TimeSignature(4, 4))
            // Add many notes to push above absolute minimum
            for (let i = 0; i < 16; i++) m.addNotes([pitched('C', 4, '16')])
            expect(m.minimalWidth).toBeGreaterThan(200)
        })

        it('updates when clef visibility toggles', () => {
            const score = new Score()
            const m = new Measure(score, new Clef('treble'), new TimeSignature(4, 4))
            for (let i = 0; i < 16; i++) m.addNotes([pitched('C', 4, '16')])
            const before = m.minimalWidth
            m.setShowsClef(true)
            const after = m.minimalWidth
            expect(after).toBeGreaterThan(before)
        })
    })

    describe('layout invalidation', () => {
        it('invalidateLayout clears cached layout', () => {
            const score = makeScore(1)
            const m = score.firstMeasure!
            const l1 = m.layout
            m.invalidateLayout()
            const l2 = m.layout
            expect(l1).not.toBe(l2)
        })

        it('mutating notes invalidates layout', () => {
            const score = makeScore(1)
            const m = score.firstMeasure!
            const l1 = m.layout
            m.addNotes([rest('q')])
            const l2 = m.layout
            expect(l1).not.toBe(l2)
        })
    })

    describe('hasNote / firstNote / lastNote', () => {
        it('hasNote tracks membership', () => {
            const score = new Score()
            const m = new Measure(score, new Clef('treble'), new TimeSignature(4, 4))
            const n = rest('q')
            expect(m.hasNote(n)).toBe(false)
            m.addNotes([n])
            expect(m.hasNote(n)).toBe(true)
            m.removeNotes([n])
            expect(m.hasNote(n)).toBe(false)
        })

        it('firstNote / lastNote reflect first and last entries', () => {
            const score = new Score()
            const m = new Measure(score, new Clef('treble'), new TimeSignature(4, 4))
            expect(m.firstNote).toBeNull()
            const a = rest('q')
            const b = rest('q')
            m.addNotes([a, b])
            expect(m.firstNote).toBe(a)
            expect(m.lastNote).toBe(b)
        })

        it('hasNote tolerates null/undefined', () => {
            const score = new Score()
            const m = new Measure(score, new Clef('treble'), new TimeSignature(4, 4))
            expect(m.hasNote(null)).toBe(false)
            expect(m.hasNote(undefined)).toBe(false)
        })
    })
})
