import { readFile } from 'fs/promises'
import { resolve } from 'path'
import type { RawData } from 'ws'
import { WebSocket, WebSocketServer } from 'ws'

import { usedProviderNames } from '../src/recordings/pipeline/profiles/pipeline-profile'
import { ProfileResolver } from '../src/recordings/pipeline/profiles/profile-resolver'
import { ProviderRegistry } from '../src/recordings/pipeline/providers/provider-registry'
import { RecordingPipeline } from '../src/recordings/pipeline/recording-pipeline'

/**
 * N-session recording load test (master-todo #13): how many concurrent takes one
 * API process can transcribe before pass latency and memory give out — the
 * number the HPA ceilings and pod sizes should be based on.
 *
 * Drives RecordingPipeline directly through a local WebSocket server (like
 * test-recording-ws.ts, minus the gateway's auth/credit checks), ramps SESSIONS
 * clients RAMP_MS apart, each streaming TEST_AUDIO in 16 KB chunks paced to
 * real time (AUDIO_SECONDS is the clip's length; the bundled fixture is 20.6 s —
 * set CHUNK_INTERVAL_MS to override the pacing), and reports per-session
 * time-to-first-notes, pass-latency percentiles, finalize time, plus process
 * peak RSS and event-loop lag.
 *
 *   SESSIONS=8 RAMP_MS=500 pnpm --filter @mushee/api load:recording
 *   CREPE_INFERENCE_URL=localhost:50051 SESSIONS=16 pnpm --filter @mushee/api load:recording   # remote inference
 *
 * Read it as: raise SESSIONS until p95 pass latency exceeds the pass cadence
 * (~1 s: passes then queue and notes lag further and further behind the
 * singer) or RSS approaches the pod's memory limit. That SESSIONS is the
 * per-pod ceiling; size minReplicas/maxReplicas from it. Without
 * CREPE_INFERENCE_URL the model runs in-process (WASM) and its forward pass
 * blocks the event loop — that measures the model, not the API pod; production
 * routes inference to the gRPC service, so size pods from a remote-mode run.
 */

const PORT = Number(process.env.TEST_PORT ?? 4098)
const SESSIONS = Number(process.env.SESSIONS ?? 4)
const RAMP_MS = Number(process.env.RAMP_MS ?? 500)
const CHUNK_SIZE = 16 * 1024
/** Length of TEST_AUDIO, to pace chunks like a live microphone would deliver them. */
const AUDIO_SECONDS = Number(process.env.AUDIO_SECONDS ?? 20.6)
const POST_END_WAIT_MS = 30_000
const SAMPLE_MS = 250

interface ServerSession {
    pipeline: RecordingPipeline
    connectedAt: number
    endAt: number
    completeAt: number
}

interface ClientResult {
    index: number
    openedAt: number
    firstUpdateMs: number | null
    updates: number
    endToCompleteMs: number | null
    closedCleanly: boolean
}

function toBuffer(data: RawData): Buffer {
    return Buffer.isBuffer(data) ? data : Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data)
}

function percentile(values: number[], p: number): number {
    if (!values.length) return 0
    const sorted = [...values].sort((a, b) => a - b)
    return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]
}

async function startServer(sessions: ServerSession[]): Promise<() => Promise<void>> {
    const registry = new ProviderRegistry({
        crepeTiny: process.env.CREPE_TINY_MODEL_DIR ?? resolve(__dirname, '../model-crepe-tiny'),
    })
    const resolver = new ProfileResolver()
    await registry.initAll(usedProviderNames())

    const wss = new WebSocketServer({ port: PORT, path: '/recording' })
    wss.on('connection', (client: WebSocket) => {
        const pipeline = new RecordingPipeline(registry, resolver)
        const session: ServerSession = { pipeline, connectedAt: Date.now(), endAt: 0, completeAt: 0 }
        sessions.push(session)
        pipeline.setOnUpdate((update) => {
            if (client.readyState === client.OPEN) client.send(JSON.stringify({ type: 'score-update', ...update }))
        })
        pipeline.setOnHealth((health) => {
            if (!health.ok) console.warn(`[server] session ${sessions.indexOf(session)} transcription failed: ${health.message}`)
        })
        client.on('message', (data: RawData, isBinary: boolean) => {
            if (isBinary) return pipeline.appendChunk(toBuffer(data))
            const parsed = JSON.parse(toBuffer(data).toString('utf8')) as {
                type: 'meta' | 'end'
                bpm?: number
                timeSignature?: { beats: number; beatType: number } | null
            }
            if (parsed.type === 'meta') pipeline.setMeta({ bpm: parsed.bpm, timeSignature: parsed.timeSignature })
            if (parsed.type === 'end') {
                session.endAt = Date.now()
                void pipeline
                    .finalize()
                    .catch((err: unknown) => console.warn('[server] finalize failed:', err))
                    .then(() => {
                        session.completeAt = Date.now()
                        if (client.readyState === client.OPEN) client.send(JSON.stringify({ type: 'recording-complete' }))
                        client.close(1000, 'Recording complete')
                    })
            }
        })
        client.on('close', () => void pipeline.finalize().catch(() => undefined))
    })
    await new Promise<void>((res) => wss.once('listening', () => res()))
    return () => new Promise<void>((res) => wss.close(() => res()))
}

async function runClient(index: number, audio: Buffer, chunkIntervalMs: number): Promise<ClientResult> {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/recording`)
    await new Promise<void>((res, rej) => {
        ws.once('open', () => res())
        ws.once('error', rej)
    })
    const result: ClientResult = { index, openedAt: Date.now(), firstUpdateMs: null, updates: 0, endToCompleteMs: null, closedCleanly: false }
    let endSentAt = 0
    ws.on('message', (data: Buffer) => {
        const payload = JSON.parse(data.toString()) as { type: string }
        if (payload.type === 'score-update') {
            result.updates += 1
            result.firstUpdateMs ??= Date.now() - result.openedAt
        } else if (payload.type === 'recording-complete') {
            result.endToCompleteMs = Date.now() - endSentAt
        }
    })
    ws.on('error', (err) => console.error(`[client ${index}] ws error:`, err))

    ws.send(JSON.stringify({ type: 'meta', bpm: 90, timeSignature: { beats: 4, beatType: 4 } }))
    for (let i = 0; i < audio.byteLength; i += CHUNK_SIZE) {
        ws.send(audio.subarray(i, i + CHUNK_SIZE))
        await new Promise((r) => setTimeout(r, chunkIntervalMs))
    }
    endSentAt = Date.now()
    ws.send(JSON.stringify({ type: 'end' }))
    await new Promise<void>((res) => {
        const fallback = setTimeout(() => {
            ws.close()
            res()
        }, POST_END_WAIT_MS)
        ws.once('close', () => {
            clearTimeout(fallback)
            result.closedCleanly = true
            res()
        })
    })
    return result
}

async function main(): Promise<void> {
    const audioPath = process.env.TEST_AUDIO ?? resolve(__dirname, 'fixtures/test.webm')
    const audio = await readFile(audioPath)
    const chunkCount = Math.ceil(audio.byteLength / CHUNK_SIZE)
    const chunkIntervalMs = Number(process.env.CHUNK_INTERVAL_MS ?? Math.round((AUDIO_SECONDS * 1000) / chunkCount))
    console.log(
        `[load] ${SESSIONS} sessions, ramp ${RAMP_MS} ms, ${audio.byteLength} bytes each from ${audioPath} ` +
            `(${chunkCount} chunks every ${chunkIntervalMs} ms ≈ ${((chunkCount * chunkIntervalMs) / 1000).toFixed(1)} s of streaming), ` +
            `inference ${process.env.CREPE_INFERENCE_URL ? `remote (${process.env.CREPE_INFERENCE_URL})` : 'in-process'}`,
    )

    const sessions: ServerSession[] = []
    const stopServer = await startServer(sessions)

    // Process-level sampling: peak RSS and event-loop lag (how late a 250 ms timer fires).
    let peakRssMb = 0
    let peakLagMs = 0
    let lastTick = Date.now()
    const sampler = setInterval(() => {
        const now = Date.now()
        peakLagMs = Math.max(peakLagMs, now - lastTick - SAMPLE_MS)
        lastTick = now
        peakRssMb = Math.max(peakRssMb, process.memoryUsage().rss / 1024 / 1024)
    }, SAMPLE_MS)

    const startedAt = Date.now()
    try {
        const clients: Promise<ClientResult>[] = []
        for (let i = 0; i < SESSIONS; i++) {
            clients.push(runClient(i, audio, chunkIntervalMs))
            if (i < SESSIONS - 1) await new Promise((r) => setTimeout(r, RAMP_MS))
        }
        const results = await Promise.all(clients)
        const wallMs = Date.now() - startedAt
        clearInterval(sampler)

        const rows = results.map((client) => {
            const session = sessions[client.index]
            const stats = session?.pipeline.stats
            const passes = stats?.passMs ?? []
            return {
                session: client.index,
                firstNotesMs: client.firstUpdateMs,
                updates: client.updates,
                passes: passes.length,
                passP50Ms: percentile(passes, 50),
                passP95Ms: percentile(passes, 95),
                passMaxMs: stats?.processMaxMs ?? 0,
                finalizeMs: session?.endAt && session.completeAt ? session.completeAt - session.endAt : null,
                clean: client.closedCleanly,
            }
        })
        console.table(rows)

        const allPasses = sessions.flatMap((s) => s.pipeline.stats.passMs)
        const audioSec = sessions.reduce((sum, s) => sum + s.pipeline.audioDurationSec, 0)
        const summary = {
            sessions: SESSIONS,
            rampMs: RAMP_MS,
            wallSec: Math.round(wallMs / 100) / 10,
            audioSecProcessed: Math.round(audioSec),
            realtimeFactor: Math.round((audioSec / (wallMs / 1000)) * 10) / 10,
            passP50Ms: percentile(allPasses, 50),
            passP95Ms: percentile(allPasses, 95),
            passMaxMs: Math.max(0, ...allPasses),
            firstNotesP95Ms: percentile(rows.flatMap((r) => (r.firstNotesMs === null ? [] : [r.firstNotesMs])), 95),
            peakRssMb: Math.round(peakRssMb),
            peakLoopLagMs: peakLagMs,
            sessionsWithoutNotes: rows.filter((r) => r.updates === 0).length,
        }
        console.log('[load] summary', JSON.stringify(summary))
        console.log(
            `[load] verdict: ${summary.passP95Ms > 1000 ? 'pass p95 above the 1 s cadence — passes are queueing at this concurrency' : 'passes keep up with the 1 s cadence'}; ` +
                `peak RSS ${summary.peakRssMb} MB; event-loop lag up to ${summary.peakLoopLagMs} ms.`,
        )
    } finally {
        clearInterval(sampler)
        await stopServer()
    }
}

main().catch((err: unknown) => {
    console.error(err)
    process.exit(1)
})
