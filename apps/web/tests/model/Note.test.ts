import { describe, expect, it } from 'vitest'

import { Duration } from '@/model/Duration'
import { Note } from '@/model/Note'
import { Pitch } from '@/model/Pitch'

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

    it('beats matches duration.effectiveBeats', () => {
        const n = new Note({ duration: new Duration({ type: 'h' }) })
        expect(n.beats).toBe(2)
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

    it('lazily creates a single NoteWidth instance', () => {
        const n = new Note({ duration: new Duration() })
        expect(n.width).toBe(n.width)
    })

    it('invalidateLayout clears cached layout', () => {
        const n = new Note({ duration: new Duration(), pitch: new Pitch({ name: 'C', octave: 4 }) })
        const l1 = n.layout
        n.invalidateLayout()
        const l2 = n.layout
        expect(l1).not.toBe(l2)
    })
})
