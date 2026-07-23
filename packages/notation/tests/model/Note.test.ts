import { Duration } from '@mushee/notation/model/Duration'
import { Note } from '@mushee/notation/model/Note'
import { Pitch } from '@mushee/notation/model/Pitch'
import { Score } from '@mushee/notation/model/Score'
import { clef, pitched, rest } from '@mushee/notation/testing'
import { describe, expect, it } from 'vitest'

/** Replace a measure's leading rest with a pitched note and return the live note that lands at beat 0. */
function placeNote(score: Score, measureIndex: number, name: string, octave: number): Note {
    const measure = score.measures[measureIndex]
    const target = measure.firstNote as Note
    const [placed] = score.replace([target], [pitched(name, octave)])
    return placed
}

describe('Note', () => {
    it('has a unique id', () => {
        const a = new Note({ duration: new Duration() })
        const b = new Note({ duration: new Duration() })
        expect(a.id).not.toBe(b.id)
    })

    it('isRest is true when no pitch is provided', () => {
        const rest = new Note({ duration: new Duration() })
        expect(rest.isRest).toBe(true)
    })

    it('isRest is false when pitch is provided', () => {
        const n = new Note({ duration: new Duration(), pitch: new Pitch({ name: 'C', octave: 4 }) })
        expect(n.isRest).toBe(false)
    })

    it('inTuplet is true when ratio.actualNotes !== 1', () => {
        const tuplet = new Note({ duration: new Duration({ ratio: { actualNotes: 3, normalNotes: 2 } }) })
        const plain = new Note({ duration: new Duration() })
        expect(tuplet.inTuplet).toBe(true)
        expect(plain.inTuplet).toBe(false)
    })

    it('tiesForward / tiesBack reflect tie type', () => {
        expect(new Note({ duration: new Duration(), tie: 'start' }).tiesForward).toBe(true)
        expect(new Note({ duration: new Duration(), tie: 'start' }).tiesBack).toBe(false)
        expect(new Note({ duration: new Duration(), tie: 'stop' }).tiesForward).toBe(false)
        expect(new Note({ duration: new Duration(), tie: 'stop' }).tiesBack).toBe(true)
        expect(new Note({ duration: new Duration(), tie: 'start-stop' }).tiesForward).toBe(true)
        expect(new Note({ duration: new Duration(), tie: 'start-stop' }).tiesBack).toBe(true)
        expect(new Note({ duration: new Duration() }).tiesForward).toBe(false)
        expect(new Note({ duration: new Duration() }).tiesBack).toBe(false)
    })

    describe('stemDir', () => {
        it('rests stem up (default)', () => {
            const r = new Note({ duration: new Duration() })
            expect(r.stemDir).toBe('up')
        })

        it('high notes (line >= 3) stem down', () => {
            // B4 sits on line 3 → stem down
            const high = new Note({ duration: new Duration(), pitch: new Pitch({ name: 'B', octave: 4 }) })
            expect(high.stemDir).toBe('down')
        })

        it('low notes (line < 3) stem up', () => {
            const low = new Note({ duration: new Duration(), pitch: new Pitch({ name: 'C', octave: 4 }) })
            expect(low.stemDir).toBe('up')
        })
    })

    it('measure getter throws when measure is unset', () => {
        const n = new Note({ duration: new Duration() })
        expect(() => n.measure).toThrow('Note is not assigned to measure')
    })

    it('clone overrides duration/pitch/tie selectively', () => {
        const original = new Note({ duration: new Duration({ type: 'q' }), pitch: new Pitch({ name: 'C', octave: 4 }), tie: 'start' })
        const cloned = original.clone({ duration: new Duration({ type: 'h' }) })
        expect(cloned.duration.type).toBe('h')
        expect(cloned.pitch).toBe(original.pitch)
        expect(cloned.tie).toBe('start')
        expect(cloned).not.toBe(original)
    })

    it('clone with explicit undefined pitch removes pitch', () => {
        const original = new Note({ duration: new Duration(), pitch: new Pitch({ name: 'C', octave: 4 }) })
        const cloned = original.clone({ pitch: undefined })
        expect(cloned.pitch).toBeUndefined()
    })

    it('clone with an explicit tie override replaces the tie', () => {
        const original = new Note({ duration: new Duration(), pitch: new Pitch({ name: 'C', octave: 4 }), tie: 'start' })
        expect(original.clone({ tie: 'stop' }).tie).toBe('stop')
        // Explicit undefined clears the tie (the 'tie' in overrides branch, value undefined).
        expect(original.clone({ tie: undefined }).tie).toBeUndefined()
    })

    it('clone with no overrides keeps duration, pitch and tie', () => {
        const original = new Note({ duration: new Duration({ type: 'h' }), pitch: new Pitch({ name: 'C', octave: 4 }), tie: 'start' })
        const cloned = original.clone({})
        expect(cloned.duration).toBe(original.duration)
        expect(cloned.pitch).toBe(original.pitch)
        expect(cloned.tie).toBe('start')
        expect(cloned).not.toBe(original)
    })

    describe('layout', () => {
        it('a detached note caches a standalone layout snapshot', () => {
            const n = new Note({ duration: new Duration(), pitch: new Pitch({ name: 'C', octave: 4 }) })
            expect(n.layout).toBe(n.layout)
        })

        it('a detached rest lays out without a pitch (rest glyph, no accidental)', () => {
            const r = rest('w')
            expect(r.layout.glyphName).toBe(r.duration.restGlyph)
            expect(r.layout.accidental).toBeUndefined()
        })

        it('an attached note delegates into the score layout and stays stable without mutation', () => {
            const score = new Score()
            score.addMeasure().complete()
            const note = score.measures[0].firstNote as Note
            expect(note.layout).toBe(note.layout)
        })

        it('an attached note gets a new layout after its measure changes', () => {
            const score = new Score()
            score.addMeasure().complete()
            const m = score.measures[0]
            const note = m.firstNote as Note
            const before = note.layout
            m.setTempo(0, 120) // any content change rebuilds the measure layout
            expect(note.layout).not.toBe(before)
            expect(note.layout.id).not.toBe(before.id)
        })
    })

    describe('measure-resolved properties', () => {
        it('the sounding tempo comes from score.bpmAt', () => {
            const score = new Score()
            score.addMeasure().complete()
            const note = score.measures[0].firstNote as Note
            expect(score.bpmAt(note)).toBe(Score.DEFAULT_BPM)
            score.setTempo(note, 132)
            expect(score.bpmAt(note)).toBe(132)
        })

        it('clef resolves the active clef at the note position', () => {
            const score = new Score()
            score.addMeasure().complete()
            const note = score.measures[0].firstNote as Note
            expect(note.clef.type).toBe('treble')
            score.setClef(note, 'bass')
            expect(note.clef.type).toBe('bass')
        })

        it('keySignature resolves the active key at the note position', () => {
            const score = new Score()
            score.addMeasure().complete()
            const note = score.measures[0].firstNote as Note
            expect(note.keySignature.fifths).toBe(0)
            score.setKeySignature(note, 2)
            expect(note.keySignature.fifths).toBe(2)
        })

        it('line uses the active clef for a measure-attached pitched note', () => {
            const score = new Score()
            score.addMeasure().complete()
            const note = placeNote(score, 0, 'C', 4)
            // Treble: C4 is on the formula line 0; the clef offset is 0.
            expect(note.line).toBe(note.clef.lineFor(note.pitch as Pitch))
            score.setClef(note, 'bass')
            // Under bass clef the same pitch sits at a different staff line.
            expect(note.line).toBe(note.clef.lineFor(note.pitch as Pitch))
            expect(note.line).not.toBe((note.pitch as Pitch).line)
        })

        it('line falls back to the pitch line for a detached pitched note', () => {
            const detached = pitched('C', 4)
            expect(detached.line).toBe((detached.pitch as Pitch).line)
        })

        it('line of a rest uses the duration rest line, not a clef', () => {
            const r = rest('w')
            expect(r.line).toBe(r.duration.restLine)
        })

        it('the drawn accidental is measure-aware for an attached note', () => {
            const score = new Score()
            score.addMeasure().complete()
            const measure = score.measures[0]
            const target = measure.firstNote as Note
            const [placed] = score.replace([target], [pitched('C', 4)])
            // C natural in C major draws no accidental.
            expect(placed.layout.accidental).toBeUndefined()
            const sharp = new Note({ duration: new Duration(), pitch: new Pitch({ name: 'C', octave: 4, accidental: '#', alter: 1 }) })
            const [placedSharp] = score.replace([placed], [sharp])
            expect(placedSharp.layout.accidental?.glyphName).toBe('accidentalSharp')
        })

        it('the drawn accidental falls back to the pitch glyph for a detached note', () => {
            const detached = new Note({ duration: new Duration(), pitch: new Pitch({ name: 'C', octave: 4, accidental: 'b', alter: -1 }) })
            expect(detached.layout.accidental?.glyphName).toBe('accidentalFlat')
        })
    })

    describe('previewUnder', () => {
        it('renders line and accidental under the supplied clef, bypassing measure resolution', () => {
            const note = new Note({ duration: new Duration(), pitch: new Pitch({ name: 'C', octave: 4, accidental: '#', alter: 1 }) })
            const bass = clef('bass')
            const returned = note.previewUnder(bass)
            expect(returned).toBe(note)
            expect(note.clef).toBe(bass)
            expect(note.line).toBe(bass.lineFor(note.pitch as Pitch))
            // Preview note has no measure, so the accidental comes from the pitch itself.
            expect(note.layout.accidental?.glyphName).toBe('accidentalSharp')
        })

        it('clears the cached detached layout so it re-renders under the preview clef', () => {
            const note = pitched('C', 4)
            const before = note.layout
            note.previewUnder(clef('bass'))
            const after = note.layout
            expect(after).not.toBe(before)
            expect(after.noteY).not.toBe(before.noteY) // the line really moved
        })
    })

    describe('navigation', () => {
        it('getNext returns the following note within the same measure', () => {
            const score = new Score()
            score.addMeasure().complete()
            const first = score.measures[0].firstNote as Note
            const second = first.getNext()
            expect(second).toBe(score.measures[0].notes[1])
        })

        it('getNext crosses into the next measures first note', () => {
            const score = new Score()
            score.addMeasure().complete()
            score.addMeasure().complete()
            const lastOfFirst = score.measures[0].lastNote as Note
            const next = lastOfFirst.getNext()
            expect(next).toBe(score.measures[1].firstNote)
        })

        it('getNext returns null at the very end of the score', () => {
            const score = new Score()
            score.addMeasure().complete()
            const last = score.measures[0].lastNote as Note
            expect(last.getNext()).toBeNull()
        })

        it('getPrevious returns the preceding note within the same measure', () => {
            const score = new Score()
            score.addMeasure().complete()
            const second = score.measures[0].notes[1]
            expect(second.getPrevious()).toBe(score.measures[0].firstNote)
        })

        it('getPrevious crosses into the previous measures last note', () => {
            const score = new Score()
            score.addMeasure().complete()
            score.addMeasure().complete()
            const firstOfSecond = score.measures[1].firstNote as Note
            expect(firstOfSecond.getPrevious()).toBe(score.measures[0].lastNote)
        })

        it('getPrevious returns null at the very start of the score', () => {
            const score = new Score()
            score.addMeasure().complete()
            const first = score.measures[0].firstNote as Note
            expect(first.getPrevious()).toBeNull()
        })
    })
})
