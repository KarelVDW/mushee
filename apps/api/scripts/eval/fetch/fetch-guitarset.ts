/**
 * Fetch GuitarSet and convert a SUBSET of its *solo* excerpts into the eval
 * harness's *real* corpus layout — real plucked-string audio with note-level
 * ground truth, which no other dataset in the harness provides (URMP covers
 * bowed strings/winds/brass, everything else is singing).
 *
 * Output: scripts/fixtures/eval-real/benchmark/guitarset-solo/<clip>.truth.json  ({bpm, notes})
 *         scripts/fixtures/eval-real/benchmark/guitarset-solo/<clip>__real.wav
 *         scripts/fixtures/eval-real/benchmark/guitarset-solo/dataset.json        (manifest)
 *
 * Source : https://zenodo.org/records/3371780  (GuitarSet, ISMIR 2018)
 * License: CC-BY-4.0 (attribution; commercial use OK).
 *
 * Two of the record's five files are downloaded and cached (gitignored) under
 * scripts/eval/.cache/guitarset: `annotation.zip` (39 MB) and the mono
 * microphone mix `audio_mono-mic.zip` (657 MB). The hexaphonic per-string audio
 * (3.2/3.6 GB) is deliberately NOT used: one channel per string is easier than
 * anything a user will ever record. Set GUITARSET_AUDIO=pickup to score the
 * direct pickup mix instead of the room microphone.
 *
 * SOLO ONLY. Each of the 360 excerpts is either `_comp` (strummed chordal
 * accompaniment) or `_solo` (single-line improvisation). The pipeline is
 * monophonic by design, so the 180 `_comp` excerpts would measure nothing but
 * its inability to hear chords; they are excluded rather than shipped as a
 * separate dataset, which would only ever be skipped. Even the solo excerpts
 * contain occasional double stops, so candidate windows are rejected above
 * MAX_CHORD_RATIO simultaneous attacks (see pickWindow).
 *
 * Ground truth: the JAMS files carry six `note_midi` annotations, one per string
 * (`annotation_metadata.data_source` = "0".."5"). The played line is the union of
 * all six, so they are merged and sorted. `value` is fractional MIDI (the
 * annotations come from monophonic pitch tracking of the hexaphonic pickup, then
 * manual correction) and is rounded to the harness's integer MIDI. The JAMS
 * `tempo` annotation gives the real bpm — GuitarSet was played to a click, so
 * unlike the singing corpora this is a genuine tempo, not a placeholder.
 *
 * Idempotent. Run: pnpm --filter api exec tsx scripts/eval/fetch/fetch-guitarset.ts
 */

import { execFileSync } from 'child_process'
import ffmpegPath from 'ffmpeg-static'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { basename, join, resolve } from 'path'

import type { GroundTruth, TruthNote } from '../types'

const RECORD = 'https://zenodo.org/api/records/3371780/files'
const ANNOT_URL = `${RECORD}/annotation.zip/content`

// Which of the two mono mixes to score. The room microphone is what the product
// actually receives; the pickup mix is the cleaner, DI-recorded alternative.
const AUDIO_SETS = {
    mic: { zip: 'audio_mono-mic.zip', dir: 'audio_mono-mic', suffix: '_mic', label: 'mono mic' },
    pickup: {
        zip: 'audio_mono-pickup_mix.zip',
        dir: 'audio_mono-pickup_mix',
        suffix: '_mix',
        label: 'mono pickup mix',
    },
} as const
const AUDIO = AUDIO_SETS[(process.env.GUITARSET_AUDIO as keyof typeof AUDIO_SETS) ?? 'mic']

const CACHE = resolve(__dirname, '../.cache', 'guitarset')
const ANNOT_ZIP = join(CACHE, 'annotation.zip')
const ANNOT_DIR = join(CACHE, 'annotation')
const AUDIO_ZIP = join(CACHE, AUDIO.zip)
const AUDIO_DIR = join(CACHE, AUDIO.dir)
const OUT = resolve(__dirname, '../../fixtures/eval-real/benchmark/guitarset-solo')

// Excerpt length per clip, and the audio kept before the first note so the
// pipeline's pitch scan has a moment of noise floor to adapt to.
const WINDOW_SEC = 15
const LEAD_SEC = 0.25

// A window must hold at least this many notes to be worth scoring.
const MIN_NOTES = 8

// A note attacking within this much of the window's end has no time to sound;
// it is left to the next window rather than scored as a clipped fragment.
const TAIL_SEC = 0.2

// Onsets closer together than this count as one simultaneous attack (a double
// stop or chord) rather than two melodic notes.
const CHORD_SEC = 0.05

// Reject a window whose share of simultaneous attacks exceeds this. The solo
// excerpts are mostly single-line, but players do drop in the occasional double
// stop, and those notes are unhittable for a monophonic pipeline — scoring them
// would report a ceiling the pipeline cannot reach for reasons unrelated to
// transcription quality.
const MAX_CHORD_RATIO = 0.05

// Target subset size out of the 180 solo excerpts.
const SUBSET_TARGET = 50

// Plausible sounding range of a standard-tuned guitar (E2..~C6), generous at both
// ends. Drops octave-error/garbage annotation rows.
const MIN_MIDI = 38
const MAX_MIDI = 90

function download(url: string, dest: string, label: string): void {
    if (existsSync(dest)) {
        console.log(`  ${label} already cached: ${dest}`)
        return
    }
    mkdirSync(CACHE, { recursive: true })
    console.log(`  downloading ${label} …`)
    execFileSync('curl', ['-sL', '--fail', '--max-time', '3000', '-o', dest, url], {
        stdio: ['ignore', 'ignore', 'inherit'],
    })
}

function extract(zip: string, into: string, label: string): void {
    if (existsSync(into) && readdirSync(into).length) {
        console.log(`  ${label} already extracted: ${into}`)
        return
    }
    mkdirSync(into, { recursive: true })
    // -o overwrite, -q quiet, -x drops the macOS resource-fork sidecar files.
    execFileSync('unzip', ['-oq', zip, '-d', into, '-x', '__MACOSX/*'], {
        stdio: ['ignore', 'ignore', 'inherit'],
    })
}

/** The slice of the JAMS schema this script reads. */
interface Jams {
    file_metadata: { duration: number }
    annotations: {
        namespace: string
        data: { time: number; duration: number; value: number }[]
    }[]
}

/**
 * Merge the six per-string `note_midi` annotations into one monophonic line and
 * read the annotated tempo and excerpt length. Pitch is rounded to the nearest
 * semitone; rows outside the guitar's range are dropped as annotation errors.
 * `file_metadata.duration` matches the WAV byte length exactly for every solo
 * excerpt (verified), so it can bound the window without probing the audio.
 */
function parseJams(path: string): { notes: TruthNote[]; bpm: number; durationSec: number } {
    const jams = JSON.parse(readFileSync(path, 'utf8')) as Jams
    const notes: TruthNote[] = []
    let bpm = 0
    for (const ann of jams.annotations) {
        if (ann.namespace === 'tempo') {
            bpm = Math.round(ann.data[0]?.value ?? 0)
        } else if (ann.namespace === 'note_midi') {
            for (const obs of ann.data) {
                const midi = Math.round(obs.value)
                if (!Number.isFinite(obs.time) || !(obs.duration > 0)) continue
                if (midi < MIN_MIDI || midi > MAX_MIDI) continue
                notes.push({ onsetSec: obs.time, durSec: obs.duration, midi })
            }
        }
    }
    notes.sort((a, b) => a.onsetSec - b.onsetSec)
    return { notes, bpm, durationSec: jams.file_metadata.duration }
}

/** Share of notes that attack simultaneously with their predecessor. */
function chordRatio(notes: TruthNote[]): number {
    if (notes.length < 2) return 1
    let simultaneous = 0
    for (let i = 1; i < notes.length; i++) {
        if (notes[i].onsetSec - notes[i - 1].onsetSec < CHORD_SEC) simultaneous += 1
    }
    return simultaneous / notes.length
}

interface Window {
    startSec: number
    /** Actual excerpt length — shorter than WINDOW_SEC only for short sources. */
    lengthSec: number
    /** Window-relative truth notes. */
    notes: TruthNote[]
    chordRatio: number
}

/**
 * Pick the WINDOW_SEC excerpt with the most notes among those whose share of
 * simultaneous attacks stays under MAX_CHORD_RATIO, or null if the excerpt has
 * no such window. Candidate starts are the note onsets, so no window opens in
 * the middle of a phrase's silence, and they are pulled back so the window never
 * runs past the end of the audio (the shortest solo excerpt is 14.4 s, i.e. just
 * under WINDOW_SEC, so a window can legitimately be short).
 *
 * Inclusion is by ONSET, not by full containment: a plucked guitar note rings
 * well past the phrase it belongs to, so requiring the whole note to fit would
 * drop notes whose attack is plainly audible inside the window and turn them
 * into false positives. Their ring is clipped at the window edge instead — which
 * only touches the offset-bias statistic, since matching is onset+pitch based.
 */
function pickWindow(all: TruthNote[], durationSec: number): Window | null {
    let best: Window | null = null
    const latestStart = Math.max(0, durationSec - WINDOW_SEC)
    for (const anchor of all) {
        const startSec = Math.min(Math.max(0, anchor.onsetSec - LEAD_SEC), latestStart)
        const endSec = Math.min(startSec + WINDOW_SEC, durationSec)
        const inWindow = all.filter((n) => n.onsetSec >= startSec && n.onsetSec <= endSec - TAIL_SEC)
        if (inWindow.length < MIN_NOTES) continue
        const ratio = chordRatio(inWindow)
        if (ratio > MAX_CHORD_RATIO) continue
        const notes = inWindow.map((n) => ({
            ...n,
            onsetSec: n.onsetSec - startSec,
            durSec: Math.min(n.durSec, endSec - n.onsetSec),
        }))
        if (!best || notes.length > best.notes.length) {
            best = { startSec, lengthSec: endSec - startSec, notes, chordRatio: ratio }
        }
    }
    return best
}

interface Candidate {
    clip: string
    wav: string
    /** Chord-progression id shared across players, e.g. Jazz2. */
    progression: string
    /** Player id, "00".."05". */
    player: string
    bpm: number
    window: Window
}

/**
 * Breadth-first subset: round-robin over the 15 chord progressions, each pull
 * taking the clip whose PLAYER is currently least represented. Keeps the subset
 * from collapsing onto one player's technique or one musical style.
 * Deterministic.
 */
function pickSubset(candidates: Candidate[], target: number): Candidate[] {
    const byProgression = new Map<string, Candidate[]>()
    for (const c of candidates) {
        const list = byProgression.get(c.progression) ?? []
        list.push(c)
        byProgression.set(c.progression, list)
    }
    const queues = Array.from(byProgression.keys())
        .sort()
        .map((k) => (byProgression.get(k) as Candidate[]).sort((a, b) => a.clip.localeCompare(b.clip)))

    const chosen: Candidate[] = []
    const playerCount = new Map<string, number>()
    let progress = true
    while (chosen.length < target && progress) {
        progress = false
        for (const queue of queues) {
            if (chosen.length >= target || !queue.length) continue
            let bestIdx = 0
            for (let i = 1; i < queue.length; i++) {
                if ((playerCount.get(queue[i].player) ?? 0) < (playerCount.get(queue[bestIdx].player) ?? 0)) {
                    bestIdx = i
                }
            }
            const next = queue.splice(bestIdx, 1)[0]
            chosen.push(next)
            playerCount.set(next.player, (playerCount.get(next.player) ?? 0) + 1)
            progress = true
        }
    }
    return chosen
}

/** Write `[startSec, startSec + lengthSec)` of `src` as mono 16-bit WAV. */
function writeWindowWav(src: string, startSec: number, lengthSec: number, dest: string): void {
    if (!ffmpegPath) throw new Error('ffmpeg-static binary not available')
    execFileSync(
        ffmpegPath,
        [
            '-hide_banner',
            '-loglevel',
            'error',
            '-y',
            '-i',
            src,
            // -ss after -i: decode-accurate seek, so the truth timeline and the audio
            // agree to the sample (a keyframe-rounded seek would shift every onset).
            '-ss',
            startSec.toFixed(6),
            '-t',
            lengthSec.toFixed(6),
            '-ac',
            '1',
            '-c:a',
            'pcm_s16le',
            dest,
        ],
        { stdio: ['ignore', 'ignore', 'inherit'] },
    )
}

function main(): void {
    download(ANNOT_URL, ANNOT_ZIP, 'GuitarSet annotations (~39 MB)')
    download(`${RECORD}/${AUDIO.zip}/content`, AUDIO_ZIP, `GuitarSet ${AUDIO.label} audio (~660 MB)`)
    extract(ANNOT_ZIP, ANNOT_DIR, 'annotations')
    extract(AUDIO_ZIP, AUDIO_DIR, 'audio')

    const soloJams = readdirSync(ANNOT_DIR)
        .filter((f) => f.endsWith('_solo.jams'))
        .sort()
    console.log(`  ${soloJams.length} solo excerpts (comp excerpts excluded as polyphonic)`)

    const candidates: Candidate[] = []
    let noWindow = 0
    for (const file of soloJams) {
        const clip = basename(file, '.jams') // e.g. 04_Jazz2-110-Bb_solo
        const wav = join(AUDIO_DIR, `${clip}${AUDIO.suffix}.wav`)
        if (!existsSync(wav)) {
            console.warn(`  ! ${clip}: audio missing, skipping`)
            continue
        }
        const { notes, bpm, durationSec } = parseJams(join(ANNOT_DIR, file))
        const window = pickWindow(notes, durationSec)
        if (!window) {
            noWindow += 1
            continue
        }
        // 04_Jazz2-110-Bb_solo -> player 04, progression Jazz2, tempo 110.
        const [player, rest] = clip.split('_')
        candidates.push({
            clip,
            wav,
            progression: rest.split('-')[0],
            player,
            bpm: bpm || Number(rest.split('-')[1]),
            window,
        })
    }
    console.log(
        `  ${candidates.length} excerpts have a monophonic ${WINDOW_SEC} s window ` + `(${noWindow} rejected: too chordal or too sparse)`,
    )

    const chosen = pickSubset(candidates, SUBSET_TARGET)

    rmSync(OUT, { recursive: true, force: true })
    mkdirSync(OUT, { recursive: true })

    let totalNotes = 0
    let chordSum = 0
    const players = new Set<string>()
    const progressions = new Set<string>()
    for (const c of chosen) {
        const truth: GroundTruth = { bpm: c.bpm, notes: c.window.notes }
        writeFileSync(join(OUT, `${c.clip}.truth.json`), JSON.stringify(truth, null, 2))
        writeWindowWav(c.wav, c.window.startSec, c.window.lengthSec, join(OUT, `${c.clip}__real.wav`))
        totalNotes += c.window.notes.length
        chordSum += c.window.chordRatio
        players.add(c.player)
        progressions.add(c.progression)
        console.log(
            `  ${c.clip} (${c.window.notes.length} notes from ${c.window.startSec.toFixed(1)} s, ` +
                `${c.bpm} bpm, chord ratio ${c.window.chordRatio.toFixed(3)})`,
        )
    }

    // Manifest read by run-eval (EVAL_REAL) for the dataset's display label and
    // adaptive instrument hint — 'guitar' mirrors a user picking "guitar".
    const manifest = {
        id: 'guitarset-solo',
        label: `GuitarSet solo (real acoustic guitar, ${AUDIO.label})`,
        kind: 'instrument',
        instrumentId: 'guitar',
        source: 'https://zenodo.org/records/3371780',
        license: 'CC-BY-4.0',
        audioSet: AUDIO.dir,
        clips: chosen.length,
        totalNotes,
        notes:
            `Subset of ${chosen.length}/${candidates.length} eligible solo excerpts (the corpus has ` +
            '180 solo and 180 comp excerpts; comp is strummed chordal playing and is excluded as ' +
            `polyphonic), spanning ${players.size} players and ${progressions.size} chord ` +
            `progressions. Each clip is the most note-dense ${WINDOW_SEC} s window of its excerpt ` +
            `whose share of simultaneous attacks stays under ${MAX_CHORD_RATIO} (mean ` +
            `${(chordSum / Math.max(chosen.length, 1)).toFixed(3)}); notes are included by onset and ` +
            'their ring is clipped at the window edge. Ground truth is the union of the six ' +
            'per-string note_midi JAMS annotations (hexaphonic-pickup pitch tracking, manually ' +
            'corrected by the authors), rounded to integer MIDI. bpm is the annotated tempo — ' +
            'GuitarSet was played to a click. Residual caveat: plucked notes ring into each other, ' +
            'so a monophonic transcriber will overlap ground-truth notes even where no chord was ' +
            'intended.',
    }
    writeFileSync(join(OUT, 'dataset.json'), JSON.stringify(manifest, null, 2))

    console.log(
        `\nConverted ${chosen.length} GuitarSet solo clips (${totalNotes} notes, ` +
            `${players.size} players, ${progressions.size} progressions) into ${OUT}`,
    )
    console.log('Run: EVAL_REAL=1 EVAL_ADAPTIVE=1 pnpm --filter api exec tsx scripts/eval/run-eval.ts')
}

main()
