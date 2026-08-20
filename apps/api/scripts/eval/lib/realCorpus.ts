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
 * dataset out of pooled numbers are the per-dataset flags below
 * (`noteTruthDerived`, `constructedPerformance`, `pitchless`, `corpusSplit`),
 * exactly as before the tiering existed. A dataset can sit in `benchmark/` and
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

import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';

import type { SourceKind } from '../types';

export type CorpusTier = 'benchmark' | 'context';

export interface RealDataset {
  id: string;
  dir: string;
  label: string;
  kind: SourceKind;
  instrumentId?: string;
  /** Which tier directory the dataset lives in — see the module doc above. */
  tier: CorpusTier;
  /**
   * Which half of the SOURCE corpus's own published split these clips are —
   * 'test' marks a held-out external yardstick (e.g. n20emv2-test) that must
   * never be swept against: its only value is confirming a decision already
   * made, and tuning on it destroys that.
   */
  corpusSplit?: string;
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
  noteTruthDerived?: boolean;
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
  pitchless?: boolean;
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
  constructedPerformance?: boolean;
}

const TIER_DIRS: CorpusTier[] = ['benchmark', 'context'];

/** A dataset dir is one that actually holds scoreable clips. */
function isDatasetDir(dir: string): boolean {
  return existsSync(dir) && readdirSync(dir).some((f) => f.endsWith('.truth.json'));
}

function readDataset(dir: string, id: string, tier: CorpusTier | null): RealDataset {
  const manifestPath = join(dir, 'dataset.json');
  const m = existsSync(manifestPath)
    ? (JSON.parse(readFileSync(manifestPath, 'utf8')) as Partial<RealDataset>)
    : {};
  const noteTruthDerived = m.noteTruthDerived ?? false;
  const constructedPerformance = m.constructedPerformance ?? false;
  return {
    id,
    dir,
    label: m.label ?? id,
    kind: m.kind ?? 'voice',
    instrumentId: m.instrumentId,
    // Legacy flat layout: infer the tier from the flags that were always the
    // pooling mechanism, so an un-migrated checkout behaves identically.
    tier: tier ?? (noteTruthDerived || constructedPerformance ? 'context' : 'benchmark'),
    corpusSplit: m.corpusSplit,
    noteTruthDerived,
    pitchless: m.pitchless ?? false,
    constructedPerformance,
  };
}

export function discoverRealDatasets(root: string): RealDataset[] {
  if (!existsSync(root)) return [];
  const out: RealDataset[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    // Dot-dirs are working state (e.g. import-note-labels.ts builds into one),
    // never datasets.
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const dir = join(root, entry.name);
    if ((TIER_DIRS as string[]).includes(entry.name)) {
      const tier = entry.name as CorpusTier;
      for (const ds of readdirSync(dir, { withFileTypes: true })) {
        if (!ds.isDirectory()) continue;
        const dsDir = join(dir, ds.name);
        if (isDatasetDir(dsDir)) out.push(readDataset(dsDir, ds.name, tier));
      }
    } else if (isDatasetDir(dir)) {
      out.push(readDataset(dir, entry.name, null));
    }
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

/** Clip base names in a dataset dir (each has `<clip>.truth.json` + `<clip>__real.wav`). */
export function listRealClips(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.truth.json'))
    .map((f) => f.replace('.truth.json', ''))
    .sort();
}
