/**
 * Does any gated feature want a PER-BAND setting?
 *
 * The pipeline's adaptive knobs are all global today: every trajectory band
 * (low/mid/high) shares one voicing gate, one smoother, one voice-decode
 * config, and every defaulted-off option (R21 fill, R19 quorum, R15 filters,
 * …) was accepted or rejected on a pooled number. The architecture already
 * supports per-band values — they are fields on `PROFILE_BANDS` rows — so the
 * open question is purely empirical: does the optimum of any knob differ by
 * register band enough to pay for splitting it?
 *
 * Method: every cached clip carries the band the resolver chose for it
 * (`profile.id`, suffixes stripped). Each config below is ONE override applied
 * to the production configuration (`segmentAsProduction`/`cleanupAsProduction`
 * semantics, re-implemented here with override hooks), scored at the clean
 * stage against note truth, and reported as a PAIRED Δ vs the production
 * baseline **within each band × path stratum**. A knob earns a per-band split
 * only when some stratum shows a CI-excluding-zero gain while another shows
 * none (or a loss) — a uniform gain would just move the global default.
 *
 * Instrument-path notes: the shipping instrument segmenter (`segmentNotes`)
 * has no quorum/fill plumbing (R19/R21 added them to `NoteSegmenter`, which
 * does not ship for instruments), so those are emulated here exactly:
 * `fillDropouts` transforms the track before segmentation (what the plumbed
 * option does), and the quorum demotes a failing frame by zeroing its
 * confidence (the legacy gate is `confidence ≥ threshold ∧ in-window`, so
 * zeroing is precisely a demote-only mask). The voice path uses the decoders'
 * own options.
 *
 * Run: pnpm --filter @mushee/api exec tsx scripts/eval/sweep-bands.ts
 * Env: EVAL_SPLIT=dev|test|all (default dev)
 *      SWEEP_ONLY=substr   run only configs whose name contains substr
 */

import { resolve } from 'path'

import { NoteExtractor, type NoteExtractorOptions } from '../../src/recordings/pipeline/note-extractor'
import { VOICE_OPTS } from '../../src/recordings/pipeline/providers/crepe-provider'
import { segmentNotes } from '../../src/recordings/pipeline/providers/pitch-decoder'
import { type VoiceDecodeOptions, VoiceNoteDecoder } from '../../src/recordings/pipeline/voice-note-decoder'
import { frameCount } from './lib/decodeCached'
import { type EstNote, scoreNotesBest } from './lib/metrics'
import { discoverRealDatasets, listRealClips } from './lib/realCorpus'
import { inSplit, splitFromEnv } from './lib/split'
import { formatComparison, pairedDiffCI } from './lib/stats'
import { type CachedClip, TrackCache } from './lib/trackCache'

const REAL_ROOT = resolve(__dirname, '../fixtures/eval-real')
const CACHE_ROOT = resolve(__dirname, '../fixtures/eval-cache')
const MODELS = {
    crepeTiny: resolve(process.cwd(), 'model-crepe-tiny'),
}

interface Config {
    name: string
    /** Additive offset on the clip's cached (reverb-adapted) voicing gate. */
    gateDelta?: number
    /** R21: fill unvoiced gaps ≤ this many seconds before decoding. */
    fillSec?: number
    /** R19: demote-only voiced quorum, emulated identically on both paths. */
    quorum?: { minFraction: number; windowSec: number }
    /** Voice-decoder overrides (voice-routed clips only). */
    voice?: Partial<VoiceDecodeOptions>
    /** Instrument-path overrides (segmentNotes; ignored by voice clips). */
    seg?: {
        smoothFrames?: number
        minFramesPerNote?: number
        pitchBinToleranceCents?: number
    }
    /** Voice-path note floor in seconds (profile default is 4 frames = 80 ms). */
    voiceMinNoteSec?: number
    /** Cleanup overrides merged onto the production cleanup set. */
    cleanup?: Partial<NoteExtractorOptions>
    /** Drop the onset-split channel (re-onset recovery) entirely. */
    noOnsetSplit?: boolean
}

const CONFIGS: Config[] = [{ name: 'SHIPPED' }]
for (const gateDelta of [-0.15, -0.1, -0.05, 0.05, 0.1, 0.15]) {
    CONFIGS.push({ name: `gate${gateDelta > 0 ? '+' : ''}${gateDelta}`, gateDelta })
}
for (const fillSec of [0.02, 0.04]) {
    CONFIGS.push({ name: `fill${fillSec * 1000}ms`, fillSec })
}
CONFIGS.push({ name: 'quorum .5/60ms', quorum: { minFraction: 0.5, windowSec: 0.06 } })
CONFIGS.push({ name: 'quorum .75/60ms', quorum: { minFraction: 0.75, windowSec: 0.06 } })
for (const smoothFrames of [2, 6, 8]) {
    CONFIGS.push({ name: `smooth${smoothFrames}`, seg: { smoothFrames } })
}
CONFIGS.push({ name: 'floor 60ms', seg: { minFramesPerNote: 3 }, voiceMinNoteSec: 0.06 })
CONFIGS.push({ name: 'floor 120ms', seg: { minFramesPerNote: 6 }, voiceMinNoteSec: 0.12 })
for (const changeCost of [1.5, 4]) {
    CONFIGS.push({ name: `v.changeCost${changeCost}`, voice: { changeCost } })
}
for (const trust of [0.4, 1.0]) {
    CONFIGS.push({ name: `v.trust${trust}`, voice: { trust } })
}
for (const onsetShiftSec of [0.05, 0.09]) {
    CONFIGS.push({ name: `v.shift${onsetShiftSec * 1000}ms`, voice: { onsetShiftSec } })
}
for (const evidenceDiscount of [0.2, 0.5]) {
    CONFIGS.push({ name: `v.eviDisc${evidenceDiscount}`, voice: { evidenceDiscount } })
}
CONFIGS.push({ name: 'v.lq.3@.35s', voice: { dropLongQuiet: { minSec: 0.35, quietRatio: 0.3 } } })
CONFIGS.push({ name: 'adaptFloor0', cleanup: { adaptiveFloorFraction: 0 } })
CONFIGS.push({ name: 'adaptFloor.5', cleanup: { adaptiveFloorFraction: 0.5 } })
CONFIGS.push({ name: 'no-onsetSplit', noOnsetSplit: true })
// The very-high band's split question (2026-08-22): whistled/piccolo sustains
// fragment (dogfood 89–102 splits/100). On this band's 10 ms-hop cached track a
// raw count of 8 = 80 ms real = today's production; sweep both directions plus
// the two other semitone-path knobs. Read the very-high strata; the at-pitch
// strata replicate known rows.
for (const smoothFrames of [12, 16]) {
    CONFIGS.push({ name: `w.smooth${smoothFrames}`, seg: { smoothFrames } })
}
for (const minFramesPerNote of [12, 16]) {
    CONFIGS.push({ name: `w.floor${minFramesPerNote}f`, seg: { minFramesPerNote } })
}
for (const pitchBinToleranceCents of [80, 120]) {
    CONFIGS.push({ name: `w.binTol${pitchBinToleranceCents}`, seg: { pitchBinToleranceCents } })
}
CONFIGS.push({ name: 'w.vibrato.25', cleanup: { vibratoMaxSec: 0.25 } })

/** Band anchor = profile id with adaptation suffixes stripped. */
function baseBand(profileId: string): string {
    return profileId.split('+')[0]
}

/**
 * BAND_STRATA picks the confound to inspect:
 *  - 'band' (default): band × path — the headline question.
 *  - 'band-rev': band × reverb-flag (voice only) — is a "band" effect actually
 *    riding on the reverb-relaxed gate that false-fires on sustained singing?
 *  - 'ds-band': dataset × band (voice only) — does the band split hold WITHIN
 *    datasets (register effect) or only across them (material effect)?
 */
const STRATA_MODE = process.env.BAND_STRATA ?? 'band'

function stratumOf(c: CachedClip): string {
    const band = baseBand(c.profile.id)
    const path = c.profile.isVoice ? 'voice' : 'instr'
    if (STRATA_MODE === 'band-rev') {
        return `${band}/${path}/${c.profile.id.includes('+reverb') ? 'rev' : 'dry'}`
    }
    if (STRATA_MODE === 'ds-band') return `${c.dataset}/${band}`
    return `${band}/${path}`
}

function toEst(notes: { startTimeSeconds: number; durationSeconds: number; pitchMidi: number }[]): EstNote[] {
    return notes.map((n) => ({
        onsetSec: n.startTimeSeconds,
        durSec: n.durationSeconds,
        midi: n.pitchMidi,
    }))
}

function mean(xs: number[]): number {
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0
}

/** Demote-only quorum over the raw voiced mask, as a confidence-zeroing map. */
function applyQuorum(
    c: CachedClip,
    track: { cents: Float32Array; confidence: Float32Array; frames: number; hopSec: number },
    gate: { confidenceThreshold: number; minFreqHz: number; maxFreqHz: number },
    q: { minFraction: number; windowSec: number },
): Float32Array {
    const lo = 6900 + 1200 * Math.log2(gate.minFreqHz / 440)
    const hi = 6900 + 1200 * Math.log2(gate.maxFreqHz / 440)
    const raw = new Uint8Array(track.frames)
    for (let i = 0; i < track.frames; i += 1) {
        raw[i] = track.confidence[i] >= gate.confidenceThreshold && track.cents[i] >= lo && track.cents[i] <= hi ? 1 : 0
    }
    const half = Math.max(1, Math.round(q.windowSec / track.hopSec / 2))
    const conf = track.confidence.slice()
    for (let i = 0; i < track.frames; i += 1) {
        if (!raw[i]) continue
        const from = Math.max(0, i - half)
        const to = Math.min(track.frames, i + half + 1)
        let voted = 0
        for (let j = from; j < to; j += 1) voted += raw[j]
        if (voted / (to - from) < q.minFraction) conf[i] = 0
    }
    return conf
}

/** Production segmentation + cleanup with this config's overrides applied. */
function run(c: CachedClip, cfg: Config): EstNote[] {
    const gate = {
        confidenceThreshold: Math.min(0.95, Math.max(0.05, (c.profile.confidenceThreshold ?? 0.5) + (cfg.gateDelta ?? 0))),
        minFreqHz: c.profile.minFreqHz,
        maxFreqHz: c.profile.maxFreqHz,
    }
    let track = c.track
    if (cfg.fillSec !== undefined) {
        track = track.fillDropouts({
            ...gate,
            maxGapFrames: Math.max(1, Math.round(cfg.fillSec / track.hopSec)),
        })
    }
    let confidence = track.confidence
    if (cfg.quorum && !c.profile.isVoice) {
        confidence = applyQuorum(c, track, gate, cfg.quorum)
    }

    let raw
    if (c.profile.isVoice) {
        raw = new VoiceNoteDecoder({
            ...VOICE_OPTS,
            ...gate,
            minNoteSec: cfg.voiceMinNoteSec ?? frameCount(c, c.profile.minFramesPerNote) * track.hopSec,
            ...(cfg.quorum ? { voicedQuorum: cfg.quorum } : {}),
            ...cfg.voice,
        }).decode(track, c.energy)
    } else {
        raw = segmentNotes(track.cents, confidence, track.frames, {
            hopSize: 1,
            sampleRate: 1 / track.hopSec,
            ...gate,
            minFramesPerNote: cfg.seg?.minFramesPerNote ?? frameCount(c, c.profile.minFramesPerNote),
            pitchBinToleranceCents: cfg.seg?.pitchBinToleranceCents ?? 50,
            mode: c.profile.segmentMode === 'median' ? 'median' : 'semitone',
            smoothFrames: cfg.seg?.smoothFrames ?? frameCount(c, c.profile.smoothFrames),
        })
    }

    // Production cleanup set for the clip's path (decodeCached.cleanupAsProduction).
    const cleanupBase: NoteExtractorOptions = c.profile.isVoice
        ? {
              maxGridDivisor: 4,
              adaptiveFloorFraction: 0.3,
              steps: { pitchOutliers: false, merge: false, transients: false, monophonic: false },
          }
        : {
              maxGridDivisor: 4,
              steps: { pitchOutliers: false, merge: false },
              adaptiveFloorFraction: 0.3,
          }
    const cleanup: NoteExtractorOptions = {
        ...cleanupBase,
        ...cfg.cleanup,
        steps: {
            ...cleanupBase.steps,
            ...(cfg.cleanup?.steps ?? {}),
            ...(cfg.noOnsetSplit ? { onsetSplit: false } : {}),
        },
    }
    const cleaned = new NoteExtractor(cleanup).clean(raw, {
        bpm: 120,
        onsetTimesSec: c.onsetTimesSec,
    })
    return toEst(cleaned)
}

async function main(): Promise<void> {
    const registry = new (await import('../../src/recordings/pipeline/providers/provider-registry')).ProviderRegistry(MODELS)
    await registry.initAll()
    const cache = new TrackCache(registry, CACHE_ROOT)
    const split = splitFromEnv()
    const only = process.env.SWEEP_ONLY

    // SWEEP_INCLUDE opts normally-excluded datasets back in BY NAME — for
    // diagnosis passes on derived-truth or constructed corpora (e.g. the whistle
    // datasets, whose draft labels are fine for reading split/merge mechanics
    // and useless as a tuning gate). Nothing it names enters a pooled headline.
    const included = new Set(
        (process.env.SWEEP_INCLUDE ?? '')
            .split(',')
            .map((x) => x.trim())
            .filter(Boolean),
    )
    const excludedDatasets = new Set(
        discoverRealDatasets(REAL_ROOT)
            .filter(
                (d) =>
                    d.noteTruthDerived ||
                    d.pitchless ||
                    // Real timbre, spliced phrasing (tinysol-*): exact truth, but tuning
                    // against a performance we assembled would tune against our splice.
                    d.constructedPerformance ||
                    d.corpusSplit === 'test',
            )
            .filter((d) => !included.has(d.id))
            .map((d) => d.id),
    )

    const clips: CachedClip[] = []
    for (const ds of discoverRealDatasets(REAL_ROOT)) {
        if (excludedDatasets.has(ds.id)) continue
        for (const clip of listRealClips(ds.dir)) {
            if (!inSplit(ds.id, clip, split)) continue
            let c: CachedClip | null = null
            try {
                c = await cache.load(ds, clip)
            } catch {
                c = null
            }
            if (c) clips.push(c)
        }
    }

    const strata = [...new Set(clips.map(stratumOf))].sort()
    console.log(`split=${split} clips=${clips.length}`)
    console.log(
        'strata: ' +
            strata
                .map((s) => {
                    const inS = clips.filter((c) => stratumOf(c) === s)
                    const reverb = inS.filter((c) => c.profile.id.includes('+reverb')).length
                    return `${s}:${inS.length} (${reverb}rev)`
                })
                .join('  '),
    )

    // Comma-separated any-of match, so one run can carry a hand-picked set.
    const onlyParts = only
        ?.split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    const selected = CONFIGS.filter((c) => c.name === 'SHIPPED' || !onlyParts || onlyParts.some((p) => c.name.includes(p)))

    // config → per-clip F1 in clip order.
    const perClip = new Map<string, number[]>()
    for (const cfg of selected) {
        const f1s: number[] = []
        for (const c of clips) {
            let est: EstNote[] = []
            try {
                est = run(c, cfg)
            } catch {
                // score 0 rather than aborting the sweep
            }
            f1s.push(scoreNotesBest(c.truth, est, { onsetTolSec: 0.1, timingTolSec: 0.3 }).f1)
        }
        perClip.set(cfg.name, f1s)
        console.log(`  ran ${cfg.name}`)
    }

    const base = perClip.get('SHIPPED')!
    console.log('\n--- baseline (SHIPPED) mean COnP@0.1 per stratum ---')
    for (const s of strata) {
        const idx = clips.map((c, i) => (stratumOf(c) === s ? i : -1)).filter((i) => i >= 0)
        console.log(`${s.padEnd(14)} ${mean(idx.map((i) => base[i])).toFixed(3)}  (n=${idx.length})`)
    }

    console.log('\n--- paired Δ vs SHIPPED per band × path (* = 95% CI excludes 0) ---')
    for (const cfg of selected) {
        if (cfg.name === 'SHIPPED') continue
        const f1s = perClip.get(cfg.name)!
        const parts: string[] = []
        for (const s of strata) {
            const idx = clips.map((c, i) => (stratumOf(c) === s ? i : -1)).filter((i) => i >= 0)
            if (idx.length < 8) {
                parts.push(`${s}: n<8`)
                continue
            }
            const cmp = pairedDiffCI(
                idx.map((i) => base[i]),
                idx.map((i) => f1s[i]),
            )
            parts.push(`${s}: ${formatComparison(cmp)}`)
        }
        console.log(`\n${cfg.name}`)
        for (const p of parts) console.log(`   ${p}`)
        const all = pairedDiffCI(base, f1s)
        console.log(`   ALL: ${formatComparison(all)}`)
    }
}

main().catch((err) => {
    console.error(err)
    process.exit(1)
})
