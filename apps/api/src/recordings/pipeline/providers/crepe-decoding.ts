/**
 * The CREPE network's numeric edges: per-frame input normalization on the way
 * in, and activation decoding on the way out — Viterbi smoothing over the
 * `[frames, numBins]` activation matrix, sub-bin cents refinement along the
 * path, and top-k candidates per frame. What comes out is a pitch trajectory;
 * where notes begin and end is decided downstream (`semitone-segmenter.ts`,
 * `voice-note-decoder.ts`).
 */

export interface ViterbiOptions {
    /** Number of pitch bins per frame (= activation row length). */
    numBins: number
    /** Standard deviation (in bins) of the Gaussian transition prior. Models
     *  with denser bin spacing (smaller cents/bin) want a smaller σ in bins to
     *  keep the cents-equivalent σ roughly constant across providers. */
    sigmaBins: number
    /** Truncate the transition kernel beyond ±band bins. Controls per-frame cost
     *  (O(numBins · band) vs O(numBins²)). Pick ≥ 3·sigmaBins. */
    bandBins: number
    /**
     * Floor (in log-probability nats, negative) on the transition prior within
     * the band — a Gaussian+uniform MIXTURE. The pure Gaussian makes a large
     * interval quadratically expensive, so when reverb keeps the previous
     * note's tail alive the path clings to it for hundreds of ms and eats the
     * next note's onset (arpeggios under reverb collapse). With a floor, any
     * in-band jump costs at most `-jumpLogFloor` nats, so a few frames of
     * evidence for the new pitch flips the path. Omit for the pure Gaussian.
     */
    jumpLogFloor?: number
}

/**
 * Viterbi decode over a per-frame pitch-activation matrix. Returns the most
 * likely bin index per frame under a band-limited Gaussian transition prior.
 * Mirrors marl/crepe's `to_viterbi_cents` decode step (minus the local-average
 * cents lift, done separately by `localCentsFromPath`).
 */
export function viterbi(activations: Float32Array, frames: number, opts: ViterbiOptions): Int16Array {
    const { numBins, sigmaBins, bandBins } = opts
    const path = new Int16Array(frames)
    if (frames === 0) return path

    const kernelSize = 2 * bandBins + 1
    const logTrans = new Float32Array(kernelSize)
    const twoSigmaSq = 2 * sigmaBins * sigmaBins
    const floor = opts.jumpLogFloor ?? -Infinity
    for (let d = -bandBins; d <= bandBins; d++) {
        logTrans[d + bandBins] = Math.max(-(d * d) / twoSigmaSq, floor)
    }

    const logProb = new Float32Array(frames * numBins)
    const psi = new Int16Array(frames * numBins)

    // First frame: log salience under a uniform prior (constant absorbed).
    for (let b = 0; b < numBins; b++) {
        logProb[b] = Math.log(activations[b] + 1e-15)
    }

    for (let t = 1; t < frames; t++) {
        const offCur = t * numBins
        const offPrev = offCur - numBins
        for (let bCur = 0; bCur < numBins; bCur++) {
            const lo = Math.max(0, bCur - bandBins)
            const hi = Math.min(numBins - 1, bCur + bandBins)
            let bestScore = -Infinity
            let bestPrev = bCur
            for (let bPrev = lo; bPrev <= hi; bPrev++) {
                const s = logProb[offPrev + bPrev] + logTrans[bCur - bPrev + bandBins]
                if (s > bestScore) {
                    bestScore = s
                    bestPrev = bPrev
                }
            }
            logProb[offCur + bCur] = bestScore + Math.log(activations[offCur + bCur] + 1e-15)
            psi[offCur + bCur] = bestPrev
        }
    }

    let bestEnd = 0
    let bestEndScore = -Infinity
    const lastOff = (frames - 1) * numBins
    for (let b = 0; b < numBins; b++) {
        const s = logProb[lastOff + b]
        if (s > bestEndScore) {
            bestEndScore = s
            bestEnd = b
        }
    }
    path[frames - 1] = bestEnd
    for (let t = frames - 2; t >= 0; t--) {
        path[t] = psi[(t + 1) * numBins + path[t + 1]]
    }
    return path
}

/**
 * For each frame, weighted mean of cents over the ±halfWidth bins around the
 * Viterbi path's chosen bin. Lifts the integer-bin pitch trajectory to
 * sub-bin precision without smearing across unrelated peaks (which a global
 * weighted mean would do).
 */
export function localCentsFromPath(
    activations: Float32Array,
    path: Int16Array,
    frames: number,
    centMap: Float32Array,
    numBins: number,
    halfWidth: number,
): Float32Array {
    const cents = new Float32Array(frames)
    for (let t = 0; t < frames; t++) {
        const center = path[t]
        const lo = Math.max(0, center - halfWidth)
        const hi = Math.min(numBins - 1, center + halfWidth)
        const offset = t * numBins
        let weighted = 0
        let total = 0
        for (let b = lo; b <= hi; b++) {
            const a = activations[offset + b]
            weighted += a * centMap[b]
            total += a
        }
        cents[t] = total > 0 ? weighted / total : centMap[center]
    }
    return cents
}

/**
 * Per-frame top-k pitch candidates from the raw activation matrix (E3/R9 —
 * pYIN §5.6 of the plugin survey): the k strongest LOCAL MAXIMA of each
 * frame's activation row, each lifted to sub-bin cents by the same ±halfWidth
 * weighted mean the main trajectory uses. Flattened `[frames × k]`;
 * `strength` 0 marks an empty slot. Slots are ordered strongest-first.
 *
 * This is what lets a note-level decoder choose a NON-argmax candidate when
 * note context favours it — the recoverability pYIN gets from YIN's threshold
 * sweep, which a single collapsed trajectory structurally cannot offer.
 */
export function topKCandidates(
    activations: Float32Array,
    frames: number,
    centMap: Float32Array,
    numBins: number,
    halfWidth: number,
    k: number,
): { cents: Float32Array; strength: Float32Array } {
    const cents = new Float32Array(frames * k)
    const strength = new Float32Array(frames * k)
    const topBin = new Array<number>(k)
    const topVal = new Array<number>(k)
    for (let t = 0; t < frames; t += 1) {
        const off = t * numBins
        let count = 0
        for (let b = 0; b < numBins; b += 1) {
            const a = activations[off + b]
            const left = b > 0 ? activations[off + b - 1] : -1
            const right = b < numBins - 1 ? activations[off + b + 1] : -1
            // Local maximum; plateau ties break to the leftmost bin.
            if (a < left || a <= right) continue
            // Insertion into the running top-k (k ≤ 5, so linear is fine).
            let i = count < k ? count : k - 1
            if (i === k - 1 && count === k && a <= topVal[i]) continue
            while (i > 0 && topVal[i - 1] < a) {
                topBin[i] = topBin[i - 1]
                topVal[i] = topVal[i - 1]
                i -= 1
            }
            topBin[i] = b
            topVal[i] = a
            if (count < k) count += 1
        }
        for (let j = 0; j < count; j += 1) {
            const center = topBin[j]
            const lo = Math.max(0, center - halfWidth)
            const hi = Math.min(numBins - 1, center + halfWidth)
            let weighted = 0
            let total = 0
            for (let b = lo; b <= hi; b += 1) {
                const a = activations[off + b]
                weighted += a * centMap[b]
                total += a
            }
            cents[t * k + j] = total > 0 ? weighted / total : centMap[center]
            strength[t * k + j] = topVal[j]
        }
    }
    return { cents, strength }
}

/** Per-frame zero-mean / unit-variance normalization, matching what most
 *  pitch CNNs (CREPE, etc.) expect on raw windows. */
export function normalizeFrame(window: Float32Array): Float32Array {
    let mean = 0
    for (let i = 0; i < window.length; i++) mean += window[i]
    mean /= window.length
    let sq = 0
    for (let i = 0; i < window.length; i++) {
        const d = window[i] - mean
        sq += d * d
    }
    const std = Math.sqrt(sq / window.length) || 1
    const out = new Float32Array(window.length)
    for (let i = 0; i < window.length; i++) {
        out[i] = (window[i] - mean) / std
    }
    return out
}
