import { describe, expect, it } from 'vitest'

import { clusteredDiffCI, type ClusteredPair, pairedDiffCI } from '../../scripts/eval/lib/stats'

/**
 * `benchmark.ts compare` resamples PERFORMANCES (a clip with all of its
 * conditions) within each dataset and reports the mean of dataset means. These
 * pin the two properties that make it the right interval for an all-condition
 * run: the point is the headline's arithmetic, and copies of one performance do
 * not buy precision the way independent clips would.
 */

/** Deterministic pseudo-random per-clip differences, so the test needs no seed plumbing. */
function diffs(n: number, offset: number): number[] {
    return Array.from({ length: n }, (_, i) => offset + 0.1 * Math.sin(i * 12.9898))
}

describe('clusteredDiffCI', () => {
    it('reports the mean of stratum means, not the pooled row mean', () => {
        const pairs: ClusteredPair[] = [
            // stratum A: 4 clips, Δ = +0.1 each
            ...[0, 1, 2, 3].map((i) => ({ stratum: 'A', cluster: `a${i}`, a: 0.5, b: 0.6 })),
            // stratum B: 1 clip, Δ = −0.1
            { stratum: 'B', cluster: 'b0', a: 0.5, b: 0.4 },
        ]
        const ci = clusteredDiffCI(pairs, { resamples: 999 })
        expect(ci.point).toBeCloseTo(0, 10) // (+0.1 + −0.1) / 2, where the pooled row mean would be +0.06
        expect(ci.levelA).toBeCloseTo(0.5, 10)
        expect(ci.levelB).toBeCloseTo(0.5, 10)
        expect(ci.clusters).toBe(5)
        expect(ci.singletonStrata).toBe(1)
    })

    it('matches the clip-level interval when every cluster is one row', () => {
        const d = diffs(200, 0.02)
        const pairs = d.map((x, i) => ({ stratum: 'S', cluster: `c${i}`, a: 0.5, b: 0.5 + x }))
        const clustered = clusteredDiffCI(pairs)
        const flat = pairedDiffCI(
            pairs.map((p) => p.a),
            pairs.map((p) => p.b),
        )
        expect(clustered.point).toBeCloseTo(flat.point, 10)
        // Different draws, same estimator: the widths agree to Monte-Carlo error.
        expect(Math.abs(clustered.high - clustered.low - (flat.high - flat.low))).toBeLessThan(0.002)
    })

    it('does not narrow when each performance is repeated under several conditions', () => {
        const d = diffs(60, 0.01)
        const once = d.map((x, i) => ({ stratum: 'S', cluster: `c${i}`, a: 0.5, b: 0.5 + x }))
        // Five "conditions" per performance that move together — the adverse variants of one take.
        const fiveTimes = once.flatMap((p) => [0, 1, 2, 3, 4].map(() => ({ ...p })))
        const clustered = clusteredDiffCI(fiveTimes)
        const reference = clusteredDiffCI(once)
        const naive = pairedDiffCI(
            fiveTimes.map((p) => p.a),
            fiveTimes.map((p) => p.b),
        )
        expect(clustered.high - clustered.low).toBeCloseTo(reference.high - reference.low, 10)
        // Treating the copies as independent shrinks the interval by about √5.
        expect((naive.high - naive.low) * 1.8).toBeLessThan(clustered.high - clustered.low)
    })

    it('is exactly zero for identical configs, and empty input is a non-result', () => {
        const same = [0.2, 0.7, 0.4].map((v, i) => ({ stratum: 'S', cluster: `c${i}`, a: v, b: v }))
        const ci = clusteredDiffCI(same)
        expect([ci.point, ci.low, ci.high, ci.significant]).toEqual([0, 0, 0, false])
        expect(clusteredDiffCI([]).n).toBe(0)
    })
})
