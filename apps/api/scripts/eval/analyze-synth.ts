/**
 * Per-note error census over the realistic synthetic corpus (fixtures/eval-synth).
 *
 * Averages hide the shapes of error; the synthetic corpus knows every note's
 * exact truth *and* how it was performed (legato/staccato/slide, in its
 * meta.json), so a census can say which KIND of note the production path gets
 * wrong. Each truth note is classified against the estimates of the production
 * path (resolver → provider → decoder → quantisation, as `benchmark.ts --synth`):
 *
 *   ok        an estimate with the same pitch whose onset is within ±100 ms
 *   late/early same pitch overlaps the note but its onset is > 100 ms off
 *   split     ≥ 2 estimates with the note's pitch start inside it
 *   merged    the note is covered by an estimate that started on an earlier truth note of the same pitch
 *   pitch     only different-pitch estimates overlap it (octave errors flagged)
 *   missed    nothing overlaps it
 *
 * Run: pnpm --filter @mushee/api exec tsx scripts/eval/analyze-synth.ts [condition=room] [shard=0] [shards=1] > out.jsonl
 */

import { readFileSync } from 'fs'
import { join } from 'path'

import { AudioDecoder } from '../../src/recordings/pipeline/audio-decoder'
import { buildTranscriber, defaultEvalOptions, SYNTH_REALISTIC_ROOT } from './lib/evalRun'
import { discoverRealDatasets, listRealClips } from './lib/realCorpus'
import type { GroundTruth } from './types'

interface Est {
    onsetSec: number
    durSec: number
    midi: number
}

function classify(truth: GroundTruth['notes'], est: Est[]) {
    const used = new Set<number>()
    // one-to-one "ok" matches first, closest onset wins
    const okFor = new Map<number, number>()
    const pairs: Array<[number, number, number]> = []
    truth.forEach((n, ti) =>
        est.forEach((e, ei) => {
            const d = Math.abs(e.onsetSec - n.onsetSec)
            if (e.midi === n.midi && d <= 0.1) pairs.push([d, ti, ei])
        }),
    )
    pairs.sort((a, b) => a[0] - b[0])
    for (const [, ti, ei] of pairs) {
        if (okFor.has(ti) || used.has(ei)) continue
        okFor.set(ti, ei)
        used.add(ei)
    }
    return truth.map((n, ti) => {
        const end = n.onsetSec + n.durSec
        const ov = est.filter((e) => e.onsetSec < end && e.onsetSec + e.durSec > n.onsetSec)
        const same = ov.filter((e) => e.midi === n.midi)
        const inside = same.filter((e) => e.onsetSec >= n.onsetSec - 0.1 && e.onsetSec < end)
        let cat: string
        let dOnsetMs: number | null = null
        if (okFor.has(ti)) {
            const e = est[okFor.get(ti) as number]
            dOnsetMs = Math.round((e.onsetSec - n.onsetSec) * 1000)
            cat = inside.length >= 2 ? 'ok+split' : 'ok'
        } else if (same.length) {
            const first = same[0]
            dOnsetMs = Math.round((first.onsetSec - n.onsetSec) * 1000)
            const prev = ti > 0 ? truth[ti - 1] : undefined
            if (first.onsetSec < n.onsetSec - 0.1 && prev && prev.midi === n.midi && first.onsetSec <= prev.onsetSec + 0.1) cat = 'merged'
            else if (inside.length >= 2) cat = 'split'
            else cat = dOnsetMs > 0 ? 'late' : 'early'
        } else if (ov.length) {
            const oct = ov.some((e) => Math.abs(e.midi - n.midi) % 12 === 0)
            cat = oct ? 'octave' : 'pitch'
        } else cat = 'missed'
        return { i: ti, midi: n.midi, dur: +n.durSec.toFixed(3), onset: +n.onsetSec.toFixed(3), cat, dOnsetMs, nEst: ov.length }
    })
}

async function main(): Promise<void> {
    const [cond = 'room', shardS = '0', shardsS = '1'] = process.argv.slice(2)
    const shard = Number(shardS)
    const shards = Number(shardsS)
    const transcribe = await buildTranscriber(defaultEvalOptions({ synth: true, adaptive: true }), new AudioDecoder())
    const datasets = discoverRealDatasets(SYNTH_REALISTIC_ROOT).filter((_, i) => i % shards === shard)
    for (const ds of datasets) {
        for (const clip of listRealClips(ds.dir)) {
            const truth = JSON.parse(readFileSync(join(ds.dir, `${clip}.truth.json`), 'utf8')) as GroundTruth
            let est: Est[] = []
            try {
                est = await transcribe({ ...ds, rootMidi: 0 } as never, readFileSync(join(ds.dir, `${clip}__${cond}.wav`)), truth.bpm)
            } catch {
                continue
            }
            for (const r of classify(truth.notes, est)) process.stdout.write(JSON.stringify({ d: ds.id, clip, cond, ...r }) + '\n')
        }
        process.stderr.write(`done ${ds.id}\n`)
    }
}

main().catch((e) => {
    console.error(e)
    process.exit(1)
})
