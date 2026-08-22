/**
 * Census of WHERE the profile resolver actually sends traffic — per provider,
 * per band, per condition — over the real corpus (every `__real.wav` plus the
 * degraded variants) and the synthetic corpus.
 *
 * Motivation (2026-08 provider-consolidation question): basic-pitch is carried
 * as a second inference service for exactly two routes — the `very-high` band
 * (piccolo / whistling, above CREPE's ~1997 Hz ceiling) and the no-reliable-
 * pitch `DEFAULT_PROFILE` fallback. Before measuring what dropping it would
 * cost in accuracy, measure how often those routes fire at all. The eval cache
 * cannot answer this: `TrackCache` returns null for basic-pitch routings
 * (no trajectory to cache), but it is also built lazily by sweeps with dataset
 * exclusions, so a cache miss does not distinguish "routed to basic-pitch"
 * from "never loaded".
 *
 * Resolution follows the harness convention (TrackCache / run-eval adaptive):
 * decode the WHOLE clip at 16 kHz, resolve with the dataset's explicit
 * instrument + sourceKind hint. Production locks from a ~1.5 s prefix instead;
 * PROBE_PREFIX_SEC=1.5 reproduces that for comparison.
 *
 * Output: a per-dataset × condition tally on stdout, plus a JSON list of every
 * clip that resolved to basic-pitch (fixtures/provider-routing.json) so a
 * follow-up can score exactly those clips under a candidate replacement.
 *
 * Run: pnpm --filter @mushee/api exec tsx scripts/eval/probe-provider-routing.ts
 */

import { readdirSync, readFileSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';

import { AudioDecoder } from '../../src/recordings/pipeline/audio-decoder';
import { ProfileResolver } from '../../src/recordings/pipeline/profiles/profile-resolver';
import { discoverRealDatasets } from './lib/realCorpus';
import { SCENARIOS } from './scenarios';

const REAL_ROOT = resolve(__dirname, '../fixtures/eval-real');
const SYNTH_ROOT = resolve(__dirname, '../fixtures/eval');
const OUT_PATH = resolve(__dirname, '../fixtures/provider-routing.json');
const DETECT_SR = 16000;

/** Optional prefix cap, to reproduce production's profile lock (~1.5 s). */
const PREFIX_SEC = Number(process.env.PROBE_PREFIX_SEC) || 0;

interface Routed {
  corpus: 'real' | 'synth';
  dataset: string;
  clip: string;
  condition: string;
  profileId: string;
  provider: string;
}

/** Band anchor = profile id with the adaptation suffixes stripped. */
function baseBand(profileId: string): string {
  return profileId.split('+')[0];
}

async function main(): Promise<void> {
  const decoder = new AudioDecoder();
  const resolver = new ProfileResolver();
  const routed: Routed[] = [];

  const resolveOne = async (
    wavPath: string,
    hint: { instrumentId?: string; sourceKind: 'voice' | 'instrument' },
  ) => {
    const buf = readFileSync(wavPath);
    const det = await decoder.decode(buf, DETECT_SR, {
      loudnorm: false,
      highpassHz: 30,
    });
    const samples = PREFIX_SEC
      ? det.samples.subarray(0, Math.min(det.samples.length, Math.round(PREFIX_SEC * DETECT_SR)))
      : det.samples;
    return resolver.resolve(samples, DETECT_SR, hint);
  };

  // --- Real corpus: every wav variant of every clip. ---
  for (const ds of discoverRealDatasets(REAL_ROOT)) {
    const wavs = readdirSync(ds.dir).filter((f) => f.endsWith('.wav'));
    let done = 0;
    for (const wav of wavs) {
      const m = /^(.*)__([^_]+(?:-[^_]+)*)\.wav$/.exec(wav);
      if (!m) continue;
      const [, clip, condition] = m;
      try {
        const profile = await resolveOne(join(ds.dir, wav), {
          instrumentId: ds.instrumentId,
          sourceKind: ds.kind === 'voice' ? 'voice' : 'instrument',
        });
        routed.push({
          corpus: 'real',
          dataset: ds.id,
          clip,
          condition,
          profileId: profile.id,
          provider: profile.providerName,
        });
      } catch (err) {
        console.warn(`  ! ${ds.id}/${wav}: ${String(err)}`);
      }
      done += 1;
      if (done % 200 === 0) console.log(`  …${ds.id} ${done}/${wavs.length}`);
    }
    console.log(`${ds.id}: ${wavs.length} wavs resolved`);
  }

  // --- Synthetic corpus: scenario × melody × condition, run-eval's hints. ---
  for (const scenario of SCENARIOS) {
    const dir = join(SYNTH_ROOT, scenario.id);
    let wavs: string[] = [];
    try {
      wavs = readdirSync(dir).filter((f) => f.endsWith('.wav'));
    } catch {
      continue;
    }
    for (const wav of wavs) {
      const m = /^(.*)__(.+)\.wav$/.exec(wav);
      if (!m) continue;
      const [, clip, condition] = m;
      try {
        const profile = await resolveOne(join(dir, wav), {
          instrumentId: scenario.instrumentId,
          sourceKind: scenario.kind === 'voice' ? 'voice' : 'instrument',
        });
        routed.push({
          corpus: 'synth',
          dataset: scenario.id,
          clip,
          condition,
          profileId: profile.id,
          provider: profile.providerName,
        });
      } catch (err) {
        console.warn(`  ! ${scenario.id}/${wav}: ${String(err)}`);
      }
    }
    console.log(`${scenario.id}: ${wavs.length} wavs resolved`);
  }

  // --- Tallies. ---
  const tally = new Map<string, number>();
  for (const r of routed) {
    const key = `${r.corpus} ${r.provider} ${baseBand(r.profileId)}`;
    tally.set(key, (tally.get(key) ?? 0) + 1);
  }
  console.log('\n--- provider × band, per corpus ---');
  for (const [key, n] of [...tally.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`${key.padEnd(40)} ${n}`);
  }

  const bp = routed.filter((r) => r.provider === 'basic-pitch');
  console.log(`\nbasic-pitch routings: ${bp.length} of ${routed.length}`);
  const byDs = new Map<string, number>();
  for (const r of bp) {
    const key = `${r.corpus}/${r.dataset}/${r.condition}/${baseBand(r.profileId)}`;
    byDs.set(key, (byDs.get(key) ?? 0) + 1);
  }
  for (const [key, n] of [...byDs.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${key.padEnd(60)} ${n}`);
  }

  writeFileSync(OUT_PATH, JSON.stringify({ prefixSec: PREFIX_SEC, routed: bp }, null, 2));
  console.log(`\nbasic-pitch clip list written to ${OUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
