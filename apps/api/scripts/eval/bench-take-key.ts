/**
 * E8's instrument: is the take-key spelling fallback worth having ON THE PAGE?
 *
 * Runs the voice decode over the intonation tier (per-note detune, truth = the
 * notes the singer INTENDED) and spells each matched note two ways — today's
 * no-key fallback (offset-normalised rounding) vs the take-key fallback
 * (`estimateTakeKeyClasses` feeding the same `chooseNamingOffset`/`spellMidi`
 * machinery). Judged on the page per the metric conventions (seconds-based F1
 * cannot evaluate the notation stage):
 *
 *  - spelling error: onset-matched notes whose WRITTEN midi ≠ intended midi
 *  - accidentals per 100 written notes (the melodies are diatonic in the
 *    scenario key, so every accidental on the page is spurious)
 *  - the estimator's own behaviour: abstain rate, and whether the recovered
 *    key is the scenario's actual key
 *
 * The target slice — sung key ≠ score key — is the fallback case itself:
 * these takes carry no score key, which is exactly when the estimator runs.
 *
 * Run: pnpm --filter @mushee/api exec tsx scripts/eval/bench-take-key.ts
 */

import { existsSync, readdirSync, readFileSync } from 'fs';
import { join, resolve } from 'path';

import { AudioDecoder } from '../../src/recordings/pipeline/audio-decoder';
import type { CrepeProvider } from '../../src/recordings/pipeline/providers/crepe-provider';
import { ProviderRegistry } from '../../src/recordings/pipeline/providers/provider-registry';
import {
  chooseNamingOffset,
  estimateTakeKeyClasses,
  estimateTuningOffsetCents,
  type FractionalPitch,
  spellMidi,
} from '../../src/recordings/pipeline/voice-notation';
import { SCENARIOS } from './scenarios';
import type { GroundTruth } from './types';

const EVAL_ROOT = resolve(__dirname, '../fixtures/eval');
const MODELS = {
  basicPitch: resolve(process.cwd(), 'model'),
  crepeTiny: resolve(process.cwd(), 'model-crepe-tiny'),
};
const CONDITIONS = [
  'intonation-0c', 'intonation-20c', 'intonation-40c', 'intonation-60c', 'intonation-80c',
];

type Note = FractionalPitch & {
  startTimeSeconds: number;
  durationSeconds: number;
  pitchMidi: number;
};

/** Greedy 1–1 onset matching within ±100 ms, both lists in time order. */
function matchNotes(
  truth: { onsetSec: number; midi: number }[],
  est: Note[],
): Array<{ intended: number; est: Note }> {
  const used = new Set<number>();
  const pairs: Array<{ intended: number; est: Note }> = [];
  for (const t of truth) {
    let best = -1;
    let bestD = 0.1;
    for (let i = 0; i < est.length; i += 1) {
      if (used.has(i)) continue;
      const d = Math.abs(est[i].startTimeSeconds - t.onsetSec);
      if (d <= bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best >= 0) {
      used.add(best);
      pairs.push({ intended: t.midi, est: est[best] });
    }
  }
  return pairs;
}

async function main(): Promise<void> {
  const registry = new ProviderRegistry(MODELS);
  await registry.initAll();
  const provider = registry.get('crepe-tiny') as CrepeProvider;
  const decoder = new AudioDecoder();
  const scenarios = SCENARIOS.filter((s) => s.articulation !== undefined);

  interface Acc {
    matched: number;
    wrongOff: number;
    wrongKey: number;
    accOff: number;
    accKey: number;
    clips: number;
    abstain: number;
    keyRight: number;
  }
  const perCondition = new Map<string, Acc>();

  for (const s of scenarios) {
    const dir = join(EVAL_ROOT, s.id);
    if (!existsSync(dir)) continue;
    const trueKey = new Set(
      [0, 2, 4, 5, 7, 9, 11].map((d) => (s.rootMidi + d) % 12),
    );
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.truth.json')) continue;
      const melody = f.replace('.truth.json', '');
      const truth = JSON.parse(readFileSync(join(dir, f), 'utf8')) as GroundTruth;
      for (const cond of CONDITIONS) {
        const wavPath = join(dir, `${melody}__${cond}.wav`);
        if (!existsSync(wavPath)) continue;
        const decoded = await decoder.decode(readFileSync(wavPath), provider.sampleRate, {
          loudnorm: provider.normalizeLoudness,
          highpassHz: 70,
        });
        const notes = (await provider.transcribe(decoded.samples, {
          segmentMode: 'voice',
          minFreqHz: 90,
          maxFreqHz: 1300,
          confidenceThreshold: 0.5,
        })) as Note[];

        const rawOffset = estimateTuningOffsetCents(notes);
        // Arm A — today: no score key, no fallback.
        const offA = chooseNamingOffset(notes, rawOffset, null);
        // Arm B — the take-key fallback.
        const key = estimateTakeKeyClasses(notes, rawOffset);
        const offB = chooseNamingOffset(notes, rawOffset, key?.classes ?? null);

        let acc = perCondition.get(cond);
        if (!acc) {
          acc = {
            matched: 0, wrongOff: 0, wrongKey: 0, accOff: 0, accKey: 0,
            clips: 0, abstain: 0, keyRight: 0,
          };
          perCondition.set(cond, acc);
        }
        acc.clips += 1;
        if (!key) acc.abstain += 1;
        else if (key.mode === 'major' && key.tonic === ((s.rootMidi % 12) + 12) % 12) {
          acc.keyRight += 1;
        }

        for (const { intended, est } of matchNotes(truth.notes, notes)) {
          const wroteA = spellMidi(est, offA, null);
          const wroteB = spellMidi(est, offB, key?.classes ?? null);
          acc.matched += 1;
          if (wroteA !== intended) acc.wrongOff += 1;
          if (wroteB !== intended) acc.wrongKey += 1;
          if (!trueKey.has(((wroteA % 12) + 12) % 12)) acc.accOff += 1;
          if (!trueKey.has(((wroteB % 12) + 12) % 12)) acc.accKey += 1;
        }
      }
    }
    console.log(`  ${s.id} done`);
  }

  console.log(
    '\ncondition        clips  matched  wrong%(off)  wrong%(key)  acc/100(off)  acc/100(key)  abstain  keyRight',
  );
  for (const cond of CONDITIONS) {
    const a = perCondition.get(cond);
    if (!a) continue;
    const pct = (x: number): string => ((100 * x) / Math.max(1, a.matched)).toFixed(1);
    console.log(
      cond.padEnd(17) +
        String(a.clips).padEnd(7) +
        String(a.matched).padEnd(9) +
        pct(a.wrongOff).padEnd(13) +
        pct(a.wrongKey).padEnd(13) +
        pct(a.accOff).padEnd(14) +
        pct(a.accKey).padEnd(14) +
        `${a.abstain}/${a.clips}`.padEnd(9) +
        `${a.keyRight}/${a.clips}`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
