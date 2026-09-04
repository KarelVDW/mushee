/**
 * Segmentation error breakdown: **how** a transcription is wrong, not just how much.
 *
 * F1 collapses every failure into one number, but the failures are not
 * interchangeable — either musically or in what they cost a user to repair.
 * Measured expert-correction times (Tony study, 96 recordings / 32 singers):
 *
 *   Join two notes .... 3.2 s      Delete a spurious note .... 3.5 s
 *   Split one note .... 5.6 s      **Create a missing note ... 145 s**
 *
 * A missing note is worth roughly forty spurious ones. So "we emit 12 notes for 8"
 * and "we emit 6 notes for 8" can share an F1 and be wildly different products, and
 * the ratio that actually matters is **split vs merged vs missed** — which is what
 * this reports and what F1 hides.
 *
 * The categories are the split/merge/missed/spurious subset of the taxonomy in
 * Molina et al., *Evaluation framework for automatic singing transcription*
 * (ISMIR 2014) — the paper that found segmentation, not pitch, decided which system
 * won. Only that subset is implemented, deliberately: the rest of Molina's classes
 * concern onset/offset boundary quality, which the timing stats in `metrics.ts`
 * already cover.
 *
 * Matching here is **pitch-agnostic and overlap-based**, unlike the onset-window
 * matcher in `metrics.ts`. That is the point: to see that one sung note became three
 * written ones, the three have to be associated with it even though at most one of
 * them can win an onset match.
 */

import type { TruthNote } from '../types'
import type { EstNote } from './metrics'

export interface SegErrorCounts {
    /** Reference notes matched one-to-one by exactly one estimate. */
    clean: number
    /** One reference note carved into several estimates. Costs ~3.2 s each to rejoin. */
    split: number
    /** Several reference notes collapsed into one estimate. Costs ~5.6 s to separate. */
    merged: number
    /** Reference notes with no overlapping estimate at all. Costs ~145 s each. */
    missed: number
    /** Estimates overlapping no reference note. Costs ~3.5 s each to delete. */
    spurious: number
    /**
     * Components where several references overlap several estimates — genuinely
     * scrambled rather than cleanly split or merged. Counted apart so `split` and
     * `merged` stay interpretable.
     */
    tangled: number
    /** Of the one-to-one matches, how many carry the wrong pitch. */
    pitchWrong: number
    refTotal: number
    estTotal: number
}

/** Seconds of overlap between two spans. */
function overlap(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
    return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart))
}

/**
 * Classify how `est` mis-segments `ref`.
 *
 * `minOverlapRatio` is measured against the SHORTER of the two notes, so a brief
 * fragment sitting inside a long held note still counts as overlapping it — which is
 * exactly the split case we are trying to detect, and which a ratio against the
 * longer note would miss.
 */
export function segErrors(ref: TruthNote[], est: EstNote[], { minOverlapRatio = 0.3 } = {}): SegErrorCounts {
    const counts: SegErrorCounts = {
        clean: 0,
        split: 0,
        merged: 0,
        missed: 0,
        spurious: 0,
        tangled: 0,
        pitchWrong: 0,
        refTotal: ref.length,
        estTotal: est.length,
    }

    // Adjacency: which estimates overlap which references.
    const estOf: number[][] = ref.map(() => [])
    const refOf: number[][] = est.map(() => [])
    for (let i = 0; i < ref.length; i += 1) {
        const rStart = ref[i].onsetSec
        const rEnd = rStart + ref[i].durSec
        for (let j = 0; j < est.length; j += 1) {
            const eStart = est[j].onsetSec
            const eEnd = eStart + est[j].durSec
            const ov = overlap(rStart, rEnd, eStart, eEnd)
            if (ov <= 0) continue
            const shorter = Math.min(rEnd - rStart, eEnd - eStart)
            if (shorter > 0 && ov / shorter >= minOverlapRatio) {
                estOf[i].push(j)
                refOf[j].push(i)
            }
        }
    }

    // Connected components over the bipartite overlap graph.
    const refSeen = new Array(ref.length).fill(false)
    const estSeen = new Array(est.length).fill(false)
    for (let i = 0; i < ref.length; i += 1) {
        if (refSeen[i]) continue
        const refIds: number[] = []
        const estIds: number[] = []
        const stack: Array<{ side: 'ref' | 'est'; id: number }> = [{ side: 'ref', id: i }]
        while (stack.length) {
            const node = stack.pop()
            if (!node) break
            if (node.side === 'ref') {
                if (refSeen[node.id]) continue
                refSeen[node.id] = true
                refIds.push(node.id)
                for (const j of estOf[node.id]) stack.push({ side: 'est', id: j })
            } else {
                if (estSeen[node.id]) continue
                estSeen[node.id] = true
                estIds.push(node.id)
                for (const r of refOf[node.id]) stack.push({ side: 'ref', id: r })
            }
        }

        if (estIds.length === 0) {
            counts.missed += refIds.length
        } else if (refIds.length === 1 && estIds.length === 1) {
            counts.clean += 1
            if (ref[refIds[0]].midi !== est[estIds[0]].midi) counts.pitchWrong += 1
        } else if (refIds.length === 1) {
            // One sung note written as several: each extra written note is one rejoin.
            counts.split += estIds.length - 1
        } else if (estIds.length === 1) {
            // Several sung notes written as one: each extra sung note is one separation.
            counts.merged += refIds.length - 1
        } else {
            counts.tangled += 1
        }
    }
    // Estimates in no component at all are spurious.
    counts.spurious = estSeen.filter((seen) => !seen).length
    return counts
}

/**
 * Marginal expert-correction cost of each error class, in seconds, from the Tony
 * study's regression over 96 recordings by 32 singers. These are *measured human
 * times*, not weights someone chose, which is what makes the total below meaningful.
 */
const REPAIR_SECONDS = {
    /** Join notes the transcription split apart. */
    join: 3.2,
    /** Separate notes it merged together. */
    split: 5.6,
    /** Delete a note that should not be there. */
    del: 3.5,
    /** Enter a note it never detected — two orders of magnitude worse than the rest. */
    create: 145,
} as const

/**
 * Estimated seconds of expert repair per 100 reference notes.
 *
 * This is the closest thing available to a metric denominated in what the product
 * actually costs its user, and it deliberately disagrees with F1: because merging is
 * repaired by a 5.6 s Split while over-segmentation is repaired by a 3.2 s Join, a
 * configuration that emits *too many* notes can be cheaper to fix than one that emits
 * too few, even at equal F1. Missing notes dominate everything at 145 s each.
 *
 * Treat it as an ordering aid rather than a literal prediction — the constants come
 * from one study, on expert annotators, correcting timing only.
 */
export function repairSecondsPer100(c: SegErrorCounts): number {
    if (!c.refTotal) return 0
    const total =
        c.split * REPAIR_SECONDS.join + c.merged * REPAIR_SECONDS.split + c.spurious * REPAIR_SECONDS.del + c.missed * REPAIR_SECONDS.create
    return (100 * total) / c.refTotal
}

/**
 * `clean 62% split 14 merged 9 missed 21 spur 18 tangled 3 pWrong 11` — per 100
 * reference notes. `pWrong` counts the cleanly-segmented notes carrying the wrong
 * pitch: it is the share of the loss that better *boundaries* cannot fix, and
 * without it a decode that segments perfectly but names notes wrong reads as a
 * segmentation success.
 */
export function formatSegErrors(c: SegErrorCounts): string {
    const per100 = (n: number): string => (c.refTotal ? ((100 * n) / c.refTotal).toFixed(0) : '0')
    return (
        `clean=${per100(c.clean)}% split=${per100(c.split)} merged=${per100(c.merged)} ` +
        `missed=${per100(c.missed)} spur=${per100(c.spurious)} tangle=${per100(c.tangled)} ` +
        `pWrong=${per100(c.pitchWrong)} | repair=${repairSecondsPer100(c).toFixed(0)}s/100notes`
    )
}
