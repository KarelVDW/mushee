/**
 * Shared state of the benchmark-score timeline (timeline/README.md): where its
 * files live, the sampled commits, the clip set, the per-commit notes cache and
 * the dataset alias table. prepare.ts, run.ts and score.ts all read through
 * here so the three steps cannot disagree about a path or a key.
 */

import { closeSync, existsSync, fsyncSync, openSync, readFileSync, writeSync } from 'fs'
import { join, resolve } from 'path'

import type { RealDataset } from '../lib/realCorpus'

export const EVAL_DIR = resolve(__dirname, '..')
export const API_DIR = resolve(EVAL_DIR, '../..')
export const REPO_ROOT = resolve(API_DIR, '../..')

/** Gitignored work state: extracted trees, the legacy install, shared model dirs, notes. */
export const CACHE_DIR = join(EVAL_DIR, '.cache/timeline')
export const TREES_DIR = join(CACHE_DIR, 'trees')
export const LEGACY_DIR = join(CACHE_DIR, 'legacy')
export const MODELS_DIR = join(CACHE_DIR, 'models')
export const NOTES_DIR = join(CACHE_DIR, 'notes')

/** The scored results — git-tracked, read by the eval app. */
export const DATA_DIR = join(REPO_ROOT, 'apps/eval/data/timeline')

export const COMMITS_JSON = join(__dirname, 'commits.json')
export const CLIPSET_JSON = join(__dirname, 'clipset.json')
/** The worker template prepare.ts copies into every tree's apps/api. */
export const WORKER_TEMPLATE = join(__dirname, 'worker.ts')
export const WORKER_FILE = 'timeline-worker.ts'

/** The RecordingPipeline entry point a commit exposes — see worker.ts. */
export type Era = 'A' | 'B' | 'C' | 'D'

export interface TimelineCommit {
    sha: string
    short: string
    /** Committer date: when this pipeline state existed on the branch. */
    date: string
    subject: string
    era: Era
    why: string
    /** Still imports @spotify/basic-pitch: runs on the legacy install, not HEAD's node_modules. */
    needsLegacyDeps: boolean
}

interface CommitsFile {
    legacyLockfileFrom: string
    commits: TimelineCommit[]
}

export function loadCommitsFile(): CommitsFile {
    return JSON.parse(readFileSync(COMMITS_JSON, 'utf8')) as CommitsFile
}

/** `all` or a comma list of shorts / sha prefixes, in the order given. */
export function selectCommits(spec: string | undefined): TimelineCommit[] {
    const all = loadCommitsFile().commits
    if (!spec || spec === 'all') return all
    return spec.split(',').map((s) => {
        const key = s.trim()
        const hits = all.filter((c) => c.sha.startsWith(key) || c.short === key)
        if (hits.length !== 1) throw new Error(`--commits: ${key} matches ${hits.length} sampled commits`)
        return hits[0]
    })
}

export function treeDir(c: TimelineCommit): string {
    return join(TREES_DIR, c.short)
}

/** What prepare.ts leaves in a finished tree; run.ts refuses a tree without it. */
export const TREE_MARKER = '.prepared.json'

export interface ClipRef {
    d: string
    c: string
}

export interface Clipset {
    hash: string
    size: number
    clips: ClipRef[]
}

export function loadClipset(): Clipset {
    return JSON.parse(readFileSync(CLIPSET_JSON, 'utf8')) as Clipset
}

export const clipKey = (r: ClipRef): string => `${r.d}/${r.c}`

/**
 * One line of `.cache/timeline/notes/<short>.jsonl`: what one historical
 * pipeline made of one clip. Append-only — a later line for the same clip (a
 * retry) supersedes an earlier one.
 */
export interface NotesLine {
    d: string
    c: string
    /** The tempo the pipeline was given (the clip's truth bpm at run time). */
    bpm: number
    notes: Array<{ onsetSec: number; durSec: number; midi: number }>
    /** Worker time for the clip (monotonic clock, so a laptop sleep does not inflate it). */
    ms: number
    /**
     * Why the notes may not be the pipeline's real answer: a failed pass inside the
     * pipeline (`pass: …`, logged and swallowed by every era, the product's own
     * silent zero), or the harness's (`crash: …`, `timeout: …`, `no audio`).
     */
    err?: string
    /** Other warnings the pipeline logged for the clip. */
    warn?: string
}

/** The last line per clip; a torn last line (killed mid-write) is skipped and simply redone. */
export function readNotes(file: string): Map<string, NotesLine> {
    const out = new Map<string, NotesLine>()
    if (!existsSync(file)) return out
    for (const line of readFileSync(file, 'utf8').split('\n')) {
        if (!line.trim()) continue
        try {
            const l = JSON.parse(line) as NotesLine
            if (typeof l.d === 'string' && typeof l.c === 'string' && Array.isArray(l.notes)) out.set(clipKey(l), l)
        } catch {
            // torn write — the clip counts as not done
        }
    }
    return out
}

/**
 * Durable append: one line per write, fsynced, so a sleep, a crash or a pulled
 * plug loses at most the line being written. Starts on a fresh line if the file
 * ends in a torn one.
 */
export class LineAppender {
    private readonly fd: number

    constructor(file: string) {
        const prev = existsSync(file) ? readFileSync(file, 'utf8') : ''
        this.fd = openSync(file, 'a')
        if (prev && !prev.endsWith('\n')) writeSync(this.fd, '\n')
    }

    append(obj: unknown): void {
        writeSync(this.fd, JSON.stringify(obj) + '\n')
        fsyncSync(this.fd)
    }

    close(): void {
        closeSync(this.fd)
    }
}

/**
 * Datasets renamed or re-homed by the 2026-10 corpus reorganisation
 * (meta/test-data-2026-10.md). The clip set names each clip by the dataset its
 * AUDIO was in when the set was drawn; the truth it is scored against may now
 * live elsewhere. Per clip-set dataset: where to look for its truth, in order
 * (the dataset itself is always tried last), and — the same list — where else
 * its audio may have moved. Edit freely: run.ts and score.ts read only this.
 */
export const DATASET_ALIASES: Record<string, string[]> = {
    // The note truth for JaCRC's student takes is a new dataset of hard links;
    // jacrc-students itself keeps its human syllable onsets (pitchless).
    'jacrc-students': ['jacrc-notes'],
    // The byte-identical `-aligned` copies fold into one dataset each.
    'humtrans-aligned': ['humtrans'],
    'whistled-high-register-aligned': ['whistled-high-register'],
}

/** Where a clip's truth (`<clip>.truth.json`) is now: the first alias holding it, then the dataset itself. */
export function locateTruth(byId: Map<string, RealDataset>, ref: ClipRef): RealDataset | undefined {
    for (const id of [...(DATASET_ALIASES[ref.d] ?? []), ref.d]) {
        const ds = byId.get(id)
        if (ds && existsSync(join(ds.dir, `${ref.c}.truth.json`))) return ds
    }
    return undefined
}

/** Where a clip's audio (`<clip>__real.wav`) is now: the dataset itself first, then its aliases. */
export function locateAudio(byId: Map<string, RealDataset>, ref: ClipRef): { ds: RealDataset; wavPath: string } | undefined {
    for (const id of [ref.d, ...(DATASET_ALIASES[ref.d] ?? [])]) {
        const ds = byId.get(id)
        const wavPath = ds && join(ds.dir, `${ref.c}__real.wav`)
        if (ds && wavPath && existsSync(wavPath)) return { ds, wavPath }
    }
    return undefined
}

/** HEAD's ffmpeg-static binary; every era's AudioDecoder honours FFMPEG_BIN (ffmpeg-static 5.3.0 throughout). */
export const FFMPEG_BIN = join(REPO_ROOT, 'node_modules/.pnpm/ffmpeg-static@5.3.0/node_modules/ffmpeg-static/ffmpeg')

/**
 * The environment a historical pipeline runs in — `env -i` plus the minimum.
 * Every knob any era ever read (PITCH_PROVIDER, *_MODEL_DIR, *_INFERENCE_URL,
 * RECORDING_*, ONSET_POLICY, EXTRACTOR_*, …) is therefore unset, which is each
 * era's shipped default. RECORDINGS_DEBUG_DIR points under /dev/null so the
 * pre-2026-07 debug bundle (a copy of the audio per take) cannot be written
 * (the worker also stubs it out).
 */
export function workerEnv(): NodeJS.ProcessEnv {
    return {
        PATH: process.env.PATH ?? '/usr/bin:/bin',
        HOME: process.env.HOME ?? '/tmp',
        ...(process.env.TMPDIR ? { TMPDIR: process.env.TMPDIR } : {}),
        FFMPEG_BIN,
        RECORDINGS_DEBUG_DIR: '/dev/null/off',
        NO_COLOR: '1',
    }
}
