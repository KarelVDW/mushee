/**
 * Timeline worker: transcribes clips through ONE HISTORICAL commit's
 * RecordingPipeline, the product path (chunked feed, profile lock, MusicXML
 * measures) as that commit shipped it.
 *
 * This file is a template. prepare.ts copies it into every extracted tree as
 * `apps/api/timeline-worker.ts`; run.ts starts it there with cwd = that tree's
 * apps/api (models resolve from process.cwd() in every era) and a scrubbed env
 * (timeline.ts `workerEnv`). It imports nothing from HEAD: the tree's own
 * src/ and the node_modules prepare.ts linked in. Same protocol as
 * scripts/eval/transcribe-worker.ts, one JSON object per line:
 *
 *   in : { id, wavPath, bpm, instrumentId?, sourceKind? }
 *   out: '@@RES ' + { id, ok, measures, ms, err?, warn? }
 *
 * A single '@@READY <era>' line signals the models are loaded; a failed
 * start prints '@@FATAL <reason>' and exits 1. HEAD turns the measures into
 * notes (lib/pipelineRun.ts `measuresToNotes`): the MxmlMeasure shape and the
 * 0-based measure index are unchanged since bb4d8165.
 *
 * The entry point is found by file existence, four eras:
 *
 *   A  2026-04  src/recordings/BasicPitchModelLoader.ts     new RecordingPipeline(modelPromise)
 *   B  2026-05  src/recordings/AudioConverter.ts            new RecordingPipeline(new AudioConverter(basicPitch))
 *   C  2026-06  src/recordings/providers/ProviderRegistry.ts new RecordingPipeline(registry, resolver)
 *   D  2026-07+ src/recordings/pipeline/recording-pipeline.ts  same, kebab-case paths
 *
 * Every era swallows a failed pass ("Process pass failed", logged as a
 * warning) and emits nothing, which would score as a silent zero. The worker
 * therefore captures the Nest logger and reports such a clip with `err`.
 */

import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { createInterface } from 'readline'

type Era = 'A' | 'B' | 'C' | 'D'

interface Request {
    id: number
    wavPath: string
    bpm: number
    instrumentId?: string
    sourceKind?: 'voice' | 'instrument'
}

/** The slice of RecordingPipeline's API every era shares. */
interface Pipeline {
    setMeta(meta: Record<string, unknown>): void
    setOnUpdate(cb: (update: { measures: Record<number, unknown> }) => void): void
    appendChunk(buffer: Buffer): void
    finalize(): Promise<void>
}

type Ctor<T> = new (...args: unknown[]) => T

const API = process.cwd()
const REC = join(API, 'src/recordings')
const BEATS = 4
const CHUNKS = 12
/** Logged-and-swallowed failures, any era: the clip's output is not the pipeline's answer. */
const FAILURE = /process pass failed|cannot decode|decode not ready|decode failed/i

function detectEra(): Era {
    if (existsSync(join(REC, 'pipeline/recording-pipeline.ts'))) return 'D'
    if (existsSync(join(REC, 'providers/ProviderRegistry.ts'))) return 'C'
    if (existsSync(join(REC, 'AudioConverter.ts'))) return 'B'
    if (existsSync(join(REC, 'BasicPitchModelLoader.ts'))) return 'A'
    throw new Error(`no known RecordingPipeline entry point under ${REC}`)
}

async function load(rel: string): Promise<Record<string, unknown>> {
    return (await import(join(REC, rel))) as Record<string, unknown>
}

/**
 * The Nest logger, captured. Messages for the clip in flight are collected so a
 * swallowed failure surfaces as `err`; everything else is dropped (stdout is
 * the protocol channel, and the pipeline's debug chatter is per pass).
 */
const captured: { level: string; msg: string }[] = []

async function captureLogger(): Promise<void> {
    const nest = (await import('@nestjs/common')) as unknown as {
        Logger: { overrideLogger(logger: Record<string, (message: unknown) => void>): void }
    }
    const keep = (level: string) => (message: unknown) => {
        const msg = message instanceof Error ? message.message : String(message)
        // Debug lines matter only when they report something giving up: "Cannot decode
        // buffer yet" (A/B), "Detection decode not ready" (C+), "Final re-resolve
        // decode failed" (D) — the per-pass timing chatter is dropped.
        if (level === 'debug' && (/^(session|pass) timings/i.test(msg) || !/decode|fail|not ready|error/i.test(msg))) return
        if (level === 'log' || level === 'verbose') return
        captured.push({ level, msg })
    }
    nest.Logger.overrideLogger({
        log: keep('log'),
        error: keep('error'),
        warn: keep('warn'),
        debug: keep('debug'),
        verbose: keep('verbose'),
        fatal: keep('error'),
    })
}

/** The era's pipeline factory, with its models loaded. */
async function buildFactory(era: Era): Promise<() => Pipeline> {
    const model = (dir: string): string => join(API, dir)
    switch (era) {
        case 'A': {
            const { BasicPitchModelLoader } = (await load('BasicPitchModelLoader')) as {
                BasicPitchModelLoader: Ctor<{ load(): Promise<unknown> }>
            }
            const { RecordingPipeline } = (await load('RecordingPipeline')) as { RecordingPipeline: Ctor<Pipeline> }
            // As recordings.service.ts did: one loader, its promise handed to every pipeline.
            const graph = new BasicPitchModelLoader(model('model')).load()
            await graph
            return () => new RecordingPipeline(graph)
        }
        case 'B': {
            // The provider directly, never recordings.service.ts (which imports PESTO's
            // onnxruntime); its code default was basic-pitch (PITCH_PROVIDER unset).
            const { BasicPitchProvider } = (await load('providers/BasicPitchProvider')) as {
                BasicPitchProvider: Ctor<{ init(): Promise<void> }>
            }
            const { AudioConverter } = (await load('AudioConverter')) as { AudioConverter: Ctor<unknown> }
            const { RecordingPipeline } = (await load('RecordingPipeline')) as { RecordingPipeline: Ctor<Pipeline> }
            const provider = new BasicPitchProvider(model('model'))
            await provider.init()
            return () => new RecordingPipeline(new AudioConverter(provider))
        }
        case 'C':
        case 'D': {
            const p = era === 'C' ? 'providers/ProviderRegistry' : 'pipeline/providers/provider-registry'
            const r = era === 'C' ? 'profiles/ProfileResolver' : 'pipeline/profiles/profile-resolver'
            const rp = era === 'C' ? 'RecordingPipeline' : 'pipeline/recording-pipeline'
            const { ProviderRegistry } = (await load(p)) as { ProviderRegistry: Ctor<{ initAll(): Promise<void> }> }
            const { ProfileResolver } = (await load(r)) as { ProfileResolver: Ctor<unknown> }
            const { RecordingPipeline } = (await load(rp)) as { RecordingPipeline: Ctor<Pipeline> }
            // basic-pitch's dir only while the commit still has it (deleted in 458b3a05).
            const dirs = {
                crepeTiny: model('model-crepe-tiny'),
                ...(existsSync(model('model')) ? { basicPitch: model('model') } : {}),
            }
            const registry = new ProviderRegistry(dirs)
            await registry.initAll()
            const resolver = new ProfileResolver()
            return () => new RecordingPipeline(registry, resolver)
        }
    }
}

/** Pre-2026-07 eras write a debug bundle (audio copy, plot, score) on every finalize. */
async function stubDebugBundle(era: Era): Promise<void> {
    const { RecordingPipeline } = (await load(era === 'D' ? 'pipeline/recording-pipeline' : 'RecordingPipeline')) as {
        RecordingPipeline: { prototype: Record<string, unknown> }
    }
    if (typeof RecordingPipeline.prototype.writeDebugBundle === 'function') {
        RecordingPipeline.prototype.writeDebugBundle = () => Promise.resolve()
    }
}

async function transcribe(newPipeline: () => Pipeline, req: Request): Promise<Record<number, unknown>> {
    const audio = readFileSync(req.wavPath)
    const pipeline = newPipeline()
    // Extra keys are ignored by the eras that predate them (instrumentId 06-03,
    // sourceKind 08-08) — exactly what the product sent then.
    pipeline.setMeta({
        bpm: req.bpm,
        timeSignature: { beats: BEATS, beatType: 4 },
        chromaticTranspose: 0,
        instrumentId: req.instrumentId,
        sourceKind: req.sourceKind,
    })
    const measures: Record<number, unknown> = {}
    pipeline.setOnUpdate((u) => {
        for (const [k, v] of Object.entries(u.measures)) measures[Number(k)] = v
    })
    const size = Math.ceil(audio.byteLength / CHUNKS)
    for (let o = 0; o < audio.byteLength; o += size) {
        pipeline.appendChunk(audio.subarray(o, Math.min(o + size, audio.byteLength)))
    }
    await pipeline.finalize()
    return measures
}

function respond(payload: unknown): void {
    process.stdout.write('@@RES ' + JSON.stringify(payload) + '\n')
}

function clip(s: string, n = 400): string {
    return s.length > n ? `${s.slice(0, n)}…` : s
}

async function main(): Promise<void> {
    const era = detectEra()
    await captureLogger()
    await stubDebugBundle(era)
    const newPipeline = await buildFactory(era)
    // A provider that failed to load is logged, not thrown, by the registry: fail loudly instead.
    const startErrors = captured.filter((m) => m.level === 'error')
    if (startErrors.length) throw new Error(startErrors.map((m) => m.msg).join(' | '))
    captured.length = 0
    process.stdout.write(`@@READY ${era}\n`)

    // Serialize requests: the pipeline is CPU-bound; parallelism is K processes.
    let chain: Promise<void> = Promise.resolve()
    const rl = createInterface({ input: process.stdin })
    rl.on('line', (line) => {
        if (!line.trim()) return
        chain = chain.then(async () => {
            let id = -1
            const t0 = process.hrtime.bigint()
            captured.length = 0
            try {
                const req = JSON.parse(line) as Request
                id = req.id
                const measures = await transcribe(newPipeline, req)
                const ms = Number((process.hrtime.bigint() - t0) / 1_000_000n)
                // Only the final pass runs (finalize() clears the debounce before it
                // fires), so a decode that gives up here means the clip was never heard.
                const failed = captured.filter((m) => FAILURE.test(m.msg))
                const other = captured.filter((m) => !failed.includes(m))
                respond({
                    id,
                    ok: true,
                    measures,
                    ms,
                    ...(failed.length ? { err: clip('pass: ' + failed.map((m) => m.msg).join(' | ')) } : {}),
                    ...(other.length ? { warn: clip([...new Set(other.map((m) => m.msg))].join(' | ')) } : {}),
                })
            } catch (err) {
                const ms = Number((process.hrtime.bigint() - t0) / 1_000_000n)
                respond({ id, ok: false, ms, err: clip(`threw: ${err instanceof Error ? err.message : String(err)}`) })
            }
        })
    })
    rl.on('close', () => {
        void chain.then(() => process.exit(0))
    })
}

main().catch((err: unknown) => {
    process.stdout.write(`@@FATAL ${err instanceof Error ? err.message : String(err)}\n`)
    process.exit(1)
})
