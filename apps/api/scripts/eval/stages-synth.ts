/**
 * Stage dump for one realistic-synthetic clip: which pipeline stage creates an
 * error? Prints the resolved profile, the OnsetDetector's re-attacks, the
 * provider's raw notes and the extractor's deduced notes, next to the truth.
 *
 * Run: pnpm --filter @mushee/api exec tsx scripts/eval/stages-synth.ts <dataset> <clip> [condition=room] [t0] [t1]
 */

import { readFileSync } from 'fs'
import { join } from 'path'

import { AudioConverter } from '../../src/recordings/pipeline/audio-converter'
import { AudioDecoder } from '../../src/recordings/pipeline/audio-decoder'
import { OnsetDetector } from '../../src/recordings/pipeline/onset-detector'
import { ProfileResolver } from '../../src/recordings/pipeline/profiles/profile-resolver'
import { ProviderRegistry } from '../../src/recordings/pipeline/providers/provider-registry'
import { SYNTH_REALISTIC_ROOT } from './lib/evalRun'
import { discoverRealDatasets } from './lib/realCorpus'
import type { GroundTruth } from './types'

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const name = (m: number) => `${NAMES[((Math.round(m) % 12) + 12) % 12]}${Math.floor(Math.round(m) / 12) - 1}`

async function main(): Promise<void> {
    const [dsId, clip, cond = 'room', t0s = '0', t1s = '1e9'] = process.argv.slice(2)
    const t0 = Number(t0s)
    const t1 = Number(t1s)
    const ds = discoverRealDatasets(SYNTH_REALISTIC_ROOT).find((d) => d.id === dsId)
    if (!ds) throw new Error(`unknown dataset ${dsId}`)
    const truth = JSON.parse(readFileSync(join(ds.dir, `${clip}.truth.json`), 'utf8')) as GroundTruth
    const buf = readFileSync(join(ds.dir, `${clip}__${cond}.wav`))
    const registry = new ProviderRegistry({ crepeTiny: join(process.cwd(), 'model-crepe-tiny') })
    await registry.initAll()
    const decoder = new AudioDecoder()
    const det = await decoder.decode(buf, 16000, { loudnorm: false, highpassHz: 30 })
    const profile = new ProfileResolver().resolve(det.samples, 16000, { instrumentId: ds.instrumentId, sourceKind: ds.kind === 'voice' ? 'voice' : 'instrument' })
    const provider = registry.get(profile.providerName)
    const decoded = await decoder.decode(buf, provider.sampleRate, { loudnorm: provider.normalizeLoudness, highpassHz: profile.highpassHz, denoise: profile.denoise })
    console.log(`profile ${profile.id} provider ${profile.providerName} onsetDelay=${profile.onsetDelaySec ?? '-'} segmentMode=${profile.segmentMode ?? '-'}`)
    const onsets = new OnsetDetector({ delaySec: profile.onsetDelaySec }).detect(decoded.samples, provider.sampleRate)
    const inWin = (t: number) => t >= t0 && t <= t1
    console.log(`\nonsets: ${onsets.filter(inWin).map((t) => t.toFixed(2)).join(' ')}`)
    const out = await new AudioConverter(provider, { enableOnsetSplit: true, profile }).convert(decoded.samples, { bpm: truth.bpm }, undefined, {
        minFreqHz: profile.minFreqHz,
        maxFreqHz: profile.maxFreqHz,
        confidenceThreshold: profile.confidenceThreshold,
        minFramesPerNote: profile.minFramesPerNote,
        segmentMode: profile.segmentMode,
        smoothFrames: profile.smoothFrames,
    })
    const fmt = (ns: { startTimeSeconds: number; durationSeconds: number; pitchMidi: number }[]) =>
        ns
            .filter((n) => inWin(n.startTimeSeconds))
            .map((n) => `${n.startTimeSeconds.toFixed(2)}+${n.durationSeconds.toFixed(2)} ${name(n.pitchMidi)}`)
            .join('\n  ')
    console.log(`\nTRUTH\n  ${truth.notes.filter((n) => inWin(n.onsetSec)).map((n) => `${n.onsetSec.toFixed(2)}+${n.durSec.toFixed(2)} ${name(n.midi)}`).join('\n  ')}`)
    console.log(`\nRAW (provider)\n  ${fmt(out.raw)}`)
    console.log(`\nDEDUCED (extractor)\n  ${fmt(out.deduced)}`)
}

main().catch((e) => {
    console.error(e)
    process.exit(1)
})
