/**
 * Fetch the MEASURED room impulse responses behind the opt-in `rir-near` /
 * `rir-far` conditions (scenarios.ts), condition them, and write them where
 * `lib/degrade.ts` reads `Condition.ir.file`:
 *
 *   scripts/fixtures/eval-rir/arni-nc40-mic4.wav   rir-near
 *   scripts/fixtures/eval-rir/arni-nc55-mic3.wav   rir-far
 *   scripts/fixtures/eval-rir/manifest.json        provenance + measured RT60 / DRR
 *
 * Source : Arni, the variable-acoustics room of the Aalto Acoustics Lab —
 *          Prawda, Schlecht, Välimäki, "Dataset of impulse responses from variable
 *          acoustics room Arni at Aalto Acoustic Labs", Zenodo 2022,
 *          doi:10.5281/zenodo.6985104. 5,342 configurations of 55 switchable
 *          (absorptive / reflective) panels × 5 receivers × 5 sweeps, one
 *          omnidirectional source; 44.1 kHz 32-bit float WAV.
 * License: CC-BY-4.0 (the Zenodo record's licence field, read 2026-11-01).
 *
 * Why Arni: the adverse tier's rooms are modelled (an exponential noise tail,
 * lib/acoustics.ts), and on 2026-11-01 the modelled chain was shown to have
 * manufactured a feature (dipDepth, FINDINGS "degrade defect"). One measured room
 * whose RT60 is a dial is the cheapest check that a reverb conclusion survives a
 * real room. The two picks are the measured twins of the modelled conditions,
 * one milder and one harsher: `rir-near` = 40 reflective panels, receiver 4
 * (the receiver with the strongest direct path, ≈1.7 m from the source):
 * RT60 0.80 s, DRR −2.5 dB, against echoey-room's modelled 0.9 s / +2 dB;
 * `rir-far` = all 55 panels reflective, receiver 3 (≈2.9 m): RT60 1.27 s,
 * DRR −10.8 dB, against distant-mic's 1.3 s / −4 dB. Arni has no receiver
 * nearer than ≈1.5 m (the plan's "~0.5 m" does not exist in it). OK5
 * (doi:10.5281/zenodo.18622201, 25 real rooms) was cleared alongside for room
 * diversity but ships SOFA/HDF5, which this TypeScript harness cannot read
 * without a new dependency — left as the follow-up.
 *
 * Conditioning (the same rules as synthetic-corpus's `RoomIR`, so the numbers
 * agree with its manifest): DC removed; the direct path is the largest sample
 * within 0.5 ms after the first one reaching −14 dB of the global peak, and is
 * placed at sample PEAK_AT (0.5 ms, keeping the band-limited pulse's leading
 * lobe — every onset moves by 0.5 ms, nothing at a ±100 ms window); the tail is
 * cut where the decay line meets the measurement's noise floor and faded over
 * 20 ms; finally the IR's gain is set so its mean power response over
 * 200 Hz–4 kHz is −3 dB (BAND_LO_HZ, BAND_GAIN_DB), so the convolved take stays
 * near the −16 LUFS `degrade()` normalised it to, without clipping. A direct-path-unity IR at DRR −10.8 dB
 * would add ~11 dB and clip; so does a unit-ENERGY one, measured (see BAND_LO_HZ).
 *
 * Only the two members are transferred (ranged GETs through lib/remoteZip.ts —
 * the archives are 4–10 GB each). Idempotent.
 *
 * Run: pnpm --filter @mushee/api exec tsx scripts/eval/fetch/fetch-rirs.ts
 */

import { mkdirSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'

import { RIR_ROOT } from '../lib/degrade'
import { readCentralDirectory, readZipEntry } from '../lib/remoteZip'

const RECORD = 'https://zenodo.org/api/records/6985104/files'
const CACHE = resolve(__dirname, '../.cache', 'rir')

interface Pick {
    file: string
    condition: string
    zip: string
    member: string
    receiverDistanceM: string
    note: string
}

const PICKS: Pick[] = [
    {
        file: 'arni-nc40-mic4.wav',
        condition: 'rir-near',
        zip: 'IR_Arni_upload_numClosed_36-45.zip',
        member: 'IR_numClosed_40_numComb_3942_mic_4_sweep_1.wav',
        receiverDistanceM: '≈1.7 (from the published layout)',
        note: '40 of 55 panels reflective; receiver 4, the strongest direct path of the five',
    },
    {
        file: 'arni-nc55-mic3.wav',
        condition: 'rir-far',
        zip: 'IR_Arni_upload_numClosed_46-55.zip',
        member: 'IR_numClosed_55_numComb_0_mic_3_sweep_1.wav',
        receiverDistanceM: '≈2.9 (from the published layout)',
        note: 'all 55 panels reflective (the RT60 axis end point); receiver 3, the farthest of 3/4/5',
    },
]

/** Direct-path position in the conditioned IR, as synthetic-corpus's RoomIR (0.5 ms). */
const PEAK_AT_SEC = 0.0005
const FADE_OUT_SEC = 0.02
const MAX_LEN_SEC = 2.0
const BLOCK_SEC = 0.01
/**
 * The band the IR's gain is normalised over: mean |H(f)|² = 1 across 200 Hz–4 kHz,
 * where sung, whistled and played fundamentals and their strong partials live.
 * Unit total energy is NOT loudness-neutral for a measured room — its energy sits
 * in the low-mids, so vocadito_10 came out +5.5 dB (near) / +9.3 dB (far) louder
 * and clipped; band-normalised, the take keeps degrade()'s −16 LUFS.
 */
const BAND_LO_HZ = 200
const BAND_HI_HZ = 4000
/**
 * …and then 3 dB of headroom: still measured on vocadito_10 at unity, the far room
 * came out +3.1 dB louder with 63 clipped samples (its low-mid build-up), the near
 * one +1.4 dB. The pipeline loudness-normalises its input, so the pad costs nothing.
 */
const BAND_GAIN_DB = -3

/** 32-bit float / 16-bit / 24-bit / 32-bit int mono-or-multichannel WAV → channel 0. */
function readWav(buf: Buffer): { x: Float64Array; fs: number } {
    let pos = 12
    let fs = 0
    let format = 1
    let bits = 16
    let channels = 1
    while (pos + 8 <= buf.length) {
        const id = buf.toString('ascii', pos, pos + 4)
        const size = buf.readUInt32LE(pos + 4)
        if (id === 'fmt ') {
            format = buf.readUInt16LE(pos + 8)
            channels = buf.readUInt16LE(pos + 10)
            fs = buf.readUInt32LE(pos + 12)
            bits = buf.readUInt16LE(pos + 22)
            if (format === 0xfffe && size >= 40) format = buf.readUInt16LE(pos + 8 + 24)
        } else if (id === 'data') {
            const bytes = bits / 8
            const n = Math.floor(Math.min(size, buf.length - pos - 8) / bytes / channels)
            const x = new Float64Array(n)
            for (let i = 0; i < n; i += 1) {
                const at = pos + 8 + i * bytes * channels
                if (format === 3 && bits === 32) x[i] = buf.readFloatLE(at)
                else if (format === 1 && bits === 16) x[i] = buf.readInt16LE(at) / 32768
                else if (format === 1 && bits === 24) x[i] = buf.readIntLE(at, 3) / 0x800000
                else if (format === 1 && bits === 32) x[i] = buf.readInt32LE(at) / 0x80000000
                else throw new Error(`unsupported WAV encoding: format ${format}, ${bits}-bit`)
            }
            return { x, fs }
        }
        pos += 8 + size + (size % 2)
    }
    throw new Error('no data chunk')
}

function floatWav(x: Float64Array, fs: number): Buffer {
    const out = Buffer.alloc(44 + x.length * 4)
    out.write('RIFF', 0, 'ascii')
    out.writeUInt32LE(36 + x.length * 4, 4)
    out.write('WAVE', 8, 'ascii')
    out.write('fmt ', 12, 'ascii')
    out.writeUInt32LE(16, 16)
    out.writeUInt16LE(3, 20) // IEEE float
    out.writeUInt16LE(1, 22)
    out.writeUInt32LE(fs, 24)
    out.writeUInt32LE(fs * 4, 28)
    out.writeUInt16LE(4, 32)
    out.writeUInt16LE(32, 34)
    out.write('data', 36, 'ascii')
    out.writeUInt32LE(x.length * 4, 40)
    for (let i = 0; i < x.length; i += 1) out.writeFloatLE(x[i], 44 + i * 4)
    return out
}

function median(x: Float64Array): number {
    const s = Float64Array.from(x).sort()
    return s[s.length >> 1]
}

/** Least-squares slope and intercept. */
function linfit(t: number[], y: number[]): [number, number] {
    const n = t.length
    const mt = t.reduce((a, b) => a + b, 0) / n
    const my = y.reduce((a, b) => a + b, 0) / n
    let num = 0
    let den = 0
    for (let i = 0; i < n; i += 1) {
        num += (t[i] - mt) * (y[i] - my)
        den += (t[i] - mt) ** 2
    }
    const slope = den ? num / den : 0
    return [slope, my - slope * mt]
}

/** Sample where the decay line meets the noise floor (RoomIR._tail_end, one Lundeby-style pass). */
function tailEnd(y: Float64Array, fs: number): number {
    const blk = Math.round(BLOCK_SEC * fs)
    const n = Math.floor(y.length / blk)
    const maxLen = Math.min(y.length, Math.round(MAX_LEN_SEC * fs))
    if (n < 12) return maxLen
    const e: number[] = []
    for (let b = 0; b < n; b += 1) {
        let s = 0
        for (let i = b * blk; i < (b + 1) * blk; i += 1) s += y[i] * y[i]
        e.push(s / blk)
    }
    const L = e.map((v) => 10 * Math.log10(v + 1e-30))
    const usable = n - Math.max(2, Math.floor(n / 20))
    const last = Math.max(4, Math.floor(usable / 10))
    const noise = 10 * Math.log10(e.slice(usable - last, usable).reduce((a, b) => a + b, 0) / last + 1e-30)
    const lmax = Math.max(...L)
    const i1 = L.findIndex((v) => v <= lmax - 5)
    const rel = L.slice(i1).findIndex((v) => v <= noise + 10)
    if (i1 < 0 || rel < 0) return maxLen
    const i2 = i1 + rel
    const t = L.map((_, i) => ((i + 0.5) * blk) / fs)
    let tCross = t[i2]
    if (i2 - i1 >= 3) {
        const [slope, icpt] = linfit(t.slice(i1, i2), L.slice(i1, i2))
        if (slope < 0) tCross = (noise - icpt) / slope
    }
    return Math.round(Math.min(Math.max(tCross * fs, 0.05 * fs), maxLen))
}

/** Broadband Schroeder decay time over [lo, hi] dB, extrapolated to 60 dB. */
function decayTime(h: Float64Array, fs: number, lo: number, hi: number): number | null {
    const edc = new Float64Array(h.length)
    let acc = 0
    for (let i = h.length - 1; i >= 0; i -= 1) {
        acc += h[i] * h[i]
        edc[i] = acc
    }
    const db = Array.from(edc, (v) => 10 * Math.log10(v / edc[0] + 1e-30))
    const a = db.findIndex((v) => v <= lo)
    const b = db.findIndex((v) => v <= hi)
    if (a < 0 || b < 0 || b - a < 10) return null
    const [slope] = linfit(
        Array.from({ length: b - a }, (_, i) => (a + i) / fs),
        db.slice(a, b),
    )
    return slope < 0 ? -60 / slope : null
}

/** In-place iterative radix-2 FFT of (re, im), length a power of two. */
function fft(re: Float64Array, im: Float64Array): void {
    const n = re.length
    for (let i = 1, j = 0; i < n; i += 1) {
        let bit = n >> 1
        for (; j & bit; bit >>= 1) j ^= bit
        j ^= bit
        if (i < j) {
            ;[re[i], re[j]] = [re[j], re[i]]
            ;[im[i], im[j]] = [im[j], im[i]]
        }
    }
    for (let len = 2; len <= n; len <<= 1) {
        const ang = (-2 * Math.PI) / len
        for (let i = 0; i < n; i += len) {
            for (let k = 0; k < len / 2; k += 1) {
                const wr = Math.cos(ang * k)
                const wi = Math.sin(ang * k)
                const ar = re[i + k + len / 2] * wr - im[i + k + len / 2] * wi
                const ai = re[i + k + len / 2] * wi + im[i + k + len / 2] * wr
                re[i + k + len / 2] = re[i + k] - ar
                im[i + k + len / 2] = im[i + k] - ai
                re[i + k] += ar
                im[i + k] += ai
            }
        }
    }
}

/** Mean power gain |H(f)|² of `h` over [lo, hi] Hz. */
function meanBandPower(h: Float64Array, fs: number, lo: number, hi: number): number {
    let n = 1
    while (n < h.length) n <<= 1
    const re = new Float64Array(n)
    const im = new Float64Array(n)
    re.set(h)
    fft(re, im)
    let sum = 0
    let bins = 0
    for (let k = Math.ceil((lo * n) / fs); k <= Math.floor((hi * n) / fs); k += 1) {
        sum += re[k] * re[k] + im[k] * im[k]
        bins += 1
    }
    return sum / bins
}

function condition(raw: Float64Array, fs: number): { h: Float64Array; metrics: Record<string, number | null> } {
    const dc = median(raw)
    const x = raw.map((v) => v - dc)
    let peakAbs = 0
    for (const v of x) peakAbs = Math.max(peakAbs, Math.abs(v))
    const i0 = x.findIndex((v) => Math.abs(v) >= 0.2 * peakAbs)
    let p = i0
    for (let i = i0; i < Math.min(x.length, i0 + Math.max(1, Math.round(0.0005 * fs))); i += 1) if (Math.abs(x[i]) > Math.abs(x[p])) p = i
    const peakAt = Math.round(PEAK_AT_SEC * fs)
    const start = p - peakAt
    const y = new Float64Array(x.length - Math.max(0, start) + Math.max(0, -start))
    for (let i = 0; i < y.length; i += 1) {
        const src = i + start
        y[i] = src >= 0 && src < x.length ? x[src] : 0
    }
    const direct = y[peakAt]
    for (let i = 0; i < y.length; i += 1) y[i] /= direct
    const h = y.slice(0, tailEnd(y, fs))
    const nFade = Math.min(Math.round(FADE_OUT_SEC * fs), h.length >> 2)
    for (let k = 0; k < nFade; k += 1) h[h.length - nFade + k] *= Math.cos((0.5 * Math.PI * k) / nFade) ** 2

    // DRR over ±2.5 ms around the direct path, before the energy scaling.
    const half = Math.round(0.0025 * fs)
    let dE = 0
    let rE = 0
    for (let i = 0; i < h.length; i += 1) {
        if (i >= peakAt - half && i <= peakAt + half) dE += h[i] * h[i]
        else if (i > peakAt + half) rE += h[i] * h[i]
    }
    const bandPower = meanBandPower(h, fs, BAND_LO_HZ, BAND_HI_HZ)
    const scale = 10 ** (BAND_GAIN_DB / 20) / Math.sqrt(bandPower)
    for (let i = 0; i < h.length; i += 1) h[i] *= scale
    const round = (v: number | null, d = 3): number | null => (v === null ? null : Number(v.toFixed(d)))
    return {
        h,
        metrics: {
            drrDb: round(10 * Math.log10(dE / rE), 2),
            t30BroadbandSec: round(decayTime(h.subarray(peakAt), fs, -5, -35)),
            t20BroadbandSec: round(decayTime(h.subarray(peakAt), fs, -5, -25)),
            lengthSec: round(h.length / fs),
            peakScaleDb: round(20 * Math.log10(scale), 2),
            unitEnergyGainDb: round(10 * Math.log10(h.reduce((a, v) => a + v * v, 0)), 2),
        },
    }
}

function main(): void {
    mkdirSync(RIR_ROOT, { recursive: true })
    const manifest: Record<string, unknown>[] = []
    for (const pick of PICKS) {
        const url = `${RECORD}/${pick.zip}/content`
        const cache = join(CACHE, pick.zip.replace('.zip', ''))
        const entry = readCentralDirectory(url, cache).find((e) => e.name.endsWith(pick.member))
        if (!entry) throw new Error(`${pick.member} not in ${pick.zip}`)
        const { x, fs } = readWav(readZipEntry(url, entry, cache))
        const { h, metrics } = condition(x, fs)
        writeFileSync(join(RIR_ROOT, pick.file), floatWav(h, fs))
        manifest.push({
            file: pick.file,
            condition: pick.condition,
            dataset: 'Arni (Aalto Acoustics Lab variable-acoustics room)',
            doi: '10.5281/zenodo.6985104',
            license: 'CC-BY-4.0',
            attribution: 'K. Prawda, S. J. Schlecht, V. Välimäki — Aalto University (Zenodo 2022)',
            archive: pick.zip,
            member: pick.member,
            receiverDistanceM: pick.receiverDistanceM,
            note: pick.note,
            sampleRate: fs,
            conditioning:
                'DC removed; direct path at 0.5 ms; tail cut at the noise floor + 20 ms fade (synthetic-corpus RoomIR rules); ' +
                'gain set to a mean |H(f)|² of −3 dB over 200 Hz–4 kHz',
            ...metrics,
        })
        console.log(`  ${pick.condition}: ${pick.file} ← ${pick.member}`, metrics)
    }
    writeFileSync(join(RIR_ROOT, 'manifest.json'), JSON.stringify({ files: manifest }, null, 2))
    console.log(`\nWrote ${PICKS.length} measured RIRs to ${RIR_ROOT}`)
}

main()
