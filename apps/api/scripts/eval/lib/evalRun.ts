/**
 * The corpus scorer behind `run-eval.ts` and `benchmark.ts`: run the audio→notes
 * pipeline over a corpus (synthetic or real), score every clip against its
 * ground truth, aggregate per dataset / per condition / per MATERIAL.
 *
 * Extracted from run-eval.ts so the benchmark runner and the everyday tuning
 * entry point cannot drift apart: both call `runEval()` with an options object;
 * run-eval.ts only adds env parsing and console printing, benchmark.ts only adds
 * provenance (git SHA, date) and the committed results/compare machinery.
 *
 * `runEval()` is three steps that are exported on their own, so a scorer of
 * notes produced elsewhere (an older pipeline, a cache) lands in the same
 * report: `selectCorpus()` + `scenarioClips()` enumerate what is scored,
 * `scoreClip()` scores one clip's notes against its truth, and `aggregateEval()`
 * builds the report. `EvalOptions.transcribe` swaps the pipeline itself.
 *
 * Two scoring rules keep the headline number honest:
 *   - A clip carrying several independent annotations is scored against the one
 *     it matches best (`scoreNotesBest`): annotators disagree about ornament
 *     grouping, and charging the pipeline for that measures taste, not accuracy.
 *   - Datasets whose truth is derived (`noteTruthDerived`), pitchless, a
 *     constructed performance, or under a restricted licence are reported
 *     per-dataset but excluded from every pooled aggregate — `isPooled()` in
 *     lib/realCorpus.ts. The headline is reported twice: over every pooled
 *     dataset, and over those whose truth is human-annotated only.
 */

import { existsSync, readdirSync, readFileSync } from 'fs'
import { join, resolve } from 'path'

import { AudioConverter } from '../../../src/recordings/pipeline/audio-converter'
import { AudioDecoder } from '../../../src/recordings/pipeline/audio-decoder'
import { type ProfileHint, ProfileResolver } from '../../../src/recordings/pipeline/profiles/profile-resolver'
import { CrepePitchdownProvider } from '../../../src/recordings/pipeline/providers/crepe-pitchdown-provider'
import { CrepeProvider } from '../../../src/recordings/pipeline/providers/crepe-provider'
import { LocalModelBackend } from '../../../src/recordings/pipeline/providers/local-model-backend'
import type { PitchProvider, PitchTranscribeOptions } from '../../../src/recordings/pipeline/providers/pitch-provider'
import { ProviderRegistry } from '../../../src/recordings/pipeline/providers/provider-registry'
import { CONDITIONS, SCENARIOS, SYNTH_CONDITIONS } from '../scenarios'
import type { Condition, GroundTruth, Scenario } from '../types'
import { type EstNote, type MatchOptions, type Metrics, scoreNotesBest, scoreOnsets, type TimingStats, timingStats } from './metrics'
import { addOnsetClassStats, emptyOnsetClassStats, type OnsetClassStats, onsetRecallByClass } from './onsetClasses'
import { discoverRealDatasets, isPooled, type Material, type RealDataset, type TruthSource } from './realCorpus'
import { repairSecondsPer100, type SegErrorCounts, segErrors } from './segErrors'
import { splitOf } from './split'

const DETECT_SR = 16000

export const SYNTH_ROOT = resolve(__dirname, '../../fixtures/eval')
export const REAL_ROOT = resolve(__dirname, '../../fixtures/eval-real')
/** The realistic synthetic corpus (exported from synthetic-corpus/, see its README). */
export const SYNTH_REALISTIC_ROOT = resolve(__dirname, '../../fixtures/eval-synth')
const MODELS = {
    crepeTiny: resolve(process.cwd(), 'model-crepe-tiny'),
}

// Real clips ship as `<clip>__real.wav`; the harness's per-condition WAV lookup
// reuses this pseudo-condition. Degraded variants of the real clips (see
// degrade-real.ts) reuse the synthetic condition ids — missing variants are
// simply skipped, so running before degrade-real.ts still works.
export const REAL_CONDITION: Condition = { id: 'real', label: 'real recording' }

export interface EvalOptions {
    /** Real recorded corpus (fixtures/eval-real) vs the synthetic one. */
    real: boolean
    /**
     * The realistic synthetic corpus (fixtures/eval-synth) instead of either:
     * every app instrument + voice types, real-recording timbres, measured
     * acoustics, exact truth. Takes precedence over `real`.
     */
    synth?: boolean
    /** Run the production resolver + registry (the adaptive path) instead of a fixed config. */
    adaptive: boolean
    /** Fixed-config provider (ignored when adaptive). */
    providerName: string
    pitchOptions: PitchTranscribeOptions
    highpassHz: number
    fixedDenoise: boolean
    /** Restrict to these dataset / scenario ids. */
    scenarioFilter?: string[]
    /** Restrict to these condition ids. */
    conditionFilter?: string[]
    /** Strip the instrument hint AND the explicit sourceKind (exercises the source classifier). */
    noHint: boolean
    onsetSplit: boolean
    label: string
    matchOpts: MatchOptions
    /** Pool derived / pitchless / constructed / restricted datasets into the headline anyway. */
    includeUntrusted: boolean
    /** Progress line per finished dataset. */
    onProgress?: (line: string) => void
    /**
     * Replace the pipeline: called once per clip × condition with everything the
     * production path would be given. Unset = this checkout's production path
     * (or the fixed config), built once per run by `buildTranscriber`.
     */
    transcribe?: TranscribeFn
    /** Restrict to these clips, as `<dataset>/<clip>` keys (every condition of each). */
    clipFilter?: Set<string>
    /** Called with each clip's notes as scored, before scoring (benchmark.ts records them). */
    onClip?: (clip: { datasetId: string; clipId: string; condition: string; notes: EstNote[]; error?: string }) => void
}

/** One clip × condition, as a transcriber sees it. */
export interface TranscribeJob {
    datasetId: string
    clipId: string
    condition: string
    wavPath: string
    wav: Buffer
    bpm: number
    /** The hints as the production path receives them (`hintsFor`): both undefined under `noHint`. */
    instrumentId?: string
    sourceKind?: ProfileHint['sourceKind']
    scenario: Scenario
}

export type TranscribeFn = (job: TranscribeJob) => Promise<EstNote[]>

export function defaultEvalOptions(over: Partial<EvalOptions> = {}): EvalOptions {
    return {
        real: false,
        adaptive: false,
        providerName: 'crepe-tiny',
        pitchOptions: {},
        highpassHz: 80,
        fixedDenoise: false,
        noHint: false,
        onsetSplit: true,
        label: 'adaptive',
        matchOpts: { onsetTolSec: 0.1, timingTolSec: 0.3 },
        includeUntrusted: false,
        ...over,
    }
}

/** One scored clip × condition. */
export interface ClipResult {
    scenario: string
    melody: string
    condition: string
    /** Harness dev/test half (performer-grouped, lib/split.ts). */
    split: 'dev' | 'test'
    metrics: Metrics
    /**
     * Molina split/merged/missed/spurious for this clip, and the onset taxonomy.
     * Reported in the headline run because these are the numbers the segmentation
     * effort targets and F1 hides them: "12 notes for 8" and "6 notes for 8" can
     * share an F1 and be very different products.
     */
    seg: SegErrorCounts
    onsets: OnsetClassStats
    /** MIREX COn (onset-only) — the only meaningful score for `pitchless` datasets. */
    onsetOnly: { precision: number; recall: number; f1: number }
}

export interface ScenarioAggregate {
    scenario: string
    label: string
    kind: string
    material: Material
    tier: 'benchmark' | 'context' | 'synthetic'
    license?: string
    licenceRestricted: boolean
    truthSource: TruthSource
    clips: number
    /** False = reported for information only, kept out of the aggregates. */
    pooled: boolean
    noteTruthDerived: boolean
    pitchless: boolean
    constructedPerformance: boolean
    onsetF1: number
    onsetPrecision: number
    onsetRecall: number
    f1: number
    f1Off: number
    chromaF1: number
    precision: number
    recall: number
    octaveErrorRate: number
    medianPitchErr: number
    timing: TimingStats
    seg: SegErrorCounts
    repairSecondsPer100: number
    onsets: OnsetClassStats
}

export interface ConditionAggregate {
    condition: string
    label: string
    clips: number
    f1: number
    f1Off: number
    precision: number
    recall: number
    octaveErrorRate: number
}

/**
 * The material-level summary the product benchmark reads first: for each
 * material, the mean over its POOLED datasets (the headline convention — a mean
 * of dataset means, so a 400-clip corpus does not drown a 40-clip one) plus the
 * context-only datasets listed separately so nobody mistakes them for a gate.
 */
export interface MaterialAggregate {
    material: Material
    /**
     * True when no benchmark-grade dataset exists for this material and the
     * numbers below come from the context-tier datasets instead (derived or
     * prescribed truth, restricted licences). A PROVISIONAL row: it lets a
     * material be tracked over time, and it must never gate a decision or enter
     * the overall headline. Which datasets it rests on is listed in `datasets`.
     */
    provisional: boolean
    /** Datasets behind the number (benchmark-grade, or the provisional set). */
    datasets: string[]
    clips: number
    f1: number
    f1Off: number
    precision: number
    recall: number
    repairSecondsPer100: number
    /** Datasets of this material that are reported but never pooled. */
    contextDatasets: string[]
    /**
     * The human-truth-only variant, present only where it differs: a pooled
     * (non-provisional) row resting partly on non-human truth (resynth).
     * `f1Human` / `f1OffHuman` are absent when no dataset of the material has
     * human truth.
     */
    humanDatasets?: string[]
    f1Human?: number
    f1OffHuman?: number
}

export interface EvalReport {
    label: string
    mode: 'adaptive' | 'adaptive-no-hint' | 'fixed'
    provider: string
    config: Record<string, unknown>
    matchTol: MatchOptions
    overallF1: number
    overallF1Off: number
    /**
     * The headline over the pooled datasets whose truth is human-annotated — the
     * number continuous with results recorded before resynthesised truth.
     * Absent when no such dataset was scored (the synthetic corpora).
     */
    overallF1Human?: number
    overallF1OffHuman?: number
    notePooling: {
        includeUntrusted: boolean
        derivedNoteTruth: string[]
        pitchless: string[]
        constructedPerformance: string[]
        licenceRestricted: string[]
        /** `pooled: false` in dataset.json. */
        optedOut: string[]
        excludedFromOverall: string[]
    }
    overallTiming: TimingStats
    perMaterial: MaterialAggregate[]
    perScenario: ScenarioAggregate[]
    perCondition: ConditionAggregate[]
    segErrors: SegErrorCounts
    repairSecondsPer100: number
    onsetClasses: OnsetClassStats
    clips: Array<
        { scenario: string; melody: string; condition: string; split: 'dev' | 'test' } & Metrics & {
                seg: SegErrorCounts
                onsetOnly: ClipResult['onsetOnly']
            }
    >
}

export type EvalScenario = Scenario & {
    dir?: string
    material: Material
    tier: ScenarioAggregate['tier']
    license?: string
    licenceRestricted: boolean
    truthSource: TruthSource
}

function buildProvider(name: string): PitchProvider {
    const backend = new LocalModelBackend({ crepeTiny: MODELS.crepeTiny })
    switch (name) {
        case 'crepe-tiny-down1':
            return new CrepePitchdownProvider(backend)
        case 'crepe-tiny':
        default:
            return new CrepeProvider(backend, 'crepe-tiny')
    }
}

/**
 * Real corpus: datasets are discovered from fixtures/eval-real rather than the
 * synthetic melody×register matrix. rootMidi is irrelevant for recorded clips
 * (nothing is synthesized), so it's zeroed. `dir` carries the dataset's actual
 * directory — since the benchmark/context tiering, datasets live one level below
 * the eval-real root, so `join(root, id)` no longer resolves them.
 */
function realScenarios(datasets: RealDataset[]): EvalScenario[] {
    return datasets.map((d) => ({
        id: d.id,
        label: d.label,
        kind: d.kind,
        instrumentId: d.instrumentId,
        rootMidi: 0,
        dir: d.dir,
        material: d.material,
        tier: d.tier,
        license: d.license,
        licenceRestricted: d.licenceRestricted ?? false,
        truthSource: d.truthSource,
    }))
}

function syntheticScenarios(): EvalScenario[] {
    return SCENARIOS.map((s) => ({
        ...s,
        material: s.kind === 'whistle' ? 'whistling' : s.kind === 'instrument' ? 'instrument' : 'singing',
        tier: 'synthetic',
        licenceRestricted: false,
        // Written notes rendered by generate.ts: exact because we built them.
        truthSource: 'constructed',
    }))
}

export function emptySegErrors(): SegErrorCounts {
    return {
        clean: 0,
        split: 0,
        merged: 0,
        missed: 0,
        spurious: 0,
        tangled: 0,
        pitchWrong: 0,
        refTotal: 0,
        estTotal: 0,
    }
}

export function sumSegErrors(rs: Array<{ seg: SegErrorCounts }>): SegErrorCounts {
    const total = emptySegErrors()
    for (const r of rs) {
        for (const k of Object.keys(total) as Array<keyof SegErrorCounts>) {
            total[k] += r.seg[k]
        }
    }
    return total
}

function sumOnsetClasses(rs: ClipResult[]): OnsetClassStats {
    const total = emptyOnsetClassStats()
    for (const r of rs) addOnsetClassStats(total, r.onsets)
    return total
}

export function mean(xs: number[]): number {
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0
}

type Transcribe = (scenario: Scenario, buf: Buffer, bpm: number) => Promise<EstNote[]>

/**
 * The source declaration the production path is given for a dataset. The corpus
 * knows what each dataset is; in the app this is either the client's declaration
 * or (since the source classifier) the audio itself. ALWAYS explicit here —
 * including for instruments — so eval numbers measure the pipeline, not the
 * classifier's day. Suppressed under noHint, which is also how to exercise the
 * classifier end-to-end.
 */
export function hintsFor(scenario: Scenario, noHint: boolean): ProfileHint {
    return {
        instrumentId: noHint ? undefined : scenario.instrumentId,
        sourceKind: noHint ? undefined : scenario.kind === 'voice' ? 'voice' : 'instrument',
    }
}

export async function buildTranscriber(o: EvalOptions, decoder: AudioDecoder): Promise<Transcribe> {
    if (o.adaptive) {
        const registry = new ProviderRegistry({ crepeTiny: MODELS.crepeTiny })
        await registry.initAll()
        const resolver = new ProfileResolver()
        return async (scenario, buf, bpm) => {
            const det = await decoder.decode(buf, DETECT_SR, { loudnorm: false, highpassHz: 30 })
            const profile = resolver.resolve(det.samples, DETECT_SR, hintsFor(scenario, o.noHint))
            const provider = registry.get(profile.providerName)
            const decoded = await decoder.decode(buf, provider.sampleRate, {
                loudnorm: provider.normalizeLoudness,
                highpassHz: profile.highpassHz,
                denoise: profile.denoise,
            })
            const extracted = await new AudioConverter(provider, {
                enableOnsetSplit: o.onsetSplit,
                profile,
            }).convert(decoded.samples, bpm, {
                minFreqHz: profile.minFreqHz,
                maxFreqHz: profile.maxFreqHz,
                confidenceThreshold: profile.confidenceThreshold,
                minFramesPerNote: profile.minFramesPerNote,
                segmentMode: profile.segmentMode,
                smoothFrames: profile.smoothFrames,
            })
            return extracted.deduced.map((n) => ({
                onsetSec: n.startTimeSeconds,
                durSec: n.durationSeconds,
                midi: n.pitchMidi,
            }))
        }
    }
    const provider = buildProvider(o.providerName)
    await provider.init()
    return async (_scenario, buf, bpm) => {
        const decoded = await decoder.decode(buf, provider.sampleRate, {
            loudnorm: provider.normalizeLoudness,
            highpassHz: o.highpassHz,
            denoise: o.fixedDenoise,
        })
        const extracted = await new AudioConverter(provider, {
            enableOnsetSplit: o.onsetSplit,
        }).convert(decoded.samples, bpm, o.pitchOptions)
        return extracted.deduced.map((n) => ({
            onsetSec: n.startTimeSeconds,
            durSec: n.durationSeconds,
            midi: n.pitchMidi,
        }))
    }
}

/** Which conditions a corpus can be scored under (real gets the `real` pseudo-condition first). */
export function conditionsFor(real: boolean, synth = false): Condition[] {
    if (synth) return SYNTH_CONDITIONS
    return real ? [REAL_CONDITION, ...CONDITIONS.filter((c) => c.id !== 'clean')] : CONDITIONS
}

/** What a run scores: the corpus root, its datasets, and the scenarios × conditions selected. */
export interface EvalCorpus {
    root: string
    /** Discovered datasets (empty for the legacy synthetic matrix). */
    datasets: RealDataset[]
    scenarios: EvalScenario[]
    conditions: Condition[]
}

export function selectCorpus(o: EvalOptions): EvalCorpus {
    const discovered = o.real || !!o.synth
    const root = o.synth ? SYNTH_REALISTIC_ROOT : o.real ? REAL_ROOT : SYNTH_ROOT
    const datasets = discovered ? discoverRealDatasets(root) : []
    const allScenarios = discovered ? realScenarios(datasets) : syntheticScenarios()
    return {
        root,
        datasets,
        scenarios: allScenarios.filter((s) => !o.scenarioFilter || o.scenarioFilter.includes(s.id)),
        conditions: conditionsFor(o.real, !!o.synth).filter((c) => !o.conditionFilter || o.conditionFilter.includes(c.id)),
    }
}

/** One scoreable clip × condition: the truth and the WAV it is scored on. */
export interface CorpusClip {
    scenario: EvalScenario
    clipId: string
    condition: Condition
    truth: GroundTruth
    wavPath: string
}

/** Every clip × condition of one scenario that has audio on disk (and passes `clipFilter`). */
export function scenarioClips(corpus: EvalCorpus, scenario: EvalScenario, clipFilter?: Set<string>): CorpusClip[] {
    const dir = scenario.dir ?? join(corpus.root, scenario.id)
    if (!existsSync(dir)) return []
    const out: CorpusClip[] = []
    for (const truthFile of readdirSync(dir).filter((f) => f.endsWith('.truth.json'))) {
        const clipId = truthFile.replace('.truth.json', '')
        if (clipFilter && !clipFilter.has(`${scenario.id}/${clipId}`)) continue
        const truth = JSON.parse(readFileSync(join(dir, truthFile), 'utf8')) as GroundTruth
        for (const condition of corpus.conditions) {
            const wavPath = join(dir, `${clipId}__${condition.id}.wav`)
            if (existsSync(wavPath)) out.push({ scenario, clipId, condition, truth, wavPath })
        }
    }
    return out
}

/** Score one clip's notes against its truth — every per-clip number the report aggregates. */
export function scoreClip(
    clip: { datasetId: string; clipId: string; condition: string; truth: GroundTruth },
    est: EstNote[],
    matchOpts: MatchOptions,
): ClipResult {
    const { truth } = clip
    return {
        scenario: clip.datasetId,
        melody: clip.clipId,
        condition: clip.condition,
        split: splitOf(clip.datasetId, clip.clipId),
        metrics: scoreNotesBest(truth, est, matchOpts),
        seg: segErrors(truth.notes, est),
        onsets: onsetRecallByClass(truth.notes, est, matchOpts.onsetTolSec),
        onsetOnly: scoreOnsets(truth.notes, est, matchOpts.onsetTolSec),
    }
}

export async function runEval(o: EvalOptions): Promise<EvalReport> {
    const corpus = selectCorpus(o)
    const transcribe = o.transcribe ?? (await productionTranscribe(o))

    const results: ClipResult[] = []
    for (const scenario of corpus.scenarios) {
        const dir = scenario.dir ?? join(corpus.root, scenario.id)
        if (!existsSync(dir)) continue
        const clips = scenarioClips(corpus, scenario, o.clipFilter)
        if (o.clipFilter && !clips.length) continue

        for (const clip of clips) {
            const { clipId, condition, truth, wavPath } = clip
            let est: EstNote[] = []
            let error: string | undefined
            try {
                est = await transcribe({
                    datasetId: scenario.id,
                    clipId,
                    condition: condition.id,
                    wavPath,
                    wav: readFileSync(wavPath),
                    bpm: truth.bpm,
                    ...hintsFor(scenario, o.noHint),
                    scenario,
                })
            } catch (err) {
                // A clip that won't decode/convert scores as zero rather than
                // aborting the whole run.
                error = String(err)
                console.warn(`  ! ${scenario.id}/${clipId}__${condition.id}: ${error}`)
            }
            o.onClip?.({ datasetId: scenario.id, clipId, condition: condition.id, notes: est, error })
            results.push(scoreClip({ datasetId: scenario.id, clipId, condition: condition.id, truth }, est, o.matchOpts))
        }
        const sc = results.filter((r) => r.scenario === scenario.id)
        o.onProgress?.(
            `  ${scenario.id.padEnd(30)} COnP@0.1=${mean(sc.map((r) => r.metrics.f1)).toFixed(2)}` +
                `  octErr=${mean(sc.map((r) => r.metrics.octaveErrorRate)).toFixed(2)}  (${sc.length} clips)`,
        )
    }
    return aggregateEval(o, corpus, results)
}

/** This checkout's pipeline (or the fixed config) as a `TranscribeFn`. */
async function productionTranscribe(o: EvalOptions): Promise<TranscribeFn> {
    const transcribe = await buildTranscriber(o, new AudioDecoder())
    return (job) => transcribe(job.scenario, job.wav, job.bpm)
}

/**
 * The report over scored clips: per dataset, per condition, per material and the
 * pooled headlines. Takes `ClipResult`s from anywhere (`scoreClip`), so notes
 * produced outside `runEval` aggregate exactly as a benchmark run does.
 */
export function aggregateEval(o: EvalOptions, corpus: EvalCorpus, results: ClipResult[]): EvalReport {
    const { datasets, scenarios, conditions } = corpus
    const byId = new Map(datasets.map((d) => [d.id, d]))
    const ids = (keep: (d: RealDataset) => boolean): string[] => datasets.filter(keep).map((d) => d.id)
    const derivedNoteTruth = new Set(ids((d) => !!d.noteTruthDerived))
    const pitchlessIds = new Set(ids((d) => !!d.pitchless))
    const constructedIds = new Set(ids((d) => !!d.constructedPerformance))
    // The legacy synthetic matrix has no manifests: every scenario pools.
    const pooled = (scenarioId: string): boolean => {
        const d = byId.get(scenarioId)
        return o.includeUntrusted || !d || isPooled(d)
    }

    // Aggregate per scenario. Timing is pooled across the scenario's matched
    // notes (not a mean of per-clip means), so the bias/spread reflect the real
    // distribution and aren't diluted by clips with few matches.
    const perScenario: ScenarioAggregate[] = scenarios.map((s) => {
        const rs = results.filter((r) => r.scenario === s.id)
        return {
            scenario: s.id,
            label: s.label,
            kind: s.kind,
            material: s.material,
            tier: s.tier,
            license: s.license,
            licenceRestricted: s.licenceRestricted,
            truthSource: s.truthSource,
            clips: rs.length,
            pooled: pooled(s.id),
            noteTruthDerived: derivedNoteTruth.has(s.id),
            pitchless: pitchlessIds.has(s.id),
            constructedPerformance: constructedIds.has(s.id),
            // MIREX COn — onset-only. Precision and recall reported separately because
            // for some onset corpora only one of them is meaningful (jacrc: syllable
            // onsets ⊂ note onsets, so read recall).
            onsetF1: mean(rs.map((r) => r.onsetOnly.f1)),
            onsetPrecision: mean(rs.map((r) => r.onsetOnly.precision)),
            onsetRecall: mean(rs.map((r) => r.onsetOnly.recall)),
            f1: mean(rs.map((r) => r.metrics.f1)),
            f1Off: mean(rs.map((r) => r.metrics.f1Off)),
            chromaF1: mean(rs.map((r) => r.metrics.chromaF1)),
            precision: mean(rs.map((r) => r.metrics.precision)),
            recall: mean(rs.map((r) => r.metrics.recall)),
            octaveErrorRate: mean(rs.map((r) => r.metrics.octaveErrorRate)),
            medianPitchErr: mean(rs.map((r) => r.metrics.medianPitchErr)),
            timing: timingStats(
                rs.flatMap((r) => r.metrics.timing.onsetDeltasMs),
                rs.flatMap((r) => r.metrics.timing.offsetDeltasMs),
            ),
            seg: sumSegErrors(rs),
            repairSecondsPer100: repairSecondsPer100(sumSegErrors(rs)),
            onsets: sumOnsetClasses(rs),
        }
    })

    // Per condition — the robustness axis.
    const perCondition: ConditionAggregate[] = conditions
        .map((c) => {
            const rs = results.filter((r) => r.condition === c.id && pooled(r.scenario))
            return {
                condition: c.id,
                label: c.label,
                clips: rs.length,
                f1: mean(rs.map((r) => r.metrics.f1)),
                f1Off: mean(rs.map((r) => r.metrics.f1Off)),
                precision: mean(rs.map((r) => r.metrics.precision)),
                recall: mean(rs.map((r) => r.metrics.recall)),
                octaveErrorRate: mean(rs.map((r) => r.metrics.octaveErrorRate)),
            }
        })
        .filter((c) => c.clips > 0)

    // Per material — what the product benchmark reads first. Dataset-mean over the
    // pooled datasets of that material, matching the headline's convention.
    const supersededIds = new Set(
        datasets.map((d) => d.derivedFrom?.split('/').pop()).filter((id): id is string => !!id && datasets.some((d) => d.id === id)),
    )
    const materials = [...new Set(perScenario.map((s) => s.material))].sort()
    const perMaterial: MaterialAggregate[] = materials.map((material) => {
        const ds = perScenario.filter((s) => s.material === material && s.clips > 0)
        let gated = ds.filter((s) => s.pooled)
        // No benchmark-grade dataset at all (humming, whistling today): fall back to
        // the context datasets that DO carry pitched truth, and say so. A dataset
        // whose truth was repaired into an `-aligned` sibling is skipped — its own
        // score-timed truth is known-wrong by construction and would only drag the
        // provisional number down.
        const provisional = gated.length === 0
        if (provisional) gated = ds.filter((s) => !s.pitchless && !supersededIds.has(s.scenario))
        const gatedClips = results.filter((r) => gated.some((s) => s.scenario === r.scenario))
        const human = gated.filter((s) => s.truthSource === 'human')
        return {
            material,
            provisional,
            datasets: gated.map((s) => s.scenario),
            clips: gatedClips.length,
            f1: mean(gated.map((s) => s.f1)),
            f1Off: mean(gated.map((s) => s.f1Off)),
            precision: mean(gated.map((s) => s.precision)),
            recall: mean(gated.map((s) => s.recall)),
            repairSecondsPer100: repairSecondsPer100(sumSegErrors(gatedClips)),
            contextDatasets: ds.filter((s) => !s.pooled && !gated.includes(s)).map((s) => s.scenario),
            ...(provisional || human.length === gated.length
                ? {}
                : {
                      humanDatasets: human.map((s) => s.scenario),
                      ...(human.length ? { f1Human: mean(human.map((s) => s.f1)), f1OffHuman: mean(human.map((s) => s.f1Off)) } : {}),
                  }),
        }
    })

    const pooledResults = results.filter((r) => pooled(r.scenario))
    const pooledScenarios = perScenario.filter((s) => s.pooled && s.clips > 0)
    const humanScenarios = pooledScenarios.filter((s) => s.truthSource === 'human')
    const excludedScenarios = perScenario.filter((s) => !s.pooled).map((s) => s.scenario)

    return {
        label: o.label,
        mode: o.adaptive ? (o.noHint ? 'adaptive-no-hint' : 'adaptive') : 'fixed',
        provider: o.adaptive ? 'registry' : o.providerName,
        config: o.adaptive ? { adaptive: true } : { ...o.pitchOptions, highpassHz: o.highpassHz },
        matchTol: o.matchOpts,
        overallF1: mean(pooledScenarios.map((s) => s.f1)),
        overallF1Off: mean(pooledScenarios.map((s) => s.f1Off)),
        ...(humanScenarios.length
            ? {
                  overallF1Human: mean(humanScenarios.map((s) => s.f1)),
                  overallF1OffHuman: mean(humanScenarios.map((s) => s.f1Off)),
              }
            : {}),
        notePooling: {
            includeUntrusted: o.includeUntrusted,
            derivedNoteTruth: [...derivedNoteTruth],
            pitchless: [...pitchlessIds],
            constructedPerformance: [...constructedIds],
            licenceRestricted: ids((d) => !!d.licenceRestricted),
            optedOut: ids((d) => d.pooled === false),
            excludedFromOverall: excludedScenarios,
        },
        // Excluded datasets are dropped from the timing pool too: their onsets are
        // frame-grid quantized by the same derivation, so they would bias the bias.
        overallTiming: timingStats(
            pooledResults.flatMap((r) => r.metrics.timing.onsetDeltasMs),
            pooledResults.flatMap((r) => r.metrics.timing.offsetDeltasMs),
        ),
        perMaterial,
        perScenario,
        perCondition,
        segErrors: sumSegErrors(pooledResults),
        repairSecondsPer100: repairSecondsPer100(sumSegErrors(pooledResults)),
        onsetClasses: sumOnsetClasses(pooledResults),
        clips: results.map((r) => ({
            scenario: r.scenario,
            melody: r.melody,
            condition: r.condition,
            split: r.split,
            ...r.metrics,
            seg: r.seg,
            onsetOnly: r.onsetOnly,
        })),
    }
}
