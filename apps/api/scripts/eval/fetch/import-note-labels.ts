/**
 * Turn hand-corrected label files into a scoreable real-corpus dataset.
 *
 * Step 4 of the whistle-corpus chain (see fetch/fetch-whistle-real.ts's header), and
 * the general route for ANY audio we annotate ourselves — our own dogfood takes
 * included. Reads
 *
 *   annotations/<dataset>/<clip>.labels.tsv    (tracked, human-editable)
 *   annotations/<dataset>/<clip>.meta.json     (tracked; `verifiedBy` decides
 *                                               whether the truth is trusted)
 *   .cache/whistle-staging/<dataset>/<clip>.wav
 *
 * and writes the standard layout every other fetcher produces, into the TIER
 * the labels have earned (context/ while any clip is unverified, benchmark/
 * once a human has verified them all — see lib/realCorpus.ts):
 *
 *   fixtures/eval-real/<tier>/<dataset>/<clip>.truth.json
 *   fixtures/eval-real/<tier>/<dataset>/<clip>__real.wav
 *   fixtures/eval-real/<tier>/<dataset>/dataset.json
 *
 * 🔴 The provenance rule this script enforces. A clip whose `.meta.json` still
 * has `verifiedBy: null` carries labels that came out of an algorithm, and
 * research/research-voice-datasets.md §0's gate 3 says such truth must not enter a
 * note-F1 aggregate: it would measure agreement with lib/sineTrack.ts, not with
 * a musician. So the dataset manifest is written with `noteTruthDerived: true`
 * for as long as ANY clip in it is unverified, which is the flag run-eval.ts
 * already honours to keep a dataset out of the pooled headline while still
 * scoring and reporting it. Verify every clip and the flag flips off by itself.
 *
 * Label format (Audacity's, so the round trip through Audacity is lossless):
 *   <startSec>\t<endSec>\t<label>
 * where `<label>` is a scientific pitch name (`A5`, `C#6`, `Bb4`) or a bare MIDI
 * number. A label of `x`, `-` or `` marks a region to IGNORE — how an annotator
 * says "there is sound here but it is not a note" without deleting the evidence.
 *
 * Env / flags:
 *   --dataset=<id>           only this dataset (default: all under annotations/)
 *   --verified-by="<name>"   stamp the SELECTED clips as verified by <name>. Use
 *                            this ONLY after actually checking them. Refused
 *                            without --dataset and a clip selection, so one run
 *                            can never stamp clips nobody looked at.
 *   --clips=<a,b,…>|all      the clips --verified-by stamps (`all` = every clip
 *                            in the dataset)
 *   --verified-list=<file>   the same, read from a file: one clip id per line, or
 *                            a worklist whose ticked `- [x] \`<clip>\`` items are
 *                            the checked clips (unticked items are skipped)
 *
 * Every clip in the dataset is still imported; the selection only decides which
 * `.meta.json` files get the stamp.
 *
 * Run: pnpm --filter @mushee/api exec tsx scripts/eval/fetch/import-note-labels.ts
 */

import { createHash } from 'crypto'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'

import type { GroundTruth, SourceKind, TruthNote } from '../types'

const ANNOTATIONS = resolve(__dirname, '../annotations')
const STAGE_ROOT = resolve(__dirname, '../.cache/whistle-staging')
const OUT_ROOT = resolve(__dirname, '../../fixtures/eval-real')

/**
 * Per-dataset presentation. `kind` drives the profile hint run-eval.ts passes
 * (a `whistle` dataset resolves through the whistle range, 500–4300 Hz, exactly
 * as a user picking "whistle" in the app would).
 */
const DATASETS: Record<string, { label: string; kind: SourceKind; instrumentId?: string; note: string }> = {
    'whistle-real': {
        label: 'Whistling — real, permissively licensed (hand-annotated)',
        kind: 'whistle',
        instrumentId: 'whistle',
        note: 'Modern unaccompanied whistling: 5 Wikimedia Commons clips (PD / CC BY-SA), plus Freesound CC0 previews when FREESOUND_TOKEN was set and the MIT repo\u2019s Pink Panther phrases under WHISTLE_INCLUDE_ENCUMBERED. See research/research-whistle-corpus.md.',
    },
    'whistle-vintage': {
        label: 'Whistling — public-domain art whistling (accompanied, 78 rpm)',
        kind: 'whistle',
        instrumentId: 'whistle',
        note: 'Alice J. Shaw / Frank Stafford acoustic-era sides: real whistling over piano/orchestra with surface noise. Adverse by nature — never pool with whistle-real.',
    },
    'whistle-dogfood': {
        label: 'Whistling — in-house dogfood takes (hand-annotated)',
        kind: 'whistle',
        instrumentId: 'whistle',
        note: 'Our own recordings, captured per research/research-whistle-corpus.md §6. The only route to whistling at volume.',
    },
}

// Recorded whistling has no annotated tempo; `bpm` only feeds the converter's
// quantizer and the metrics compare onsets in seconds, so this mirrors what the
// live pipeline assumes absent a user-set tempo (same convention as vocadito).
const NOMINAL_BPM = 120

const PITCH_CLASS: Record<string, number> = {
    C: 0,
    D: 2,
    E: 4,
    F: 5,
    G: 7,
    A: 9,
    B: 11,
}

/** `A5` / `C#6` / `Bb4` / `73` → MIDI number. Returns undefined for ignore-markers. */
function parsePitch(label: string): number | undefined {
    const raw = label.trim()
    if (!raw || raw === 'x' || raw === 'X' || raw === '-') return undefined
    if (/^-?\d+(\.\d+)?$/.test(raw)) return Math.round(Number(raw))
    const m = /^([A-Ga-g])([#b♯♭]*)(-?\d+)$/.exec(raw)
    if (!m) throw new Error(`unparseable pitch label "${label}"`)
    const [, letter, accidentals, octave] = m
    let midi = PITCH_CLASS[letter.toUpperCase()] + (Number(octave) + 1) * 12
    for (const a of accidentals) midi += a === '#' || a === '♯' ? 1 : -1
    return midi
}

interface ParsedLabels {
    notes: TruthNote[]
    ignored: number
    overlaps: number
}

function parseLabels(tsv: string, clip: string): ParsedLabels {
    const notes: TruthNote[] = []
    let ignored = 0
    for (const [i, line] of tsv.split('\n').entries()) {
        const row = line.trim()
        if (!row) continue
        const cols = row.split('\t')
        if (cols.length < 2) throw new Error(`${clip}:${i + 1}: expected TAB-separated columns`)
        const startSec = Number(cols[0])
        const endSec = Number(cols[1])
        if (!Number.isFinite(startSec) || !Number.isFinite(endSec)) {
            throw new Error(`${clip}:${i + 1}: non-numeric time`)
        }
        // Audacity writes a point label as start == end; a zero-length note cannot
        // be scored, so it is a mistake worth failing on rather than rounding away.
        if (endSec <= startSec) throw new Error(`${clip}:${i + 1}: end <= start`)
        const midi = parsePitch(cols.slice(2).join(' '))
        if (midi === undefined) {
            ignored += 1
            continue
        }
        if (midi < 21 || midi > 127) throw new Error(`${clip}:${i + 1}: MIDI ${midi} out of range`)
        notes.push({ onsetSec: startSec, durSec: endSec - startSec, midi })
    }
    notes.sort((a, b) => a.onsetSec - b.onsetSec)

    // Overlaps are reported, not repaired: on monophonic material they mean the
    // annotator left a boundary crossed, and silently trimming one would move a
    // truth onset the metric then scores against.
    let overlaps = 0
    for (let i = 1; i < notes.length; i += 1) {
        if (notes[i].onsetSec < notes[i - 1].onsetSec + notes[i - 1].durSec - 1e-6) overlaps += 1
    }
    return { notes, ignored, overlaps }
}

interface ClipMetaFile {
    verifiedBy: string | null
    verifiedAt: string | null
    audio?: { sha256?: string }
    provenance?: { licence?: string; attribution?: string; source?: string }
}

function refuse(message: string): never {
    console.error(message)
    process.exit(1)
}

function flag(argv: string[], name: string): string | undefined {
    return argv.find((a) => a.startsWith(`--${name}=`))?.slice(`--${name}=`.length)
}

/**
 * The clips `--verified-by` may stamp, from `--clips` and/or `--verified-list`
 * (see the header); undefined when neither flag is given. A worklist line counts
 * only when its box is ticked, so passing VERIFY-WORKLIST.md itself stamps exactly
 * what the reviewer ticked.
 */
function readClipSelection(argv: string[]): Set<string> | 'all' | undefined {
    const clipsArg = flag(argv, 'clips')
    const listArg = flag(argv, 'verified-list')
    if (clipsArg === undefined && listArg === undefined) return undefined
    if (clipsArg?.trim() === 'all') {
        if (listArg !== undefined) refuse('--clips=all and --verified-list contradict each other; pass one.')
        return 'all'
    }
    const ids = new Set<string>()
    for (const id of clipsArg?.split(',') ?? []) if (id.trim()) ids.add(id.trim())
    if (listArg !== undefined) {
        const listPath = resolve(listArg)
        if (!existsSync(listPath)) refuse(`--verified-list: no file at ${listPath}`)
        for (const line of readFileSync(listPath, 'utf8').split('\n')) {
            const row = line.trim()
            const ticked = /^[-*] \[[xX]\] `([^`]+)`/.exec(row)
            if (ticked) ids.add(ticked[1])
            else if (/^[\w.-]+$/.test(row)) ids.add(row)
        }
    }
    if (!ids.size) refuse('The clip selection is empty (no ids, or no ticked worklist items); nothing would be stamped.')
    return ids
}

function main(): void {
    const argv = process.argv.slice(2)
    const wantDataset = flag(argv, 'dataset')
    const verifiedBy = flag(argv, 'verified-by')
    const selection = readClipSelection(argv)
    // Label times only mean something against the exact bytes they were made on.
    const allowDrift = argv.includes('--allow-audio-drift')

    if (!existsSync(ANNOTATIONS)) {
        console.error(`No annotations at ${ANNOTATIONS} — run fetch/draft-note-labels.ts first.`)
        process.exit(1)
    }

    // The stamp is the one thing this script writes into tracked files, and it is
    // what lets a dataset into the pooled numbers. Until 2026-10 a bare
    // `--verified-by` stamped every clip of every dataset it processed, so checking
    // the 30 worklist clips and running it would have marked every staged clip under
    // annotations/ as human-verified. Scope it to one dataset and the clips actually
    // checked, and refuse anything looser.
    if (verifiedBy !== undefined || selection !== undefined) {
        if (!verifiedBy) refuse('--clips / --verified-list choose which clips --verified-by stamps; pass --verified-by="<name>" too.')
        if (!wantDataset) refuse('--verified-by needs --dataset=<id>: it stamps clips of ONE dataset only.')
        if (!selection) refuse('--verified-by needs the clips you checked: --clips=<a,b,…>, --verified-list=<file>, or --clips=all.')
        const annDir = join(ANNOTATIONS, wantDataset)
        if (!existsSync(annDir)) refuse(`No annotations/${wantDataset}/ to verify.`)
        if (selection !== 'all') {
            const known = new Set(
                readdirSync(annDir)
                    .filter((f) => f.endsWith('.labels.tsv'))
                    .map((f) => f.replace(/\.labels\.tsv$/, '')),
            )
            const unknown = [...selection].filter((clip) => !known.has(clip))
            if (unknown.length) refuse(`Not clips of annotations/${wantDataset}/: ${unknown.join(', ')}`)
        }
    }
    const shouldStamp = (clip: string): boolean => !!verifiedBy && selection !== undefined && (selection === 'all' || selection.has(clip))
    const stamped = new Set<string>()

    for (const ds of readdirSync(ANNOTATIONS, { withFileTypes: true })) {
        if (!ds.isDirectory()) continue
        if (wantDataset && ds.name !== wantDataset) continue
        const annDir = join(ANNOTATIONS, ds.name)
        const stageDir = join(STAGE_ROOT, ds.name)
        const presentation = DATASETS[ds.name] ?? {
            label: ds.name,
            kind: 'voice' as SourceKind,
            note: 'hand-annotated dataset with no entry in fetch/import-note-labels.ts',
        }

        const labelFiles = readdirSync(annDir)
            .filter((f) => f.endsWith('.labels.tsv'))
            .sort()
        if (!labelFiles.length) continue

        // The dataset's TIER (benchmark/ vs context/, see lib/realCorpus.ts) depends
        // on whether every imported clip is verified — which is only known after the
        // loop. Build into a temp dir, then move it into the tier it earned.
        const out = join(OUT_ROOT, `.import-${ds.name}`)
        rmSync(out, { recursive: true, force: true })
        mkdirSync(out, { recursive: true })

        let clips = 0
        let totalNotes = 0
        let unverified = 0
        let emptyLabels = 0
        let driftSkipped = 0
        const licences = new Set<string>()
        const attributions: string[] = []

        for (const file of labelFiles) {
            const clip = file.replace(/\.labels\.tsv$/, '')
            const wav = join(stageDir, `${clip}.wav`)
            if (!existsSync(wav)) {
                console.warn(`  ! ${ds.name}/${clip}: staged audio missing — run fetch/fetch-whistle-real.ts`)
                continue
            }
            const { notes, ignored, overlaps } = parseLabels(readFileSync(join(annDir, file), 'utf8'), clip)
            if (!notes.length) {
                // A label file emptied on purpose ("nothing here is a note") is a valid
                // annotation, but a clip with no notes cannot be scored, so it is left out.
                emptyLabels += 1
                continue
            }

            const metaPath = join(annDir, `${clip}.meta.json`)
            const meta: ClipMetaFile = existsSync(metaPath)
                ? (JSON.parse(readFileSync(metaPath, 'utf8')) as ClipMetaFile)
                : { verifiedBy: null, verifiedAt: null }

            // Drift check. A label file is a set of timestamps into ONE recording; if
            // the upstream file was re-uploaded or the fetcher's normalisation changed,
            // every boundary in it is now wrong by an unknown amount. Refuse the clip
            // rather than score against shifted truth (`--allow-audio-drift` overrides,
            // for the case where the drift is known-benign).
            const actualSha = createHash('sha256').update(readFileSync(wav)).digest('hex')
            if (meta.audio?.sha256 && meta.audio.sha256 !== actualSha) {
                driftSkipped += 1
                console.warn(
                    `  ⛔ ${ds.name}/${clip}: staged audio does not match the audio these labels were made on ` +
                        `(sha256 ${actualSha.slice(0, 12)}… vs ${meta.audio.sha256.slice(0, 12)}…). ` +
                        'Re-draft, or pass --allow-audio-drift if you know why.',
                )
                if (!allowDrift) continue
            }
            if (shouldStamp(clip)) {
                meta.verifiedBy = verifiedBy ?? null
                meta.verifiedAt = new Date().toISOString()
                writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`)
                stamped.add(clip)
            }
            if (!meta.verifiedBy) unverified += 1
            if (meta.provenance?.licence) licences.add(meta.provenance.licence)
            if (meta.provenance?.attribution) attributions.push(meta.provenance.attribution)

            const truth: GroundTruth = { bpm: NOMINAL_BPM, notes }
            writeFileSync(join(out, `${clip}.truth.json`), `${JSON.stringify(truth, null, 2)}\n`)
            copyFileSync(wav, join(out, `${clip}__real.wav`))
            clips += 1
            totalNotes += notes.length
            if (overlaps || ignored) {
                console.log(
                    `    ${clip}: ${notes.length} notes` +
                        (ignored ? `, ${ignored} ignore-regions` : '') +
                        (overlaps ? `, ⚠ ${overlaps} overlapping pairs` : ''),
                )
            }
        }

        if (!clips) {
            rmSync(out, { recursive: true, force: true })
            console.log(`  ${ds.name}: nothing to import`)
            continue
        }

        const manifest = {
            id: ds.name,
            label: presentation.label,
            kind: presentation.kind,
            instrumentId: presentation.instrumentId,
            // Unverified drafts are algorithmic truth: report them, never pool them.
            noteTruthDerived: unverified > 0,
            clips,
            totalNotes,
            unverifiedClips: unverified,
            licenses: [...licences].sort(),
            attribution: [...new Set(attributions)],
            annotationSource: 'scripts/eval/annotations (tracked label TSVs)',
            bpmAssumed: NOMINAL_BPM,
            note: presentation.note,
        }
        writeFileSync(join(out, 'dataset.json'), `${JSON.stringify(manifest, null, 2)}\n`)

        // Verification decides the tier: drafts stay in context/, a fully
        // human-verified set graduates to benchmark/. Clear every location the
        // dataset may have occupied (either tier, or the pre-tier flat layout) so
        // a promotion never leaves a stale copy behind.
        const tier = unverified > 0 ? 'context' : 'benchmark'
        const finalOut = join(OUT_ROOT, tier, ds.name)
        for (const stale of [join(OUT_ROOT, 'benchmark', ds.name), join(OUT_ROOT, 'context', ds.name), join(OUT_ROOT, ds.name)]) {
            rmSync(stale, { recursive: true, force: true })
        }
        mkdirSync(join(OUT_ROOT, tier), { recursive: true })
        renameSync(out, finalOut)

        console.log(
            `  ${ds.name}: ${clips} clips, ${totalNotes} notes → ${tier}/` +
                (emptyLabels ? `, ${emptyLabels} clips with empty labels skipped` : '') +
                (driftSkipped ? `, ⛔ ${driftSkipped} clips skipped on audio drift` : '') +
                (unverified
                    ? ` — ⚠ ${unverified} UNVERIFIED, dataset marked noteTruthDerived (not pooled)`
                    : ' — all verified, pooled normally'),
        )
    }

    if (verifiedBy) {
        console.log(`\nStamped ${stamped.size} clip(s) verified by ${verifiedBy}.`)
        // A selected clip that was skipped above (no staged audio, empty labels,
        // audio drift) keeps its old stamp: say so rather than let it pass silently.
        const missed = selection instanceof Set ? [...selection].filter((clip) => !stamped.has(clip)) : []
        if (missed.length) console.warn(`  ! selected but not stamped (skipped above): ${missed.join(', ')}`)
    }

    console.log('\nRun: EVAL_REAL=1 EVAL_ADAPTIVE=1 pnpm --filter api exec tsx scripts/eval/run-eval.ts')
}

main()
