import type { Note } from '@mushee/notation/model'
import type { MxmlMeasure } from '@mushee/notation/model/io/MusicXml'
import { MeasureSerializer } from '@mushee/notation/model/io/ScoreSerializer'
import { clef, fill, makeScore, pitched, rest } from '@mushee/notation/testing'
import { describe, expect, it } from 'vitest'

import { RecordingTake } from '@/lib/RecordingTake'

/** The wire form of a 4/4 measure holding `notes` — what the gateway streams back. */
function transcribed(notes: Note[]): MxmlMeasure {
    return new MeasureSerializer(fill(makeScore(1), 0, notes)).serialize()
}

const spelled = (notes: readonly Note[]): Array<string | null> => notes.map((n) => (n.pitch ? `${n.pitch.name}${n.pitch.octave}` : null))

describe('RecordingTake', () => {
    it('begins by displacing the start measure and adopting its tempo marking, then appends after it', () => {
        const score = makeScore(3)
        score.setTempo(score.measures[1].firstNote, 132)
        const displaced = score.measures[1]
        const take = new RecordingTake(score, 1, clef('treble'))

        take.begin()
        expect(score.measures).toHaveLength(4)
        expect(score.measures[2]).toBe(displaced)
        expect(score.measures[1].tempoAtBeat(0)?.bpm).toBe(132)

        take.appendMeasure()
        take.appendMeasure()
        expect(score.measures).toHaveLength(6)
        expect(score.measures[4]).toBe(displaced)
    })

    it('writes an update into the measure at the take-relative key and reports the beats its notes cover', () => {
        const score = makeScore(3)
        const take = new RecordingTake(score, 1, clef('treble'))
        take.begin()

        const covered = take.applyUpdate({ 0: transcribed([pitched('C', 5), pitched('D', 5, 'h'), rest()]) })
        expect(spelled(score.measures[1].notes)).toEqual(['C5', 'D5', null])
        // Up to the end of the last pitched note; the trailing rest covers nothing.
        expect(covered).toEqual([{ measureIndex: 1, coveredBeats: 3 }])
    })

    it('skips measures that are gone and updates without notes, and reports nothing for all-rest measures', () => {
        const score = makeScore(1)
        const take = new RecordingTake(score, 0, clef('treble'))
        take.begin()
        const before = score.measures[0].notes

        const covered = take.applyUpdate({
            0: transcribed([rest('w')]),
            7: transcribed([pitched('C', 5, 'w')]),
            1: { ...transcribed([rest('w')]), entries: [] },
        })
        expect(covered).toEqual([])
        expect(score.measures).toHaveLength(2)
        expect(score.measures[0].notes).not.toBe(before) // the all-rest update was still written
        expect(spelled(score.measures[0].notes)).toEqual([null])
    })

    it('pulls the take onto the clef it records into, locking the shift from the first pitched update', () => {
        const score = makeScore(1)
        const take = new RecordingTake(score, 0, clef('treble'))
        take.begin()
        take.appendMeasure()

        // Whistled two octaves above the treble staff.
        take.applyUpdate({ 0: transcribed([pitched('B', 6, 'w')]) })
        expect(spelled(score.measures[0].notes)).toEqual(['B4'])

        // A later update keeps that shift, even where re-deciding would pick another one.
        take.applyUpdate({ 1: transcribed([pitched('B', 5, 'w')]) })
        expect(spelled(score.measures[1].notes)).toEqual(['B3'])
    })

    it('waits for an update with pitches before deciding the shift', () => {
        const score = makeScore(1)
        const take = new RecordingTake(score, 0, clef('bass'))
        take.begin()
        take.appendMeasure()

        take.applyUpdate({ 0: transcribed([rest('w')]) })
        take.applyUpdate({ 1: transcribed([pitched('D', 5, 'w')]) })
        expect(spelled(score.measures[1].notes)).toEqual(['D3'])
    })
})
