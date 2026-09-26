/**
 * Fetch Dagstuhl ChoirSet (DCS) quartet singer-stems into the eval harness's
 * real corpus layout — the harness's FIRST voice corpus with a real tempo.
 *
 * Output: scripts/fixtures/eval-real/benchmark/dagstuhl-choir/<clip>.truth.json
 *         scripts/fixtures/eval-real/benchmark/dagstuhl-choir/<clip>__real.wav
 *         scripts/fixtures/eval-real/benchmark/dagstuhl-choir/dataset.json
 *
 * Source : https://zenodo.org/records/4618287 (DagstuhlChoirSet_V1.2.3.zip, 5.1 GB)
 * License: CC-BY-4.0 (Zenodo record licence field, re-verified 2026-08-13).
 *
 * ## Why this corpus is here, and what it is NOT for
 *
 * Two separate annotations ship with DCS and they are of very different quality
 * (research/research-voice-datasets.md §2 "Dagstuhl ChoirSet"):
 *
 *   - `annotations_csv_beat` — 20 beat/measure grids, **manually tapped in Sonic
 *     Visualiser and then reviewed by a second, experienced annotator** (paper
 *     §3.4). This is the good part, and it is unique to us: every other voice
 *     corpus we hold carries a nominal, invented bpm, which is why
 *     `notation-eval.ts` could score notated rhythm in beats only on GuitarSet —
 *     an *instrument*. The grid is emitted as `GroundTruth.beatGrid` and
 *     `lib/notation.ts` maps notes through it, so real rubato is scoreable.
 *
 *   - `annotations_csv_scorerepresentation` — per-take score alignments produced
 *     by DTW-ing a CPDL MIDI to the room mic. Measured against DCS's own manual
 *     F0 reference these are **70 ms onset MAE (only ~50 % inside ±50 ms) and a
 *     third of notated pitches >50 cents from what was sung**. That is NOT note
 *     truth, so this dataset ships `noteTruthDerived: true` and its COnP stays
 *     out of the pooled headline — exactly like mir-qbsh. Use it for the beat
 *     axis; do not read its note-F1 as an accuracy result.
 *
 * ⚠️ **The rhythm number this unlocks measures rubato-robustness, not the same
 * axis as GuitarSet.** GuitarSet was played to a click, so its beat 1 is at a
 * known instant and a displaced take really is wrong. DCS singers followed a
 * conductor with genuine rubato (±20 % within a take, ritardando to ~35 BPM at
 * final cadences), while the pipeline quantises at ONE bpm. The gap between the
 * grid-derived reference and a fixed-tempo quantisation is therefore a real,
 * reportable cost of rubato — which is a different question from "does the
 * notation stage work", and must be labelled as such in any write-up.
 *
 * ## Which stems, and why quartets only
 *
 * Score lines are per SECTION (S/A/T/B). In the **FullChoir** takes several
 * singers share a section, so a section line cannot be attributed to one singer
 * — the same ceiling CSD has. In the **Quartet** takes there is exactly one
 * singer per section, so the section line IS that singer's line. Only quartet
 * takes are converted: 13 takes x 4 singers = 52 candidate stems.
 *
 * Mic choice is HSM (headset) where it exists and DYN (dynamic close mic)
 * otherwise — the two closest to normal input. LRX is a throat contact mic
 * (bleed-free but off-distribution timbre) and the ST* mics are the room pair.
 * Sopranos wore no headset, so S is always DYN. Bleed from neighbouring singers
 * is present in all of them; vocadito's authors call DCS stems "not well suited
 * for monophonic voice evaluation" for exactly that reason. Treat it as its own
 * condition, never pooled into a clean tier.
 *
 * Clips are cut into `DCS_EXCERPT_SEC` windows (default 30 s) because a whole
 * take is ~5 minutes; notes and the beat grid are sliced and rebased to each
 * excerpt's start.
 *
 * Downloads only the bytes it needs, via `lib/remoteZip.ts`: the archive's
 * ZIP64 central directory is read by a ranged GET of its tail, then each
 * required member is fetched by its own ranged GET. Nothing close to the
 * 5.1 GB is transferred.
 *
 * Idempotent. Run: pnpm --filter @mushee/api exec tsx scripts/eval/fetch/fetch-dagstuhl.ts
 */

import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'

import { readCentralDirectory, readZipEntry } from '../lib/remoteZip'
import type { GroundTruth, TruthNote } from '../types'

const ZIP_URL = 'https://zenodo.org/api/records/4618287/files/DagstuhlChoirSet_V1.2.3.zip/content'

const CACHE = resolve(__dirname, '../.cache', 'dagstuhl')
const OUT = resolve(__dirname, '../../fixtures/eval-real/benchmark/dagstuhl-choir')

/** Excerpt length; a whole take is ~5 min, far longer than any real recording. */
const EXCERPT_SEC = Number(process.env.DCS_EXCERPT_SEC) || 30
/** Cap per stem so one long piece cannot dominate the dataset. */
const MAX_EXCERPTS_PER_STEM = Number(process.env.DCS_MAX_EXCERPTS) || 6
/** Take numbers to use per (piece, quartet). Repeated takes are near-duplicates. */
const TAKES_PER_GROUP = Number(process.env.DCS_TAKES) || 2
/** An excerpt with fewer notes than this is not worth a pipeline run. */
const MIN_NOTES = 4

interface BeatMark {
    timeSec: number
    beat: number
}

/**
 * `time_sec, measure.beatfraction` → absolute quarter-note beats.
 *
 * Both DCS pieces are 4/4 (verified: the fractional part is only ever
 * 0/.25/.5/.75), so a value v encodes measure floor(v) and beat
 * (v-floor(v))*4+1, i.e. absolute quarter-beat (v-1)*4 counted from the
 * downbeat of measure 1. Anacruses come out negative, which is correct. Values
 * are rounded to the nearest quarter first because the source writes some as
 * e.g. 48.999.
 */
function parseBeats(csv: string): BeatMark[] {
    const marks: BeatMark[] = []
    for (const line of csv.split('\n')) {
        const [t, b] = line.trim().split(',')
        const timeSec = Number(t)
        const raw = Number(b)
        if (!Number.isFinite(timeSec) || !Number.isFinite(raw)) continue
        marks.push({ timeSec, beat: (Math.round(raw * 4) / 4 - 1) * 4 })
    }
    marks.sort((a, b) => a.timeSec - b.timeSec)
    return marks
}

/** `onset_sec, offset_sec, midi` → TruthNote[]. */
function parseScore(csv: string): TruthNote[] {
    const notes: TruthNote[] = []
    for (const line of csv.split('\n')) {
        const parts = line.trim().split(',')
        if (parts.length < 3) continue
        const [on, off, midi] = parts.map(Number)
        if (![on, off, midi].every(Number.isFinite) || off <= on) continue
        notes.push({ onsetSec: on, durSec: off - on, midi: Math.round(midi) })
    }
    notes.sort((a, b) => a.onsetSec - b.onsetSec)
    return notes
}

/** Median seconds-per-beat over the grid → the clip's representative bpm. */
function medianBpm(marks: BeatMark[]): number {
    const spb: number[] = []
    for (let i = 1; i < marks.length; i += 1) {
        const dt = marks[i].timeSec - marks[i - 1].timeSec
        const db = marks[i].beat - marks[i - 1].beat
        if (dt > 0 && db > 0) spb.push(dt / db)
    }
    if (!spb.length) return 120
    spb.sort((a, b) => a - b)
    return 60 / spb[Math.floor(spb.length / 2)]
}

/** Mono 16-bit PCM WAV → {samples, sampleRate}; DCS ships exactly this. */
function readWav(buf: Buffer): { samples: Buffer; sampleRate: number } {
    let pos = 12
    let sampleRate = 22050
    while (pos + 8 <= buf.length) {
        const id = buf.toString('ascii', pos, pos + 4)
        const size = buf.readUInt32LE(pos + 4)
        if (id === 'fmt ') sampleRate = buf.readUInt32LE(pos + 12)
        else if (id === 'data') return { samples: buf.subarray(pos + 8, pos + 8 + size), sampleRate }
        pos += 8 + size + (size % 2)
    }
    throw new Error('no data chunk in WAV')
}

function writeWavSlice(samples: Buffer, sampleRate: number, startSec: number, endSec: number, dest: string): void {
    const bytesPerSample = 2
    const from = Math.max(0, Math.floor(startSec * sampleRate) * bytesPerSample)
    const to = Math.min(samples.length, Math.floor(endSec * sampleRate) * bytesPerSample)
    const pcm = samples.subarray(from, to)
    const header = Buffer.alloc(44)
    header.write('RIFF', 0, 'ascii')
    header.writeUInt32LE(36 + pcm.length, 4)
    header.write('WAVE', 8, 'ascii')
    header.write('fmt ', 12, 'ascii')
    header.writeUInt32LE(16, 16)
    header.writeUInt16LE(1, 20) // PCM
    header.writeUInt16LE(1, 22) // mono
    header.writeUInt32LE(sampleRate, 24)
    header.writeUInt32LE(sampleRate * bytesPerSample, 28)
    header.writeUInt16LE(bytesPerSample, 32)
    header.writeUInt16LE(16, 34)
    header.write('data', 36, 'ascii')
    header.writeUInt32LE(pcm.length, 40)
    writeFileSync(dest, Buffer.concat([header, pcm]))
}

function main(): void {
    const entries = readCentralDirectory(ZIP_URL, CACHE)
    const byName = new Map(entries.map((e) => [e.name.split('/').pop() as string, e]))

    // Quartet takes only: exactly one singer per section, so a section score line
    // is that singer's line (FullChoir shares a line across singers).
    const stemRe = /^DCS_(LI|TP)_(Quartet[AB])_(Take\d+)_([SATB])(\d)_(HSM|DYN)\.wav$/
    interface Stem {
        file: string
        piece: string
        quartet: string
        take: string
        section: string
        singer: string
        mic: string
    }
    const stems: Stem[] = []
    for (const e of entries) {
        if (!e.name.includes('audio_wav_22050_mono/')) continue
        const base = e.name.split('/').pop() as string
        const m = stemRe.exec(base)
        if (!m) continue
        stems.push({
            file: base,
            piece: m[1],
            quartet: m[2],
            take: m[3],
            section: m[4],
            singer: m[4] + m[5],
            mic: m[6],
        })
    }

    // HSM (headset) where it exists, DYN otherwise — one stem per singer/take.
    const best = new Map<string, Stem>()
    for (const s of stems) {
        const key = `${s.piece}_${s.quartet}_${s.take}_${s.singer}`
        const prev = best.get(key)
        if (!prev || (prev.mic === 'DYN' && s.mic === 'HSM')) best.set(key, s)
    }

    // Keep the first N takes of each (piece, quartet): further takes are the same
    // singers repeating the same music and add little.
    const takesByGroup = new Map<string, string[]>()
    for (const s of Array.from(best.values())) {
        const g = `${s.piece}_${s.quartet}`
        const list = takesByGroup.get(g) ?? []
        if (!list.includes(s.take)) list.push(s.take)
        takesByGroup.set(g, list)
    }
    for (const [g, list] of Array.from(takesByGroup.entries())) {
        list.sort()
        takesByGroup.set(g, list.slice(0, TAKES_PER_GROUP))
    }
    const chosen = Array.from(best.values())
        .filter((s) => takesByGroup.get(`${s.piece}_${s.quartet}`)?.includes(s.take))
        .sort((a, b) => a.file.localeCompare(b.file))

    console.log(`  ${chosen.length} quartet stems selected (${new Set(chosen.map((s) => `${s.piece}_${s.quartet}_${s.take}`)).size} takes)`)

    rmSync(OUT, { recursive: true, force: true })
    mkdirSync(OUT, { recursive: true })

    let clips = 0
    let totalNotes = 0
    const bpms: number[] = []
    const micCounts = new Map<string, number>()
    const singers = new Set<string>()

    for (const s of chosen) {
        const takeId = `DCS_${s.piece}_${s.quartet}_${s.take}`
        const beatEntry = byName.get(`${takeId}_Stereo_STM.csv`)
        const scoreEntry = byName.get(`${takeId}_Stereo_STM_${s.section}.csv`)
        const audioEntry = byName.get(s.file)
        if (!beatEntry || !scoreEntry || !audioEntry) {
            console.warn(`  ! ${s.file}: missing beat/score/audio annotation, skipping`)
            continue
        }

        const marks = parseBeats(readZipEntry(ZIP_URL, beatEntry, CACHE).toString('utf8'))
        const notes = parseScore(readZipEntry(ZIP_URL, scoreEntry, CACHE).toString('utf8'))
        if (marks.length < 2 || !notes.length) {
            console.warn(`  ! ${s.file}: empty annotations, skipping`)
            continue
        }
        const { samples, sampleRate } = readWav(readZipEntry(ZIP_URL, audioEntry, CACHE))
        const durSec = samples.length / 2 / sampleRate

        for (let i = 0; i < MAX_EXCERPTS_PER_STEM; i += 1) {
            const start = i * EXCERPT_SEC
            const end = Math.min(durSec, start + EXCERPT_SEC)
            if (end - start < EXCERPT_SEC * 0.6) break

            // Notes fully inside the window, rebased to the excerpt's own t=0.
            const inWin = notes
                .filter((n) => n.onsetSec >= start && n.onsetSec + n.durSec <= end)
                .map((n) => ({ ...n, onsetSec: n.onsetSec - start }))
            if (inWin.length < MIN_NOTES) continue

            // Beat grid clipped to the window with one mark of margin either side, so
            // interpolation at the excerpt's edges is still bracketed by real marks.
            const grid: BeatMark[] = []
            for (let k = 0; k < marks.length; k += 1) {
                const inside = marks[k].timeSec >= start && marks[k].timeSec <= end
                const neighbour =
                    (k + 1 < marks.length && marks[k + 1].timeSec >= start && marks[k].timeSec < start) ||
                    (k > 0 && marks[k - 1].timeSec <= end && marks[k].timeSec > end)
                if (inside || neighbour) grid.push({ timeSec: marks[k].timeSec - start, beat: marks[k].beat })
            }
            if (grid.length < 2) continue

            // Rebase the beat NUMBERS the way the times are already rebased: an
            // excerpt starting five minutes in would otherwise carry beats 380-420
            // while the estimate — which necessarily counts from its own t=0 — carries
            // 0-40, and every beat-domain comparison would be measuring that offset.
            // Shift by whole BARS (4 beats, both pieces are 4/4) rather than to
            // exactly zero, so the excerpt keeps its metrical phase: an excerpt that
            // begins on beat 3 of a bar still begins on beat 3 of a bar.
            const beatAtStart = grid[0].beat + ((0 - grid[0].timeSec) / (grid[1].timeSec - grid[0].timeSec)) * (grid[1].beat - grid[0].beat)
            const barOffset = 4 * Math.floor(beatAtStart / 4)
            for (const g of grid) g.beat -= barOffset

            const bpm = medianBpm(grid)
            const clip = `${takeId}_${s.singer}_${s.mic}_ex${String(i).padStart(2, '0')}`
            const truth: GroundTruth = { bpm, notes: inWin, beatGrid: grid }
            writeFileSync(join(OUT, `${clip}.truth.json`), JSON.stringify(truth, null, 2))
            writeWavSlice(samples, sampleRate, start, end, join(OUT, `${clip}__real.wav`))

            clips += 1
            totalNotes += inWin.length
            bpms.push(bpm)
            micCounts.set(s.mic, (micCounts.get(s.mic) ?? 0) + 1)
            singers.add(`${s.quartet}_${s.singer}`)
        }
    }

    bpms.sort((a, b) => a - b)
    const manifest = {
        id: 'dagstuhl-choir',
        label: 'Dagstuhl ChoirSet (real singing, hand-annotated beat grid)',
        kind: 'voice',
        instrumentId: 'voice-lead',
        source: 'https://zenodo.org/records/4618287',
        license: 'CC-BY-4.0',
        // The score CSVs are a DTW alignment of a CPDL MIDI to the room mic, not a
        // transcription: 70 ms onset MAE and a third of pitches >50 cents out. Kept
        // out of the pooled note-F1 for the same reason mir-qbsh is.
        noteTruthDerived: true,
        clips,
        totalNotes,
        singers: singers.size,
        excerptSec: EXCERPT_SEC,
        bpmMin: bpms.length ? Number(bpms[0].toFixed(1)) : null,
        bpmMedian: bpms.length ? Number(bpms[Math.floor(bpms.length / 2)].toFixed(1)) : null,
        bpmMax: bpms.length ? Number(bpms[bpms.length - 1].toFixed(1)) : null,
        mics: Object.fromEntries(micCounts),
        notes:
            'Quartet takes only (one singer per section, so the section score line is ' +
            "that singer's line; FullChoir shares a line and is excluded). Mic is HSM " +
            'headset where it exists, DYN close mic otherwise. THE BEAT GRID IS THE ' +
            'POINT: manually tapped and reviewed by a second annotator, it is the ' +
            "harness's only real tempo on singing and is emitted as GroundTruth." +
            'beatGrid for notation-eval.ts. The NOTE truth is score-aligned by DTW ' +
            '(70 ms onset MAE, a third of pitches >50 cents off) and is NOT an ' +
            'accuracy reference — noteTruthDerived is set. Mic bleed from neighbouring ' +
            'singers is present throughout: never pool into a clean tier. Rhythm ' +
            'scored here is rubato-robustness, not the click-locked axis GuitarSet ' +
            'measures — the singers followed a conductor, with ritardandi at cadences.',
    }
    writeFileSync(join(OUT, 'dataset.json'), JSON.stringify(manifest, null, 2))

    console.log(
        `\nConverted ${clips} Dagstuhl excerpts (${totalNotes} notes, ${singers.size} singers, ` +
            `bpm ${manifest.bpmMin}–${manifest.bpmMax}, median ${manifest.bpmMedian}) into ${OUT}`,
    )
    console.log('Run: pnpm --filter api exec tsx scripts/eval/notation-eval.ts dagstuhl-choir')
}

main()
