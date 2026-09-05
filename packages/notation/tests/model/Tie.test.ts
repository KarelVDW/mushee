import { MAX_MEASURES_PER_ROW } from '@mushee/notation/components/constants'
import { Duration } from '@mushee/notation/model/Duration'
import { Note } from '@mushee/notation/model/Note'
import { Pitch } from '@mushee/notation/model/Pitch'
import { MidiExporter } from '@mushee/notation/model/util/MidiExporter'
import { MidiImporter } from '@mushee/notation/model/util/MidiImporter'
import { makeScore, pitched, rest } from '@mushee/notation/testing'
import { describe, expect, it } from 'vitest'

const tieStartNote = () => new Note({ duration: new Duration({ type: 'q' }), pitch: new Pitch({ name: 'C', octave: 5 }), tie: 'start' })

describe('tie semantics (Score.tiePartner)', () => {
    it('pairs a tie-starting note with the next note in the same measure', () => {
        const score = makeScore(1)
        const m = score.measures[0]
        const first = m.firstNote
        if (!first) throw new Error('expected firstNote')
        const [start] = score.replace([first, m.notes[1]], [tieStartNote(), pitched('C', 5)])
        expect(score.tiePartner(start)).toBe(m.notes[1])
    })

    it('returns null for a note that does not tie forward', () => {
        const score = makeScore(1)
        const m = score.measures[0]
        const first = m.firstNote
        if (!first) throw new Error('expected firstNote')
        const [plain] = score.replace([first], [pitched('C', 5)])
        expect(score.tiePartner(plain)).toBeNull()
        // A tie-stop-only note does not tie forward either.
        const second = m.notes[1]
        const [stop] = score.replace(
            [second],
            [new Note({ duration: new Duration({ type: 'q' }), pitch: new Pitch({ name: 'C', octave: 5 }), tie: 'stop' })],
        )
        expect(score.tiePartner(stop)).toBeNull()
    })

    it('a start-stop note ties forward too', () => {
        const score = makeScore(1)
        const m = score.measures[0]
        const first = m.firstNote
        if (!first) throw new Error('expected firstNote')
        const [mid] = score.replace(
            [first, m.notes[1]],
            [
                new Note({ duration: new Duration({ type: 'q' }), pitch: new Pitch({ name: 'C', octave: 5 }), tie: 'start-stop' }),
                pitched('C', 5),
            ],
        )
        expect(score.tiePartner(mid)).toBe(m.notes[1])
    })

    it('pairs across a measure boundary', () => {
        const score = makeScore(2)
        const [m0, m1] = score.measures
        const last = m0.lastNote
        if (!last) throw new Error('expected last note')
        const [start] = score.replace([last, m1.notes[0]], [tieStartNote(), pitched('C', 5)])
        expect(score.tiePartner(start)).toBe(m1.firstNote)
    })

    it('pairs across a row boundary (the endpoints sit on different rows)', () => {
        const score = makeScore(MAX_MEASURES_PER_ROW + 1)
        const rowEndMeasure = score.measures[MAX_MEASURES_PER_ROW - 1]
        const nextRowMeasure = score.measures[MAX_MEASURES_PER_ROW]
        const lastNote = rowEndMeasure.lastNote
        if (!lastNote) throw new Error('expected last note of row-ending measure')
        const [start] = score.replace([lastNote, nextRowMeasure.notes[0]], [tieStartNote(), pitched('C', 5)])
        // Sanity: the endpoints really are on different rows.
        expect(score.layout.rowFor(rowEndMeasure)).not.toBe(score.layout.rowFor(nextRowMeasure))
        expect(score.tiePartner(start)).toBe(nextRowMeasure.firstNote)
    })

    it('a tie-forward note at the very end of the score has no partner', () => {
        const score = makeScore(1)
        const m = score.measures[0]
        const lastNote = m.lastNote
        if (!lastNote) throw new Error('expected last note')
        const [start] = score.replace([lastNote], [tieStartNote()])
        expect(score.tiePartner(start)).toBeNull()
    })

    it('removing the last measure breaks a tie into it', () => {
        const score = makeScore(2)
        const m0 = score.measures[0]
        const last = m0.lastNote
        if (!last) throw new Error('expected last note')
        const [start] = score.replace([last, score.measures[1].notes[0]], [tieStartNote(), pitched('C', 5)])
        expect(score.tiePartner(start)).not.toBeNull()
        score.removeLastMeasure()
        // The sustained-into note is gone; the pairing recomputes to null.
        expect(score.tiePartner(start)).toBeNull()
    })

    it('replacing a tie-starting note clears the pairing', () => {
        const score = makeScore(1)
        const m = score.measures[0]
        const first = m.firstNote
        if (!first) throw new Error('expected firstNote')
        const [start] = score.replace([first, m.notes[1]], [tieStartNote(), pitched('C', 5)])
        expect(score.tiePartner(start)).toBe(m.notes[1])
        const [plain] = score.replace([start], [pitched('D', 5)])
        expect(score.tiePartner(plain)).toBeNull()
    })

    it('pairings are stable between reads without a mutation', () => {
        const score = makeScore(2)
        const last = score.measures[0].lastNote
        if (!last) throw new Error('expected last note')
        const [start] = score.replace([last], [tieStartNote()])
        const partner = score.tiePartner(start)
        expect(score.tiePartner(start)).toBe(partner) // derived map cached per version
    })
})

describe('a tie binds only notes that sound the same', () => {
    function twoNotes(first: Note, second: Note) {
        const score = makeScore(1)
        const [a, b] = score.replace(score.measures[0].notes.slice(0, 2), [first, second])
        return { score, a, b }
    }

    it('C♯ ties into D♭ (same sounding pitch, different spelling)', () => {
        const { score, a, b } = twoNotes(
            new Note({
                duration: new Duration({ type: 'q' }),
                pitch: new Pitch({ name: 'C', alter: 1, accidental: '#', octave: 5 }),
                tie: 'start',
            }),
            new Note({ duration: new Duration({ type: 'q' }), pitch: new Pitch({ name: 'D', alter: -1, accidental: 'b', octave: 5 }) }),
        )
        expect(score.tiePartner(a)).toBe(b)
        expect(b.tiesBack).toBe(true)
        expect(score.layout.ties).toHaveLength(1)
    })

    it('a tie facing another pitch or a rest is a dangling mark: not a partner, not drawn, the next note attacks', () => {
        const other = twoNotes(pitched('C', 5).clone({ tie: 'start' }), pitched('D', 5))
        expect(other.score.tiePartner(other.a)).toBeNull()
        expect(other.b.tiesBack).toBe(false)
        expect(other.score.layout.ties).toHaveLength(0)

        const intoRest = twoNotes(pitched('C', 5).clone({ tie: 'start' }), rest('q'))
        expect(intoRest.score.tiePartner(intoRest.a)).toBeNull()
        expect(intoRest.b.tiesBack).toBe(false)
        expect(intoRest.score.layout.ties).toHaveLength(0)
        // The mark stays on the note, so it binds again once the neighbour sounds the same pitch.
        intoRest.score.replace([intoRest.b], [pitched('C', 5)])
        expect(intoRest.score.tiePartner(intoRest.a)?.pitch?.name).toBe('C')
    })

    it('an imported explicit stop without a tying predecessor is an attack', () => {
        const { b } = twoNotes(pitched('C', 5), pitched('C', 5).clone({ tie: 'stop' }))
        expect(b.tiesBack).toBe(false)
    })

    it('MIDI export does not hold a note through a rest it is mis-tied into', () => {
        const { score } = twoNotes(pitched('C', 5).clone({ tie: 'start' }), rest('q'))
        const imported = new MidiImporter(new MidiExporter(score).toBytes()).toScore().score
        const first = imported.measures[0].notes[0]
        expect(first.pitch?.name).toBe('C')
        expect(first.duration.effectiveBeats).toBe(1) // a quarter, not a half
        expect(imported.measures[0].notes[1].isRest).toBe(true)
    })
})
