/**
 * Apply a degradation Condition to a clean WAV via the bundled ffmpeg binary,
 * writing a new WAV. Always loudness-normalizes first so noise is mixed at a
 * predictable level; then, in physical order: room reverberation (afir
 * convolution with a synthetic impulse response), background noise beds
 * (wind / babble / anoisesrc), and finally the condition's mic EQ chain.
 */

import { execFileSync } from 'child_process'
import ffmpegPath from 'ffmpeg-static'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { basename, join, resolve } from 'path'

import type { Condition } from '../types'
import { synthesizeRoomImpulse, synthesizeSpeechNoise, synthesizeWind } from './acoustics'
import { floatToWav, wavToFloat } from './wav'

/**
 * Loudness normalisation, resampled back to the clip's rate. ffmpeg's loudnorm
 * outputs 192 kHz, and inside the filter graph that rate leaked into everything
 * after it: amix dropped the last ~2.5–2.9 s of the signal (the file kept its
 * length because the noise bed carried on), and afir ran a 44.1 kHz impulse
 * response at 192 kHz, gaining +7–10 dB and hard-clipping the s16 output. Every
 * adverse variant built before 2026-11-01 carries both defects.
 */
const loudnorm = (sampleRate: number) => `loudnorm=I=-16:TP=-3,aresample=${sampleRate}`

/** Longest noise bed we ever need; beds are trimmed to the clip by `-t`. */
const BED_DURATION_SEC = 90

/** Silence appended before a codec encode so its trimmed frame padding costs no signal. */
const CODEC_TAIL_PAD_SEC = 0.25

// Synthetic acoustic assets are deterministic per (kind, params, sampleRate),
// so they are rendered once per process and reused across the whole corpus.
const assetCache = new Map<string, string>()

function assetDir(): string {
    const dir = join(tmpdir(), 'mushee-eval-acoustics')
    mkdirSync(dir, { recursive: true })
    return dir
}

/**
 * Measured room impulse responses (`Condition.ir.file`), fetched and conditioned
 * by fetch/fetch-rirs.ts: direct path at t ≈ 0.5 ms, tail cut at the
 * measurement's noise floor, mean power gain −3 dB over 200 Hz–4 kHz.
 * Gitignored like the rest of fixtures/..
 */
export const RIR_ROOT = resolve(__dirname, '../../fixtures/eval-rir')

function impulseResponsePath(ir: NonNullable<Condition['ir']>, sampleRate: number): string {
    if ('file' in ir) {
        const path = join(RIR_ROOT, ir.file)
        if (!existsSync(path)) throw new Error(`measured RIR ${path} is missing — run fetch/fetch-rirs.ts`)
        return path
    }
    const key = `ir-${ir.rt60Sec}-${ir.wetDb}-${ir.preDelayMs ?? 12}-${sampleRate}`
    const cached = assetCache.get(key)
    if (cached && existsSync(cached)) return cached
    const path = join(assetDir(), `${key}.wav`)
    const samples = synthesizeRoomImpulse({
        sampleRate,
        rt60Sec: ir.rt60Sec,
        wetDb: ir.wetDb,
        preDelayMs: ir.preDelayMs,
    })
    writeFileSync(path, floatToWav(samples, sampleRate))
    assetCache.set(key, path)
    return path
}

function noiseBedPath(bed: NonNullable<Condition['noiseBed']>, sampleRate: number): string {
    const key = `bed-${bed.kind}-${sampleRate}`
    const cached = assetCache.get(key)
    if (cached && existsSync(cached)) return cached
    const path = join(assetDir(), `${key}.wav`)
    const synth = bed.kind === 'wind' ? synthesizeWind : synthesizeSpeechNoise
    const samples = synth({ sampleRate, durationSec: BED_DURATION_SEC })
    writeFileSync(path, floatToWav(samples, sampleRate))
    assetCache.set(key, path)
    return path
}

export function degrade(inPath: string, outPath: string, condition: Condition, sampleRate = 44100, maxDurationSec?: number): void {
    if (!ffmpegPath) throw new Error('ffmpeg-static did not resolve a binary path')

    // A codec condition renders the acoustic chain to a temporary WAV first, then
    // round-trips it through the encoder — one ffmpeg graph cannot both convolve
    // an IR and emit a container we then have to decode again.
    if (condition.codec) {
        const stem = join(assetDir(), `codec-${process.pid}-${basename(outPath)}`)
        const tmpWav = `${stem}.wav`
        const tmpEnc = `${stem}.${condition.codec.container}`
        degrade(inPath, tmpWav, { ...condition, codec: undefined }, sampleRate, maxDurationSec)
        // `apad` before the encoder, `-t` after it. Measured: an Opus round trip is
        // sample-aligned at the HEAD (best-correlation lag 0.00 ms at 96/32/16 kbps,
        // AAC likewise) but returns ~72 ms SHORT (AAC ~58 ms) — the encoder's frame
        // padding is trimmed off the tail. On a clip that ends mid-note (every
        // spliced TinySOL clip does) that would silently eat the last note's tail,
        // so the encode input is padded and the decode is trimmed back.
        execFileSync(
            ffmpegPath,
            [
                '-hide_banner',
                '-loglevel',
                'error',
                '-y',
                '-i',
                tmpWav,
                '-af',
                `apad=pad_dur=${CODEC_TAIL_PAD_SEC}`,
                '-c:a',
                condition.codec.encoder,
                '-b:a',
                `${condition.codec.bitrateKbps}k`,
                '-ac',
                '1',
                tmpEnc,
            ],
            { stdio: ['ignore', 'ignore', 'inherit'] },
        )
        const decodeArgs = ['-hide_banner', '-loglevel', 'error', '-y', '-i', tmpEnc]
        if (maxDurationSec) decodeArgs.push('-t', maxDurationSec.toFixed(3))
        decodeArgs.push('-ar', String(sampleRate), '-ac', '1', '-c:a', 'pcm_s16le', outPath)
        execFileSync(ffmpegPath, decodeArgs, { stdio: ['ignore', 'ignore', 'inherit'] })
        for (const f of [tmpWav, tmpEnc]) rmSync(f, { force: true })
        return
    }

    const args = ['-hide_banner', '-loglevel', 'error', '-y', '-i', inPath]
    const noiseDur = (maxDurationSec ?? 10).toFixed(3)

    // Assemble the input list; each optional stage records its input index.
    let irIndex = -1
    if (condition.ir) {
        irIndex = args.filter((a) => a === '-i').length
        args.push('-i', impulseResponsePath(condition.ir, sampleRate))
    }
    let bedIndex = -1
    if (condition.noiseBed) {
        bedIndex = args.filter((a) => a === '-i').length
        args.push('-i', noiseBedPath(condition.noiseBed, sampleRate))
    }
    let noiseIndex = -1
    if (condition.noise) {
        noiseIndex = args.filter((a) => a === '-i').length
        const { color, amplitude } = condition.noise
        // Finite noise the same length as the clip, mixed with duration=longest so
        // neither input truncates the other. (An infinite anoisesrc with
        // duration=first produced wildly inconsistent output lengths.)
        args.push('-f', 'lavfi', '-i', `anoisesrc=color=${color}:amplitude=${amplitude}:seed=12345:duration=${noiseDur}`)
    }

    const post = condition.postFilter ? `,${condition.postFilter}` : ''
    const stages: string[] = [`[0:a]${loudnorm(sampleRate)}[sig]`]
    let current = 'sig'

    if (irIndex >= 0) {
        // The direct spike lives at t=0 inside the IR, so convolution preserves
        // onset positions while adding the room's smear. gtype=none: the IR's own
        // direct/wet balance IS the level design — afir's default peak auto-gain
        // (~1/sum|coeffs|) would crush the output ~35 dB. afir takes the IR's
        // samples as they are, at the graph's rate, so a measured IR file (any
        // rate) is resampled to the clip's rate first — the 192 kHz defect above
        // was exactly an IR played at the wrong rate.
        let irLabel = `${irIndex}:a`
        if (condition.ir && 'file' in condition.ir) {
            stages.push(`[${irIndex}:a]aresample=${sampleRate}[irr]`)
            irLabel = 'irr'
        }
        stages.push(`[${current}][${irLabel}]afir=gtype=none[rev]`)
        current = 'rev'
    }

    const mixInputs: string[] = [`[${current}]`]
    if (condition.noiseBed && bedIndex >= 0) {
        stages.push(`[${bedIndex}:a]volume=${condition.noiseBed.gainDb}dB,atrim=duration=${noiseDur}[bed]`)
        mixInputs.push('[bed]')
    }
    if (noiseIndex >= 0) mixInputs.push(`[${noiseIndex}:a]`)

    if (mixInputs.length > 1) {
        stages.push(`${mixInputs.join('')}amix=inputs=${mixInputs.length}:duration=longest:normalize=0[mix]`)
        current = 'mix'
    }

    if (condition.postFilter || mixInputs.length > 1 || irIndex >= 0) {
        stages.push(`[${current}]anull${post}[out]`)
        args.push('-filter_complex', stages.join(';'), '-map', '[out]')
    } else {
        args.push('-af', `${loudnorm(sampleRate)}${post}`)
    }

    if (maxDurationSec) args.push('-t', maxDurationSec.toFixed(3))
    if (!(condition.ir && 'file' in condition.ir)) {
        args.push('-ar', String(sampleRate), '-ac', '1', outPath)
        execFileSync(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'inherit'] })
        return
    }
    // A measured room builds up at its modes: at a static IR gain, 69 of 1,076
    // rir-* variants clipped (a horn note on a room mode: 7,069 samples). So the
    // convolved take is rendered in float and given ONE static gain that keeps its
    // peak at or below PEAK_CEILING — no limiter, no dynamics change; the pipeline
    // loudness-normalises its input anyway, so the level itself is immaterial.
    const tmp = join(assetDir(), `rir-${process.pid}-${basename(outPath)}`)
    args.push('-ar', String(sampleRate), '-ac', '1', '-c:a', 'pcm_f32le', tmp)
    execFileSync(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'inherit'] })
    const { samples } = wavToFloat(readFileSync(tmp))
    rmSync(tmp, { force: true })
    let peak = 0
    for (const v of samples) peak = Math.max(peak, Math.abs(v))
    const gain = peak > PEAK_CEILING ? PEAK_CEILING / peak : 1
    writeFileSync(outPath, floatToWav(gain === 1 ? samples : samples.map((v) => v * gain), sampleRate))
}

/** Highest sample a measured-room variant may reach: −1 dBFS. */
const PEAK_CEILING = 10 ** (-1 / 20)
