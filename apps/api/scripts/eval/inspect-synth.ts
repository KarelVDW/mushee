/**
 * One realistic-synthetic clip through the PRODUCTION transcription path, printed
 * next to its truth: which notes matched, which split, merged or went missing.
 * The corpus's truth is exact, so every mismatch shown is the pipeline's.
 *
 * Run: pnpm --filter @mushee/api exec tsx scripts/eval/inspect-synth.ts <dataset> <clip> [condition=room]
 */

import { readFileSync } from 'fs'
import { join } from 'path'

import { AudioDecoder } from '../../src/recordings/pipeline/audio-decoder'
import { buildTranscriber, defaultEvalOptions, SYNTH_REALISTIC_ROOT } from './lib/evalRun'
import { discoverRealDatasets } from './lib/realCorpus'
import type { GroundTruth } from './types'

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const name = (m: number) => `${NAMES[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`

async function main(): Promise<void> {
    const [dsId, clip, cond = 'room'] = process.argv.slice(2)
    const ds = discoverRealDatasets(SYNTH_REALISTIC_ROOT).find((d) => d.id === dsId)
    if (!ds) throw new Error(`unknown dataset ${dsId}`)
    const truth = JSON.parse(readFileSync(join(ds.dir, `${clip}.truth.json`), 'utf8')) as GroundTruth
    const transcribe = await buildTranscriber(defaultEvalOptions({ synth: true, adaptive: true }), new AudioDecoder())
    const est = await transcribe({ ...ds, rootMidi: 0 } as never, readFileSync(join(ds.dir, `${clip}__${cond}.wav`)), truth.bpm)
    const used = new Set<number>()
    console.log(`\n${dsId}/${clip} [${cond}]  truth ${truth.notes.length}  est ${est.length}\n`)
    console.log('  TRUTH                          ESTIMATES overlapping it')
    for (const n of truth.notes) {
        const ov = est
            .map((e, i) => ({ e, i }))
            .filter(({ e }) => e.onsetSec < n.onsetSec + n.durSec && e.onsetSec + e.durSec > n.onsetSec)
        const hit = ov.find(({ e, i }) => !used.has(i) && e.midi === n.midi && Math.abs(e.onsetSec - n.onsetSec) <= 0.1)
        if (hit) used.add(hit.i)
        console.log(
            `  ${hit ? 'ok ' : '-- '}${n.onsetSec.toFixed(2).padStart(6)} ${n.durSec.toFixed(2)} ${name(n.midi).padEnd(4)} | ` +
                ov.map(({ e }) => `${e.onsetSec.toFixed(2)}+${e.durSec.toFixed(2)} ${name(e.midi)}`).join('  '),
        )
    }
    const spurious = est.filter((e, i) => !used.has(i) && !truth.notes.some((n) => e.onsetSec < n.onsetSec + n.durSec && e.onsetSec + e.durSec > n.onsetSec))
    if (spurious.length) console.log(`\n  outside any truth note: ${spurious.map((e) => `${e.onsetSec.toFixed(2)} ${name(e.midi)}`).join('  ')}`)
}

main().catch((e) => {
    console.error(e)
    process.exit(1)
})
