/**
 * A deliberately dumb sinusoid tracker: framewise FFT, pick the strongest peak
 * in a band, interpolate it, gate on tonality. No model, no HMM, no learned
 * anything.
 *
 * 🔴 Why this exists, and the trap it must not fall into. Whistling has no
 * note-annotated corpus anywhere (research/research-whistle-corpus.md), so the only route
 * to whistle truth is to annotate audio ourselves. Annotating from scratch is
 * hours per minute of audio; annotating a *draft* is minutes. This produces that
 * draft — and it is written to be from a different algorithm family than
 * anything the product ships (CREPE / basic-pitch are CNNs; the note layer is a
 * Viterbi HMM), because ground truth derived from a sibling of the estimator
 * makes a better estimator measure worse. That is gate 3 in
 * research/research-voice-datasets.md §0, and it has already bitten us once (mir-qbsh).
 *
 * The trap: if the harness ever ships the whistle-specific FFT peak tracker
 * that the README's open directions list, this drafter becomes its sibling and
 * every un-corrected draft label silently turns into self-measurement. Draft
 * labels are therefore marked `verifiedBy: null` and the dataset they build is
 * flagged `noteTruthDerived` until a human has signed off on every clip.
 *
 * Whistling is the one signal where this is nearly fair anyway: it is a single
 * near-sinusoidal partial 15–30 dB above everything else in the spectrum, so
 * "strongest peak in 0.4–5 kHz" is not an estimate so much as a reading.
 */

/** One analysis frame's reading. `hz` is undefined where the frame is unvoiced. */
export interface SineFrame {
    timeSec: number
    hz?: number
    /** Fraction of the frame's spectral energy inside the peak's three bins. */
    tonality: number
    /** Frame RMS relative to the clip's loudest frame. */
    level: number
}

export interface SineTrackOptions {
    /** FFT size in samples. 2048 @ 44.1 kHz = 46 ms — long enough to resolve a whistle. */
    fftSize?: number
    /** Hop between frames, seconds. */
    hopSec?: number
    /** Search band for the peak. Defaults span the human whistling range. */
    minHz?: number
    maxHz?: number
    /** Peak-energy fraction below which a frame is called unvoiced. */
    minTonality?: number
    /** Frame level (relative to the clip's peak frame) below which it is unvoiced. */
    minLevel?: number
}

const DEFAULTS = {
    fftSize: 2048,
    hopSec: 0.01,
    minHz: 400,
    maxHz: 5000,
    minTonality: 0.35,
    minLevel: 0.06,
} as const

/** In-place iterative radix-2 FFT. `re`/`im` must be a power-of-two length. */
function fft(re: Float64Array, im: Float64Array): void {
    const n = re.length
    for (let i = 1, j = 0; i < n; i += 1) {
        let bit = n >> 1
        for (; j & bit; bit >>= 1) j ^= bit
        j ^= bit
        if (i < j) {
            ;[re[i], re[j]] = [re[j], re[i]]
            ;[im[i], im[j]] = [im[j], im[i]]
        }
    }
    for (let len = 2; len <= n; len <<= 1) {
        const ang = (-2 * Math.PI) / len
        const wRe = Math.cos(ang)
        const wIm = Math.sin(ang)
        for (let i = 0; i < n; i += len) {
            let curRe = 1
            let curIm = 0
            for (let k = 0; k < len / 2; k += 1) {
                const uRe = re[i + k]
                const uIm = im[i + k]
                const vRe = re[i + k + len / 2] * curRe - im[i + k + len / 2] * curIm
                const vIm = re[i + k + len / 2] * curIm + im[i + k + len / 2] * curRe
                re[i + k] = uRe + vRe
                im[i + k] = uIm + vIm
                re[i + k + len / 2] = uRe - vRe
                im[i + k + len / 2] = uIm - vIm
                const nextRe = curRe * wRe - curIm * wIm
                curIm = curRe * wIm + curIm * wRe
                curRe = nextRe
            }
        }
    }
}

/**
 * Track the strongest in-band sinusoid frame by frame.
 *
 * The peak bin is refined by parabolic interpolation on the log-magnitude
 * spectrum (the standard correction: a Hann-windowed sinusoid's log magnitude is
 * very nearly parabolic across its three loudest bins), which takes the
 * resolution from ±21 Hz at 2048/44.1 kHz to a couple of Hz — well inside a
 * semitone anywhere in the whistling range.
 */
export function trackSinusoid(samples: Float32Array, sampleRate: number, opts: SineTrackOptions = {}): SineFrame[] {
    const o = { ...DEFAULTS, ...opts }
    const n = o.fftSize
    const hop = Math.max(1, Math.round(o.hopSec * sampleRate))
    const window = new Float64Array(n)
    for (let i = 0; i < n; i += 1) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1))

    const minBin = Math.max(1, Math.floor((o.minHz * n) / sampleRate))
    const maxBin = Math.min(n / 2 - 2, Math.ceil((o.maxHz * n) / sampleRate))

    const frames: SineFrame[] = []
    const rms: number[] = []
    const re = new Float64Array(n)
    const im = new Float64Array(n)

    for (let start = 0; start + n <= samples.length; start += hop) {
        let energy = 0
        for (let i = 0; i < n; i += 1) {
            const s = samples[start + i]
            energy += s * s
            re[i] = s * window[i]
            im[i] = 0
        }
        fft(re, im)

        let total = 0
        let peakBin = minBin
        let peakMag = -1
        const mag = new Float64Array(maxBin + 2)
        for (let b = 1; b <= maxBin + 1; b += 1) {
            const m = re[b] * re[b] + im[b] * im[b]
            mag[b] = m
            total += m
            if (b >= minBin && b <= maxBin && m > peakMag) {
                peakMag = m
                peakBin = b
            }
        }

        // Log-magnitude parabolic interpolation around the peak bin.
        const l = Math.log(mag[peakBin - 1] + 1e-20)
        const c = Math.log(mag[peakBin] + 1e-20)
        const r = Math.log(mag[peakBin + 1] + 1e-20)
        const denom = l - 2 * c + r
        const delta = denom === 0 ? 0 : (0.5 * (l - r)) / denom
        const hz = ((peakBin + Math.max(-0.5, Math.min(0.5, delta))) * sampleRate) / n

        const tonality = total > 0 ? (mag[peakBin - 1] + mag[peakBin] + mag[peakBin + 1]) / total : 0
        const frameRms = Math.sqrt(energy / n)
        rms.push(frameRms)
        frames.push({ timeSec: start / sampleRate, hz, tonality, level: 0 })
    }

    const loudest = Math.max(1e-9, ...rms)
    for (let i = 0; i < frames.length; i += 1) {
        frames[i].level = rms[i] / loudest
        if (frames[i].tonality < o.minTonality || frames[i].level < o.minLevel) frames[i].hz = undefined
    }
    return frames
}

/** A drafted note: a run of frames that agreed on one semitone. */
export interface DraftNote {
    onsetSec: number
    durSec: number
    midi: number
    /** Mean cents deviation of the run from the semitone it was rounded to. */
    centsOffset: number
    /** Frames in the run — a one-frame "note" is noise, a 40-frame one is real. */
    frames: number
}

export interface SegmentDraftOptions {
    /** Runs shorter than this are dropped. */
    minNoteSec?: number
    /** Unvoiced runs no longer than this are bridged if both flanks agree. */
    maxDropoutSec?: number
    /** Frames of median smoothing applied to the f0 track before rounding. */
    medianFrames?: number
}

const SEG_DEFAULTS = { minNoteSec: 0.06, maxDropoutSec: 0.05, medianFrames: 5 } as const

/**
 * Group a tracked f0 contour into semitone notes.
 *
 * Median smoothing first, because a single octave-jumped or mistracked frame
 * inside a held note would otherwise split it in two — and a split note costs an
 * annotator more time to repair than a missing one.
 */
export function draftNotes(frames: SineFrame[], hopSec: number, opts: SegmentDraftOptions = {}): DraftNote[] {
    const o = { ...SEG_DEFAULTS, ...opts }
    const half = Math.floor(o.medianFrames / 2)
    const cents = frames.map((f) => (f.hz ? 1200 * Math.log2(f.hz / 440) + 6900 : undefined))

    const smoothed = cents.map((_, i) => {
        const win: number[] = []
        for (let j = i - half; j <= i + half; j += 1) {
            const v = cents[j]
            if (v !== undefined) win.push(v)
        }
        if (!win.length) return undefined
        win.sort((a, b) => a - b)
        return win[Math.floor(win.length / 2)]
    })

    const maxDropoutFrames = Math.round(o.maxDropoutSec / hopSec)
    const notes: DraftNote[] = []
    let runStart = -1
    let runMidi = 0
    let runCents: number[] = []
    let gap = 0

    const flush = (endIndex: number): void => {
        if (runStart < 0) return
        const durSec = (endIndex - runStart) * hopSec
        if (durSec >= o.minNoteSec) {
            const mean = runCents.reduce((a, b) => a + b, 0) / runCents.length
            notes.push({
                onsetSec: runStart * hopSec,
                durSec,
                midi: runMidi,
                centsOffset: Math.round(mean - runMidi * 100),
                frames: runCents.length,
            })
        }
        runStart = -1
        runCents = []
    }

    for (let i = 0; i < smoothed.length; i += 1) {
        const v = smoothed[i]
        if (v === undefined) {
            gap += 1
            if (gap > maxDropoutFrames) flush(i - gap + 1)
            continue
        }
        const midi = Math.round(v / 100)
        if (runStart >= 0 && midi === runMidi) {
            gap = 0
            runCents.push(v)
            continue
        }
        flush(gap > 0 ? i - gap : i)
        gap = 0
        runStart = i
        runMidi = midi
        runCents = [v]
    }
    flush(smoothed.length)
    return notes
}

/** What `whistleScreen` measured, so a keep/drop decision is always auditable. */
export interface WhistleScreen {
    keep: boolean
    reason: string
    /** Of the audible frames, the fraction dominated by a single partial. */
    tonalFraction: number
    /** Median f0 over those tonal frames, Hz (0 if there are none). */
    medianHz: number
    notes: number
    distinctPitches: number
}

/**
 * Is this clip actually a person whistling a melody?
 *
 * Needed because "whistling" as a *search term* returns steam locomotives,
 * stadium crowds, kettles, wind and shower heads — on Freesound's CC0 slice the
 * first 40 hits for `whistling` were mostly trains. Rather than curate by ear at
 * a scale nobody will sustain, screen on the property that makes whistling
 * whistling: essentially all of its energy is in one moving partial.
 *
 * Calibrated on 45 staged clips whose identity was known from title and from the
 * five hand-verified Commons files (research/research-whistle-corpus.md §3a). The
 * separation is not marginal:
 *
 *   real human whistling  tonalFraction 0.61 – 1.00  (Commons five: 0.61–0.86)
 *   wolf-whistle glide                     0.43
 *   trains / crowds / wind / shower head  ≤0.08
 *
 * so the 0.5 gate has ~0.1 of headroom on both sides. The note conditions catch
 * what tonality alone cannot: a single sustained tone scored 1.00 (a synth
 * "whistle" one-shot), and a wolf whistle is a glide, not a melody — both are
 * excluded by requiring several notes at two or more distinct pitches.
 *
 * Deliberate false negatives, both of which are the right call for a CLEAN tier:
 * whistling buried under street traffic (measured 0.08) and breathy whistling at
 * a very low level. Either could be worth a future adverse tier; neither can be
 * drafted reliably today.
 */
export function whistleScreen(samples: Float32Array, sampleRate: number): WhistleScreen {
    const MIN_TONAL_FRACTION = 0.5
    const MIN_HZ = 450
    const MAX_HZ = 4200
    const MIN_NOTES = 3
    const MIN_DISTINCT_PITCHES = 2

    const raw = trackSinusoid(samples, sampleRate, { minTonality: 0, minLevel: 0 })
    const audible = raw.filter((f) => f.level >= 0.1)
    const tonal = audible.filter((f) => f.tonality >= 0.8)
    const tonalFraction = audible.length ? tonal.length / audible.length : 0
    const hz = tonal.map((f) => f.hz ?? 0).sort((a, b) => a - b)
    const medianHz = hz.length ? hz[Math.floor(hz.length / 2)] : 0

    const notes = draftNotes(trackSinusoid(samples, sampleRate), 0.01)
    const distinctPitches = new Set(notes.map((n) => n.midi)).size

    const stats = { tonalFraction, medianHz, notes: notes.length, distinctPitches }
    if (tonalFraction < MIN_TONAL_FRACTION) {
        return {
            keep: false,
            reason: `tonalFraction ${tonalFraction.toFixed(2)} < ${MIN_TONAL_FRACTION} (not one dominant partial)`,
            ...stats,
        }
    }
    if (medianHz < MIN_HZ || medianHz > MAX_HZ) {
        return { keep: false, reason: `median ${Math.round(medianHz)} Hz outside ${MIN_HZ}–${MAX_HZ}`, ...stats }
    }
    if (notes.length < MIN_NOTES) {
        return { keep: false, reason: `${notes.length} notes < ${MIN_NOTES} (a one-shot, not a phrase)`, ...stats }
    }
    if (distinctPitches < MIN_DISTINCT_PITCHES) {
        return { keep: false, reason: `${distinctPitches} distinct pitch (a sustained tone or a glide, not a melody)`, ...stats }
    }
    return { keep: true, reason: 'whistled phrase', ...stats }
}

/**
 * YIN-style autocorrelation f0 tracker — the drafter for HARMONIC-RICH sources.
 *
 * `trackSinusoid` reads the strongest spectral peak, which is the right
 * instrument for a whistle (one partial) and the wrong one for a hum, where the
 * strongest peak is often the 2nd or 3rd harmonic and the three-bin `tonality`
 * gate rejects most frames. YIN (de Cheveigné & Kawahara 2002: cumulative-mean
 * normalised difference function, absolute threshold, parabolic refinement)
 * finds the period of the whole waveform instead. It shares nothing with the
 * pipeline's CREPE decode, so a truth drafted from it stays independent of the
 * estimator under test — the same reason `trackSinusoid` exists. Output is in
 * `SineFrame` shape (`tonality` carries YIN's periodicity, 1 − d′) so
 * `draftNotes` and the aligner consume either tracker unchanged.
 */
export function trackYin(samples: Float32Array, sampleRate: number, opts: SineTrackOptions & { threshold?: number } = {}): SineFrame[] {
    const minHz = opts.minHz ?? 70
    const maxHz = opts.maxHz ?? 1000
    const hopSec = opts.hopSec ?? 0.01
    const threshold = opts.threshold ?? 0.15
    const minTonality = opts.minTonality ?? 0.5
    const minLevel = opts.minLevel ?? 0.05
    const maxLag = Math.ceil(sampleRate / minHz)
    const minLag = Math.max(2, Math.floor(sampleRate / maxHz))
    const win = maxLag * 2
    const hop = Math.max(1, Math.round(hopSec * sampleRate))

    const frames: SineFrame[] = []
    const d = new Float64Array(maxLag + 1)
    let peakLevel = 0
    for (let start = 0; start + win <= samples.length; start += hop) {
        let energy = 0
        for (let i = 0; i < win; i += 1) energy += samples[start + i] * samples[start + i]
        const level = Math.sqrt(energy / win)
        if (level > peakLevel) peakLevel = level

        // Difference function over the first half of the window, for every lag.
        const half = maxLag
        d[0] = 0
        let running = 0
        let best = -1
        let bestVal = Infinity
        for (let tau = 1; tau <= maxLag; tau += 1) {
            let acc = 0
            for (let i = 0; i < half; i += 1) {
                const diff = samples[start + i] - samples[start + i + tau]
                acc += diff * diff
            }
            d[tau] = acc
            running += acc
            const cmnd = running > 0 ? (acc * tau) / running : 1
            d[tau] = cmnd
            if (tau >= minLag) {
                // First dip under the threshold wins (the fundamental, not a sub-multiple);
                // otherwise keep the global minimum as a fallback candidate.
                if (cmnd < threshold) {
                    // walk down to the local minimum
                    let t = tau
                    while (t + 1 <= maxLag) {
                        let acc2 = 0
                        for (let i = 0; i < half; i += 1) {
                            const diff = samples[start + i] - samples[start + i + t + 1]
                            acc2 += diff * diff
                        }
                        const next = running + acc2 > 0 ? (acc2 * (t + 1)) / (running + acc2) : 1
                        if (next >= d[t]) break
                        running += acc2
                        d[t + 1] = next
                        t += 1
                    }
                    best = t
                    bestVal = d[t]
                    break
                }
                if (cmnd < bestVal) {
                    bestVal = cmnd
                    best = tau
                }
            }
        }
        let hz: number | undefined
        if (best > minLag && best < maxLag) {
            // Parabolic interpolation around the minimum.
            const a = d[best - 1]
            const b = d[best]
            const c = d[best + 1] || b
            const denom = a - 2 * b + c
            const shift = denom !== 0 ? (0.5 * (a - c)) / denom : 0
            hz = sampleRate / (best + shift)
        }
        const periodicity = 1 - Math.min(1, bestVal)
        frames.push({ timeSec: start / sampleRate, hz, tonality: periodicity, level })
    }
    for (const f of frames) {
        f.level = peakLevel > 0 ? f.level / peakLevel : 0
        if (f.tonality < minTonality || f.level < minLevel) f.hz = undefined
    }
    return frames
}
