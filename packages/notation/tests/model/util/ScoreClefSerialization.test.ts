import { Score } from '@mushee/notation/model/Score'
import { ScoreDeserializer } from '@mushee/notation/model/util/ScoreDeserializer'
import { ScoreSerializer } from '@mushee/notation/model/util/ScoreSerializer'
import { makeScore, pitched } from '@mushee/notation/testing'
import { describe, expect, it } from 'vitest'

const roundTrip = (score: Score) => new ScoreDeserializer(new ScoreSerializer(score).toInput()).toScore()

describe('clef serialization round-trip', () => {
    it('preserves a non-treble leading clef', () => {
        const score = makeScore(1)
        const m = score.firstMeasure
        if (!m) throw new Error('expected firstMeasure')
        score.setClef(m.firstNote, 'bass')

        const restored = new ScoreDeserializer(new ScoreSerializer(score).toInput()).toScore()
        const rm = restored.firstMeasure
        if (!rm) throw new Error('expected restored firstMeasure')
        expect(rm.clef.type).toBe('bass')
    })

    it('preserves a mid-measure clef change at its beat', () => {
        const score = makeScore(1)
        const m = score.firstMeasure
        if (!m) throw new Error('expected firstMeasure')
        score.setClef(m.noteAtBeat(2), 'alto')

        const restored = new ScoreDeserializer(new ScoreSerializer(score).toInput()).toScore()
        const rm = restored.firstMeasure
        if (!rm) throw new Error('expected restored firstMeasure')
        expect(rm.clef.type).toBe('treble')
        expect(rm.clefAtOrBefore(2).type).toBe('alto')
    })

    it('round-trips independent leading clefs per measure', () => {
        const score = makeScore(2)
        const m0 = score.measures[0]
        const m1 = score.measures[1]
        score.setClef(m0.firstNote, 'bass')
        score.setClef(m1.firstNote, 'alto')

        const restored = new ScoreDeserializer(new ScoreSerializer(score).toInput()).toScore()
        expect(restored.measures[0].clef.type).toBe('bass')
        expect(restored.measures[1].clef.type).toBe('alto')
    })

    it('round-trips a clef that carries forward (only the change is serialized)', () => {
        const score = makeScore(2)
        score.setClef(score.measures[0].firstNote, 'tenor')

        const restored = new ScoreDeserializer(new ScoreSerializer(score).toInput()).toScore()
        expect(restored.measures[0].clef.type).toBe('tenor')
        expect(restored.measures[1].clef.type).toBe('tenor') // carried forward, not re-declared
    })

    it('round-trips octave clefs and C-clef-family clefs via sign/line/octave', () => {
        for (const clef of ['treble8vb', 'bass15ma', 'soprano', 'baritoneF'] as const) {
            const score = makeScore(1)
            score.setClef(score.firstMeasure?.firstNote, clef)
            const restored = new ScoreDeserializer(new ScoreSerializer(score).toInput()).toScore()
            expect(restored.firstMeasure?.clef.type).toBe(clef)
        }
    })

    it('preserves a mid-measure clef change after a preceding note is lengthened off its beat', () => {
        const score = makeScore(1) // 4/4 of quarter rests at beats 0,1,2,3
        const m = score.firstMeasure
        if (!m) throw new Error('expected firstMeasure')
        score.setClef(m.noteAtBeat(1), 'bass') // bass from beat 1
        // Lengthen the beat-0 note to a half note: note starts become 0,2,3 — nothing starts at beat 1.
        const beat0 = m.noteAtBeat(0)
        if (!beat0) throw new Error('expected a note at beat 0')
        score.replace([beat0], [pitched('C', 4, 'h')])
        expect(m.clefAtOrBefore(2).type).toBe('bass') // still applied live

        const restored = roundTrip(score)
        const rm = restored.firstMeasure
        if (!rm) throw new Error('expected restored firstMeasure')
        expect(rm.clefAtOrBefore(2).type).toBe('bass') // survives the round-trip (re-anchored to the next note)
    })

    it('preserves an explicit leading-clef boundary even when it equals the carried-in clef', () => {
        const score = makeScore(3)
        score.setClef(score.measures[1].firstNote, 'bass') // m1 = explicit bass boundary
        score.setClef(score.measures[0].firstNote, 'bass') // m0 = bass; m1 now equals carried-in but stays explicit
        expect(score.measures[1].leadingClefExplicit).toBe(true)

        const restored = roundTrip(score)
        expect(restored.measures[1].leadingClefExplicit).toBe(true)
        // The boundary still stops propagation: reverting m0 must not drag m1 along.
        restored.setClef(restored.measures[0].firstNote, 'treble')
        expect(restored.measures[1].clef.type).toBe('bass')
    })
})
