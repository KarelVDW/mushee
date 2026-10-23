import { fill, makeScore, pitched, rest } from '@mushee/notation/testing'
import { describe, expect, it } from 'vitest'

import { NoteLanding } from '../../src/lib/NoteLanding'
import type { Score } from '../../src/model'

/** The ids of `score`'s measure `index` that land after the last update. */
const landingIn = (landing: NoteLanding, score: Score, index: number) => [...(landing.landingIn(score.measures[index]) ?? [])]
const ids = (score: Score, index: number) => score.measures[index].notes.map((note) => note.id)

/** A tracker that has taken in `score` as a take starts. */
function started(score: Score): NoteLanding {
    const landing = new NoteLanding()
    landing.update(score, false)
    landing.update(score, true)
    return landing
}

describe('NoteLanding', () => {
    it('lands nothing while no take is live', () => {
        const score = makeScore(2)
        const landing = new NoteLanding()
        landing.update(score, false)
        fill(score, 0, [pitched('C', 4, 'w')])
        landing.update(score, false)
        expect(landing.landingIn(score.measures[0])).toBeUndefined()
    })

    it('takes what is on screen as a take starts as already shown', () => {
        const score = makeScore(2)
        fill(score, 0, [pitched('C', 4, 'w')])
        const landing = started(score)
        expect(landing.landingIn(score.measures[0])).toBeUndefined()
        expect(landing.landingIn(score.measures[1])).toBeUndefined()
    })

    it('lands a note the take writes, and keeps it landing while the same note stays on screen', () => {
        const score = makeScore(2)
        const landing = started(score)
        fill(score, 1, [pitched('E', 4), pitched('G', 4, 'h'), rest()])
        landing.update(score, true)
        // The quarter rest at beat 3 was already there; the two new notes land.
        expect(landingIn(landing, score, 1)).toEqual(ids(score, 1).slice(0, 2))
        const set = landing.landingIn(score.measures[1])

        // A repeated render, or a later one (the take moves on), answers the same — the same Set,
        // so a memoised measure holds — and a measure with nothing new has none.
        landing.update(score, true)
        expect(landing.landingIn(score.measures[1])).toBe(set)
        expect(landing.landingIn(score.measures[0])).toBeUndefined()
    })

    it('does not replay a measure the server re-sends unchanged, though its notes are new objects', () => {
        const score = makeScore(2)
        const landing = started(score)
        fill(score, 1, [pitched('E', 4), pitched('G', 4, 'h'), rest()])
        landing.update(score, true)
        fill(score, 1, [pitched('E', 4), pitched('G', 4, 'h'), rest()])
        landing.update(score, true)
        expect(landing.landingIn(score.measures[1])).toBeUndefined()
    })

    it('lands a note whose pitch, onset or length changed', () => {
        const score = makeScore(2)
        const landing = started(score)
        fill(score, 1, [pitched('E', 4), pitched('G', 4, 'h'), rest()])
        landing.update(score, true)

        fill(score, 1, [pitched('E', 4), pitched('A', 4, 'h'), rest()]) // a new pitch
        landing.update(score, true)
        expect(landingIn(landing, score, 1)).toEqual([ids(score, 1)[1]])

        fill(score, 1, [pitched('E', 4, 'h'), pitched('A', 4, 'h')]) // a longer first note, the A now at beat 2
        landing.update(score, true)
        expect(landingIn(landing, score, 1)).toEqual(ids(score, 1))
    })

    it('tells notes apart by measure: the same note in another bar lands too', () => {
        const score = makeScore(3)
        const landing = started(score)
        fill(score, 1, [pitched('C', 4, 'w')])
        landing.update(score, true)
        fill(score, 2, [pitched('C', 4, 'w')])
        landing.update(score, true)
        expect(landingIn(landing, score, 2)).toEqual(ids(score, 2))
    })

    it('forgets everything once the take ends, and the next take starts from what is on screen', () => {
        const score = makeScore(2)
        const landing = started(score)
        fill(score, 1, [pitched('C', 4, 'w')])
        landing.update(score, true)
        expect(landingIn(landing, score, 1)).toHaveLength(1)

        landing.update(score, false)
        expect(landing.landingIn(score.measures[1])).toBeUndefined()
        // Between takes the bar is emptied again; the next take starts from that.
        fill(score, 1, [rest('w')])
        landing.update(score, false)
        landing.update(score, true)
        expect(landing.landingIn(score.measures[1])).toBeUndefined()
        // The note the last take had shown, written anew, lands: nothing of it was remembered.
        fill(score, 1, [pitched('C', 4, 'w')])
        landing.update(score, true)
        expect(landingIn(landing, score, 1)).toEqual(ids(score, 1))
    })

    it('a new take starting on a later render still lands nothing that was on screen', () => {
        const score = makeScore(2)
        fill(score, 1, [pitched('C', 4, 'w')])
        const landing = new NoteLanding()
        // The take's first render: the whole note is already there, so it is shown, not new.
        landing.update(score, true)
        expect(landing.landingIn(score.measures[1])).toBeUndefined()
    })
})
