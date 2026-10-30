/**
 * Every shape the server data module (src/server) hands to the pages, in one place. Pages are
 * server components that read the git-tracked result JSON and the local fixtures tree directly;
 * these DTOs are what crosses into client components (and the two JSON routes), so they hold
 * only what is rendered — never a whole 500 KB result file.
 */

/** What a human would say is being recorded — the benchmark's grouping axis. */
export type Material = 'singing' | 'humming' | 'whistling' | 'instrument' | 'vocal-percussion'

export const MATERIALS: readonly Material[] = ['singing', 'humming', 'whistling', 'instrument', 'vocal-percussion']

/**
 * Where a dataset's note truth comes from (dataset.json `truthSource`, decided 2026-10-30):
 * human annotation, resynthesis (meta/test-data-2026-10.md), derived from a frame-level track or
 * a score, constructed (we placed every note: TinySOL, the synthetic corpus), or onsets only.
 */
export type TruthSource = 'human' | 'resynth' | 'derived' | 'constructed' | 'onsets'

export const TRUTH_SOURCES: readonly TruthSource[] = ['human', 'resynth', 'derived', 'constructed', 'onsets']

export type CorpusTier = 'benchmark' | 'context' | 'synthetic'

/** real = the real corpus benchmark, synth = the realistic synthetic corpus, timeline = a historical commit. */
export type RunKind = 'real' | 'synth' | 'timeline'

export interface NoteDto {
    onsetSec: number
    durSec: number
    midi: number
    /** Resynth spec id (`n12`), when the note came from a spec. */
    id?: string
    /** Resynth uncertainty flags: `uncertain-pitch`, `uncertain-onset`, `uncertain-split`, `uncertain-exists`. */
    flags?: string[]
}

// ---------------------------------------------------------------------------
// Benchmark runs

export interface MaterialRowDto {
    material: Material
    /** No pooled dataset: the row is built from context-tier truth and never gates. */
    provisional: boolean
    datasets: string[]
    contextDatasets: string[]
    clips: number
    f1: number
    f1Off: number
    precision: number
    recall: number
    repairSecondsPer100: number
    /** Pooled datasets behind the row, counted by truth source. */
    truthMix: Partial<Record<TruthSource, number>>
}

export interface ScenarioRowDto {
    scenario: string
    material: Material
    tier: CorpusTier
    license: string | null
    licenceRestricted: boolean
    clips: number
    pooled: boolean
    noteTruthDerived: boolean
    pitchless: boolean
    constructedPerformance: boolean
    truthSource: TruthSource
    /** True when the result file predates `truthSource` and it was read from the flags. */
    truthSourceInferred: boolean
    f1: number
    f1Off: number
    chromaF1: number | null
    precision: number
    recall: number
    octaveErrorRate: number | null
    onsetF1: number | null
    onsetRecall: number | null
    repairSecondsPer100: number | null
    seg: { split: number; merged: number; missed: number; spurious: number; refTotal: number } | null
}

export interface ConditionRowDto {
    condition: string
    label: string
    clips: number
    f1: number
    f1Off: number
    precision: number
    recall: number
    octaveErrorRate: number | null
}

export interface ClipScoreDto {
    d: string
    c: string
    cond: string
    split: string
    f1: number
    f1Off: number
    p: number
    r: number
    onF1: number | null
    onR: number | null
}

export interface RunSummaryDto {
    id: string
    kind: RunKind
    label: string
    date: string
    gitSha: string
    gitDirty: boolean
    durationSec: number | null
    conditions: string[]
    quick: boolean
    datasetCount: number
    clipCount: number
    overallF1: number
    overallF1Off: number
    /** Human-truth datasets only — continuous with the history before resynth truth existed. */
    overallF1Human: number | null
    overallF1OffHuman: number | null
    /** True when the file predates the human-only headline and it was computed here. */
    humanComputed: boolean
    pooledCount: number
    /** Timeline runs: the commit's subject and pipeline era. */
    subject?: string
    era?: string
}

export interface RunMetaExtraDto {
    matchTol: Record<string, number> | null
    env: Record<string, unknown> | null
    /** `meta.corpus` (per-dataset truth fingerprints, since 2026-10-30), summarised. */
    corpus: { datasets: number; version: string | null } | null
    node: string | null
    file: string
}

export interface RunDetailDto {
    summary: RunSummaryDto
    extra: RunMetaExtraDto
    perMaterial: MaterialRowDto[]
    perScenario: ScenarioRowDto[]
    perCondition: ConditionRowDto[]
    worstClips: ClipScoreDto[]
}

/** A synth benchmark is one file per condition; files with one sha and label stem form a group. */
export interface SynthGroupDto {
    key: string
    label: string
    gitSha: string
    date: string
    runs: Array<{ id: string; condition: string; overallF1: number; overallF1Off: number; clipCount: number }>
    meanF1: number
    perMaterial: Array<{ material: Material; f1: number }>
}

export interface CompareRowDto {
    scenario: string
    material: Material
    /** Pooled in run B (in A when B lacks the dataset). */
    pooled: boolean
    pooledInBoth: boolean
    /** Run B's truth source (A's when B lacks the dataset). */
    truthSource: TruthSource
    truthSourceA: TruthSource | null
    /**
     * `source`: the truth source differs between the runs (left out of the paired headline);
     * `files`: same source, different truth files (clips added or truth edited) — flagged only.
     */
    truthChange: 'source' | 'files' | null
    a: number | null
    b: number | null
    /** Paired mean of b − a over the clips (dataset, clip, condition) both runs scored. */
    pairedDelta: number | null
    pairedClips: number
}

export interface CompareDto {
    a: RunSummaryDto
    b: RunSummaryDto
    rows: CompareRowDto[]
    /**
     * The headline's paired twin: the mean of the per-dataset paired deltas over the datasets both
     * runs pooled, with an unchanged truth source.
     */
    paired: { delta: number | null; datasets: number; clips: number }
    /** The same over the human-truth datasets only. */
    pairedHuman: { delta: number | null; datasets: number; clips: number }
    /** B's pooled datasets the paired headline leaves out, and why. */
    leftOut: Array<{ scenario: string; reason: string }>
}

// ---------------------------------------------------------------------------
// Timeline

export interface TimelinePointDto {
    id: string
    sha: string
    short: string
    commitDate: string
    subject: string
    era: string
    overall: number | null
    overallHuman: number | null
    perMaterial: Partial<Record<Material, number | null>>
    /** Materials whose row has no pooled dataset (built from context truth, never gates). */
    provisional: Material[]
    clips: number | null
    /** Scored clips where the pipeline emitted no note. */
    empty: number | null
    /** The pipeline's own failures (`pass:` / `threw:`), scored as given. */
    errors: number | null
    /** Written with `--partial`: some clip-set clips were not run yet or failed in the harness. */
    partial: boolean
    /** sha1 over the scored datasets' truth: equal across commits = scored against the same truth. */
    truthHash: string | null
    /** A per-commit result file exists, so /runs/<id> can show its breakdown. */
    hasDetail: boolean
}

export interface TimelineDto {
    points: TimelinePointDto[]
    clipset: string | null
    source: string
    /** The scorer's caveat (index.json `note`): which split and path the numbers measure. */
    note: string | null
    /** False when the commits were scored against different truth (rescore with timeline/score.ts). */
    sameTruth: boolean | null
    /** The sampled commits and how far their transcription has got — the timeline while it is being built. */
    progress: Array<{
        short: string
        date: string
        subject: string
        era: string
        why: string
        clips: number | null
        present: number | null
        errors: number | null
        empty: number | null
        scored: boolean
    }>
}

// ---------------------------------------------------------------------------
// Corpus

export type ResynthStatus = 'passed' | 'unresolved' | 'in-progress' | 'pending'

export interface ResynthProgressDto {
    passed: number
    unresolved: number
    inProgress: number
    pending: number
    total: number
    /** Blind runs on a human-truth dataset: they calibrate the method, they never replace its truth. */
    calibration: boolean
}

export interface DatasetDto {
    id: string
    label: string
    tier: CorpusTier
    material: Material
    kind: string
    instrumentId: string | null
    truthSource: TruthSource
    truthSourceInferred: boolean
    clips: number
    license: string | null
    licenceRestricted: boolean
    pooled: boolean
    /** Why a dataset is not pooled, in plain words. */
    unpooledReason: string | null
    source: string | null
    notes: string | null
    resynth: ResynthProgressDto | null
    latestF1: number | null
    latestRunId: string | null
}

export interface ClipRowDto {
    name: string
    durationSec: number | null
    notes: number | null
    status: ResynthStatus | null
    rounds: number | null
    f1: number | null
    onF1: number | null
}

export interface DatasetDetailDto {
    dataset: DatasetDto
    clips: ClipRowDto[]
    latestRun: { id: string; label: string } | null
}

export interface AudioSourceDto {
    key: string
    label: string
    role: 'original' | 'copy' | 'variant'
    url: string
}

export interface NoteLayerDto {
    label: string
    detail: string
    notes: NoteDto[]
}

export interface ResynthPanelDto {
    status: ResynthStatus
    /** The committed verdict (annotations/resynth), once exported. */
    verdict: {
        status: string
        rounds: number | null
        summary: string | null
        metrics: Array<{ key: string; value: string }>
        createdAt: string | null
        prior: string | null
        tool: string | null
    } | null
    /** The live work state (synthetic-corpus/work/resynth), while the loop runs. */
    work: {
        status: string
        round: number | null
        specVersion: number | null
        judgedVersion: number | null
        judgeVerdict: string | null
        judgeSummary: string | null
        judgeFeedback: string[]
        reportMetrics: Array<{ key: string; value: string }>
        /** The latest compare report's differences, most severe first (`D1` …). */
        diffs: Array<{ id: string; type: string; t0: number; t1: number; text: string }>
        /** The latest comparison panels the judge looks at (≤ 8 s each). */
        panels: Array<{ file: string; t0: number; t1: number }>
        updatedAt: string | null
    } | null
}

export interface PipelineSourceDto {
    /** `run:<resultId>` or `timeline:<short>`. */
    key: string
    label: string
    date: string
}

export interface ClipCompareDto {
    dataset: Pick<DatasetDto, 'id' | 'label' | 'tier' | 'material' | 'truthSource' | 'pooled'>
    clip: string
    index: number
    total: number
    prev: string | null
    next: string | null
    durationSec: number | null
    audio: AudioSourceDto[]
    /** The notes the copy is rendered from (resynth), else the harness truth. */
    primary: NoteLayerDto | null
    /** The other truth: the previous derived truth, or the human truth beside a calibration copy. */
    reference: NoteLayerDto | null
    f0: { hopSec: number; orig: Array<number | null>; copy: Array<number | null> } | null
    resynth: ResynthPanelDto | null
    pipelineSources: PipelineSourceDto[]
    scores: Array<{ runId: string; label: string; date: string; cond: string; f1: number; f1Off: number; onF1: number | null }>
}

export interface PipelineNotesDto {
    key: string
    notes: NoteDto[] | null
    /** Empty transcription or a pipeline error recorded with the notes (timeline caches). */
    error: string | null
}
