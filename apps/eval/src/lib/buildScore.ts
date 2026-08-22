/**
 * Bridges between this app's data and the notation package's Score model:
 * expected notes (ClipMelody) and pipeline output (MusicXML measures) both
 * become real Scores, so the clip pages engrave them with the same renderer
 * the product uses.
 */

import type { ClefType, MxmlMeasure } from '@mushee/notation/components/types'
import { Duration } from '@mushee/notation/model/Duration'
import { Instrument } from '@mushee/notation/model/Instrument'
import { Note } from '@mushee/notation/model/Note'
import { Pitch } from '@mushee/notation/model/Pitch'
import { Score } from '@mushee/notation/model/Score'
import { TimeSignature } from '@mushee/notation/model/TimeSignature'
import { ScoreDeserializer } from '@mushee/notation/model/util/ScoreDeserializer'

import type { ClipMelody, MelodyEvent } from './melody'

/** One un-tied duration per generated beat length (generator only emits these). */
const BEATS_TO_DURATION: Record<string, { type: 'w' | 'h' | 'q' | '8' | '16'; dots?: number }> = {
    '4': { type: 'w' },
    '3': { type: 'h', dots: 1 },
    '2': { type: 'h' },
    '1.5': { type: 'q', dots: 1 },
    '1': { type: 'q' },
    '0.75': { type: '8', dots: 1 },
    '0.5': { type: '8' },
    '0.25': { type: '16' },
}

function eventToNote(event: MelodyEvent): Note {
    const mapped = BEATS_TO_DURATION[String(event.beats)]
    if (!mapped) throw new Error(`no single duration spans ${event.beats} beats`)
    const duration = new Duration({ type: mapped.type, dots: mapped.dots })
    if (!event.pitch) return new Note({ duration })
    return new Note({
        duration,
        pitch: new Pitch({ name: event.pitch.step, alter: event.pitch.alter, octave: event.pitch.octave }),
    })
}

/** Playback instrument for a corpus: what the expected-note replay sounds like. */
export function playbackInstrument(kind: string, instrumentId?: string | null): Instrument {
    if (instrumentId) {
        const instrument = Instrument.byId(instrumentId)
        if (instrument) return instrument
    }
    if (kind === 'whistle') return Instrument.TinWhistle
    if (kind === 'voice') return Instrument.VoiceLead
    return Instrument.Piano
}

function clefFor(midis: number[]): ClefType {
    if (!midis.length) return 'treble'
    const sorted = [...midis].sort((a, b) => a - b)
    return sorted[Math.floor(sorted.length / 2)] < 57 ? 'bass' : 'treble'
}

/** Engrave a clip's expected notes: key signature, tempo, exact measures. */
export function melodyToScore(melody: ClipMelody, instrument: Instrument): Score {
    const score = new Score()
    score.seedInstrument(instrument)
    score.addMeasure()
    const first = score.firstMeasure!
    if (melody.beatsPerMeasure !== 4) score.setTimeSignature(first, new TimeSignature(melody.beatsPerMeasure, 4))
    const firstMeasure = score.firstMeasure!
    firstMeasure.addTempo(0, melody.bpm)
    const clef = clefFor(melody.events.flatMap((e) => (e.pitch ? [e.pitch.midi] : [])))
    if (clef !== 'treble') firstMeasure.setClef(0, clef)
    if (melody.keyFifths !== 0) firstMeasure.setKeySignature(0, melody.keyFifths)

    // Group events into measures (the generator fills each one exactly).
    const measures: MelodyEvent[][] = []
    let current: MelodyEvent[] = []
    let beats = 0
    for (const event of melody.events) {
        current.push(event)
        beats += event.beats
        if (beats >= melody.beatsPerMeasure) {
            measures.push(current)
            current = []
            beats = 0
        }
    }
    if (current.length) measures.push(current)

    for (let i = 0; i < measures.length; i++) {
        const measure = score.measures[i] ?? score.addMeasure()
        measure.complete()
        const notes = measures[i].map(eventToNote)
        if (measure.firstNote) score.replace([measure.firstNote], notes)
    }
    return score
}

/**
 * Engrave what the pipeline heard: its emitted MusicXML measures, converted
 * with the same deserializer the product's recording flow uses.
 */
export function mxmlMeasuresToScore(
    measures: Record<number, MxmlMeasure>,
    bpm: number,
    beatsPerMeasure: number,
    instrument: Instrument,
): Score {
    const score = new Score()
    score.seedInstrument(instrument)
    score.addMeasure()
    if (beatsPerMeasure !== 4) score.setTimeSignature(score.firstMeasure!, new TimeSignature(beatsPerMeasure, 4))
    score.firstMeasure!.addTempo(0, bpm)

    const indices = Object.keys(measures)
        .map(Number)
        .sort((a, b) => a - b)
    const lastIndex = indices.length ? indices[indices.length - 1] : 0

    const allNotes: Note[][] = []
    for (let i = 0; i <= lastIndex; i++) {
        allNotes.push(measures[i] ? ScoreDeserializer.mxmlMeasureToNotes(measures[i]) : [])
    }
    const clef = clefFor(
        allNotes.flat().flatMap((n) => (n.pitch ? [n.pitch.toMidi()] : [])),
    )
    if (clef !== 'treble') score.firstMeasure!.setClef(0, clef)

    for (let i = 0; i <= lastIndex; i++) {
        const measure = score.measures[i] ?? score.addMeasure()
        measure.complete()
        const notes = allNotes[i]
        if (notes.length && measure.firstNote) score.replace([measure.firstNote], notes)
    }
    return score
}
