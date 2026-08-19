/**
 * What would the no-reliable-pitch DEFAULT_PROFILE cost on CREPE instead of
 * basic-pitch?
 *
 * The provider-consolidation question's second half. `probe-provider-routing.ts`
 * measured where the default fires at all: on the real corpus it is 188
 * heavy-reverb annotated-vocalset variants (echoey-room / distant-mic defeats
 * the pitch scan) plus AVP vocal percussion (pitchless — excluded here); on the
 * synthetic corpus, 60 degraded variants whose lead-in the scan cannot lock
 * (one melody per voice scenario × 6 conditions, plus one whistle melody × 6).
 *
 * Every clip is re-resolved exactly as production would (same hints as the
 * harness), asserted to route default-wide, then scored under:
 *
 *   A `bp default (ships)`  the resolved profile as-is (basic-pitch, 55–2200)
 *   B `crepe default`       provider → crepe-tiny, gate 0.5, window capped at
 *                           the 1.9 kHz ceiling, voice overlay applied where the
 *                           resolver believed voice (as `applyVoice` would on a
 *                           trajectory default)
 *   C `crepe default+ramp`  B with the reverberance relief on the gate — the
 *                           fallback path never gets `applyReverb` today only
 *                           because basic-pitch has no gate to relax
 *   D `pitchdown default`   provider → octave-down CREPE (hears 65–3900 Hz,
 *                           wider than the shipping default's 55–2200 except
 *                           for an empty 55–65 Hz sliver), no voice overlay
 *
 * Run: pnpm --filter @mushee/api exec tsx scripts/eval/bench-default-provider.ts
 * (requires fixtures/provider-routing.json from probe-provider-routing.ts)
 */

import { readFileSync } from 'fs';
import { join, resolve } from 'path';

import { AudioConverter } from '../../src/recordings/pipeline/audio-converter';
import { AudioDecoder } from '../../src/recordings/pipeline/audio-decoder';
import type { PipelineProfile } from '../../src/recordings/pipeline/profiles/pipeline-profile';
import {
  estimateReverberance,
  ProfileResolver,
} from '../../src/recordings/pipeline/profiles/profile-resolver';
import { ProviderRegistry } from '../../src/recordings/pipeline/providers/provider-registry';
import { type EstNote, scoreNotesBest } from './lib/metrics';
import { discoverRealDatasets } from './lib/realCorpus';
import { formatComparison, pairedDiffCI } from './lib/stats';
import { SCENARIOS } from './scenarios';
import type { GroundTruth } from './types';

const REAL_ROOT = resolve(__dirname, '../fixtures/eval-real');
const SYNTH_ROOT = resolve(__dirname, '../fixtures/eval');
const ROUTING = resolve(__dirname, '../fixtures/provider-routing.json');
const MODELS = {
  basicPitch: resolve(process.cwd(), 'model'),
  crepeTiny: resolve(process.cwd(), 'model-crepe-tiny'),
};
const DETECT_SR = 16000;
const CREPE_CEILING_HZ = 1900;

interface Routed {
  corpus: 'real' | 'synth';
  dataset: string;
  clip: string;
  condition: string;
  profileId: string;
  provider: string;
}

type ConfigName =
  | 'bp default (ships)'
  | 'crepe default'
  | 'crepe default+ramp'
  | 'pitchdown default';
const CONFIG_NAMES: ConfigName[] = [
  'bp default (ships)',
  'crepe default',
  'crepe default+ramp',
  'pitchdown default',
];

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

async function main(): Promise<void> {
  const { routed } = JSON.parse(readFileSync(ROUTING, 'utf8')) as {
    routed: Routed[];
  };
  const targets = routed.filter(
    (r) => r.profileId.startsWith('default-wide') && r.dataset !== 'avp',
  );
  console.log(`default-wide routings to score: ${targets.length}`);

  const registry = new ProviderRegistry(MODELS);
  await registry.initAll();
  const decoder = new AudioDecoder();
  const resolver = new ProfileResolver();
  const realDatasets = new Map(discoverRealDatasets(REAL_ROOT).map((d) => [d.id, d]));
  const scenarios = new Map(SCENARIOS.map((s) => [s.id, s]));

  const f1s = new Map<ConfigName, number[]>(CONFIG_NAMES.map((n) => [n, []]));
  const strataOf: string[] = [];

  for (const r of targets) {
    const dir =
      r.corpus === 'real'
        ? realDatasets.get(r.dataset)?.dir
        : join(SYNTH_ROOT, r.dataset);
    if (!dir) continue;
    const wav = join(dir, `${r.clip}__${r.condition}.wav`);
    const truth = JSON.parse(
      readFileSync(join(dir, `${r.clip}.truth.json`), 'utf8'),
    ) as GroundTruth;
    const hint =
      r.corpus === 'real'
        ? {
            instrumentId: realDatasets.get(r.dataset)?.instrumentId,
            sourceKind: (realDatasets.get(r.dataset)?.kind === 'voice'
              ? 'voice'
              : 'instrument') as 'voice' | 'instrument',
          }
        : {
            instrumentId: scenarios.get(r.dataset)?.instrumentId,
            sourceKind: (scenarios.get(r.dataset)?.kind === 'voice'
              ? 'voice'
              : 'instrument') as 'voice' | 'instrument',
          };

    const buf = readFileSync(wav);
    const det = await decoder.decode(buf, DETECT_SR, {
      loudnorm: false,
      highpassHz: 30,
    });
    const profile = resolver.resolve(det.samples, DETECT_SR, hint);
    if (!profile.id.startsWith('default-wide')) {
      console.warn(`  ! ${r.dataset}/${r.clip}__${r.condition}: resolved ${profile.id}, skipped`);
      continue;
    }
    const reverberance = estimateReverberance(det.samples, DETECT_SR);
    const isVoice = profile.sourceBelief === 'voice';

    const variants: Array<[ConfigName, PipelineProfile]> = [
      ['bp default (ships)', profile],
      [
        'crepe default',
        {
          ...profile,
          providerName: 'crepe-tiny',
          confidenceThreshold: 0.5,
          onsetThreshold: undefined,
          frameThreshold: undefined,
          maxFreqHz: Math.min(profile.maxFreqHz, CREPE_CEILING_HZ),
          ...(isVoice ? { segmentMode: 'voice' as const, isVoice: true } : {}),
        },
      ],
      [
        'crepe default+ramp',
        {
          ...profile,
          providerName: 'crepe-tiny',
          confidenceThreshold: Math.max(0.25, 0.5 - 0.25 * reverberance),
          onsetThreshold: undefined,
          frameThreshold: undefined,
          maxFreqHz: Math.min(profile.maxFreqHz, CREPE_CEILING_HZ),
          ...(isVoice ? { segmentMode: 'voice' as const, isVoice: true } : {}),
        },
      ],
      [
        'pitchdown default',
        {
          ...profile,
          providerName: 'crepe-tiny-down1',
          confidenceThreshold: 0.5,
          onsetThreshold: undefined,
          frameThreshold: undefined,
          maxFreqHz: Math.min(profile.maxFreqHz, CREPE_CEILING_HZ * 2),
        },
      ],
    ];

    for (const [name, p] of variants) {
      let est: EstNote[] = [];
      try {
        const provider = registry.get(p.providerName);
        const decoded = await decoder.decode(buf, provider.sampleRate, {
          loudnorm: provider.normalizeLoudness,
          highpassHz: p.highpassHz,
        });
        const extracted = await new AudioConverter(provider, { profile: p }).convert(
          decoded.samples,
          { bpm: truth.bpm },
          undefined,
          {
            minFreqHz: p.minFreqHz,
            maxFreqHz: p.maxFreqHz,
            confidenceThreshold: p.confidenceThreshold,
            onsetThreshold: p.onsetThreshold,
            frameThreshold: p.frameThreshold,
            segmentMode: p.segmentMode,
          },
        );
        est = extracted.deduced.map((n) => ({
          onsetSec: n.startTimeSeconds,
          durSec: n.durationSeconds,
          midi: n.pitchMidi,
        }));
      } catch (err) {
        console.warn(`  ! ${r.dataset}/${r.clip}__${r.condition} [${name}]: ${String(err)}`);
      }
      f1s
        .get(name)!
        .push(scoreNotesBest(truth, est, { onsetTolSec: 0.1, timingTolSec: 0.3 }).f1);
    }
    strataOf.push(
      r.corpus === 'real'
        ? `real/${r.dataset}`
        : `synth/${scenarios.get(r.dataset)?.kind ?? '?'}`,
    );
    if (strataOf.length % 25 === 0) console.log(`  …${strataOf.length}/${targets.length}`);
  }

  const strata = [...new Set(strataOf)].sort();
  console.log('\n--- mean COnP@0.1 per stratum ---');
  console.log(
    'config'.padEnd(22) + strata.map((s) => s.padEnd(26)).join('') + 'ALL',
  );
  for (const name of CONFIG_NAMES) {
    const xs = f1s.get(name)!;
    console.log(
      name.padEnd(22) +
        strata
          .map((s) => {
            const idx = strataOf.map((x, i) => (x === s ? i : -1)).filter((i) => i >= 0);
            return `${mean(idx.map((i) => xs[i])).toFixed(3)} (n=${idx.length})`.padEnd(26);
          })
          .join('') +
        mean(xs).toFixed(3),
    );
  }

  const base = f1s.get('bp default (ships)')!;
  console.log('\n--- vs bp default, paired bootstrap over clips (* = CI excludes 0) ---');
  for (const name of CONFIG_NAMES) {
    if (name === 'bp default (ships)') continue;
    for (const s of ['ALL', ...strata]) {
      const idx =
        s === 'ALL'
          ? base.map((_, i) => i)
          : strataOf.map((x, i) => (x === s ? i : -1)).filter((i) => i >= 0);
      if (idx.length < 8) continue;
      const cmp = pairedDiffCI(idx.map((i) => base[i]), idx.map((i) => f1s.get(name)![i]));
      console.log(`${name.padEnd(22)} ${s.padEnd(26)} ${formatComparison(cmp)}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
