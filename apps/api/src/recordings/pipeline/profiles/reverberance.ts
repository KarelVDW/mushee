/**
 * Blind reverberance of a take — a pure signal measurement beside `scanPitch`.
 * `ProfileResolver` reads it to relax the voicing gate (`applyReverb`) and to
 * ramp the sustained-instrument onset dip back toward the detector's default.
 *
 * `ReverbDecodeAdaptation` is the decode-side counterpart (built off): it reads
 * the take's own trajectory (`PitchTrack.reverbEvidence`) instead of the
 * envelope's fill.
 */

import { envFlag, envNumber } from '../env'
import { OnsetDetector } from '../onset-detector'
import type { ReverbEvidence } from '../pitch-track'

function clamp(x: number, lo: number, hi: number): number {
    return Math.max(lo, Math.min(hi, x))
}

/** What `ReverbDecodeAdaptation.decide` hands the segmenters for one take. */
export interface ReverbDecision {
    /** The voicing gate the segmenter / voice decoder runs with. */
    gate: number
    /** Set when the instrument onset back-extension applies (frames of real `windowSec`). */
    backExtend?: { minConfidence: number; maxFrames: number }
}

/**
 * Decode-side reverb adaptations, both BUILT OFF (env opt-in; neither passed its
 * 2026-11 confirmation, see the numbers below), decided per take
 * from the take's own CREPE trajectory — the evidence the 2026-11-01 regenerated
 * adverse tier showed actually separates rooms from dry takes, where the
 * resolver's `dipDepth` does not (see `PitchTrack.reverbEvidence`).
 *
 * Decode-side on purpose: the stored track and profile are untouched, so the eval
 * harness's cached replay (`scripts/eval/lib/decodeCached.ts`) runs this exact
 * class on the cached track and reproduces production note for note.
 *
 * ## 1. Confidence-relative voicing gate (ADV-H2) — `RECORDING_CONF_RELATIVE_GATE=1`
 *
 *     gate = min(profile gate, max(FLOOR, BASE − SLOPE · max(0, KNEE − confMed)))
 *
 * A take whose loud frames CREPE hears with median confidence at or above KNEE
 * keeps its profile's gate exactly; below it the gate is lowered in proportion,
 * never under FLOOR and never raised. A take whose level still falls
 * `_DRY_DROP_DB` (default 12) in 100 ms is not in a room — its low confidence is
 * noise or breath — and keeps its gate too. `_MODE=replace` drops the profile's
 * own reverb relief (`applyReverb`, triggered by `dipDepth`) and uses this rule
 * alone against the band anchor BASE (0.5 on every band; the noisy-take bump
 * ships at 0); with `_SLOPE=0` it is an exact decode-side replay of
 * `RECORDING_REVERB_CONF_RELIEF=0` (862/862 dev clip×conditions identical to the
 * per-env cache build).
 *
 * Measured 2026-11-01 on the regenerated adverse tier (`benchmark.ts run --cached
 * --split dev`, all conditions, 1,372 clip×conditions; Δ of the mean of dataset
 * means, paired bootstrap over performances, `*` = 95 % CI excludes 0), defaults
 * (KNEE 0.85, SLOPE 2, FLOOR 0.20, DRY_DROP_DB 12, min):
 *
 *     ALL +0.010* [+0.005, +0.014]   human-truth +0.011*   singing +0.008*
 *     instrument +0.013*   whistling +0.002*   real condition only +0.003 (n.s.)
 *     echoey / distant:  voice +0.045* / +0.055*   plucked +0.009 / +0.025*
 *                        sustained +0.019* / +0.023*
 *
 * Clean takes: every human singing set within ±0.001 on `real`; the only dataset
 * below −0.005 is urmp-contrabass (one dev take, −0.019). Without the dry veto the
 * gate cost app-takes-singing −0.007…−0.012 (two dry, noisy takes); `replace` is
 * never better than `min` and costs clean takes (vocadito −0.006, app-takes-singing
 * −0.014*): the dipDepth relief is blind on correct audio (voice AUC 0.47/0.46) but
 * NOT inert — removing it costs AVS reverb −0.028* / −0.027* and vocadito clean
 * −0.009*, because a lower gate on a random half of the takes is still a lower gate.
 * Knee 0.82…0.88 × slope 1.5…3 all land at ALL +0.007…+0.013; 0.85/2 lowers the
 * gate on the fewest clean takes (10 %). Streaming: the 1.5 s frozen prefix keeps
 * +0.009 of the +0.010 (ALL). On L0b's measured-RIR tier (Arni rooms, dev): ALL
 * +0.018*, voice rir-near / rir-far +0.027* / +0.060*, every instrument row ≥ 0.
 * Realistic synthetic corpus (exact truth, mild measured rooms, both parts on):
 * studio −0.000, room +0.001, home-phone +0.002, all n.s.
 *
 * **Final 2026-11 harness (grid/tempo corrections in): dev unchanged, ALL +0.010
 * [+0.005, +0.014]. The one test look: ALL +0.0057 [+0.005, +0.007]** (0.680 →
 * 0.686), human +0.006, singing +0.008, instrument +0.005; voice echoey / distant
 * +0.046 / +0.063, plucked +0.005 / +0.045, sustained +0.006 / +0.012; no pooled
 * `real` row below −0.005 (AVS real +0.007, outside the ±0.003 band on the good
 * side). **Measured-RIR tier, test half** (vs `grid-fixed-rir`): ALL +0.012
 * [+0.008, +0.016]; voice rir-near / rir-far +0.022 / +0.071, sustained +0.007 /
 * +0.006, plucked rir-far +0.016 — but **plucked rir-near −0.004 [−0.010, +0.002]**
 * (GuitarSet, n.s.). The pre-registered rule was a positive sign in every
 * condition × family cell of the measured rooms, so it stays BUILT OFF on that
 * one cell: an owner call. Stacked with the shipped onset shift and gap bridge
 * (and the whistle family) on test it adds about +0.004 ALL.
 *
 * ## 2. Instrument onset back-extension (ADV-H3, instrument part) — `RECORDING_INSTR_ONSET_BACKEXTEND=1`
 *
 * On a NON-voice take that reads reverberant (P95 100-ms level drop under
 * `_MAX_DROP_DB` AND confMed under `_MAX_CONF_MED`), each raw note's start moves
 * back over the sub-gate frames already at its pitch (`PitchTrack.backExtendOnsets`).
 * Ungated it costs dry plucked/sustained takes (a note's own pre-attack noise at
 * pitch), hence the take-level gate. Both features are measured on the trajectory
 * grid (20 ms; the adverse lane's 10 ms-envelope drop separates the same way).
 *
 * Measured 2026-11-01 (same protocol as above), defaults (MAX_DROP_DB 10,
 * MAX_CONF_MED 0.87, CONF 0.15, WINDOW_SEC 0.15):
 *
 *     alone:            ALL +0.005*  instrument +0.010*  real only +0.003*
 *                       plucked echoey/distant +0.014 / +0.037*, sustained +0.010* / +0.028*
 *     on top of (1):    ALL +0.002*  instrument +0.004*  plucked +0.012 / +0.016*,
 *                       sustained +0.001 / +0.021*; clean GuitarSet −0.001, URMP ≥ 0
 *     both vs neither:  ALL +0.012* [+0.007, +0.016]  human +0.014*  instrument +0.017*
 *     measured RIRs, on top of (1): plucked rir-near / rir-far +0.004* / +0.009*,
 *                       sustained +0.006 / −0.002
 *
 * It fires on 18 % of clean GuitarSet + URMP dev takes (5/25, 4/24; whistles 6/82,
 * TinySOL 0/30) — sustained / legato takes that read like a room — without a clean
 * cost; a stricter gate (6 dB / 0.85, 1/49) keeps about half of the instrument
 * gain (alone +0.005* vs +0.010*).
 *
 * Re-checked on the final 2026-11 harness, where GuitarSet is re-cut on its click
 * (dev, on top of (1)): reverb rows still +0.012 (plucked +0.016 / +0.010,
 * sustained +0.001 / +0.021), but **clean GuitarSet −0.004 [−0.011, +0.000]**
 * (2 of 25 takes, −0.022 / −0.077) — below its ≥ −0.002 clean bar, so it got no
 * test look and stays BUILT OFF.
 *
 * ## Streaming
 *
 * The provider measures the evidence on every pass until `_FREEZE_SEC` of loud
 * audio exist, then freezes it for the rest of the take; the FINAL pass measures
 * the whole take again. When the final decision differs from one an earlier pass
 * used, the pipeline discards the notes committed under it and rebuilds the score
 * from the final pass (`RecordingPipeline`), so the final score is the whole-take
 * transcription the benchmark measures.
 */
export class ReverbDecodeAdaptation {
    constructor(
        private readonly relativeGate:
            | { knee: number; slope: number; floor: number; base: number; mode: 'min' | 'replace'; dryDropDb: number }
            | undefined,
        private readonly backExtend: { maxDropDb: number; maxConfMed: number; minConfidence: number; windowSec: number } | undefined,
        /** Seconds of loud audio after which a streaming session freezes its evidence. */
        readonly freezeSec: number,
    ) {}

    /** The adaptation the env selects; undefined when both parts are off (production). */
    static fromEnv(): ReverbDecodeAdaptation | undefined {
        const gateOn = envFlag('RECORDING_CONF_RELATIVE_GATE', false)
        const extendOn = envFlag('RECORDING_INSTR_ONSET_BACKEXTEND', false)
        if (!gateOn && !extendOn) return undefined
        return new ReverbDecodeAdaptation(
            gateOn
                ? {
                      knee: envNumber('RECORDING_CONF_RELATIVE_GATE_KNEE', 0.85),
                      slope: envNumber('RECORDING_CONF_RELATIVE_GATE_SLOPE', 2),
                      floor: envNumber('RECORDING_CONF_RELATIVE_GATE_FLOOR', 0.2),
                      base: 0.5,
                      mode: process.env.RECORDING_CONF_RELATIVE_GATE_MODE === 'replace' ? 'replace' : 'min',
                      dryDropDb: envNumber('RECORDING_CONF_RELATIVE_GATE_DRY_DROP_DB', 12),
                  }
                : undefined,
            extendOn
                ? {
                      maxDropDb: envNumber('RECORDING_INSTR_ONSET_BACKEXTEND_MAX_DROP_DB', 10),
                      maxConfMed: envNumber('RECORDING_INSTR_ONSET_BACKEXTEND_MAX_CONF_MED', 0.87),
                      minConfidence: envNumber('RECORDING_INSTR_ONSET_BACKEXTEND_CONF', 0.15),
                      windowSec: envNumber('RECORDING_INSTR_ONSET_BACKEXTEND_WINDOW_SEC', 0.15),
                  }
                : undefined,
            envNumber('RECORDING_CONF_RELATIVE_GATE_FREEZE_SEC', 1.5),
        )
    }

    /**
     * The gate and onset treatment for a take with this evidence.
     * @param profileGate the resolved profile's voicing gate
     * @param voice       whether the take is decoded by the voice decoder (the back-extension is instrument-only)
     * @param realHopSec  real seconds per track frame, to turn the back-extension window into frames
     */
    decide(evidence: ReverbEvidence, profileGate: number, voice: boolean, realHopSec: number): ReverbDecision {
        let gate = profileGate
        const rel = this.relativeGate
        // A take whose level can still fall `dryDropDb` in 100 ms is not in a room:
        // its low confidence is noise or breath, which a lower gate only turns into notes.
        if (rel && evidence.maxDropDb < rel.dryDropDb) {
            const relative = Math.max(rel.floor, rel.base - rel.slope * Math.max(0, rel.knee - evidence.confMed))
            gate = rel.mode === 'replace' ? Math.min(rel.base, relative) : Math.min(profileGate, relative)
        }
        const ext = this.backExtend
        const extend = ext && !voice && evidence.maxDropDb < ext.maxDropDb && evidence.confMed < ext.maxConfMed
        return {
            gate,
            ...(extend && { backExtend: { minConfidence: ext.minConfidence, maxFrames: Math.round(ext.windowSec / realHopSec) } }),
        }
    }
}

/** The decode-side reverb adaptation this process runs with (undefined = production: off). */
export const REVERB_DECODE_ADAPTATION = ReverbDecodeAdaptation.fromEnv()

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
