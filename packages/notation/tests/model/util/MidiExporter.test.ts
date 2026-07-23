import { Duration } from '@mushee/notation/model/Duration'
import { Instrument } from '@mushee/notation/model/Instrument'
import { Note } from '@mushee/notation/model/Note'
import { Pitch } from '@mushee/notation/model/Pitch'
import { TimeSignature } from '@mushee/notation/model/TimeSignature'
import { MidiExporter } from '@mushee/notation/model/util/MidiExporter'
import { makeScore, pitched } from '@mushee/notation/testing'
import { describe, expect, it } from 'vitest'

/** Index of the first occurrence of `pattern` in `bytes`, or -1. */
function indexOf(bytes: Uint8Array, pattern: number[], from = 0): number {
    outer: for (let i = from; i <= bytes.length - pattern.length; i++) {
        for (let j = 0; j < pattern.length; j++) {
            if (bytes[i + j] !== pattern[j]) continue outer
        }
        return i
    }
    return -1
}

describe('MidiExporter', () => {
    it('writes a format-0 file with one track at 480 ticks per quarter', () => {
        const bytes = new MidiExporter(makeScore(1)).toBytes()

        // MThd, length 6, format 0, 1 track, division 480 (0x01e0)
        expect(Array.from(bytes.slice(0, 14))).toEqual([0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0x01, 0xe0])
        expect(Array.from(bytes.slice(14, 18))).toEqual([0x4d, 0x54, 0x72, 0x6b])
        // declared track length matches the actual payload
        const trackLength = (bytes[18] << 24) | (bytes[19] << 16) | (bytes[20] << 8) | bytes[21]
        expect(bytes.length).toBe(22 + trackLength)
        // ends with end-of-track
        expect(Array.from(bytes.slice(-3))).toEqual([0xff, 0x2f, 0x00])
    })

    it('emits program change, 4/4 time signature and the default 90 bpm tempo', () => {
        const bytes = new MidiExporter(makeScore(1)).toBytes()

        expect(indexOf(bytes, [0xc0, 0x00])).toBeGreaterThan(-1) // Piano program 0
        expect(indexOf(bytes, [0xff, 0x58, 0x04, 4, 2, 24, 8])).toBeGreaterThan(-1)
        // 60_000_000 / 90 ≈ 666667 = 0x0a2c2b
        expect(indexOf(bytes, [0xff, 0x51, 0x03, 0x0a, 0x2c, 0x2b])).toBeGreaterThan(-1)
    })

    it('uses an explicit opening tempo marking instead of the default', () => {
        const score = makeScore(1)
        score.setTempo(score.firstMeasure?.firstNote, 120)
        const bytes = new MidiExporter(score).toBytes()

        // 60_000_000 / 120 = 500000 = 0x07a120
        expect(indexOf(bytes, [0xff, 0x51, 0x03, 0x07, 0xa1, 0x20])).toBeGreaterThan(-1)
        expect(indexOf(bytes, [0xff, 0x51, 0x03, 0x0a, 0x2c, 0x2b])).toBe(-1)
    })

    it('writes a note-on/note-off pair spanning one quarter note', () => {
        const score = makeScore(1)
        const first = score.firstMeasure?.firstNote
        if (!first) throw new Error('expected first note')
        score.replace([first], [pitched('C', 4)])
        const bytes = new MidiExporter(score).toBytes()

        const on = indexOf(bytes, [0x90, 60, 80])
        expect(on).toBeGreaterThan(-1)
        // 480 ticks later (VLQ 0x83 0x60), the matching note-off
        expect(Array.from(bytes.slice(on + 3, on + 8))).toEqual([0x83, 0x60, 0x80, 60, 0])
    })

    it('sounds tied notes once, for their combined duration', () => {
        const score = makeScore(1)
        const measure = score.firstMeasure
        if (!measure) throw new Error('expected first measure')
        const quarter = (tie: 'start' | 'stop') => new Note({ duration: new Duration({ type: 'q' }), pitch: new Pitch({ name: 'C', octave: 4 }), tie })
        score.replace([measure.notes[0]], [quarter('start')])
        score.replace([measure.notes[1]], [quarter('stop')])
        const bytes = new MidiExporter(score).toBytes()

        const on = indexOf(bytes, [0x90, 60, 80])
        expect(on).toBeGreaterThan(-1)
        expect(indexOf(bytes, [0x90, 60, 80], on + 1)).toBe(-1) // no second attack
        // note-off 960 ticks after the attack (VLQ 0x87 0x40)
        expect(Array.from(bytes.slice(on + 3, on + 8))).toEqual([0x87, 0x40, 0x80, 60, 0])
    })

    it('transposes written pitch to sounding pitch', () => {
        const score = makeScore(1)
        score.setInstrument(Instrument.Trumpet)
        const first = score.firstMeasure?.firstNote
        if (!first) throw new Error('expected first note')
        score.replace([first], [pitched('C', 4)])
        const bytes = new MidiExporter(score).toBytes()

        expect(indexOf(bytes, [0x90, 58, 80])).toBeGreaterThan(-1) // written C4 sounds B♭3
        expect(indexOf(bytes, [0xc0, 56])).toBeGreaterThan(-1) // trumpet GM program
    })

    it('emits the time signature only once when consecutive measures share it', () => {
        const bytes = new MidiExporter(makeScore(2)).toBytes()

        // Both measures are 4/4, so the 4/4 meta appears exactly once (carried forward).
        const first = indexOf(bytes, [0xff, 0x58, 0x04, 4, 2, 24, 8])
        expect(first).toBeGreaterThan(-1)
        expect(indexOf(bytes, [0xff, 0x58, 0x04, 4, 2, 24, 8], first + 1)).toBe(-1)
    })

    it('re-emits the time signature when only the beat type changes', () => {
        const score = makeScore(2)
        // 4/4 -> 4/8: same beat amount (4), different beat type — exercises the second clause of the change test.
        score.measures[1].setTimeSignature(new TimeSignature(4, 8))
        const bytes = new MidiExporter(score).toBytes()

        expect(indexOf(bytes, [0xff, 0x58, 0x04, 4, 2, 24, 8])).toBeGreaterThan(-1) // 4/4 (log2(4)=2)
        expect(indexOf(bytes, [0xff, 0x58, 0x04, 4, 3, 24, 8])).toBeGreaterThan(-1) // 4/8 (log2(8)=3)
    })

    it('places a mid-measure tempo marking at its beat without treating it as the opening tempo', () => {
        const score = makeScore(1)
        const measure = score.firstMeasure
        if (!measure) throw new Error('expected first measure')
        const secondNote = measure.notes[1]
        score.setTempo(secondNote, 100)
        const bytes = new MidiExporter(score).toBytes()

        // The mid-measure marking (100 bpm = 600000 us = 0x0927c0) is present...
        expect(indexOf(bytes, [0xff, 0x51, 0x03, 0x09, 0x27, 0xc0])).toBeGreaterThan(-1)
        // ...and because no tempo sits at beat 0, the default 90 bpm opening tempo is still emitted.
        expect(indexOf(bytes, [0xff, 0x51, 0x03, 0x0a, 0x2c, 0x2b])).toBeGreaterThan(-1)
    })

    it('ends a tie chain gracefully when the tied note is the last in the score', () => {
        const score = makeScore(1)
        const measure = score.firstMeasure
        if (!measure) throw new Error('expected first measure')
        const last = measure.notes[measure.notes.length - 1]
        // A trailing tie-start with no following note: the chain walk hits getNext() === null and breaks.
        const tiedLast = new Note({ duration: last.duration, pitch: new Pitch({ name: 'C', octave: 4 }), tie: 'start' })
        score.replace([last], [tiedLast])
        const bytes = new MidiExporter(score).toBytes()

        const on = indexOf(bytes, [0x90, 60, 80])
        expect(on).toBeGreaterThan(-1)
        // Sounds for just its own quarter (480 ticks, VLQ 0x83 0x60) since the tie has nothing to extend into.
        expect(Array.from(bytes.slice(on + 3, on + 8))).toEqual([0x83, 0x60, 0x80, 60, 0])
    })
})
