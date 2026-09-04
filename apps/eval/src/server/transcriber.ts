/**
 * Manages the long-lived transcribe worker (apps/api/scripts/eval/
 * transcribe-worker.ts): one child process, spawned lazily with cwd=apps/api
 * so the production models resolve, kept alive across requests so a retry or
 * the next take in a recording session doesn't re-pay model load.
 */

import { type ChildProcess, spawn } from 'child_process'
import { existsSync } from 'fs'
import { createInterface } from 'readline'

import type { GroundTruth } from '@/lib/melody'

import { API_DIR, API_TSX_BIN } from './paths'

export interface TranscribeRequest {
    wavPath: string
    bpm: number
    beatsPerMeasure: number
    instrumentId?: string
    truth?: GroundTruth
}

export interface TranscribeResult {
    notes: Array<{ onsetSec: number; durSec: number; midi: number }>
    measures: Record<number, unknown>
    metrics?: Record<string, unknown>
    seg?: Record<string, unknown>
    onsetOnly?: Record<string, unknown>
}

const REQUEST_TIMEOUT_MS = 180_000

interface WorkerState {
    child: ChildProcess
    ready: Promise<void>
    nextId: number
    pending: Map<number, { resolve: (r: TranscribeResult) => void; reject: (e: Error) => void }>
}

const globalWorker = globalThis as unknown as { __evalTranscriber?: WorkerState | null }

function startWorker(): WorkerState {
    if (!existsSync(API_TSX_BIN)) {
        throw new Error(`tsx not found at ${API_TSX_BIN} — run pnpm install in the repo root`)
    }
    const child = spawn(API_TSX_BIN, ['scripts/eval/transcribe-worker.ts'], {
        cwd: API_DIR,
        stdio: ['pipe', 'pipe', 'inherit'],
    })

    let markReady: () => void
    let failReady: (e: Error) => void
    const ready = new Promise<void>((resolve, reject) => {
        markReady = resolve
        failReady = reject
    })

    const state: WorkerState = { child, ready, nextId: 1, pending: new Map() }

    const rl = createInterface({ input: child.stdout })
    rl.on('line', (line) => {
        if (line === '@@READY') {
            markReady()
            return
        }
        if (!line.startsWith('@@RES ')) return // pipeline log noise
        try {
            const payload = JSON.parse(line.slice('@@RES '.length)) as { id: number; ok: boolean; error?: string } & TranscribeResult
            const waiter = state.pending.get(payload.id)
            if (!waiter) return
            state.pending.delete(payload.id)
            if (payload.ok) waiter.resolve(payload)
            else waiter.reject(new Error(payload.error ?? 'transcription failed'))
        } catch {
            // A malformed line; the request's timeout will surface it.
        }
    })

    child.on('exit', (code) => {
        const error = new Error(`transcribe worker exited (code ${code})`)
        failReady(error)
        for (const waiter of state.pending.values()) waiter.reject(error)
        state.pending.clear()
        if (globalWorker.__evalTranscriber === state) globalWorker.__evalTranscriber = null
    })

    return state
}

export async function transcribeClip(request: TranscribeRequest): Promise<TranscribeResult> {
    if (!globalWorker.__evalTranscriber) globalWorker.__evalTranscriber = startWorker()
    const worker = globalWorker.__evalTranscriber
    await worker.ready

    const id = worker.nextId++
    const result = new Promise<TranscribeResult>((resolve, reject) => {
        worker.pending.set(id, { resolve, reject })
        setTimeout(() => {
            if (worker.pending.delete(id)) reject(new Error('transcription timed out'))
        }, REQUEST_TIMEOUT_MS)
    })
    worker.child.stdin!.write(JSON.stringify({ id, ...request }) + '\n')
    return result
}
