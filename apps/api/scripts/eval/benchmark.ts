/**
 * The product benchmark: ONE command that scores the production transcription
 * path over every real recording we hold, grouped by what the user is doing —
 * singing, humming, whistling, playing an instrument — records the result with
 * its provenance under `scripts/eval/benchmarks/results/`, and compares two such
 * results with paired confidence intervals.
 *
 *   tsx scripts/eval/benchmark.ts run [--label <name>] [--conditions real,echoey-room,…]
 *                                     [--datasets a,b] [--quick]
 *   tsx scripts/eval/benchmark.ts compare <a.json> <b.json> [--split dev|test|all]
 *   tsx scripts/eval/benchmark.ts render [<result.json>]
 *
 * `run` drives `lib/evalRun.ts` exactly as `EVAL_REAL=1 EVAL_ADAPTIVE=1 run-eval.ts`
 * would (the number that corresponds to what a user hears: resolver, routing,
 * decode, cleanup and the quantisation round-trip), then writes
 *
 *   benchmarks/results/<UTC timestamp>_<git sha>_<label>.json   compact, committed
 *   benchmarks/RESULTS.md                                       regenerated from every result
 *
 * `--quick` scores only the `real` condition (the adverse variants roughly double
 * the run). `compare` pairs the two results clip-by-clip (dataset, clip,
 * condition) and reports the paired-bootstrap Δ COnP per material, per dataset
 * and per condition — a change is only a result when its interval excludes zero.
 *
 * Conventions (see benchmarks/README.md): headline metric COnP@±100 ms (onset +
 * pitch, no offset gate); COnPOff at the same window is the secondary,
 * publication-comparable column; pooled numbers are means of DATASET means over
 * the benchmark-grade datasets only — `noteTruthDerived`, `pitchless` and
 * `constructedPerformance` corpora are reported per row and never pooled.
 */

import { execSync } from 'child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs'
import { basename, join, resolve } from 'path'

import { conditionsFor, defaultEvalOptions, type EvalReport, runEval } from './lib/evalRun'
import type { Material } from './lib/realCorpus'
import { formatComparison, pairedDiffCI } from './lib/stats'
import { printReport } from './run-eval'

const BENCH_DIR = resolve(__dirname, 'benchmarks')
const RESULTS_DIR = join(BENCH_DIR, 'results')
const RESULTS_MD = join(BENCH_DIR, 'RESULTS.md')

/** Display order: the product's inputs first, the special axis last. */
const MATERIAL_ORDER: Material[] = ['singing', 'humming', 'whistling', 'instrument', 'vocal-percussion']

/** One scored clip × condition, compacted for the committed file. */
interface BenchClip {
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

interface BenchResult {
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
        /** Dataset ids actually scored (clips > 0). */
        datasets: string[]
        matchTol: EvalReport['matchTol']
    }
    overallF1: number
    overallF1Off: number
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
        > & { seg: { split: number; merged: number; missed: number; spurious: number; refTotal: number } }
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
function list(v: string | undefined): string[] | undefined {
    return v
        ? v
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean)
        : undefined
}

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

function compact(report: EvalReport, meta: BenchResult['meta']): BenchResult {
    return {
        meta,
        overallF1: round(report.overallF1),
        overallF1Off: round(report.overallF1Off),
        perMaterial: report.perMaterial.map((m) => ({
            ...m,
            f1: round(m.f1),
            f1Off: round(m.f1Off),
            precision: round(m.precision),
            recall: round(m.recall),
            repairSecondsPer100: Math.round(m.repairSecondsPer100),
        })),
        perScenario: report.perScenario
            .filter((s) => s.clips > 0)
            .map((s) => ({
                scenario: s.scenario,
                material: s.material,
                tier: s.tier,
                license: s.license,
                licenceRestricted: s.licenceRestricted,
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
    const label = (arg('label') ?? 'baseline').replace(/[^A-Za-z0-9._-]+/g, '-')
    const conditions = list(arg('conditions')) ?? (quick ? ['real'] : conditionsFor(true).map((c) => c.id))
    const started = Date.now()
    console.log(`benchmark: label=${label} conditions=${conditions.join(',')}`)

    const report = await runEval(
        defaultEvalOptions({
            real: true,
            adaptive: true,
            label,
            conditionFilter: conditions,
            scenarioFilter: list(arg('datasets')),
            onProgress: (line) => console.log(line),
        }),
    )
    printReport(report)

    const sha = git('rev-parse --short HEAD') || 'nogit'
    const dirty = git('status --porcelain -- ../../src ../../scripts/eval') !== ''
    const date = new Date().toISOString()
    const id = `${date.replace(/[:.]/g, '-').slice(0, 19)}_${sha}_${label}`
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
        datasets: report.perScenario.filter((s) => s.clips > 0).map((s) => s.scenario),
        matchTol: report.matchTol,
    })

    mkdirSync(RESULTS_DIR, { recursive: true })
    const out = join(RESULTS_DIR, `${id}.json`)
    writeFileSync(out, JSON.stringify(result))
    console.log(`\nResult written to ${out}${dirty ? '  (working tree DIRTY — label it as such)' : ''}`)
    render(out)
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

/** Markdown for one result — the "current numbers" half of RESULTS.md. */
function renderResult(r: BenchResult): string {
    const lines: string[] = []
    lines.push(`## Latest run: \`${r.meta.id}\``, '')
    lines.push(
        `- **Date** ${r.meta.date.slice(0, 16).replace('T', ' ')} UTC · **commit** \`${r.meta.gitSha}\`` +
            `${r.meta.gitDirty ? ' (dirty tree)' : ''} · **label** ${r.meta.label} · ${r.meta.durationSec} s · node ${r.meta.node}`,
    )
    lines.push(
        `- **Conditions** ${r.meta.conditions.join(', ')}${r.meta.quick ? ' (quick: real only)' : ''} · ` +
            `**match** onset ±${Math.round(r.meta.matchTol.onsetTolSec * 1000)} ms, exact MIDI; COnPOff adds offset within max(50 ms, 20 %)`,
    )
    lines.push(
        `- **Headline** COnP **${fmt(r.overallF1)}** · COnPOff ${fmt(r.overallF1Off)} — mean of dataset means over the ` +
            `${r.perScenario.filter((s) => s.pooled).length} benchmark-grade datasets, \`real\` and adverse conditions pooled`,
        '',
    )

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
              : `${x.datasets.length} (${x.clips} clip×cond)`
        const f = (v: number, d = 3): string => (!has ? '—' : x.provisional ? `_${fmt(v, d)}_` : d === 3 ? `**${fmt(v)}**` : fmt(v, d))
        lines.push(
            `| ${m} | ${f(x.f1)} | ${!has ? '—' : x.provisional ? `_${fmt(x.f1Off)}_` : fmt(x.f1Off)} | ` +
                `${f(x.precision, 2)} | ${f(x.recall, 2)} | ${has ? x.repairSecondsPer100 : '—'} | ${gate} | ${x.contextDatasets.join(', ') || '—'} |`,
        )
    }
    lines.push('')

    lines.push('### By dataset', '')
    lines.push(
        '| dataset | material | tier | licence | clip×cond | COnP | COnPOff | COn | COn recall | octErr | split / merged / missed / spurious per 100 | repair s/100 | pooled |',
    )
    lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|')
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
                : 'yes'
        lines.push(
            `| ${s.scenario} | ${s.material} | ${s.tier} | ${s.license ?? '—'}${s.licenceRestricted ? ' ⚠ internal eval only' : ''} | ${s.clips} | ${s.pitchless ? '—' : fmt(s.f1, 2)} | ${s.pitchless ? '—' : fmt(s.f1Off, 2)} | ` +
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

function renderHistory(results: BenchResult[]): string {
    const lines: string[] = []
    lines.push('## History', '')
    lines.push(
        'Every committed run, oldest first. Compare two rows with `benchmark.ts compare <a> <b>` before ' +
            'reading anything into a difference — per-clip σ is ~0.2–0.3, so only a paired interval that excludes zero is a result.',
        '',
    )
    lines.push(
        '| date (UTC) | commit | label | conditions | overall COnP | singing | humming | whistling | instrument | vocal-perc. COn | file |',
    )
    lines.push('|---|---|---|---|---|---|---|---|---|---|---|')
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
            `| ${r.meta.date.slice(0, 16).replace('T', ' ')} | \`${r.meta.gitSha}\`${r.meta.gitDirty ? '*' : ''} | ${r.meta.label} | ` +
                `${r.meta.quick ? 'real' : r.meta.conditions.length + ' cond.'} | **${fmt(r.overallF1)}** | ${m('singing')} | ${m('humming')} | ` +
                `${m('whistling')} | ${m('instrument')} | ${vpOn} | \`results/${r.meta.id}.json\` |`,
        )
    }
    lines.push('', '`*` = working tree was dirty when the run was recorded. _Italic_ = provisional (context-tier truth only).', '')
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
    console.log(`RESULTS.md regenerated (${results.length} runs) → ${RESULTS_MD}`)
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
    const materialById = new Map(b.perScenario.map((s) => [s.scenario, s.material]))

    type Pair = { key: string; d: string; cond: string; material: Material; a: BenchClip; b: BenchClip }
    const pairs: Pair[] = []
    for (const ca of a.clips) {
        const cb = bByKey.get(keyOf(ca))
        if (!cb) continue
        if (split !== 'all' && ca.split !== split) continue
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
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
    const cmd = process.argv[2]
    if (cmd === 'run') return run()
    if (cmd === 'render') return render(process.argv[3])
    if (cmd === 'compare') {
        const [aPath, bPath] = [process.argv[3], process.argv[4]]
        if (!aPath || !bPath) throw new Error('compare needs two result files')
        return compare(resolveResult(aPath), resolveResult(bPath))
    }
    console.log(
        'usage: benchmark.ts run [--label X] [--conditions a,b] [--datasets a,b] [--quick]\n' +
            '       benchmark.ts compare <a.json> <b.json> [--split dev|test|all]\n' +
            '       benchmark.ts render [<result.json>]',
    )
}

/** Accept a bare result id / file name as well as a path. */
function resolveResult(p: string): string {
    if (existsSync(p)) return p
    const inDir = join(RESULTS_DIR, p.endsWith('.json') ? p : `${p}.json`)
    if (existsSync(inDir)) return inDir
    // Prefix match on the id (e.g. the sha or the label).
    const hit = existsSync(RESULTS_DIR) ? readdirSync(RESULTS_DIR).find((f) => f.includes(basename(p))) : undefined
    if (hit) return join(RESULTS_DIR, hit)
    throw new Error(`no result matches ${p}`)
}

main().catch((err) => {
    console.error(err)
    process.exit(1)
})
