import { Score } from '@mushee/notation/model/Score'
import { ScoreDeserializer } from '@mushee/notation/model/util/ScoreDeserializer'
import { ScoreSerializer } from '@mushee/notation/model/util/ScoreSerializer'
import { makeScore, pitched } from '@mushee/notation/testing'
import { describe, expect, it } from 'vitest'

const roundTrip = (score: Score) => new ScoreDeserializer(new ScoreSerializer(score).toInput()).toScore()

describe('key signature serialization round-trip', () => {
    it('preserves a non-C leading key', () => {
        const score = makeScore(1)
        score.setKeySignature(score.firstMeasure?.firstNote, 3)
        const restored = roundTrip(score)
        expect(restored.firstMeasure?.keySignature.fifths).toBe(3)
    })

    it('preserves a flat key and its mode', () => {
        const score = makeScore(1)
        const m = score.firstMeasure
        if (!m) throw new Error('expected firstMeasure')
        score.setKeySignature(m.firstNote, -3, 'minor')
        const restored = roundTrip(score)
        expect(restored.firstMeasure?.keySignature.fifths).toBe(-3)
        expect(restored.firstMeasure?.keySignature.mode).toBe('minor')
    })

    it('preserves a mid-measure key change at its beat', () => {
        const score = makeScore(1)
        const m = score.firstMeasure
        if (!m) throw new Error('expected firstMeasure')
        score.setKeySignature(m.noteAtBeat(2), 2)
        const restored = roundTrip(score)
        const rm = restored.firstMeasure
        if (!rm) throw new Error('expected restored firstMeasure')
        expect(rm.keySignature.fifths).toBe(0)
        expect(rm.keyAtOrBefore(2).fifths).toBe(2)
    })

    it('round-trips independent leading keys per measure', () => {
        const score = makeScore(2)
        score.setKeySignature(score.measures[0].firstNote, 1)
        score.setKeySignature(score.measures[1].firstNote, -2)
        const restored = roundTrip(score)
        expect(restored.measures[0].keySignature.fifths).toBe(1)
        expect(restored.measures[1].keySignature.fifths).toBe(-2)
    })

    it('round-trips a key that carries forward (only the change is serialized)', () => {
        const score = makeScore(2)
        score.setKeySignature(score.measures[0].firstNote, 4)
        const restored = roundTrip(score)
        expect(restored.measures[0].keySignature.fifths).toBe(4)
        expect(restored.measures[1].keySignature.fifths).toBe(4) // carried forward, not re-declared
    })

    it('preserves an explicit leading-key boundary even when it equals the carried-in key', () => {
        const score = makeScore(3)
        score.setKeySignature(score.measures[1].firstNote, 2) // m1 = explicit boundary
        score.setKeySignature(score.measures[0].firstNote, 2) // m0 = 2; m1 now equals carried-in but stays explicit
        expect(score.measures[1].leadingKeyExplicit).toBe(true)

        const restored = roundTrip(score)
        expect(restored.measures[1].leadingKeyExplicit).toBe(true)
        // The boundary still stops propagation.
        restored.setKeySignature(restored.measures[0].firstNote, 0)
        expect(restored.measures[1].keySignature.fifths).toBe(2)
    })

    it('preserves a mid-measure key change after a preceding note is lengthened off its beat', () => {
        const score = makeScore(1) // 4/4 of quarter rests at beats 0,1,2,3
        const m = score.firstMeasure
        if (!m) throw new Error('expected firstMeasure')
        score.setKeySignature(m.noteAtBeat(1), 2) // D major from beat 1
        const beat0 = m.noteAtBeat(0)
        if (!beat0) throw new Error('expected a note at beat 0')
        score.replace([beat0], [pitched('C', 4, 'h')]) // note starts become 0,2,3 — nothing at beat 1
        expect(m.keyAtOrBefore(2).fifths).toBe(2) // still applied live

        const restored = roundTrip(score)
        expect(restored.firstMeasure?.keyAtOrBefore(2).fifths).toBe(2) // survives (re-anchored to the next note)
    })
})
