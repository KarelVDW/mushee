import { Logger } from '@nestjs/common'
import { type GraphModel, io, loadGraphModel, type Tensor, tensor1d } from '@tensorflow/tfjs'
import { existsSync, readFileSync } from 'fs'
import { join, resolve } from 'path'

import { describeError } from '../describe-error'
import { envFlag } from '../env'
import { ensureWasmBackend, readModelArtifacts } from '../providers/tf-backend'

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

const logger = new Logger('SourceClassifier')

/** Kill-switch, mirroring RECORDING_VOICE_DECODE: `0` disables classification. */
const CLASSIFY = envFlag('RECORDING_SOURCE_CLASSIFY')

const MODEL_DIR = process.env.YAMNET_MODEL_DIR ?? resolve(__dirname, '../../../../model-yamnet')

/** YAMNet's native rate — the resolver's detection rate is defined from it (`DETECT_SAMPLE_RATE`). */
export const YAMNET_SAMPLE_RATE = 16000
/** One 0.96 s YAMNet analysis frame is the minimum decidable audio. */
const MIN_SAMPLES = Math.round(0.96 * YAMNET_SAMPLE_RATE) + 1

/**
 * The two published class groups, fixed a priori from the AudioSet ontology:
 * sung/spoken humanity vs instruments (families + common specifics). Everything
 * else — silence, room tone, noise — votes for neither, which feeds the
 * abstain band.
 */
const VOICE_CLASSES = new Set([
    'Speech',
    'Child speech, kid speaking',
    'Male speech, man speaking',
    'Female speech, woman speaking',
    'Singing',
    'Choir',
    'Yodeling',
    'Chant',
    'Mantra',
    'Male singing',
    'Female singing',
    'Child singing',
    'Synthetic singing',
    'Rapping',
    'Humming',
    'A capella',
    'Vocal music',
])
const INSTRUMENT_CLASSES = new Set([
    'Musical instrument',
    'Plucked string instrument',
    'Guitar',
    'Electric guitar',
    'Bass guitar',
    'Acoustic guitar',
    'Steel guitar, slide guitar',
    'Banjo',
    'Sitar',
    'Mandolin',
    'Ukulele',
    'Keyboard (musical)',
    'Piano',
    'Electric piano',
    'Organ',
    'Electronic organ',
    'Hammond organ',
    'Synthesizer',
    'Harpsichord',
    'Percussion',
    'Marimba, xylophone',
    'Glockenspiel',
    'Vibraphone',
    'Steelpan',
    'Orchestra',
    'Brass instrument',
    'French horn',
    'Trumpet',
    'Trombone',
    'Bowed string instrument',
    'String section',
    'Violin, fiddle',
    'Pizzicato',
    'Cello',
    'Double bass',
    'Wind instrument, woodwind instrument',
    'Flute',
    'Saxophone',
    'Clarinet',
    'Harp',
    'Harmonica',
    'Accordion',
    'Bagpipes',
    'Didgeridoo',
    'Shofar',
    'Theremin',
    'Singing bowl',
    'Musical ensemble',
    'Bass (instrument role)',
])

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
const MIN_TOP = 0.51
const MIN_MARGIN = 0.005

/**
 * Classification never needs more than the lock prefix; cap the input so a
 * late-locking recording cannot make the one-off classify call expensive.
 */
const MAX_CLASSIFY_SEC = 4

export type SourceVerdict = 'voice' | 'instrument'

/**
 * The stock AudioSet class for a person whistling (YAMNet index 35), and how high
 * it must rank among all 521 class scores for the prefix to read as whistling.
 *
 * Whistling is neither of the two groups above: it is the human mouth making a
 * near-sine, so the voice/instrument rule abstains on most whistle takes and the
 * score's instrument prior decides — which sends a whistle on a voice score into
 * the voice decode (measured −0.07 COnP there). The class is used as published,
 * at a rank fixed a priori (top 3, not tuned), so nothing is fitted. Read by the
 * resolver only under `RECORDING_WHISTLE_DETECT=1`; the measured recall and
 * false-positive rate at the lock prefix are on `ProfileResolver`'s whistle family.
 */
const WHISTLING_CLASS = 'Whistling'
const WHISTLING_TOP_K = 3

/** One YAMNet pass over the prefix: the voice/instrument verdict and the whistling verdict. */
export interface SourceAnalysis {
    /** Undefined inside the abstain band (see `decideSource`). */
    source: SourceVerdict | undefined
    /** True when "Whistling" ranks in the top `WHISTLING_TOP_K` of the prefix's class scores. */
    whistling: boolean
}

/** Sigmoid the frame logits and average over frames: one score per class. */
function meanClassScores(frameLogits: Float32Array, frames: number, numClasses: number): Float32Array {
    const mean = new Float32Array(numClasses)
    for (let f = 0; f < frames; f += 1) {
        for (let c = 0; c < numClasses; c += 1) {
            mean[c] += 1 / (1 + Math.exp(-frameLogits[f * numClasses + c]))
        }
    }
    for (let c = 0; c < numClasses; c += 1) mean[c] /= frames
    return mean
}

function sourceFromScores(mean: Float32Array, classNames: string[]): SourceVerdict | undefined {
    let voice = 0
    let instrument = 0
    for (let c = 0; c < mean.length; c += 1) {
        if (VOICE_CLASSES.has(classNames[c])) voice = Math.max(voice, mean[c])
        if (INSTRUMENT_CLASSES.has(classNames[c])) instrument = Math.max(instrument, mean[c])
    }
    if (Math.max(voice, instrument) < MIN_TOP) return undefined
    if (Math.abs(voice - instrument) < MIN_MARGIN) return undefined
    return voice > instrument ? 'voice' : 'instrument'
}

/**
 * A tie counts against the class: on a near-silent prefix every absent class
 * sits at the same ~0.5 floor (see the module notes), and a strict comparison
 * would rank a floor-level "Whistling" second behind "Silence" — which is how a
 * first draft of this rule fired on 2 % of non-whistle prefixes.
 */
function whistlingFromScores(mean: Float32Array, classNames: string[]): boolean {
    const w = classNames.indexOf(WHISTLING_CLASS)
    if (w < 0 || w >= mean.length) return false
    let atOrAbove = 0
    for (let c = 0; c < mean.length; c += 1) if (c !== w && mean[c] >= mean[w]) atOrAbove += 1
    return atOrAbove < WHISTLING_TOP_K
}

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
    return sourceFromScores(meanClassScores(frameLogits, frames, numClasses), classNames)
}

/** Both verdicts from one set of frame logits (pure, like `decideSource`). */
export function analyzeScores(frameLogits: Float32Array, frames: number, numClasses: number, classNames: string[]): SourceAnalysis {
    const mean = meanClassScores(frameLogits, frames, numClasses)
    return { source: sourceFromScores(mean, classNames), whistling: whistlingFromScores(mean, classNames) }
}

/** index,mid,display_name — display_name may be quoted and contain commas. */
export function parseClassMap(csv: string): string[] {
    return csv
        .split('\n')
        .slice(1)
        .filter((l) => l.trim())
        .map((l) => {
            const m = l.match(/^\d+,[^,]+,"?(.*?)"?\s*$/)
            return m ? m[1] : l
        })
}

interface LoadedModel {
    model: GraphModel
    classNames: string[]
}

/**
 * One shared model across every resolver/pipeline instance. Loading kicks off
 * on first use and takes ~a second; classify() abstains until it completes,
 * which degrades to the score prior rather than blocking the profile lock.
 */
let loading: Promise<LoadedModel | null> | null = null
let loaded: LoadedModel | null = null

async function loadModel(): Promise<LoadedModel | null> {
    if (!existsSync(join(MODEL_DIR, 'model.json'))) {
        logger.warn(`YAMNet model not found at ${MODEL_DIR} — source classification off`)
        return null
    }
    await ensureWasmBackend()
    const model = await loadGraphModel(io.fromMemory(await readModelArtifacts(MODEL_DIR)))
    const classNames = parseClassMap(readFileSync(join(MODEL_DIR, 'yamnet_class_map.csv'), 'utf8'))
    logger.log('YAMNet source classifier ready')
    return { model, classNames }
}

export class SourceClassifier {
    constructor() {
        if (!CLASSIFY) return
        if (!loading) {
            loading = loadModel()
                .then((m) => (loaded = m))
                .catch((err: unknown) => {
                    logger.warn(`YAMNet load failed — source classification off: ${describeError(err)}`)
                    return null
                })
        }
    }

    /** Resolves once the model has loaded (or failed). For tests and warm-up. */
    async ready(): Promise<void> {
        await loading
    }

    /**
     * Verdict for a mono 16 kHz prefix, or undefined (not ready / too short /
     * wrong rate / abstain). Synchronous by design — the resolver is synchronous,
     * and YAMNet has no control-flow ops so `execute` runs eagerly.
     */
    classify(samples: Float32Array, sampleRate: number): SourceVerdict | undefined {
        return this.analyze(samples, sampleRate)?.source
    }

    /**
     * Both verdicts from one model pass, or undefined when the model cannot
     * answer at all (not ready / too short / wrong rate / disabled) — distinct
     * from an abstaining `source` on audio it did hear.
     */
    analyze(samples: Float32Array, sampleRate: number): SourceAnalysis | undefined {
        if (!CLASSIFY || !loaded) return undefined
        if (sampleRate !== YAMNET_SAMPLE_RATE || samples.length < MIN_SAMPLES) {
            return undefined
        }
        const capped = samples.subarray(0, Math.min(samples.length, MAX_CLASSIFY_SEC * YAMNET_SAMPLE_RATE))
        const input = tensor1d(capped)
        let outputs: Tensor[] = []
        try {
            const out = loaded.model.execute({ waveform: input })
            outputs = Array.isArray(out) ? out : [out]
            const scoresT = outputs.find((t) => t.shape[t.shape.length - 1] === 521)
            if (!scoresT) return undefined
            const [frames, numClasses] = scoresT.shape as [number, number]
            return analyzeScores(scoresT.dataSync() as Float32Array, frames, numClasses, loaded.classNames)
        } catch (err) {
            logger.warn(`YAMNet classify failed: ${describeError(err)}`)
            return undefined
        } finally {
            input.dispose()
            outputs.forEach((t) => t.dispose())
        }
    }
}
