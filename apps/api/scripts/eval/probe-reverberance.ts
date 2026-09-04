/**
 * Distribution of the production reverberance estimate per dataset (clean
 * takes) and per degraded variant — the separability check behind any
 * room-gated mechanism (R21's adaptive dropout fill was the occasion): a gate
 * can only ship if clean corpora and reverberant audio actually separate.
 *
 * Run: pnpm --filter @mushee/api exec tsx scripts/eval/probe-reverberance.ts
 * Env: PROBE_LIMIT=n   clips sampled per dataset (default 30)
 *      EVAL_SPLIT=dev|test|all (default dev)
 */

import { readFileSync } from 'fs'
import { join, resolve } from 'path'

import { AudioDecoder } from '../../src/recordings/pipeline/audio-decoder'
import { estimateReverberance } from '../../src/recordings/pipeline/profiles/profile-resolver'
import { discoverRealDatasets, listRealClips } from './lib/realCorpus'
import { inSplit, splitFromEnv } from './lib/split'

const REAL_ROOT = resolve(__dirname, '../fixtures/eval-real')
const VARIANTS = ['real', 'echoey-room', 'distant-mic']

function quantiles(xs: number[]): string {
    if (!xs.length) return '—'
    const s = [...xs].sort((a, b) => a - b)
    const q = (p: number): number => s[Math.min(s.length - 1, Math.floor(p * s.length))]
    return `p10=${q(0.1).toFixed(2)} med=${q(0.5).toFixed(2)} ` + `p90=${q(0.9).toFixed(2)} n=${s.length}`
}

async function main(): Promise<void> {
    const decoder = new AudioDecoder()
    const split = splitFromEnv()
    const limit = Number(process.env.PROBE_LIMIT ?? 30)
    const datasets = discoverRealDatasets(REAL_ROOT).filter((d) => !d.noteTruthDerived && d.corpusSplit !== 'test')
    for (const ds of datasets) {
        const perVariant = new Map<string, number[]>(VARIANTS.map((v) => [v, []]))
        let used = 0
        for (const clip of listRealClips(ds.dir)) {
            if (used >= limit) break
            if (!inSplit(ds.id, clip, split)) continue
            used += 1
            for (const variant of VARIANTS) {
                let wav: Buffer
                try {
                    wav = readFileSync(join(ds.dir, `${clip}__${variant}.wav`))
                } catch {
                    continue
                }
                const det = await decoder.decode(wav, 16000, { loudnorm: false, highpassHz: 30 })
                perVariant.get(variant)?.push(estimateReverberance(det.samples, 16000))
            }
        }
        const parts = VARIANTS.map((v) => `${v}: ${quantiles(perVariant.get(v) ?? [])}`)
        console.log(`${ds.id.padEnd(22)} ${parts.join('   ')}`)
    }
}

main().catch((e) => {
    console.error(e)
    process.exit(1)
})
