/**
 * Blind reverberance of a take — a pure signal measurement beside `scanPitch`.
 * `ProfileResolver` reads it to relax the voicing gate (`applyReverb`) and to
 * ramp the sustained-instrument onset dip back toward the detector's default.
 */

import { envNumber } from '../env'
import { OnsetDetector } from '../onset-detector'

function clamp(x: number, lo: number, hi: number): number {
    return Math.max(lo, Math.min(hi, x))
}

/**
 * `dipDepth` anchors for the reverberance ramp: the measured medians of the
 * clean (0.34) and reverberant (0.50–0.55) halves of the corpus. Below the low
 * anchor a take is treated as dry, above the high anchor as fully reverberant,
 * and in between the relief is applied proportionally — a graded response,
 * because the feature is only weakly separating (see `estimateReverberance`) and
 * a hard threshold would mean applying the full relief to false positives.
 */
const REVERB_DIP_DRY = envNumber('RECORDING_REVERB_DIP_DRY', 0.36)
const REVERB_DIP_WET = envNumber('RECORDING_REVERB_DIP_WET', 0.52)
/**
 * Minimum envelope modulation (coefficient of variation over above-silence
 * frames) for the fill measurement to mean anything.
 *
 * `dipDepth` reads "the quiet moments sit close to the loud ones". A signal with
 * essentially NO dynamic variation — a synthesized steady tone, a sustained
 * drone, a test fixture — satisfies that trivially and would otherwise be scored
 * maximally reverberant. This is the same trap `PitchScan` already guards for
 * `snrDb` ("absence of quiet frames is not evidence of noise"), and it needs the
 * same answer: absence of dips is not evidence of FILLED dips.
 *
 * 0.15 is far below anything real. Measured over all 1,282 clip/condition pairs
 * of the real corpus the minimum modulation is 0.195 (p1 = 0.233), so the guard
 * never fires on real material; a constant-amplitude synthetic tone measures
 * 0.027.
 */
const REVERB_MIN_MODULATION = envNumber('RECORDING_REVERB_MIN_MODULATION', 0.15)

/**
 * Blind reverberance of a take, 0 (dry) … 1 (heavily reverberant), from the
 * amplitude envelope alone.
 *
 * ## Why reverb needs its own signal, and why it is this one
 *
 * `PitchScan` already measures `snrDb` and `noisiness`, and neither one sees
 * reverberation: over 197 reverberant singing clips paired against their own
 * clean takes, `noisiness` did not move at all (0.00 → 0.00) and `snrDb` fell
 * only 23.7 → 17.8 dB, catching 25 % of reverberant takes at a 10 % false-
 * positive rate. That is unsurprising — both are built to find an ADDITIVE,
 * roughly stationary interferer, and reverberation is a delayed copy of the
 * signal itself.
 *
 * What reverberation does do is FILL IN the quiet moments: the tail of each note
 * covers the gaps and the decays, so the envelope's floor rises toward its peak.
 * `dipDepth` — the median above-silence envelope level as a fraction of the
 * clip's peak — measures exactly that, and it moved 0.340 → 0.498 (echoey-room)
 * and 0.346 → 0.549 (distant-mic) on the same clips, the best separation of the
 * four candidates measured (`scripts/eval/sweep-reverb.ts`, MODE=diagnose).
 *
 * It is still far from a clean detector (46 % / 70 % of reverberant takes past
 * the clean p90), which is why the caller applies it as a RAMP rather than a
 * switch: a weak signal used proportionally is worth much more than the same
 * signal used as a binary gate.
 */
export function estimateReverberance(samples: Float32Array, sampleRate: number): number {
    const env = new OnsetDetector().envelope(samples, sampleRate)
    if (env.length < 20) return 0
    let peak = 0
    for (const v of env) peak = Math.max(peak, v)
    if (peak <= 0) return 0
    // Frames above the silence floor only — trailing/leading silence would
    // otherwise drag the median down and read as a dry room.
    const loud: number[] = []
    for (const v of env) if (v > peak * 0.08) loud.push(v)
    if (loud.length < 8) return 0

    // A take with no dynamic variation has no dips for a room to fill, so its
    // fill ratio carries no information — see REVERB_MIN_MODULATION.
    const mu = loud.reduce((a, b) => a + b, 0) / loud.length
    if (mu <= 0) return 0
    const sd = Math.sqrt(loud.reduce((s, v) => s + (v - mu) ** 2, 0) / loud.length)
    if (sd / mu < REVERB_MIN_MODULATION) return 0

    loud.sort((a, b) => a - b)
    const dipDepth = loud[loud.length >> 1] / peak
    return clamp((dipDepth - REVERB_DIP_DRY) / (REVERB_DIP_WET - REVERB_DIP_DRY), 0, 1)
}
