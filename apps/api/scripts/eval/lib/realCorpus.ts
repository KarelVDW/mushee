/**
 * Discovery for the REAL recorded corpus under scripts/fixtures/eval-real.
 *
 * The corpus is TIERED at the directory level (see scripts/eval/CORPORA.md,
 * the corpus register):
 *
 *   eval-real/benchmark/<dataset>/   numbers may gate decisions — human/expert
 *                                    truth on at least one axis, real human
 *                                    performance, permissive licence
 *   eval-real/context/<dataset>/     kept for realism checks, register coverage
 *                                    and diagnostics — derived/unverified truth,
 *                                    constructed performance, or a licence that
 *                                    bars product-relevant use; NEVER gates
 *
 * The tier is PLACEMENT AND DOCUMENTATION, not mechanism: what actually keeps a
 * dataset out of pooled numbers are the per-dataset flags below — the rule is
 * `isPooled()` (`noteTruthDerived`, `pitchless`, `constructedPerformance`,
 * `licenceRestricted`, and the explicit `pooled: false` opt-out), exactly as
 * before the tiering existed. A dataset can sit in `benchmark/` and
 * still carry `noteTruthDerived` (dagstuhl-choir: its hand-tapped beat grid is
 * the benchmark axis, its DTW-aligned notes are not). Changing a dataset's tier
 * therefore never changes a measured number — it changes where humans and
 * fetchers look for it.
 *
 * Each dataset dir holds pre-recorded clips carrying their own ground truth
 * (`<clip>.truth.json` + `<clip>__real.wav`), built by a fetch-*.ts script. An
 * optional `dataset.json` manifest supplies the display label, source kind, and
 * adaptive instrument hint. Shared by run-eval.ts (batch scoring) and
 * probe-realpath.ts (full streaming pipeline) so both agree on the on-disk
 * layout. Datasets found flat at the eval-real root (the pre-2026-08 layout)
 * are still discovered, with a tier inferred from their flags — re-running the
 * dataset's fetcher migrates it.
 */

import { createHash } from 'crypto'
import { existsSync, readdirSync, readFileSync } from 'fs'
import { join } from 'path'

import type { SourceKind } from '../types'

export type CorpusTier = 'benchmark' | 'context' | 'synthetic'

/**
 * What a human would say is being recorded — the axis the product's benchmark
 * (benchmark.ts) groups by. Coarser than `instrumentId`, finer than `kind`:
 * `kind: 'voice'` covers singing, humming AND vocal percussion, which are three
 * different products for the user. Declared as `material` in dataset.json;
 * falls back to a derivation from `kind` for manifests that predate it.
 */
export type Material = 'singing' | 'humming' | 'whistling' | 'instrument' | 'vocal-percussion'

/**
 * Where a dataset's note truth came from — reported beside every number, and the
 * axis of the benchmark's second headline (human truth only, the one continuous
 * with the history before resynthesised truth existed):
 *
 *   human        annotated by people (the corpus's own labels, or our verified ones)
 *   resynth      read from a synthetic copy iterated until it matches the original
 *                (synthetic-corpus/RESYNTH.md) — benchmark-grade once calibrated
 *   derived      machine-derived and unverified (frame pitch, score alignment, drafts)
 *   constructed  exact because we built the performance (TinySOL splices, rendered corpora)
 *   onsets       onset times only, no pitch (`pitchless`)
 *
 * Declared as `truthSource` in dataset.json; inferred from the older flags when absent.
 */
export type TruthSource = 'human' | 'resynth' | 'derived' | 'constructed' | 'onsets'

const TRUTH_SOURCES: TruthSource[] = ['human', 'resynth', 'derived', 'constructed', 'onsets']

export interface RealDataset {
    id: string
    dir: string
    label: string
    kind: SourceKind
    material: Material
    instrumentId?: string
    /** Licence as recorded by the fetcher (e.g. `CC-BY-4.0`, `CC-BY-NC-4.0`). */
    license?: string
    /**
     * The licence permits our internal evaluation but not redistribution or
     * product incorporation (NC / research-only terms). Adopted under the
     * product owner's 2026-09-01 standard — "defensible use, we redistribute
     * nothing" — and shown as such wherever the dataset's numbers appear. Never a
     * benchmark-tier dataset: numbers from it stay context-only.
     */
    licenceRestricted?: boolean
    /**
     * `<tier>/<id>` of the dataset this one was derived from by
     * `fetch/align-prescribed-truth.ts`. The source keeps the score's timing as
     * its truth (known-wrong on purpose — it exists to be repaired), so wherever a
     * derived sibling is present the source must not stand in for the material's
     * number (the benchmark's provisional rows skip it).
     */
    derivedFrom?: string
    /** Which tier directory the dataset lives in — see the module doc above. */
    tier: CorpusTier
    /**
     * Which half of the SOURCE corpus's own published split these clips are —
     * 'test' marks a held-out external yardstick (e.g. n20emv2-test) that must
     * never be swept against: its only value is confirming a decision already
     * made, and tuning on it destroys that.
     */
    corpusSplit?: string
    /**
     * The dataset ships no note events: its `notes` were *derived* from a
     * frame-level pitch annotation by rounding to semitones and grouping runs
     * (mir-qbsh). That is the same algorithm family as our own segmenter, so
     * note-level scores there reward reproducing our own artefact — a better
     * segmenter measures *worse*. Consumers should exclude such datasets from
     * note-F1 aggregates (run-eval.ts does by default; EVAL_INCLUDE_UNTRUSTED=1
     * opts back in) while still using the audio for f0 / melody metrics and
     * realism checks. Declared by `noteTruthDerived` in the dataset's
     * dataset.json so filtering is a property, never a hard-coded dataset name.
     */
    noteTruthDerived?: boolean
    /**
     * The dataset carries no pitch information at all — only onset timestamps
     * (e.g. AVP's vocal-percussion CSVs: onset + drum-class label, no MIDI).
     * `TruthNote.midi` is filled with a placeholder so the type still holds,
     * but note-F1/chroma/octave-error and the onset-class taxonomy (which all
     * assume real pitch) are meaningless for these clips and must stay out of
     * the pooled aggregates. The clip's onset-only score (MIREX COn, pitch
     * ignored) is the number that means something — see `scoreOnsets` in
     * lib/metrics.ts and its use in run-eval.ts. Declared by `pitchless` in the
     * dataset's dataset.json.
     */
    pitchless?: boolean
    /**
     * The AUDIO is real recorded instrument tone, but the PERFORMANCE was
     * assembled by us: isolated single notes spliced into a melody (TinySOL). The
     * truth is therefore exact rather than annotated — we placed every onset — so
     * this is the opposite failure mode from `noteTruthDerived`: nothing about the
     * labels is untrustworthy, but nothing about the phrasing is human either.
     * There is no performer timing, no legato shaping and no expressive rubato, so
     * pooling these clips into the real corpus's headline would make it easier for
     * a reason that has nothing to do with the pipeline. They are kept out of the
     * pooled aggregate and reported on their own, which is what they are for:
     * answering register questions (the `very-high` band has no other real
     * pitched audio at all) without moving a number anyone compares over time.
     * Declared by `constructedPerformance` in dataset.json.
     */
    constructedPerformance?: boolean
    /** See `TruthSource`. Always set: declared in dataset.json or inferred (`inferTruthSource`). */
    truthSource: TruthSource
    /**
     * Explicit opt-out from every pooled aggregate (`"pooled": false` in
     * dataset.json) for a set whose truth is fine but whose audio is not the
     * product's input — whistle-vintage: accompanied 78 rpm transfers. Absent means
     * the flags above decide alone.
     */
    pooled?: boolean
    /**
     * Version of the generated corpus the clips came from (the realistic synthetic
     * export writes it), recorded in benchmark provenance. Absent for real corpora.
     */
    corpusVersion?: string
}

/**
 * The truth source a manifest without `truthSource` implies. The rendered
 * synthetic corpora carry none of the flags but are constructed all the same.
 */
export function inferTruthSource(d: {
    noteTruthDerived?: boolean
    constructedPerformance?: boolean
    pitchless?: boolean
    tier?: CorpusTier
}): TruthSource {
    if (d.noteTruthDerived) return 'derived'
    if (d.constructedPerformance) return 'constructed'
    if (d.pitchless) return 'onsets'
    if (d.tier === 'synthetic') return 'constructed'
    return 'human'
}

/**
 * Whether a dataset enters the pooled aggregates (headline, per material, per
 * condition, `compare`). Restricted-licence sets stay out whatever the quality
 * of their truth (CORPORA.md, "Licence standard"); `pooled: false` is the
 * explicit opt-out. Everything else is reported per row only.
 */
export function isPooled(d: RealDataset): boolean {
    return !d.noteTruthDerived && !d.pitchless && !d.constructedPerformance && !d.licenceRestricted && d.pooled !== false
}

/**
 * What a run scored, in a form that changes when the truth does: the clip
 * count and a sha1 over every `<clip>.truth.json` in name order (name and
 * contents). Benchmark provenance stores it per dataset, so two results whose
 * numbers differ can be told apart from a truth change.
 */
export function truthFingerprint(dir: string): { clips: number; truthHash: string } {
    const files = readdirSync(dir)
        .filter((f) => f.endsWith('.truth.json'))
        .sort()
    const hash = createHash('sha1')
    for (const f of files)
        hash.update(`${f}\n`)
            .update(readFileSync(join(dir, f)))
            .update('\n')
    return { clips: files.length, truthHash: hash.digest('hex') }
}

const TIER_DIRS: CorpusTier[] = ['benchmark', 'context']

/** Fallback for manifests without `material`: the honest coarse reading of `kind`. */
function materialFromKind(kind: SourceKind): Material {
    if (kind === 'whistle') return 'whistling'
    if (kind === 'instrument') return 'instrument'
    return 'singing'
}

/** A dataset dir is one that actually holds scoreable clips. */
function isDatasetDir(dir: string): boolean {
    return existsSync(dir) && readdirSync(dir).some((f) => f.endsWith('.truth.json'))
}

function readDataset(dir: string, id: string, tier: CorpusTier | null): RealDataset {
    const manifestPath = join(dir, 'dataset.json')
    const m = existsSync(manifestPath) ? (JSON.parse(readFileSync(manifestPath, 'utf8')) as Partial<RealDataset>) : {}
    const noteTruthDerived = m.noteTruthDerived ?? false
    const constructedPerformance = m.constructedPerformance ?? false
    const pitchless = m.pitchless ?? false
    const kind = m.kind ?? 'voice'
    // Legacy flat layout: infer the tier from the flags that were always the
    // pooling mechanism, so an un-migrated checkout behaves identically.
    // A manifest may name its tier outright (the realistic synthetic corpus under
    // fixtures/eval-synth is flat and says `"tier": "synthetic"`).
    const resolvedTier = tier ?? m.tier ?? (noteTruthDerived || constructedPerformance ? 'context' : 'benchmark')
    if (m.truthSource !== undefined && !TRUTH_SOURCES.includes(m.truthSource)) {
        throw new Error(`${manifestPath}: truthSource must be one of ${TRUTH_SOURCES.join(', ')} (got ${String(m.truthSource)})`)
    }
    return {
        id,
        dir,
        label: m.label ?? id,
        kind,
        material: m.material ?? materialFromKind(kind),
        instrumentId: m.instrumentId,
        license: m.license,
        licenceRestricted: m.licenceRestricted ?? false,
        derivedFrom: m.derivedFrom,
        tier: resolvedTier,
        corpusSplit: m.corpusSplit,
        noteTruthDerived,
        pitchless,
        constructedPerformance,
        truthSource: m.truthSource ?? inferTruthSource({ noteTruthDerived, constructedPerformance, pitchless, tier: resolvedTier }),
        pooled: m.pooled,
        corpusVersion: m.corpusVersion === undefined ? undefined : String(m.corpusVersion),
    }
}

export function discoverRealDatasets(root: string): RealDataset[] {
    if (!existsSync(root)) return []
    const out: RealDataset[] = []
    for (const entry of readdirSync(root, { withFileTypes: true })) {
        // Dot-dirs are working state (e.g. import-note-labels.ts builds into one),
        // never datasets.
        if (!entry.isDirectory() || entry.name.startsWith('.')) continue
        const dir = join(root, entry.name)
        if ((TIER_DIRS as string[]).includes(entry.name)) {
            const tier = entry.name as CorpusTier
            for (const ds of readdirSync(dir, { withFileTypes: true })) {
                if (!ds.isDirectory()) continue
                const dsDir = join(dir, ds.name)
                if (isDatasetDir(dsDir)) out.push(readDataset(dsDir, ds.name, tier))
            }
        } else if (isDatasetDir(dir)) {
            out.push(readDataset(dir, entry.name, null))
        }
    }
    return out.sort((a, b) => a.id.localeCompare(b.id))
}

/** Clip base names in a dataset dir (each has `<clip>.truth.json` + `<clip>__real.wav`). */
export function listRealClips(dir: string): string[] {
    return readdirSync(dir)
        .filter((f) => f.endsWith('.truth.json'))
        .map((f) => f.replace('.truth.json', ''))
        .sort()
}
