/**
 * Timeline step 2: run the clip set (clipset.json) through each sampled
 * commit's own RecordingPipeline and cache the notes it produced.
 *
 *   pnpm exec tsx scripts/eval/timeline/run.ts [--commits all|<short>,…] [--parallel 3]
 *        [--retry-errors] [--clips <dataset>/<clip>,…|@file] [--notes-dir <dir>]
 *        [--progress 25] [--recycle 150]
 *
 * Per commit (in the order given; prepare.ts first), K worker processes
 * (worker.ts, cwd = the commit's tree, scrubbed env) pull clips from one queue,
 * longest clip first. Each finished clip is one line in
 * `.cache/timeline/notes/<short>.jsonl` (timeline.ts `NotesLine`:
 * `{d, c, bpm, notes, ms, err?, warn?}`), written and fsynced as it lands — a
 * laptop sleep, a crash or Ctrl-C loses at most the clips in flight, and the
 * run needs no network. `<short>.summary.json` beside it holds the commit's
 * counts after each invocation; `<short>.lock` keeps two runs off one file.
 *
 * RESUMABLE: a clip already in the file is skipped; one recorded with `err` is
 * skipped too unless `--retry-errors` (the new line supersedes the old one).
 * A worker that crashes or exceeds its time budget (2 min + 8× the clip's
 * length) is killed and replaced, and the clip is recorded with `err`
 * (`crash: …` / `timeout: …`). Workers are also recycled every `--recycle`
 * clips, so a slow leak in an old pipeline cannot accumulate. The pipelines'
 * own swallowed failures come back from the worker as `err: pass: …`.
 *
 * Nothing here scores: score.ts does, against whatever truth is current.
 */

import { type ChildProcess, spawn } from 'child_process'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, statSync, unlinkSync, writeFileSync } from 'fs'
import { join, relative } from 'path'
import { createInterface } from 'readline'
import { pathToFileURL } from 'url'

import type { MxmlMeasure } from '../../../src/recordings/pipeline/mxml.types'
import { hintsFor, REAL_ROOT } from '../lib/evalRun'
import { measuresToNotes } from '../lib/pipelineRun'
import { discoverRealDatasets, type RealDataset } from '../lib/realCorpus'
import type { GroundTruth, Scenario } from '../types'
import {
    clipKey,
    type ClipRef,
    LineAppender,
    loadClipset,
    locateAudio,
    locateTruth,
    NOTES_DIR,
    type NotesLine,
    readNotes,
    REPO_ROOT,
    selectCommits,
    type TimelineCommit,
    TREE_MARKER,
    treeDir,
    WORKER_FILE,
    workerEnv,
} from './timeline'

const BEATS = 4
/** Model load in an old era can take a while on a busy machine; a start that hangs past this is a failure. */
const READY_TIMEOUT_MS = 5 * 60_000
const MAX_START_FAILURES = 3
/** HEAD's tsx loader: one node process per worker (the tsx CLI would add a relay process that a kill misses). */
const TSX_LOADER = pathToFileURL(require.resolve('tsx')).href

function arg(name: string): string | undefined {
    const i = process.argv.indexOf(`--${name}`)
    return i >= 0 ? process.argv[i + 1] : undefined
}

function num(name: string, fallback: number): number {
    const v = arg(name)
    const n = v === undefined ? fallback : Number(v)
    if (!Number.isFinite(n) || n < 1) throw new Error(`--${name} must be a positive number`)
    return n
}

/** Duration of a WAV from its header (fmt byte rate, data size) — for the time budget only. */
function wavSeconds(path: string): number {
    const fd = openSync(path, 'r')
    try {
        const head = Buffer.alloc(4096)
        const n = readSync(fd, head, 0, head.length, 0)
        let byteRate = 0
        for (let o = 12; o + 8 <= n; ) {
            const id = head.toString('ascii', o, o + 4)
            const size = head.readUInt32LE(o + 4)
            if (id === 'fmt ' && o + 16 <= n) byteRate = head.readUInt32LE(o + 16)
            if (id === 'data') break
            o += 8 + size + (size % 2)
        }
        return byteRate ? statSync(path).size / byteRate : 60
    } finally {
        closeSync(fd)
    }
}

interface WorkerRequest {
    id: number
    wavPath: string
    bpm: number
    instrumentId?: string
    sourceKind?: 'voice' | 'instrument'
}

interface WorkerResponse {
    id: number
    ok: boolean
    measures?: Record<number, MxmlMeasure>
    ms: number
    err?: string
    warn?: string
}

/** One worker process for one tree; requests strictly one at a time. */
class Worker {
    readonly ready: Promise<string>
    served = 0
    private readonly proc: ChildProcess
    private stderrTail = ''
    private exited = false
    private pending: { id: number; resolve: (r: WorkerResponse) => void; reject: (e: Error) => void } | null = null
    private nextId = 1

    constructor(tree: string) {
        const proc = spawn(process.execPath, ['--import', TSX_LOADER, WORKER_FILE], {
            cwd: join(tree, 'apps/api'),
            env: workerEnv(),
            stdio: ['pipe', 'pipe', 'pipe'],
        })
        this.proc = proc
        proc.stderr.on('data', (d: Buffer) => {
            this.stderrTail = (this.stderrTail + d.toString()).slice(-1500)
        })
        this.ready = new Promise<string>((resolve, reject) => {
            const timer = setTimeout(() => {
                reject(new Error(`no @@READY within ${READY_TIMEOUT_MS / 1000} s`))
                this.kill()
            }, READY_TIMEOUT_MS)
            createInterface({ input: proc.stdout }).on('line', (line) => {
                if (line.startsWith('@@READY')) {
                    clearTimeout(timer)
                    resolve(line.slice(8).trim())
                } else if (line.startsWith('@@FATAL ')) {
                    clearTimeout(timer)
                    reject(new Error(line.slice(8)))
                } else if (line.startsWith('@@RES ')) {
                    let res: WorkerResponse
                    try {
                        res = JSON.parse(line.slice(6)) as WorkerResponse
                    } catch (err) {
                        this.pending?.reject(new Error(`unparseable response: ${String(err)}`))
                        this.pending = null
                        return
                    }
                    if (this.pending && res.id === this.pending.id) {
                        this.pending.resolve(res)
                        this.pending = null
                    }
                }
            })
            this.proc.on('exit', (code, signal) => {
                this.exited = true
                clearTimeout(timer)
                const why = new Error(
                    `worker exited (${signal ?? `code ${code}`}): ${this.stderrTail.trim().split('\n').slice(-3).join(' / ')}`,
                )
                reject(why)
                this.pending?.reject(why)
                this.pending = null
            })
        })
        // A start failure is handled where `ready` is awaited; never let it go unhandled.
        this.ready.catch(() => undefined)
    }

    request(req: Omit<WorkerRequest, 'id'>, timeoutMs: number): Promise<WorkerResponse> {
        if (this.exited) return Promise.reject(new Error('worker is not running'))
        const id = this.nextId++
        return new Promise<WorkerResponse>((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending = null
                this.kill()
                reject(new TimeoutError(`timeout: no result after ${Math.round(timeoutMs / 1000)} s`))
            }, timeoutMs)
            this.pending = {
                id,
                resolve: (r) => {
                    clearTimeout(timer)
                    resolve(r)
                },
                reject: (e) => {
                    clearTimeout(timer)
                    reject(e)
                },
            }
            this.proc.stdin?.write(JSON.stringify({ id, ...req }) + '\n')
        })
    }

    /** Let the worker finish and exit on stdin EOF. */
    close(): void {
        this.proc.stdin?.end()
    }

    kill(): void {
        if (!this.exited) this.proc.kill('SIGKILL')
    }
}

class TimeoutError extends Error {}

/** Every live worker, so a Ctrl-C / kill does not leave orphans behind. */
const live = new Set<Worker>()
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sig, () => {
        for (const w of live) w.kill()
        process.exit(130)
    })
}

interface Job {
    ref: ClipRef
    req?: Omit<WorkerRequest, 'id'>
    /** Audio length, for the time budget, the queue order and the ETA. */
    sec: number
    timeoutMs: number
    missing?: string
}

/** What the worker is given for a clip: its audio now, the current truth's tempo, the dataset's hints. */
function jobFor(ref: ClipRef, byId: Map<string, RealDataset>): Job {
    const audio = locateAudio(byId, ref)
    if (!audio) return { ref, sec: 0, timeoutMs: 0, missing: 'no audio' }
    const truthDs = locateTruth(byId, ref) ?? audio.ds
    const truthPath = join(truthDs.dir, `${ref.c}.truth.json`)
    const bpm = existsSync(truthPath) ? (JSON.parse(readFileSync(truthPath, 'utf8')) as GroundTruth).bpm || 120 : 120
    // The hints evalRun gives the same dataset (sourceKind explicit, so YAMNet never decides).
    const hints = hintsFor({ kind: audio.ds.kind, instrumentId: audio.ds.instrumentId } as Scenario, false)
    const sec = wavSeconds(audio.wavPath)
    return {
        ref,
        req: { wavPath: audio.wavPath, bpm, instrumentId: hints.instrumentId, sourceKind: hints.sourceKind ?? undefined },
        sec,
        timeoutMs: 120_000 + 8_000 * sec,
    }
}

interface Summary {
    short: string
    era: string
    clips: number
    present: number
    ranNow: number
    errors: number
    empty: number
    medianMs: number
    wallSec: number
    aborted?: string
}

function median(xs: number[]): number {
    if (!xs.length) return 0
    const s = [...xs].sort((a, b) => a - b)
    return s[Math.floor(s.length / 2)]
}

function fmtDur(sec: number): string {
    const m = Math.floor(sec / 60)
    return m ? `${m}m${String(Math.round(sec % 60)).padStart(2, '0')}s` : `${Math.round(sec)}s`
}

function takeLock(file: string): void {
    if (existsSync(file)) {
        const pid = Number(readFileSync(file, 'utf8'))
        let alive = false
        try {
            process.kill(pid, 0)
            alive = true
        } catch {
            alive = false
        }
        if (alive && pid !== process.pid)
            throw new Error(`${relative(REPO_ROOT, file)}: another run.ts (pid ${pid}) is writing these notes`)
    }
    writeFileSync(file, String(process.pid))
}

async function runCommit(
    c: TimelineCommit,
    clips: ClipRef[],
    byId: Map<string, RealDataset>,
    o: { parallel: number; retryErrors: boolean; notesDir: string; progressEvery: number; recycle: number },
): Promise<Summary> {
    const tree = treeDir(c)
    if (!existsSync(join(tree, TREE_MARKER))) throw new Error(`${c.short}: no prepared tree — run timeline/prepare.ts first`)
    const notesFile = join(o.notesDir, `${c.short}.jsonl`)
    const lockFile = join(o.notesDir, `${c.short}.lock`)
    takeLock(lockFile)
    const started = Date.now()
    const done = readNotes(notesFile)
    // Longest first, so the K lanes finish together instead of waiting on one
    // 3-minute esmuc take at the end.
    const todo = clips
        .filter((r) => {
            const l = done.get(clipKey(r))
            return !l || (o.retryErrors && !!l.err)
        })
        .map((r) => jobFor(r, byId))
        .sort((a, b) => b.sec - a.sec)
    const audioTotal = todo.reduce((a, j) => a + j.sec, 0)
    let audioDone = 0
    const out = new LineAppender(notesFile)
    const msNow: number[] = []
    let finished = 0
    let errors = 0
    let empty = 0
    let era = c.era as string
    let aborted: string | undefined
    console.log(`\n[${c.short}] era ${c.era}  ${c.date.slice(0, 10)}  ${c.subject.slice(0, 70)}`)
    console.log(
        `  ${clips.length - todo.length}/${clips.length} clips already cached; ${todo.length} to run on ${Math.min(o.parallel, todo.length)} workers`,
    )

    const record = (line: NotesLine, sec: number): void => {
        out.append(line)
        finished += 1
        audioDone += sec
        if (line.err) errors += 1
        else if (!line.notes.length) empty += 1
        if (!line.err) msNow.push(line.ms)
        if (finished % o.progressEvery === 0 || finished === todo.length) {
            const el = (Date.now() - started) / 1000
            // By audio seconds: clips run longest first, so a clip count would mislead.
            const eta = audioDone ? (el / audioDone) * (audioTotal - audioDone) : 0
            console.log(
                `  [${c.short}] ${String(finished).padStart(4)}/${todo.length}  err ${errors}  empty ${empty}  ` +
                    `median ${(median(msNow) / 1000).toFixed(1)} s/clip  elapsed ${fmtDur(el)}  eta ${fmtDur(eta)}`,
            )
        }
    }

    const queue = [...todo]
    const lane = async (): Promise<void> => {
        let w: Worker | null = null
        let startFailures = 0
        try {
            for (let job = queue.shift(); job && !aborted; job = queue.shift()) {
                if (!w) {
                    w = new Worker(tree)
                    live.add(w)
                    try {
                        era = await w.ready
                        startFailures = 0
                    } catch (err) {
                        live.delete(w)
                        w.kill()
                        w = null
                        startFailures += 1
                        console.warn(`  [${c.short}] worker failed to start (${startFailures}/${MAX_START_FAILURES}): ${String(err)}`)
                        if (startFailures >= MAX_START_FAILURES) aborted = `worker cannot start: ${String(err)}`
                        else queue.unshift(job)
                        continue
                    }
                }
                const base = { d: job.ref.d, c: job.ref.c, bpm: job.req?.bpm ?? 0 }
                if (!job.req) {
                    record({ ...base, notes: [], ms: 0, err: job.missing }, 0)
                    continue
                }
                try {
                    const res = await w.request(job.req, job.timeoutMs)
                    const notes = res.measures ? measuresToNotes(res.measures, BEATS, job.req.bpm, 0) : []
                    record(
                        {
                            ...base,
                            notes: notes.map((n) => ({ onsetSec: round(n.onsetSec), durSec: round(n.durSec), midi: n.midi })),
                            ms: res.ms,
                            ...(res.err ? { err: res.err } : {}),
                            ...(res.warn ? { warn: res.warn } : {}),
                        },
                        job.sec,
                    )
                } catch (err) {
                    const msg = err instanceof TimeoutError ? err.message : `crash: ${err instanceof Error ? err.message : String(err)}`
                    record({ ...base, notes: [], ms: 0, err: msg.slice(0, 400) }, job.sec)
                    live.delete(w)
                    w.kill()
                    w = null
                    continue
                }
                w.served += 1
                if (w.served >= o.recycle) {
                    live.delete(w)
                    w.close()
                    w = null
                }
            }
        } finally {
            if (w) {
                live.delete(w)
                w.close()
            }
        }
    }
    await Promise.all(Array.from({ length: Math.min(o.parallel, todo.length) }, lane))
    out.close()
    unlinkSync(lockFile)

    // The summary is over the whole notes file, not just this invocation.
    const all = readNotes(notesFile)
    const lines = clips.map((r) => all.get(clipKey(r))).filter((l): l is NotesLine => !!l)
    const summary: Summary = {
        short: c.short,
        era,
        clips: clips.length,
        present: lines.length,
        ranNow: finished,
        errors: lines.filter((l) => l.err).length,
        empty: lines.filter((l) => !l.err && !l.notes.length).length,
        medianMs: median(lines.filter((l) => !l.err).map((l) => l.ms)),
        wallSec: Math.round((Date.now() - started) / 1000),
        ...(aborted ? { aborted } : {}),
    }
    writeFileSync(join(o.notesDir, `${c.short}.summary.json`), JSON.stringify(summary, null, 4) + '\n')
    console.log(
        `  [${c.short}] ${summary.present}/${summary.clips} cached, ${summary.errors} errors, ${summary.empty} empty outputs, ` +
            `median ${(summary.medianMs / 1000).toFixed(2)} s/clip, ${fmtDur(summary.wallSec)} wall${aborted ? `  ABORTED: ${aborted}` : ''}`,
    )
    return summary
}

function round(x: number): number {
    return Math.round(x * 10000) / 10000
}

/** `--clips a/b,c/d` or `--clips @file` (one `<dataset>/<clip>` per line); must be clip-set members. */
function clipFilter(all: ClipRef[]): ClipRef[] {
    const spec = arg('clips')
    if (!spec) return all
    const keys = (spec.startsWith('@') ? readFileSync(spec.slice(1), 'utf8').split('\n') : spec.split(','))
        .map((s) => s.trim())
        .filter(Boolean)
    const byKey = new Map(all.map((r) => [clipKey(r), r]))
    return keys.map((k) => {
        const r = byKey.get(k)
        if (!r) throw new Error(`--clips: ${k} is not in clipset.json`)
        return r
    })
}

async function main(): Promise<void> {
    const commits = selectCommits(arg('commits'))
    const clipset = loadClipset()
    const clips = clipFilter(clipset.clips)
    const notesDir = arg('notes-dir') ?? NOTES_DIR
    mkdirSync(notesDir, { recursive: true })
    const byId = new Map(discoverRealDatasets(REAL_ROOT).map((d) => [d.id, d]))
    const o = {
        parallel: num('parallel', 3),
        retryErrors: process.argv.includes('--retry-errors'),
        notesDir,
        progressEvery: num('progress', 25),
        recycle: num('recycle', 150),
    }
    console.log(
        `timeline run: ${commits.length} commits × ${clips.length} clips (clip set ${clipset.hash.slice(0, 12)}), ` +
            `${o.parallel} workers, notes → ${relative(REPO_ROOT, notesDir)}`,
    )
    const summaries: Summary[] = []
    for (const c of commits) summaries.push(await runCommit(c, clips, byId, o))

    console.log('\ncommit    era  cached  errors  empty  median s/clip  wall')
    for (const s of summaries) {
        console.log(
            `${s.short}  ${s.era.padEnd(3)}  ${String(s.present).padStart(6)}  ${String(s.errors).padStart(6)}  ${String(s.empty).padStart(5)}  ` +
                `${(s.medianMs / 1000).toFixed(2).padStart(13)}  ${fmtDur(s.wallSec)}${s.aborted ? '  ABORTED' : ''}`,
        )
    }
    if (summaries.some((s) => s.aborted || s.present < s.clips)) process.exitCode = 1
}

main().catch((err) => {
    console.error(err)
    for (const w of live) w.kill()
    process.exit(1)
})
