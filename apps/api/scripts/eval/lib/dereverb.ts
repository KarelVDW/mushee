/**
 * Late-reverberation suppression (Lebart / Habets spectral subtraction), in pure
 * TypeScript so it can be measured before anything is committed to the shipping
 * decoder.
 *
 * ## 🔴 MEASURED DEAD END (2026-07-25) — read this before reaching for it again
 *
 * It looked like the highest-value lever available. The substitution ablation in
 * `sweep-reverb.ts` shows that handing the reverberant pipeline the clean take's
 * f0 trajectory and voicing — an oracle for exactly what an audio front end is
 * supposed to restore — recovers **+0.140** (echoey-room) and **+0.229**
 * (distant-mic) note-F1, i.e. 77–84 % of the entire reverb loss. So the ceiling
 * was real and large.
 *
 * It does not convert. Every setting tried is significantly NEGATIVE on
 * reverberant audio, and the damage grows monotonically with how much tail is
 * removed (`EVAL_SPLIT=dev`, annotated-vocalset, 100 clips, Δ note-F1 vs
 * untreated, `*` = 95 % CI excludes zero):
 *
 * ```
 *                        clean                     echoey-room
 * t60 0.5 α1             -0.012 [-0.027,+0.003]    -0.021 [-0.035,-0.005] *
 * t60 0.8 α1             -0.039 [-0.059,-0.019] *  -0.047 [-0.064,-0.031] *
 * t60 0.8 α1.5           -0.094 [-0.121,-0.069] *  -0.073 [-0.091,-0.056] *
 * t60 0.8 α2             -0.168 [-0.203,-0.134] *
 * t60 1.3 α1.5           -0.175 [-0.211,-0.140] *
 * t60 0.8 α1.5 late 24ms -0.179 [-0.218,-0.141] *  -0.089 [-0.110,-0.070] *
 * ```
 *
 * Note the gentlest row: it is the ONLY one whose dry-audio cost is inside the
 * noise, and even there the reverberant column is already significantly negative.
 * There is no setting that is harmless on dry audio and helpful on wet.
 *
 * The mechanism is the reason, and it generalises past this one algorithm. What
 * reverb costs us is **CREPE's confidence**, not its pitch (§ the resolver's
 * `applyReverb`): the model still finds the right f0, it just stops being sure.
 * Spectral subtraction attacks the reverberation by eroding exactly the thing the
 * confidence is computed from — the harmonic magnitudes — and leaves musical
 * noise where it over-subtracts. So it removes some tail AND lowers confidence
 * further, and the second effect dominates. The gentlest setting is the least bad
 * in both columns, and extrapolating the trend, the best any member of this
 * family reaches is 0.
 *
 * → A front end for this problem has to be one that does not damage harmonic
 * structure: a learned/masking dereverberator (WPE-style multi-channel linear
 * prediction needs channels we do not have; single-channel neural dereverb is the
 * plausible option), or a pitch model that is simply more confident under reverb
 * (RMVPE is reported strongest on noisy singing but is licence-blocked — see the README findings log). Not more
 * subtraction.
 *
 * Kept in the tree because the negative result is worth more than the file costs,
 * and because `MODE=frontend` in `sweep-reverb.ts` is the harness any replacement
 * front end should be measured with.
 *
 * ## Why this was not the `afftdn` dead end repeated
 *
 * The findings log records `afftdn` spectral denoise as measured EXACTLY NEUTRAL on the
 * reverberant conditions. That is the expected result, and it says nothing about
 * dereverberation: `afftdn` estimates a **stationary** noise floor and subtracts
 * it, but reverberation is a delayed, decaying copy of the signal itself — it has
 * no stationary floor to find, and it moves with every note.
 *
 * This estimator instead builds the interferer FROM THE SIGNAL'S OWN PAST. Under
 * a statistical model of a room's exponentially-decaying diffuse tail, the power
 * arriving at frame t from reverberation of earlier sound is
 *
 *     λ(t, k) = e^(−2 δ T_l) · |X(t − L, k)|²,      δ = 3 ln10 / T60
 *
 * i.e. the spectrum L frames ago, attenuated by the room's decay over that gap.
 * Subtracting that (with over-subtraction `alpha` and a gain floor to stop
 * musical noise) suppresses the tail that keeps the previous note's pitch alive,
 * while leaving the direct sound intact. Different mechanism, different failure
 * modes, so it is worth its own measurement.
 *
 * Deliberately parameter-light: T60 and the early/late split are the only knobs
 * that matter, and both are swept rather than assumed.
 */

/** In-place iterative radix-2 complex FFT. `re`/`im` length must be a power of 2. */
function fft(re: Float64Array, im: Float64Array, inverse: boolean): void {
    const n = re.length
    // Bit-reversal permutation.
    for (let i = 1, j = 0; i < n; i += 1) {
        let bit = n >> 1
        for (; j & bit; bit >>= 1) j ^= bit
        j ^= bit
        if (i < j) {
            let t = re[i]
            re[i] = re[j]
            re[j] = t
            t = im[i]
            im[i] = im[j]
            im[j] = t
        }
    }
    for (let len = 2; len <= n; len <<= 1) {
        const ang = ((inverse ? 2 : -2) * Math.PI) / len
        const wRe = Math.cos(ang)
        const wIm = Math.sin(ang)
        for (let i = 0; i < n; i += len) {
            let curRe = 1
            let curIm = 0
            for (let k = 0; k < len >> 1; k += 1) {
                const uRe = re[i + k]
                const uIm = im[i + k]
                const vRe = re[i + k + (len >> 1)] * curRe - im[i + k + (len >> 1)] * curIm
                const vIm = re[i + k + (len >> 1)] * curIm + im[i + k + (len >> 1)] * curRe
                re[i + k] = uRe + vRe
                im[i + k] = uIm + vIm
                re[i + k + (len >> 1)] = uRe - vRe
                im[i + k + (len >> 1)] = uIm - vIm
                const nextRe = curRe * wRe - curIm * wIm
                curIm = curRe * wIm + curIm * wRe
                curRe = nextRe
            }
        }
    }
    if (inverse) {
        for (let i = 0; i < n; i += 1) {
            re[i] /= n
            im[i] /= n
        }
    }
}

export interface DereverbOptions {
    /** Assumed room decay time. The one parameter that carries the physics. */
    t60Sec?: number
    /**
     * Gap between the frame being cleaned and the frame used as the reverberation
     * estimate — i.e. how much of the response counts as "direct + early" and is
     * kept. Too small and the estimator eats the note's own attack.
     */
    lateStartSec?: number
    /** Over-subtraction factor. >1 removes more tail at the cost of the direct sound. */
    alpha?: number
    /** Gain floor (linear). Stops the classic musical-noise artefact. */
    gainFloor?: number
    /** STFT frame length in samples (power of two). */
    frameSize?: number
}

/**
 * Suppress late reverberation in `samples`. Returns a new array of the same
 * length, so the caller's timeline (and every note time derived from it) is
 * unchanged — the whole point of doing this rather than a time-domain filter.
 */
export function dereverb(samples: Float32Array, sampleRate: number, opts: DereverbOptions = {}): Float32Array {
    const t60 = opts.t60Sec ?? 0.8
    const lateStartSec = opts.lateStartSec ?? 0.048
    const alpha = opts.alpha ?? 1
    const gainFloor = opts.gainFloor ?? 0.1
    const frameSize = opts.frameSize ?? 512
    const hop = frameSize >> 2 // 75 % overlap — Hann sums to a constant
    if (samples.length < frameSize * 2) return samples.slice()

    const bins = (frameSize >> 1) + 1
    const window = new Float64Array(frameSize)
    for (let i = 0; i < frameSize; i += 1) {
        window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / frameSize)
    }

    const nFrames = Math.floor((samples.length - frameSize) / hop) + 1
    // Magnitude-squared spectrogram, kept so frame t can look back at frame t−L.
    const power = new Float32Array(nFrames * bins)
    const specRe = new Float32Array(nFrames * bins)
    const specIm = new Float32Array(nFrames * bins)

    const re = new Float64Array(frameSize)
    const im = new Float64Array(frameSize)
    for (let t = 0; t < nFrames; t += 1) {
        const start = t * hop
        for (let i = 0; i < frameSize; i += 1) {
            re[i] = samples[start + i] * window[i]
            im[i] = 0
        }
        fft(re, im, false)
        for (let k = 0; k < bins; k += 1) {
            const r = re[k]
            const m = im[k]
            specRe[t * bins + k] = r
            specIm[t * bins + k] = m
            power[t * bins + k] = r * r + m * m
        }
    }

    // δ from the assumed T60, and the attenuation over the early/late gap.
    const lateFrames = Math.max(1, Math.round((lateStartSec * sampleRate) / hop))
    const delta = (3 * Math.LN10) / t60
    const attenuation = Math.exp((-2 * delta * lateFrames * hop) / sampleRate)

    const out = new Float32Array(samples.length)
    const norm = new Float32Array(samples.length)
    for (let t = 0; t < nFrames; t += 1) {
        const off = t * bins
        const pastOff = (t - lateFrames) * bins
        for (let k = 0; k < bins; k += 1) {
            let gain = 1
            if (t >= lateFrames) {
                const px = power[off + k]
                const lam = attenuation * power[pastOff + k]
                gain = px > 0 ? Math.sqrt(Math.max(0, 1 - (alpha * lam) / px)) : 1
                if (gain < gainFloor) gain = gainFloor
            }
            re[k] = specRe[off + k] * gain
            im[k] = specIm[off + k] * gain
            // Hermitian mirror so the inverse transform is real.
            if (k > 0 && k < bins - 1) {
                re[frameSize - k] = re[k]
                im[frameSize - k] = -im[k]
            }
        }
        fft(re, im, true)
        const start = t * hop
        for (let i = 0; i < frameSize; i += 1) {
            out[start + i] += re[i] * window[i]
            norm[start + i] += window[i] * window[i]
        }
    }
    for (let i = 0; i < out.length; i += 1) {
        if (norm[i] > 1e-8) out[i] /= norm[i]
        else out[i] = samples[i]
    }
    return out
}

/** A named front end, so the variant cache can key on it. */
export interface AudioFrontEnd {
    id: string
    apply(samples: Float32Array, sampleRate: number): Float32Array
}

export function dereverbFrontEnd(id: string, opts: DereverbOptions): AudioFrontEnd {
    return {
        id,
        apply: (samples, sampleRate) => dereverb(samples, sampleRate, opts),
    }
}
