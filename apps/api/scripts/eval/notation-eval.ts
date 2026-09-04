/**
 * Score the pipeline's **notation** (not just its note detection) and compare
 * tempo strategies on a metric that cannot be gamed by refusing to quantise.
 *
 * Background: with an onset tolerance in seconds, *not quantising* outscores
 * quantising at the correct tempo, because a finer grid displaces onsets less.
 * That makes seconds-F1 useless for the rhythm stage. `lib/notation.ts` measures
 * in **beats** instead, so a half/double-tempo error is penalised rather than
 * rewarded, and adds note-value accuracy plus reference-free readability counters.
 *
 * **Tempo estimation is a deliberate product non-goal.** The user records against a
 * metronome at a tempo they chose, so that tempo is authoritative and the pipeline
 * does not second-guess it. The `bpm=120` vs `bpm=truth` rows remain as a diagnostic
 * of what a *wrong* tempo costs (0.245 vs 0.714 onset-beat F1) — motivation to keep
 * the click honest, not to infer around it. The real targets are the `bpm=truth`
 * numbers: phase-locked beat F1 0.637 and note-value accuracy 0.587.
 *
 * Two tiers of output, because only one corpus has a real tempo:
 *
 *   FULL metrics (onset-in-beats F1, note-value accuracy) need a reference *beat*
 *   axis, so they run only on datasets with an annotated tempo. Detected as
 *   "more than one distinct bpm across the dataset's clips" — the singing corpora
 *   all carry a nominal, identical 120 and are excluded automatically.
 *
 *   READABILITY counters need no reference and run on everything. A transcription
 *   nobody can read is a bad transcription even where no notated truth exists.
 *
 * Run: pnpm --filter @mushee/api exec tsx scripts/eval/notation-eval.ts [dataset,...]
 * Env: EVAL_SPLIT=dev|test|all   (default dev)
 */

import { resolve } from 'path'

import { NoteExtractor } from '../../src/recordings/pipeline/note-extractor'
import { ProviderRegistry } from '../../src/recordings/pipeline/providers/provider-registry'
import { cleanupAsProduction, performanceAsProduction } from './lib/decodeCached'
import { type BeatNote, NotationScorer, toBeats, truthToBeats } from './lib/notation'
import { discoverRealDatasets, listRealClips } from './lib/realCorpus'
import { inSplit, splitFromEnv } from './lib/split'
import { type CachedClip, TrackCache } from './lib/trackCache'

const REAL_ROOT = resolve(__dirname, '../fixtures/eval-real')
const CACHE_ROOT = resolve(__dirname, '../fixtures/eval-cache')
const MODELS = {
    crepeTiny: resolve(process.cwd(), 'model-crepe-tiny'),
}

function mean(xs: number[]): number {
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0
}
function median(xs: number[]): number {
    if (!xs.length) return 0
    const s = [...xs].sort((a, b) => a - b)
    const m = s.length >> 1
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

interface Acc {
    onsetF1: number[]
    onsetF1Locked: number[]
    nva: number[]
    scales: number[]
    tuplets: number[]
    subSixteenth: number[]
    offGrid: number[]
    distinct: number[]
    bpm: number[]
}
const newAcc = (): Acc => ({
    onsetF1: [],
    onsetF1Locked: [],
    nva: [],
    scales: [],
    tuplets: [],
    subSixteenth: [],
    offGrid: [],
    distinct: [],
    bpm: [],
})

async function main(): Promise<void> {
    const registry = new ProviderRegistry(MODELS)
    await registry.initAll()
    const cache = new TrackCache(registry, CACHE_ROOT)
    const scorer = new NotationScorer()
    // Phase-LOCKED scorer: no global offset search. GuitarSet was played to a click,
    // so beat 1 is at a known instant and a displaced take is genuinely wrong — and
    // this is the only variant that can see a constant capture-start latency.
    const lockedScorer = new NotationScorer(0.125, 1 / 12, false)
    const split = splitFromEnv()

    const filter = (process.argv[2] ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    const datasets = discoverRealDatasets(REAL_ROOT).filter((d) =>
        // A source corpus's held-out test half is an external yardstick; even a
        // diagnostic run against it invites tuning-by-eyeball. Name it explicitly
        // as the CLI filter to look anyway.
        filter.length ? filter.includes(d.id) : d.corpusSplit !== 'test',
    )

    // The `lag=` rows measure what an UNCOMPENSATED capture-start delay costs. The
    // browser used to await the WebSocket handshake at beat 1 before starting the
    // recorder, so the server's first sample was late by a full round trip while the
    // server still treated it as beat 1 — shifting every note early. These rows put a
    // number on that, at the otherwise-correct tempo.
    // `grid=` rows vary how finely onsets may be quantised (`maxGridDivisor`): 4 is the
    // 16th-note grid we ship, 2 the 8th. Finer tracks the performance more closely but
    // pays for it in notation that reads as fussy — a third of our written rests are
    // 16ths, all of them fragments of longer rests split at 16th-grid onsets. This asks
    // whether the coarser grid is nearly free.
    const STRATEGIES = ['bpm=120', 'bpm=truth', 'grid=8th', 'grid=quarter', 'lag=50ms', 'lag=100ms', 'lag=200ms'] as const
    // The quantiser for a strategy, built on the CLIP's own cleanup policy — a voice
    // take and an instrument take no longer share a post-processor, and scoring both
    // through one would measure a configuration nothing runs.
    const extractorFor = (strat: string, c: CachedClip): NoteExtractor => {
        const base = cleanupAsProduction(c)
        if (strat === 'grid=8th') return new NoteExtractor({ ...base, maxGridDivisor: 2 })
        if (strat === 'grid=quarter') return new NoteExtractor({ ...base, maxGridDivisor: 1 })
        return new NoteExtractor(base)
    }

    for (const ds of datasets) {
        const clips: CachedClip[] = []
        for (const clip of listRealClips(ds.dir)) {
            if (!inSplit(ds.id, clip, split)) continue
            try {
                const c = await cache.load(ds, clip)
                if (c) clips.push(c)
            } catch {
                /* unreadable clip — skipped, counted by the length difference below */
            }
        }
        if (!clips.length) continue

        // A dataset has a real tempo only if its clips disagree about it; a corpus-wide
        // constant 120 is the harness's nominal placeholder, not an annotation.
        const distinctBpm = new Set(clips.map((c) => c.truth.bpm))
        // A hand-annotated beat grid is a real tempo axis by construction, whatever
        // the scalar bpm says — it is the stronger signal of the two, so check it
        // first (Dagstuhl ChoirSet; see GroundTruth.beatGrid).
        const gridded = clips.filter((c) => (c.truth.beatGrid?.length ?? 0) >= 2).length
        const tempoAnnotated = gridded > 0 || distinctBpm.size > 1

        const acc: Record<string, Acc> = {}
        for (const s of STRATEGIES) acc[s] = newAcc()

        for (const c of clips) {
            const cleaned = performanceAsProduction(c)

            const refBeats: BeatNote[] = truthToBeats(c.truth.notes, c.truth.bpm, c.truth.beatGrid)

            for (const strat of STRATEGIES) {
                let bpm = 120
                const phase = 0
                let lagSec = 0
                if (strat === 'bpm=truth' || strat.startsWith('grid=')) bpm = c.truth.bpm || 120
                else if (strat.startsWith('lag=')) {
                    // Correct tempo, but capture started late by `lagSec` and nobody told the
                    // server — so every onset reads that much early.
                    bpm = c.truth.bpm || 120
                    lagSec = Number(strat.slice(4).replace('ms', '')) / 1000
                }
                // Quantisation is anchored at t=0, so a metrical phase is applied by
                // shifting the performance, quantising, then shifting back.
                const shifted = cleaned.map((n) => ({
                    ...n,
                    startTimeSeconds: n.startTimeSeconds - phase - lagSec,
                }))
                const notated = extractorFor(strat, c)
                    .quantize(shifted, bpm)
                    .map((n) => ({
                        onsetSec: n.startTimeSeconds + phase,
                        durSec: n.durationSeconds,
                        midi: n.pitchMidi,
                    }))
                // The estimate's beat axis is ITS OWN tempo — that is the whole point: a
                // wrong tempo shows up as wrong beat positions, not as absorbed error.
                const estBeats = toBeats(notated, bpm)
                const a = acc[strat]
                a.bpm.push(bpm)
                const cx = scorer.complexity(estBeats)
                a.tuplets.push(cx.tuplets)
                a.subSixteenth.push(cx.subSixteenth)
                a.offGrid.push(cx.offGrid)
                a.distinct.push(cx.distinctDurations)
                if (tempoAnnotated) {
                    const s = scorer.score(refBeats, estBeats)
                    a.onsetF1.push(s.onsetBeatF1)
                    a.onsetF1Locked.push(lockedScorer.score(refBeats, estBeats).onsetBeatF1)
                    a.nva.push(s.noteValueAccuracy)
                    a.scales.push(s.scale)
                }
            }
        }

        console.log(
            `\n=== ${ds.id} — ${clips.length} clips (split=${split}` +
                `${
                    tempoAnnotated
                        ? gridded
                            ? `, REAL tempo: hand-annotated beat grid on ${gridded}/${clips.length} clips`
                            : `, REAL tempo: ${distinctBpm.size} distinct bpm`
                        : ', nominal bpm only → readability metrics only'
                })`,
        )
        const head = tempoAnnotated
            ? 'strategy'.padEnd(12) +
              'beatF1'.padEnd(9) +
              'beatF1lock'.padEnd(12) +
              'noteValAcc'.padEnd(12) +
              'scale'.padEnd(8) +
              'offGrid'.padEnd(9) +
              'medBpm'
            : 'strategy'.padEnd(12) + 'tuplets'.padEnd(9) + 'sub16'.padEnd(8) + 'offGrid'.padEnd(9) + 'distinctDur'.padEnd(13) + 'medBpm'
        console.log(head)
        console.log('-'.repeat(head.length))
        for (const strat of STRATEGIES) {
            const a = acc[strat]
            const line = tempoAnnotated
                ? strat.padEnd(12) +
                  mean(a.onsetF1).toFixed(3).padEnd(9) +
                  mean(a.onsetF1Locked).toFixed(3).padEnd(12) +
                  mean(a.nva).toFixed(3).padEnd(12) +
                  median(a.scales).toFixed(2).padEnd(8) +
                  mean(a.offGrid).toFixed(1).padEnd(9) +
                  median(a.bpm).toFixed(0)
                : strat.padEnd(12) +
                  mean(a.tuplets).toFixed(1).padEnd(9) +
                  mean(a.subSixteenth).toFixed(1).padEnd(8) +
                  mean(a.offGrid).toFixed(1).padEnd(9) +
                  mean(a.distinct).toFixed(1).padEnd(13) +
                  median(a.bpm).toFixed(0)
            console.log(line)
        }
    }
}

main().catch((e) => {
    console.error(e)
    process.exit(1)
})
