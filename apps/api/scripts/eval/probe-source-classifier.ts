/**
 * Feasibility probe for a TRAINING-FREE voice/instrument source classifier.
 *
 * Question: can stock YAMNet class scores — no fitted head, no training,
 * thresholding published AudioSet classes only — decide "voice or instrument"
 * from the same ≥0.96 s audio prefix the profile lock already waits for?
 * If yes, the recording UI's mic-source chip can become a confirmation rather
 * than a required control, and a wrong score-instrument prior stops mis-routing
 * takes (the choice is worth ~0.10 COnP on real singing).
 *
 * Policy note: the project never trains model weights (including tiny heads —
 * see research/research-voice-transcription.md D5). This probe uses YAMNet's published
 * classifier output as-is: the "rule" is a fixed comparison of two published
 * class groups, chosen a priori (singing/speech classes vs instrument classes).
 *
 * Ground truth: every dataset in fixtures/eval-real declares its kind in
 * dataset.json — voice corpora vs instrument corpora — so accuracy needs no
 * new labels.
 *
 * Model: YAMNet TF.js GraphModel (Apache-2.0), cached in .cache/yamnet by:
 *   curl -sL -o .cache/yamnet/yamnet-tfjs.tar.gz \
 *     https://www.kaggle.com/api/v1/models/google/yamnet/tfJs/tfjs/1/download
 *   tar xzf … ; plus yamnet_class_map.csv from tensorflow/models.
 *
 * Run: pnpm --filter @mushee/api exec tsx scripts/eval/probe-source-classifier.ts
 *      PREFIX_SEC=1.2   how much leading audio the classifier sees (default 1.2,
 *                       the profile lock's own budget)
 */

import { type GraphModel, io, loadGraphModel, tensor1d } from '@tensorflow/tfjs'
import { existsSync, readFileSync } from 'fs'
import { join, resolve } from 'path'

import { AudioDecoder } from '../../src/recordings/pipeline/audio-decoder'
import { ensureWasmBackend } from '../../src/recordings/pipeline/providers/tf-backend'
import { discoverRealDatasets, listRealClips } from './lib/realCorpus'

const YAMNET_DIR = resolve(__dirname, '.cache/yamnet')
const REAL_ROOT = resolve(__dirname, '../fixtures/eval-real')
const PREFIX_SEC = Number(process.env.PREFIX_SEC ?? '1.2')
const YAMNET_SR = 16000
/** YAMNet's minimum input: one 0.96 s analysis frame. */
const MIN_SAMPLES = Math.round(0.96 * YAMNET_SR) + 1

/**
 * The two class groups, fixed a priori from the published AudioSet ontology.
 * Sung/spoken humanity on one side; instruments (families + common specifics)
 * on the other. Everything else (silence, noise, room tone) votes for neither.
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

function loadClassNames(): string[] {
    const csv = readFileSync(join(YAMNET_DIR, 'yamnet_class_map.csv'), 'utf8')
    return csv
        .split('\n')
        .slice(1)
        .filter((l) => l.trim())
        .map((l) => {
            // index,mid,display_name — display_name may be quoted and contain commas.
            const m = l.match(/^\d+,[^,]+,"?(.*?)"?\s*$/)
            return m ? m[1] : l
        })
}

async function loadYamnet(): Promise<GraphModel> {
    await ensureWasmBackend()
    const modelJson = JSON.parse(readFileSync(join(YAMNET_DIR, 'model.json'), 'utf8')) as io.ModelJSON
    const weightSpecs = modelJson.weightsManifest.flatMap((e) => e.weights)
    const shards = modelJson.weightsManifest.flatMap((e) => e.paths)
    const buffers = shards.map((p) => readFileSync(join(YAMNET_DIR, p)))
    const total = buffers.reduce((n, b) => n + b.byteLength, 0)
    const weightData = new Uint8Array(total)
    let off = 0
    for (const b of buffers) {
        weightData.set(new Uint8Array(b.buffer, b.byteOffset, b.byteLength), off)
        off += b.byteLength
    }
    return loadGraphModel(
        io.fromMemory({
            modelTopology: modelJson.modelTopology,
            weightSpecs,
            weightData: weightData.buffer,
        }),
    )
}

interface Verdict {
    voiceScore: number
    instrumentScore: number
    top: string
}

function classify(model: GraphModel, classNames: string[], samples: Float32Array): Verdict {
    const input = tensor1d(samples)
    const out = model.execute({ waveform: input })
    const outputs = Array.isArray(out) ? out : [out]
    // The tfjs conversion emits three tensors — log-mel spectrogram [t, 64],
    // embeddings [frames, 1024] and class LOGITS [frames, 521]; pick by width.
    const scoresT = outputs.find((t) => t.shape[t.shape.length - 1] === 521)
    if (!scoresT) throw new Error('no 521-class output found')
    const scores = scoresT.dataSync() as Float32Array
    const [frames, numClasses] = scoresT.shape as [number, number]
    input.dispose()
    outputs.forEach((t) => t.dispose())

    // Per-frame sigmoid (the graph model emits logits), mean over frames, then
    // compare the two published class groups by their STRONGEST member. A sum
    // was tried first and is wrong for this conversion: absent classes sit near
    // 0.5, so a group sum measures the group's size (48 instrument names vs 17
    // voice names), not the audio. The max asks "what is the strongest voice
    // hypothesis vs the strongest instrument hypothesis", which is size-invariant.
    const mean = new Float32Array(numClasses)
    for (let f = 0; f < frames; f += 1) {
        for (let c = 0; c < numClasses; c += 1) {
            mean[c] += 1 / (1 + Math.exp(-scores[f * numClasses + c]))
        }
    }
    let voice = 0
    let instrument = 0
    let top = 0
    for (let c = 0; c < numClasses; c += 1) {
        mean[c] /= frames
        if (VOICE_CLASSES.has(classNames[c])) voice = Math.max(voice, mean[c])
        if (INSTRUMENT_CLASSES.has(classNames[c])) instrument = Math.max(instrument, mean[c])
        if (mean[c] > mean[top]) top = c
    }
    return { voiceScore: voice, instrumentScore: instrument, top: classNames[top] }
}

async function main(): Promise<void> {
    if (!existsSync(join(YAMNET_DIR, 'model.json'))) {
        console.error(`YAMNet model not found in ${YAMNET_DIR} — see header for fetch commands.`)
        process.exit(1)
    }
    const classNames = loadClassNames()
    const model = await loadYamnet()
    const decoder = new AudioDecoder()

    // Classify every clip ONCE, then evaluate candidate abstain bands over the
    // recorded (voice, instrument) score pairs. An abstain falls back to the
    // score-instrument prior in production, so it is a coverage cost, not an
    // error — the table below is the trade the band buys.
    const datasets = discoverRealDatasets(REAL_ROOT)
    interface Row {
        ds: string
        clip: string
        truthVoice: boolean
        v: Verdict
    }
    const all: Row[] = []
    for (const ds of datasets) {
        const truthVoice = ds.kind === 'voice'
        for (const clip of listRealClips(ds.dir)) {
            const wav = join(ds.dir, `${clip}__real.wav`)
            if (!existsSync(wav)) continue
            const decoded = await decoder.decode(readFileSync(wav), YAMNET_SR, {
                loudnorm: false,
                highpassHz: 30,
            })
            const want = Math.max(MIN_SAMPLES, Math.round(PREFIX_SEC * YAMNET_SR))
            if (decoded.samples.length < MIN_SAMPLES) continue
            const prefix = decoded.samples.subarray(0, Math.min(want, decoded.samples.length))
            all.push({ ds: ds.id, clip, truthVoice, v: classify(model, classNames, prefix) })
        }
    }

    console.log(`\nStock-YAMNet source classification @ ${PREFIX_SEC}s prefix, ${all.length} clips`)
    const BANDS: [number, number][] = [
        [0, 0], // forced choice
        [0.51, 0.005],
        [0.52, 0.01],
        [0.53, 0.015],
        [0.55, 0.02],
    ]
    for (const [minTop, minMargin] of BANDS) {
        let right = 0
        let wrong = 0
        let abstain = 0
        const mistakes: string[] = []
        for (const r of all) {
            const strongest = Math.max(r.v.voiceScore, r.v.instrumentScore)
            const margin = Math.abs(r.v.voiceScore - r.v.instrumentScore)
            if (strongest < minTop || margin < minMargin) {
                abstain += 1
                continue
            }
            const ok = r.v.voiceScore > r.v.instrumentScore === r.truthVoice
            if (ok) right += 1
            else {
                wrong += 1
                if (mistakes.length < 12) {
                    mistakes.push(
                        `    ${r.ds}/${r.clip}: voice=${r.v.voiceScore.toFixed(3)} ` +
                            `instr=${r.v.instrumentScore.toFixed(3)} top="${r.v.top}"`,
                    )
                }
            }
        }
        const decided = right + wrong
        console.log(
            `  band top≥${minTop} margin≥${minMargin}: decided ${right}/${decided} = ` +
                `${((100 * right) / decided).toFixed(2)}%, abstain ${abstain}/${all.length} ` +
                `(${((100 * abstain) / all.length).toFixed(1)}%)`,
        )
        if (minTop === 0.52 && mistakes.length) {
            console.log(`  mistakes at this band:\n${mistakes.join('\n')}`)
        }
    }
}

void main()
