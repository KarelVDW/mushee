/**
 * SuperFlux-style spectral onset strength, for the voice flow's re-onset
 * problem (research/research-voice-transcription.md §3.2 — "the one untried idea").
 *
 * Why this exists: a same-pitch re-articulation ("la-la-la" on one note) is
 * invisible to a pitch decode by construction, and the findings log proves the
 * broadband RMS envelope cannot be thresholded into finding it either (missed
 * notes never move; splits explode). The literature's model-free answer is
 * band-wise spectral flux — a re-articulated consonant redistributes energy
 * ACROSS bands even when the total barely moves — applied selectively, only
 * inside notes that are already long and pitch-flat (the CREPE Notes pattern,
 * arXiv 2311.08884).
 *
 * The ODF is Böck & Widmer's SuperFlux reduced to our grid: STFT → log-spaced
 * triangular filterbank (quarter-tone-ish) → log magnitude → half-wave
 * rectified difference against the previous frame MAX-FILTERED ±1 band (the
 * designed vibrato suppressor: vibrato moves energy to a NEIGHBOURING band,
 * which the max filter forgives; a consonant changes the whole shape).
 *
 * Sidecar-cached beside the track cache (`<clip>.flux.bin`), keyed by its own
 * version byte — deliberately NOT part of TrackCache's blob, so experiments
 * here never invalidate the expensive model inference cache.
 */

import { existsSync, readFileSync, writeFileSync } from 'fs'

import { AudioDecoder } from '../../../src/recordings/pipeline/audio-decoder'
import type { CachedClip } from './trackCache'

/** Bump when the ODF computation changes meaning. */
const FLUX_VERSION = 1

const SAMPLE_RATE = 16000
const HOP_SEC = 0.01
const FFT_SIZE = 1024 // 64 ms at 16 kHz
const MIN_BAND_HZ = 27.5
const MAX_BAND_HZ = 7600
const BANDS_PER_OCTAVE = 24

export interface SpectralFlux {
    odf: Float32Array
    hopSec: number
}

/** In-place iterative radix-2 FFT (real input packed as interleaved complex). */
function fft(re: Float32Array, im: Float32Array): void {
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

/** Triangular filterbank over log-spaced centres; rows of (binIndex, weight). */
function filterbank(): { starts: Int32Array; weights: Float32Array[]; bands: number } {
    const centres: number[] = []
    for (let hz = MIN_BAND_HZ; hz <= MAX_BAND_HZ; hz *= Math.pow(2, 1 / BANDS_PER_OCTAVE)) {
        centres.push(hz)
    }
    const hzPerBin = SAMPLE_RATE / FFT_SIZE
    const starts = new Int32Array(centres.length)
    const weights: Float32Array[] = []
    let bands = 0
    for (let b = 1; b < centres.length - 1; b += 1) {
        const lo = centres[b - 1] / hzPerBin
        const mid = centres[b] / hzPerBin
        const hi = centres[b + 1] / hzPerBin
        const from = Math.max(1, Math.ceil(lo))
        const to = Math.min(FFT_SIZE / 2 - 1, Math.floor(hi))
        if (to < from) continue
        const w = new Float32Array(to - from + 1)
        for (let k = from; k <= to; k += 1) {
            w[k - from] = k <= mid ? (k - lo) / Math.max(1e-9, mid - lo) : (hi - k) / Math.max(1e-9, hi - mid)
        }
        starts[bands] = from
        weights.push(w)
        bands += 1
    }
    return { starts: starts.slice(0, bands), weights, bands }
}

const FB = filterbank()
const HANN = new Float32Array(FFT_SIZE).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1)))

/** The ODF itself: one value per 10 ms frame, ≥ 0, unnormalized. */
export function computeFlux(samples: Float32Array): Float32Array {
    const hop = Math.round(HOP_SEC * SAMPLE_RATE)
    const frames = Math.max(0, Math.floor((samples.length - FFT_SIZE) / hop) + 1)
    const odf = new Float32Array(frames)
    const re = new Float32Array(FFT_SIZE)
    const im = new Float32Array(FFT_SIZE)
    let prev = new Float32Array(FB.bands)
    const cur = new Float32Array(FB.bands)
    for (let f = 0; f < frames; f += 1) {
        const off = f * hop
        for (let i = 0; i < FFT_SIZE; i += 1) {
            re[i] = samples[off + i] * HANN[i]
            im[i] = 0
        }
        fft(re, im)
        for (let b = 0; b < FB.bands; b += 1) {
            const w = FB.weights[b]
            const start = FB.starts[b]
            let sum = 0
            for (let k = 0; k < w.length; k += 1) {
                const bin = start + k
                sum += w[k] * Math.hypot(re[bin], im[bin])
            }
            cur[b] = Math.log10(1 + sum)
        }
        if (f > 0) {
            let flux = 0
            for (let b = 0; b < FB.bands; b += 1) {
                // Max-filter the PREVIOUS frame ±1 band — vibrato's neighbour-band
                // wander is forgiven, a consonant's broadband reshape is not.
                const p = Math.max(prev[Math.max(0, b - 1)], prev[b], prev[Math.min(FB.bands - 1, b + 1)])
                const d = cur[b] - p
                if (d > 0) flux += d
            }
            odf[f] = flux
        }
        const tmp = prev
        prev = cur.slice()
        void tmp
    }
    return odf
}

const decoder = new AudioDecoder()

/**
 * Compute (or load) the clip's ODF sidecar. Async because decoding goes
 * through ffmpeg; run it as a pre-pass so the sweep's segment functions can
 * stay synchronous via `loadFlux`.
 */
export async function ensureFluxCache(c: CachedClip): Promise<void> {
    if (loadFlux(c)) return
    const wav = readFileSync(c.wavPath)
    const decoded = await decoder.decode(wav, SAMPLE_RATE, {
        loudnorm: false,
        highpassHz: 30,
    })
    const odf = computeFlux(decoded.samples)
    const blob = new Float32Array(odf.length + 1)
    blob[0] = FLUX_VERSION
    blob.set(odf, 1)
    writeFileSync(c.fluxPath, Buffer.from(blob.buffer, 0, blob.byteLength))
}

/** Sidecar loader; null when absent or from an older FLUX_VERSION. */
export function loadFlux(c: CachedClip): SpectralFlux | null {
    if (!existsSync(c.fluxPath)) return null
    const raw = readFileSync(c.fluxPath)
    const floats = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4)
    if (floats.length < 1 || floats[0] !== FLUX_VERSION) return null
    return { odf: floats.slice(1), hopSec: HOP_SEC }
}

export interface SpectralSplitOptions {
    /** Peak strength, as a fraction of the clip's strongest peak, that splits. */
    threshold: number
    /** Only notes at least this long are candidates. */
    minNoteSec: number
    /** Only notes whose voiced contour stays within ± this many cents. */
    flatCents: number
    /** No split inside this many seconds of a note's start / end. */
    guardStartSec?: number
    guardEndSec?: number
    /** Shortest fragment a split may produce. */
    minFragmentSec?: number
}

interface NoteLike {
    startTimeSeconds: number
    durationSeconds: number
    pitchMidi: number
    amplitude: number
}

/**
 * SuperFlux-style peak picking: a frame is a peak when it is the local max over
 * ±30 ms AND exceeds the local 100 ms/70 ms mean by a margin. Returns
 * `{timeSec, strength}` with strength normalized to the clip's strongest peak.
 */
export function pickPeaks(flux: SpectralFlux): { timeSec: number; strength: number }[] {
    const { odf, hopSec } = flux
    const preMax = Math.round(0.03 / hopSec)
    const preAvg = Math.round(0.1 / hopSec)
    const postAvg = Math.round(0.07 / hopSec)
    const raw: { timeSec: number; strength: number }[] = []
    for (let t = 1; t < odf.length - 1; t += 1) {
        let isMax = true
        for (let k = Math.max(0, t - preMax); k <= Math.min(odf.length - 1, t + preMax); k += 1) {
            if (odf[k] > odf[t]) {
                isMax = false
                break
            }
        }
        if (!isMax) continue
        let sum = 0
        let n = 0
        for (let k = Math.max(0, t - preAvg); k <= Math.min(odf.length - 1, t + postAvg); k += 1) {
            sum += odf[k]
            n += 1
        }
        const strength = odf[t] - sum / n
        if (strength <= 0) continue
        raw.push({ timeSec: t * hopSec, strength })
    }
    const top = raw.reduce((m, p) => Math.max(m, p.strength), 0)
    if (top <= 0) return []
    return raw.map((p) => ({ timeSec: p.timeSec, strength: p.strength / top }))
}

/**
 * The selective splitter: split long, pitch-flat notes at strong spectral
 * peaks strictly inside them. A splitter, never a creator — it can only cut
 * notes some other decode already found, which is what bounds its damage.
 */
export function splitAtSpectralPeaks<T extends NoteLike>(
    notes: T[],
    flux: SpectralFlux | null,
    track: { cents: Float32Array; confidence: Float32Array; frames: number; hopSec: number },
    confidenceThreshold: number,
    opts: SpectralSplitOptions,
): T[] {
    if (!flux || !notes.length) return notes
    const guardStart = opts.guardStartSec ?? 0.08
    const guardEnd = opts.guardEndSec ?? 0.06
    const minFragment = opts.minFragmentSec ?? 0.08
    const peaks = pickPeaks(flux).filter((p) => p.strength >= opts.threshold)
    if (!peaks.length) return notes

    const isFlat = (n: NoteLike): boolean => {
        const from = Math.max(0, Math.round(n.startTimeSeconds / track.hopSec))
        const to = Math.min(track.frames, Math.round((n.startTimeSeconds + n.durationSeconds) / track.hopSec))
        let sum = 0
        let sumSq = 0
        let count = 0
        for (let i = from; i < to; i += 1) {
            if (track.confidence[i] < confidenceThreshold) continue
            sum += track.cents[i]
            sumSq += track.cents[i] * track.cents[i]
            count += 1
        }
        if (count < 4) return false
        const mu = sum / count
        return Math.sqrt(Math.max(0, sumSq / count - mu * mu)) <= opts.flatCents
    }

    const out: T[] = []
    for (const note of notes) {
        if (note.durationSeconds < opts.minNoteSec || !isFlat(note)) {
            out.push(note)
            continue
        }
        const lo = note.startTimeSeconds + guardStart
        const hi = note.startTimeSeconds + note.durationSeconds - guardEnd
        const cuts = peaks
            .filter((p) => p.timeSec >= lo && p.timeSec <= hi)
            .map((p) => p.timeSec)
            .sort((a, b) => a - b)
        let cursor = note.startTimeSeconds
        const end = note.startTimeSeconds + note.durationSeconds
        for (const cut of cuts) {
            if (cut - cursor < minFragment || end - cut < minFragment) continue
            out.push({ ...note, startTimeSeconds: cursor, durationSeconds: cut - cursor })
            cursor = cut
        }
        out.push({ ...note, startTimeSeconds: cursor, durationSeconds: end - cursor })
    }
    return out
}
