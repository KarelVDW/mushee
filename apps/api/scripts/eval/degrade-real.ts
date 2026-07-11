/**
 * Generate degraded variants of the REAL recorded corpus: for every
 * `<clip>__real.wav` under fixtures/eval-real, emit `<clip>__<condition>.wav`
 * for each adverse condition. Real singing under synthetic wind/reverb/babble
 * is the most honest robustness measure we have — it sidesteps the synthetic
 * corpus's thin voice proxy entirely.
 *
 * Run after the fetch-*.ts scripts:
 *   pnpm --filter @mushee/api exec tsx scripts/eval/degrade-real.ts
 *
 * Idempotent; ~4 files per source clip. EVAL_REAL=1 run-eval.ts picks the
 * variants up automatically (missing variants are skipped).
 */

import { existsSync, readdirSync } from 'fs';
import { join, resolve } from 'path';

import { degrade } from './lib/degrade';
import { CONDITIONS } from './scenarios';

const REAL_ROOT = resolve(__dirname, '../fixtures/eval-real');
const SAMPLE_RATE = 44100;

// The adverse tier only — room-mic/noisy-phone add little over the raw takes
// (several real datasets are already low-fi), and every extra condition
// multiplies eval runtime over ~140 clips.
const REAL_CONDITION_IDS = ['echoey-room', 'wind-outdoor', 'street-noise', 'distant-mic'];

function main(): void {
  if (!existsSync(REAL_ROOT)) {
    console.error(`No real corpus at ${REAL_ROOT} — run the fetch-*.ts scripts first.`);
    process.exit(1);
  }
  const conditions = CONDITIONS.filter((c) => REAL_CONDITION_IDS.includes(c.id));

  let made = 0;
  for (const dataset of readdirSync(REAL_ROOT, { withFileTypes: true })) {
    if (!dataset.isDirectory()) continue;
    const dir = join(REAL_ROOT, dataset.name);
    const clips = readdirSync(dir).filter((f) => f.endsWith('__real.wav'));

    for (const clip of clips) {
      const base = clip.replace('__real.wav', '');
      for (const condition of conditions) {
        const out = join(dir, `${base}__${condition.id}.wav`);
        if (existsSync(out)) continue;
        degrade(join(dir, clip), out, condition, SAMPLE_RATE);
        made += 1;
      }
    }
    console.log(`  ${dataset.name}: ${clips.length} clips × ${conditions.length} conditions`);
  }
  console.log(`\nWrote ${made} degraded variants under ${REAL_ROOT}`);
}

main();
