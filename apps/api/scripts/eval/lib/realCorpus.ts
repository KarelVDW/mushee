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
