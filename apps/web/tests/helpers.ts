import type { ClefType, DurationType } from '@/components/notation/types'
import { Clef } from '@/model/Clef'
import { Duration } from '@/model/Duration'
import { Measure } from '@/model/Measure'
import { Note } from '@/model/Note'
import { Pitch } from '@/model/Pitch'
import { Score } from '@/model/Score'
import { TimeSignature } from '@/model/TimeSignature'

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
export function pitched(name: string, octave: number, type: DurationType = 'q'): Note {
    return new Note({ duration: new Duration({ type }), pitch: new Pitch({ name, octave }) })
}

/** Convenience: pre-canned default clef type + 4/4 time. */
export function defaults(): { clefType: ClefType; timeSignature: TimeSignature } {
    return { clefType: 'treble', timeSignature: new TimeSignature(4, 4) }
}

/** Convenience: a Clef attached to a throwaway measure (clefs require a measure, like tempos). */
export function clef(type: ClefType = 'treble', beatPosition = 0): Clef {
    const measure = new Measure(new Score(), beatPosition === 0 ? type : 'treble', new TimeSignature(4, 4))
    if (beatPosition === 0) return measure.clef
    measure.addClef(beatPosition, type)
    return measure.clefAtBeat(beatPosition) as Clef
}
