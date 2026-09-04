/**
 * Significance machinery for corpus comparisons.
 *
 * ## Why this has to exist before any more tuning
 *
 * Per-clip note-F1 on this corpus has a **measured** standard deviation of 0.20–0.28
 * (higher than the 0.10–0.15 the literature assumes, because per-clip F1 saturates
 * at 0 or 1 on short clips). A difference of one or two points between two configs
 * can therefore be inside the noise, and many of the numbers this harness produces
 * are in exactly that band. Without an interval, "0.596 beats 0.582" is not a
 * finding — it is a coin flip with extra steps.
 *
 * Pairing is what rescues it: measured ρ between two configs on the same clips is
 * 0.98–0.99, which drops the minimum detectable effect to ~0.01 at n≈280.
 *
 * Two rules follow from the structure of the data, and both are easy to get wrong:
 *
 * 1. **Resample CLIPS, not notes.** Notes inside one recording share a singer, a
 *    room, an SNR and a register, so they fail together. Resampling notes treats
 *    correlated observations as independent and produces intervals that are far
 *    too narrow. The effective sample size is the number of *recordings*, so a
 *    longer clip buys almost no statistical power.
 *
 * 2. **PAIR the comparison.** Draw one set of clip indices per replicate and score
 *    *both* configs on it. Between-clip variance — which dominates — then cancels,
 *    and the interval reflects only the difference the change actually made. This
 *    is worth roughly a 4–5× reduction in the corpus size needed to see a given
 *    effect, which is not an optimisation but the difference between "measurable"
 *    and "not".
 */

/** Resamples for a confidence interval. Well past the ~2000 an SE would need. */
const DEFAULT_RESAMPLES = 9999

/**
 * Deterministic PRNG (mulberry32). A fixed seed means a gate flipping is always a
 * real change and never Monte-Carlo jitter between two runs of the same code.
 */
function rng(seed: number): () => number {
    let a = seed >>> 0
    return () => {
        a = (a + 0x6d2b79f5) >>> 0
        let t = a
        t = Math.imul(t ^ (t >>> 15), t | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

function mean(xs: number[]): number {
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0
}

function sd(xs: number[]): number {
    if (xs.length < 2) return 0
    const mu = mean(xs)
    // Sample standard deviation (n−1): we are estimating the population spread
    // from a sample, not describing this particular set of clips.
    return Math.sqrt(xs.reduce((s, x) => s + (x - mu) ** 2, 0) / (xs.length - 1))
}

export interface Interval {
    point: number
    low: number
    high: number
}

export interface PairedComparison extends Interval {
    /** Per-clip standard deviation of the metric — drives every power calculation. */
    sigma: number
    /** Correlation between the two configs across clips. High ⇒ pairing pays off. */
    rho: number
    /** SD of the per-clip difference. What the interval is actually built from. */
    sigmaDiff: number
    /**
     * Smallest difference this corpus could detect at 80 % power, α=0.05:
     * `2.8016 · σ_diff / √n`. If |point| is below this, the comparison was
     * underpowered and a null result means nothing.
     */
    mde: number
    /** Clips the comparison rests on. */
    n: number
    /** True when the interval excludes zero. */
    significant: boolean
}

/**
 * Paired bootstrap of `b − a`, where both arrays hold per-clip scores **for the
 * same clips in the same order**. Also returns σ, ρ and the minimum detectable
 * effect, because a difference should never be reported without the context of
 * whether it *could* have been seen.
 */
export function pairedDiffCI(a: number[], b: number[], { resamples = DEFAULT_RESAMPLES, seed = 1, alpha = 0.05 } = {}): PairedComparison {
    const n = Math.min(a.length, b.length)
    if (n === 0) {
        return {
            point: 0,
            low: 0,
            high: 0,
            sigma: 0,
            rho: 0,
            sigmaDiff: 0,
            mde: Infinity,
            n: 0,
            significant: false,
        }
    }
    const diffs = Array.from({ length: n }, (_, i) => b[i] - a[i])
    const rand = rng(seed)
    const boots: number[] = []
    for (let r = 0; r < resamples; r += 1) {
        let sum = 0
        // ONE index draw per replicate, shared by both configs — that is the pairing.
        for (let i = 0; i < n; i += 1) sum += diffs[(rand() * n) | 0]
        boots.push(sum / n)
    }
    boots.sort((x, y) => x - y)

    const sdA = sd(a.slice(0, n))
    const sdB = sd(b.slice(0, n))
    const muA = mean(a.slice(0, n))
    const muB = mean(b.slice(0, n))
    let cov = 0
    for (let i = 0; i < n; i += 1) cov += (a[i] - muA) * (b[i] - muB)
    cov /= Math.max(1, n - 1)
    const rho = sdA > 0 && sdB > 0 ? cov / (sdA * sdB) : 0
    const sigmaDiff = sd(diffs)

    const low = boots[Math.floor((alpha / 2) * resamples)]
    const high = boots[Math.floor((1 - alpha / 2) * resamples)]
    return {
        point: mean(diffs),
        low,
        high,
        sigma: (sdA + sdB) / 2,
        rho,
        sigmaDiff,
        mde: (2.8016 * sigmaDiff) / Math.sqrt(n),
        n,
        significant: low > 0 || high < 0,
    }
}

/** Compact one-line rendering: `+0.062 [+0.021,+0.104] n=20 σ=.13 ρ=.71 mde=.041 *`. */
export function formatComparison(c: PairedComparison): string {
    const sign = (x: number): string => (x >= 0 ? `+${x.toFixed(3)}` : x.toFixed(3))
    return (
        `${sign(c.point)} [${sign(c.low)},${sign(c.high)}] ` +
        `n=${c.n} σ=${c.sigma.toFixed(2)} ρ=${c.rho.toFixed(2)} ` +
        `mde=${c.mde.toFixed(3)}${c.significant ? ' *' : ''}`
    )
}
