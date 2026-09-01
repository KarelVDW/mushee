import { Logger } from '@nestjs/common';
import { type GraphModel, io, loadGraphModel, type Tensor,tensor1d } from '@tensorflow/tfjs';
import { existsSync, readFileSync } from 'fs';
import { join, resolve } from 'path';

import { ensureWasmBackend } from '../providers/tf-backend';

/**
 * Training-free voice/instrument source classification from the recording's
 * first ~1.2 s — the same prefix the profile lock already waits for.
 *
 * ## Why this exists
 *
 * Routing to the voice decode is worth ~0.10 COnP on real singing, and until
 * this classifier the routing signal was the score's instrument family plus an
 * explicit user choice in the recording UI. The score prior is wrong exactly
 * when someone sings a line into an instrument staff, and the UI control is a
 * required decision the user should not have to make. This classifier answers
 * from the audio instead, so the client no longer needs to send `sourceKind`;
 * an explicit client choice still wins when present.
 *
 * ## Why it does not violate the no-training policy
 *
 * The project never trains model weights — not even a logistic head (see
 * research/research-voice-transcription.md, policy note + D5). YAMNet is used strictly
 * as published (Apache-2.0 checkpoint, stock AudioSet classes); the "rule" is a
 * fixed comparison of two published class groups chosen a priori, with an
 * abstain band. Nothing here is fitted.
 *
 * ## Measured (scripts/eval/probe-source-classifier.ts, 1,148 real clips)
 *
 * Stock YAMNet at the 1.2 s prefix separates the harness's voice corpora
 * (annotated-vocalset, ESMUC, CSD, HUST, vocadito, N20EMv2, mir-qbsh) from its
 * instrument corpora (GuitarSet, 13 URMP instruments) at **97.7 %** with a
 * forced choice; the residue is almost entirely near-silent prefixes (the take
 * has not started yet), which the abstain band converts from errors into
 * fallbacks to the score prior. See the findings log for the abstain-rule
 * numbers.
 *
 * ## Mechanics worth knowing
 *
 * - The TF.js conversion emits three tensors; the class output is selected by
 *   its width (521) and holds **logits**, not probabilities.
 * - Absent classes sit near sigmoid(0) = 0.5 in this conversion, so group
 *   SUMS measure group size, not audio; the rule compares each group's
 *   strongest member instead.
 * - Runs on the CPU wasm backend in ~a hundred ms for 1.2 s of audio —
 *   comfortably inside the profile lock's existing budget.
 */

const logger = new Logger('SourceClassifier');

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Kill-switch, mirroring RECORDING_VOICE_DECODE: `0` disables classification. */
const CLASSIFY = process.env.RECORDING_SOURCE_CLASSIFY !== '0';

const MODEL_DIR = process.env.YAMNET_MODEL_DIR ?? resolve(__dirname, '../../../../model-yamnet');

/** YAMNet's native rate — happily also the pipeline's detect rate. */
export const YAMNET_SAMPLE_RATE = 16000;
/** One 0.96 s YAMNet analysis frame is the minimum decidable audio. */
const MIN_SAMPLES = Math.round(0.96 * YAMNET_SAMPLE_RATE) + 1;

/**
 * The two published class groups, fixed a priori from the AudioSet ontology:
 * sung/spoken humanity vs instruments (families + common specifics). Everything
 * else — silence, room tone, noise — votes for neither, which feeds the
 * abstain band.
 */
const VOICE_CLASSES = new Set([
  'Speech', 'Child speech, kid speaking', 'Male speech, man speaking',
  'Female speech, woman speaking', 'Singing', 'Choir', 'Yodeling', 'Chant',
  'Mantra', 'Male singing', 'Female singing', 'Child singing',
  'Synthetic singing', 'Rapping', 'Humming', 'A capella', 'Vocal music',
]);
const INSTRUMENT_CLASSES = new Set([
  'Musical instrument', 'Plucked string instrument', 'Guitar',
  'Electric guitar', 'Bass guitar', 'Acoustic guitar',
  'Steel guitar, slide guitar', 'Banjo', 'Sitar', 'Mandolin', 'Ukulele',
  'Keyboard (musical)', 'Piano', 'Electric piano', 'Organ',
  'Electronic organ', 'Hammond organ', 'Synthesizer', 'Harpsichord',
  'Percussion', 'Marimba, xylophone', 'Glockenspiel', 'Vibraphone',
  'Steelpan', 'Orchestra', 'Brass instrument', 'French horn', 'Trumpet',
  'Trombone', 'Bowed string instrument', 'String section', 'Violin, fiddle',
  'Pizzicato', 'Cello', 'Double bass',
  'Wind instrument, woodwind instrument', 'Flute', 'Saxophone', 'Clarinet',
  'Harp', 'Harmonica', 'Accordion', 'Bagpipes', 'Didgeridoo', 'Shofar',
  'Theremin', 'Singing bowl', 'Musical ensemble', 'Bass (instrument role)',
]);

/**
 * Abstain band. Below MIN_TOP no group hypothesis rose meaningfully above the
 * conversion's ~0.5 absent-class floor (typically: the take has not started
 * yet); below MIN_MARGIN the two groups are within noise of each other. An
 * abstain is not an error — the resolver falls back to the score's instrument
 * prior, exactly the pre-classifier behaviour.
 *
 * Measured trade at the 1.2 s prefix over 1,148 real clips (probe script):
 * forced choice 97.74 % · this band 98.72 % decided with 11.8 % abstain ·
 * (0.52, 0.01) buys 99.1 % but abstains 21 %. The residual errors at every
 * band are choral soprano stems with heavy neighbour bleed reading as
 * "Flute"/"Theremin" — off the product's input distribution.
 */
const MIN_TOP = 0.51;
const MIN_MARGIN = 0.005;

/**
 * Classification never needs more than the lock prefix; cap the input so a
 * late-locking recording cannot make the one-off classify call expensive.
 */
const MAX_CLASSIFY_SEC = 4;

export type SourceVerdict = 'voice' | 'instrument';

/**
 * The decision rule, pure so it is testable without the model: sigmoid the
 * frame logits, average over frames, compare each group's strongest member,
 * abstain inside the band.
 */
export function decideSource(
  frameLogits: Float32Array,
  frames: number,
  numClasses: number,
  classNames: string[],
): SourceVerdict | undefined {
  const mean = new Float32Array(numClasses);
  for (let f = 0; f < frames; f += 1) {
    for (let c = 0; c < numClasses; c += 1) {
      mean[c] += 1 / (1 + Math.exp(-frameLogits[f * numClasses + c]));
    }
  }
  let voice = 0;
  let instrument = 0;
  for (let c = 0; c < numClasses; c += 1) {
    mean[c] /= frames;
    if (VOICE_CLASSES.has(classNames[c])) voice = Math.max(voice, mean[c]);
    if (INSTRUMENT_CLASSES.has(classNames[c])) instrument = Math.max(instrument, mean[c]);
  }
  if (Math.max(voice, instrument) < MIN_TOP) return undefined;
  if (Math.abs(voice - instrument) < MIN_MARGIN) return undefined;
  return voice > instrument ? 'voice' : 'instrument';
}

/** index,mid,display_name — display_name may be quoted and contain commas. */
export function parseClassMap(csv: string): string[] {
  return csv
    .split('\n')
    .slice(1)
    .filter((l) => l.trim())
    .map((l) => {
      const m = l.match(/^\d+,[^,]+,"?(.*?)"?\s*$/);
      return m ? m[1] : l;
    });
}

interface LoadedModel {
  model: GraphModel;
  classNames: string[];
}

/**
 * One shared model across every resolver/pipeline instance. Loading kicks off
 * on first use and takes ~a second; classify() abstains until it completes,
 * which degrades to the score prior rather than blocking the profile lock.
 */
let loading: Promise<LoadedModel | null> | null = null;
let loaded: LoadedModel | null = null;

async function loadModel(): Promise<LoadedModel | null> {
  if (!existsSync(join(MODEL_DIR, 'model.json'))) {
    logger.warn(`YAMNet model not found at ${MODEL_DIR} — source classification off`);
    return null;
  }
  await ensureWasmBackend();
  const modelJson = JSON.parse(
    readFileSync(join(MODEL_DIR, 'model.json'), 'utf8'),
  ) as io.ModelJSON;
  const weightSpecs = modelJson.weightsManifest.flatMap((e) => e.weights);
  const shards = modelJson.weightsManifest.flatMap((e) => e.paths);
  const buffers = shards.map((p) => readFileSync(join(MODEL_DIR, p)));
  const total = buffers.reduce((n, b) => n + b.byteLength, 0);
  const weightData = new Uint8Array(total);
  let off = 0;
  for (const b of buffers) {
    weightData.set(new Uint8Array(b.buffer, b.byteOffset, b.byteLength), off);
    off += b.byteLength;
  }
  const model = await loadGraphModel(
    io.fromMemory({
      modelTopology: modelJson.modelTopology,
      weightSpecs,
      weightData: weightData.buffer,
    }),
  );
  const classNames = parseClassMap(
    readFileSync(join(MODEL_DIR, 'yamnet_class_map.csv'), 'utf8'),
  );
  logger.log('YAMNet source classifier ready');
  return { model, classNames };
}

export class SourceClassifier {
  constructor() {
    if (!CLASSIFY) return;
    if (!loading) {
      loading = loadModel()
        .then((m) => (loaded = m))
        .catch((err: unknown) => {
          logger.warn(
            `YAMNet load failed — source classification off: ${describeError(err)}`,
          );
          return null;
        });
    }
  }

  /** Whether classification can ever produce a verdict in this process. */
  get enabled(): boolean {
    return CLASSIFY;
  }

  /** Resolves once the model has loaded (or failed). For tests and warm-up. */
  async ready(): Promise<void> {
    await loading;
  }

  /**
   * Verdict for a mono 16 kHz prefix, or undefined (not ready / too short /
   * wrong rate / abstain). Synchronous by design — the resolver is synchronous,
   * and YAMNet has no control-flow ops so `execute` runs eagerly.
   */
  classify(samples: Float32Array, sampleRate: number): SourceVerdict | undefined {
    if (!CLASSIFY || !loaded) return undefined;
    if (sampleRate !== YAMNET_SAMPLE_RATE || samples.length < MIN_SAMPLES) {
      return undefined;
    }
    const capped = samples.subarray(
      0,
      Math.min(samples.length, MAX_CLASSIFY_SEC * YAMNET_SAMPLE_RATE),
    );
    const input = tensor1d(capped);
    let outputs: Tensor[] = [];
    try {
      const out = loaded.model.execute({ waveform: input });
      outputs = Array.isArray(out) ? (out) : [out];
      const scoresT = outputs.find((t) => t.shape[t.shape.length - 1] === 521);
      if (!scoresT) return undefined;
      const [frames, numClasses] = scoresT.shape as [number, number];
      return decideSource(
        scoresT.dataSync() as Float32Array,
        frames,
        numClasses,
        loaded.classNames,
      );
    } catch (err) {
      logger.warn(`YAMNet classify failed: ${describeError(err)}`);
      return undefined;
    } finally {
      input.dispose();
      outputs.forEach((t) => t.dispose());
    }
  }
}
