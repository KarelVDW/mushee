import { Score } from '../Score'
import type { TimeSignature } from '../TimeSignature'

const TICKS_PER_QUARTER = 480
const VELOCITY = 80
const CHANNEL = 0

interface TrackEvent {
    tick: number
    /** Sort key within a tick: meta/program changes first, then note-offs, then note-ons. */
    order: 0 | 1 | 2
    data: number[]
}

/**
 * Renders the score as a format-0 Standard MIDI File. Mirrors ScoreScheduler's
 * playback semantics: written pitch is transposed to sounding pitch, tied notes
 * sound once for their combined length, and tempo markings take effect at their
 * beat (defaulting to Score.DEFAULT_BPM before the first marking).
 */
export class MidiExporter {
    constructor(readonly score: Score) {}

    toBytes(): Uint8Array<ArrayBuffer> {
        const events = this.collectEvents()
        events.sort((a, b) => a.tick - b.tick || a.order - b.order)

        const track: number[] = []
        let lastTick = 0
        for (const event of events) {
            MidiExporter.pushVlq(track, event.tick - lastTick)
            lastTick = event.tick
            track.push(...event.data)
        }
        MidiExporter.pushVlq(track, 0)
        track.push(0xff, 0x2f, 0x00) // end of track

        const bytes = new Uint8Array(14 + 8 + track.length)
        // MThd: format 0, one track, TICKS_PER_QUARTER division
        bytes.set([0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, TICKS_PER_QUARTER >> 8, TICKS_PER_QUARTER & 0xff], 0)
        bytes.set([0x4d, 0x54, 0x72, 0x6b, (track.length >>> 24) & 0xff, (track.length >>> 16) & 0xff, (track.length >>> 8) & 0xff, track.length & 0xff], 14)
        bytes.set(track, 22)
        return bytes
    }

    private collectEvents(): TrackEvent[] {
        const events: TrackEvent[] = []
        const instrument = this.score.instrument
        events.push({ tick: 0, order: 0, data: [0xc0 | CHANNEL, instrument.gmProgram & 0x7f] })

        let position = 0 // running offset in quarter-note beats
        let hasOpeningTempo = false
        let previousTimeSignature: TimeSignature | undefined
        for (const measure of this.score.measures) {
            const measureStart = position
            const timeSignature = measure.timeSignature
            if (
                previousTimeSignature?.beatAmount !== timeSignature.beatAmount ||
                previousTimeSignature?.beatType !== timeSignature.beatType
            ) {
                events.push({ tick: MidiExporter.toTicks(measureStart), order: 0, data: MidiExporter.timeSignatureMeta(timeSignature) })
                previousTimeSignature = timeSignature
            }
            for (const tempo of measure.tempos) {
                if (measureStart + tempo.beatPosition === 0) hasOpeningTempo = true
                events.push({ tick: MidiExporter.toTicks(measureStart + tempo.beatPosition), order: 0, data: MidiExporter.tempoMeta(tempo.bpm) })
            }
            for (const note of measure.notes) {
                const start = position
                position += note.duration.effectiveBeats
                // A note tying back already sounds as part of the note that started the tie chain.
                if (!note.pitch || note.tiesBack) continue
                let end = start + note.duration.effectiveBeats
                let current = note
                while (current.tiesForward) {
                    const next = current.getNext()
                    if (!next) break
                    end += next.duration.effectiveBeats
                    current = next
                }
                const midi = Math.max(0, Math.min(127, note.pitch.toMidi() + instrument.chromaticTranspose))
                events.push({ tick: MidiExporter.toTicks(start), order: 2, data: [0x90 | CHANNEL, midi, VELOCITY] })
                events.push({ tick: MidiExporter.toTicks(end), order: 1, data: [0x80 | CHANNEL, midi, 0] })
            }
        }
        if (!hasOpeningTempo) events.push({ tick: 0, order: 0, data: MidiExporter.tempoMeta(Score.DEFAULT_BPM) })
        return events
    }

    private static toTicks(beats: number): number {
        return Math.round(beats * TICKS_PER_QUARTER)
    }

    private static tempoMeta(bpm: number): number[] {
        const microsPerQuarter = Math.round(60_000_000 / bpm)
        return [0xff, 0x51, 0x03, (microsPerQuarter >> 16) & 0xff, (microsPerQuarter >> 8) & 0xff, microsPerQuarter & 0xff]
    }

    private static timeSignatureMeta(timeSignature: TimeSignature): number[] {
        // 24 MIDI clocks per metronome click (quarter note), 8 32nds per quarter — the conventional values.
        return [0xff, 0x58, 0x04, timeSignature.beatAmount, Math.round(Math.log2(timeSignature.beatType)), 24, 8]
    }

    private static pushVlq(target: number[], value: number) {
        let buffer = value & 0x7f
        let remaining = value >> 7
        while (remaining > 0) {
            buffer = (buffer << 8) | 0x80 | (remaining & 0x7f)
            remaining >>= 7
        }
        for (;;) {
            target.push(buffer & 0xff)
            if (buffer & 0x80) buffer >>= 8
            else break
        }
    }
}
