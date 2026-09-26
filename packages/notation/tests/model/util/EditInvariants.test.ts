import { BEAT_EPSILON } from '@mushee/notation/model/Duration'
import type { Score } from '@mushee/notation/model/Score'
import { TimeSignature } from '@mushee/notation/model/TimeSignature'
import { describe, expect, it } from 'vitest'

import { generateScore, Rng } from './scoreGenerator'
import { describeScore, soundingEvents } from './scoreObservations'

/**
 * Structural edits must not change the music. Over generated scores:
 *  - changing the meter and changing it back keeps every sounding event (bars
 *    are re-cut with ties across the new barlines and re-joined coming back);
 *  - transposing by an interval and back keeps every sounding pitch and rhythm;
 *  - minimizing accidentals is idempotent and never changes what sounds.
 * Bars stay well-formed throughout (never over-full; a cut tuplet may leave a
 * sub-sixteenth residue, the model's documented trade-off).
 */

const METERS: ReadonlyArray<[number, number]> = [
    [4, 4],
    [3, 4],
    [2, 4],
    [6, 8],
    [2, 2],
    [5, 4],
    [7, 8],
]

function assertBarsWellFormed(score: Score, step: string) {
    for (const measure of score.measures) {
        expect(measure.beats, `${step}: bar ${measure.index} over-full ${measure.beats}/${measure.maxBeats}`).toBeLessThan(
            measure.maxBeats + BEAT_EPSILON,
        )
        expect(measure.maxBeats - measure.beats, `${step}: bar ${measure.index} short ${measure.beats}/${measure.maxBeats}`).toBeLessThan(
            1 / 6 - BEAT_EPSILON,
        )
    }
}

const SEEDS = Array.from({ length: 150 }, (_, i) => i + 1)

describe('edit invariants over generated scores', () => {
    it.each(SEEDS)('meter there and back keeps the sounding music (seed %i)', (seed) => {
        const rng = new Rng(seed)
        // Plain rhythms: a tuplet cut at a new barline legitimately leaves a residue, which would blur the comparison.
        const score = generateScore(rng, { tuplets: false, midBarTempos: false, singleMeter: true })
        const before = soundingEvents(score)
        const original = score.measures.map((m) => m.timeSignature)
        const target = new TimeSignature(...rng.pick(METERS))

        score.setTimeSignature(score.measures[0], target)
        assertBarsWellFormed(score, `after → ${target.beatAmount}/${target.beatType}`)
        expect(soundingEvents(score), `after → ${target.beatAmount}/${target.beatType}`).toEqual(before)

        // Back to the original meter of the first bar (a generated score may change meter mid-way; the
        // first run is what setTimeSignature re-cuts, so compare sound, not bar shapes).
        score.setTimeSignature(score.measures[0], original[0])
        assertBarsWellFormed(score, 'after → back')
        expect(soundingEvents(score), 'after → back').toEqual(before)
    })

    it.each(SEEDS)('transpose up then down keeps every sounding pitch and rhythm (seed %i)', (seed) => {
        const rng = new Rng(seed)
        const score = generateScore(rng, { tuplets: true, midBarTempos: true })
        const before = soundingEvents(score)
        const chromatic = rng.int(-11, 11)
        const diatonic = Math.round((chromatic * 7) / 12)
        score.transpose(chromatic, diatonic)
        assertBarsWellFormed(score, `after +${chromatic}`)
        const shifted = soundingEvents(score).map((e) => e.replace(/:(-?\d+)$/, (_, midi) => `:${Number(midi) - chromatic}`))
        expect(shifted, `after +${chromatic}: every attack moves by exactly the interval`).toEqual(before)
        score.transpose(-chromatic, -diatonic)
        expect(soundingEvents(score), `after +${chromatic} −${chromatic}`).toEqual(before)
    })

    it.each(SEEDS)('minimizing accidentals never changes what sounds (seed %i)', (seed) => {
        const score = generateScore(new Rng(seed), { tuplets: true, midBarTempos: true })
        const before = soundingEvents(score)
        score.minimizeAccidentals()
        expect(soundingEvents(score)).toEqual(before)
        // Idempotence: the key choice ranks candidates on what the notes *sound* (their pitch classes),
        // not on spellings the pass itself rewrites, so a second pass finds nothing left to move.
        const once = describeScore(score)
        score.minimizeAccidentals()
        expect(describeScore(score), 'a second pass changes nothing').toEqual(once)
        expect(soundingEvents(score)).toEqual(before)
        assertBarsWellFormed(score, 'after minimize')
    })
})
