import { describe, expect, it } from 'vitest'

import type { PendingNote } from '../../src/recordings/pipeline/mxml-builder'
import { RecordingPipeline } from '../../src/recordings/pipeline/recording-pipeline'

/**
 * Which measures a batch of newly committed notes causes to be (re)built.
 *
 * This decision has already produced two shipped bugs — held notes truncated to
 * their first bar, and rested-through bars never emitted at all — because both
 * cases have no note onset to key off. The invariant these tests pin: after any
 * sequence of batches, every measure from 0 through the last bar any note touches
 * has been emitted at least once, with no holes, whether the silence falls
 * between batches or inside one.
 */

/** Registry/resolver are irrelevant to measure arithmetic; setMeta is enough. */
function pipeline(): RecordingPipeline {
    const p = new RecordingPipeline(
        null as unknown as ConstructorParameters<typeof RecordingPipeline>[0],
        null as unknown as ConstructorParameters<typeof RecordingPipeline>[1],
    )
    p.setMeta({ bpm: 120, timeSignature: { beats: 4, beatType: 4 } })
    return p
}

function affected(p: RecordingPipeline, notes: PendingNote[]): number[] {
    return (p as unknown as { affectedMeasures(notes: PendingNote[]): number[] }).affectedMeasures(notes)
}

// At 120 bpm in 4/4 a bar is 2 s.
const bar = (n: number, durBars = 0.5): PendingNote => ({
    startTimeSeconds: n * 2,
    durationSeconds: durBars * 2,
    pitchMidi: 60,
})

describe('RecordingPipeline.affectedMeasures', () => {
    it('emits every bar a held note sounds through', () => {
        expect(affected(pipeline(), [bar(0, 5)])).toEqual([0, 1, 2, 3, 4])
    })

    it('fills bars rested through between two batches', () => {
        const p = pipeline()
        expect(affected(p, [bar(0)])).toEqual([0])
        // Silence in bars 1-2, next note in bar 3 — the gap belongs to this batch.
        expect(affected(p, [bar(3)])).toEqual([1, 2, 3])
    })

    it('fills bars rested through INSIDE one batch', () => {
        // Regression: one burst pass (stalled decode, final flush) can commit notes
        // spanning a multi-bar rest in a single batch. Filling only up to the batch's
        // lowest bar left the interior bars as permanent holes in the score.
        expect(affected(pipeline(), [bar(0), bar(3)])).toEqual([0, 1, 2, 3])
    })

    it('does not re-fill bars on a batch that follows contiguously', () => {
        const p = pipeline()
        affected(p, [bar(0)])
        expect(affected(p, [bar(1)])).toEqual([1])
    })
})
