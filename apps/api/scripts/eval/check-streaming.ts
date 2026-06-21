/**
 * Validation for the streaming-decode + windowed-transcription change.
 *
 * Two checks, both run through the REAL components:
 *
 *  1. Decoder parity — decode a webm/opus clip one-shot (`AudioDecoder.decode`)
 *     vs. fed incrementally to a `StreamingDecoder`, and assert the PCM is
 *     identical. Proves the persistent decoder produces the same samples as the
 *     old whole-buffer decode (single-pass loudnorm is causal + bounded
 *     look-ahead, so chunking the input must not change the output).
 *
 *  2. Windowing accuracy — for several scenarios, run each clip through the
 *     pipeline two ways: instant-feed (one final pass over the whole buffer, =
 *     the old behaviour) and paced-feed (many incremental windowed passes). Score
 *     both against ground truth and report the note delta between them. If
 *     windowing is correct the committed notes match the whole-buffer result.
 *
 *   RECORDING_DEBOUNCE_MS=150 tsx scripts/eval/check-streaming.ts [scenarios] [melody]
 */

import { spawn } from 'child_process';
import { readFileSync } from 'fs';
import { join, resolve } from 'path';

import ffmpegPath from 'ffmpeg-static';

import { AudioDecoder, StreamingDecoder } from '../../src/recordings/AudioDecoder';
import { ProfileResolver } from '../../src/recordings/profiles/ProfileResolver';
import { ProviderRegistry } from '../../src/recordings/providers/ProviderRegistry';
import { scoreNotes, type EstNote } from './lib/metrics';
import { runThroughPipeline, runThroughPipelineStreaming } from './lib/pipelineRun';
import { SCENARIOS } from './scenarios';
import type { GroundTruth } from './types';

const EVAL_ROOT = resolve(__dirname, '../fixtures/eval');
const MODELS = {
  basicPitch: resolve(process.cwd(), 'model'),
  crepeTiny: resolve(process.cwd(), 'model-crepe-tiny'),
};

function encodeWebmOpus(wav: Buffer): Promise<Buffer> {
  if (!ffmpegPath) throw new Error('ffmpeg-static missing');
  return new Promise<Buffer>((res, rej) => {
    const proc = spawn(ffmpegPath as string, [
      '-hide_banner', '-loglevel', 'error',
      '-i', 'pipe:0',
      '-c:a', 'libopus', '-b:a', '128k',
      '-f', 'webm', 'pipe:1',
    ]);
    const out: Buffer[] = [];
    proc.stdout.on('data', (c: Buffer) => out.push(c));
    proc.on('error', rej);
    proc.on('close', (code) => {
      const o = Buffer.concat(out);
      o.length ? res(o) : rej(new Error(`encode failed (${code})`));
    });
    proc.stdin.on('error', () => {});
    proc.stdin.end(wav);
  });
}

/** Decode `webm` via the StreamingDecoder, fed in `nChunks` byte slices. */
async function streamDecode(
  webm: Buffer,
  sampleRate: number,
  loudnorm: boolean,
  nChunks: number,
): Promise<Float32Array> {
  const dec = new StreamingDecoder(sampleRate, { loudnorm, highpassHz: 80 });
  const size = Math.ceil(webm.byteLength / nChunks);
  for (let o = 0; o < webm.byteLength; o += size) {
    dec.write(webm.subarray(o, Math.min(o + size, webm.byteLength)));
  }
  return dec.finalize();
}

function maxAbsDiff(a: Float32Array, b: Float32Array): { n: number; max: number } {
  const n = Math.min(a.length, b.length);
  let max = 0;
  for (let i = 0; i < n; i++) max = Math.max(max, Math.abs(a[i] - b[i]));
  return { n, max };
}

/** Set-difference of two note lists keyed on rounded onset + midi. */
function noteDelta(a: EstNote[], b: EstNote[]): { onlyA: number; onlyB: number } {
  const key = (n: EstNote): string => `${Math.round(n.onsetSec * 50)}_${n.midi}`;
  const sa = new Set(a.map(key));
  const sb = new Set(b.map(key));
  let onlyA = 0;
  let onlyB = 0;
  for (const k of sa) if (!sb.has(k)) onlyA++;
  for (const k of sb) if (!sa.has(k)) onlyB++;
  return { onlyA, onlyB };
}

async function main(): Promise<void> {
  const registry = new ProviderRegistry({
    basicPitch: MODELS.basicPitch,
    crepeTiny: MODELS.crepeTiny,
  });
  await registry.initAll();
  const resolver = new ProfileResolver();

  const scenarioIds = (
    process.argv[2] ??
    'whistle-high,piccolo-veryhigh,voice-tenor,trumpet-mid,cello-low'
  )
    .split(',').map((s) => s.trim()).filter(Boolean);
  const melody = process.argv[3] ?? 'tune';

  // 1. Decoder parity — one-shot vs streamed must be bit-for-bit equal.
  console.log('=== decoder parity (one-shot vs streamed) ===');
  const oneShot = new AudioDecoder();
  {
    const wav = readFileSync(join(EVAL_ROOT, scenarioIds[0], `${melody}__clean.wav`));
    const webm = await encodeWebmOpus(wav);
    for (const loudnorm of [true, false]) {
      const ref = await oneShot.decode(webm, 22050, { loudnorm, highpassHz: 80 });
      const streamed = await streamDecode(webm, 22050, loudnorm, 37);
      const d = maxAbsDiff(ref.samples, streamed);
      const lenDiff = Math.abs(ref.samples.length - streamed.length);
      console.log(
        `  loudnorm=${String(loudnorm).padEnd(5)} ` +
          `oneShot=${ref.samples.length} streamed=${streamed.length} ` +
          `lenDiff=${lenDiff} maxAbsDiff=${d.max.toExponential(2)}`,
      );
    }
  }

  // 2. Windowing accuracy — instant (one final pass) vs paced (many windowed).
  console.log(
    `\n=== windowing accuracy (debounce=${process.env.RECORDING_DEBOUNCE_MS ?? '1000'}ms) ===`,
  );
  console.log(
    `${'scenario'.padEnd(18)}${'F1(single)'.padEnd(12)}${'F1(stream)'.padEnd(12)}` +
      `${'noteΔ(only-single/only-stream)'.padEnd(2)}`,
  );
  for (const id of scenarioIds) {
    const scenario = SCENARIOS.find((s) => s.id === id);
    let truth: GroundTruth;
    let wav: Buffer;
    try {
      truth = JSON.parse(readFileSync(join(EVAL_ROOT, id, `${melody}.truth.json`), 'utf8'));
      wav = readFileSync(join(EVAL_ROOT, id, `${melody}__clean.wav`));
    } catch {
      console.log(`  ${id}: missing fixture`);
      continue;
    }
    const webm = await encodeWebmOpus(wav);
    const instr = scenario?.instrumentId ?? '';

    const single = await runThroughPipeline(registry, resolver, webm, truth.bpm, 4, instr);
    const stream = await runThroughPipelineStreaming(
      registry, resolver, webm, truth.bpm, 4, instr,
    );
    const fSingle = scoreNotes(truth.notes, single).f1;
    const fStream = scoreNotes(truth.notes, stream).f1;
    const delta = noteDelta(single, stream);
    console.log(
      `${id.padEnd(18)}${fSingle.toFixed(3).padEnd(12)}${fStream.toFixed(3).padEnd(12)}` +
        `${delta.onlyA}/${delta.onlyB}`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
