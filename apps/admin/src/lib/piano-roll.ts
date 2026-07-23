import type { ScoreDocument, ScoreEntry } from './api'

/**
 * Flattens the MusicXML-JSON wire format into piano-roll geometry: one box
 * per sounding note, on a time axis measured in quarter notes. This viewer is
 * deliberately independent of the editor's engraving engine — the console
 * needs a faithful glance at pitch/rhythm content, not print-quality layout.
 */

export interface PianoRollNote {
    /** Onset in quarter notes from the start of the piece. */
    start: number
    /** Length in quarter notes. */
    duration: number
    midi: number
    partIndex: number
}

export interface PianoRoll {
    notes: PianoRollNote[]
    /** Measure start positions in quarter notes (first is 0). */
    measureStarts: number[]
    /** Total length in quarter notes. */
    end: number
    minMidi: number
    maxMidi: number
    partCount: number
}

const STEP_SEMITONES: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }

/** MusicXML default when no <attributes><divisions> was emitted yet. */
const DEFAULT_DIVISIONS = 12

export function buildPianoRoll(document: ScoreDocument): PianoRoll {
    const notes: PianoRollNote[] = []
    const measureStarts: number[] = []
    let end = 0

    const parts = document.parts ?? []
    parts.forEach((part, partIndex) => {
        let divisions = DEFAULT_DIVISIONS
        let position = 0

        part.measures?.forEach((measure, measureIndex) => {
            if (partIndex === 0) measureStarts[measureIndex] = position

            for (const entry of measure.entries ?? []) {
                if (entry._type === 'attributes' && entry.divisions) {
                    divisions = entry.divisions
                    continue
                }
                if (entry._type !== 'note' || typeof entry.duration !== 'number') continue

                const quarters = entry.duration / divisions
                if (entry.pitch) {
                    const midi = midiOf(entry)
                    const previous = notes.findLast((n) => n.partIndex === partIndex && n.midi === midi)
                    // A tie-stop continues the previous note instead of re-attacking.
                    if (isTieStop(entry) && previous && nearlyEqual(previous.start + previous.duration, position)) {
                        previous.duration += quarters
                    } else {
                        notes.push({ start: position, duration: quarters, midi, partIndex })
                    }
                }
                position += quarters
            }
        })
        end = Math.max(end, position)
    })

    const pitches = notes.map((n) => n.midi)
    return {
        notes,
        measureStarts,
        end,
        minMidi: pitches.length ? Math.min(...pitches) : 60,
        maxMidi: pitches.length ? Math.max(...pitches) : 72,
        partCount: parts.length,
    }
}

function midiOf(entry: ScoreEntry): number {
    const pitch = entry.pitch
    if (!pitch) return 0
    return (pitch.octave + 1) * 12 + (STEP_SEMITONES[pitch.step] ?? 0) + (pitch.alter ?? 0)
}

function isTieStop(entry: ScoreEntry): boolean {
    return entry.tie?.some((t) => t.type === 'stop') ?? false
}

/** Positions accumulate float error through triplet durations — compare loosely. */
function nearlyEqual(a: number, b: number): boolean {
    return Math.abs(a - b) < 1e-6
}

/** "C4" style label for the pitch axis. */
export function pitchLabel(midi: number): string {
    const names = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B']
    return `${names[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`
}
