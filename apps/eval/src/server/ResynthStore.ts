/**
 * The resynth truth loop's records (synthetic-corpus/RESYNTH.md, `synthcorpus/resynth/`):
 *
 *   apps/api/scripts/eval/annotations/resynth/<ds>/<clip>.resynth.json              committed verdict + truth
 *   apps/api/scripts/eval/annotations/resynth-calibration/<ds>/<clip>.resynth.json  blind runs on human truth
 *   synthetic-corpus/work/resynth/<workDs>/<clip>/                                  live work state (gitignored)
 *
 * The work directory is read while the loop runs, so Karel can watch truth being generated: its
 * `state.json` status, the latest spec (the copy's notes), the judge's latest verdict, the latest
 * compare report with its diffs and panels, and the latest synthetic copy (`synth.flac`). A dataset
 * exported under a new id (jacrc-students → jacrc-notes) names its work dataset in each artifact's
 * `workDataset`.
 */

import { existsSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

import type { NoteDto, ResynthPanelDto, ResynthProgressDto, ResynthStatus } from '@/lib/dto'

import { FileCache } from './FileCache'
import { EvalPaths } from './paths'

type Json = Record<string, unknown>

interface SpecNote {
    id?: string
    on: number
    off: number
    midi: number
    flags?: string[]
}

interface Spec {
    version?: number
    notes?: SpecNote[]
}

export interface ResynthArtifact {
    workDataset?: string
    role?: string
    truth?: { bpm?: number; notes?: NoteDto[] }
    spec?: Spec
    verdict?: { status?: string; rounds?: number; summary?: string; metrics?: Json }
    prior?: unknown
    tool?: unknown
    createdAt?: string
    audio?: { durationSec?: number }
}

interface WorkState {
    status?: string
    round?: number
    specVersion?: number
    judgedVersion?: number | null
}

interface Report {
    metrics?: Json
    diffs?: Array<{ id?: string; type?: string; t0?: number; t1?: number; text?: string; hint?: string; note?: string }>
    panels?: Array<{ file?: string; t0?: number; t1?: number }>
}

/** The statuses in RESYNTH.md's state machine that mean "the loop is still working on it". */
const WORKING = new Set(['drafted', 'awaiting-judge', 'needs-work'])

/** One clip's resynth record: the committed artifact and/or the live work directory. */
export class ResynthClip {
    constructor(
        readonly dataset: string,
        readonly clip: string,
        private readonly artifact: ResynthArtifact | null,
        private readonly workDir: string | null,
    ) {}

    get state(): WorkState | null {
        return this.workDir ? ResynthStore.json<WorkState>(join(this.workDir, 'state.json')) : null
    }

    /**
     * Where the clip stands: a live loop wins (a clip being re-run after its export is in
     * progress again), then the committed verdict, then the work state's own final status.
     */
    get status(): ResynthStatus {
        const work = this.state?.status
        if (work && WORKING.has(work)) return 'in-progress'
        const verdict = this.artifact?.verdict?.status
        if (verdict === 'passed' || verdict === 'unresolved') return verdict
        if (work === 'passed' || work === 'unresolved') return work
        if (work === 'exported') return 'passed'
        return this.workDir || this.artifact ? 'in-progress' : 'pending'
    }

    get rounds(): number | null {
        return this.artifact?.verdict?.rounds ?? this.state?.round ?? null
    }

    /** The notes the copy is rendered from, with each note's uncertainty flags. */
    notes(): { notes: NoteDto[]; detail: string } | null {
        const spec = this.workSpec()
        const state = this.state
        // While the loop runs, the live spec is the current answer; afterwards the committed truth.
        if (spec && (!this.artifact || (state?.status !== undefined && WORKING.has(state.status)))) {
            return {
                notes: ResynthClip.specNotes(spec),
                detail: `work in progress · spec v${spec.version ?? '?'}${state?.status ? ` · ${state.status}` : ''}`,
            }
        }
        if (this.artifact?.truth?.notes) {
            const notes = this.artifact.spec
                ? ResynthClip.withFlags(this.artifact.truth.notes, this.artifact.spec)
                : this.artifact.truth.notes
            const role = this.artifact.role === 'calibration' ? 'calibration (blind) · ' : ''
            return { notes, detail: `${role}committed · ${this.artifact.verdict?.status ?? 'verdict unknown'}` }
        }
        if (spec) return { notes: ResynthClip.specNotes(spec), detail: `work · spec v${spec.version ?? '?'}` }
        return null
    }

    /** The latest copy in the work directory (24 kHz FLAC), when the loop has rendered one. */
    workCopy(): string | null {
        const path = this.workDir ? join(this.workDir, 'synth.flac') : null
        return path && existsSync(path) ? path : null
    }

    /** A comparison panel PNG of the latest report — only a file the report lists and the directory holds. */
    panelFile(file: string): string | null {
        if (!this.workDir || !/^p\d+\.png$/.test(file)) return null
        const dir = join(this.workDir, 'panels')
        return existsSync(dir) && readdirSync(dir).includes(file) ? join(dir, file) : null
    }

    panel(): ResynthPanelDto {
        const verdict = this.artifact?.verdict
        const state = this.state
        const judge = this.workDir ? ResynthStore.json<Json>(join(this.workDir, 'judge.json')) : null
        const report = this.workDir ? ResynthStore.json<Report>(join(this.workDir, 'report.json')) : null
        const panelsDir = this.workDir ? join(this.workDir, 'panels') : null
        const panelFiles = panelsDir && existsSync(panelsDir) ? readdirSync(panelsDir) : []
        return {
            status: this.status,
            verdict: this.artifact
                ? {
                      status: verdict?.status ?? 'unknown',
                      rounds: verdict?.rounds ?? null,
                      summary: verdict?.summary || null,
                      metrics: ResynthClip.metricList(verdict?.metrics),
                      createdAt: this.artifact.createdAt ?? null,
                      prior: ResynthClip.describe(this.artifact.prior),
                      tool: ResynthClip.describe(this.artifact.tool),
                  }
                : null,
            work: state
                ? {
                      status: state.status ?? 'unknown',
                      round: state.round ?? null,
                      specVersion: state.specVersion ?? null,
                      judgedVersion: state.judgedVersion ?? null,
                      judgeVerdict: ResynthClip.text(judge?.verdict)?.toUpperCase() ?? null,
                      judgeSummary: ResynthClip.text(judge?.summary),
                      judgeFeedback: ResynthClip.feedback(judge?.feedback),
                      reportMetrics: ResynthClip.metricList(report?.metrics),
                      diffs: (report?.diffs ?? []).slice(0, 12).map((d, i) => ({
                          id: d.id ?? `D${i + 1}`,
                          type: d.type ?? '',
                          t0: Math.min(d.t0 ?? 0, d.t1 ?? d.t0 ?? 0),
                          t1: Math.max(d.t0 ?? 0, d.t1 ?? d.t0 ?? 0),
                          text: [d.note, d.text].filter(Boolean).join(' ') + (d.hint ? ` → ${d.hint}` : ''),
                      })),
                      panels: (report?.panels ?? [])
                          .filter((p): p is { file: string; t0?: number; t1?: number } => !!p.file && panelFiles.includes(p.file))
                          .map((p) => ({ file: p.file, t0: p.t0 ?? 0, t1: p.t1 ?? 0 })),
                      updatedAt: this.workDir ? ResynthClip.mtime(join(this.workDir, 'state.json')) : null,
                  }
                : null,
        }
    }

    private workSpec(): Spec | null {
        return this.workDir ? ResynthStore.json<Spec>(join(this.workDir, 'spec.json')) : null
    }

    private static specNotes(spec: Spec): NoteDto[] {
        return (spec.notes ?? [])
            .map((n) => ({
                onsetSec: n.on,
                durSec: Math.max(0, n.off - n.on),
                midi: n.midi,
                id: n.id,
                flags: n.flags?.length ? n.flags : undefined,
            }))
            .sort((a, b) => a.onsetSec - b.onsetSec)
    }

    /** Truth notes carry no flags; take them from the spec note each was read from (same pitch, nearest onset). */
    private static withFlags(truth: NoteDto[], spec: Spec): NoteDto[] {
        const specNotes = ResynthClip.specNotes(spec)
        return truth.map((note) => {
            let best: NoteDto | null = null
            for (const s of specNotes) {
                if (s.midi !== note.midi || Math.abs(s.onsetSec - note.onsetSec) > 0.06) continue
                if (!best || Math.abs(s.onsetSec - note.onsetSec) < Math.abs(best.onsetSec - note.onsetSec)) best = s
            }
            return best ? { ...note, id: best.id, flags: best.flags } : note
        })
    }

    private static metricList(metrics: Json | undefined): Array<{ key: string; value: string }> {
        if (!metrics || typeof metrics !== 'object') return []
        return Object.entries(metrics)
            .filter(([, v]) => typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean')
            .map(([key, v]) => ({ key, value: typeof v === 'number' ? String(Math.round(v * 1000) / 1000) : String(v) }))
    }

    /** Judge feedback items: strings, or `{t|at, note, text}` (time-anchored, RESYNTH.md's protocol). */
    private static feedback(items: unknown): string[] {
        if (typeof items === 'string') return [items]
        if (!Array.isArray(items)) return []
        return items.map((item) => {
            if (typeof item === 'string') return item
            if (item && typeof item === 'object') {
                const o = item as Json
                const head = [o.t ?? o.at ?? o.time, o.note].filter((v) => typeof v === 'string' || typeof v === 'number').join(' ')
                const body = ResynthClip.text(o.text ?? o.message ?? o.issue) ?? JSON.stringify(o)
                return head ? `${head} — ${body}` : body
            }
            return String(item)
        })
    }

    private static describe(value: unknown): string | null {
        if (value == null) return null
        if (typeof value === 'string') return value
        if (typeof value === 'object') {
            const o = value as Json
            const named = ResynthClip.text(o.source ?? o.name ?? o.kind)
            if (named) {
                const detail = typeof o.notes === 'number' ? `${o.notes} notes` : ResynthClip.text(o.version)
                return detail ? `${named} (${detail})` : named
            }
        }
        return JSON.stringify(value).slice(0, 120)
    }

    private static text(v: unknown): string | null {
        return typeof v === 'string' && v ? v : null
    }

    private static mtime(path: string): string | null {
        try {
            return statSync(path).mtime.toISOString()
        } catch {
            return null
        }
    }
}

export class ResynthStore {
    private static readonly files = FileCache.json<unknown>()

    static json<T>(path: string): T | null {
        return ResynthStore.files.read(path) as T | null
    }

    /** Every clip of a dataset with a resynth record (committed, calibration, or in the work directory). */
    static clips(dataset: string): Map<string, ResynthClip> {
        const names = new Set<string>()
        for (const dir of ResynthStore.artifactDirs(dataset)) {
            for (const f of readdirSync(dir)) if (f.endsWith('.resynth.json')) names.add(f.slice(0, -'.resynth.json'.length))
        }
        const workDir = join(EvalPaths.resynthWork, ResynthStore.workDataset(dataset))
        if (existsSync(workDir)) for (const e of readdirSync(workDir, { withFileTypes: true })) if (e.isDirectory()) names.add(e.name)
        const out = new Map<string, ResynthClip>()
        for (const clip of [...names].sort()) out.set(clip, ResynthStore.clip(dataset, clip))
        return out
    }

    static clip(dataset: string, clip: string): ResynthClip {
        let artifact: ResynthArtifact | null = null
        for (const dir of ResynthStore.artifactDirs(dataset)) {
            artifact ??= ResynthStore.json<ResynthArtifact>(join(dir, `${clip}.resynth.json`))
        }
        const workDir = join(EvalPaths.resynthWork, artifact?.workDataset ?? ResynthStore.workDataset(dataset), clip)
        return new ResynthClip(dataset, clip, artifact, existsSync(workDir) ? workDir : null)
    }

    /** Whether a dataset has any resynth record at all. */
    static touches(dataset: string): boolean {
        return ResynthStore.artifactDirs(dataset).length > 0 || existsSync(join(EvalPaths.resynthWork, ResynthStore.workDataset(dataset)))
    }

    /** Progress over a dataset's clips; `calibration` marks blind runs on a human-truth dataset. */
    static progress(dataset: string, clipNames: string[], calibration: boolean): ResynthProgressDto {
        const records = ResynthStore.clips(dataset)
        const counts = { passed: 0, unresolved: 0, inProgress: 0, pending: 0 }
        const all = new Set([...clipNames, ...records.keys()])
        for (const clip of all) {
            const status = records.get(clip)?.status ?? 'pending'
            if (status === 'passed') counts.passed++
            else if (status === 'unresolved') counts.unresolved++
            else if (status === 'in-progress') counts.inProgress++
            else counts.pending++
        }
        return { ...counts, total: all.size, calibration }
    }

    private static artifactDirs(dataset: string): string[] {
        return [join(EvalPaths.resynthAnnotations, dataset), join(EvalPaths.resynthCalibration, dataset)].filter((d) => existsSync(d))
    }

    /** The work directory's dataset id: the artifacts name it when the export went to a new dataset. */
    private static workDataset(dataset: string): string {
        const dir = join(EvalPaths.resynthAnnotations, dataset)
        if (!existsSync(dir)) return dataset
        const first = readdirSync(dir).find((f) => f.endsWith('.resynth.json'))
        return (first && ResynthStore.json<ResynthArtifact>(join(dir, first))?.workDataset) || dataset
    }
}
