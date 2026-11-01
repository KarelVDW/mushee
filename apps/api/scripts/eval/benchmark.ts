/**
 * The product benchmark: ONE command that scores the production transcription
 * path over every real recording we hold, grouped by what the user is doing —
 * singing, humming, whistling, playing an instrument — records the result with
 * its provenance under `apps/eval/data/benchmarks/real/` (git-tracked, read by the
 * eval app), and compares two such results with paired confidence intervals.
 *
 *   tsx scripts/eval/benchmark.ts run [--label <name>] [--conditions real,echoey-room,…]
 *                                     [--datasets a,b] [--materials singing,…] [--split dev|test]
 *                                     [--quick] [--cached | --scratch]
 *   tsx scripts/eval/benchmark.ts compare <a.json> <b.json> [--split dev|test|all]
 *   tsx scripts/eval/benchmark.ts rescore <result id|path> [--label <name>]
 *   tsx scripts/eval/benchmark.ts render [<result.json>]
 *   (add --synth to any of them for the realistic synthetic corpus, fixtures/eval-synth)
 *
 * `run` drives `lib/evalRun.ts` exactly as `EVAL_REAL=1 EVAL_ADAPTIVE=1 run-eval.ts`
 * would (the number that corresponds to what a user hears: resolver, routing,
 * decode, cleanup and the quantisation round-trip), then writes
 *
 *   apps/eval/data/benchmarks/real/<UTC timestamp>_<git sha>_<label>.json   compact, committed
 *   scripts/eval/benchmarks/RESULTS.md        regenerated from every result
 *   scripts/eval/.cache/notes/<result id>.jsonl   the notes the pipeline produced, one line
 *                                             per clip × condition (gitignored; the eval app's
 *                                             comparison view reads them)
 *
 * `--quick` scores only the `real` condition (the adverse variants roughly double
 * the run). `compare` pairs the two results clip-by-clip (dataset, clip,
 * condition) and reports the paired-bootstrap Δ COnP per material, per dataset
 * and per condition — a change is only a result when its interval excludes zero.
 * `rescore` rebuilds a recorded run from its cached notes against the CURRENT
 * truth (no model loaded), for when the truth changed after the run.
 *
 * Experiment runs (not for committing): `--cached` replays the same production
 * decode from the track caches (`lib/trackCache.ts`, `lib/variantCache.ts`;
 * built on a miss) instead of running the model — seconds instead of hours, for
 * anything downstream of CREPE (`lib/decodeCached.ts` `notesAsProduction`).
 * `--scratch` runs the real path but, like `--cached`, writes the result under
 * `.cache/bench-scratch/` and leaves RESULTS.md alone. `compare` resolves ids
 * there when given either flag. `--split` scores only that half of every
 * dataset (lib/split.ts); `--materials` narrows to datasets of those materials.
 * `--cached` without `--datasets` scores the pooled datasets only.
 *
 * Conventions (see benchmarks/README.md): headline metric COnP@±100 ms (onset +
 * pitch, no offset gate); COnPOff at the same window is the secondary,
 * publication-comparable column; pooled numbers are means of DATASET means over
 * the benchmark-grade datasets only — `noteTruthDerived`, `pitchless`,
 * `constructedPerformance`, `licenceRestricted` and `pooled: false` corpora are
 * reported per row and never pooled (`isPooled`, lib/realCorpus.ts). The headline
 * is reported twice: over every pooled dataset and over those with human truth.
 *
 * The module also exports the committed result schema and `compact()`, so a
 * scorer of notes produced elsewhere (lib/evalRun.ts `scoreClip` +
 * `aggregateEval`) writes results this file can render and compare.
 */

import { execSync } from 'child_process'
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'fs'
import { basename, dirname, join, relative, resolve } from 'path'

import { ProviderRegistry } from '../../src/recordings/pipeline/providers/provider-registry'
import { notesAsProduction } from './lib/decodeCached'
import {
    aggregateEval,
    type ClipResult,
    conditionsFor,
    type CorpusClip,
    defaultEvalOptions,
    type EvalReport,
    hintsFor,
    mean,
    REAL_ROOT,
    runEval,
    scenarioClips,
    scoreClip,
    selectCorpus,
    SYNTH_REALISTIC_ROOT,
    type TranscribeFn,
} from './lib/evalRun'
import type { EstNote } from './lib/metrics'
import {
    discoverRealDatasets,
    inferTruthSource,
    isPooled,
    listRealClips,
    type Material,
    type RealDataset,
    truthFingerprint,
    type TruthSource,
} from './lib/realCorpus'
import { inSplit, type Split, splitOf } from './lib/split'
import { formatComparison, pairedDiffCI } from './lib/stats'
import { TrackCache } from './lib/trackCache'
import { VariantTrackCache } from './lib/variantCache'
import { printReport } from './run-eval'

const BENCH_DIR = resolve(__dirname, 'benchmarks')
/**
 * The committed result JSON lives with the eval app, which reads it (git-tracked,
 * one file per run); the generated markdown stays here beside the method doc.
 */
const DATA_DIR = resolve(__dirname, '../../../eval/data/benchmarks')
/**
 * `--synth` scores the REALISTIC synthetic corpus (fixtures/eval-synth: every app
 * instrument + eight voice types, rendered from real recordings with exact truth)
 * instead of the real one. Its history is kept apart — data/benchmarks/synth/ and
 * RESULTS-SYNTH.md — so the real benchmark's trend line never mixes corpora.
 * Results scored on superseded corpus versions sit in synth/archive/, which
 * `render` does not read.
 */
const SYNTH = process.argv.includes('--synth')
/** `--cached` / `--scratch`: experiment runs, kept out of the committed history (see the header). */
const CACHED = process.argv.includes('--cached')
const SCRATCH = CACHED || process.argv.includes('--scratch')
const COMMITTED_DIR = join(DATA_DIR, SYNTH ? 'synth' : 'real')
const RESULTS_DIR = SCRATCH ? resolve(__dirname, '.cache/bench-scratch', SYNTH ? 'synth' : 'real') : COMMITTED_DIR
const RESULTS_MD = join(BENCH_DIR, SYNTH ? 'RESULTS-SYNTH.md' : 'RESULTS.md')
/** Per-run pipeline notes, `<result id>.jsonl` — gitignored with the rest of .cache. */
const NOTES_DIR = resolve(__dirname, '.cache/notes')
/** The track caches `--cached` replays (shared with the sweeps). */
const TRACK_CACHE_ROOT = resolve(__dirname, '../fixtures/eval-cache')
const VARIANT_CACHE_ROOT = resolve(__dirname, '../fixtures/eval-cache-variant')

/** Display order: the product's inputs first, the special axis last. */
const MATERIAL_ORDER: Material[] = ['singing', 'humming', 'whistling', 'instrument', 'vocal-percussion']

/** One scored clip × condition, compacted for the committed file. */
export interface BenchClip {
    d: string // dataset
    c: string // clip
    cond: string
    split: 'dev' | 'test'
    f1: number
    f1Off: number
    p: number
    r: number
    onF1: number // COn
    onR: number // COn recall
}

/** What a result records about one scored dataset's truth (see `corpusProvenance`). */
export interface CorpusFingerprint {
    truthSource: TruthSource
    /** Clips in the dataset (truth files), whether or not a filter scored them all. */
    clips: number
    /** sha1 over the dataset's truth files — `truthFingerprint` in lib/realCorpus.ts. */
    truthHash: string
    corpusVersion?: string
}

/**
 * The committed result. Fields marked "since 2026-10-30" are absent from earlier
 * files; readers fall back as `render` does (`truthSourceOf`, `humanHeadline`).
 */
export interface BenchResult {
    meta: {
        id: string
        label: string
        date: string
        gitSha: string
        gitDirty: boolean
        node: string
        durationSec: number
        conditions: string[]
        quick: boolean
        /** `--cached`: notes decoded from the track caches, not by the model. */
        cached?: boolean
        /** `--split`: only that half of each dataset was scored. */
        split?: 'dev' | 'test'
        /** Dataset ids actually scored (clips > 0). */
        datasets: string[]
        matchTol: EvalReport['matchTol']
        /** Pipeline / eval env overrides set for the run (`pipelineEnv`); `{}` = defaults. Since 2026-10-30. */
        env?: Record<string, string>
        /** Per scored dataset: where its truth came from and a hash of it. Since 2026-10-30. */
        corpus?: Record<string, CorpusFingerprint>
        /** The generated corpus's version, when every scored dataset declares the same one. */
        corpusVersion?: string
        /**
         * Set by `rescore`: when this result was rebuilt from the run's cached notes
         * against newer truth. The provenance above (sha, date, duration, env) is
         * still the run's; `corpus` is the truth scored against at `rescoredAt`. Since 2026-10-31.
         */
        rescoredAt?: string
        /** The result it was rebuilt from, and the truth fingerprints the RUN was scored against (kept through repeated rescores). */
        rescoredFrom?: { id: string; corpus?: Record<string, CorpusFingerprint> }
    }
    overallF1: number
    overallF1Off: number
    /** Human-truth-only headline (`EvalReport.overallF1Human`). Since 2026-10-30. */
    overallF1Human?: number
    overallF1OffHuman?: number
    perMaterial: EvalReport['perMaterial']
    perScenario: Array<
        Pick<
            EvalReport['perScenario'][number],
            | 'scenario'
            | 'material'
            | 'tier'
            | 'license'
            | 'licenceRestricted'
            | 'clips'
            | 'pooled'
            | 'noteTruthDerived'
            | 'pitchless'
            | 'constructedPerformance'
            | 'f1'
            | 'f1Off'
            | 'chromaF1'
            | 'precision'
            | 'recall'
            | 'octaveErrorRate'
            | 'onsetF1'
            | 'onsetRecall'
            | 'repairSecondsPer100'
        > & {
            /** Since 2026-10-30. */
            truthSource?: TruthSource
            seg: { split: number; merged: number; missed: number; spurious: number; refTotal: number }
        }
    >
    perCondition: EvalReport['perCondition']
    clips: BenchClip[]
}

// ---------------------------------------------------------------------------
// args
// ---------------------------------------------------------------------------

function arg(name: string): string | undefined {
    const i = process.argv.indexOf(`--${name}`)
    return i >= 0 ? process.argv[i + 1] : undefined
}
function flag(name: string): boolean {
    return process.argv.includes(`--${name}`)
}
/** The options that take a value — everything else after the command is a flag or a positional. */
const VALUED = ['--label', '--conditions', '--datasets', '--materials', '--split']
/** A label as it appears in a result id. */
function cleanLabel(v: string): string {
    return v.replace(/[^A-Za-z0-9._-]+/g, '-')
}
/** Positional arguments after the command (`render --synth <x>` must not read `--synth` as a path). */
function positionals(): string[] {
    const rest = process.argv.slice(3)
    return rest.filter((a, i) => !a.startsWith('--') && !VALUED.includes(rest[i - 1]))
}
function list(v: string | undefined): string[] | undefined {
    return v
        ? v
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
        : undefined
}

/**
 * What `gitDirty` watches: the pipeline and the harness CODE. Markdown (the
 * generated RESULTS*.md included) and the label/annotation files (their effect
 * reaches a run only through the truth files, which `meta.corpus` fingerprints)
 * are left out; the result JSON lives in apps/eval. Regenerating the markdown or
 * leaving an earlier result uncommitted therefore no longer flags every later
 * run as dirty. Relative to this directory.
 */
const DIRTY_PATHSPEC = ['../../src', '.', "':(exclude,glob)**/*.md'", "':(exclude)annotations'", "':(exclude)benchmarks'"].join(' ')

function git(cmd: string): string {
    try {
        return execSync(`git ${cmd}`, { cwd: __dirname, stdio: ['ignore', 'pipe', 'ignore'] })
            .toString()
            .trim()
    } catch {
        return ''
    }
}

// ---------------------------------------------------------------------------
// run
// ---------------------------------------------------------------------------

function round(x: number): number {
    return Math.round(x * 1000) / 1000
}

/**
 * Env knobs that can move a number: the pipeline's overrides (src/recordings/
 * pipeline — `RECORDING_*`, the onset-policy and extractor switches) and the
 * harness's own (`EVAL_*`, `CREPE_*`).
 */
const PIPELINE_ENV = /^(RECORDING_|EVAL_|CREPE_|VOICE_ONSET_|EXTRACTOR_|SUSTAINED_ONSET_)|^ONSET_(POLICY|DIP_RATIO)$/

/**
 * Every pipeline / eval override set for this process. The pipeline reads an
 * empty value as unset, so only non-empty ones are recorded; `{}` means the run
 * measured the defaults. (Labels like `pre-onset-policy` used to be the only
 * record of an A/B run's env.)
 */
export function pipelineEnv(): Record<string, string> {
    return Object.fromEntries(
        Object.entries(process.env)
            .filter((e): e is [string, string] => PIPELINE_ENV.test(e[0]) && !!e[1])
            .sort(([a], [b]) => a.localeCompare(b)),
    )
}

/** Truth provenance per dataset (`meta.corpus`): its truth source, clip count and truth hash. */
export function corpusFingerprints(datasets: RealDataset[]): Record<string, CorpusFingerprint> {
    return Object.fromEntries(
        datasets.map((d) => [
            d.id,
            { truthSource: d.truthSource, ...truthFingerprint(d.dir), ...(d.corpusVersion ? { corpusVersion: d.corpusVersion } : {}) },
        ]),
    )
}

/** The fingerprints of the scored datasets, plus `corpusVersion` when they all declare the same one. */
export function corpusProvenance(
    fingerprints: Record<string, CorpusFingerprint>,
    scored: string[],
): Pick<BenchResult['meta'], 'corpus' | 'corpusVersion'> {
    const corpus = Object.fromEntries(scored.filter((id) => fingerprints[id]).map((id) => [id, fingerprints[id]]))
    const versions = new Set(Object.values(corpus).map((f) => f.corpusVersion))
    const [only] = [...versions]
    return { corpus, ...(versions.size === 1 && only ? { corpusVersion: only } : {}) }
}

/** An `EvalReport` reduced to the committed result (3-decimal metrics, one compact row per clip). */
export function compact(report: EvalReport, meta: BenchResult['meta']): BenchResult {
    return {
        meta,
        overallF1: round(report.overallF1),
        overallF1Off: round(report.overallF1Off),
        ...(report.overallF1Human !== undefined && report.overallF1OffHuman !== undefined
            ? { overallF1Human: round(report.overallF1Human), overallF1OffHuman: round(report.overallF1OffHuman) }
            : {}),
        perMaterial: report.perMaterial.map((m) => ({
            ...m,
            f1: round(m.f1),
            f1Off: round(m.f1Off),
            precision: round(m.precision),
            recall: round(m.recall),
            repairSecondsPer100: Math.round(m.repairSecondsPer100),
            ...(m.f1Human !== undefined && m.f1OffHuman !== undefined
                ? { f1Human: round(m.f1Human), f1OffHuman: round(m.f1OffHuman) }
                : {}),
        })),
        perScenario: report.perScenario
            .filter((s) => s.clips > 0)
            .map((s) => ({
                scenario: s.scenario,
                material: s.material,
                tier: s.tier,
                license: s.license,
                licenceRestricted: s.licenceRestricted,
                truthSource: s.truthSource,
                clips: s.clips,
                pooled: s.pooled,
                noteTruthDerived: s.noteTruthDerived,
                pitchless: s.pitchless,
                constructedPerformance: s.constructedPerformance,
                f1: round(s.f1),
                f1Off: round(s.f1Off),
                chromaF1: round(s.chromaF1),
                precision: round(s.precision),
                recall: round(s.recall),
                octaveErrorRate: round(s.octaveErrorRate),
                onsetF1: round(s.onsetF1),
                onsetRecall: round(s.onsetRecall),
                repairSecondsPer100: Math.round(s.repairSecondsPer100),
                seg: {
                    split: s.seg.split,
                    merged: s.seg.merged,
                    missed: s.seg.missed,
                    spurious: s.seg.spurious,
                    refTotal: s.seg.refTotal,
                },
            })),
        perCondition: report.perCondition.map((c) => ({
            ...c,
            f1: round(c.f1),
            f1Off: round(c.f1Off),
            precision: round(c.precision),
            recall: round(c.recall),
            octaveErrorRate: round(c.octaveErrorRate),
        })),
        clips: report.clips.map((c) => ({
            d: c.scenario,
            c: c.melody,
            cond: c.condition,
            split: c.split,
            f1: round(c.f1),
            f1Off: round(c.f1Off),
            p: round(c.precision),
            r: round(c.recall),
            onF1: round(c.onsetOnly.f1),
            onR: round(c.onsetOnly.recall),
        })),
    }
}

async function run(): Promise<void> {
    const quick = flag('quick')
    const label = cleanLabel(arg('label') ?? 'baseline')
    const conditions =
        list(arg('conditions')) ??
        (SYNTH
            ? // what users' takes sound like; the dry render is a diagnostic reference, opt in with --conditions
              conditionsFor(false, true)
                  .map((c) => c.id)
                  .filter((c) => c !== 'dry' && (!quick || c === 'home-phone'))
            : quick
              ? ['real']
              : conditionsFor(true).map((c) => c.id))
    const named = list(arg('datasets'))
    const materials = list(arg('materials'))
    const splitArg = arg('split')
    if (splitArg && splitArg !== 'dev' && splitArg !== 'test') throw new Error(`--split must be dev or test (got ${splitArg})`)
    const split = splitArg as Exclude<Split, 'all'> | undefined
    const corpusDatasets = discoverRealDatasets(SYNTH ? SYNTH_REALISTIC_ROOT : REAL_ROOT)
    // `--cached` defaults to the pooled datasets: the context sets add no headline, and
    // HumTrans (1,538 clips) has no cache entries — replaying it means building them.
    const byDefault = (d: RealDataset): boolean => !CACHED || isPooled(d)
    const selected = corpusDatasets.filter(
        (d) => (named ? named.includes(d.id) : byDefault(d)) && (!materials || materials.includes(d.material)),
    )
    const datasetFilter = named || materials || CACHED ? selected.map((d) => d.id) : undefined
    const clipFilter = split
        ? new Set(
              selected.flatMap((d) =>
                  listRealClips(d.dir)
                      .filter((c) => inSplit(d.id, c, split))
                      .map((c) => `${d.id}/${c}`),
              ),
          )
        : undefined
    const started = Date.now()
    console.log(
        `benchmark: label=${label} conditions=${conditions.join(',')}` +
            `${CACHED ? ' cached' : ''}${split ? ` split=${split}` : ''}${datasetFilter ? ` datasets=${datasetFilter.length}` : ''}`,
    )

    // Provenance is taken before scoring: the code and truth a run loads at the
    // start are what it measures, whatever changes in the tree during a 3 h run.
    const sha = git('rev-parse --short HEAD') || 'nogit'
    const dirty = git(`status --porcelain -- ${DIRTY_PATHSPEC}`) !== ''
    const env = pipelineEnv()
    const fingerprints = corpusFingerprints(selected)

    // The notes go to a partial file while the run lasts; the result id (which
    // carries the finish time) names it at the end.
    mkdirSync(NOTES_DIR, { recursive: true })
    const partialNotes = join(NOTES_DIR, `.partial-${started}-${process.pid}.jsonl`)
    writeFileSync(partialNotes, '')

    const report = await runEval(
        defaultEvalOptions({
            real: !SYNTH,
            synth: SYNTH,
            adaptive: true,
            label,
            conditionFilter: conditions,
            scenarioFilter: datasetFilter,
            clipFilter,
            transcribe: CACHED ? await cachedTranscriber(selected) : undefined,
            onProgress: (line) => console.log(line),
            onClip: (c) =>
                appendFileSync(
                    partialNotes,
                    JSON.stringify({
                        d: c.datasetId,
                        c: c.clipId,
                        cond: c.condition,
                        notes: c.notes.map((n) => ({ onsetSec: n.onsetSec, durSec: n.durSec, midi: n.midi })),
                        ...(c.error ? { error: c.error } : {}),
                    }) + '\n',
                ),
        }),
    )
    printReport(report)

    const date = new Date().toISOString()
    const id = `${date.replace(/[:.]/g, '-').slice(0, 19)}_${sha}_${label}`
    const scored = report.perScenario.filter((s) => s.clips > 0).map((s) => s.scenario)
    const result = compact(report, {
        id,
        label,
        date,
        gitSha: sha,
        gitDirty: dirty,
        node: process.version,
        durationSec: Math.round((Date.now() - started) / 1000),
        conditions,
        quick,
        ...(CACHED ? { cached: true } : {}),
        ...(split ? { split } : {}),
        datasets: scored,
        matchTol: report.matchTol,
        env,
        ...corpusProvenance(fingerprints, scored),
    })

    mkdirSync(RESULTS_DIR, { recursive: true })
    const out = join(RESULTS_DIR, `${id}.json`)
    writeFileSync(out, JSON.stringify(result))
    const notes = join(NOTES_DIR, `${id}.jsonl`)
    renameSync(partialNotes, notes)
    console.log(`\nResult written to ${out}${dirty ? '  (working tree DIRTY — label it as such)' : ''}`)
    console.log(`Notes written to ${notes}`)
    if (!SCRATCH) render(out)
}

/**
 * `--cached`: the production decode replayed from the track caches — the clean
 * take from `TrackCache`, an adverse variant from `VariantTrackCache` — so a
 * change downstream of CREPE is scored in seconds. A missing or stale entry is
 * built (the model runs once for it and the entry is written). Bit-identical to
 * `run` only where the cached profile is what the resolver returns today; see
 * the parity notes in `lib/decodeCached.ts`.
 */
async function cachedTranscriber(datasets: RealDataset[]): Promise<TranscribeFn> {
    if (SYNTH) throw new Error('--cached has no cache for the synthetic corpus')
    const registry = new ProviderRegistry({ crepeTiny: resolve(process.cwd(), 'model-crepe-tiny') })
    await registry.initAll()
    const tracks = new TrackCache(registry, TRACK_CACHE_ROOT)
    const variants = new VariantTrackCache(registry, VARIANT_CACHE_ROOT)
    const byId = new Map(datasets.map((d) => [d.id, d]))
    return async (job) => {
        const ds = byId.get(job.datasetId)
        if (!ds) throw new Error(`no dataset ${job.datasetId}`)
        const entry = job.condition === 'real' ? await tracks.load(ds, job.clipId) : await variants.load(ds, job.clipId, job.condition)
        if (!entry) throw new Error('no cache entry (unreadable audio, or no trajectory)')
        return notesAsProduction(entry, job.bpm).map((n) => ({
            onsetSec: n.startTimeSeconds,
            durSec: n.durationSeconds,
            midi: n.pitchMidi,
        }))
    }
}

// ---------------------------------------------------------------------------
// render
// ---------------------------------------------------------------------------

function loadResult(path: string): BenchResult {
    return JSON.parse(readFileSync(path, 'utf8')) as BenchResult
}

function allResults(): BenchResult[] {
    if (!existsSync(RESULTS_DIR)) return []
    return readdirSync(RESULTS_DIR)
        .filter((f) => f.endsWith('.json'))
        .sort()
        .map((f) => loadResult(join(RESULTS_DIR, f)))
}

function fmt(x: number | undefined, digits = 3): string {
    return x === undefined || Number.isNaN(x) ? '—' : x.toFixed(digits)
}

function per100(n: number, total: number): string {
    return total ? String(Math.round((n / total) * 100)) : '—'
}

function materialOf(r: BenchResult, m: Material): BenchResult['perMaterial'][number] | undefined {
    return r.perMaterial.find((x) => x.material === m)
}

/** A row's truth source; results recorded before 2026-10-30 carry only the flags it is inferred from. */
function truthSourceOf(s: BenchResult['perScenario'][number]): TruthSource {
    return s.truthSource ?? inferTruthSource(s)
}

/**
 * The human-truth headline and how many datasets it rests on. Results recorded
 * before it existed pooled human truth only (every other source was unpooled),
 * so for them it is the headline itself.
 */
function humanHeadline(r: BenchResult): { f1: number; f1Off: number; datasets: number } | undefined {
    const pooled = r.perScenario.filter((s) => s.pooled && s.clips > 0)
    const human = pooled.filter((s) => truthSourceOf(s) === 'human')
    if (!human.length) return undefined
    if (r.overallF1Human !== undefined && r.overallF1OffHuman !== undefined)
        return { f1: r.overallF1Human, f1Off: r.overallF1OffHuman, datasets: human.length }
    if (human.length === pooled.length) return { f1: r.overallF1, f1Off: r.overallF1Off, datasets: human.length }
    return { f1: mean(human.map((s) => s.f1)), f1Off: mean(human.map((s) => s.f1Off)), datasets: human.length }
}

/** Markdown for one result — the "current numbers" half of RESULTS.md. */
function renderResult(r: BenchResult): string {
    const lines: string[] = []
    lines.push(`## Latest run: \`${r.meta.id}\``, '')
    lines.push(
        `- **Date** ${r.meta.date.slice(0, 16).replace('T', ' ')} UTC · **commit** \`${r.meta.gitSha}\`` +
            `${r.meta.gitDirty ? ' (dirty tree)' : ''} · **label** ${r.meta.label} · ${r.meta.durationSec} s · node ${r.meta.node}`,
    )
    if (r.meta.rescoredAt) {
        lines.push(
            `- **Rescored** ${r.meta.rescoredAt.slice(0, 16).replace('T', ' ')} UTC from the run's cached notes against the truth of that day ` +
                '(`benchmark.ts rescore`): the pipeline output is the run’s, the truth is newer',
        )
    }
    lines.push(
        `- **Conditions** ${r.meta.conditions.join(', ')}${r.meta.quick ? ' (quick: real only)' : ''} · ` +
            `**match** onset ±${Math.round(r.meta.matchTol.onsetTolSec * 1000)} ms, exact MIDI; COnPOff adds offset within max(50 ms, 20 %)`,
    )
    const pooledCount = r.perScenario.filter((s) => s.pooled).length
    // The conditions actually scored: a full run requests every condition, but only the variants on disk count.
    const conds = [...new Set(r.clips.map((c) => c.cond))].map((c) => `\`${c}\``)
    lines.push(
        `- **Headline** COnP **${fmt(r.overallF1)}** · COnPOff ${fmt(r.overallF1Off)} — mean of dataset means over the ` +
            `${pooledCount} ${SYNTH ? 'synthetic datasets (rendered performances, exact truth)' : 'benchmark-grade datasets'}, ` +
            `${conds.length > 1 ? `conditions ${conds.join(', ')} pooled` : `condition ${conds[0]} only`}`,
    )
    const human = humanHeadline(r)
    if (human) {
        lines.push(
            `- **Human-truth headline** COnP **${fmt(human.f1)}** · COnPOff ${fmt(human.f1Off)} — the same over the ` +
                `${human.datasets} pooled datasets whose truth is human-annotated (the number continuous with runs before resynthesised truth)`,
        )
    }
    lines.push('')

    lines.push('### By material', '')
    lines.push(
        '_Italic_ rows are **provisional**: no benchmark-grade corpus exists for that material, so the row is computed from the context-tier datasets named in it (derived or prescribed truth, or a restricted licence). They track the material over time and never enter the overall headline.',
        '',
    )
    lines.push(
        '| material | COnP | COnPOff | precision | recall | repair s/100 | benchmark datasets | context-only (reported, never pooled) |',
    )
    lines.push('|---|---|---|---|---|---|---|---|')
    for (const m of MATERIAL_ORDER) {
        const x = materialOf(r, m)
        if (!x) continue
        const has = x.datasets.length > 0
        const gate = !has
            ? '**none**'
            : x.provisional
              ? `**none — PROVISIONAL row** from ${x.datasets.length} context dataset(s): ${x.datasets.join(', ')} (${x.clips} clip×cond)`
              : `${x.datasets.length} (${x.clips} clip×cond)` +
                (!x.humanDatasets
                    ? ''
                    : x.f1Human === undefined
                      ? '; none with human truth'
                      : `; human truth only: COnP ${fmt(x.f1Human)} · COnPOff ${fmt(x.f1OffHuman)} over ${x.humanDatasets.length}`)
        const f = (v: number, d = 3): string => (!has ? '—' : x.provisional ? `_${fmt(v, d)}_` : d === 3 ? `**${fmt(v)}**` : fmt(v, d))
        lines.push(
            `| ${m} | ${f(x.f1)} | ${!has ? '—' : x.provisional ? `_${fmt(x.f1Off)}_` : fmt(x.f1Off)} | ` +
                `${f(x.precision, 2)} | ${f(x.recall, 2)} | ${has ? x.repairSecondsPer100 : '—'} | ${gate} | ${x.contextDatasets.join(', ') || '—'} |`,
        )
    }
    lines.push('')

    lines.push('### By dataset', '')
    lines.push(
        '| dataset | material | tier | licence | truth | clip×cond | COnP | COnPOff | COn | COn recall | octErr | split / merged / missed / spurious per 100 | repair s/100 | pooled |',
    )
    lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|')
    const rows = [...r.perScenario].sort(
        (a, b) =>
            MATERIAL_ORDER.indexOf(a.material) - MATERIAL_ORDER.indexOf(b.material) ||
            Number(b.pooled) - Number(a.pooled) ||
            a.scenario.localeCompare(b.scenario),
    )
    for (const s of rows) {
        const why = s.pitchless
            ? 'no (pitchless — read COn)'
            : s.constructedPerformance
              ? 'no (constructed performance)'
              : s.noteTruthDerived
                ? 'no (derived truth)'
                : s.pooled
                  ? 'yes'
                  : s.licenceRestricted
                    ? 'no (restricted licence)'
                    : 'no (opted out)'
        lines.push(
            `| ${s.scenario} | ${s.material} | ${s.tier} | ${s.license ?? '—'}${s.licenceRestricted ? ' ⚠ internal eval only' : ''} | ${truthSourceOf(s)} | ` +
                `${s.clips} | ${s.pitchless ? '—' : fmt(s.f1, 2)} | ${s.pitchless ? '—' : fmt(s.f1Off, 2)} | ` +
                `${fmt(s.onsetF1, 2)} | ${fmt(s.onsetRecall, 2)} | ${s.pitchless ? '—' : fmt(s.octaveErrorRate, 2)} | ` +
                `${per100(s.seg.split, s.seg.refTotal)} / ${per100(s.seg.merged, s.seg.refTotal)} / ${per100(s.seg.missed, s.seg.refTotal)} / ${per100(s.seg.spurious, s.seg.refTotal)} | ` +
                `${s.repairSecondsPer100} | ${why} |`,
        )
    }
    lines.push('')

    if (r.perCondition.length > 1) {
        lines.push('### By condition (benchmark-grade datasets only)', '')
        lines.push('| condition | clips | COnP | COnPOff | precision | recall | octErr |')
        lines.push('|---|---|---|---|---|---|---|')
        for (const c of r.perCondition) {
            lines.push(
                `| ${c.condition} | ${c.clips} | ${fmt(c.f1)} | ${fmt(c.f1Off)} | ${fmt(c.precision, 2)} | ${fmt(c.recall, 2)} | ${fmt(c.octaveErrorRate, 2)} |`,
            )
        }
        lines.push('')
    }
    return lines.join('\n')
}

/** The result file as a link relative to the markdown that lists it. */
function resultLink(r: BenchResult): string {
    return `${relative(dirname(RESULTS_MD), RESULTS_DIR)}/${r.meta.id}.json`
}

function renderHistory(results: BenchResult[]): string {
    const lines: string[] = []
    lines.push('## History', '')
    lines.push(
        'Every committed run, oldest first. Compare two rows with `benchmark.ts compare <a> <b>` before ' +
            'reading anything into a difference — per-clip σ is ~0.2–0.3, so only a paired interval that excludes zero is a result.',
        '',
    )
    // The human-truth headline gets a column once any run has human-truth datasets (never, on the synthetic corpus).
    const withHuman = results.some((r) => humanHeadline(r))
    lines.push(
        `| date (UTC) | commit | label | conditions | overall COnP |${withHuman ? ' human-truth COnP |' : ''} ` +
            'singing | humming | whistling | instrument | vocal-perc. COn | file |',
    )
    lines.push(`|---|---|---|---|---|${withHuman ? '---|' : ''}---|---|---|---|---|---|`)
    for (const r of results) {
        const m = (mat: Material): string => {
            const x = materialOf(r, mat)
            if (!x || !x.datasets.length) return '—'
            return x.provisional ? `_${fmt(x.f1)}_` : fmt(x.f1)
        }
        // Vocal percussion has no pitch — its onset-only number lives on the dataset rows.
        const vp = r.perScenario.filter((s) => s.material === 'vocal-percussion')
        const vpOn = vp.length ? fmt(vp.reduce((a, s) => a + s.onsetF1, 0) / vp.length, 2) : '—'
        lines.push(
            `| ${r.meta.date.slice(0, 16).replace('T', ' ')} | \`${r.meta.gitSha}\`${r.meta.gitDirty ? '*' : ''} | ${r.meta.label}${r.meta.rescoredAt ? ` (rescored ${r.meta.rescoredAt.slice(0, 10)})` : ''} | ` +
                `${r.meta.quick ? 'real' : r.meta.conditions.length + ' cond.'} | **${fmt(r.overallF1)}** | ` +
                `${withHuman ? `${fmt(humanHeadline(r)?.f1)} | ` : ''}${m('singing')} | ${m('humming')} | ` +
                `${m('whistling')} | ${m('instrument')} | ${vpOn} | [\`${r.meta.id}.json\`](${resultLink(r)}) |`,
        )
    }
    lines.push(
        '',
        '`*` = working tree was dirty when the run was recorded. _Italic_ = provisional (context-tier truth only). ' +
            '"rescored" = the run’s notes scored again against the truth of that date (`benchmark.ts rescore`).',
        '',
    )
    return lines.join('\n')
}

function render(current?: string): void {
    const results = allResults()
    if (!results.length) {
        console.log('No results to render.')
        return
    }
    const cur = current ? loadResult(current) : results[results.length - 1]
    const md = [
        '# Benchmark results',
        '',
        '_Generated by `scripts/eval/benchmark.ts` — do not edit by hand. Method, corpus tiers and how to read the columns: [README.md](README.md)._',
        '',
        renderResult(cur),
        renderHistory(results),
    ].join('\n')
    writeFileSync(RESULTS_MD, md)
    console.log(`${basename(RESULTS_MD)} regenerated (${results.length} runs) → ${RESULTS_MD}`)
}

// ---------------------------------------------------------------------------
// compare
// ---------------------------------------------------------------------------

function keyOf(c: BenchClip): string {
    return `${c.d}/${c.c}/${c.cond}`
}

function compare(aPath: string, bPath: string): void {
    const a = loadResult(aPath)
    const b = loadResult(bPath)
    const split = (arg('split') ?? 'all') as 'dev' | 'test' | 'all'
    const bByKey = new Map(b.clips.map((c) => [keyOf(c), c]))
    const pooledIds = new Set(b.perScenario.filter((s) => s.pooled).map((s) => s.scenario))
    const humanIds = new Set(b.perScenario.filter((s) => s.pooled && truthSourceOf(s) === 'human').map((s) => s.scenario))
    const materialById = new Map(b.perScenario.map((s) => [s.scenario, s.material]))

    type Pair = { key: string; d: string; cond: string; material: Material; a: BenchClip; b: BenchClip }
    const pairs: Pair[] = []
    for (const ca of a.clips) {
        const cb = bByKey.get(keyOf(ca))
        if (!cb) continue
        // The current rule (lib/split.ts), not the field stored at run time: a
        // dataset regrouped since (2026-11: the resynth sets) must pair on the same halves.
        if (split !== 'all' && splitOf(ca.d, ca.c) !== split) continue
        if (!pooledIds.has(ca.d)) continue // never gate on derived / pitchless / constructed truth
        pairs.push({ key: keyOf(ca), d: ca.d, cond: ca.cond, material: materialById.get(ca.d) ?? 'singing', a: ca, b: cb })
    }
    const onlyA = a.clips.filter((c) => !bByKey.has(keyOf(c))).length
    const onlyB = b.clips.length - (a.clips.length - onlyA)

    console.log(`A: ${a.meta.id}\nB: ${b.meta.id}`)
    console.log(
        `paired clip×conditions: ${pairs.length} (split=${split}, benchmark-grade only)` +
            `${onlyA || onlyB ? `; unpaired: ${onlyA} only in A, ${onlyB} only in B` : ''}`,
    )
    console.log(
        '\nΔ COnP = B − A, paired bootstrap over clips (* = 95 % CI excludes zero; mde = smallest detectable effect at 80 % power)\n',
    )

    const row = (name: string, ps: Pair[]): void => {
        if (!ps.length) return
        const ci = pairedDiffCI(
            ps.map((p) => p.a.f1),
            ps.map((p) => p.b.f1),
        )
        const ciOff = pairedDiffCI(
            ps.map((p) => p.a.f1Off),
            ps.map((p) => p.b.f1Off),
        )
        const meanA = ps.reduce((s, p) => s + p.a.f1, 0) / ps.length
        const meanB = ps.reduce((s, p) => s + p.b.f1, 0) / ps.length
        console.log(
            name.padEnd(28) +
                `${meanA.toFixed(3)} → ${meanB.toFixed(3)}  ` +
                formatComparison(ci).padEnd(52) +
                `COnPOff ${ciOff.point >= 0 ? '+' : ''}${ciOff.point.toFixed(3)}${ciOff.significant ? '*' : ''}`,
        )
    }

    console.log(
        '--- by material (clip-level pairs; the RESULTS.md headline is a dataset-mean, so read direction + significance here, not the level) ---',
    )
    for (const m of MATERIAL_ORDER)
        row(
            m,
            pairs.filter((p) => p.material === m),
        )
    row('ALL', pairs)
    if (humanIds.size < pooledIds.size)
        row(
            'ALL (human truth)',
            pairs.filter((p) => humanIds.has(p.d)),
        )

    console.log('\n--- by dataset ---')
    for (const d of [...new Set(pairs.map((p) => p.d))].sort())
        row(
            d,
            pairs.filter((p) => p.d === d),
        )

    const conds = [...new Set(pairs.map((p) => p.cond))]
    if (conds.length > 1) {
        console.log('\n--- by condition ---')
        for (const c of conds)
            row(
                c,
                pairs.filter((p) => p.cond === c),
            )
    }

    // The dataset-mean headline, the way RESULTS.md reports it — so the two views agree.
    const headline = (r: BenchResult): number => {
        const ps = r.perScenario.filter((s) => s.pooled && s.clips > 0)
        return ps.reduce((s, x) => s + x.f1, 0) / Math.max(1, ps.length)
    }
    console.log(`\nheadline (dataset-mean COnP): ${headline(a).toFixed(3)} → ${headline(b).toFixed(3)}`)
    const [ha, hb] = [humanHeadline(a), humanHeadline(b)]
    if (ha && hb) console.log(`human-truth headline: ${ha.f1.toFixed(3)} → ${hb.f1.toFixed(3)}`)
}

// ---------------------------------------------------------------------------
// rescore
// ---------------------------------------------------------------------------

/** One line of `.cache/notes/<result id>.jsonl`, as `run` writes it. */
interface NotesLine {
    d: string
    c: string
    cond: string
    notes: EstNote[]
    error?: string
}

/** "a 3, b 1" — how many of each key. */
function countBy(keys: string[]): string {
    const n = new Map<string, number>()
    for (const k of keys) n.set(k, (n.get(k) ?? 0) + 1)
    return [...n].map(([k, v]) => `${k} ${v}`).join(', ')
}

/**
 * Rebuild a recorded run from its cached notes against the CURRENT truth, with
 * no pipeline loaded. The corpus walk, `scoreClip` and `aggregateEval` are the
 * ones `runEval` scores with, so on unchanged truth the result reproduces the
 * run exactly. The run's provenance (sha, date, duration, env) is kept, since it
 * still names the pipeline that produced the notes; `corpus` becomes the truth
 * scored against now, and `rescoredAt` / `rescoredFrom` say so. Without
 * `--label` the result is rewritten in place; with it, it is written beside the
 * original under that label (and the notes file is copied to the new id).
 * Clips on disk that the run has no notes for (added since, and with no
 * same-input twin, below) and notes whose truth is gone (a deleted dataset or
 * clip) are counted, not scored.
 */
function rescore(path: string): void {
    const orig = loadResult(path)
    const notesFile = join(NOTES_DIR, `${orig.meta.id}.jsonl`)
    if (!existsSync(notesFile)) throw new Error(`${orig.meta.id} has no cached notes (${notesFile}); runs record them since 2026-10-30`)
    const notes = new Map<string, NotesLine>()
    for (const line of readFileSync(notesFile, 'utf8').split('\n')) {
        if (!line.trim()) continue
        const n = JSON.parse(line) as NotesLine
        notes.set(`${n.d}/${n.c}/${n.cond}`, n)
    }
    const label = cleanLabel(arg('label') ?? orig.meta.label)
    const opts = defaultEvalOptions({
        real: !SYNTH,
        synth: SYNTH,
        adaptive: true,
        label,
        conditionFilter: orig.meta.conditions,
        scenarioFilter: [...new Set([...notes.values()].map((n) => n.d))],
    })
    const corpus = selectCorpus(opts)
    const clips = corpus.scenarios.flatMap((s) => scenarioClips(corpus, s))
    const keyOfClip = (c: CorpusClip): string => `${c.scenario.id}/${c.clipId}/${c.condition.id}`

    // A clip the run has no notes for may share its input with one it has: a
    // dataset of hard links (jacrc-notes → jacrc-students) gives the pipeline the
    // same file, hints and tempo, so the run's notes for the twin are this clip's
    // notes. Only twins whose dataset truth (and so its tempo) is unchanged since
    // the run qualify.
    const runCorpus = orig.meta.rescoredFrom ? orig.meta.rescoredFrom.corpus : orig.meta.corpus
    const sameTruth = (d: string): boolean => {
        const was = runCorpus?.[d]?.truthHash
        return !!was && was === truthFingerprint(corpus.datasets.find((x) => x.id === d)?.dir ?? '').truthHash
    }
    const inputOf = (c: CorpusClip): string => {
        const { dev, ino } = statSync(c.wavPath)
        const h = hintsFor(c.scenario, opts.noHint)
        return `${dev}:${ino}|${h.instrumentId ?? ''}|${h.sourceKind ?? ''}|${c.truth.bpm}`
    }
    const missing = clips.filter((c) => !notes.has(keyOfClip(c)))
    const twins = new Map<string, NotesLine>()
    if (missing.length) {
        const wanted = new Set(missing.map((c) => `${c.clipId}/${c.condition.id}`))
        const trusted = new Map<string, boolean>()
        for (const c of clips) {
            const n = notes.get(keyOfClip(c))
            if (!n || !wanted.has(`${c.clipId}/${c.condition.id}`)) continue
            if (!trusted.has(c.scenario.id)) trusted.set(c.scenario.id, sameTruth(c.scenario.id))
            if (trusted.get(c.scenario.id)) twins.set(inputOf(c), n)
        }
    }

    const results: ClipResult[] = []
    const used = new Set<string>()
    const unscored: string[] = []
    const borrowed: string[] = []
    for (const c of clips) {
        const key = keyOfClip(c)
        let n = notes.get(key)
        if (n) used.add(key)
        else if ((n = twins.get(inputOf(c)))) borrowed.push(`${c.scenario.id} ← ${n.d}`)
        else {
            unscored.push(c.scenario.id)
            continue
        }
        results.push(
            scoreClip({ datasetId: c.scenario.id, clipId: c.clipId, condition: c.condition.id, truth: c.truth }, n.notes, opts.matchOpts),
        )
    }
    const orphaned = [...notes.values()].filter((n) => !used.has(`${n.d}/${n.c}/${n.cond}`)).map((n) => n.d)
    const report = aggregateEval(opts, corpus, results)
    printReport(report)

    const scored = report.perScenario.filter((s) => s.clips > 0).map((s) => s.scenario)
    const stem = orig.meta.id.endsWith(`_${orig.meta.label}`) ? orig.meta.id.slice(0, -orig.meta.label.length - 1) : orig.meta.id
    const id = label === orig.meta.label ? orig.meta.id : `${stem}_${label}`
    // The run's own provenance stays; only the truth side (and the label, if asked) changes.
    const { corpus: _corpus, corpusVersion: _version, rescoredAt: _at, rescoredFrom: _from, ...kept } = orig.meta
    const result = compact(report, {
        ...kept,
        id,
        label,
        datasets: scored,
        matchTol: report.matchTol,
        ...corpusProvenance(corpusFingerprints(corpus.datasets.filter((d) => scored.includes(d.id))), scored),
        rescoredAt: new Date().toISOString(),
        rescoredFrom: { id: orig.meta.id, ...(runCorpus ? { corpus: runCorpus } : {}) },
    })

    const out = join(RESULTS_DIR, `${id}.json`)
    writeFileSync(out, JSON.stringify(result))
    if (id !== orig.meta.id) copyFileSync(notesFile, join(NOTES_DIR, `${id}.jsonl`))
    const changed = Object.entries(result.meta.corpus ?? {})
        .filter(([d, f]) => runCorpus?.[d]?.truthHash !== f.truthHash)
        .map(([d]) => d)
    console.log(
        `\nrescored ${orig.meta.id}: ${results.length} clip×cond from ${notes.size} cached notes` +
            (borrowed.length ? `; ${borrowed.length} from a same-input twin (${countBy(borrowed)})` : '') +
            (unscored.length ? `; no notes for ${unscored.length} (${countBy(unscored)})` : '') +
            (orphaned.length ? `; no truth any more for ${orphaned.length} (${countBy(orphaned)})` : ''),
    )
    console.log(`truth changed since the run: ${changed.join(', ') || 'none'}`)
    console.log(
        `headline COnP ${fmt(orig.overallF1)} → ${fmt(result.overallF1)}; human truth ${fmt(orig.overallF1Human)} → ${fmt(result.overallF1Human)}`,
    )
    console.log(`Result written to ${out}`)
    render()
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
    const cmd = process.argv[2]
    if (cmd === 'run') return run()
    if (cmd === 'render') return render(positionals()[0] && resolveResult(positionals()[0]))
    if (cmd === 'compare') {
        const [aPath, bPath] = positionals()
        if (!aPath || !bPath) throw new Error('compare needs two result files')
        return compare(resolveResult(aPath), resolveResult(bPath))
    }
    if (cmd === 'rescore') {
        const [path] = positionals()
        if (!path) throw new Error('rescore needs a result id or file')
        return rescore(resolveResult(path))
    }
    console.log(
        'usage: benchmark.ts run [--label X] [--conditions a,b] [--datasets a,b] [--materials m,n] [--split dev|test]\n' +
            '                        [--quick] [--synth] [--cached | --scratch]\n' +
            '       benchmark.ts compare <a.json> <b.json> [--split dev|test|all] [--synth] [--cached | --scratch]\n' +
            '       benchmark.ts render [<result.json>] [--synth]\n' +
            '       benchmark.ts rescore <result id|path> [--label X] [--synth]',
    )
}

/** Accept a bare result id / file name as well as a path. */
function resolveResult(p: string): string {
    if (existsSync(p)) return p
    // Experiment runs look in the scratch dir first, then in the committed history.
    for (const dir of SCRATCH ? [RESULTS_DIR, COMMITTED_DIR] : [RESULTS_DIR]) {
        const inDir = join(dir, p.endsWith('.json') ? p : `${p}.json`)
        if (existsSync(inDir)) return inDir
        // An exact label first (`onset-policy` must not resolve to `pre-onset-policy`),
        // then any unique substring of the id (e.g. the sha).
        const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')) : []
        const key = basename(p)
        const byLabel = files.filter((f) => f.endsWith(`_${key}.json`))
        const hits = byLabel.length ? byLabel : files.filter((f) => f.includes(key))
        if (hits.length > 1) throw new Error(`${p} matches ${hits.length} results: ${hits.join(', ')}`)
        if (hits.length) return join(dir, hits[0])
    }
    throw new Error(`no result matches ${p}`)
}

if (require.main === module) {
    main().catch((err) => {
        console.error(err)
        process.exit(1)
    })
}
