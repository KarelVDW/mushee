/**
 * The melody interchange format between the generator, the DB, the notation
 * renderer and the materialized ground truth.
 *
 * A clip's expected notes are stored at NOTATION level (spelled pitches +
 * durations in beats), not in seconds: the notation package renders them
 * directly, replay schedules them against the corpus bpm, and the harness's
 * `GroundTruth` (onset/duration seconds + MIDI) is derived — never the other
 * way around.
 */

export interface MelodyPitch {
    /** Letter step, properly spelled for the clip's key (MusicXML semantics). */
    step: 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G'
    /** Chromatic alteration: -1 flat, 0 natural, 1 sharp. */
    alter: number
    octave: number
    /** Sounding MIDI, redundant with step/alter/octave — stored so the truth
     * derivation and the harness never re-implement spelling. */
    midi: number
}

export interface MelodyEvent {
    /** Length in quarter-note beats (maps to a single un-tied duration). */
    beats: number
    /** Absent = rest. */
    pitch?: MelodyPitch
}

export interface ClipMelody {
    bpm: number
    /** Quarter-note beats per measure (the time signature is beats/4). */
    beatsPerMeasure: number
    /** Key the clip was generated in, for display ("G major"). */
    keyLabel: string
    /** Fifths of the key signature (negative = flats), for notation rendering. */
    keyFifths: number
    events: MelodyEvent[]
}

/** The harness's ground-truth shape (apps/api/scripts/eval/types.ts). */
export interface TruthNote {
    onsetSec: number
    durSec: number
    midi: number
}

export interface GroundTruth {
    bpm: number
    notes: TruthNote[]
}

/** Derive the harness ground truth: nominal onsets/durations on the beat grid. */
export function melodyToTruth(melody: ClipMelody): GroundTruth {
    const secPerBeat = 60 / melody.bpm
    const notes: TruthNote[] = []
    let beat = 0
    for (const event of melody.events) {
        if (event.pitch) {
            notes.push({
                onsetSec: beat * secPerBeat,
                durSec: event.beats * secPerBeat,
                midi: event.pitch.midi,
            })
        }
        beat += event.beats
    }
    return { bpm: melody.bpm, notes }
}

export function melodyDurationSec(melody: ClipMelody): number {
    const beats = melody.events.reduce((sum, e) => sum + e.beats, 0)
    return (beats * 60) / melody.bpm
}

export function melodyNoteCount(melody: ClipMelody): number {
    return melody.events.filter((e) => e.pitch).length
}

/** The same melody with `measures` of silence prepended — the take's count-in. */
export function withCountIn(melody: ClipMelody, measures = 1): ClipMelody {
    const rests: MelodyEvent[] = Array.from({ length: measures }, () => ({ beats: melody.beatsPerMeasure }))
    return { ...melody, events: [...rests, ...melody.events] }
}
