/**
 * Score an EXTERNAL transcription system's note output against the real corpus,
 * under exactly the harness's conventions (COnP @ ±100 ms, Amax over alternate
 * annotations, per-dataset means) — the §10d gate that turns "should we acquire
 * a learned note model" from taste into arithmetic.
 *
 * Input: a directory of `<dataset>__<clip>.json` files, each
 * `[[onset_s, offset_s, midi], ...]` — produce them with whatever runner the
 * external system needs (for Yong-2023: `bench-yong-runner.py` next to this
 * file, which documents the full setup).
 *
 * Run: EXT_DIR=/path/to/jsons [EVAL_SPLIT=test] \
 *      pnpm --filter @mushee/api exec tsx scripts/eval/bench-external-notes.ts
 *
 * Numbers here are comparable to `sweep-voice.ts` rows (same metric, same
 * split, same per-dataset-then-mean pooling), NOT to published COnPOff.
 */

import { existsSync, readdirSync, readFileSync } from 'fs'
import { join, resolve } from 'path'

import { type EstNote, scoreNotesBest } from './lib/metrics'
import { addOnsetClassStats, emptyOnsetClassStats, onsetRecallByClass } from './lib/onsetClasses'
import { discoverRealDatasets } from './lib/realCorpus'
import { inSplit, splitFromEnv } from './lib/split'
import type { GroundTruth } from './types'

const REAL_ROOT = resolve(__dirname, '../fixtures/eval-real')
const EXT_DIR = process.env.EXT_DIR

function main(): void {
    if (!EXT_DIR || !existsSync(EXT_DIR)) {
        console.error('EXT_DIR must point at a directory of <dataset>__<clip>.json files')
        process.exit(1)
    }
    const split = splitFromEnv()
    const datasets = new Map(discoverRealDatasets(REAL_ROOT).map((d) => [d.id, d]))

    interface Acc {
        conp: number[]
        con: number[]
        ratio: number[]
    }
    const perDataset = new Map<string, Acc>()
    const classStats = emptyOnsetClassStats()
    let clips = 0

    for (const file of readdirSync(EXT_DIR).sort()) {
        if (!file.endsWith('.json')) continue
        const key = file.replace(/\.json$/, '')
        const sep = key.indexOf('__')
        if (sep < 0) continue
        const dsId = key.slice(0, sep)
        const clip = key.slice(sep + 2)
        const ds = datasets.get(dsId)
        if (!ds || ds.noteTruthDerived) continue
        if (!inSplit(dsId, clip, split)) continue
        const truthPath = join(ds.dir, `${clip}.truth.json`)
        if (!existsSync(truthPath)) continue
        const truth = JSON.parse(readFileSync(truthPath, 'utf8')) as GroundTruth
        const raw = JSON.parse(readFileSync(join(EXT_DIR, file), 'utf8')) as [number, number, number][]
        const est: EstNote[] = raw.map(([on, off, midi]) => ({
            onsetSec: on,
            durSec: Math.max(0.01, off - on),
            midi,
        }))

        const m = scoreNotesBest(truth, est)
        let acc = perDataset.get(dsId)
        if (!acc) {
            acc = { conp: [], con: [], ratio: [] }
            perDataset.set(dsId, acc)
        }
        acc.conp.push(m.f1)
        acc.con.push(m.chromaF1)
        acc.ratio.push(truth.notes.length ? est.length / truth.notes.length : 0)
        addOnsetClassStats(classStats, onsetRecallByClass(truth.notes, est))
        clips += 1
    }

    const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)

    console.log(`external notes from ${EXT_DIR}  split=${split}  clips=${clips}\n`)
    const entries = [...perDataset.entries()].sort(([a], [b]) => a.localeCompare(b))
    for (const [id, a] of entries) {
        console.log(
            `${id.padEnd(20)} COnP=${mean(a.conp).toFixed(3)} chromaF1=${mean(a.con).toFixed(3)} ` +
                `ratio=${mean(a.ratio).toFixed(2)} (${a.conp.length} clips)`,
        )
    }
    const voiceMean = mean(entries.map(([, a]) => mean(a.conp)))
    console.log(`\nVOICE (dataset-mean COnP@0.1): ${voiceMean.toFixed(3)}`)
    const rec = (c: { matched: number; total: number }): string => `${(c.total ? c.matched / c.total : 0).toFixed(3)}(${c.total})`
    console.log(
        `onset recall by class: reOn=${rec(classStats.reonset)} ` + `trans=${rec(classStats.transition)} sil=${rec(classStats.silence)}`,
    )
}

main()
