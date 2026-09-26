/**
 * Does a silent lead-in still wreck a take? The production `RecordingPipeline`
 * locks its adaptive profile from the first audio; until 2026-09-01 a prefix with
 * no reliable pitch locked the blind `default-wide` fallback for the whole take.
 * This probe prepends `LEADIN_SEC` of near-silence to real clips and drives them
 * through the REAL pipeline, paced so the lock happens on the prefix as it does
 * live (`runThroughPipelineStreaming`), then scores against the shifted truth.
 *
 *   PROBE_MODE=legacy npx tsx scripts/eval/probe-leadin.ts   # pre-2026-09 lock
 *   PROBE_MODE=new    npx tsx scripts/eval/probe-leadin.ts   # deferred lock + final re-route
 *
 * Env: LEADIN_SEC (3), PROBE_DATASETS (vocadito,hust-solfege,whistle-real,urmp-flute),
 *      PROBE_PER_DATASET (6), EVAL_SPLIT.
 *
 * The two behaviours are selected through the pipeline's own kill-switches
 * (`RECORDING_DETECT_MAX_WAIT_SEC`, `RECORDING_FINAL_REROUTE`), which are read at
 * module load — hence the dynamic imports below.
 */

import { readFileSync } from 'fs'
import { join, resolve } from 'path'

import { type EstNote, scoreNotes } from './lib/metrics'
import { discoverRealDatasets, listRealClips } from './lib/realCorpus'
import { inSplit, splitFromEnv } from './lib/split'
import { floatToWav, wavToFloat } from './lib/wav'
import type { GroundTruth, TruthNote } from './types'

const REAL_ROOT = resolve(__dirname, '../fixtures/eval-real')
const MODELS = { crepeTiny: resolve(process.cwd(), 'model-crepe-tiny') }
const LEADIN_SEC = Number(process.env.LEADIN_SEC) || 3
const PER_DATASET = Number(process.env.PROBE_PER_DATASET) || 6
const DATASETS = (process.env.PROBE_DATASETS ?? 'vocadito,hust-solfege,whistle-real,urmp-flute').split(',')

function withLeadIn(wav: Buffer, sec: number): Buffer {
    const { samples, sampleRate } = wavToFloat(wav)
    const pad = Math.round(sec * sampleRate)
    const out = new Float32Array(pad + samples.length)
    // Near-silence rather than digital zero: a real mic floor, so the scan's
    // level gates see what they would see live.
    for (let i = 0; i < pad; i += 1) out[i] = (Math.random() - 0.5) * 2e-4
    out.set(samples, pad)
    return floatToWav(out, sampleRate)
}

function shift(notes: TruthNote[], sec: number): TruthNote[] {
    return notes.map((n) => ({ ...n, onsetSec: n.onsetSec + sec }))
}

function mean(xs: number[]): number {
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0
}

async function main(): Promise<void> {
    const mode = process.env.PROBE_MODE === 'legacy' ? 'legacy' : 'new'
    if (mode === 'legacy') {
        process.env.RECORDING_DETECT_MAX_WAIT_SEC = '0'
        process.env.RECORDING_FINAL_REROUTE = '0'
    }
    // Quiet passes so the 3 s lead-in actually spans several of them.
    process.env.RECORDING_DEBOUNCE_MS ??= '150'

    const { ProviderRegistry } = await import('../../src/recordings/pipeline/providers/provider-registry')
    const { ProfileResolver } = await import('../../src/recordings/pipeline/profiles/profile-resolver')
    const { runThroughPipelineStreaming } = await import('./lib/pipelineRun')

    const registry = new ProviderRegistry(MODELS)
    await registry.initAll()
    const resolver = new ProfileResolver()
    const split = splitFromEnv()

    console.log(`probe-leadin — mode=${mode}, lead-in ${LEADIN_SEC} s, split=${split}\n`)
    console.log('dataset'.padEnd(20) + 'n'.padEnd(4) + 'COnP no lead-in'.padEnd(18) + 'COnP with lead-in'.padEnd(20) + 'Δ')

    const all: { plain: number; lead: number }[] = []
    for (const ds of discoverRealDatasets(REAL_ROOT).filter((d) => DATASETS.includes(d.id))) {
        const clips = listRealClips(ds.dir)
            .filter((c) => inSplit(ds.id, c, split))
            .slice(0, PER_DATASET)
        const plain: number[] = []
        const lead: number[] = []
        for (const clip of clips) {
            const truth = JSON.parse(readFileSync(join(ds.dir, `${clip}.truth.json`), 'utf8')) as GroundTruth
            const wav = readFileSync(join(ds.dir, `${clip}__real.wav`))
            const hint = ds.instrumentId ?? 'voice-lead'
            const run = async (audio: Buffer): Promise<EstNote[]> =>
                runThroughPipelineStreaming(registry, resolver, audio, truth.bpm, 4, hint, {
                    chunks: 40,
                    chunkDelayMs: 60,
                })
            const a = await run(wav)
            const b = await run(withLeadIn(wav, LEADIN_SEC))
            plain.push(scoreNotes(truth.notes, a).f1)
            lead.push(scoreNotes(shift(truth.notes, LEADIN_SEC), b).f1)
        }
        for (let i = 0; i < plain.length; i += 1) all.push({ plain: plain[i], lead: lead[i] })
        console.log(
            ds.id.padEnd(20) +
                String(clips.length).padEnd(4) +
                mean(plain).toFixed(3).padEnd(18) +
                mean(lead).toFixed(3).padEnd(20) +
                (mean(lead) - mean(plain) >= 0 ? '+' : '') +
                (mean(lead) - mean(plain)).toFixed(3),
        )
    }
    console.log(
        '\nALL'.padEnd(21) +
            String(all.length).padEnd(4) +
            mean(all.map((x) => x.plain))
                .toFixed(3)
                .padEnd(18) +
            mean(all.map((x) => x.lead)).toFixed(3),
    )
}

main().catch((err) => {
    console.error(err)
    process.exit(1)
})
