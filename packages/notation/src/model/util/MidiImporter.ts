import type { TieType } from '../../components/types'
import { BEAT_EPSILON } from '../Duration'
import { Instrument } from '../Instrument'
import { KeySignature } from '../KeySignature'
import { Measure } from '../Measure'
import { Note } from '../Note'
import { Pitch } from '../Pitch'
import { Score } from '../Score'
import { TimeSignature } from '../TimeSignature'
import { DurationSpeller } from './DurationSpeller'
import type { ImportedScore } from './ImportedScore'

/** The finest written value: onsets and releases snap to this grid (in quarter-note beats). */
const GRID = 0.25
/** MIDI's assumed tempo when a file carries no tempo event. */
const MIDI_DEFAULT_BPM = 120
/** Matches the API's measure cap; also stops a corrupt tick value from spinning out an endless score. */
const MAX_MEASURES = 10_000
const DRUM_CHANNEL = 9
/** Lowest MIDI note the model can write (octave 0); higher than 127 cannot occur. */
const LOWEST_MIDI = 12

const CORRUPT = 'The MIDI file is truncated or corrupt.'
const WARN_TRACKS = (name: string | undefined, others: number) =>
    `Only the busiest track${name ? ` (“${name}”)` : ''} was imported; ${others} other ${others === 1 ? 'track' : 'tracks'} with notes ${others === 1 ? 'was' : 'were'} left out.`
const WARN_DRUMS = 'Percussion (channel 10) was left out.'
const WARN_QUANTIZED = 'Note timing was snapped to a sixteenth-note grid.'
const WARN_REDUCED = 'Overlapping notes were reduced to a single melody line (the top note).'

interface RawNote {
    onset: number // ticks
    end: number
    midi: number
}

interface Timed<T> {
    tick: number
    value: T
}

interface TrackData {
    name?: string
    program?: number
    notes: RawNote[]
    drumNotes: number
    tempos: Timed<number>[]
    timeSignatures: Timed<TimeSignature>[]
    keys: Timed<{ fifths: number; mode: string }>[]
}

interface MelodyNote {
    onset: number // quarter-note beats
    end: number
    midi: number
}

interface Region {
    start: number
    end: number
    timeSignature: TimeSignature
}

/** Big-endian cursor over the file's bytes; every read past the end is the same corruption error. */
class ByteReader {
    position = 0

    constructor(private readonly data: Uint8Array) {}

    get remaining(): number {
        return this.data.length - this.position
    }

    u8(): number {
        if (this.position >= this.data.length) throw new Error(CORRUPT)
        return this.data[this.position++]
    }

    u16(): number {
        return (this.u8() << 8) | this.u8()
    }

    u32(): number {
        return this.u16() * 0x10000 + this.u16()
    }

    /** Variable-length quantity: seven bits per byte, high bit set on all but the last (four bytes at most). */
    vlq(): number {
        let value = 0
        for (let i = 0; i < 4; i++) {
            const byte = this.u8()
            value = value * 128 + (byte & 0x7f)
            if (!(byte & 0x80)) return value
        }
        throw new Error(CORRUPT)
    }

    bytes(length: number): Uint8Array {
        if (length > this.remaining) throw new Error(CORRUPT)
        const slice = this.data.subarray(this.position, this.position + length)
        this.position += length
        return slice
    }

    ascii(length: number): string {
        return String.fromCharCode(...this.bytes(length))
    }

    seek(position: number) {
        if (position > this.data.length) throw new Error(CORRUPT)
        this.position = position
    }
}

/**
 * Reads a Standard MIDI File into a Score. MIDI carries performance, not notation,
 * so the importer decides the notation: it keeps the busiest track as a single
 * melody line (top note of anything that overlaps), snaps timing to the sixteenth
 * grid, bars the notes by the file's time-signature map, spells pitches by the
 * file's key signatures, and writes each span with the metrical speller, tying
 * across barlines. Tempo and key events become markings; the track's program
 * change picks the instrument, with written pitch derived from the sounding notes
 * through the instrument's transposition. Every reduction is reported as a warning.
 */
export class MidiImporter {
    private readonly warnings = new Set<string>()
    private division = 1

    constructor(readonly bytes: Uint8Array) {}

    toScore(): ImportedScore {
        const tracks = this.parse()
        const melodyTrack = tracks.reduce((best, track) => (track.notes.length > best.notes.length ? track : best))
        if (!melodyTrack.notes.length) throw new Error('The MIDI file contains no notes.')
        const otherTracks = tracks.filter((track) => track !== melodyTrack && track.notes.length > 0).length
        if (otherTracks) this.warn(WARN_TRACKS(melodyTrack.name, otherTracks))
        if (tracks.some((track) => track.drumNotes > 0)) this.warn(WARN_DRUMS)

        const byTick = <T>(a: Timed<T>, b: Timed<T>) => a.tick - b.tick
        const tempos = tracks.flatMap((track) => track.tempos).sort(byTick)
        const timeSignatures = tracks.flatMap((track) => track.timeSignatures).sort(byTick)
        const keys = tracks.flatMap((track) => track.keys).sort(byTick)

        const melody = this.melodyOf(melodyTrack.notes)
        const regions = this.regionsOf(timeSignatures, melody[melody.length - 1].end)

        const score = new Score()
        const measureStarts = this.bar(score, melody, regions, tempos, keys)
        this.markKeys(score, measureStarts, keys)
        if (!tempos.length) score.setTempo(score.firstMeasure?.firstNote, MIDI_DEFAULT_BPM)
        // Notes were written as sounding pitch; a transposing instrument rewrites them as its written pitch.
        score.setInstrument(Instrument.byGmProgram(melodyTrack.program ?? 0))

        return { score, title: tracks.find((track) => track.name)?.name, warnings: [...this.warnings] }
    }

    // --- File parsing ---

    private parse(): TrackData[] {
        const reader = new ByteReader(this.bytes)
        if (reader.remaining < 14 || reader.ascii(4) !== 'MThd') throw new Error('The file is not a MIDI file.')
        const headerLength = reader.u32()
        reader.u16() // format: 0 and 1 read the same way, and a format-2 file's patterns are just more tracks
        const trackCount = reader.u16()
        this.division = reader.u16()
        if (this.division === 0 || this.division & 0x8000) throw new Error('MIDI files with SMPTE timing are not supported.')
        reader.seek(reader.position + Math.max(0, headerLength - 6))

        const tracks: TrackData[] = []
        while (tracks.length < trackCount && reader.remaining >= 8) {
            const id = reader.ascii(4)
            const end = reader.position + 4 + reader.u32()
            if (id === 'MTrk') tracks.push(this.parseTrack(reader, end))
            reader.seek(end)
        }
        if (!tracks.length) throw new Error('The MIDI file contains no tracks.')
        return tracks
    }

    private parseTrack(reader: ByteReader, end: number): TrackData {
        const track: TrackData = { notes: [], drumNotes: 0, tempos: [], timeSignatures: [], keys: [] }
        const open = new Map<number, number>()
        let tick = 0
        let status = 0
        while (reader.position < end) {
            tick += reader.vlq()
            let byte = reader.u8()
            if (byte === 0xff) {
                const type = reader.u8()
                this.readMeta(track, tick, type, reader.bytes(reader.vlq()))
                if (type === 0x2f) break // end of track
                continue
            }
            if (byte >= 0xf0) {
                // System exclusive carries a length; system real-time bytes carry nothing.
                if (byte === 0xf0 || byte === 0xf7) reader.bytes(reader.vlq())
                continue
            }
            if (byte & 0x80) {
                status = byte
                byte = reader.u8()
            } else if (!status) throw new Error(CORRUPT) // a data byte with no running status to belong to

            const kind = status & 0xf0
            const channel = status & 0x0f
            const data2 = kind === 0xc0 || kind === 0xd0 ? 0 : reader.u8()
            const key = (channel << 8) | byte
            if (kind === 0x90 && data2 > 0) {
                if (channel === DRUM_CHANNEL) track.drumNotes++
                else {
                    const restruck = open.get(key)
                    if (restruck !== undefined) track.notes.push({ onset: restruck, end: tick, midi: byte })
                    open.set(key, tick)
                }
            } else if (kind === 0x80 || kind === 0x90) {
                const onset = open.get(key)
                if (onset !== undefined) {
                    open.delete(key)
                    track.notes.push({ onset, end: tick, midi: byte })
                }
            } else if (kind === 0xc0 && channel !== DRUM_CHANNEL && track.program === undefined) track.program = byte
        }
        // Notes still sounding when the track ends release there.
        for (const [key, onset] of open) track.notes.push({ onset, end: tick, midi: key & 0x7f })
        return track
    }

    private readMeta(track: TrackData, tick: number, type: number, data: Uint8Array) {
        switch (type) {
            case 0x03: {
                const name = new TextDecoder().decode(data).trim()
                if (name && track.name === undefined) track.name = name
                break
            }
            case 0x51: {
                const microsPerQuarter = data.length >= 3 ? (data[0] << 16) | (data[1] << 8) | data[2] : 0
                if (microsPerQuarter > 0)
                    track.tempos.push({ tick, value: Math.max(1, Math.min(500, Math.round(60_000_000 / microsPerQuarter))) })
                break
            }
            case 0x58:
                // numerator, denominator as a power of two (the clocks-per-click and 32nds-per-quarter fields are ignored)
                if (data.length >= 2 && data[0] >= 1 && data[0] <= 99 && data[1] <= 6) {
                    track.timeSignatures.push({ tick, value: new TimeSignature(data[0], 2 ** data[1]) })
                }
                break
            case 0x59: {
                const fifths = data.length >= 2 ? (data[0] > 127 ? data[0] - 256 : data[0]) : NaN
                if (Math.abs(fifths) <= 7) track.keys.push({ tick, value: { fifths, mode: data[1] === 1 ? 'minor' : 'major' } })
                break
            }
        }
    }

    // --- Notation decisions ---

    private toBeats(tick: number): number {
        return Math.round(tick / this.division / GRID) * GRID
    }

    /** The single melody line: quantized, top note per onset, releases trimmed to the next onset. */
    private melodyOf(raw: RawNote[]): MelodyNote[] {
        const quantized = raw.map((note) => {
            const onset = this.toBeats(note.onset)
            return { onset, end: Math.max(this.toBeats(note.end), onset + GRID), midi: Math.max(LOWEST_MIDI, Math.min(127, note.midi)) }
        })
        if (
            quantized.some(
                (note, i) =>
                    Math.abs(note.onset - raw[i].onset / this.division) > BEAT_EPSILON ||
                    Math.abs(note.end - raw[i].end / this.division) > BEAT_EPSILON,
            )
        ) {
            this.warn(WARN_QUANTIZED)
        }
        quantized.sort((a, b) => a.onset - b.onset || b.midi - a.midi)

        const melody: MelodyNote[] = []
        let reduced = false
        for (const note of quantized) {
            const previous = melody[melody.length - 1]
            if (previous && note.onset <= previous.onset) {
                reduced = true // a lower note of the same chord
                continue
            }
            if (previous && previous.end > note.onset) {
                previous.end = note.onset
                reduced = true
            }
            melody.push(note)
        }
        if (reduced) this.warn(WARN_REDUCED)
        return melody
    }

    /** Spans of one time signature each; the last runs to the end of the music, rounded up to whole bars. */
    private regionsOf(timeSignatures: Timed<TimeSignature>[], contentEnd: number): Region[] {
        const starts: Array<{ start: number; timeSignature: TimeSignature }> = []
        for (const change of timeSignatures) {
            // The first signature governs from the very start, wherever the file placed it.
            const start = starts.length ? this.toBeats(change.tick) : 0
            const last = starts[starts.length - 1]
            if (last?.timeSignature.equals(change.value)) continue
            if (last && last.start === start) starts.pop() // two changes at one instant: the later wins
            starts.push({ start, timeSignature: change.value })
        }
        if (!starts.length) starts.push({ start: 0, timeSignature: new TimeSignature(4, 4) })

        let measureCount = 0
        const regions = starts.map(({ start, timeSignature }, i): Region => {
            const capacity = timeSignature.maxBeats
            const next = starts[i + 1]
            const end = next ? next.start : start + Math.max(1, Math.ceil((contentEnd - start) / capacity - BEAT_EPSILON)) * capacity
            measureCount += Math.ceil((end - start) / capacity - BEAT_EPSILON)
            return { start, end, timeSignature }
        })
        if (measureCount > MAX_MEASURES) throw new Error('The MIDI file is too long to import.')
        return regions
    }

    /** Fill the score bar by bar; returns each bar's start beat for anchoring later markings. */
    private bar(
        score: Score,
        melody: MelodyNote[],
        regions: Region[],
        tempos: Timed<number>[],
        keys: Timed<{ fifths: number; mode: string }>[],
    ): number[] {
        const tempoChanges = tempos.map((tempo) => ({ beat: this.toBeats(tempo.tick), bpm: tempo.value }))
        const keyChanges = keys.map((key) => ({ beat: this.toBeats(key.tick), fifths: key.value.fifths }))
        const measureStarts: number[] = []
        let noteIndex = 0
        let lastBpm: number | undefined
        for (const region of regions) {
            const capacity = region.timeSignature.maxBeats
            const speller = new DurationSpeller(region.timeSignature)
            const rests = (from: number, beats: number) => speller.spell(from, beats).map((duration) => new Note({ duration }))
            for (let start = region.start; start < region.end - BEAT_EPSILON; start += capacity) {
                const end = Math.min(start + capacity, region.end)
                const notes: Note[] = []
                let cursor = start
                while (noteIndex < melody.length && melody[noteIndex].end <= start + BEAT_EPSILON) noteIndex++
                for (let i = noteIndex; i < melody.length && melody[i].onset < end - BEAT_EPSILON; i++) {
                    const note = melody[i]
                    const from = Math.max(note.onset, start)
                    const to = Math.min(note.end, end)
                    if (from > cursor + BEAT_EPSILON) notes.push(...rests(cursor - start, from - cursor))
                    const fifths = keyChanges.filter((key) => key.beat <= note.onset + BEAT_EPSILON).pop()?.fifths ?? 0
                    const pitch = MidiImporter.spell(note.midi, fifths)
                    const durations = speller.spell(from - start, to - from)
                    notes.push(
                        ...durations.map(
                            (duration, j) =>
                                new Note({
                                    duration,
                                    pitch,
                                    tie: MidiImporter.tieType(
                                        j > 0 || from > note.onset + BEAT_EPSILON,
                                        j < durations.length - 1 || to < note.end - BEAT_EPSILON,
                                    ),
                                }),
                        ),
                    )
                    cursor = to
                }
                // Silence to the end of the bar — and, in a region that ends mid-bar, on to the barline.
                if (cursor < start + capacity - BEAT_EPSILON) notes.push(...rests(cursor - start, start + capacity - cursor))

                const measure = new Measure(score, 'treble', region.timeSignature)
                measure.addNotes(notes)
                // At most one marking per bar: the first change inside it, unless the tempo is already sounding.
                const tempo = tempoChanges.find((change) => change.beat >= start - BEAT_EPSILON && change.beat < end - BEAT_EPSILON)
                if (tempo && tempo.bpm !== lastBpm) {
                    measure.setTempo(tempo.beat - start, tempo.bpm)
                    lastBpm = tempo.bpm
                }
                measureStarts.push(start)
                score.addMeasure(undefined, measure)
            }
        }
        return measureStarts
    }

    /** Key signature events become explicit key changes on the bar they fall in. */
    private markKeys(score: Score, measureStarts: number[], keys: Timed<{ fifths: number; mode: string }>[]) {
        let previous: { fifths: number; mode: string } | undefined
        for (const key of keys) {
            if (previous && previous.fifths === key.value.fifths && previous.mode === key.value.mode) continue
            previous = key.value
            const beat = this.toBeats(key.tick)
            let index = measureStarts.findIndex((start) => start > beat + BEAT_EPSILON) - 1
            if (index < -1) index = measureStarts.length - 1 // past the last bar start: the last bar
            score.setKeySignature(score.measures[Math.max(0, index)].firstNote, key.value.fifths, key.value.mode)
        }
    }

    /**
     * Spell a sounding pitch in a key: the diatonic spelling when the key has one, else the
     * natural, else the accidental on the key's side (sharps in sharp keys, flats in flat keys).
     */
    private static spell(midi: number, fifths: number): Pitch {
        const candidates = Pitch.spellingsOf(midi)
        return (
            candidates.find((pitch) => pitch.alter === KeySignature.alterInKey(fifths, pitch.name)) ??
            candidates.find((pitch) => pitch.alter === 0) ??
            (candidates.find((pitch) => pitch.alter === (fifths < 0 ? -1 : 1)) as Pitch)
        )
    }

    private static tieType(back: boolean, forward: boolean): TieType | undefined {
        if (back && forward) return 'start-stop'
        if (forward) return 'start'
        if (back) return 'stop'
        return undefined
    }

    private warn(message: string) {
        this.warnings.add(message)
    }
}
