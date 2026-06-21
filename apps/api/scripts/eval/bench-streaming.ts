/**
 * Performance proof for the streaming-decode + windowed-transcription change.
 *
 *  (A) Microbench: basic-pitch transcribe time vs input length. The OLD pipeline
 *      handed the whole buffer to the model every pass, so per-pass cost grew
 *      with the recording — Σ over passes = O(n²). The new pipeline feeds a
 *      bounded trailing window, so per-pass cost is flat — Σ = O(n).
 *
 *  (B) Real pipeline on a long clip: feed a ~60 s recording incrementally and
 *      print each pass's transcribed window length + convert time, showing the
 *      window stays bounded (~CONTEXT) while the total audio keeps growing.
 *
 *   RECORDING_DEBOUNCE_MS=300 tsx scripts/eval/bench-streaming.ts
 */

import { spawn } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';

import ffmpegPath from 'ffmpeg-static';

import { AudioDecoder } from '../../src/recordings/AudioDecoder';
import { ProfileResolver } from '../../src/recordings/profiles/ProfileResolver';
import { BasicPitchProvider } from '../../src/recordings/providers/BasicPitchProvider';
import { ProviderRegistry } from '../../src/recordings/providers/ProviderRegistry';
import { runThroughPipelineStreaming } from './lib/pipelineRun';

const EVAL_ROOT = resolve(__dirname, '../fixtures/eval');
const MODELS = {
  basicPitch: resolve(process.cwd(), 'model'),
  crepeTiny: resolve(process.cwd(), 'model-crepe-tiny'),
};

/** Loop `wav` `n` times and encode to webm/opus, to synthesize a long recording. */
function loopToWebm(wav: Buffer, n: number): Promise<Buffer> {
  if (!ffmpegPath) throw new Error('ffmpeg-static missing');
  // -stream_loop needs a seekable input, so stage the wav on disk (a pipe won't
  // loop — it just plays once).
  const tmp = join(tmpdir(), `bench-loop-${process.pid}.wav`);
  writeFileSync(tmp, wav);
  return new Promise<Buffer>((res, rej) => {
    const proc = spawn(ffmpegPath as string, [
      '-hide_banner', '-loglevel', 'error',
      '-stream_loop', String(n - 1), '-i', tmp,
      '-c:a', 'libopus', '-b:a', '128k', '-f', 'webm', 'pipe:1',
    ]);
    const out: Buffer[] = [];
    proc.stdout.on('data', (c: Buffer) => out.push(c));
    proc.on('error', rej);
    proc.on('close', (code) => {
      const o = Buffer.concat(out);
      o.length ? res(o) : rej(new Error(`loop encode failed (${code})`));
    });
    proc.stdin.on('error', () => {});
    proc.stdin.end(wav);
  });
}

const now = (): number => Number(process.hrtime.bigint() / 1000000n);

async function main(): Promise<void> {
  const registry = new ProviderRegistry({
    basicPitch: MODELS.basicPitch,
    crepeTiny: MODELS.crepeTiny,
  });
  await registry.initAll();

  const wav = readFileSync(join(EVAL_ROOT, 'whistle-high', 'tune__clean.wav'));
  const longWebm = await loopToWebm(wav, 6); // ~60 s

  // (A) basic-pitch transcribe time vs input length.
  console.log('=== (A) basic-pitch transcribe time vs input length ===');
  const decoded = await new AudioDecoder().decode(longWebm, 22050, {
    loudnorm: true, highpassHz: 80,
  });
  const sr = 22050;
  const bp = new BasicPitchProvider(MODELS.basicPitch);
  await bp.init();
  console.log(`${'inputSec'.padEnd(10)}${'transcribeMs'.padEnd(14)}ms/sec`);
  for (const sec of [5, 10, 20, 30, 45, 60]) {
    const n = Math.min(decoded.samples.length, sec * sr);
    const slice = decoded.samples.subarray(0, n);
    const t0 = now();
    await bp.transcribe(slice, { minFreqHz: 559, maxFreqHz: 3316 });
    const ms = now() - t0;
    console.log(
      `${String(sec).padEnd(10)}${String(ms).padEnd(14)}${(ms / sec).toFixed(1)}`,
    );
  }

  // (B) Real streaming pipeline on the long clip — window stays bounded.
  console.log(
    `\n=== (B) streaming pipeline pass log (debounce=${process.env.RECORDING_DEBOUNCE_MS ?? '1000'}ms) ===`,
  );
  console.log('(see "Pass timings" lines: window=A-Bs stays ~bounded as audioDur grows)');
  const resolver = new ProfileResolver();
  await runThroughPipelineStreaming(
    registry, resolver, longWebm, 120, 4, 'piccolo',
    { chunks: 120, chunkDelayMs: 25 },
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
