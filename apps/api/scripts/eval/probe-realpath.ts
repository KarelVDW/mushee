/**
 * System-bias probe for the REAL server path.
 *
 * The normal eval feeds pre-rendered WAVs straight to AudioConverter, so it
 * never exercises (a) the production RecordingPipeline (chunked decode, profile
 * lock, stable-margin, dedup) nor (b) the webm/opus codec the browser's
 * MediaRecorder actually streams. Either could add a constant timing offset
 * ("accidental lag") that the WAV eval is blind to.
 *
 * This drives the production RecordingPipeline end-to-end on an on-grid fixture,
 * once with the audio re-encoded to webm/opus (the browser codec) and once as
 * WAV (control), then measures the onset/offset bias of the server's notes vs.
 * the known on-grid ground truth. Any nonzero, codec-correlated onset bias is a
 * server-side system bias. (It does NOT capture the browser's capture-START
 * latency — that lives in MediaRecorder timing, outside Node.)
 *
 *   tsx scripts/eval/probe-realpath.ts [scenario,scenario,...] [melody]
 */

import { spawn } from 'child_process';
import ffmpegPath from 'ffmpeg-static';
import { readFileSync } from 'fs';
import { join, resolve } from 'path';

import { ProfileResolver } from '../../src/recordings/pipeline/profiles/profile-resolver';
import { ProviderRegistry } from '../../src/recordings/pipeline/providers/provider-registry';
import { type Metrics,scoreNotes, timingStats } from './lib/metrics';
import { runThroughPipeline } from './lib/pipelineRun';
import { discoverRealDatasets, listRealClips } from './lib/realCorpus';
import { SCENARIOS } from './scenarios';
import type { GroundTruth } from './types';

const EVAL_ROOT = resolve(__dirname, '../fixtures/eval');
const REAL_ROOT = resolve(__dirname, '../fixtures/eval-real');
const MODELS = {
  basicPitch: resolve(process.cwd(), 'model'),
  crepeTiny: resolve(process.cwd(), 'model-crepe-tiny'),
};

/** Re-encode a WAV buffer to webm/opus, exactly the container MediaRecorder streams. */
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
    const err: Buffer[] = [];
    proc.stdout.on('data', (c: Buffer) => out.push(c));
    proc.stderr.on('data', (c: Buffer) => err.push(c));
    proc.on('error', rej);
    proc.on('close', (code) => {
      const o = Buffer.concat(out);
      if (!o.length) rej(new Error(`encode failed (${code}): ${Buffer.concat(err).toString()}`));
      else res(o);
    });
    proc.stdin.on('error', () => {});
    proc.stdin.end(wav);
  });
}

function boolEnv(key: string): boolean {
  return ['1', 'true', 'yes'].includes((process.env[key] ?? '').toLowerCase());
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** bpm from onset times (median IOI ≈ one beat) — simulates a user who set a
 *  tempo matching their performance. */
function bpmFromOnsets(onsets: number[]): number {
  const iois: number[] = [];
  for (let i = 1; i < onsets.length; i += 1) {
    const d = onsets[i] - onsets[i - 1];
    if (d > 0.05) iois.push(d);
  }
  const med = median(iois);
  return med ? Math.max(50, Math.min(200, 60 / med)) : 120;
}

/**
 * Drive the REAL recorded corpus (fixtures/eval-real) through the full
 * production pipeline — chunked decode, profile-lock-from-prefix, stable-margin,
 * dedup, AND the MusicXML quantization round-trip — once per codec (wav control
 * vs. webm/opus, the browser's MediaRecorder container). Aggregates mean F1 and
 * pooled timing per dataset so it's directly comparable to run-eval's batch F1
 * (which scores the raw deduced notes, skipping the streaming + quantization
 * path). A drop here vs. the batch number localizes the real-world loss.
 *
 *   EVAL_REAL=1 tsx scripts/eval/probe-realpath.ts [dataset,dataset,...]
 */
async function runRealCorpus(
  registry: ProviderRegistry,
  resolver: ProfileResolver,
): Promise<void> {
  const filter = (process.argv[2] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const datasets = discoverRealDatasets(REAL_ROOT).filter(
    (d) => !filter.length || filter.includes(d.id),
  );
  if (!datasets.length) {
    console.log(`No real datasets under ${REAL_ROOT} (run fetch-vocadito.ts first).`);
    return;
  }

  // webm/opus was shown codec-neutral; default to wav-only for speed, add webm
  // back with EVAL_WEBM=1. Matched tempo (EVAL_MATCH_TEMPO=1) simulates a user
  // who set a tempo fitting their performance instead of the dataset's nominal.
  const codecs: Array<'wav' | 'webm'> = boolEnv('EVAL_WEBM') ? ['wav', 'webm'] : ['wav'];
  const matchTempo = boolEnv('EVAL_MATCH_TEMPO');

  console.log(`\nmatchTempo=${matchTempo} codecs=${codecs.join(',')}`);
  console.log(
    `${'dataset'.padEnd(22)}${'input'.padEnd(7)}` +
      `${'F1@.1'.padEnd(8)}${'F1@.2'.padEnd(8)}${'onsetBias'.padEnd(11)}clips`,
  );
  for (const ds of datasets) {
    const byCodec: Record<'wav' | 'webm', { f1_01: number[]; f1_02: number[]; m: Metrics[] }> = {
      wav: { f1_01: [], f1_02: [], m: [] },
      webm: { f1_01: [], f1_02: [], m: [] },
    };
    for (const clip of listRealClips(ds.dir)) {
      let truth: GroundTruth;
      let wav: Buffer;
      try {
        truth = JSON.parse(readFileSync(join(ds.dir, `${clip}.truth.json`), 'utf8')) as GroundTruth;
        wav = readFileSync(join(ds.dir, `${clip}__real.wav`));
      } catch {
        continue;
      }
      const bpm = matchTempo ? bpmFromOnsets(truth.notes.map((n) => n.onsetSec)) : truth.bpm;
      for (const label of codecs) {
        const audio = label === 'webm' ? await encodeWebmOpus(wav) : wav;
        const est = await runThroughPipeline(registry, resolver, audio, bpm, 4, ds.instrumentId ?? '');
        byCodec[label].f1_01.push(scoreNotes(truth.notes, est, { onsetTolSec: 0.1, timingTolSec: 0.3 }).f1);
        byCodec[label].f1_02.push(scoreNotes(truth.notes, est, { onsetTolSec: 0.2, timingTolSec: 0.3 }).f1);
        byCodec[label].m.push(scoreNotes(truth.notes, est));
      }
    }
    for (const label of codecs) {
      const b = byCodec[label];
      const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, x) => a + x, 0) / xs.length : 0);
      const t = timingStats(b.m.flatMap((m) => m.timing.onsetDeltasMs), b.m.flatMap((m) => m.timing.offsetDeltasMs));
      console.log(
        `${ds.id.padEnd(22)}${label.padEnd(7)}` +
          `${mean(b.f1_01).toFixed(3).padEnd(8)}${mean(b.f1_02).toFixed(3).padEnd(8)}` +
          `${t.onsetBiasMs.toFixed(1).padEnd(11)}${b.m.length}`,
      );
    }
  }
}

async function main(): Promise<void> {
  const registry = new ProviderRegistry({
    basicPitch: MODELS.basicPitch,
    crepeTiny: MODELS.crepeTiny,
  });
  await registry.initAll();
  const resolver = new ProfileResolver();

  if (boolEnv('EVAL_REAL')) {
    await runRealCorpus(registry, resolver);
    return;
  }

  const scenarioIds = (process.argv[2] ?? 'voice-tenor,trumpet-mid,flute-high,cello-low')
    .split(',').map((s) => s.trim()).filter(Boolean);
  const melody = process.argv[3] ?? 'tune';

  console.log(
    `\n${'scenario'.padEnd(16)}${'input'.padEnd(7)}` +
      `${'onsetBias'.padEnd(11)}${'std'.padEnd(7)}${'offsetBias'.padEnd(12)}${'F1'.padEnd(6)}n`,
  );
  for (const id of scenarioIds) {
    const scenario = SCENARIOS.find((s) => s.id === id);
    if (!scenario) {
      console.log(`  ${id}: not found`);
      continue;
    }
    const dir = join(EVAL_ROOT, id);
    let truth: GroundTruth;
    let wav: Buffer;
    try {
      truth = JSON.parse(readFileSync(join(dir, `${melody}.truth.json`), 'utf8')) as GroundTruth;
      wav = readFileSync(join(dir, `${melody}__clean.wav`));
    } catch {
      console.log(`  ${id}: missing fixture (${melody}__clean.wav)`);
      continue;
    }
    const beats = 4;
    const webm = await encodeWebmOpus(wav);

    for (const [label, audio] of [['wav', wav], ['webm', webm]] as const) {
      const est = await runThroughPipeline(
        registry, resolver, audio, truth.bpm, beats, scenario.instrumentId ?? '',
      );
      const m = scoreNotes(truth.notes, est);
      const t = m.timing;
      console.log(
        `${id.padEnd(16)}${label.padEnd(7)}` +
          `${t.onsetBiasMs.toFixed(1).padEnd(11)}${t.onsetStdMs.toFixed(0).padEnd(7)}` +
          `${t.offsetBiasMs.toFixed(1).padEnd(12)}${m.f1.toFixed(2).padEnd(6)}${t.matched}`,
      );
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
