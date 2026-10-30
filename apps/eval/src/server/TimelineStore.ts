/**
 * The benchmark score timeline: the product's RecordingPipeline at historical commits, scored by
 * today's harness on today's test-split clipset (`apps/api/scripts/eval/timeline/`). Its output
 * is git-tracked in `apps/eval/data/timeline/`, written by `timeline/score.ts`:
 *
 *   index.json   {about, note, clipset: {hash, size}, sameTruth, commits: [{id, file, sha, short,
 *                commitDate, subject, era, overallF1, overallF1Off, overallF1Human?, perMaterial:
 *                {<material>: {f1, f1Off, provisional, datasets}}, counts: {scored, noTruth, missing,
 *                failed, pipelineErrors, emptyOutputs}, truthHash, scoredAt}]}
 *   <commit day>_<short>.json   the benchmark result schema + the same timeline meta
 *
 * Read tolerantly all the same — an array or another list key, numbers named `overall` or as in
 * a result, materials as a map or a list, counts nested or flat — and any commit the index lacks
 * numbers for falls back to its own file. With no index at all, the per-commit files alone make
 * the timeline.
 */

import { existsSync } from 'fs'
import { join } from 'path'

import { type Material, MATERIALS, type TimelineDto, type TimelinePointDto } from '@/lib/dto'

import { type BenchmarkRun, BenchmarkStore } from './BenchmarkStore'
import { FileCache } from './FileCache'
import { EvalPaths } from './paths'

type Json = Record<string, unknown>

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)

interface Summary {
    clips?: number
    present?: number
    errors?: number
    empty?: number
}

const obj = (v: unknown): Json | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : null)

export class TimelineStore {
    private static readonly index = FileCache.json<unknown>()
    private static readonly plan = FileCache.json<{ commits?: Json[]; hash?: string; size?: number }>()

    static read(): TimelineDto {
        const dir = EvalPaths.timeline
        const indexPath = join(dir, 'index.json')
        const index = TimelineStore.index.read(indexPath)
        const runs = new Map(BenchmarkStore.list('timeline').map((r) => [r.id, r]))
        const fromIndex = TimelineStore.entries(index).map((e) => TimelineStore.point(e, runs))
        const indexed = new Set(fromIndex.map((p) => p.id))
        // Commits scored but not (yet) in the index still belong on the line.
        const extra = [...runs.values()].filter((r) => !indexed.has(r.id)).map((r) => TimelineStore.point({ id: r.id }, runs))
        const points = [...fromIndex, ...extra].filter((p) => p.commitDate).sort((a, b) => a.commitDate.localeCompare(b.commitDate))
        for (const p of points) {
            const summary = TimelineStore.summary(p.short)
            p.empty ??= summary?.empty ?? null
            p.errors ??= summary?.errors ?? null
        }
        const head = obj(index)
        const hashes = new Set(points.map((p) => p.truthHash).filter((h): h is string => h !== null))
        return {
            points,
            clipset: TimelineStore.clipsetLabel(head?.clipset) ?? TimelineStore.clipsetOf(runs) ?? TimelineStore.planClipset(),
            source: existsSync(indexPath) ? indexPath : dir,
            note: str(head?.note) ?? str(points.length ? runs.get(points[0].id)?.meta.note : null),
            sameTruth: typeof head?.sameTruth === 'boolean' ? head.sameTruth : hashes.size ? hashes.size === 1 : null,
            progress: TimelineStore.progress(new Set(points.map((p) => p.short))),
        }
    }

    /** The sampled commits (timeline/commits.json) with each one's transcription summary, oldest first. */
    private static progress(scored: Set<string>): TimelineDto['progress'] {
        const commits = TimelineStore.plan.read(join(EvalPaths.timelinePlan, 'commits.json'))?.commits ?? []
        return commits
            .map((c) => {
                const short = str(c.short) ?? ''
                const summary = TimelineStore.summary(short)
                return {
                    short,
                    date: str(c.date) ?? '',
                    subject: str(c.subject) ?? '',
                    era: str(c.era) ?? '',
                    why: str(c.why) ?? '',
                    clips: summary?.clips ?? null,
                    present: summary?.present ?? null,
                    errors: summary?.errors ?? null,
                    empty: summary?.empty ?? null,
                    scored: [...scored].some((s) => s && (s.startsWith(short) || short.startsWith(s))),
                }
            })
            .sort((a, b) => a.date.localeCompare(b.date))
    }

    private static summary(short: string): Summary | null {
        return short ? (TimelineStore.plan.read(join(EvalPaths.timelineNotes, `${short}.summary.json`)) as Summary | null) : null
    }

    private static planClipset(): string | null {
        return TimelineStore.clipsetLabel(TimelineStore.plan.read(join(EvalPaths.timelinePlan, 'clipset.json')))
    }

    /** `{hash, size}` (the index, clipset.json) or a ready label. */
    private static clipsetLabel(clipset: unknown): string | null {
        if (typeof clipset === 'string') return clipset || null
        const o = obj(clipset)
        const size = num(o?.size)
        const hash = str(o?.hash)
        return size ? `${size} clips${hash ? ` · ${hash.slice(0, 7)}` : ''}` : null
    }

    private static entries(index: unknown): Json[] {
        if (Array.isArray(index)) return index as Json[]
        if (index && typeof index === 'object') {
            const obj = index as Json
            for (const key of ['commits', 'points', 'entries', 'timeline']) if (Array.isArray(obj[key])) return obj[key] as Json[]
        }
        return []
    }

    private static point(entry: Json, runs: Map<string, BenchmarkRun>): TimelinePointDto {
        const sha = str(entry.sha) ?? str(entry.gitSha) ?? ''
        const short = str(entry.short) ?? str(entry.shortSha) ?? sha.slice(0, 7)
        const fileId = (str(entry.file) ?? str(entry.id) ?? str(entry.path))?.replace(/^.*\//, '').replace(/\.json$/, '') ?? null
        const run =
            (fileId ? runs.get(fileId) : undefined) ??
            [...runs.values()].find((r) => short && (r.id.endsWith(`_${short}`) || r.gitSha === short))
        const summary = run?.summary()
        const meta: Json = run?.meta ?? {}
        // score.ts nests the counts; older shapes had them flat on the entry or the meta.
        const counts = obj(entry.counts) ?? obj(meta.counts) ?? {}
        const count = (...keys: string[]) => {
            for (const source of [counts, entry, meta]) for (const k of keys) if (num(source[k]) !== null) return num(source[k])
            return null
        }
        const materialSource = entry.perMaterial ?? entry.materials ?? entry
        const perMaterial = TimelineStore.materials(materialSource)
        const provisional = TimelineStore.provisional(materialSource)
        if (run && Object.keys(perMaterial).length === 0)
            for (const m of run.materials()) {
                perMaterial[m.material] = m.clips > 0 ? m.f1 : null
                if (m.provisional && m.clips > 0) provisional.push(m.material)
            }
        const metaSha = str(meta.sha) ?? ''
        return {
            id: run?.id ?? fileId ?? short,
            sha: sha || metaSha,
            short: short || metaSha.slice(0, 7) || (run?.gitSha ?? ''),
            commitDate: str(entry.commitDate) ?? str(meta.commitDate) ?? str(entry.date) ?? run?.date ?? '',
            subject: str(entry.subject) ?? str(meta.subject) ?? '',
            era: str(entry.era) ?? str(meta.era) ?? '',
            overall: num(entry.overall) ?? num(entry.overallF1) ?? summary?.overallF1 ?? null,
            overallHuman: num(entry.overallHuman) ?? num(entry.overallF1Human) ?? summary?.overallF1Human ?? null,
            perMaterial,
            provisional,
            clips: count('scored', 'clips', 'clipsScored') ?? summary?.clipCount ?? null,
            empty: count('emptyOutputs', 'empty'),
            errors: count('pipelineErrors', 'errors'),
            partial: (count('missing') ?? 0) + (count('failed') ?? 0) > 0,
            truthHash: str(entry.truthHash) ?? str(meta.truthHash),
            hasDetail: run !== undefined,
        }
    }

    /** The materials flagged provisional in an index entry's `perMaterial` map. */
    private static provisional(source: unknown): Material[] {
        const o = obj(source)
        if (!o) return []
        return MATERIALS.filter((m) => obj(o[m])?.provisional === true)
    }

    /** Per-material COnP; a row nothing was scored for (no dataset, no clip — vocal percussion) is a gap, not a zero. */
    private static materials(source: unknown): Partial<Record<Material, number | null>> {
        const out: Partial<Record<Material, number | null>> = {}
        const value = (row: Json): number | null =>
            num(row.datasets) === 0 || num(row.clips) === 0 || (Array.isArray(row.datasets) && row.datasets.length === 0 && !num(row.clips))
                ? null
                : (num(row.f1) ?? num(row.value))
        if (Array.isArray(source)) {
            for (const row of source as Json[]) {
                const material = str(row.material) as Material | null
                if (material && MATERIALS.includes(material)) out[material] = value(row)
            }
        } else if (source && typeof source === 'object') {
            for (const material of MATERIALS) {
                const v = (source as Json)[material]
                if (v === undefined) continue
                out[material] = num(v) ?? (obj(v) ? value(v as Json) : null)
            }
        }
        return out
    }

    private static clipsetOf(runs: Map<string, BenchmarkRun>): string | null {
        for (const run of runs.values()) {
            const clipset = run.meta.clipset
            if (typeof clipset === 'string') return clipset
            if (clipset && typeof clipset === 'object')
                return str((clipset as Json).id) ?? str((clipset as Json).name) ?? JSON.stringify(clipset)
        }
        return null
    }
}
