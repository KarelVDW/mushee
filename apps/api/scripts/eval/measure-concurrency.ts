/**
 * Measure the steady-state real-time factor (RTF) of one recording session at
 * production cadence: main-thread transcription CPU per second of audio. The
 * single-threaded WASM inference is the concurrency bottleneck, so
 * `concurrentSessionsPerCore ≈ 1 / RTF`.
 *
 * Loops a fixture to ~target seconds and feeds it at (near) real time with the
 * production 1 s debounce, so each pass sees ~1 s of new audio — exactly the
 * production work ratio. Sums the pipeline's per-pass convert time.
 *
 *   tsx scripts/eval/measure-concurrency.ts <scenario> [targetSec]
 */

import { spawn } from 'child_process';
import ffmpegPath from 'ffmpeg-static';
import { readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';

import { ProfileResolver } from '../../src/recordings/pipeline/profiles/profile-resolver';
import { ProviderRegistry } from '../../src/recordings/pipeline/providers/provider-registry';
import { runThroughPipelineStreaming } from './lib/pipelineRun';
import { SCENARIOS } from './scenarios';
import type { GroundTruth } from './types';

const EVAL_ROOT = resolve(__dirname, '../fixtures/eval');
const MODELS = {
  basicPitch: resolve(process.cwd(), 'model'),
  crepeTiny: resolve(process.cwd(), 'model-crepe-tiny'),
};

function loopToWebm(wav: Buffer, n: number): Promise<Buffer> {
  if (!ffmpegPath) throw new Error('ffmpeg-static missing');
  const tmp = join(tmpdir(), `rtf-loop-${process.pid}.wav`);
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
    proc.on('close', (code) =>
      out.length ? res(Buffer.concat(out)) : rej(new Error(`loop failed (${code})`)),
    );
    proc.stdin.on('error', () => {});
    proc.stdin.end(wav);
  });
}

async function main(): Promise<void> {
  const id = process.argv[2] ?? 'voice-tenor';
  const targetSec = Number(process.argv[3] ?? 30);
  const registry = new ProviderRegistry({
    basicPitch: MODELS.basicPitch,
    crepeTiny: MODELS.crepeTiny,
  });
  await registry.initAll();
  const resolver = new ProfileResolver();

  const scenario = SCENARIOS.find((s) => s.id === id);
  const truth = JSON.parse(
    readFileSync(join(EVAL_ROOT, id, 'tune.truth.json'), 'utf8'),
  ) as GroundTruth;
  const wav = readFileSync(join(EVAL_ROOT, id, 'tune__clean.wav'));
  // One clip is ~9.8 s; loop to reach ~targetSec.
  const loops = Math.max(1, Math.round(targetSec / 9.8));
  const webm = await loopToWebm(wav, loops);
  const audioSec = loops * 9.8;

  // Feed at real time: chunk every 250 ms over the clip's true duration.
  const chunkDelayMs = 250;
  const chunks = Math.max(8, Math.round((audioSec * 1000) / chunkDelayMs));
  await runThroughPipelineStreaming(
    registry, resolver, webm, truth.bpm, 4, scenario?.instrumentId ?? '',
    { chunks, chunkDelayMs },
  );
  console.log(`MEASURE id=${id} audioSec=${audioSec.toFixed(1)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
