/**
 * Long-lived transcription worker for apps/eval: loads the production
 * ProviderRegistry + ProfileResolver ONCE, then serves line-delimited JSON
 * requests over stdin — one recorded clip through the real RecordingPipeline
 * per request, scored against the clip's ground truth with the same metrics
 * run-eval.ts reports. Keeping the process alive is what makes the UI's
 * "retry" button and the record-next-clip flow feel instant instead of
 * paying the ~seconds TF model load on every take.
 *
 * Must run with cwd = apps/api (models resolve from process.cwd(), exactly
 * like run-eval.ts). Protocol, one JSON object per line:
 *
 *   in : { id, wavPath, bpm, beatsPerMeasure, instrumentId?, truth? }
 *   out: '@@RES ' + { id, ok, notes, measures, metrics?, seg?, onsetOnly?, error? }
 *
 * A single '@@READY' line signals the models are loaded. Everything else on
 * stdout is pipeline log noise the caller should ignore.
 */

import { readFileSync } from 'fs';
import { createInterface } from 'readline';
import { resolve } from 'path';

import type { MxmlMeasure } from '../../src/recordings/pipeline/mxml.types';
import { ProfileResolver } from '../../src/recordings/pipeline/profiles/profile-resolver';
import { ProviderRegistry } from '../../src/recordings/pipeline/providers/provider-registry';
import { RecordingPipeline } from '../../src/recordings/pipeline/recording-pipeline';
import { type EstNote, type MatchOptions, scoreNotesBest, scoreOnsets } from './lib/metrics';
import { measuresToNotes } from './lib/pipelineRun';
import { segErrors } from './lib/segErrors';
import type { GroundTruth } from './types';

interface Request {
  id: number;
  wavPath: string;
  bpm: number;
  beatsPerMeasure: number;
  instrumentId?: string;
  truth?: GroundTruth;
}

const MATCH_OPTS: MatchOptions = { onsetTolSec: 0.1, timingTolSec: 0.3 };

function respond(payload: unknown): void {
  process.stdout.write('@@RES ' + JSON.stringify(payload) + '\n');
}

async function transcribe(
  registry: ProviderRegistry,
  resolver: ProfileResolver,
  req: Request,
): Promise<{ notes: EstNote[]; measures: Record<number, MxmlMeasure> }> {
  const audio = readFileSync(req.wavPath);
  const pipeline = new RecordingPipeline(registry, resolver);
  pipeline.setMeta({
    bpm: req.bpm,
    timeSignature: { beats: req.beatsPerMeasure, beatType: 4 },
    chromaticTranspose: 0,
    instrumentId: req.instrumentId,
  });
  const measures: Record<number, MxmlMeasure> = {};
  pipeline.setOnUpdate((u) => {
    for (const [k, v] of Object.entries(u.measures)) measures[Number(k)] = v;
  });
  const CHUNKS = 12;
  const size = Math.ceil(audio.byteLength / CHUNKS);
  for (let o = 0; o < audio.byteLength; o += size) {
    pipeline.appendChunk(audio.subarray(o, Math.min(o + size, audio.byteLength)));
  }
  await pipeline.finalize();
  return { notes: measuresToNotes(measures, req.beatsPerMeasure, req.bpm, 0), measures };
}

async function main(): Promise<void> {
  const registry = new ProviderRegistry({
    basicPitch: resolve(process.cwd(), 'model'),
    crepeTiny: resolve(process.cwd(), 'model-crepe-tiny'),
  });
  await registry.initAll();
  const resolver = new ProfileResolver();
  process.stdout.write('@@READY\n');

  // Serialize requests: the pipeline is CPU-bound, parallel takes just thrash.
  let chain: Promise<void> = Promise.resolve();
  const rl = createInterface({ input: process.stdin });
  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    chain = chain.then(async () => {
      let req: Request | null = null;
      try {
        req = JSON.parse(trimmed) as Request;
        const { notes, measures } = await transcribe(registry, resolver, req);
        respond({
          id: req.id,
          ok: true,
          notes,
          measures,
          metrics: req.truth ? scoreNotesBest(req.truth, notes, MATCH_OPTS) : undefined,
          seg: req.truth ? segErrors(req.truth.notes, notes) : undefined,
          onsetOnly: req.truth ? scoreOnsets(req.truth.notes, notes, MATCH_OPTS.onsetTolSec) : undefined,
        });
      } catch (err) {
        respond({ id: req?.id ?? -1, ok: false, error: String(err) });
      }
    });
  });
  rl.on('close', () => {
    void chain.then(() => process.exit(0));
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
