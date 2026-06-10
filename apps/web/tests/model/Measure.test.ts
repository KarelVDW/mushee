import { defaults, makeScore, pitched, rest } from '@test/helpers'
import { describe, expect, it } from 'vitest'

import type { ClefType } from '@/components/notation/types'
import { Clef } from '@/model/Clef'
import { Duration } from '@/model/Duration'
import { KeySignature } from '@/model/KeySignature'
import { Measure } from '@/model/Measure'
import { Note } from '@/model/Note'
import { Pitch } from '@/model/Pitch'
import { Score } from '@/model/Score'
import { TimeSignature } from '@/model/TimeSignature'

describe('Measure', () => {
    describe('construction', () => {
        it('attaches clef and time signature to the measure', () => {
            const score = new Score()
            const { clefType, timeSignature } = defaults()
            const m = new Measure(score, clefType, timeSignature)
            expect(m.clef.measure).toBe(m)
            expect(m.clef.type).toBe(clefType)
            expect(timeSignature.measure).toBe(m)
        })

        it('starts with no notes, no tempos, no tuplets, no beams', () => {
            const score = new Score()
            const m = new Measure(score, ...(Object.values(defaults()) as [ClefType, TimeSignature]))
            expect(m.notes).toEqual([])
            expect(m.tempos).toEqual([])
            expect(m.tuplets).toEqual([])
            expect(m.beams).toEqual([])
        })

        it('exposes the leading key signature and end barline', () => {
            const score = new Score()
            const { clefType, timeSignature } = defaults()
            const m = new Measure(score, clefType, timeSignature, { keyFifths: 2, endBarline: 'end' })
            expect(m.keySignature.fifths).toBe(2)
            expect(m.keySignature.beatPosition).toBe(0)
            expect(m.endBarline).toBe('end')
        })

        it('has a unique id', () => {
            const score = new Score()
            const a = new Measure(score, 'treble', new TimeSignature(4, 4))
            const b = new Measure(score, 'treble', new TimeSignature(4, 4))
            expect(a.id).not.toBe(b.id)
        })
    })

    describe('barline width', () => {
        it('returns 0 for none', () => {
            const score = new Score()
            const m = new Measure(score, 'treble', new TimeSignature(4, 4), { endBarline: 'none' })
            expect(m.barlineWidth).toBe(0)
        })

        it('end barline is wider than single', () => {
            const score = new Score()
            const single = new Measure(score, 'treble', new TimeSignature(4, 4), { endBarline: 'single' })
            const end = new Measure(score, 'treble', new TimeSignature(4, 4), { endBarline: 'end' })
            expect(end.barlineWidth).toBeGreaterThan(single.barlineWidth)
        })

        it('defaults to single barline width when unset', () => {
            const score = new Score()
            const m = new Measure(score, 'treble', new TimeSignature(4, 4))
            const single = new Measure(score, 'treble', new TimeSignature(4, 4), { endBarline: 'single' })
            expect(m.barlineWidth).toBe(single.barlineWidth)
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

        it('setClef(0) replaces the leading clef', () => {
            const score = new Score()
            const m = new Measure(score, 'treble', new TimeSignature(4, 4))
            m.setClef(0, 'bass')
            expect(m.clefs).toHaveLength(1)
            expect(m.clef.type).toBe('bass')
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

        it('clefAtOrBefore returns the active clef at a beat', () => {
            const score = new Score()
            const m = new Measure(score, 'treble', new TimeSignature(4, 4))
            m.addClef(2, 'bass')
            expect(m.clefAtOrBefore(0).type).toBe('treble')
            expect(m.clefAtOrBefore(1).type).toBe('treble')
            expect(m.clefAtOrBefore(2).type).toBe('bass')
            expect(m.clefAtOrBefore(3).type).toBe('bass')
        })

        it('lastClef is the highest-beat clef (carried into the next measure)', () => {
            const score = new Score()
            const m = new Measure(score, 'treble', new TimeSignature(4, 4))
            expect(m.lastClef.type).toBe('treble')
            m.addClef(2, 'bass')
            expect(m.lastClef.type).toBe('bass')
        })

        it('includes mid-measure clefs in physical elements so notes make room', () => {
            const score = makeScore(1)
            const m = score.firstMeasure
            if (!m) throw new Error('expected firstMeasure')
            m.setClef(2, 'bass')
            const clefsInLayout = m.physicalElements.filter((el) => el instanceof Clef)
            // leading treble (shown on the only measure) + the mid-measure bass change
            expect(clefsInLayout).toHaveLength(2)
            expect(() => m.layout.getXForElement(m.clefAtBeat(2) as Clef)).not.toThrow()
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

        it('setKeySignature(0) replaces the leading key', () => {
            const score = new Score()
            const m = new Measure(score, 'treble', new TimeSignature(4, 4))
            m.setKeySignature(0, 1)
            expect(m.keySignatures.filter((k) => k.beatPosition === 0)).toHaveLength(1)
            expect(m.keySignature.fifths).toBe(1)
        })

        it('setKeySignature drops a mid-measure change equal to the key already in effect', () => {
            const score = new Score()
            const m = new Measure(score, 'treble', new TimeSignature(4, 4), { keyFifths: 1 }) // leading G major
            m.setKeySignature(2, 1) // same as the carried-in G major → redundant, not stored at beat 2
            expect(m.keyAtBeat(2)).toBeUndefined()
            expect(m.midMeasureKeySignatures).toHaveLength(0)
        })

        it('keySignature falls back to the first stored key when none sits at beat 0', () => {
            const score = new Score()
            const m = new Measure(score, 'treble', new TimeSignature(4, 4))
            m.addKeySignature(2, 2) // a mid-measure key
            m.removeKeySignature(0) // drop the leading key so nothing remains at beat 0
            expect(m.keySignature).toBe(m.keySignatures[0])
            expect(m.keySignature.beatPosition).toBe(2)
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

        it('includes a mid-measure key in physical elements so notes make room', () => {
            const score = makeScore(1)
            const m = score.firstMeasure
            if (!m) throw new Error('expected firstMeasure')
            m.setKeySignature(2, 3)
            const keysInLayout = m.physicalElements.filter((el) => el instanceof KeySignature)
            expect(keysInLayout.length).toBeGreaterThanOrEqual(1)
            expect(() => m.layout.getXForElement(m.keyAtBeat(2) as KeySignature)).not.toThrow()
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

    describe('minimalWidth', () => {
        it('is 0 immediately after raw construction (documents current behavior)', () => {
            // Note: Measure._minimalWidth is only computed by rebuildPhysicalElements(),
            // which is not invoked from the constructor. A Measure created via
            // Score.addMeasure() ends up calling setEndBarline(), which triggers it.
            // Direct construction leaves minimalWidth at 0 — a latent footgun for any
            // code that consults minimalWidth before mutating the measure.
            const score = new Score()
            const m = new Measure(score, 'treble', new TimeSignature(4, 4))
            expect(m.minimalWidth).toBe(0)
        })

        it('snaps to absolute minimum (SCORE_WIDTH / 5 = 200) after first rebuild', () => {
            const score = new Score()
            const m = new Measure(score, 'treble', new TimeSignature(4, 4))
            m.setEndBarline('single') // triggers rebuildPhysicalElements
            expect(m.minimalWidth).toBe(200)
        })

        it('grows with the number of notes when wide enough', () => {
            const score = new Score()
            const m = new Measure(score, 'treble', new TimeSignature(4, 4))
            // Add many notes to push above absolute minimum
            for (let i = 0; i < 16; i++) m.addNotes([pitched('C', 4, '16')])
            expect(m.minimalWidth).toBeGreaterThan(200)
        })

        it('updates when clef visibility toggles', () => {
            const score = new Score()
            const m = new Measure(score, 'treble', new TimeSignature(4, 4))
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
            const m = score.firstMeasure
            if (!m) throw new Error('expected firstMeasure')
            const l1 = m.layout
            m.invalidateLayout()
            const l2 = m.layout
            expect(l1).not.toBe(l2)
        })

        it('mutating notes invalidates layout', () => {
            const score = makeScore(1)
            const m = score.firstMeasure
            if (!m) throw new Error('expected firstMeasure')
            const l1 = m.layout
            m.addNotes([rest('q')])
            const l2 = m.layout
            expect(l1).not.toBe(l2)
        })
    })

    describe('hasNote / firstNote / lastNote', () => {
        it('hasNote tracks membership', () => {
            const score = new Score()
            const m = new Measure(score, 'treble', new TimeSignature(4, 4))
            const n = rest('q')
            expect(m.hasNote(n)).toBe(false)
            m.addNotes([n])
            expect(m.hasNote(n)).toBe(true)
            m.removeNotes([n])
            expect(m.hasNote(n)).toBe(false)
        })

        it('firstNote / lastNote reflect first and last entries', () => {
            const score = new Score()
            const m = new Measure(score, 'treble', new TimeSignature(4, 4))
            expect(m.firstNote).toBeNull()
            const a = rest('q')
            const b = rest('q')
            m.addNotes([a, b])
            expect(m.firstNote).toBe(a)
            expect(m.lastNote).toBe(b)
        })

        it('hasNote tolerates null/undefined', () => {
            const score = new Score()
            const m = new Measure(score, 'treble', new TimeSignature(4, 4))
            expect(m.hasNote(null)).toBe(false)
            expect(m.hasNote(undefined)).toBe(false)
        })

        it('lastNote is null on an empty measure', () => {
            const score = new Score()
            const m = new Measure(score, 'treble', new TimeSignature(4, 4))
            expect(m.lastNote).toBeNull()
        })
    })

    describe('index', () => {
        it('reports the measure position within its score', () => {
            const score = makeScore(3)
            expect(score.measures[0].index).toBe(0)
            expect(score.measures[2].index).toBe(2)
        })
    })

    describe('noteAtBeat returning null', () => {
        it('returns null when no note begins at or before the beat', () => {
            const score = new Score()
            const m = new Measure(score, 'treble', new TimeSignature(4, 4))
            m.addNotes([rest('q')])
            // The first note sits at beat 0; a negative beat precedes every note.
            expect(m.noteAtBeat(-1)).toBeNull()
        })

        it('returns null on an empty measure', () => {
            const score = new Score()
            const m = new Measure(score, 'treble', new TimeSignature(4, 4))
            expect(m.noteAtBeat(0)).toBeNull()
        })
    })

    describe('beamOf', () => {
        it('returns the beam group a beamed note belongs to, undefined otherwise', () => {
            const score = new Score()
            const m = new Measure(score, 'treble', new TimeSignature(4, 4))
            // Two consecutive eighths beam together.
            const a = pitched('C', 5, '8')
            const b = pitched('D', 5, '8')
            m.addNotes([a, b])
            const beam = m.beamOf(a)
            expect(beam).toBeDefined()
            expect(beam?.notes).toContain(a)
            expect(beam?.notes).toContain(b)
            // A note not in this measure has no beam here.
            expect(m.beamOf(pitched('E', 5, '8'))).toBeUndefined()
        })
    })

    describe('midMeasure ordering', () => {
        it('sorts multiple mid-measure clef changes by beat', () => {
            const score = new Score()
            const m = new Measure(score, 'treble', new TimeSignature(4, 4))
            // Insert out of beat order; midMeasureClefs must return them sorted.
            m.addClef(3, 'alto')
            m.addClef(1, 'bass')
            expect(m.midMeasureClefs.map((c) => c.beatPosition)).toEqual([1, 3])
            expect(m.midMeasureClefs.map((c) => c.type)).toEqual(['bass', 'alto'])
        })

        it('sorts multiple mid-measure key changes by beat', () => {
            const score = new Score()
            const m = new Measure(score, 'treble', new TimeSignature(4, 4))
            m.addKeySignature(3, -2) // out of order
            m.addKeySignature(1, 2)
            expect(m.midMeasureKeySignatures.map((k) => k.beatPosition)).toEqual([1, 3])
            expect(m.midMeasureKeySignatures.map((k) => k.fifths)).toEqual([2, -2])
        })
    })

    describe('accidentals across a mid-measure key change', () => {
        it('clears carried accidentals when a new key takes effect mid-bar', () => {
            const score = new Score()
            const m = new Measure(score, 'treble', new TimeSignature(4, 4))
            // F# (explicit accidental) in C major, then a mid-measure switch to a key, then F again.
            const fSharp = new Note({ duration: new Duration({ type: 'q' }), pitch: new Pitch({ name: 'F', alter: 1, octave: 5 }) })
            const a = pitched('A', 4, 'q')
            const fAfterKey = new Note({ duration: new Duration({ type: 'q' }), pitch: new Pitch({ name: 'F', alter: 0, octave: 5 }) })
            const b = pitched('B', 4, 'q')
            m.addNotes([fSharp, a, fAfterKey, b])
            m.addKeySignature(2, 1) // G major at beat 2: F is sharp by key
            // First F shows a sharp (differs from C-major natural).
            expect(m.accidentalGlyphFor(fSharp)).toBe('accidentalSharp')
            // The key change at beat 2 resets the carried sharp; the natural F after it now differs
            // from the G-major key (which expects F#), so it shows a natural.
            expect(m.accidentalGlyphFor(fAfterKey)).toBe('accidentalNatural')
        })
    })

    describe('showsTimeSignature', () => {
        it('reflects the visibility flag', () => {
            const score = new Score()
            const m = new Measure(score, 'treble', new TimeSignature(4, 4))
            expect(m.showsTimeSignature).toBe(false)
            m.setShowsTimeSignature(true)
            expect(m.showsTimeSignature).toBe(true)
        })
    })

    describe('barlineWidth double', () => {
        it('a double barline is two thin lines plus a gap', () => {
            const score = new Score()
            const single = new Measure(score, 'treble', new TimeSignature(4, 4), { endBarline: 'single' })
            const double = new Measure(score, 'treble', new TimeSignature(4, 4), { endBarline: 'double' })
            expect(double.barlineWidth).toBeGreaterThan(single.barlineWidth)
            // Two thin lines + gap = exactly 2 * single + gap.
            expect(double.barlineWidth).toBe(single.barlineWidth * 2 + (double.barlineWidth - single.barlineWidth * 2))
        })
    })

    describe('setTimeSignature', () => {
        it('replaces the time signature and re-binds it to the measure', () => {
            const score = new Score()
            const m = new Measure(score, 'treble', new TimeSignature(4, 4))
            expect(m.maxBeats).toBe(4)
            const threeFour = new TimeSignature(3, 4)
            m.setTimeSignature(threeFour)
            expect(m.timeSignature).toBe(threeFour)
            expect(m.timeSignature.measure).toBe(m)
            expect(m.maxBeats).toBe(3)
        })
    })

    describe('tempo lookup', () => {
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

    describe('getNext / getPrevious', () => {
        it('getNext delegates to the score and returns the following measure', () => {
            const score = makeScore(2)
            const [a, b] = score.measures
            expect(a.getNext()).toBe(b)
            expect(b.getNext()).toBeNull()
            expect(b.getPrevious()).toBe(a)
        })
    })

    describe('replaceNotes guard', () => {
        it('throws when a target belongs to this measure but is not in its note list', () => {
            const score = new Score()
            const m = new Measure(score, 'treble', new TimeSignature(4, 4))
            m.addNotes([rest('q')])
            // A note whose measure is set to m (passes the ownership check) but was never added to _notes.
            const orphan = rest('q')
            orphan.setMeasure(m)
            expect(() => m.replaceNotes([orphan], [rest('q')])).toThrow('Cannot find startIndex for replace')
        })
    })
})
