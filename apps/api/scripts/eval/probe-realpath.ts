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
import { readFileSync } from 'fs';
import { join, resolve } from 'path';

import ffmpegPath from 'ffmpeg-static';

import type { MxmlMeasure } from '../../src/recordings/mxml.types';
import { ProfileResolver } from '../../src/recordings/profiles/ProfileResolver';
import { ProviderRegistry } from '../../src/recordings/providers/ProviderRegistry';
import { RecordingPipeline } from '../../src/recordings/RecordingPipeline';
import { scoreNotes, type EstNote } from './lib/metrics';
import { SCENARIOS } from './scenarios';
import type { GroundTruth } from './types';

const EVAL_ROOT = resolve(__dirname, '../fixtures/eval');
const MODELS = {
  basicPitch: resolve(process.cwd(), 'model'),
  crepeFull: resolve(process.cwd(), 'model-crepe-full'),
  crepeTiny: resolve(process.cwd(), 'model-crepe-tiny'),
  pesto: resolve(process.cwd(), 'model-pesto'),
};
const STEP_SEMITONE: Record<string, number> = {
  C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11,
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
      if (!o.length) rej(new Error(`encode failed (${code}): ${Buffer.concat(err)}`));
      else res(o);
    });
    proc.stdin.on('error', () => {});
    proc.stdin.end(wav);
  });
}

/** Walk the emitted MusicXML measures back into onset/duration/pitch notes. */
function measuresToNotes(
  measures: Record<number, MxmlMeasure>,
  beatsPerMeasure: number,
  bpm: number,
  chromaticTranspose: number,
): EstNote[] {
  const indices = Object.keys(measures).map(Number).sort((a, b) => a - b);
  let divisions = 12;
  for (const idx of indices) {
    for (const e of measures[idx].entries) {
      if (e._type === 'attributes' && e.divisions) divisions = e.divisions;
    }
  }
  const notes: EstNote[] = [];
  const secPerBeat = 60 / bpm;
  let pending: EstNote | null = null;

  for (const idx of indices) {
    const measureStartBeat = idx * beatsPerMeasure;
    let cursorBeat = 0;
    for (const e of measures[idx].entries) {
      if (e._type !== 'note') continue;
      const durBeats = e.duration / divisions;
      if (e.rest) {
        cursorBeat += durBeats;
        continue;
      }
      const onsetSec = (measureStartBeat + cursorBeat) * secPerBeat;
      const midi =
        e.pitch != null
          ? (e.pitch.octave + 1) * 12 +
            STEP_SEMITONE[e.pitch.step] +
            (e.pitch.alter ?? 0) +
            chromaticTranspose
          : 0;
      const hasStart = e.tie?.some((t) => t.type === 'start') ?? false;
      const hasStop = e.tie?.some((t) => t.type === 'stop') ?? false;
      if (!hasStop) {
        // standalone or first of a tie chain
        if (pending) notes.push(pending);
        pending = { onsetSec, durSec: durBeats * secPerBeat, midi };
        if (!hasStart) {
          notes.push(pending);
          pending = null;
        }
      } else if (pending) {
        // continuation of a tie chain
        pending.durSec += durBeats * secPerBeat;
        if (!hasStart) {
          notes.push(pending);
          pending = null;
        }
      }
      cursorBeat += durBeats;
    }
  }
  if (pending) notes.push(pending);
  return notes;
}

async function runThroughPipeline(
  registry: ProviderRegistry,
  resolver: ProfileResolver,
  audio: Buffer,
  bpm: number,
  beats: number,
  instrumentId: string,
): Promise<EstNote[]> {
  const pipeline = new RecordingPipeline(registry, resolver);
  pipeline.setMeta({
    bpm,
    timeSignature: { beats, beatType: 4 },
    chromaticTranspose: 0,
    instrumentId,
  });
  const acc: Record<number, MxmlMeasure> = {};
  pipeline.setOnUpdate((u) => {
    for (const [k, v] of Object.entries(u.measures)) acc[Number(k)] = v;
  });
  // Stream in ~100 ms-equivalent byte slices, like MediaRecorder.start(100);
  // the pipeline concatenates before decoding so the slicing is cosmetic.
  const CHUNKS = 12;
  const size = Math.ceil(audio.byteLength / CHUNKS);
  for (let o = 0; o < audio.byteLength; o += size) {
    pipeline.appendChunk(audio.subarray(o, Math.min(o + size, audio.byteLength)));
  }
  await pipeline.finalize();
  return measuresToNotes(acc, beats, bpm, 0);
}

async function main(): Promise<void> {
  const scenarioIds = (process.argv[2] ?? 'voice-tenor,trumpet-mid,flute-high,cello-low')
    .split(',').map((s) => s.trim()).filter(Boolean);
  const melody = process.argv[3] ?? 'tune';

  const registry = new ProviderRegistry({
    basicPitch: MODELS.basicPitch,
    crepeFull: MODELS.crepeFull,
    crepeTiny: MODELS.crepeTiny,
    pesto: MODELS.pesto,
  });
  await registry.initAll();
  const resolver = new ProfileResolver();

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
      truth = JSON.parse(readFileSync(join(dir, `${melody}.truth.json`), 'utf8'));
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
