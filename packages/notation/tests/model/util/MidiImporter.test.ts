import { Instrument } from '@mushee/notation/model/Instrument'
import type { Note } from '@mushee/notation/model/Note'
import type { Score } from '@mushee/notation/model/Score'
import { MidiImporter } from '@mushee/notation/model/util/MidiImporter'
import { describe, expect, it } from 'vitest'

// --- Standard MIDI File byte builders ---

const DIVISION = 480 // ticks per quarter
const Q = DIVISION
const E = DIVISION / 2

function vlq(value: number): number[] {
    const bytes = [value & 0x7f]
    let rest = Math.floor(value / 128)
    while (rest > 0) {
        bytes.unshift((rest & 0x7f) | 0x80)
        rest = Math.floor(rest / 128)
    }
    return bytes
}
const str = (s: string) => Array.from(s, (c) => c.charCodeAt(0))
const u16 = (n: number) => [(n >> 8) & 0xff, n & 0xff]
const u32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]
const chunk = (id: string, body: number[]) => [...str(id), ...u32(body.length), ...body]

const event = (delta: number, ...bytes: number[]) => [...vlq(delta), ...bytes]
const meta = (delta: number, type: number, data: number[]) => event(delta, 0xff, type, ...vlq(data.length), ...data)
const on = (delta: number, note: number, velocity = 80, channel = 0) => event(delta, 0x90 | channel, note, velocity)
const off = (delta: number, note: number, channel = 0) => event(delta, 0x80 | channel, note, 0)
const tempo = (delta: number, bpm: number) => {
    const micros = Math.round(60_000_000 / bpm)
    return meta(delta, 0x51, [(micros >> 16) & 0xff, (micros >> 8) & 0xff, micros & 0xff])
}
const timeSignature = (delta: number, numerator: number, denominatorPower: number) =>
    meta(delta, 0x58, [numerator, denominatorPower, 24, 8])
const keySignature = (delta: number, fifths: number, minor = false) => meta(delta, 0x59, [fifths & 0xff, minor ? 1 : 0])
const trackName = (delta: number, name: string) => meta(delta, 0x03, str(name))
const END = meta(0, 0x2f, [])

const track = (...events: number[][]) => chunk('MTrk', events.flat())
/** A complete file: header (format 1 unless given) followed by the given track chunks. */
const file = (tracks: number[][], { division = DIVISION, format = 1, headerExtra = [] as number[] } = {}) =>
    new Uint8Array([...chunk('MThd', [...u16(format), ...u16(tracks.length), ...u16(division), ...headerExtra]), ...tracks.flat()])

/** A quarter-note melody in one track: each entry is a MIDI number (or null for a beat of silence). */
function melody(notes: Array<number | null>, ...prelude: number[][]): number[] {
    const events: number[][] = [...prelude]
    let pendingDelta = 0
    for (const note of notes) {
        if (note === null) {
            pendingDelta += Q
            continue
        }
        events.push(on(pendingDelta, note), off(Q, note))
        pendingDelta = 0
    }
    return track(...events, END)
}

function describeNotes(notes: readonly Note[]): string[] {
    return notes.map((n) => {
        const value = `${n.duration.type}${'.'.repeat(n.duration.dots)}`
        const pitch = n.pitch ? `${n.pitch.name}${n.pitch.accidental ?? ''}${n.pitch.octave}` : 'r'
        return `${pitch}:${value}${n.tie ? `~${n.tie}` : ''}`
    })
}

const bars = (score: Score) => score.measures.map((m) => describeNotes(m.notes))
const load = (bytes: Uint8Array) => new MidiImporter(bytes).toScore()

describe('MidiImporter', () => {
    describe('a simple file', () => {
        it('reads notes, rests, tempo, time signature and the track name', () => {
            const bytes = file([melody([60, 62, null, 64, 65], trackName(0, 'Riff'), tempo(0, 100), timeSignature(0, 4, 2))])
            const { score, title, warnings } = load(bytes)

            expect(title).toBe('Riff')
            expect(warnings).toEqual([])
            expect(score.instrument).toBe(Instrument.Piano)
            expect(score.measures[0].timeSignature.beatAmount).toBe(4)
            expect(score.measures[0].tempoAtBeat(0)?.bpm).toBe(100)
            expect(bars(score)).toEqual([
                ['C4:q', 'D4:q', 'r:q', 'E4:q'],
                ['F4:q', 'r:q', 'r:h'],
            ])
            expect(score.measures.map((m) => m.endBarline)).toEqual(['single', 'end'])
        })

        it('assumes 4/4 and MIDI’s 120 bpm when the file says nothing, and has no title without a name', () => {
            const { score, title } = load(file([melody([60])]))
            expect(title).toBeUndefined()
            expect(score.measures).toHaveLength(1)
            expect(score.measures[0].timeSignature.maxBeats).toBe(4)
            expect(score.measures[0].tempoAtBeat(0)?.bpm).toBe(120)
        })

        it('spells held notes across barlines with ties, split at metrical boundaries', () => {
            // A note from beat 2 held for five beats: quarter + half to the barline, then a half.
            const bytes = file([track(timeSignature(0, 4, 2), on(Q, 67), off(5 * Q, 67), END)])
            expect(bars(load(bytes).score)).toEqual([
                ['r:q', 'G4:q~start', 'G4:h~start-stop'],
                ['G4:h~stop', 'r:h'],
            ])
        })
    })

    describe('reducing a performance to one voice', () => {
        it('keeps the top note of a chord and trims overlaps to the next onset', () => {
            const bytes = file([
                track(
                    on(0, 60),
                    on(0, 64),
                    on(0, 67), // C major chord — only the G survives
                    off(Q, 60),
                    off(0, 64),
                    off(0, 67),
                    on(0, 62),
                    on(Q, 65), // legato: the D is still sounding when the F starts
                    off(E, 62),
                    off(E, 65),
                    END,
                ),
            ])
            const { score, warnings } = load(bytes)
            expect(bars(score)).toEqual([['G4:q', 'D4:q', 'F4:q', 'r:q']])
            expect(warnings).toEqual(['Overlapping notes were reduced to a single melody line (the top note).'])
        })

        it('snaps timing to the sixteenth grid and never writes a note shorter than one', () => {
            const bytes = file([track(on(10, 60), off(Q - 5, 60), on(0, 62), off(1, 62), END)])
            const { score, warnings } = load(bytes)
            expect(bars(score)).toEqual([['C4:q', 'D4:16', 'r:16', 'r:8', 'r:h']])
            expect(warnings).toEqual(['Note timing was snapped to a sixteenth-note grid.'])
        })

        it('imports the busiest track, ignores percussion, and reports both', () => {
            const conductor = track(trackName(0, 'Song'), tempo(0, 90), timeSignature(0, 3, 2), END)
            const bass = track(trackName(0, 'Bass'), on(0, 36), off(4 * Q, 36), END)
            const lead = track(
                trackName(0, 'Lead'),
                event(0, 0xc0, 71),
                on(0, 60),
                off(Q, 60),
                on(0, 62),
                off(Q, 62),
                on(0, 64),
                off(Q, 64),
                END,
            )
            const drums = track(on(0, 36, 100, 9), off(Q, 36, 9), event(0, 0xc9, 0), END)
            const { score, title, warnings } = load(file([conductor, bass, lead, drums]))

            expect(title).toBe('Song')
            // Clarinet: the sounding C–D–E is written a major second higher.
            expect(score.instrument).toBe(Instrument.Clarinet)
            expect(bars(score)).toEqual([['D4:q', 'E4:q', 'F#4:q']])
            expect(score.measures[0].tempoAtBeat(0)?.bpm).toBe(90)
            expect(warnings).toEqual([
                'Only the busiest track (“Lead”) was imported; 1 other track with notes was left out.',
                'Percussion (channel 10) was left out.',
            ])
        })

        it('words the track warning for several tracks and for an unnamed track', () => {
            const notes = (count: number) => track(...Array.from({ length: count }, () => [on(0, 60), off(E, 60)]).flat(), END)
            const { warnings } = load(file([notes(1), notes(3), notes(1)]))
            expect(warnings[0]).toBe('Only the busiest track was imported; 2 other tracks with notes were left out.')
        })
    })

    describe('meter and key', () => {
        it('bars the music by the time-signature map, padding a change that lands mid-bar', () => {
            const bytes = file([
                track(
                    timeSignature(0, 4, 2),
                    timeSignature(0, 4, 2), // the same meter again: no new region
                    on(0, 60),
                    off(6 * Q, 60), // held across the meter change at beat 6
                    timeSignature(0, 3, 2),
                    timeSignature(0, 2, 2), // two changes at one instant: the later wins
                    on(0, 62),
                    off(Q, 62),
                    END,
                ),
            ])
            const { score } = load(bytes)
            expect(score.measures.map((m) => `${m.timeSignature.beatAmount}/${m.timeSignature.beatType}`)).toEqual(['4/4', '4/4', '2/4'])
            expect(bars(score)).toEqual([['C4:w~start'], ['C4:h~stop', 'r:h'], ['D4:q', 'r:q']])
        })

        it('lets the first time signature govern from the start even when it arrives late', () => {
            const bytes = file([track(on(0, 60), off(3 * Q, 60), timeSignature(0, 3, 2), on(0, 62), off(3 * Q, 62), END)])
            expect(bars(load(bytes).score)).toEqual([['C4:h.'], ['D4:h.']])
        })

        it('spells pitches by the key in force and marks key changes on their bar', () => {
            const bytes = file([
                track(
                    keySignature(0, 1), // G major: F♯ is diatonic, F is a natural, C♯ leans sharp
                    on(0, 66),
                    off(Q, 66),
                    on(0, 65),
                    off(Q, 65),
                    on(0, 61),
                    off(Q, 61),
                    on(0, 60),
                    off(Q, 60),
                    keySignature(0, 1), // repeated: not a change
                    keySignature(0, -1, true), // D minor (one flat) from bar 2: E♭ and A♭ lean flat
                    on(0, 63),
                    off(Q, 63),
                    on(0, 68),
                    off(Q, 68),
                    on(0, 70),
                    off(2 * Q, 70),
                    END,
                ),
            ])
            const { score } = load(bytes)
            expect(bars(score)).toEqual([
                ['F#4:q', 'F4:q', 'C#4:q', 'C4:q'],
                ['Eb4:q', 'Ab4:q', 'Bb4:h'],
            ])
            expect(score.measures[0].keySignature.fifths).toBe(1)
            expect(score.measures[1].keySignature.fifths).toBe(-1)
            expect(score.measures[1].keySignature.mode).toBe('minor')
        })

        it('anchors a key change inside a bar, or past the last bar, to the bar it falls in', () => {
            const bytes = file([track(on(0, 60), off(Q, 60), keySignature(0, 2), on(0, 62), off(Q, 62), keySignature(8 * Q, 3), END)])
            const { score } = load(bytes)
            expect(score.measures).toHaveLength(1)
            expect(score.measures[0].keySignature.fifths).toBe(3)
        })

        it('marks at most one tempo per bar and skips changes that repeat the sounding tempo', () => {
            const bytes = file([
                track(
                    tempo(0, 100),
                    on(0, 60),
                    off(Q, 60),
                    tempo(0, 140),
                    tempo(Q, 150),
                    on(2 * Q, 62),
                    off(Q, 62),
                    tempo(Q, 150),
                    on(0, 64),
                    off(Q, 64),
                    END,
                ),
            ])
            const { score } = load(bytes)
            expect(score.measures[0].tempos.map((t) => [t.beatPosition, t.bpm])).toEqual([[0, 100]])
            expect(score.measures[1].tempos.map((t) => [t.beatPosition, t.bpm])).toEqual([[2, 150]])
        })
    })

    describe('the byte format', () => {
        it('handles running status, system messages, unknown metas, restrikes and unterminated notes', () => {
            const bytes = file(
                [
                    track(
                        event(0, 0xf0, 2, 0x7e, 0xf7), // sysex with payload
                        event(0, 0xf8), // real-time clock: no data
                        event(0, 0xb0, 7, 100), // control change, two data bytes
                        event(0, 0xd0, 64), // channel pressure, one data byte
                        meta(0, 0x7f, [1, 2, 3]), // sequencer-specific: ignored
                        trackName(0, ''), // an empty name is no name
                        trackName(0, 'First'),
                        trackName(0, 'Second'), // only the first name counts
                        event(0, 0x90, 60, 80), // status byte…
                        event(Q, 60, 0), // …then running status: note-off as velocity 0
                        event(0, 62, 80),
                        event(Q, 62, 80), // restruck while sounding: closes the first D
                        event(Q, 64, 80),
                        event(0, 0xc0, 40), // program change (Violin, no transposition)
                        event(0, 0xc0, 56), // a second program change is ignored
                        off(0, 99), // a note-off with no matching note-on
                        // no end-of-track meta and the E is still sounding: it releases at the end
                    ),
                    chunk('XFIH', [1, 2, 3]), // a foreign chunk is skipped
                ],
                { format: 0, headerExtra: [0, 0] },
            )
            const { score, title } = load(bytes)
            expect(title).toBe('First')
            expect(score.instrument).toBe(Instrument.Violin)
            expect(bars(score)).toEqual([['C4:q', 'D4:q', 'D4:q', 'E4:16', 'r:16', 'r:8']])
        })

        it('ignores malformed tempo, meter and key metas and clamps pitches into the writable range', () => {
            const bytes = file([
                track(
                    meta(0, 0x51, [0, 0, 0]), // zero microseconds per quarter
                    meta(0, 0x51, [1]), // too short
                    meta(0, 0x58, [4, 7, 24, 8]), // 1/128 meter: out of range
                    meta(0, 0x58, [0, 2]), // zero beats
                    meta(0, 0x59, [8, 0]), // eight sharps
                    meta(0, 0x59, [1]), // too short
                    on(0, 5), // below the lowest writable octave
                    off(Q, 5),
                    END,
                ),
            ])
            const { score } = load(bytes)
            expect(score.measures[0].timeSignature.maxBeats).toBe(4)
            expect(score.measures[0].tempoAtBeat(0)?.bpm).toBe(120)
            expect(describeNotes(score.measures[0].notes)[0]).toBe('C0:q')
        })

        it('rejects files that are not MIDI, use SMPTE timing, or hold no tracks or notes', () => {
            expect(() => load(new Uint8Array(str('RIFF')))).toThrow('not a MIDI file')
            expect(() => load(new Uint8Array([...str('MThx'), ...u32(6), 0, 1, 0, 1, 1, 0xe0]))).toThrow('not a MIDI file')
            expect(() => load(file([melody([60])], { division: 0xe250 }))).toThrow('SMPTE')
            expect(() => load(file([melody([60])], { division: 0 }))).toThrow('SMPTE')
            expect(() => load(file([]))).toThrow('no tracks')
            expect(() => load(file([chunk('XFIH', [])]))).toThrow('no tracks')
            expect(() => load(file([track(trackName(0, 'Empty'), END)]))).toThrow('no notes')
        })

        it('rejects truncated and corrupt files', () => {
            const good = file([melody([60])])
            expect(() => load(good.subarray(0, good.length - 3))).toThrow('truncated or corrupt')
            // A declared chunk length that runs past the end of the file — for a track, and for a chunk that is skipped.
            expect(() => load(file([chunk('MTrk', [0, 0xff, 0x2f]).map((b, i) => (i === 7 ? 200 : b))]))).toThrow('truncated or corrupt')
            expect(() => load(file([chunk('XFIH', [1, 2, 3]).map((b, i) => (i === 7 ? 200 : b)), melody([60])]))).toThrow(
                'truncated or corrupt',
            )
            // A data byte before any status byte has been seen.
            expect(() => load(file([track(event(0, 60, 80), END)]))).toThrow('truncated or corrupt')
            // A variable-length quantity that never terminates.
            expect(() => load(file([track([0x80, 0x80, 0x80, 0x80, 0x80], END)]))).toThrow('truncated or corrupt')
            // A meta event whose declared length exceeds the file.
            expect(() => load(file([track([0, 0xff, 0x03, 0x7f, 65])]))).toThrow('truncated or corrupt')
        })

        it('refuses a file whose ticks would spin out more bars than a score may hold', () => {
            const farAway = 480 * 4 * 10_001
            expect(() => load(file([track(on(0, 60), off(farAway, 60), END)]))).toThrow('too long')
        })
    })
})
