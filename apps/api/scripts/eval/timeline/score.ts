/**
 * Timeline step 3: score every commit's cached notes against the CURRENT
 * truth with HEAD's scorer, and write the git-tracked timeline.
 *
 *   pnpm exec tsx scripts/eval/timeline/score.ts [--commits all|<short>,…] [--partial]
 *        [--notes-dir <dir>] [--out <dir>]
 *
 * Writes, per commit with a notes file,
 *
 *   apps/eval/data/timeline/<commit day>_<short>.json   the benchmark result schema
 *                                                      (benchmark.ts `BenchResult`) + timeline meta
 *   apps/eval/data/timeline/index.json                 every scored commit in date order,
 *                                                      headline numbers only
 *
 * Scoring is lib/evalRun.ts `scoreClip` + `aggregateEval` and benchmark.ts
 * `compact`, the code a HEAD benchmark run uses, so pooling, the two headlines
 * (all pooled / human truth only) and the per-material rows mean exactly what
 * they mean in RESULTS.md — but the NUMBERS are not comparable to RESULTS.md:
 * these are the test half of a capped clip set, through the RecordingPipeline
 * (chunked feed, profile lock, MusicXML round trip) rather than the benchmark's
 * converter-level path. The calibration lines printed at the end pair a
 * timeline commit with a committed benchmark result at the same sha.
 *
 * Truth is looked up through timeline.ts `DATASET_ALIASES` (a clip named by
 * its audio dataset may now be scored against e.g. jacrc-notes); clips with no
 * truth anywhere are skipped and counted. Re-run this whenever truth changes:
 * it needs no pipeline, ~1 s per commit.
 *
 * A commit whose notes are incomplete (clips not yet run, or a harness failure:
 * `crash:` / `timeout:` / `no audio`) is NOT written unless `--partial`, in
 * which case those clips are left out and the counts say so. A failure inside
 * the pipeline (`pass:`, `threw:`) is what the product did and scores as given.
 */

import { createHash } from 'crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs'
import { join, relative } from 'path'

import { type BenchResult, compact, corpusFingerprints, corpusProvenance } from '../benchmark'
import { aggregateEval, type ClipResult, defaultEvalOptions, mean, REAL_ROOT, scoreClip, selectCorpus } from '../lib/evalRun'
import { discoverRealDatasets, type RealDataset } from '../lib/realCorpus'
import { formatComparison, pairedDiffCI } from '../lib/stats'
import type { GroundTruth } from '../types'
import {
    clipKey,
    DATA_DIR,
    loadClipset,
    locateTruth,
    NOTES_DIR,
    type NotesLine,
    readNotes,
    REPO_ROOT,
    selectCommits,
    type TimelineCommit,
} from './timeline'

const BENCH_REAL_DIR = join(REPO_ROOT, 'apps/eval/data/benchmarks/real')

const NOTE =
    'TEST split only (lib/split.ts), capped clip set (timeline/clipset.json), real condition. ' +
    'Pipeline path: RecordingPipeline with chunked feed and the MusicXML round trip, as the product ran at this commit — ' +
    'not comparable in level to RESULTS.md (converter-level, both halves); compare timeline points with each other.'

/** Harness failures: the clip was never transcribed, so it cannot be scored. */
const INFRA_ERR = /^(crash|timeout|no audio)/

interface TimelineMeta {
    /** Full sha of the historical commit (`gitSha` holds the short form). */
    sha: string
    commitDate: string
    subject: string
    era: string
    path: 'RecordingPipeline'
    clipsetHash: string
    clipsetSize: number
    split: 'test'
    note: string
    counts: {
        /** Clip-set clips scored. */
        scored: number
        /** No truth file in the dataset or any alias. */
        noTruth: number
        /** Not in the notes file yet (only with --partial). */
        missing: number
        /** Harness failure, left out (only with --partial). */
        failed: number
        /** The pipeline's own failure (`pass:` / `threw:`), scored as given. */
        pipelineErrors: number
        /** Scored clips where the pipeline emitted no note. */
        emptyOutputs: number
    }
    /** Median worker time per clip (ms); `durationSec` is their sum. */
    medianClipMs: number
    /** sha1 over the scored datasets' truth hashes: equal across commits = scored against the same truth. */
    truthHash: string
}

type TimelineResult = BenchResult & { meta: BenchResult['meta'] & TimelineMeta }

function arg(name: string): string | undefined {
    const i = process.argv.indexOf(`--${name}`)
    return i >= 0 ? process.argv[i + 1] : undefined
}

function round(x: number): number {
    return Math.round(x * 1000) / 1000
}

function median(xs: number[]): number {
    if (!xs.length) return 0
    const s = [...xs].sort((a, b) => a - b)
    return s[Math.floor(s.length / 2)]
}

function scoreCommit(
    c: TimelineCommit,
    notes: Map<string, NotesLine>,
    byId: Map<string, RealDataset>,
    partial: boolean,
): TimelineResult | { skipped: string } {
    const clipset = loadClipset()
    const opts = defaultEvalOptions({ real: true, adaptive: true, label: 'timeline', conditionFilter: ['real'] })
    const counts: TimelineMeta['counts'] = { scored: 0, noTruth: 0, missing: 0, failed: 0, pipelineErrors: 0, emptyOutputs: 0 }
    const results: ClipResult[] = []
    const ms: number[] = []
    for (const ref of clipset.clips) {
        const ds = locateTruth(byId, ref)
        if (!ds) {
            counts.noTruth += 1
            continue
        }
        const line = notes.get(clipKey(ref))
        if (!line) {
            counts.missing += 1
            continue
        }
        if (line.err && INFRA_ERR.test(line.err)) {
            counts.failed += 1
            continue
        }
        if (line.err) counts.pipelineErrors += 1
        if (!line.notes.length) counts.emptyOutputs += 1
        const truth = JSON.parse(readFileSync(join(ds.dir, `${ref.c}.truth.json`), 'utf8')) as GroundTruth
        // The clip set is the test half by its AUDIO dataset's performer grouping; a
        // re-homed truth dataset (jacrc-notes) may not know that grouping, so the
        // selection, not a re-hash, says which half the clip is in.
        results.push({
            ...scoreClip({ datasetId: ds.id, clipId: ref.c, condition: 'real', truth }, line.notes, opts.matchOpts),
            split: 'test',
        })
        ms.push(line.ms)
        counts.scored += 1
    }
    if (!partial && (counts.missing || counts.failed)) {
        return {
            skipped: `${counts.missing} clips not run, ${counts.failed} harness failures — finish run.ts (--retry-errors) or pass --partial`,
        }
    }

    const scoredIds = [...new Set(results.map((r) => r.scenario))].sort()
    const corpus = selectCorpus({ ...opts, scenarioFilter: scoredIds })
    const report = aggregateEval(opts, corpus, results)
    const fingerprints = corpusFingerprints(corpus.datasets.filter((d) => scoredIds.includes(d.id)))
    const id = `${c.date.slice(0, 10)}_${c.short}`
    const truthHash = createHash('sha1')
        .update(scoredIds.map((d) => `${d}:${fingerprints[d]?.truthHash ?? ''}\n`).join(''))
        .digest('hex')
    return compact(report, {
        id,
        label: 'timeline',
        date: new Date().toISOString(),
        gitSha: c.short,
        gitDirty: false,
        node: process.version,
        durationSec: Math.round(ms.reduce((a, b) => a + b, 0) / 1000),
        conditions: ['real'],
        quick: true,
        datasets: scoredIds,
        matchTol: report.matchTol,
        // The worker env is scrubbed (timeline.ts `workerEnv`): every knob at its shipped default.
        env: {},
        ...corpusProvenance(fingerprints, scoredIds),
        sha: c.sha,
        commitDate: c.date,
        subject: c.subject,
        era: c.era,
        path: 'RecordingPipeline',
        clipsetHash: clipset.hash,
        clipsetSize: clipset.size,
        split: 'test',
        note: NOTE,
        counts,
        medianClipMs: median(ms),
        truthHash,
    } as TimelineResult['meta']) as TimelineResult
}

interface IndexEntry {
    id: string
    file: string
    sha: string
    short: string
    commitDate: string
    subject: string
    era: string
    overallF1: number
    overallF1Off: number
    overallF1Human?: number
    overallF1OffHuman?: number
    perMaterial: Record<string, { f1: number; f1Off: number; provisional: boolean; datasets: number; f1Human?: number }>
    counts: TimelineMeta['counts']
    truthHash: string
    scoredAt: string
}

/** index.json over every result file in the directory (not just this invocation's), date order. */
function writeIndex(outDir: string): IndexEntry[] {
    const results = readdirSync(outDir)
        .filter((f) => f.endsWith('.json') && f !== 'index.json')
        .map((f) => ({ f, r: JSON.parse(readFileSync(join(outDir, f), 'utf8')) as TimelineResult }))
        .sort((a, b) => a.r.meta.commitDate.localeCompare(b.r.meta.commitDate) || a.f.localeCompare(b.f))
    const entries: IndexEntry[] = results.map(({ f, r }) => ({
        id: r.meta.id,
        file: f,
        sha: r.meta.sha,
        short: r.meta.gitSha,
        commitDate: r.meta.commitDate,
        subject: r.meta.subject,
        era: r.meta.era,
        overallF1: r.overallF1,
        overallF1Off: r.overallF1Off,
        ...(r.overallF1Human !== undefined ? { overallF1Human: r.overallF1Human, overallF1OffHuman: r.overallF1OffHuman } : {}),
        perMaterial: Object.fromEntries(
            r.perMaterial.map((m) => [
                m.material,
                {
                    f1: m.f1,
                    f1Off: m.f1Off,
                    provisional: m.provisional,
                    datasets: m.datasets.length,
                    ...(m.f1Human !== undefined ? { f1Human: m.f1Human } : {}),
                },
            ]),
        ),
        counts: r.meta.counts,
        truthHash: r.meta.truthHash,
        scoredAt: r.meta.date,
    }))
    const clipset = loadClipset()
    const index = {
        about:
            'Benchmark-score timeline: historical pipeline states scored with the current scorer and truth ' +
            '(apps/api/scripts/eval/timeline/README.md). One entry per commit, date order; full results in `file`.',
        note: NOTE,
        clipset: { hash: clipset.hash, size: clipset.size },
        sameTruth: new Set(entries.map((e) => e.truthHash)).size <= 1,
        commits: entries,
    }
    writeFileSync(join(outDir, 'index.json'), JSON.stringify(index, null, 4) + '\n')
    return entries
}

/** Pair a timeline result with committed benchmark results at the same sha: level offset and per-clip agreement. */
function calibrate(r: TimelineResult): string[] {
    if (!existsSync(BENCH_REAL_DIR)) return []
    const out: string[] = []
    for (const f of readdirSync(BENCH_REAL_DIR).filter((x) => x.endsWith('.json'))) {
        const b = JSON.parse(readFileSync(join(BENCH_REAL_DIR, f), 'utf8')) as BenchResult
        if (!r.meta.sha.startsWith(b.meta.gitSha)) continue
        const bench = new Map(b.clips.filter((x) => x.cond === 'real').map((x) => [`${x.d}/${x.c}`, x.f1]))
        const pairs = r.clips.filter((x) => bench.has(`${x.d}/${x.c}`))
        const a = pairs.map((x) => bench.get(`${x.d}/${x.c}`) ?? 0)
        const t = pairs.map((x) => x.f1)
        out.push(
            `  ${r.meta.gitSha} vs ${b.meta.id}: clip mean COnP benchmark ${mean(a).toFixed(3)} → timeline ${mean(t).toFixed(3)}, ` +
                `timeline − benchmark ${formatComparison(pairedDiffCI(a, t))}`,
        )
    }
    return out
}

function main(): void {
    const commits = selectCommits(arg('commits'))
    const notesDir = arg('notes-dir') ?? NOTES_DIR
    const outDir = arg('out') ?? DATA_DIR
    const partial = process.argv.includes('--partial')
    mkdirSync(outDir, { recursive: true })
    const byId = new Map(discoverRealDatasets(REAL_ROOT).map((d) => [d.id, d]))

    const calibration: string[] = []
    for (const c of commits) {
        const file = join(notesDir, `${c.short}.jsonl`)
        if (!existsSync(file)) {
            console.log(`  ${c.short}  no notes yet (run.ts)`)
            continue
        }
        const r = scoreCommit(c, readNotes(file), byId, partial)
        if ('skipped' in r) {
            console.log(`  ${c.short}  NOT WRITTEN: ${r.skipped}`)
            continue
        }
        writeFileSync(join(outDir, `${r.meta.id}.json`), JSON.stringify(r))
        const k = r.meta.counts
        console.log(
            `  ${c.short}  era ${c.era}  COnP ${r.overallF1.toFixed(3)}  human ${r.overallF1Human?.toFixed(3) ?? '  —  '}  ` +
                `clips ${k.scored}  empty ${k.emptyOutputs}  pipeline errors ${k.pipelineErrors}` +
                (k.noTruth || k.missing || k.failed ? `  (no truth ${k.noTruth}, missing ${k.missing}, failed ${k.failed})` : ''),
        )
        calibration.push(...calibrate(r))
    }
    const entries = writeIndex(outDir)
    console.log(`\n${entries.length} commits in ${relative(REPO_ROOT, join(outDir, 'index.json'))}`)
    if (calibration.length)
        console.log(`\ncalibration against committed benchmark results (same sha, paired on clip):\n${calibration.join('\n')}`)
    console.log(`\nper material (COnP; * = provisional):`)
    const mats = [...new Set(entries.flatMap((e) => Object.keys(e.perMaterial)))]
    console.log(`  ${'commit'.padEnd(10)}${mats.map((m) => m.padStart(12)).join('')}`)
    for (const e of entries) {
        console.log(
            `  ${e.short.padEnd(10)}${mats
                .map((m) => {
                    const v = e.perMaterial[m]
                    return (v ? `${round(v.f1).toFixed(3)}${v.provisional ? '*' : ' '}` : '—').padStart(12)
                })
                .join('')}`,
        )
    }
}

main()
