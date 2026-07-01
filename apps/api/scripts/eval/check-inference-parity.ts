/**
 * Parity gate for the remote inference services. Compares the in-process TF.js
 * forward pass (LocalModelBackend) against the remote gRPC service, both as a
 * tight numeric tensor diff and end-to-end through the real RecordingPipeline.
 *
 *   CREPE_INFERENCE_URL=localhost:50051 \
 *   BASIC_PITCH_INFERENCE_URL=localhost:50052 \   # optional
 *   tsx scripts/eval/check-inference-parity.ts [scenarios] [melody]
 *
 * Any service whose URL is unset stays local on both sides (so this also works
 * to gate CREPE alone). Exits non-zero if forward-pass maxAbsDiff exceeds the
 * threshold or any scenario's F1 regresses beyond tolerance.
 */

import { spawn } from 'child_process';
import { readFileSync } from 'fs';
import { join, resolve } from 'path';

import ffmpegPath from 'ffmpeg-static';

import { CompositeModelBackend } from '../../src/recordings/providers/CompositeModelBackend';
import { LocalModelBackend } from '../../src/recordings/providers/LocalModelBackend';
import type { ModelBackend } from '../../src/recordings/providers/ModelBackend';
import { ProviderRegistry } from '../../src/recordings/providers/ProviderRegistry';
import { RemoteModelBackend } from '../../src/recordings/providers/RemoteModelBackend';
import { ProfileResolver } from '../../src/recordings/profiles/ProfileResolver';
import { scoreNotes } from './lib/metrics';
import { runThroughPipeline } from './lib/pipelineRun';
import { SCENARIOS } from './scenarios';
import type { GroundTruth } from './types';

const EVAL_ROOT = resolve(__dirname, '../fixtures/eval');
const DIRS = {
  basicPitch: resolve(process.cwd(), 'model'),
  crepeTiny: resolve(process.cwd(), 'model-crepe-tiny'),
};
// Forward-pass sanity bounds. CREPE loads the exact tfjs layers weights, so it
// matches to float noise. basic-pitch runs the PyPI SavedModel (same ICASSP-2022
// weights, different runtime/op-fusion than the tfjs graph model), so its
// activations differ at the normal cross-runtime magnitude (~5e-4); end-to-end F1
// parity is the accuracy-meaningful gate there.
const CREPE_FWD_THRESHOLD = 1e-4;
const BP_FWD_THRESHOLD = 2e-3;
const F1_TOLERANCE = 0.02;

function remoteOrLocal(local: LocalModelBackend): ModelBackend {
  const crepeUrl = process.env.CREPE_INFERENCE_URL;
  const bpUrl = process.env.BASIC_PITCH_INFERENCE_URL;
  if (!crepeUrl && !bpUrl) return local;
  return new CompositeModelBackend({
    'crepe-tiny': crepeUrl ? new RemoteModelBackend('crepe-tiny', crepeUrl) : local,
    'basic-pitch': bpUrl ? new RemoteModelBackend('basic-pitch', bpUrl) : local,
  });
}

function encodeWebmOpus(wav: Buffer): Promise<Buffer> {
  if (!ffmpegPath) throw new Error('ffmpeg-static missing');
  return new Promise<Buffer>((res, rej) => {
    const proc = spawn(ffmpegPath as string, [
      '-hide_banner', '-loglevel', 'error', '-i', 'pipe:0',
      '-c:a', 'libopus', '-b:a', '128k', '-f', 'webm', 'pipe:1',
    ]);
    const out: Buffer[] = [];
    proc.stdout.on('data', (c: Buffer) => out.push(c));
    proc.on('error', rej);
    proc.on('close', (code) =>
      out.length ? res(Buffer.concat(out)) : rej(new Error(`encode failed (${code})`)),
    );
    proc.stdin.on('error', () => {});
    proc.stdin.end(wav);
  });
}

async function main(): Promise<void> {
  const local = new LocalModelBackend(DIRS);
  const remote = remoteOrLocal(local);
  let failed = false;

  // (A) numeric forward-pass parity on a deterministic CREPE batch.
  if (process.env.CREPE_INFERENCE_URL) {
    const N = 8, F = 1024;
    const flat = new Float32Array(N * F);
    for (let k = 0; k < N; k++) {
      const row = new Float64Array(F);
      for (let i = 0; i < F; i++) row[i] = Math.sin(i * 0.005 * (k + 1)) + 0.1 * (k + 1);
      let mean = 0; for (let i = 0; i < F; i++) mean += row[i]; mean /= F;
      let v = 0; for (let i = 0; i < F; i++) v += (row[i] - mean) ** 2; v /= F;
      const std = Math.sqrt(v);
      for (let i = 0; i < F; i++) flat[k * F + i] = (row[i] - mean) / (std + 1e-9);
    }
    const a = await local.crepePredict(flat, N);
    const b = await remote.crepePredict(flat, N);
    let max = 0;
    for (let i = 0; i < a.length; i++) max = Math.max(max, Math.abs(a[i] - b[i]));
    const ok = max <= CREPE_FWD_THRESHOLD;
    console.log(`[A] CREPE forward-pass maxAbsDiff=${max.toExponential(3)} ${ok ? 'OK' : 'FAIL'}`);
    if (!ok) failed = true;
  }

  // (A2) numeric forward-pass parity on a deterministic basic-pitch PCM window.
  if (process.env.BASIC_PITCH_INFERENCE_URL) {
    const L = 22050 * 4; // 4 s of synthetic mono PCM
    const pcm = new Float32Array(L);
    for (let i = 0; i < L; i++) {
      pcm[i] = 0.3 * Math.sin((2 * Math.PI * 440 * i) / 22050) +
        0.15 * Math.sin((2 * Math.PI * 880 * i) / 22050);
    }
    const a = await local.basicPitchForward(pcm);
    const b = await remote.basicPitchForward(pcm);
    let max = 0;
    const rows = Math.min(a.frames.length, b.frames.length);
    const rowDiff = Math.abs(a.frames.length - b.frames.length);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < a.frames[r].length; c++) {
        max = Math.max(max, Math.abs(a.frames[r][c] - b.frames[r][c]));
        max = Math.max(max, Math.abs(a.onsets[r][c] - b.onsets[r][c]));
      }
    }
    const ok = max <= BP_FWD_THRESHOLD && rowDiff === 0;
    console.log(
      `[A2] basic-pitch forward-pass maxAbsDiff=${max.toExponential(3)} ` +
        `rowDiff=${rowDiff} (T=${a.frames.length}) ${ok ? 'OK' : 'FAIL'} (cross-runtime; F1 is the gate)`,
    );
    if (!ok) failed = true;
  }

  // (B) end-to-end pipeline parity (local registry vs remote-backed registry).
  const localReg = new ProviderRegistry(DIRS, local);
  const remoteReg = new ProviderRegistry(DIRS, remote);
  const resolver = new ProfileResolver();
  const ids = (process.argv[2] ??
    'voice-tenor,trumpet-mid,cello-low,oboe-high,whistle-high,piccolo-veryhigh')
    .split(',').map((s) => s.trim()).filter(Boolean);
  const melody = process.argv[3] ?? 'tune';

  console.log(`\n[B] pipeline parity  ${'scenario'.padEnd(18)}F1(local) F1(remote) Δ`);
  for (const id of ids) {
    const sc = SCENARIOS.find((s) => s.id === id);
    let truth: GroundTruth, wav: Buffer;
    try {
      truth = JSON.parse(readFileSync(join(EVAL_ROOT, id, `${melody}.truth.json`), 'utf8'));
      wav = readFileSync(join(EVAL_ROOT, id, `${melody}__clean.wav`));
    } catch { console.log(`  ${id}: missing fixture`); continue; }
    const webm = await encodeWebmOpus(wav);
    const instr = sc?.instrumentId ?? '';
    const fLocal = scoreNotes(truth.notes,
      await runThroughPipeline(localReg, resolver, webm, truth.bpm, 4, instr)).f1;
    const fRemote = scoreNotes(truth.notes,
      await runThroughPipeline(remoteReg, resolver, webm, truth.bpm, 4, instr)).f1;
    const d = fRemote - fLocal;
    const ok = Math.abs(d) <= F1_TOLERANCE;
    if (!ok) failed = true;
    console.log(
      `    ${id.padEnd(18)}${fLocal.toFixed(3).padEnd(10)}${fRemote.toFixed(3).padEnd(11)}` +
        `${d >= 0 ? '+' : ''}${d.toFixed(3)} ${ok ? '' : 'FAIL'}`,
    );
  }

  console.log(failed ? '\nPARITY GATE: FAIL' : '\nPARITY GATE: PASS');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
