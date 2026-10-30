/**
 * What the pipeline transcribed, per clip, as the harness cached it (gitignored, optional):
 *
 *   apps/api/scripts/eval/.cache/notes/<resultId>.jsonl          a benchmark run: {d, c, cond, notes, error?}
 *   apps/api/scripts/eval/.cache/timeline/notes/<short>.jsonl    a historical commit: {d, c, bpm, notes, ms, err?, warn?}
 *
 * A run's file holds every clip of the run (several MB), and the compare view needs one clip of
 * one file at a time. Each file is indexed once per change — the byte range of every line, keyed
 * by dataset/clip/condition — and only the requested line is read and parsed.
 */

import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync } from 'fs'
import { join } from 'path'

import type { NoteDto, PipelineNotesDto, PipelineSourceDto } from '@/lib/dto'

import { BenchmarkStore } from './BenchmarkStore'
import { FileCache } from './FileCache'
import { EvalPaths } from './paths'

type Json = Record<string, unknown>

/** The byte range of each line of a JSONL file, keyed by `d/c/cond`. */
class JsonlIndex {
    private static readonly HEAD =
        /^\{\s*"d"\s*:\s*"((?:[^"\\]|\\.)*)"\s*,\s*"c"\s*:\s*"((?:[^"\\]|\\.)*)"(?:\s*,\s*"cond"\s*:\s*"((?:[^"\\]|\\.)*)")?/

    constructor(
        readonly path: string,
        private readonly lines: Map<string, [number, number]>,
    ) {}

    static build(path: string): JsonlIndex {
        const buf = readFileSync(path)
        const lines = new Map<string, [number, number]>()
        let start = 0
        while (start < buf.length) {
            let end = buf.indexOf(0x0a, start)
            if (end < 0) end = buf.length
            // A torn last line (a run killed mid-write) is skipped, so the line before it still answers.
            if (end > start && buf[end - 1] === 0x7d) {
                const key = JsonlIndex.keyOf(buf.toString('utf8', start, Math.min(end, start + 1024)), buf, start, end)
                if (key) lines.set(key, [start, end - start])
            }
            start = end + 1
        }
        return new JsonlIndex(path, lines)
    }

    has(key: string): boolean {
        return this.lines.has(key)
    }

    /** The first key for a dataset/clip in any condition, preferring `cond`. */
    find(dataset: string, clip: string, cond: string): string | null {
        const exact = `${dataset}/${clip}/${cond}`
        if (this.lines.has(exact)) return exact
        const prefix = `${dataset}/${clip}/`
        for (const key of this.lines.keys()) if (key.startsWith(prefix)) return key
        return null
    }

    read(key: string): Json | null {
        const range = this.lines.get(key)
        if (!range) return null
        const fd = openSync(this.path, 'r')
        try {
            const buf = Buffer.alloc(range[1])
            readSync(fd, buf, 0, range[1], range[0])
            return JSON.parse(buf.toString('utf8')) as Json
        } catch {
            return null
        } finally {
            closeSync(fd)
        }
    }

    /** Fast path: the key fields lead the line. Anything else is parsed whole. */
    private static keyOf(head: string, buf: Buffer, start: number, end: number): string | null {
        const m = JsonlIndex.HEAD.exec(head)
        if (m)
            return `${JSON.parse(`"${m[1]}"`) as string}/${JSON.parse(`"${m[2]}"`) as string}/${m[3] ? (JSON.parse(`"${m[3]}"`) as string) : 'real'}`
        try {
            const row = JSON.parse(buf.toString('utf8', start, end)) as Json
            return typeof row.d === 'string' && typeof row.c === 'string'
                ? `${row.d}/${row.c}/${typeof row.cond === 'string' ? row.cond : 'real'}`
                : null
        } catch {
            return null
        }
    }
}

export class PipelineNotes {
    private static readonly indexes = new FileCache<JsonlIndex>((path) => JsonlIndex.build(path))

    /** Every cached transcription set, newest first: benchmark runs, then historical commits. */
    static sources(): PipelineSourceDto[] {
        const out: PipelineSourceDto[] = []
        const runFiles = PipelineNotes.jsonl(EvalPaths.runNotes)
        for (const run of [...BenchmarkStore.list('real'), ...BenchmarkStore.list('synth')]) {
            if (runFiles.has(run.id)) out.push({ key: `run:${run.id}`, label: `${run.label} · ${run.gitSha}`, date: run.date })
        }
        const timeline = PipelineNotes.jsonl(EvalPaths.timelineNotes)
        const timelineRuns = BenchmarkStore.list('timeline')
        const commits = [...timeline]
            .map((short) => {
                const run = timelineRuns.find((r) => r.gitSha === short || r.id.endsWith(`_${short}`))
                return {
                    key: `timeline:${short}`,
                    label: `commit ${short}${typeof run?.meta.subject === 'string' ? ` · ${run.meta.subject}` : ''}`,
                    date: run?.date ?? '',
                }
            })
            .sort((a, b) => b.date.localeCompare(a.date))
        return [...out, ...commits]
    }

    /** One clip's notes from one source; `notes: null` when the source never scored the clip. */
    static read(key: string, dataset: string, clip: string): PipelineNotesDto {
        const [kind, id] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)]
        // Only names that are files in the cache directories resolve: no path from a request reaches the filesystem.
        const dir = kind === 'run' ? EvalPaths.runNotes : kind === 'timeline' ? EvalPaths.timelineNotes : null
        if (!dir || !PipelineNotes.jsonl(dir).has(id)) return { key, notes: null, error: null }
        const index = PipelineNotes.indexes.read(join(dir, `${id}.jsonl`))
        const line = index?.find(dataset, clip, 'real')
        const row = line ? index?.read(line) : null
        if (!row) return { key, notes: null, error: null }
        // benchmark.ts writes `error`, the timeline's run.ts `err`.
        const raw = row.err ?? row.error
        const error = typeof raw === 'string' && raw ? raw : null
        return { key, notes: PipelineNotes.notes(row.notes), error }
    }

    /** Notes as `{onsetSec, durSec, midi}` objects or compact `[onset, dur, midi]` triples. */
    private static notes(raw: unknown): NoteDto[] {
        if (!Array.isArray(raw)) return []
        const out: NoteDto[] = []
        for (const n of raw) {
            if (Array.isArray(n) && n.length >= 3) out.push({ onsetSec: Number(n[0]), durSec: Number(n[1]), midi: Number(n[2]) })
            else if (n && typeof n === 'object') {
                const o = n as Json
                const onsetSec = Number(o.onsetSec ?? o.on ?? o.onset)
                const durSec = o.durSec !== undefined ? Number(o.durSec) : Number(o.off) - onsetSec
                if (Number.isFinite(onsetSec) && Number.isFinite(durSec)) out.push({ onsetSec, durSec, midi: Number(o.midi ?? o.pitch) })
            }
        }
        return out.filter((n) => Number.isFinite(n.midi)).sort((a, b) => a.onsetSec - b.onsetSec)
    }

    private static jsonl(dir: string): Set<string> {
        if (!existsSync(dir)) return new Set()
        return new Set(
            readdirSync(dir)
                .filter((f) => f.endsWith('.jsonl'))
                .map((f) => f.slice(0, -'.jsonl'.length)),
        )
    }
}
