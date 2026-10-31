/**
 * The benchmark results: one compact JSON per run, written by `apps/api/scripts/eval/benchmark.ts`
 * into `apps/eval/data/benchmarks/{real,synth}/` (git-tracked), plus the timeline's per-commit
 * files, which share the schema. Read tolerantly: the fields added on 2026-10-30 (`truthSource`
 * per dataset, the human-only headline, `meta.env` / `meta.corpus`) are absent from older files.
 */

import { existsSync, readdirSync } from 'fs'
import { join } from 'path'

import {
    type ClipScoreDto,
    type CompareDto,
    type CompareRowDto,
    type ConditionRowDto,
    type CorpusTier,
    type Material,
    type MaterialRowDto,
    MATERIALS,
    type RunDetailDto,
    type RunKind,
    type RunSummaryDto,
    type ScenarioRowDto,
    type SynthGroupDto,
    type TruthSource,
} from '@/lib/dto'

import { FileCache } from './FileCache'
import { EvalPaths } from './paths'

interface RawScenario {
    scenario: string
    material?: Material
    tier?: CorpusTier
    license?: string | null
    licenceRestricted?: boolean
    clips: number
    pooled: boolean
    noteTruthDerived?: boolean
    pitchless?: boolean
    constructedPerformance?: boolean
    truthSource?: TruthSource
    f1: number
    f1Off?: number
    chromaF1?: number
    precision: number
    recall: number
    octaveErrorRate?: number
    onsetF1?: number
    onsetRecall?: number
    repairSecondsPer100?: number
    seg?: ScenarioRowDto['seg']
}

interface RawMaterial {
    material: Material
    provisional?: boolean
    datasets?: string[]
    contextDatasets?: string[]
    clips: number
    f1: number
    f1Off?: number
    precision?: number
    recall?: number
    repairSecondsPer100?: number
}

interface RawClip {
    d: string
    c: string
    cond?: string
    split?: string
    f1: number
    f1Off?: number
    p?: number
    r?: number
    onF1?: number
    onR?: number
}

export interface RawResult {
    meta: {
        id?: string
        label?: string
        date?: string
        gitSha?: string
        sha?: string
        gitDirty?: boolean
        node?: string
        durationSec?: number
        conditions?: string[]
        quick?: boolean
        datasets?: string[]
        matchTol?: Record<string, number>
        env?: Record<string, unknown>
        corpus?: unknown
        corpusVersion?: string
        rescoredAt?: string
        // Timeline files
        commitDate?: string
        subject?: string
        era?: string
    }
    overallF1: number
    overallF1Off?: number
    overallF1Human?: number
    overallF1OffHuman?: number
    perMaterial?: RawMaterial[]
    perScenario?: RawScenario[]
    perCondition?: Array<Partial<ConditionRowDto> & { condition: string; f1: number }>
    clips?: RawClip[]
}

/** The synth benchmark's conditions, cleanest first. */
const SYNTH_CONDITION_ORDER = ['dry', 'studio', 'room', 'home-phone', 'noisy-phone']

const mean = (values: number[]): number | null => (values.length ? values.reduce((s, v) => s + v, 0) / values.length : null)

/** One benchmark result file. */
export class BenchmarkRun {
    private scenarioRows: ScenarioRowDto[] | null = null
    private clipIndex: Map<string, ClipScoreDto> | null = null
    private conditionSet: Set<string> | null = null

    constructor(
        readonly id: string,
        readonly kind: RunKind,
        readonly file: string,
        private readonly raw: RawResult,
    ) {}

    /** When the run happened; for a timeline commit, when the commit was made (its `date` is when it was scored). */
    get date(): string {
        const meta = this.raw.meta
        return (this.kind === 'timeline' ? meta.commitDate : undefined) ?? meta.date ?? meta.commitDate ?? ''
    }

    /** Every timeline file is labelled `timeline`: the commit's subject names it instead. */
    get label(): string {
        const meta = this.raw.meta
        return (this.kind === 'timeline' ? meta.subject : undefined) ?? meta.label ?? meta.subject ?? this.id
    }

    /**
     * The conditions the run scored, in the order it asked for them. A requested condition whose
     * audio was never rendered scores no clip, so listing it would overstate the run's coverage.
     */
    get conditions(): string[] {
        const requested = this.raw.meta.conditions ?? []
        const scored = this.scoredConditions()
        if (scored.size === 0) return requested
        return [...requested.filter((c) => scored.has(c)), ...[...scored].filter((c) => !requested.includes(c))]
    }

    /** Requested conditions that scored no clip. */
    get unscoredConditions(): string[] {
        const scored = this.scoredConditions()
        return scored.size === 0 ? [] : (this.raw.meta.conditions ?? []).filter((c) => !scored.has(c))
    }

    /** Synth runs carry one condition each; their label ends in it (`onset-policy-studio`). */
    get labelStem(): string {
        const condition = this.conditions.length === 1 ? this.conditions[0] : null
        return condition && this.label.endsWith(`-${condition}`) ? this.label.slice(0, -condition.length - 1) : this.label
    }

    /** The meta block as written, for fields only some producers add (the timeline's `clipset`, `errors`). */
    get meta(): Readonly<Record<string, unknown>> {
        return this.raw.meta
    }

    get gitSha(): string {
        return this.raw.meta.gitSha ?? this.raw.meta.sha?.slice(0, 7) ?? ''
    }

    /**
     * The human-truth headline, as benchmark.ts `humanHeadline` reads it: recorded since 2026-10-30;
     * before that every pooled dataset was human truth, so it is the headline itself; otherwise the
     * mean of the human-truth pooled dataset means (the headline's own aggregation).
     */
    private humanHeadline(): { f1: number | null; f1Off: number | null; computed: boolean } {
        const raw = this.raw
        if (raw.overallF1Human != null) return { f1: raw.overallF1Human, f1Off: raw.overallF1OffHuman ?? null, computed: false }
        const pooled = this.scenarios().filter((s) => s.pooled && s.clips > 0)
        const human = pooled.filter((s) => s.truthSource === 'human')
        if (!human.length) return { f1: null, f1Off: null, computed: true }
        if (human.length === pooled.length) return { f1: raw.overallF1, f1Off: raw.overallF1Off ?? null, computed: true }
        return { f1: mean(human.map((s) => s.f1)), f1Off: mean(human.map((s) => s.f1Off)), computed: true }
    }

    /** A scored dataset's truth fingerprint (`meta.corpus`, since 2026-10-30): equal hashes = scored against the same truth files. */
    truthHash(dataset: string): string | null {
        const corpus = this.raw.meta.corpus
        if (!corpus || typeof corpus !== 'object') return null
        const entry = (corpus as Record<string, unknown>)[dataset]
        const hash = entry && typeof entry === 'object' ? (entry as Record<string, unknown>).truthHash : null
        return typeof hash === 'string' ? hash : null
    }

    summary(): RunSummaryDto {
        const meta = this.raw.meta
        const scenarios = this.scenarios()
        const pooled = scenarios.filter((s) => s.pooled)
        const human = this.humanHeadline()
        return {
            id: this.id,
            kind: this.kind,
            label: this.label,
            date: this.date,
            gitSha: this.gitSha,
            gitDirty: meta.gitDirty ?? false,
            durationSec: meta.durationSec ?? null,
            conditions: this.conditions,
            quick: meta.quick ?? false,
            rescoredAt: meta.rescoredAt ?? null,
            datasetCount: meta.datasets?.length ?? scenarios.length,
            clipCount: this.raw.clips?.length ?? scenarios.reduce((s, r) => s + r.clips, 0),
            overallF1: this.raw.overallF1,
            overallF1Off: this.raw.overallF1Off ?? 0,
            overallF1Human: human.f1,
            overallF1OffHuman: human.f1Off,
            humanComputed: human.computed,
            pooledCount: pooled.length,
            subject: meta.subject,
            era: meta.era,
        }
    }

    scenarios(): ScenarioRowDto[] {
        this.scenarioRows ??= (this.raw.perScenario ?? []).map((s) => BenchmarkRun.scenarioRow(s))
        return this.scenarioRows
    }

    scenario(id: string): ScenarioRowDto | null {
        return this.scenarios().find((s) => s.scenario === id) ?? null
    }

    materials(): MaterialRowDto[] {
        const scenarios = new Map(this.scenarios().map((s) => [s.scenario, s]))
        const rows = (this.raw.perMaterial ?? []).map((m): MaterialRowDto => {
            const truthMix: MaterialRowDto['truthMix'] = {}
            for (const id of m.datasets ?? []) {
                const s = scenarios.get(id)
                if (s?.pooled) truthMix[s.truthSource] = (truthMix[s.truthSource] ?? 0) + 1
            }
            return {
                material: m.material,
                provisional: m.provisional ?? false,
                datasets: m.datasets ?? [],
                contextDatasets: m.contextDatasets ?? [],
                clips: m.clips,
                f1: m.f1,
                f1Off: m.f1Off ?? 0,
                precision: m.precision ?? 0,
                recall: m.recall ?? 0,
                repairSecondsPer100: m.repairSecondsPer100 ?? 0,
                truthMix,
            }
        })
        return rows.sort((a, b) => MATERIALS.indexOf(a.material) - MATERIALS.indexOf(b.material))
    }

    conditionRows(): ConditionRowDto[] {
        return (this.raw.perCondition ?? []).map((c) => ({
            condition: c.condition,
            label: c.label ?? c.condition,
            clips: c.clips ?? 0,
            f1: c.f1,
            f1Off: c.f1Off ?? 0,
            precision: c.precision ?? 0,
            recall: c.recall ?? 0,
            octaveErrorRate: c.octaveErrorRate ?? null,
        }))
    }

    clipScores(): ClipScoreDto[] {
        return [...this.clips().values()]
    }

    clipScore(dataset: string, clip: string, cond: string): ClipScoreDto | null {
        return this.clips().get(`${dataset}/${clip}/${cond}`) ?? null
    }

    /** A clip's scores across the conditions this run scored it in. */
    clipScoresFor(dataset: string, clip: string): ClipScoreDto[] {
        return this.conditions.map((cond) => this.clipScore(dataset, clip, cond)).filter((c): c is ClipScoreDto => c !== null)
    }

    /** The lowest-scoring clips of the pooled datasets — where a listen pays off first. */
    worstClips(limit: number): ClipScoreDto[] {
        const pooled = new Set(
            this.scenarios()
                .filter((s) => s.pooled)
                .map((s) => s.scenario),
        )
        return this.clipScores()
            .filter((c) => pooled.has(c.d))
            .sort((a, b) => a.f1 - b.f1 || a.d.localeCompare(b.d))
            .slice(0, limit)
    }

    detail(worst = 25): RunDetailDto {
        const meta = this.raw.meta
        return {
            summary: this.summary(),
            extra: {
                matchTol: meta.matchTol ?? null,
                env: meta.env ?? null,
                corpus:
                    meta.corpus && typeof meta.corpus === 'object'
                        ? { datasets: Object.keys(meta.corpus).length, version: meta.corpusVersion ?? null }
                        : null,
                unscoredConditions: this.unscoredConditions,
                node: meta.node ?? null,
                file: this.file,
            },
            perMaterial: this.materials(),
            perScenario: this.scenarios(),
            perCondition: this.conditionRows(),
            worstClips: this.worstClips(worst),
        }
    }

    private scoredConditions(): Set<string> {
        this.conditionSet ??= new Set((this.raw.clips ?? []).map((c) => c.cond ?? 'real'))
        return this.conditionSet
    }

    private clips(): Map<string, ClipScoreDto> {
        if (!this.clipIndex) {
            this.clipIndex = new Map()
            for (const c of this.raw.clips ?? []) {
                const row: ClipScoreDto = {
                    d: c.d,
                    c: c.c,
                    cond: c.cond ?? 'real',
                    split: c.split ?? '',
                    f1: c.f1,
                    f1Off: c.f1Off ?? 0,
                    p: c.p ?? 0,
                    r: c.r ?? 0,
                    onF1: c.onF1 ?? null,
                    onR: c.onR ?? null,
                }
                this.clipIndex.set(`${row.d}/${row.c}/${row.cond}`, row)
            }
        }
        return this.clipIndex
    }

    /**
     * A dataset's truth source as the result records it, or — for files from before the field
     * existed — as its flags imply. The flags were the whole pooling rule then, so every pooled
     * dataset of an old file is human truth.
     */
    static truthSourceFromFlags(flags: {
        pitchless?: boolean
        constructedPerformance?: boolean
        noteTruthDerived?: boolean
        tier?: CorpusTier
    }): TruthSource {
        if (flags.pitchless) return 'onsets'
        if (flags.constructedPerformance || flags.tier === 'synthetic') return 'constructed'
        if (flags.noteTruthDerived) return 'derived'
        return 'human'
    }

    private static scenarioRow(s: RawScenario): ScenarioRowDto {
        return {
            scenario: s.scenario,
            material: s.material ?? 'singing',
            tier: s.tier ?? 'benchmark',
            license: s.license ?? null,
            licenceRestricted: s.licenceRestricted ?? false,
            clips: s.clips,
            pooled: s.pooled,
            noteTruthDerived: s.noteTruthDerived ?? false,
            pitchless: s.pitchless ?? false,
            constructedPerformance: s.constructedPerformance ?? false,
            truthSource: s.truthSource ?? BenchmarkRun.truthSourceFromFlags(s),
            truthSourceInferred: s.truthSource == null,
            f1: s.f1,
            f1Off: s.f1Off ?? 0,
            chromaF1: s.chromaF1 ?? null,
            precision: s.precision,
            recall: s.recall,
            octaveErrorRate: s.octaveErrorRate ?? null,
            onsetF1: s.onsetF1 ?? null,
            onsetRecall: s.onsetRecall ?? null,
            repairSecondsPer100: s.repairSecondsPer100 ?? null,
            seg: s.seg ?? null,
        }
    }
}

/** Every result file of every kind, newest first. */
export class BenchmarkStore {
    private static readonly files = FileCache.json<RawResult>()

    /** Real or synth results, newest first (synth/archive/ holds superseded corpus versions and is skipped). */
    static list(kind: RunKind): BenchmarkRun[] {
        const dir = kind === 'timeline' ? EvalPaths.timeline : EvalPaths.benchmarks(kind)
        if (!existsSync(dir)) return []
        const runs: BenchmarkRun[] = []
        for (const name of readdirSync(dir)) {
            if (!name.endsWith('.json') || name === 'index.json') continue
            const file = join(dir, name)
            const raw = BenchmarkStore.files.read(file)
            if (!raw?.meta || typeof raw.overallF1 !== 'number') continue
            runs.push(new BenchmarkRun(name.slice(0, -'.json'.length), kind, file, raw))
        }
        return runs.sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id))
    }

    static latest(kind: RunKind): BenchmarkRun | null {
        return BenchmarkStore.list(kind)[0] ?? null
    }

    /** A run of any kind by its id (the file name without `.json`). */
    static get(id: string): BenchmarkRun | null {
        for (const kind of ['real', 'synth', 'timeline'] as const) {
            const run = BenchmarkStore.list(kind).find((r) => r.id === id)
            if (run) return run
        }
        return null
    }

    /** The synth runs grouped by commit and label stem, one condition per file — newest group first. */
    static synthGroups(): SynthGroupDto[] {
        const groups = new Map<string, BenchmarkRun[]>()
        for (const run of BenchmarkStore.list('synth')) {
            const key = `${run.gitSha}:${run.labelStem}`
            groups.set(key, [...(groups.get(key) ?? []), run])
        }
        return [...groups.entries()].map(([key, runs]) => {
            const byMaterial = new Map<Material, number[]>()
            for (const run of runs)
                for (const m of run.materials()) if (m.clips > 0) byMaterial.set(m.material, [...(byMaterial.get(m.material) ?? []), m.f1])
            return {
                key,
                label: runs[0].labelStem,
                gitSha: runs[0].gitSha,
                date: runs.map((r) => r.date).sort()[0],
                runs: runs
                    .map((r) => {
                        const s = r.summary()
                        return {
                            id: r.id,
                            condition: r.conditions.join(', '),
                            overallF1: s.overallF1,
                            overallF1Off: s.overallF1Off,
                            clipCount: s.clipCount,
                        }
                    })
                    .sort((a, b) => SYNTH_CONDITION_ORDER.indexOf(a.condition) - SYNTH_CONDITION_ORDER.indexOf(b.condition)),
                meanF1: mean(runs.map((r) => r.summary().overallF1)) ?? 0,
                perMaterial: [...byMaterial.entries()]
                    .map(([material, values]) => ({ material, f1: mean(values) ?? 0 }))
                    .sort((a, b) => MATERIALS.indexOf(a.material) - MATERIALS.indexOf(b.material)),
            }
        })
    }

    /**
     * Run A against run B per dataset, plus the paired view: the mean of B − A over the clips
     * both scored (same dataset, clip and condition), which a corpus change between the runs
     * cannot move the way it moves the unpaired dataset means.
     *
     * The paired headline is a mean of per-dataset paired means (the headline's own aggregation)
     * over the datasets both runs pooled and scored against the same kind of truth. A dataset whose
     * truth source changed between the runs (derived → resynth, say) is shown but left out: its
     * clip pairs measure the new truth as much as the pipeline. Changed truth files under the same
     * source (clips added, a correction) are flagged, not excluded — the hash can't tell which.
     */
    static compare(a: BenchmarkRun, b: BenchmarkRun): CompareDto {
        const aBy = new Map(a.scenarios().map((s) => [s.scenario, s]))
        const bBy = new Map(b.scenarios().map((s) => [s.scenario, s]))
        const bClips = new Map(b.clipScores().map((c) => [`${c.d}/${c.c}/${c.cond}`, c]))
        const deltas = new Map<string, number[]>()
        for (const clip of a.clipScores()) {
            const other = bClips.get(`${clip.d}/${clip.c}/${clip.cond}`)
            if (other) deltas.set(clip.d, [...(deltas.get(clip.d) ?? []), other.f1 - clip.f1])
        }
        const ids = [...new Set([...aBy.keys(), ...bBy.keys()])]
        const rows = ids.map((scenario): CompareRowDto => {
            const sa = aBy.get(scenario)
            const sb = bBy.get(scenario)
            const s = sb ?? sa
            const paired = deltas.get(scenario) ?? []
            const hashA = a.truthHash(scenario)
            const hashB = b.truthHash(scenario)
            const truthChange: CompareRowDto['truthChange'] =
                sa && sb && sa.truthSource !== sb.truthSource ? 'source' : hashA && hashB && hashA !== hashB ? 'files' : null
            return {
                scenario,
                material: s?.material ?? 'singing',
                pooled: s?.pooled ?? false,
                pooledInBoth: !!sa?.pooled && !!sb?.pooled,
                truthSource: s?.truthSource ?? 'human',
                truthSourceA: sa?.truthSource ?? null,
                truthChange,
                pitchless: s?.pitchless ?? false,
                a: sa?.f1 ?? null,
                b: sb?.f1 ?? null,
                pairedDelta: mean(paired),
                pairedClips: paired.length,
            }
        })
        rows.sort(
            (x, y) =>
                Number(y.pooled) - Number(x.pooled) ||
                MATERIALS.indexOf(x.material) - MATERIALS.indexOf(y.material) ||
                x.scenario.localeCompare(y.scenario),
        )
        const headline = rows.filter((r) => r.pooledInBoth && r.truthChange !== 'source' && r.pairedDelta !== null)
        const human = headline.filter((r) => r.truthSource === 'human')
        const paired = (set: CompareRowDto[]): CompareDto['paired'] => ({
            delta: mean(set.map((r) => r.pairedDelta ?? 0)),
            datasets: set.length,
            clips: set.reduce((n, r) => n + r.pairedClips, 0),
        })
        return {
            a: a.summary(),
            b: b.summary(),
            rows,
            paired: paired(headline),
            pairedHuman: paired(human),
            leftOut: rows
                .filter((r) => r.pooled && !headline.includes(r))
                .map((r) => ({
                    scenario: r.scenario,
                    reason:
                        r.truthChange === 'source'
                            ? `truth changed (${r.truthSourceA ?? '?'} → ${r.truthSource})`
                            : !r.pooledInBoth
                              ? 'pooled in one run only'
                              : 'no clip both runs scored',
                })),
        }
    }
}
