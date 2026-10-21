import type { Clef } from '../model/Clef'
import { Duration } from '../model/Duration'
import { ScoreDeserializer } from '../model/io/ScoreDeserializer'
import { ScoreSerializer } from '../model/io/ScoreSerializer'
import type { KeySignature } from '../model/KeySignature'
import { Measure } from '../model/Measure'
import { Note } from '../model/Note'
import { Pitch, type PitchStep } from '../model/Pitch'
import { Score } from '../model/Score'
import { TimeSignature } from '../model/TimeSignature'
import type { ClefType, DurationType, TieType } from '../model/types'

/** Build a fresh Score with `count` measures. Each measure is filled to maxBeats. */
export function makeScore(count = 1): Score {
    const score = new Score()
    for (let i = 0; i < count; i++) {
        score.addMeasure().complete()
    }
    return score
}

/** Convenience: a quarter-note rest. */
export function rest(type: DurationType = 'q'): Note {
    return new Note({ duration: new Duration({ type }) })
}

/** Convenience: a pitched note. */
export function pitched(name: PitchStep, octave: number, type: DurationType = 'q'): Note {
    return new Note({ duration: new Duration({ type }), pitch: new Pitch({ name, octave }) })
}

/** Convenience: one note of a 3:2 triplet (an eighth by default). */
export function triplet(type: DurationType = '8', name: PitchStep = 'C', octave = 4): Note {
    return new Note({ duration: new Duration({ type, ratio: { actualNotes: 3, normalNotes: 2 } }), pitch: new Pitch({ name, octave }) })
}

/** Convenience: an empty treble measure in a throwaway score, not registered in it. */
export function measure(beatAmount = 4, beatType = 4): Measure {
    return new Measure(new Score(), 'treble', new TimeSignature(beatAmount, beatType))
}

/** Convenience: a quarter note at `pitch`, or a quarter rest without one. */
export function q(pitch?: Pitch, tie?: TieType): Note {
    return new Note({ duration: new Duration({ type: 'q' }), pitch, tie })
}

/** Convenience: a pitch with an explicit alteration. */
export function p(name: PitchStep, octave: number, alter = 0): Pitch {
    return new Pitch({ name, octave, alter })
}

/** Replace measure `measureIndex`'s notes with `notes` (through the score, so the edit is versioned). */
export function fill(score: Score, measureIndex: number, notes: Note[]): Measure {
    const target = score.measures[measureIndex]
    score.replace(target.notes, notes)
    return target
}

/** The score as it comes back from a save and reload. */
export function roundTrip(score: Score): Score {
    return new ScoreDeserializer(new ScoreSerializer(score).toInput()).toScore()
}

/** Convenience: a Clef attached to a throwaway measure (clefs require a measure, like tempos). */
export function clef(type: ClefType = 'treble', beatPosition = 0): Clef {
    const measure = new Measure(new Score(), beatPosition === 0 ? type : 'treble', new TimeSignature(4, 4))
    if (beatPosition === 0) return measure.clef
    measure.addClef(beatPosition, type)
    return measure.clefAtBeat(beatPosition) as Clef
}

/** Convenience: a KeySignature attached to a throwaway measure (keys require a measure, like clefs). */
export function key(fifths = 0, mode?: string, beatPosition = 0): KeySignature {
    const measure = new Measure(
        new Score(),
        'treble',
        new TimeSignature(4, 4),
        beatPosition === 0 ? { keyFifths: fifths, keyMode: mode } : undefined,
    )
    if (beatPosition === 0) return measure.keySignature
    measure.addKeySignature(beatPosition, fifths, mode)
    return measure.keyAtBeat(beatPosition) as KeySignature
}
