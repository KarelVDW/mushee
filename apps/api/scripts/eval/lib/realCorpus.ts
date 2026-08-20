/**
 * Discovery for the REAL recorded corpus under scripts/fixtures/eval-real.
 *
 * Each subdirectory is one dataset of pre-recorded clips that carry their own
 * ground truth (`<clip>.truth.json` + `<clip>__real.wav`), built by a
 * fetch-*.ts script. An optional `dataset.json` manifest supplies the display
 * label, source kind, and adaptive instrument hint. Shared by run-eval.ts
 * (batch scoring) and probe-realpath.ts (full streaming pipeline) so both agree
 * on the on-disk layout.
 */

import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';

import type { SourceKind } from '../types';

export interface RealDataset {
  id: string;
  dir: string;
  label: string;
  kind: SourceKind;
  instrumentId?: string;
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

export function discoverRealDatasets(root: string): RealDataset[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => {
      const dir = join(root, d.name);
      const manifestPath = join(dir, 'dataset.json');
      const m = existsSync(manifestPath)
        ? (JSON.parse(readFileSync(manifestPath, 'utf8')) as Partial<RealDataset>)
        : {};
      return {
        id: d.name,
        dir,
        label: m.label ?? d.name,
        kind: m.kind ?? 'voice',
        instrumentId: m.instrumentId,
        corpusSplit: m.corpusSplit,
        noteTruthDerived: m.noteTruthDerived ?? false,
        pitchless: m.pitchless ?? false,
        constructedPerformance: m.constructedPerformance ?? false,
      };
    });
}

/** Clip base names in a dataset dir (each has `<clip>.truth.json` + `<clip>__real.wav`). */
export function listRealClips(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.truth.json'))
    .map((f) => f.replace('.truth.json', ''))
    .sort();
}
