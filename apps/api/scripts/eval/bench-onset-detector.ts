/**
 * The amplitude re-attack detector (`OnsetDetector`) scored in ISOLATION on real
 * human-placed onsets — the benchmark `run-eval.ts` cannot provide.
 *
 * Two corpora carry onset truth with no pitch anywhere in the chain (`pitchless`
 * in lib/realCorpus.ts): AVP (9.8k amateur vocal-percussion onsets) and JaCRC
 * (5.2k syllable onsets on melismatic singing). Through `run-eval` they score
 * ~0 because that path emits onsets only where CREPE finds a note — so AVP's
 * unpitched kicks and snares never reach the detector at all (the 2026-08-13
 * findings entry). This script reads the cached 10 ms envelope every clip
 * already carries (`TrackCache` v5+) and runs the detector over it directly, at
 * the shipping thresholds and over a small grid, so the detector's own
 * precision / recall on real onsets is finally a number.
 *
 * Read per corpus: AVP is the clean question (every truth onset is a real
 * re-attack the envelope should show); JaCRC's syllable onsets are a SUBSET of
 * note onsets, so there only recall is meaningful — precision is understated by
 * construction.
 *
 *   EVAL_SPLIT=dev|test|all npx tsx scripts/eval/bench-onset-detector.ts
 *   ONSET_TOL=0.05          match window in seconds (default 0.05 — MIREX COn)
 *   ONSET_DATASETS=avp,jacrc-students
 */

import { resolve } from 'path';

import { OnsetDetector, type OnsetDetectorOptions } from '../../src/recordings/pipeline/onset-detector';
import { ProviderRegistry } from '../../src/recordings/pipeline/providers/provider-registry';
import { type EstNote, scoreOnsets } from './lib/metrics';
import { discoverRealDatasets, listRealClips } from './lib/realCorpus';
import { inSplit, splitFromEnv } from './lib/split';
import { formatComparison, pairedDiffCI } from './lib/stats';
import { type CachedClip, TrackCache } from './lib/trackCache';

const REAL_ROOT = resolve(__dirname, '../fixtures/eval-real');
const CACHE_ROOT = resolve(__dirname, '../fixtures/eval-cache');
const MODELS = { crepeTiny: resolve(process.cwd(), 'model-crepe-tiny') };

const TOL = Number(process.env.ONSET_TOL) || 0.05;
const DATASETS = (process.env.ONSET_DATASETS ?? 'avp,jacrc-students').split(',');

interface Config {
  name: string;
  opts: OnsetDetectorOptions;
}

/** The shipping point first; then each knob moved one way and the other. */
const CONFIGS: Config[] = [
  { name: 'shipped (dip .5 rise 1.8)', opts: {} },
  { name: 'dip .35', opts: { dipRatio: 0.35 } },
  { name: 'dip .65', opts: { dipRatio: 0.65 } },
  { name: 'dip .8', opts: { dipRatio: 0.8 } },
  { name: 'rise 1.4', opts: { riseRatio: 1.4 } },
  { name: 'rise 2.5', opts: { riseRatio: 2.5 } },
  { name: 'dip .65 rise 1.4', opts: { dipRatio: 0.65, riseRatio: 1.4 } },
  { name: 'dip .8 rise 1.2', opts: { dipRatio: 0.8, riseRatio: 1.2 } },
  { name: 'minIoi 60ms', opts: { minIoiSec: 0.06 } },
  { name: 'minIoi 150ms', opts: { minIoiSec: 0.15 } },
  { name: 'trough 30ms', opts: { minTroughSec: 0.03 } },
  { name: 'adaptive w300 k1', opts: { adaptiveThreshold: { windowSec: 0.3, k: 1 } } },
];

function onsetsAsNotes(times: number[]): EstNote[] {
  return times.map((t) => ({ onsetSec: t, durSec: 0.05, midi: 0 }));
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

async function main(): Promise<void> {
  const registry = new ProviderRegistry(MODELS);
  await registry.initAll();
  const cache = new TrackCache(registry, CACHE_ROOT);
  const split = splitFromEnv();
  const datasets = discoverRealDatasets(REAL_ROOT).filter((d) => DATASETS.includes(d.id));
  if (!datasets.length) throw new Error(`no datasets matched ${DATASETS.join(',')}`);

  console.log(`onset detector in isolation — tol ±${(TOL * 1000).toFixed(0)} ms, split=${split}\n`);

  for (const ds of datasets) {
    const clips: CachedClip[] = [];
    for (const clip of listRealClips(ds.dir)) {
      if (!inSplit(ds.id, clip, split)) continue;
      const c = await cache.load(ds, clip);
      if (c) clips.push(c);
    }
    if (!clips.length) continue;
    const truthOnsets = clips.reduce((s, c) => s + c.truth.notes.length, 0);
    console.log(
      `=== ${ds.id} — ${clips.length} clips, ${truthOnsets} truth onsets` +
        `${ds.id === 'jacrc-students' ? ' (syllable onsets ⊂ note onsets: read RECALL)' : ''}`,
    );
    console.log(
      'config'.padEnd(26) + 'P'.padEnd(8) + 'R'.padEnd(8) + 'F1'.padEnd(8) + 'est/clip'.padEnd(10) +
        'ΔF1 vs shipped (paired over clips)',
    );

    let shippedF1: number[] = [];
    for (const cfg of CONFIGS) {
      const detector = new OnsetDetector(cfg.opts);
      const p: number[] = [];
      const r: number[] = [];
      const f1: number[] = [];
      const counts: number[] = [];
      for (const c of clips) {
        const sr = 1 / c.fineHopSec; // detectFromEnvelope wants hop in samples of some rate
        const times = detector.detectFromEnvelope(c.fineEnergy, 1, sr);
        const m = scoreOnsets(c.truth.notes, onsetsAsNotes(times), TOL);
        p.push(m.precision);
        r.push(m.recall);
        f1.push(m.f1);
        counts.push(times.length);
      }
      if (cfg === CONFIGS[0]) shippedF1 = f1;
      console.log(
        cfg.name.padEnd(26) + mean(p).toFixed(3).padEnd(8) + mean(r).toFixed(3).padEnd(8) +
          mean(f1).toFixed(3).padEnd(8) + mean(counts).toFixed(1).padEnd(10) +
          (cfg === CONFIGS[0] ? '—' : formatComparison(pairedDiffCI(shippedF1, f1))),
      );
    }
    console.log('');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
