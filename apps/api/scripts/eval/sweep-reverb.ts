/**
 * Reverberant / distant-mic audio: diagnosis and config sweep.
 *
 * Reverb is the largest untouched accuracy gap (see the README findings log): every other
 * adverse condition costs ~0.17 note-F1, echoey-room costs 0.42 and distant-mic
 * 0.57. Two fixes have already failed here (`afftdn` denoise — exactly neutral;
 * a Viterbi jump floor — within noise), both because they were aimed at a
 * *guessed* mechanism. This script exists so the mechanism is measured first.
 *
 * ## MODE=diagnose (default) — where does reverb take the accuracy from?
 *
 * Every degraded clip is paired with its own clean take (`degrade-real.ts` now
 * emits variants of identical length, so the two land on the same frame grid),
 * which makes a *substitution* ablation possible: run the segmenter on the
 * degraded trajectory but with one component swapped back to the clean take's.
 * Whichever swap restores the score is where the loss lives.
 *
 *   clean            clean cents, clean confidence, clean profile
 *   deg              all degraded — the number we are trying to explain
 *   deg+cleanCents   clean f0 trajectory, degraded voicing  → loss is in f0
 *   deg+cleanConf    degraded f0, clean voicing             → loss is in voicing
 *   deg+cleanTrack   both restored — the CEILING for any audio front end
 *   deg+cleanProf    degraded everything, clean profile     → loss is in routing
 *   deg+cleanOnsets  degraded everything, clean re-attacks  → loss is in onsets
 *
 * Alongside it: frame-level pitch agreement against the clean take (RPA at 50 ¢
 * and the octave-error rate), voicing recall/false-alarm rate, the profile
 * resolver's noise telemetry, and the OnsetDetector's re-attack counts — the
 * evidence needed to name a mechanism rather than assume one.
 *
 * ## MODE=sweep — does a candidate fix actually pay?
 *
 * Config sweep over everything downstream of the cached trajectory (segmenter
 * gates, cleanup steps, onset-detector thresholds), with a paired bootstrap CI
 * per acoustic condition. **The clean condition is reported for every config**,
 * because a reverb fix that costs clean audio is not a fix.
 *
 * ## MODE=frontend — the one family that needs re-inference
 *
 * Late-reverberation suppression (`lib/dereverb.ts`) applied to the decoded PCM
 * before the model, i.e. a candidate fix inside `AudioDecoder`. Each row costs a
 * CREPE pass per clip (cached per front-end id), so run it only if the
 * `deg+cleanTrack` oracle says a front end has room.
 *
 * Run:
 *   EVAL_SPLIT=dev npx tsx scripts/eval/sweep-reverb.ts
 *   EVAL_SPLIT=dev SWEEP_REVERB_MODE=sweep npx tsx scripts/eval/sweep-reverb.ts
 *   EVAL_SPLIT=dev SWEEP_REVERB_MODE=frontend npx tsx scripts/eval/sweep-reverb.ts
 * Env:
 *   SWEEP_REVERB_MODE=diagnose|sweep|frontend
 *   SWEEP_REVERB_DATASETS=annotated-vocalset,vocadito   (default: the trusted 3)
 *   SWEEP_REVERB_VARIANTS=echoey-room,distant-mic
 *   SWEEP_REVERB_ONLY=substr        sweep mode: filter configs by name
 *   SWEEP_REVERB_LIMIT=n            cap clips per dataset
 *   EVAL_SPLIT=dev|test|all
 *
 * Requires `degrade-real.ts` to have produced the variants. First run builds the
 * variant track cache (slow, once); everything after is seconds.
 *
 * ⚠ The cache stores the RESOLVED PROFILE, so it also stores whatever voicing
 * gate `ProfileResolver` chose. To re-measure the reverb relief this study
 * shipped, build the cache with `RECORDING_REVERB_CONF_RELIEF=0` so `baseline` is
 * the pre-change pipeline. The same applies to `scripts/fixtures/eval-cache/`
 * used by `ablate.ts` / `sweep-segmenter.ts`: it predates the change, so bump
 * `CACHE_VERSION` in `lib/trackCache.ts` (or delete that directory) before
 * trusting its absolute numbers again.
 */

import { readFileSync } from 'fs'
import { join, resolve } from 'path'

import { AudioDecoder } from '../../src/recordings/pipeline/audio-decoder'
import { NoteExtractor, type NoteExtractorOptions } from '../../src/recordings/pipeline/note-extractor'
import { OnsetDetector, type OnsetDetectorOptions } from '../../src/recordings/pipeline/onset-detector'
import type { PipelineProfile } from '../../src/recordings/pipeline/profiles/pipeline-profile'
import { estimateReverberance } from '../../src/recordings/pipeline/profiles/profile-resolver'
import { VOICE_OPTS } from '../../src/recordings/pipeline/providers/crepe-provider'
import { segmentNotes } from '../../src/recordings/pipeline/providers/pitch-decoder'
import { ProviderRegistry } from '../../src/recordings/pipeline/providers/provider-registry'
import { type VoiceDecodeOptions, VoiceNoteDecoder } from '../../src/recordings/pipeline/voice-note-decoder'
import { dereverbFrontEnd, type DereverbOptions } from './lib/dereverb'
import { type EstNote, scoreNotes } from './lib/metrics'
import { discoverRealDatasets, listRealClips, type RealDataset } from './lib/realCorpus'
import { inSplit, splitFromEnv } from './lib/split'
import { formatComparison, pairedDiffCI } from './lib/stats'
import { type CachedVariant, CLEAN_VARIANT, VariantTrackCache } from './lib/variantCache'
import type { TruthNote } from './types'

const REAL_ROOT = resolve(__dirname, '../fixtures/eval-real')
const CACHE_ROOT = resolve(__dirname, '../fixtures/eval-cache-variant')
const MODELS = {
    crepeTiny: resolve(process.cwd(), 'model-crepe-tiny'),
}

/**
 * mir-qbsh is excluded by default (README findings log: its note events are
 * manufactured by our own fetcher from frame pitch, so note-F1 on it scores our
 * label derivation, not the pipeline — and it carries no licence grant).
 */
const DEFAULT_DATASETS = ['annotated-vocalset', 'guitarset-solo', 'vocadito']
const DEFAULT_VARIANTS = ['echoey-room', 'distant-mic']
const ONSET_TOL = 0.1
const TIMING_TOL = 0.3
/** Frames within this many cents of each other count as the same pitch. */
const RPA_TOL_CENTS = 50

function envList(key: string, fallback: string[]): string[] {
    const raw = (process.env[key] ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    return raw.length ? raw : fallback
}

function mean(xs: number[]): number {
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0
}
function median(xs: number[]): number {
    if (!xs.length) return 0
    const s = [...xs].sort((a, b) => a - b)
    const m = s.length >> 1
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

function toEst(notes: { startTimeSeconds: number; durationSeconds: number; pitchMidi: number }[]): EstNote[] {
    return notes.map((n) => ({
        onsetSec: n.startTimeSeconds,
        durSec: n.durationSeconds,
        midi: n.pitchMidi,
    }))
}

/** Segmenter options for one clip, from its resolved profile plus overrides. */
export interface SegOverrides {
    confidenceThreshold?: number
    minFramesPerNote?: number
    smoothFrames?: number
    pitchBinToleranceCents?: number
}

function segmentFor(
    cents: Float32Array,
    confidence: Float32Array,
    frames: number,
    hopSec: number,
    profile: PipelineProfile,
    over: SegOverrides = {},
): ReturnType<typeof segmentNotes> {
    return segmentNotes(cents, confidence, frames, {
        // times are frame * hopSize / sampleRate, so this pair reproduces hopSec.
        hopSize: 1,
        sampleRate: 1 / hopSec,
        confidenceThreshold: over.confidenceThreshold ?? profile.confidenceThreshold ?? 0.5,
        minFreqHz: profile.minFreqHz,
        maxFreqHz: profile.maxFreqHz,
        minFramesPerNote: over.minFramesPerNote ?? profile.minFramesPerNote ?? 4,
        pitchBinToleranceCents: over.pitchBinToleranceCents ?? 50,
        mode: 'semitone',
        smoothFrames: over.smoothFrames ?? 4,
    })
}

/** The shipping post-processing for the trajectory path (AudioConverter.cleanupFor). */
const SHIPPING_EXTRACTOR: NoteExtractorOptions = {
    steps: { pitchOutliers: false, merge: false },
    adaptiveFloorFraction: 0.3,
}

/**
 * One end-to-end pass at the `clean` stage (segment + cleanup, times still in
 * real seconds — the detection ceiling, before any notation).
 */
function runPipeline(
    c: CachedVariant,
    opts: {
        cents?: Float32Array
        confidence?: Float32Array
        profile?: PipelineProfile
        onsetTimesSec?: number[]
        seg?: SegOverrides
        extractor?: NoteExtractorOptions
    } = {},
): { raw: EstNote[]; cleaned: EstNote[] } {
    const cents = opts.cents ?? c.track.cents
    const confidence = opts.confidence ?? c.track.confidence
    const frames = Math.min(cents.length, confidence.length, c.track.frames)
    const profile = opts.profile ?? c.profile
    const raw = segmentFor(cents, confidence, frames, c.track.hopSec, profile, opts.seg)
    const extractor = new NoteExtractor(opts.extractor ?? SHIPPING_EXTRACTOR)
    const cleaned = extractor.clean(raw, {
        bpm: 120,
        onsetTimesSec: opts.onsetTimesSec ?? c.onsetTimesSec,
    })
    return { raw: toEst(raw), cleaned: toEst(cleaned) }
}

interface ClipPair {
    ds: RealDataset
    clip: string
    clean: CachedVariant
    deg: CachedVariant
}

async function collectPairs(
    cache: VariantTrackCache,
    datasets: RealDataset[],
    variant: string,
    split: ReturnType<typeof splitFromEnv>,
    limit: number,
): Promise<ClipPair[]> {
    const pairs: ClipPair[] = []
    for (const ds of datasets) {
        let used = 0
        for (const clip of listRealClips(ds.dir)) {
            if (used >= limit) break
            if (!inSplit(ds.id, clip, split)) continue
            if (!VariantTrackCache.hasAudio(ds, clip, variant)) continue
            const clean = await cache.load(ds, clip, CLEAN_VARIANT)
            if (!clean) continue
            const deg = await cache.load(ds, clip, variant)
            if (!deg) continue
            pairs.push({ ds, clip, clean, deg })
            used += 1
        }
    }
    return pairs
}

// ---------------------------------------------------------------------------
// Frame-level agreement between a clip and its degraded twin
// ---------------------------------------------------------------------------

interface FrameAgreement {
    /** Frames compared (the common prefix). */
    frames: number
    /** Fraction of clean-voiced frames still voiced in the degraded take. */
    voicingRecall: number
    /** Degraded-voiced frames that were unvoiced when clean, over all frames. */
    falseVoicingRate: number
    /** Of frames voiced in BOTH: fraction within RPA_TOL_CENTS. */
    rpa: number
    /** Of frames voiced in BOTH: fraction off by ~an octave. */
    octaveRate: number
    /** Median |Δcents| on frames voiced in both. */
    medianAbsCents: number
    meanConfClean: number
    meanConfDeg: number
}

function frameAgreement(pair: ClipPair): FrameAgreement | null {
    const a = pair.clean
    const b = pair.deg
    const n = Math.min(a.track.frames, b.track.frames)
    if (n < 10) return null
    const thrA = a.profile.confidenceThreshold ?? 0.5
    const thrB = b.profile.confidenceThreshold ?? 0.5

    let cleanVoiced = 0
    let bothVoiced = 0
    let stillVoiced = 0
    let falseVoiced = 0
    let within = 0
    let octave = 0
    const absCents: number[] = []
    let sumConfA = 0
    let sumConfB = 0

    for (let i = 0; i < n; i += 1) {
        const va = a.track.confidence[i] >= thrA
        const vb = b.track.confidence[i] >= thrB
        sumConfA += a.track.confidence[i]
        sumConfB += b.track.confidence[i]
        if (va) cleanVoiced += 1
        if (va && vb) stillVoiced += 1
        if (!va && vb) falseVoiced += 1
        if (va && vb) {
            bothVoiced += 1
            const d = Math.abs(b.track.cents[i] - a.track.cents[i])
            absCents.push(d)
            if (d <= RPA_TOL_CENTS) within += 1
            else if (Math.abs(d - 1200) <= RPA_TOL_CENTS) octave += 1
        }
    }

    return {
        frames: n,
        voicingRecall: cleanVoiced ? stillVoiced / cleanVoiced : 0,
        falseVoicingRate: falseVoiced / n,
        rpa: bothVoiced ? within / bothVoiced : 0,
        octaveRate: bothVoiced ? octave / bothVoiced : 0,
        medianAbsCents: median(absCents),
        meanConfClean: sumConfA / n,
        meanConfDeg: sumConfB / n,
    }
}

// ---------------------------------------------------------------------------
// diagnose
// ---------------------------------------------------------------------------

const SUBSTITUTIONS = ['clean', 'deg', 'deg+cleanCents', 'deg+cleanConf', 'deg+cleanTrack', 'deg+cleanProf', 'deg+cleanOnsets'] as const
type Substitution = (typeof SUBSTITUTIONS)[number]

function runSubstitution(pair: ClipPair, which: Substitution): EstNote[] {
    const { clean, deg } = pair
    switch (which) {
        case 'clean':
            return runPipeline(clean).cleaned
        case 'deg':
            return runPipeline(deg).cleaned
        case 'deg+cleanCents':
            return runPipeline(deg, { cents: clean.track.cents }).cleaned
        case 'deg+cleanConf':
            return runPipeline(deg, { confidence: clean.track.confidence }).cleaned
        // Both halves of the trajectory restored, but the profile and the
        // amplitude-derived re-attacks left degraded — the ceiling for ANY audio
        // front end (dereverberation, denoise) that cleans the signal the model
        // sees and nothing else.
        case 'deg+cleanTrack':
            return runPipeline(deg, {
                cents: clean.track.cents,
                confidence: clean.track.confidence,
            }).cleaned
        case 'deg+cleanProf':
            return runPipeline(deg, { profile: clean.profile }).cleaned
        case 'deg+cleanOnsets':
            return runPipeline(deg, { onsetTimesSec: clean.onsetTimesSec }).cleaned
    }
}

/** Move every estimated note earlier by `sec` — a constant latency compensation. */
function shiftEarlier(notes: EstNote[], sec: number): EstNote[] {
    return notes.map((n) => ({ ...n, onsetSec: n.onsetSec - sec }))
}

interface ScoreRow {
    f1: number[]
    precision: number[]
    recall: number[]
    estN: number[]
    refN: number[]
    onsetBias: number[]
    offsetBias: number[]
    estDur: number[]
    refDur: number[]
}
const newScoreRow = (): ScoreRow => ({
    f1: [],
    precision: [],
    recall: [],
    estN: [],
    refN: [],
    onsetBias: [],
    offsetBias: [],
    estDur: [],
    refDur: [],
})

function recordScore(row: ScoreRow, ref: TruthNote[], est: EstNote[]): void {
    const m = scoreNotes(ref, est, { onsetTolSec: ONSET_TOL, timingTolSec: TIMING_TOL })
    row.f1.push(m.f1)
    row.precision.push(m.precision)
    row.recall.push(m.recall)
    row.estN.push(est.length)
    row.refN.push(ref.length)
    if (m.timing.matched > 0) {
        row.onsetBias.push(m.timing.onsetMedianMs)
        row.offsetBias.push(m.timing.offsetBiasMs)
    }
    row.estDur.push(median(est.map((n) => n.durSec)))
    row.refDur.push(median(ref.map((n) => n.durSec)))
}

async function diagnose(
    cache: VariantTrackCache,
    datasets: RealDataset[],
    variants: string[],
    split: ReturnType<typeof splitFromEnv>,
    limit: number,
): Promise<void> {
    for (const variant of variants) {
        const pairs = await collectPairs(cache, datasets, variant, split, limit)
        if (!pairs.length) {
            console.log(`\n### ${variant}: no clips (run degrade-real.ts?)`)
            continue
        }

        console.log(`\n${'='.repeat(94)}`)
        console.log(`=== ${variant} — ${pairs.length} clips, split=${split} ===`)
        console.log('='.repeat(94))

        // --- 1. Substitution ablation ------------------------------------------
        const rows: Record<string, ScoreRow> = {}
        for (const s of SUBSTITUTIONS) rows[s] = newScoreRow()
        for (const pair of pairs) {
            for (const s of SUBSTITUTIONS) {
                recordScore(rows[s], pair.clean.truth.notes, runSubstitution(pair, s))
            }
        }

        console.log(
            '\n-- substitution ablation (stage=clean, F1@0.1 vs ground truth) --\n' +
                'variant'.padEnd(17) +
                'F1'.padEnd(8) +
                'P'.padEnd(8) +
                'R'.padEnd(8) +
                'est/ref'.padEnd(13) +
                'medDur e/r'.padEnd(13) +
                'onsetMed'.padEnd(10) +
                'offsetBias'.padEnd(11) +
                'Δ vs deg',
        )
        const degF1 = rows['deg'].f1
        for (const s of SUBSTITUTIONS) {
            const r = rows[s]
            const cmp = pairedDiffCI(degF1, r.f1)
            console.log(
                s.padEnd(17) +
                    mean(r.f1).toFixed(3).padEnd(8) +
                    mean(r.precision).toFixed(3).padEnd(8) +
                    mean(r.recall).toFixed(3).padEnd(8) +
                    `${mean(r.estN).toFixed(1)}/${mean(r.refN).toFixed(1)}`.padEnd(13) +
                    `${mean(r.estDur).toFixed(2)}/${mean(r.refDur).toFixed(2)}`.padEnd(13) +
                    `${mean(r.onsetBias).toFixed(0)}ms`.padEnd(10) +
                    `${mean(r.offsetBias).toFixed(0)}ms`.padEnd(11) +
                    (s === 'deg' ? '—' : formatComparison(cmp)),
            )
        }

        // --- 1a. Onset-delta distribution -------------------------------------
        // A systematic bias and a widened scatter call for completely different
        // fixes, and the means in the table above cannot tell them apart. Pooled
        // over every correctly-pitched match within ±300 ms.
        const deltas = (which: 'clean' | 'deg'): number[] => {
            const all: number[] = []
            for (const pair of pairs) {
                const est = which === 'clean' ? runPipeline(pair.clean).cleaned : runPipeline(pair.deg).cleaned
                const m = scoreNotes(pair.clean.truth.notes, est, {
                    onsetTolSec: ONSET_TOL,
                    timingTolSec: TIMING_TOL,
                })
                all.push(...m.timing.onsetDeltasMs)
            }
            return all
        }
        console.log('\n-- onset error distribution (est − truth, ms; matched notes) --')
        const edges = [-Infinity, -100, -75, -50, -25, 0, 25, 50, 75, 100, Infinity]
        const labels = ['<-100', '-100', '-75', '-50', '-25', '0', '+25', '+50', '+75', '>+100']
        console.log('              ' + labels.map((l) => l.padStart(7)).join('') + '   median   |mean|')
        for (const which of ['clean', 'deg'] as const) {
            const ds = deltas(which)
            const bins = edges.slice(0, -1).map((lo, i) => ds.filter((d) => d >= lo && d < edges[i + 1]).length)
            const total = ds.length || 1
            console.log(
                (which === 'clean' ? 'clean       ' : `${variant.slice(0, 11)}`.padEnd(12)) +
                    '  ' +
                    bins.map((b) => `${((b / total) * 100).toFixed(0)}%`.padStart(7)).join('') +
                    `   ${median(ds).toFixed(0)}ms`.padStart(9) +
                    `   ${mean(ds.map(Math.abs)).toFixed(0)}ms`.padStart(8),
            )
        }

        // --- 1b. Constant onset-shift compensation ----------------------------
        // The single most actionable thing the ablation shows is a systematic
        // POSITIVE onset bias: reverb buries the direct attack under a wet tail, so
        // the trajectory only commits to the new pitch tens of ms late. If that
        // lateness is a constant, subtracting it is a fix that fits entirely inside
        // the decoder (an `atrim=start=` on the filter chain, exactly how afftdn's
        // 25 ms latency is already compensated). The clean column is the veto: a
        // shift big enough to help reverb must not move clean audio off its notes.
        const shiftsMs = [0, 20, 30, 40, 50, 60, 80, 100]
        const degEst = pairs.map((p) => runPipeline(p.deg).cleaned)
        const cleanEst = pairs.map((p) => runPipeline(p.clean).cleaned)
        const shiftScore = (ests: EstNote[][], ms: number): number[] =>
            ests.map(
                (est, i) =>
                    scoreNotes(pairs[i].clean.truth.notes, shiftEarlier(est, ms / 1000), {
                        onsetTolSec: ONSET_TOL,
                        timingTolSec: TIMING_TOL,
                    }).f1,
            )
        const degBase = shiftScore(degEst, 0)
        const cleanBase = shiftScore(cleanEst, 0)
        console.log('\n-- constant onset back-shift (is the lateness a constant?) --')
        console.log('shift'.padEnd(9) + `${variant} F1`.padEnd(13) + 'Δ'.padEnd(11) + 'clean F1'.padEnd(11) + 'Δ clean')
        for (const ms of shiftsMs) {
            const d = shiftScore(degEst, ms)
            const cl = shiftScore(cleanEst, ms)
            console.log(
                `${ms}ms`.padEnd(9) +
                    mean(d).toFixed(3).padEnd(13) +
                    (mean(d) - mean(degBase) >= 0 ? '+' : '') +
                    (mean(d) - mean(degBase)).toFixed(3).padEnd(10) +
                    mean(cl).toFixed(3).padEnd(11) +
                    (mean(cl) - mean(cleanBase) >= 0 ? '+' : '') +
                    (mean(cl) - mean(cleanBase)).toFixed(3),
            )
        }
        const bestMs = shiftsMs.reduce((a, b) => (mean(shiftScore(degEst, b)) > mean(shiftScore(degEst, a)) ? b : a), 0)
        if (bestMs > 0) {
            console.log(`  best shift ${bestMs}ms on ${variant}: ` + formatComparison(pairedDiffCI(degBase, shiftScore(degEst, bestMs))))
            console.log(`  same shift on clean audio:       ` + formatComparison(pairedDiffCI(cleanBase, shiftScore(cleanEst, bestMs))))
        }

        // --- 2. Frame-level agreement -----------------------------------------
        const agreements = pairs.map(frameAgreement).filter((a): a is FrameAgreement => a !== null)
        console.log('\n-- frame level, degraded vs its OWN clean take --')
        console.log(`  voicing recall (clean-voiced frames still voiced) ${mean(agreements.map((a) => a.voicingRecall)).toFixed(3)}`)
        console.log(`  false voicing (unvoiced->voiced, per frame)       ${mean(agreements.map((a) => a.falseVoicingRate)).toFixed(3)}`)
        console.log(`  RPA@50c on frames voiced in both                  ${mean(agreements.map((a) => a.rpa)).toFixed(3)}`)
        console.log(`  octave-error rate on those frames                 ${mean(agreements.map((a) => a.octaveRate)).toFixed(3)}`)
        console.log(`  median |Δcents| on those frames                   ${mean(agreements.map((a) => a.medianAbsCents)).toFixed(1)}`)
        console.log(
            `  mean confidence  clean ${mean(agreements.map((a) => a.meanConfClean)).toFixed(3)}  ->  degraded ${mean(agreements.map((a) => a.meanConfDeg)).toFixed(3)}`,
        )

        // --- 3. Onset detector -------------------------------------------------
        const onsetClean = pairs.map((p) => p.clean.onsetTimesSec.length)
        const onsetDeg = pairs.map((p) => p.deg.onsetTimesSec.length)
        const refN = pairs.map((p) => p.clean.truth.notes.length)
        console.log('\n-- OnsetDetector re-attacks (the amplitude-dip detector) --')
        console.log(
            `  mean onsets/clip   clean ${mean(onsetClean).toFixed(1)}  ->  degraded ${mean(onsetDeg).toFixed(1)}` +
                `   (truth notes ${mean(refN).toFixed(1)})`,
        )
        console.log(
            `  clips with ZERO detected onsets   clean ${onsetClean.filter((x) => x === 0).length}` +
                `  ->  degraded ${onsetDeg.filter((x) => x === 0).length}  of ${pairs.length}`,
        )
        console.log(
            `  envelope dip depth (min/peak over voiced span, median)  clean ` +
                `${median(pairs.map((p) => dipDepth(p.clean))).toFixed(3)}  ->  degraded ` +
                `${median(pairs.map((p) => dipDepth(p.deg))).toFixed(3)}`,
        )

        // --- 4. Profile resolution --------------------------------------------
        const bandOf = (c: CachedVariant): string => c.profile.id.replace(/\+.*/, '')
        const changedBand = pairs.filter((p) => bandOf(p.clean) !== bandOf(p.deg)).length
        const noisy = (c: CachedVariant): boolean => c.profile.id.includes('+noise')
        console.log('\n-- profile resolution --')
        console.log(
            `  band changed by the degradation   ${changedBand}/${pairs.length}` +
                `   (clean bands: ${summariseBands(pairs.map((p) => bandOf(p.clean)))};` +
                ` degraded: ${summariseBands(pairs.map((p) => bandOf(p.deg)))})`,
        )
        console.log(
            `  NOISY flag fires   clean ${pairs.filter((p) => noisy(p.clean)).length}` +
                `  ->  degraded ${pairs.filter((p) => noisy(p.deg)).length}  of ${pairs.length}` +
                '   (all its actions are no-ops today)',
        )
        console.log(
            `  median snrDb   clean ${median(pairs.map((p) => p.clean.scan.snrDb ?? NaN).filter(Number.isFinite)).toFixed(1)}` +
                `  ->  degraded ${median(pairs.map((p) => p.deg.scan.snrDb ?? NaN).filter(Number.isFinite)).toFixed(1)}` +
                `   |   median noisiness ${median(pairs.map((p) => p.clean.scan.noisiness)).toFixed(2)}` +
                ` -> ${median(pairs.map((p) => p.deg.scan.noisiness)).toFixed(2)}`,
        )
        console.log(
            `  median window   clean ${median(pairs.map((p) => p.clean.profile.minFreqHz)).toFixed(0)}-` +
                `${median(pairs.map((p) => p.clean.profile.maxFreqHz)).toFixed(0)}Hz  ->  degraded ` +
                `${median(pairs.map((p) => p.deg.profile.minFreqHz)).toFixed(0)}-` +
                `${median(pairs.map((p) => p.deg.profile.maxFreqHz)).toFixed(0)}Hz`,
        )

        // --- 5. Is reverb blind-detectable at all? -----------------------------
        const featsClean = pairs.map((p) => reverbFeatures(p.clean))
        const featsDeg = pairs.map((p) => reverbFeatures(p.deg))
        console.log('\n-- blind reverberance features (could a reverb-gated fix be dispatched?) --')
        const featureRows: [keyof ReverbFeatures, 'higher' | 'lower'][] = [
            ['modDepth', 'lower'],
            ['dipDepth', 'higher'],
            ['decayDb', 'higher'],
        ]
        for (const [key, dir] of featureRows) {
            const cl = featsClean.map((f) => f[key])
            const dg = featsDeg.map((f) => f[key])
            console.log(
                `  ${key.padEnd(10)} median clean ${median(cl).toFixed(3).padStart(7)}` +
                    ` -> degraded ${median(dg).toFixed(3).padStart(7)}   ` +
                    separability(cl, dg, dir),
            )
        }
        console.log(
            `  snrDb      median clean ${median(pairs.map((p) => p.clean.scan.snrDb ?? NaN).filter(Number.isFinite))
                .toFixed(3)
                .padStart(7)}` +
                ` -> degraded ${median(pairs.map((p) => p.deg.scan.snrDb ?? NaN).filter(Number.isFinite))
                    .toFixed(3)
                    .padStart(7)}   ` +
                separability(
                    pairs.map((p) => p.clean.scan.snrDb ?? NaN).filter(Number.isFinite),
                    pairs.map((p) => p.deg.scan.snrDb ?? NaN).filter(Number.isFinite),
                    'lower',
                ),
        )
    }
}

/** Median-normalised envelope trough depth: how far the audio dips between notes. */
function dipDepth(c: CachedVariant): number {
    const env = c.envelope
    if (env.length < 10) return 1
    let peak = 0
    for (const v of env) peak = Math.max(peak, v)
    if (peak <= 0) return 1
    // Over frames above the detector's own silence floor, the median normalised level.
    const loud: number[] = []
    for (const v of env) if (v > peak * 0.08) loud.push(v / peak)
    return loud.length ? median(loud) : 1
}

/**
 * Blind reverberance candidates, all from the 100 Hz RMS envelope the
 * `OnsetDetector` already builds — so any of them is free at runtime.
 *
 * This section exists because a reverb-specific fix is only shippable if reverb
 * is DETECTABLE without ground truth. The resolver's existing signals do not
 * do it (`noisiness` is flat, `snrDb` barely moves), so if none of these
 * separates either, a reverb-gated action is not implementable and the honest
 * answer is a global change or nothing.
 *
 *   modDepth   coefficient of variation of the envelope over above-floor frames.
 *              Reverb fills the gaps between notes, so the envelope flattens and
 *              this falls.
 *   dipDepth   median normalised level of above-floor frames (see above); rises
 *              as the troughs fill in.
 *   decayDb    median dB drop over the 200 ms after a local envelope peak. A dry
 *              note stops; a reverberant one rings, so this shrinks.
 */
interface ReverbFeatures {
    modDepth: number
    dipDepth: number
    decayDb: number
}

function reverbFeatures(c: CachedVariant): ReverbFeatures {
    const env = c.envelope
    const out = { modDepth: 0, dipDepth: dipDepth(c), decayDb: 0 }
    if (env.length < 40) return out
    let peak = 0
    for (const v of env) peak = Math.max(peak, v)
    if (peak <= 0) return out

    const loud: number[] = []
    for (const v of env) if (v > peak * 0.08) loud.push(v)
    if (loud.length > 4) {
        const mu = mean(loud)
        const sd = Math.sqrt(mean(loud.map((v) => (v - mu) ** 2)))
        out.modDepth = mu > 0 ? sd / mu : 0
    }

    // Local peaks (above a third of the global peak, higher than both neighbours),
    // then how far the envelope has fallen 200 ms later.
    const lookahead = 20 // frames = 200 ms at hopSec 0.01
    const drops: number[] = []
    for (let i = 1; i < env.length - 1 - lookahead; i += 1) {
        if (env[i] < peak * 0.33) continue
        if (env[i] <= env[i - 1] || env[i] < env[i + 1]) continue
        const after = env[i + lookahead]
        drops.push(20 * Math.log10(Math.max(after, 1e-9) / env[i]))
    }
    out.decayDb = drops.length ? median(drops) : 0
    return out
}

/**
 * Voicing threshold interpolated from the take's own envelope gap-fill. Anchors
 * come from the fixed-threshold sweep (0.5 best on dry, ~0.25 best under
 * reverb) and the measured `dipDepth` medians (clean 0.365, echoey 0.522).
 */
function adaptiveConfThreshold(c: CachedVariant): number {
    const dip = dipDepth(c)
    const t = Math.max(0, Math.min(1, (dip - 0.36) / (0.52 - 0.36)))
    return 0.5 - 0.25 * t
}

/**
 * The gate the SHIPPED resolver would choose for this clip. Filled in by
 * `primeProductionReverberance` before a sweep runs, because it needs an ffmpeg
 * decode (cheap — no model) that reproduces `ProfileResolver`'s own input.
 *
 * Keyed by prefix length, because `RecordingPipeline.resolveProfile` LOCKS the
 * profile from the first `DETECT_MIN_SEC` = 1.2 s of audio and never revisits
 * it. Scoring the estimator over a whole clip would therefore flatter it: the
 * `lock` rows below are what production actually gets.
 */
const productionReverberance = new Map<string, number>()
const lockedReverberance = new Map<string, Map<number, number>>()
/** Prefix lengths (seconds) standing in for the production profile lock. */
const LOCK_PREFIXES_SEC = [1.5, 3]

/** Band-anchor voicing gate, i.e. the threshold before any reverb relief. */
const UNRELAXED_CONFIDENCE = 0.5

function productionConfThreshold(c: CachedVariant, lockSec?: number): number {
    const key = `${c.dataset}/${c.clip}/${c.variant}`
    const r = lockSec === undefined ? (productionReverberance.get(key) ?? 0) : (lockedReverberance.get(key)?.get(lockSec) ?? 0)
    // A cache built BEFORE the relief shipped stores the un-relaxed threshold, and
    // the baseline row is then the genuine pre-change behaviour — which is what
    // the CI should be measured against. A cache built after it stores the relaxed
    // one (marked `+reverb` in the profile id); strip that back so this row always
    // applies the relief exactly once instead of compounding it. Either way, to
    // re-measure this change from scratch, build the cache with
    // `RECORDING_REVERB_CONF_RELIEF=0` so `baseline` is the pre-change pipeline.
    const base = c.profile.id.includes('+reverb') ? UNRELAXED_CONFIDENCE : (c.profile.confidenceThreshold ?? UNRELAXED_CONFIDENCE)
    return Math.max(0.25, base - 0.25 * r)
}

/**
 * Decode every clip the way `ProfileResolver` sees it (16 kHz, high-pass 30 Hz,
 * no loudnorm) and record what `estimateReverberance` — the real production
 * function — says about it. No model inference, so this costs a few seconds.
 */
async function primeProductionReverberance(pairs: ClipPair[], variant: string): Promise<void> {
    const decoder = new AudioDecoder()
    for (const p of pairs) {
        const key = `${p.ds.id}/${p.clip}/${variant}`
        if (productionReverberance.has(key)) continue
        productionReverberance.set(key, 0)
        lockedReverberance.set(key, new Map(LOCK_PREFIXES_SEC.map((s) => [s, 0])))
        try {
            const wav = readFileSync(join(p.ds.dir, `${p.clip}__${variant}.wav`))
            const det = await decoder.decode(wav, 16000, { loudnorm: false, highpassHz: 30 })
            productionReverberance.set(key, estimateReverberance(det.samples, 16000))
            const locked = lockedReverberance.get(key)
            for (const sec of LOCK_PREFIXES_SEC) {
                locked?.set(sec, estimateReverberance(det.samples.subarray(0, Math.round(sec * 16000)), 16000))
            }
        } catch {
            // Already defaulted to 0 above.
        }
    }
}

/** Fraction of `deg` values on the "more reverberant" side of clean's p90/p10. */
function separability(cleanVals: number[], degVals: number[], direction: 'higher' | 'lower'): string {
    if (!cleanVals.length || !degVals.length) return 'n/a'
    const s = [...cleanVals].sort((a, b) => a - b)
    const cut = direction === 'higher' ? s[Math.floor(0.9 * (s.length - 1))] : s[Math.floor(0.1 * (s.length - 1))]
    const hit = direction === 'higher' ? degVals.filter((v) => v > cut).length : degVals.filter((v) => v < cut).length
    return `${((hit / degVals.length) * 100).toFixed(0)}% past clean p${direction === 'higher' ? '90' : '10'} (${cut.toFixed(3)})`
}

function summariseBands(bands: string[]): string {
    const counts = new Map<string, number>()
    for (const b of bands) counts.set(b, (counts.get(b) ?? 0) + 1)
    return [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `${k}:${v}`)
        .join(' ')
}

// ---------------------------------------------------------------------------
// sweep
// ---------------------------------------------------------------------------

interface SweepConfig {
    name: string
    seg?: SegOverrides
    /**
     * Per-clip segmenter overrides, derived from signals the pipeline could
     * actually read at runtime (the cached envelope, the pitch scan). This is how
     * a CONDITION-ADAPTIVE setting is tested honestly: the fixed rows above ask
     * "what is the best single threshold?", this one asks "can the take's own
     * blind statistics pick the right threshold per take?" — which is the only
     * version that can beat a compromise on clean and reverberant audio at once.
     */
    segFor?: (c: CachedVariant) => SegOverrides
    extractor?: NoteExtractorOptions
    onset?: OnsetDetectorOptions
    /**
     * Constant latency compensation, ms. Stands in for an `atrim=start=` on the
     * decoder's filter chain (how afftdn's 25 ms delay is already compensated),
     * which shifts every detected note earlier by exactly this much.
     */
    shiftMs?: number
    /**
     * Replace segmentation + cleanup entirely: the row scores exactly what this
     * returns. For candidates that live in a different decoder (the voice decode),
     * which `runPipeline`'s legacy-segmenter shape cannot express.
     */
    segment?: (c: CachedVariant) => {
        startTimeSeconds: number
        durationSeconds: number
        pitchMidi: number
    }[]
    /**
     * Name of the config this row's paired CI is measured against (default
     * 'baseline'). A mechanism riding a non-shipping decode has to be compared
     * against that same decode without the mechanism, not against the legacy path.
     */
    vsName?: string
    /**
     * Run the FULL `OnsetDetector.detect` over freshly decoded audio instead of
     * replaying the cached envelope — required by mechanisms that need more than
     * the envelope (R25's band-limited silence tier). Slow (one ffmpeg decode per
     * clip per row); keep these rows on small dataset/variant selections.
     */
    onsetFromAudio?: OnsetDetectorOptions
}

/**
 * Candidates. Everything here is downstream of the cached trajectory, so the
 * whole grid costs seconds. The onset-detector rows are the interesting ones:
 * reverb FILLS IN the amplitude dips that `OnsetDetector` needs (see the
 * diagnose output), so if re-attack detection is where reverb bites, loosening
 * `dipRatio`/`riseRatio` should show up here — and it must not shatter clean
 * audio, which is why every row is scored on `real` too.
 */
const CONFIGS: SweepConfig[] = [
    { name: 'baseline' },

    // Voicing gate. The frame-level evidence points straight here: reverb roughly
    // HALVES CREPE's per-frame confidence (0.78 → 0.49 mean) while barely moving
    // its pitch (RPA@50 ¢ 0.72, octave errors 0.9 %), so a fixed 0.5 gate that was
    // calibrated on dry audio throws away about half the frames it should keep —
    // and it does so *inside* held notes, which is why the median detected note
    // halves in length (0.46 s → 0.23 s) rather than notes simply going missing.
    { name: 'conf 0.25', seg: { confidenceThreshold: 0.25 } },
    { name: 'conf 0.30', seg: { confidenceThreshold: 0.3 } },
    { name: 'conf 0.35', seg: { confidenceThreshold: 0.35 } },
    { name: 'conf 0.40', seg: { confidenceThreshold: 0.4 } },
    { name: 'conf 0.45', seg: { confidenceThreshold: 0.45 } },
    { name: 'conf 0.60', seg: { confidenceThreshold: 0.6 } },
    { name: 'conf 0.70', seg: { confidenceThreshold: 0.7 } },

    // Condition-adaptive gate: interpolate the threshold from the envelope's
    // gap-fill (`dipDepth`), the strongest of the blind reverberance features.
    // The fixed rows show the optimum is ~0.5 on dry audio and ~0.25 under
    // reverb, so a per-take choice should beat any single compromise — IF the
    // blind feature is informative enough, which is exactly what this measures.
    { name: 'conf adaptive(dip)', segFor: (c) => ({ confidenceThreshold: adaptiveConfThreshold(c) }) },
    // The SHIPPED version of the same idea, running the real production code
    // (`estimateReverberance`) over a decode that reproduces what `ProfileResolver`
    // is handed at runtime — 16 kHz, high-pass 30 Hz, no loudnorm. The row above
    // uses the provider-rate envelope that happens to be in the cache, which is
    // NOT the same signal; this row is the one a shipping decision may rest on.
    { name: 'conf reverberance(prod)', segFor: (c) => ({ confidenceThreshold: productionConfThreshold(c) }) },
    // …and the same thing over only the audio production actually has when it
    // makes the decision. `RecordingPipeline.resolveProfile` locks the profile from
    // the first DETECT_MIN_SEC = 1.2 s and never revisits it, so if the estimator
    // needs a whole take to see the room, the shipped gain is not real.
    { name: 'conf reverb(lock 1.5s)', segFor: (c) => ({ confidenceThreshold: productionConfThreshold(c, 1.5) }) },
    { name: 'conf reverb(lock 3s)', segFor: (c) => ({ confidenceThreshold: productionConfThreshold(c, 3) }) },

    // Note-length floor / smoothing — absorb tail-driven fragments.
    { name: 'minFrames 6', seg: { minFramesPerNote: 6 } },
    { name: 'minFrames 8', seg: { minFramesPerNote: 8 } },
    { name: 'smooth 6', seg: { smoothFrames: 6 } },
    { name: 'smooth 8', seg: { smoothFrames: 8 } },

    // Re-attack detector. LOOSENING was the prior expectation (reverb was assumed
    // to fill the dips and blind the detector); it measured badly, because reverb
    // makes the detector fire MORE, not less. So the useful direction is
    // tightening, and above all the dip-DURATION guard (`minTroughSec`) which
    // keeps genuine gaps and drops reverb wobble.
    { name: 'onset dip 0.8 rise 1.2', onset: { dipRatio: 0.8, riseRatio: 1.2 } },
    { name: 'onset dip 0.35', onset: { dipRatio: 0.35 } },
    { name: 'onset dip 0.25', onset: { dipRatio: 0.25 } },
    { name: 'onset rise 2.5', onset: { riseRatio: 2.5 } },
    { name: 'onset rise 4', onset: { riseRatio: 4 } },
    { name: 'onset trough 30ms', onset: { minTroughSec: 0.03 } },
    { name: 'onset trough 50ms', onset: { minTroughSec: 0.05 } },
    { name: 'onset trough 80ms', onset: { minTroughSec: 0.08 } },
    { name: 'onset trough 120ms', onset: { minTroughSec: 0.12 } },
    { name: 'onset trough 200ms', onset: { minTroughSec: 0.2 } },
    { name: 'onset trough 80 dip 0.35', onset: { minTroughSec: 0.08, dipRatio: 0.35 } },
    { name: 'onset minIoi 0.2', onset: { minIoiSec: 0.2 } },
    // R3: aubio's adaptive threshold (median + k·mean over the novelty's own
    // neighbourhood) instead of the fixed dip/rise ratios — the self-calibrating
    // answer to "reverb makes the detector fire MORE". Scored per condition, so
    // the clean-audio cost stays visible.
    { name: 'onset adapt w300 k0.5', onset: { adaptiveThreshold: { windowSec: 0.3, k: 0.5 } } },
    { name: 'onset adapt w300 k1', onset: { adaptiveThreshold: { windowSec: 0.3, k: 1 } } },
    { name: 'onset adapt w300 k2', onset: { adaptiveThreshold: { windowSec: 0.3, k: 2 } } },
    { name: 'onset adapt w150 k1', onset: { adaptiveThreshold: { windowSec: 0.15, k: 1 } } },
    { name: 'onset adapt w500 k1', onset: { adaptiveThreshold: { windowSec: 0.5, k: 1 } } },
    {
        name: 'onset off',
        onset: undefined,
        extractor: { ...SHIPPING_EXTRACTOR, steps: { pitchOutliers: false, merge: false, onsetSplit: false } },
    },

    // Cleanup priors.
    { name: 'adaptiveFloor 0.0', extractor: { ...SHIPPING_EXTRACTOR, adaptiveFloorFraction: 0 } },
    { name: 'adaptiveFloor 0.5', extractor: { ...SHIPPING_EXTRACTOR, adaptiveFloorFraction: 0.5 } },
    { name: 'vibrato 0.25', extractor: { ...SHIPPING_EXTRACTOR, vibratoMaxSec: 0.25 } },

    // Constant latency compensation (see SweepConfig.shiftMs). Reverb buries the
    // direct attack, so the trajectory commits to a new pitch late; if that
    // lateness is roughly constant, an `atrim=start=` in the decoder removes it.
    { name: 'shift 20ms', shiftMs: 20 },
    { name: 'shift 30ms', shiftMs: 30 },
    { name: 'shift 40ms', shiftMs: 40 },
    { name: 'shift 50ms', shiftMs: 50 },
    { name: 'shift 60ms', shiftMs: 60 },
    { name: 'shift 40ms +minFrames6', shiftMs: 40, seg: { minFramesPerNote: 6 } },
    { name: 'shift 40ms +conf0.6', shiftMs: 40, seg: { confidenceThreshold: 0.6 } },

    // R15 (WaoN §9.3): joint duration × velocity filters, riding the VOICE decode
    // at its shipping configuration. The reverb tier is where the long-AND-quiet
    // filter should earn its keep — a tail is precisely a long, quiet note — so
    // the gate is: precision up on echoey-room/distant-mic, recall unchanged,
    // clean audio unharmed. Rows are compared against the same decode with the
    // filters OFF (`vsName`), never against the legacy baseline. Run these on the
    // voice datasets (SWEEP_REVERB_DATASETS=annotated-vocalset,vocadito).
    { name: 'voice OFF', segment: voiceDecode() },
    { name: 'voice sl1.2', segment: voiceDecode({ keepShortLoudRatio: 1.2 }), vsName: 'voice OFF' },
    { name: 'voice sl1.5', segment: voiceDecode({ keepShortLoudRatio: 1.5 }), vsName: 'voice OFF' },
    { name: 'voice sl2', segment: voiceDecode({ keepShortLoudRatio: 2 }), vsName: 'voice OFF' },
    { name: 'voice lq.2@.35s', segment: voiceDecode({ dropLongQuiet: { minSec: 0.35, quietRatio: 0.2 } }), vsName: 'voice OFF' },
    { name: 'voice lq.3@.35s', segment: voiceDecode({ dropLongQuiet: { minSec: 0.35, quietRatio: 0.3 } }), vsName: 'voice OFF' },
    { name: 'voice lq.45@.35s', segment: voiceDecode({ dropLongQuiet: { minSec: 0.35, quietRatio: 0.45 } }), vsName: 'voice OFF' },
    { name: 'voice lq.3@.6s', segment: voiceDecode({ dropLongQuiet: { minSec: 0.6, quietRatio: 0.3 } }), vsName: 'voice OFF' },
    { name: 'voice lq.45@.6s', segment: voiceDecode({ dropLongQuiet: { minSec: 0.6, quietRatio: 0.45 } }), vsName: 'voice OFF' },
    {
        name: 'voice sl1.5+lq.3@.35s',
        segment: voiceDecode({ keepShortLoudRatio: 1.5, dropLongQuiet: { minSec: 0.35, quietRatio: 0.3 } }),
        vsName: 'voice OFF',
    },

    // R19: block-level voiced-fraction quorum on the gate (outotune >¼ / Essentia
    // ≥50 % / aubio median-of-6 — the survey's fourth independent instance). The
    // claim under test: spurious short notes fall on the reverb tier, clean audio
    // unchanged. Anchored against the same decode without the quorum.
    { name: 'voice q.25w60', segment: voiceDecode({ voicedQuorum: { minFraction: 0.25, windowSec: 0.06 } }), vsName: 'voice OFF' },
    { name: 'voice q.5w60', segment: voiceDecode({ voicedQuorum: { minFraction: 0.5, windowSec: 0.06 } }), vsName: 'voice OFF' },
    { name: 'voice q.5w120', segment: voiceDecode({ voicedQuorum: { minFraction: 0.5, windowSec: 0.12 } }), vsName: 'voice OFF' },
    { name: 'voice q.5w200', segment: voiceDecode({ voicedQuorum: { minFraction: 0.5, windowSec: 0.2 } }), vsName: 'voice OFF' },
    { name: 'voice q.75w60', segment: voiceDecode({ voicedQuorum: { minFraction: 0.75, windowSec: 0.06 } }), vsName: 'voice OFF' },
    { name: 'voice q.75w120', segment: voiceDecode({ voicedQuorum: { minFraction: 0.75, windowSec: 0.12 } }), vsName: 'voice OFF' },
    { name: 'voice q.75w200', segment: voiceDecode({ voicedQuorum: { minFraction: 0.75, windowSec: 0.2 } }), vsName: 'voice OFF' },

    // R21: fill 1–2-frame unvoiced dropouts before decoding. Reverb HALVES
    // CREPE's mid-note confidence (the 2026-07 diagnosis), so short gate dropouts
    // inside held notes are exactly what this tier produces — if the fill is
    // worth anything, it is here.
    { name: 'voice fill20', segment: voiceDecode({ fillUnvoicedGapSec: 0.02 }), vsName: 'voice OFF' },
    { name: 'voice fill40', segment: voiceDecode({ fillUnvoicedGapSec: 0.04 }), vsName: 'voice OFF' },
    { name: 'voice fill60', segment: voiceDecode({ fillUnvoicedGapSec: 0.06 }), vsName: 'voice OFF' },
    { name: 'voice fill80', segment: voiceDecode({ fillUnvoicedGapSec: 0.08 }), vsName: 'voice OFF' },
    { name: 'voice fill120', segment: voiceDecode({ fillUnvoicedGapSec: 0.12 }), vsName: 'voice OFF' },

    // …and the condition-adaptive version. The clean VOICE slice says an
    // always-on fill costs boundaries (the 1–2-frame dips ARE the legato
    // boundary evidence), while reverb gains up to +0.15 — the same split the
    // confidence relief faced, so it gets the same answer: scale the fill by the
    // production reverberance estimate, including under the profile lock
    // production actually decides with.
    { name: 'voice fillAd x.10', segment: adaptiveFill(0.1), vsName: 'voice OFF' },
    { name: 'voice fillAd x.15', segment: adaptiveFill(0.15), vsName: 'voice OFF' },
    { name: 'voice fillAd x.20', segment: adaptiveFill(0.2), vsName: 'voice OFF' },
    { name: 'voice fillAd x.15 lock1.5', segment: adaptiveFill(0.15, 1.5), vsName: 'voice OFF' },
    { name: 'voice fillAd x.15 lock3', segment: adaptiveFill(0.15, 3), vsName: 'voice OFF' },

    // …and the ENERGY-GATED version (`fillEnergyFloor`, 2026-09). The clean-slice
    // cost of the unconditional fill came from erasing consonant dips, which are
    // energy dips; a reverb puncture is a confidence collapse over a sustained
    // envelope. Gating the fill on the gap's energy staying within a fraction of
    // the flanks should keep the reverb repair and leave the boundary evidence
    // alone — no room estimate needed, so no false-firing gate either.
    { name: 'voice fillE40 r.5', segment: voiceDecode({ fillUnvoicedGapSec: 0.04, fillEnergyFloor: 0.5 }), vsName: 'voice OFF' },
    { name: 'voice fillE40 r.7', segment: voiceDecode({ fillUnvoicedGapSec: 0.04, fillEnergyFloor: 0.7 }), vsName: 'voice OFF' },
    { name: 'voice fillE40 r.85', segment: voiceDecode({ fillUnvoicedGapSec: 0.04, fillEnergyFloor: 0.85 }), vsName: 'voice OFF' },
    { name: 'voice fillE80 r.5', segment: voiceDecode({ fillUnvoicedGapSec: 0.08, fillEnergyFloor: 0.5 }), vsName: 'voice OFF' },
    { name: 'voice fillE80 r.7', segment: voiceDecode({ fillUnvoicedGapSec: 0.08, fillEnergyFloor: 0.7 }), vsName: 'voice OFF' },
    { name: 'voice fillE80 r.85', segment: voiceDecode({ fillUnvoicedGapSec: 0.08, fillEnergyFloor: 0.85 }), vsName: 'voice OFF' },
    { name: 'voice fillE120 r.7', segment: voiceDecode({ fillUnvoicedGapSec: 0.12, fillEnergyFloor: 0.7 }), vsName: 'voice OFF' },
    { name: 'voice fillE120 r.85', segment: voiceDecode({ fillUnvoicedGapSec: 0.12, fillEnergyFloor: 0.85 }), vsName: 'voice OFF' },
    // Flank-referenced rows above measured inert (the flanks sit on the dip's
    // shoulders). Context-referenced (peak within ±140 ms, the decoder's own
    // evidence window) is the version that removed the clean-slice cost in
    // sweep-voice; these rows ask whether it keeps the reverb repair.
    {
        name: 'voice fillEc40 r.5',
        segment: voiceDecode({ fillUnvoicedGapSec: 0.04, fillEnergyFloor: 0.5, fillEnergyContextSec: 0.14 }),
        vsName: 'voice OFF',
    },
    {
        name: 'voice fillEc40 r.7',
        segment: voiceDecode({ fillUnvoicedGapSec: 0.04, fillEnergyFloor: 0.7, fillEnergyContextSec: 0.14 }),
        vsName: 'voice OFF',
    },
    {
        name: 'voice fillEc40 r.85',
        segment: voiceDecode({ fillUnvoicedGapSec: 0.04, fillEnergyFloor: 0.85, fillEnergyContextSec: 0.14 }),
        vsName: 'voice OFF',
    },
    {
        name: 'voice fillEc80 r.5',
        segment: voiceDecode({ fillUnvoicedGapSec: 0.08, fillEnergyFloor: 0.5, fillEnergyContextSec: 0.14 }),
        vsName: 'voice OFF',
    },
    {
        name: 'voice fillEc80 r.7',
        segment: voiceDecode({ fillUnvoicedGapSec: 0.08, fillEnergyFloor: 0.7, fillEnergyContextSec: 0.14 }),
        vsName: 'voice OFF',
    },
    {
        name: 'voice fillEc80 r.85',
        segment: voiceDecode({ fillUnvoicedGapSec: 0.08, fillEnergyFloor: 0.85, fillEnergyContextSec: 0.14 }),
        vsName: 'voice OFF',
    },
    {
        name: 'voice fillEc120 r.7',
        segment: voiceDecode({ fillUnvoicedGapSec: 0.12, fillEnergyFloor: 0.7, fillEnergyContextSec: 0.14 }),
        vsName: 'voice OFF',
    },
    {
        name: 'voice fillEc120 r.85',
        segment: voiceDecode({ fillUnvoicedGapSec: 0.12, fillEnergyFloor: 0.85, fillEnergyContextSec: 0.14 }),
        vsName: 'voice OFF',
    },

    // R25: OpenTune's two-tier absolute silence rule in the onset detector —
    // rumble-dominated frames classify as silence above the strict gate. Needs
    // the band envelope, so these rows decode audio (slow): run them on small
    // selections, e.g. SWEEP_REVERB_DATASETS=vocadito
    // SWEEP_REVERB_VARIANTS=wind-outdoor,street-noise. `onset audioCtrl` is the
    // control that isolates the decode-path difference from the rule itself.
    { name: 'onset audioCtrl', onsetFromAudio: {} },
    { name: 'onset 2tier', onsetFromAudio: { silenceRule: {} }, vsName: 'onset audioCtrl' },
    {
        name: 'onset 2tier strict',
        onsetFromAudio: { silenceRule: { totalDbfs: -45, relaxedTotalDbfs: -35, bandFloorDbfs: -45 } },
        vsName: 'onset audioCtrl',
    },
]

/**
 * Reverberance-scaled dropout fill: `fillSec = scale × r`, off below 20 ms so a
 * dry take keeps the exact raw decode. `lockSec` reads the estimate from only
 * the first N seconds — what production has when it locks the profile.
 */
function adaptiveFill(scale: number, lockSec?: number) {
    return (c: CachedVariant): ReturnType<typeof segmentNotes> => {
        const key = `${c.dataset}/${c.clip}/${c.variant}`
        const r = lockSec === undefined ? (productionReverberance.get(key) ?? 0) : (lockedReverberance.get(key)?.get(lockSec) ?? 0)
        const fillSec = scale * r
        return voiceDecode(fillSec >= 0.02 ? { fillUnvoicedGapSec: fillSec } : {})(c)
    }
}

/** The voice decode as production ships it, driven off a cached variant. */
function voiceDecode(over: VoiceDecodeOptions = {}) {
    return (c: CachedVariant): ReturnType<typeof segmentNotes> =>
        new VoiceNoteDecoder({
            ...VOICE_OPTS,
            confidenceThreshold: c.profile.confidenceThreshold ?? 0.5,
            minFreqHz: c.profile.minFreqHz,
            maxFreqHz: c.profile.maxFreqHz,
            minNoteSec: (c.profile.minFramesPerNote ?? 4) * c.track.hopSec,
            ...over,
        }).decode(c.track, c.energy)
}

async function sweep(
    cache: VariantTrackCache,
    datasets: RealDataset[],
    variants: string[],
    split: ReturnType<typeof splitFromEnv>,
    limit: number,
): Promise<void> {
    const only = process.env.SWEEP_REVERB_ONLY ?? ''
    const configs = CONFIGS.filter((c) => c.name === 'baseline' || !only || c.name.includes(only))
    // A filtered run must still carry every row used as a comparison anchor.
    for (const c of [...configs]) {
        if (c.vsName && !configs.some((p) => p.name === c.vsName)) {
            const anchor = CONFIGS.find((p) => p.name === c.vsName)
            if (anchor) configs.push(anchor)
        }
    }

    // `real` first so the clean-audio cost of every row is visible.
    for (const variant of [CLEAN_VARIANT, ...variants]) {
        const pairs = await collectPairs(cache, datasets, variant, split, limit)
        if (!pairs.length) continue
        const target = (p: ClipPair): CachedVariant => (variant === CLEAN_VARIANT ? p.clean : p.deg)
        await primeProductionReverberance(pairs, variant)

        const scores = new Map<string, number[]>()
        const f2s = new Map<string, number[]>()
        const precisions = new Map<string, number[]>()
        const recalls = new Map<string, number[]>()
        const counts = new Map<string, number[]>()
        for (const cfg of configs) {
            const f1: number[] = []
            const f2: number[] = []
            const prec: number[] = []
            const rec: number[] = []
            const estN: number[] = []
            const detector = cfg.onset ? new OnsetDetector(cfg.onset) : null
            const audioDecoder = cfg.onsetFromAudio ? new AudioDecoder() : null
            for (const pair of pairs) {
                const c = target(pair)
                let onsetTimesSec = detector ? detector.detectFromEnvelope(c.envelope, c.onsetHop, c.onsetSampleRate) : c.onsetTimesSec
                if (audioDecoder && cfg.onsetFromAudio) {
                    const wav = readFileSync(join(pair.ds.dir, `${pair.clip}__${c.variant}.wav`))
                    const decoded = await audioDecoder.decode(wav, c.onsetSampleRate, {
                        loudnorm: false,
                        highpassHz: c.profile.highpassHz,
                    })
                    onsetTimesSec = new OnsetDetector(cfg.onsetFromAudio).detect(decoded.samples, c.onsetSampleRate)
                }
                const cleaned = cfg.segment
                    ? toEst(cfg.segment(c))
                    : runPipeline(c, {
                          seg: cfg.segFor ? cfg.segFor(c) : cfg.seg,
                          extractor: cfg.extractor,
                          onsetTimesSec,
                      }).cleaned
                const est = cfg.shiftMs ? shiftEarlier(cleaned, cfg.shiftMs / 1000) : cleaned
                const m = scoreNotes(c.truth.notes, est, {
                    onsetTolSec: ONSET_TOL,
                    timingTolSec: TIMING_TOL,
                })
                f1.push(m.f1)
                // F₂ — recall-weighted, the product-relevant weighting (a missed note costs ~40× a spurious one:
                // an expert spends 3.5 s deleting a spurious note and 145 s creating a
                // missing one, so recall is worth far more than precision).
                const denom = 4 * m.precision + m.recall
                f2.push(denom > 0 ? (5 * m.precision * m.recall) / denom : 0)
                prec.push(m.precision)
                rec.push(m.recall)
                estN.push(cleaned.length)
            }
            scores.set(cfg.name, f1)
            f2s.set(cfg.name, f2)
            precisions.set(cfg.name, prec)
            recalls.set(cfg.name, rec)
            counts.set(cfg.name, estN)
        }

        console.log(`\n=== ${variant} — ${pairs.length} clips, split=${split} ===`)
        console.log(
            'config'.padEnd(24) +
                'F1'.padEnd(8) +
                'F2'.padEnd(8) +
                'P'.padEnd(8) +
                'R'.padEnd(8) +
                'est'.padEnd(7) +
                'ΔF1 vs anchor'.padEnd(48) +
                'ΔF2',
        )
        for (const cfg of configs) {
            const anchor = cfg.vsName ?? 'baseline'
            const base = scores.get(anchor) ?? []
            const baseF2 = f2s.get(anchor) ?? []
            const f1 = scores.get(cfg.name) ?? []
            const f2 = f2s.get(cfg.name) ?? []
            console.log(
                cfg.name.padEnd(24) +
                    mean(f1).toFixed(3).padEnd(8) +
                    mean(f2).toFixed(3).padEnd(8) +
                    mean(precisions.get(cfg.name) ?? [])
                        .toFixed(3)
                        .padEnd(8) +
                    mean(recalls.get(cfg.name) ?? [])
                        .toFixed(3)
                        .padEnd(8) +
                    mean(counts.get(cfg.name) ?? [])
                        .toFixed(1)
                        .padEnd(7) +
                    (cfg.name === anchor
                        ? '—'.padEnd(48) + '—'
                        : formatComparison(pairedDiffCI(base, f1)).padEnd(48) + formatComparison(pairedDiffCI(baseF2, f2))),
            )
            // Anchored rows exist to answer "precision up, recall unchanged" — print
            // the paired CIs those two claims actually rest on.
            if (cfg.vsName && cfg.name !== anchor) {
                console.log(
                    '  ↳ vs ' +
                        anchor.padEnd(17) +
                        'ΔP ' +
                        formatComparison(pairedDiffCI(precisions.get(anchor) ?? [], precisions.get(cfg.name) ?? [])).padEnd(45) +
                        'ΔR ' +
                        formatComparison(pairedDiffCI(recalls.get(anchor) ?? [], recalls.get(cfg.name) ?? [])),
                )
            }
        }
    }
}

// ---------------------------------------------------------------------------
// frontend — candidate DECODER-stage fixes (needs re-inference, so it is slow)
// ---------------------------------------------------------------------------

/**
 * Late-reverberation suppression settings to try. Unlike everything in `sweep`,
 * a front end changes the audio the MODEL sees, so each row costs a full CREPE
 * pass per clip (cached per front-end id, so a re-run is instant).
 *
 * The ceiling for this whole family is the `deg+cleanTrack` row of `diagnose` —
 * an oracle that hands the degraded pipeline the clean take's trajectory. There
 * is no point sweeping this if that row is small.
 */
const FRONT_ENDS: { id: string; opts: DereverbOptions }[] = [
    { id: 't60-0.5-a1', opts: { t60Sec: 0.5, alpha: 1, lateStartSec: 0.048 } },
    { id: 't60-0.8-a1', opts: { t60Sec: 0.8, alpha: 1, lateStartSec: 0.048 } },
    { id: 't60-0.8-a1.5', opts: { t60Sec: 0.8, alpha: 1.5, lateStartSec: 0.048 } },
    { id: 't60-0.8-a2', opts: { t60Sec: 0.8, alpha: 2, lateStartSec: 0.048 } },
    { id: 't60-1.3-a1.5', opts: { t60Sec: 1.3, alpha: 1.5, lateStartSec: 0.048 } },
    { id: 't60-0.8-a1.5-late24', opts: { t60Sec: 0.8, alpha: 1.5, lateStartSec: 0.024 } },
]

async function frontendSweep(
    cache: VariantTrackCache,
    datasets: RealDataset[],
    variants: string[],
    split: ReturnType<typeof splitFromEnv>,
    limit: number,
): Promise<void> {
    const only = process.env.SWEEP_REVERB_ONLY ?? ''
    const fronts = FRONT_ENDS.filter((f) => !only || f.id.includes(only))

    for (const variant of [CLEAN_VARIANT, ...variants]) {
        const pairs = await collectPairs(cache, datasets, variant, split, limit)
        if (!pairs.length) continue
        const target = (p: ClipPair): CachedVariant => (variant === CLEAN_VARIANT ? p.clean : p.deg)

        const scoreOf = (c: CachedVariant): number =>
            scoreNotes(c.truth.notes, runPipeline(c).cleaned, {
                onsetTolSec: ONSET_TOL,
                timingTolSec: TIMING_TOL,
            }).f1

        const base = pairs.map((p) => scoreOf(target(p)))
        console.log(`\n=== ${variant} — ${pairs.length} clips, split=${split} ===`)
        console.log('front end'.padEnd(24) + 'F1'.padEnd(8) + 'Δ vs untreated')
        console.log('untreated'.padEnd(24) + mean(base).toFixed(3).padEnd(8) + '—')

        for (const fe of fronts) {
            const frontEnd = dereverbFrontEnd(fe.id, fe.opts)
            const scores: number[] = []
            const kept: number[] = []
            for (let i = 0; i < pairs.length; i += 1) {
                const p = pairs[i]
                const treated = await cache.load(p.ds, p.clip, variant, frontEnd)
                if (!treated) continue
                scores.push(scoreOf(treated))
                kept.push(base[i])
            }
            console.log(fe.id.padEnd(24) + mean(scores).toFixed(3).padEnd(8) + formatComparison(pairedDiffCI(kept, scores)))
        }
    }
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
    const registry = new ProviderRegistry(MODELS)
    await registry.initAll()
    const cache = new VariantTrackCache(registry, CACHE_ROOT)

    const split = splitFromEnv()
    const limit = Number(process.env.SWEEP_REVERB_LIMIT) || Infinity
    const wantDatasets = envList('SWEEP_REVERB_DATASETS', DEFAULT_DATASETS)
    const variants = envList('SWEEP_REVERB_VARIANTS', DEFAULT_VARIANTS)
    const datasets = discoverRealDatasets(REAL_ROOT).filter((d) => wantDatasets.includes(d.id))
    if (!datasets.length) {
        console.error(`No datasets matched ${wantDatasets.join(',')} under ${REAL_ROOT}`)
        process.exit(1)
    }

    const mode = (process.env.SWEEP_REVERB_MODE ?? 'diagnose').toLowerCase()
    if (mode === 'sweep') {
        await sweep(cache, datasets, variants, split, limit)
    } else if (mode === 'frontend') {
        await frontendSweep(cache, datasets, variants, split, limit)
    } else {
        await diagnose(cache, datasets, variants, split, limit)
    }
}

main().catch((e) => {
    console.error(e)
    process.exit(1)
})
