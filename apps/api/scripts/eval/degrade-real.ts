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

import { existsSync, readdirSync, readFileSync } from 'fs';
import { join, resolve } from 'path';

import { degrade } from './lib/degrade';
import { CONDITIONS } from './scenarios';

const REAL_ROOT = resolve(__dirname, '../fixtures/eval-real');
const SAMPLE_RATE = 44100;

/**
 * Duration of a RIFF/WAVE file, by walking its chunk list (the `data` chunk can
 * be preceded by `LIST`/`fact`/etc., so a fixed offset is not safe).
 *
 * 🔴 This is load-bearing, not a convenience. `degrade()` sizes its finite noise
 * bed from `maxDurationSec` and defaults it to **10 s**, and ffmpeg's
 * `loudnorm → amix` pair truncates the signal to the noise length whenever the
 * clip runs 10–13 s: loudnorm's 3 s look-ahead means the signal's tail arrives
 * after every other amix input has hit EOF, and amix closes the output there.
 * Measured on vocadito_1 trimmed to fixed lengths, echoey-room:
 *
 *     in 8s → out 10.00s   in 11s → out 10.00s   in 13s → out 13.00s
 *     in 10s → out 10.00s  in 12s → out 10.00s   in 15s → out 15.00s
 *
 * So every 10–13 s clip in the corpus lost its last 1–3 s of AUDIO while
 * keeping all of its ground-truth notes — an unconditional recall loss that
 * showed up as "reverb is catastrophic". Passing the real duration makes the
 * noise bed exactly clip-length and pins the output to it, so a degraded variant
 * is now sample-for-sample the same length as its source (verified for
 * 8/10/11/12/13/15 s). It also trims the reverb tail past the last note, which
 * costs nothing (no truth notes live there) and buys frame-grid alignment
 * between a clip and its degraded twin — what any paired frame-level
 * diagnosis needs.
 */
function wavDurationSec(path: string): number | undefined {
  let buf: Buffer;
  try {
    buf = readFileSync(path);
  } catch {
    return undefined;
  }
  if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF') return undefined;
  let byteRate = 0;
  let offset = 12;
  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    if (id === 'fmt ') byteRate = buf.readUInt32LE(offset + 16);
    if (id === 'data') {
      const bytes = Math.min(size, buf.length - offset - 8);
      return byteRate > 0 ? bytes / byteRate : undefined;
    }
    offset += 8 + size + (size % 2);
  }
  return undefined;
}

// The adverse tier only — room-mic/noisy-phone add little over the raw takes
// (several real datasets are already low-fi), and every extra condition
// multiplies eval runtime over ~140 clips.
const DEFAULT_CONDITION_IDS = ['echoey-room', 'wind-outdoor', 'street-noise', 'distant-mic'];

/**
 * Both narrowable from the environment, because generating the full cross product
 * over the 588-clip corpus is hours of ffmpeg plus hours of model inference. A
 * focused study (e.g. the reverb axis on the singing datasets) wants two
 * conditions on two datasets, not twenty on nineteen.
 *   DEGRADE_CONDITIONS=echoey-room,distant-mic
 *   DEGRADE_DATASETS=annotated-vocalset,guitarset-solo
 */
function idsFromEnv(key: string, fallback: string[]): string[] {
  const raw = (process.env[key] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return raw.length ? raw : fallback;
}

/**
 * `DEGRADE_LEGACY_10S_NOISE=1` reproduces the pre-fix behaviour (10 s noise bed,
 * no output length pin) into `<clip>__<condition>-legacy.wav`, so the cost of the
 * truncation/padding bug documented above can be measured rather than asserted —
 * generate both and diff them with `sweep-reverb.ts`
 * (`SWEEP_REVERB_VARIANTS=echoey-room-legacy`). Not part of any normal run.
 */
const LEGACY = process.env.DEGRADE_LEGACY_10S_NOISE === '1';

function main(): void {
  if (!existsSync(REAL_ROOT)) {
    console.error(`No real corpus at ${REAL_ROOT} — run the fetch-*.ts scripts first.`);
    process.exit(1);
  }
  const wantConditions = idsFromEnv('DEGRADE_CONDITIONS', DEFAULT_CONDITION_IDS);
  const wantDatasets = idsFromEnv('DEGRADE_DATASETS', []);
  const conditions = CONDITIONS.filter((c) => wantConditions.includes(c.id));

  let made = 0;
  for (const dataset of readdirSync(REAL_ROOT, { withFileTypes: true })) {
    if (!dataset.isDirectory()) continue;
    if (wantDatasets.length && !wantDatasets.includes(dataset.name)) continue;
    const dir = join(REAL_ROOT, dataset.name);
    const clips = readdirSync(dir).filter((f) => f.endsWith('__real.wav'));

    for (const clip of clips) {
      const base = clip.replace('__real.wav', '');
      const src = join(dir, clip);
      const durationSec = wavDurationSec(src);
      for (const condition of conditions) {
        const out = join(
          dir,
          `${base}__${condition.id}${LEGACY ? '-legacy' : ''}.wav`,
        );
        if (existsSync(out)) continue;
        degrade(src, out, condition, SAMPLE_RATE, LEGACY ? undefined : durationSec);
        made += 1;
      }
    }
    console.log(`  ${dataset.name}: ${clips.length} clips × ${conditions.length} conditions`);
  }
  console.log(`\nWrote ${made} degraded variants under ${REAL_ROOT}`);
}

main();
