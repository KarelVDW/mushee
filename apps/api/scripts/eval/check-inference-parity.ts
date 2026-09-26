/**
 * Parity gate for the remote inference service. Compares the in-process TF.js
 * forward pass (LocalModelBackend) against the remote gRPC service, both as a
 * tight numeric tensor diff and end-to-end through the real RecordingPipeline.
 *
 *   CREPE_INFERENCE_URL=localhost:50051 \
 *   tsx scripts/eval/check-inference-parity.ts [scenarios] [melody]
 *
 * With the URL unset everything stays local on both sides. Exits non-zero if
 * forward-pass maxAbsDiff exceeds the threshold or any scenario's F1 regresses
 * beyond tolerance.
 */

import { spawn } from 'child_process'
import ffmpegPath from 'ffmpeg-static'
import { readFileSync } from 'fs'
import { join, resolve } from 'path'

import { ProfileResolver } from '../../src/recordings/pipeline/profiles/profile-resolver'
import { LocalModelBackend } from '../../src/recordings/pipeline/providers/local-model-backend'
import type { ModelBackend } from '../../src/recordings/pipeline/providers/model-backend'
import { ProviderRegistry } from '../../src/recordings/pipeline/providers/provider-registry'
import { RemoteModelBackend } from '../../src/recordings/pipeline/providers/remote-model-backend'
import { scoreNotes } from './lib/metrics'
import { runThroughPipeline } from './lib/pipelineRun'
import { SCENARIOS } from './scenarios'
import type { GroundTruth } from './types'

const EVAL_ROOT = resolve(__dirname, '../fixtures/eval')
const DIRS = {
    crepeTiny: resolve(process.cwd(), 'model-crepe-tiny'),
}
// Forward-pass sanity bound. CREPE loads the exact tfjs layers weights, so it
// matches to float noise.
const CREPE_FWD_THRESHOLD = 1e-4
const F1_TOLERANCE = 0.02

function remoteOrLocal(local: LocalModelBackend): ModelBackend {
    const crepeUrl = process.env.CREPE_INFERENCE_URL
    return crepeUrl ? new RemoteModelBackend('crepe-tiny', crepeUrl) : local
}

function encodeWebmOpus(wav: Buffer): Promise<Buffer> {
    if (!ffmpegPath) throw new Error('ffmpeg-static missing')
    return new Promise<Buffer>((res, rej) => {
        const proc = spawn(ffmpegPath as string, [
            '-hide_banner',
            '-loglevel',
            'error',
            '-i',
            'pipe:0',
            '-c:a',
            'libopus',
            '-b:a',
            '128k',
            '-f',
            'webm',
            'pipe:1',
        ])
        const out: Buffer[] = []
        proc.stdout.on('data', (c: Buffer) => out.push(c))
        proc.on('error', rej)
        proc.on('close', (code) => (out.length ? res(Buffer.concat(out)) : rej(new Error(`encode failed (${code})`))))
        proc.stdin.on('error', () => {})
        proc.stdin.end(wav)
    })
}

async function main(): Promise<void> {
    const local = new LocalModelBackend(DIRS)
    const remote = remoteOrLocal(local)
    let failed = false

    // (A) numeric forward-pass parity on a deterministic CREPE batch.
    if (process.env.CREPE_INFERENCE_URL) {
        const N = 8,
            F = 1024
        const flat = new Float32Array(N * F)
        for (let k = 0; k < N; k++) {
            const row = new Float64Array(F)
            for (let i = 0; i < F; i++) row[i] = Math.sin(i * 0.005 * (k + 1)) + 0.1 * (k + 1)
            let mean = 0
            for (let i = 0; i < F; i++) mean += row[i]
            mean /= F
            let v = 0
            for (let i = 0; i < F; i++) v += (row[i] - mean) ** 2
            v /= F
            const std = Math.sqrt(v)
            for (let i = 0; i < F; i++) flat[k * F + i] = (row[i] - mean) / (std + 1e-9)
        }
        const a = await local.crepePredict(flat, N)
        const b = await remote.crepePredict(flat, N)
        let max = 0
        for (let i = 0; i < a.length; i++) max = Math.max(max, Math.abs(a[i] - b[i]))
        const ok = max <= CREPE_FWD_THRESHOLD
        console.log(`[A] CREPE forward-pass maxAbsDiff=${max.toExponential(3)} ${ok ? 'OK' : 'FAIL'}`)
        if (!ok) failed = true
    }

    // (B) end-to-end pipeline parity (local registry vs remote-backed registry).
    const localReg = new ProviderRegistry(DIRS, local)
    const remoteReg = new ProviderRegistry(DIRS, remote)
    const resolver = new ProfileResolver()
    const ids = (process.argv[2] ?? 'voice-tenor,trumpet-mid,cello-low,oboe-high,whistle-high,piccolo-veryhigh')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    const melody = process.argv[3] ?? 'tune'

    console.log(`\n[B] pipeline parity  ${'scenario'.padEnd(18)}F1(local) F1(remote) Δ`)
    for (const id of ids) {
        const sc = SCENARIOS.find((s) => s.id === id)
        let truth: GroundTruth, wav: Buffer
        try {
            truth = JSON.parse(readFileSync(join(EVAL_ROOT, id, `${melody}.truth.json`), 'utf8')) as GroundTruth
            wav = readFileSync(join(EVAL_ROOT, id, `${melody}__clean.wav`))
        } catch {
            console.log(`  ${id}: missing fixture`)
            continue
        }
        const webm = await encodeWebmOpus(wav)
        const instr = sc?.instrumentId ?? ''
        const fLocal = scoreNotes(truth.notes, await runThroughPipeline(localReg, resolver, webm, truth.bpm, 4, instr)).f1
        const fRemote = scoreNotes(truth.notes, await runThroughPipeline(remoteReg, resolver, webm, truth.bpm, 4, instr)).f1
        const d = fRemote - fLocal
        const ok = Math.abs(d) <= F1_TOLERANCE
        if (!ok) failed = true
        console.log(
            `    ${id.padEnd(18)}${fLocal.toFixed(3).padEnd(10)}${fRemote.toFixed(3).padEnd(11)}` +
                `${d >= 0 ? '+' : ''}${d.toFixed(3)} ${ok ? '' : 'FAIL'}`,
        )
    }

    console.log(failed ? '\nPARITY GATE: FAIL' : '\nPARITY GATE: PASS')
    process.exit(failed ? 1 : 0)
}

main().catch((e) => {
    console.error(e)
    process.exit(1)
})
