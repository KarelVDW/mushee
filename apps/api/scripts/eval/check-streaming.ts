/**
 * Validation for the streaming-decode + windowed-transcription change.
 *
 * Two checks, both run through the REAL components:
 *
 *  1. Decoder parity — decode a webm/opus clip one-shot (`AudioDecoder.decode`)
 *     vs. fed incrementally to a `StreamingDecoder`, and assert the PCM is
 *     identical. Proves the persistent decoder produces the same samples as the
 *     old whole-buffer decode (single-pass loudnorm is causal + bounded
 *     look-ahead, so chunking the input must not change the output).
 *
 *  2. Windowing accuracy — for several scenarios, run each clip through the
 *     pipeline two ways: instant-feed (one final pass over the whole buffer, =
 *     the old behaviour) and paced-feed (many incremental windowed passes). Score
 *     both against ground truth and report the note delta between them. If
 *     windowing is correct the committed notes match the whole-buffer result —
 *     onsets, pitches AND lengths (durΔ: shared notes whose length differs).
 *
 *  3. Held notes — synthetic phrases built around what the clean melodies never
 *     hold: a note sounding past the commit margin, and one with a sub-gate
 *     dropout and a short same-pitch fragment (the gap bridge's territory). Same
 *     two runs; any disagreement is a failure (exit code 1).
 *
 *   RECORDING_DEBOUNCE_MS=150 tsx scripts/eval/check-streaming.ts [scenarios] [melody]
 */

import { spawn } from 'child_process'
import ffmpegPath from 'ffmpeg-static'
import { readFileSync } from 'fs'
import { join, resolve } from 'path'

import { AudioDecoder, StreamingDecoder } from '../../src/recordings/pipeline/audio-decoder'
import { ProfileResolver } from '../../src/recordings/pipeline/profiles/profile-resolver'
import { ProviderRegistry } from '../../src/recordings/pipeline/providers/provider-registry'
import { type EstNote, scoreNotes } from './lib/metrics'
import { runThroughPipeline, runThroughPipelineStreaming } from './lib/pipelineRun'
import { floatToWav } from './lib/wav'
import { SCENARIOS } from './scenarios'
import type { GroundTruth, TruthNote } from './types'

const EVAL_ROOT = resolve(__dirname, '../fixtures/eval')
const MODELS = {
    crepeTiny: resolve(process.cwd(), 'model-crepe-tiny'),
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
        proc.on('close', (code) => {
            const o = Buffer.concat(out)
            if (o.length) res(o)
            else rej(new Error(`encode failed (${code})`))
        })
        proc.stdin.on('error', () => {})
        proc.stdin.end(wav)
    })
}

/** Decode `webm` via the StreamingDecoder, fed in `nChunks` byte slices. */
async function streamDecode(webm: Buffer, sampleRate: number, loudnorm: boolean, nChunks: number): Promise<Float32Array> {
    const dec = new StreamingDecoder(sampleRate, { loudnorm, highpassHz: 80 })
    const size = Math.ceil(webm.byteLength / nChunks)
    for (let o = 0; o < webm.byteLength; o += size) {
        dec.write(webm.subarray(o, Math.min(o + size, webm.byteLength)))
    }
    return dec.finalize()
}

function maxAbsDiff(a: Float32Array, b: Float32Array): { n: number; max: number } {
    const n = Math.min(a.length, b.length)
    let max = 0
    for (let i = 0; i < n; i++) max = Math.max(max, Math.abs(a[i] - b[i]))
    return { n, max }
}

/**
 * Set-difference of two note lists keyed on rounded onset + midi, plus the
 * shared notes whose lengths differ — COnP cannot see those, the score can.
 */
function noteDelta(a: EstNote[], b: EstNote[]): { onlyA: number; onlyB: number; durDiff: number } {
    const key = (n: EstNote): string => `${Math.round(n.onsetSec * 50)}_${n.midi}`
    const da = new Map(a.map((n) => [key(n), n.durSec]))
    const db = new Map(b.map((n) => [key(n), n.durSec]))
    let onlyA = 0
    let onlyB = 0
    let durDiff = 0
    for (const [k, dur] of da) {
        const other = db.get(k)
        if (other === undefined) onlyA++
        else if (Math.abs(other - dur) > 1e-6) durDiff++
    }
    for (const k of db.keys()) if (!da.has(k)) onlyB++
    return { onlyA, onlyB, durDiff }
}

/** A synthetic note; `dropoutAtSec` swaps the tone for equal-level noise there for `DROPOUT_SEC`. */
interface HeldNote extends TruthNote {
    dropoutAtSec?: number
}

interface HeldScenario {
    id: string
    bpm: number
    instrumentId: string
    notes: HeldNote[]
}

/**
 * Part 3's phrases (2026-11, review of the pipeline-accuracy pass). Paced passes
 * used to commit a held note as soon as its WRITTEN end — floor-snapped to a
 * standard length — cleared the margin, i.e. while it was still sounding, and
 * never lengthened it afterwards: the 3-beat note below streamed as 1.5 beats.
 * The dropout phrase is the same failure inside the gap bridge's territory: a
 * dip below the voicing gate (pitch-less noise at the tone's level, so no
 * re-attack) 80 ms long, then a 0.18 s fragment the whole-buffer pass bridges
 * back onto the held note.
 */
const HELD_SCENARIOS: HeldScenario[] = [
    {
        id: 'held-60bpm',
        bpm: 60,
        instrumentId: 'cello',
        notes: [
            { onsetSec: 0.5, durSec: 3.2, midi: 57 },
            { onsetSec: 4.25, durSec: 1.0, midi: 60 },
            { onsetSec: 5.5, durSec: 2.2, midi: 64 },
        ],
    },
    {
        // Unbridged the held note is 2.9 beats (written 2), bridged 3.16 (written 3).
        id: 'dropout-60bpm',
        bpm: 60,
        instrumentId: 'cello',
        notes: [
            { onsetSec: 0.5, durSec: 3.16, midi: 57, dropoutAtSec: 3.4 },
            { onsetSec: 4.25, durSec: 1.0, midi: 60 },
            { onsetSec: 5.5, durSec: 1.0, midi: 64 },
        ],
    },
    {
        // Unbridged 2.6 beats (written 2), bridged 3.12 (written 3).
        id: 'dropout-120bpm',
        bpm: 120,
        instrumentId: 'cello',
        notes: [
            { onsetSec: 0.5, durSec: 1.56, midi: 57, dropoutAtSec: 1.8 },
            { onsetSec: 2.5, durSec: 0.5, midi: 60 },
            { onsetSec: 3.0, durSec: 1.0, midi: 64 },
        ],
    },
]

const SYNTH_RATE = 44100
const DROPOUT_SEC = 0.08

/**
 * Render `notes` as an 8-harmonic tone (1/k partials, 20 ms ramps). A dropout
 * swaps the tone for white noise of the same RMS — the voicing gate closes,
 * the energy envelope (what the onset detector reads) does not dip.
 */
function synthesizeHeld(notes: HeldNote[]): Buffer {
    const HARMONICS = 8
    let toneMeanSquare = 0
    for (let k = 1; k <= HARMONICS; k++) toneMeanSquare += 1 / (2 * k * k)
    const noiseGain = Math.sqrt(toneMeanSquare) * Math.sqrt(3) // uniform noise in ±1 has RMS 1/√3
    let seed = 1
    const noise = (): number => {
        seed = (Math.imul(seed, 1103515245) + 12345) >>> 0
        return seed / 2 ** 31 - 1
    }
    const end = Math.max(...notes.map((n) => n.onsetSec + n.durSec)) + 0.75
    const out = new Float32Array(Math.ceil(end * SYNTH_RATE))
    const ramp = 0.02 * SYNTH_RATE
    for (const n of notes) {
        const f0 = 440 * 2 ** ((n.midi - 69) / 12)
        const first = Math.round(n.onsetSec * SYNTH_RATE)
        const len = Math.round(n.durSec * SYNTH_RATE)
        for (let i = 0; i < len; i++) {
            const t = i / SYNTH_RATE
            const at = n.onsetSec + t
            let v = 0
            if (n.dropoutAtSec !== undefined && at >= n.dropoutAtSec && at < n.dropoutAtSec + DROPOUT_SEC) v = noiseGain * noise()
            else for (let k = 1; k <= HARMONICS; k++) v += Math.sin(2 * Math.PI * k * f0 * t) / k
            out[first + i] = 0.12 * Math.min(1, i / ramp, (len - i) / ramp) * v
        }
    }
    return floatToWav(out, SYNTH_RATE)
}

const fmtNotes = (notes: EstNote[]): string => notes.map((n) => `${n.onsetSec.toFixed(2)}+${n.durSec.toFixed(2)}/${n.midi}`).join(' ')

async function main(): Promise<void> {
    const registry = new ProviderRegistry({
        crepeTiny: MODELS.crepeTiny,
    })
    await registry.initAll()
    const resolver = new ProfileResolver()

    const scenarioIds = (process.argv[2] ?? 'whistle-high,piccolo-veryhigh,voice-tenor,trumpet-mid,cello-low')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    const melody = process.argv[3] ?? 'tune'

    // 1. Decoder parity — one-shot vs streamed must be bit-for-bit equal.
    console.log('=== decoder parity (one-shot vs streamed) ===')
    const oneShot = new AudioDecoder()
    {
        const wav = readFileSync(join(EVAL_ROOT, scenarioIds[0], `${melody}__clean.wav`))
        const webm = await encodeWebmOpus(wav)
        for (const loudnorm of [true, false]) {
            const ref = await oneShot.decode(webm, 22050, { loudnorm, highpassHz: 80 })
            const streamed = await streamDecode(webm, 22050, loudnorm, 37)
            const d = maxAbsDiff(ref.samples, streamed)
            const lenDiff = Math.abs(ref.samples.length - streamed.length)
            console.log(
                `  loudnorm=${String(loudnorm).padEnd(5)} ` +
                    `oneShot=${ref.samples.length} streamed=${streamed.length} ` +
                    `lenDiff=${lenDiff} maxAbsDiff=${d.max.toExponential(2)}`,
            )
        }
    }

    // 2. Windowing accuracy — instant (one final pass) vs paced (many windowed).
    console.log(`\n=== windowing accuracy (debounce=${process.env.RECORDING_DEBOUNCE_MS ?? '1000'}ms) ===`)
    const header =
        `${'scenario'.padEnd(18)}${'F1(single)'.padEnd(12)}${'F1(stream)'.padEnd(12)}` +
        `${'COnPOff(single/stream)'.padEnd(24)}${'noteΔ(only-single/only-stream)'.padEnd(32)}durΔ`
    const compare = async (
        id: string,
        webm: Buffer,
        truth: GroundTruth,
        instr: string,
    ): Promise<{ single: EstNote[]; stream: EstNote[]; delta: ReturnType<typeof noteDelta> }> => {
        const single = await runThroughPipeline(registry, resolver, webm, truth.bpm, 4, instr)
        const stream = await runThroughPipelineStreaming(registry, resolver, webm, truth.bpm, 4, instr)
        const mSingle = scoreNotes(truth.notes, single)
        const mStream = scoreNotes(truth.notes, stream)
        const delta = noteDelta(single, stream)
        console.log(
            `${id.padEnd(18)}${mSingle.f1.toFixed(3).padEnd(12)}${mStream.f1.toFixed(3).padEnd(12)}` +
                `${`${mSingle.f1Off.toFixed(3)}/${mStream.f1Off.toFixed(3)}`.padEnd(24)}` +
                `${`${delta.onlyA}/${delta.onlyB}`.padEnd(32)}${delta.durDiff}`,
        )
        return { single, stream, delta }
    }
    console.log(header)
    for (const id of scenarioIds) {
        const scenario = SCENARIOS.find((s) => s.id === id)
        let truth: GroundTruth
        let wav: Buffer
        try {
            truth = JSON.parse(readFileSync(join(EVAL_ROOT, id, `${melody}.truth.json`), 'utf8')) as GroundTruth
            wav = readFileSync(join(EVAL_ROOT, id, `${melody}__clean.wav`))
        } catch {
            console.log(`  ${id}: missing fixture`)
            continue
        }
        await compare(id, await encodeWebmOpus(wav), truth, scenario?.instrumentId ?? '')
    }

    // 3. Held notes — paced must reproduce the whole-buffer score exactly.
    console.log(`\n=== held notes (paced must equal whole-buffer) ===`)
    console.log(header)
    const failures: string[] = []
    for (const sc of HELD_SCENARIOS) {
        const truth: GroundTruth = { bpm: sc.bpm, notes: sc.notes.map(({ onsetSec, durSec, midi }) => ({ onsetSec, durSec, midi })) }
        const { single, stream, delta } = await compare(sc.id, await encodeWebmOpus(synthesizeHeld(sc.notes)), truth, sc.instrumentId)
        console.log(`${''.padEnd(18)}whole-buffer: ${fmtNotes(single)}`)
        if (delta.onlyA || delta.onlyB || delta.durDiff) {
            console.log(`${''.padEnd(18)}paced:        ${fmtNotes(stream)}`)
            failures.push(sc.id)
        }
    }
    if (failures.length) {
        console.log(`\nFAIL: paced ≠ whole-buffer on ${failures.join(', ')}`)
        process.exitCode = 1
    }
}

main().catch((e) => {
    console.error(e)
    process.exit(1)
})
