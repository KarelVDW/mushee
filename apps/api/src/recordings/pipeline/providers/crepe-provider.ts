import { Logger } from '@nestjs/common'

import { envOptionalNumber } from '../env'
import type { NoteEventTime } from '../note-event'
import { PitchTrack, type ReverbEvidence } from '../pitch-track'
import { REVERB_DECODE_ADAPTATION, type ReverbDecision } from '../profiles/reverberance'
import { frameEnergy, SEGMENT_DEFAULTS, segmentNotes, type SegmentOptions } from '../semitone-segmenter'
import { SHIPPING_VOICE_OPTS, VoiceNoteDecoder } from '../voice-note-decoder'
import { localCentsFromPath, normalizeFrame, topKCandidates, viterbi, type ViterbiOptions } from './crepe-decoding'
import type { ModelBackend } from './model-backend'
import type { PitchSession, PitchTranscribeOptions, TrajectoryProvider } from './pitch-provider'

/** CREPE was trained on 16 kHz mono audio. */
const SAMPLE_RATE = 16000
/** Per-frame window the CREPE network expects. */
const FRAME_SIZE = 1024
/** Hop between frame starts. 320 = 20 ms; coarser than CREPE's default 10 ms,
 *  but a quarter of the inference cost and plenty for note-level transcription. */
const HOP_SIZE = 320
/** CREPE outputs 360 sigmoid units mapped linearly across 7180 cents,
 *  offset so that bin 0 ≈ 31.7 Hz (~C1). */
const NUM_BINS = 360
const CREPE_CENTS_RANGE = 7180
/** Cents value of bin 0 — comes straight from the upstream demo. */
const CREPE_CENTS_OFFSET = 1997.3794084376191
/** Inference batch size (frames per model.predict call). Larger = better
 *  throughput, more peak memory. */
const INFERENCE_BATCH = 256
/** Half-width in bins of the local weighted-mean window, centered on the
 *  Viterbi path bin. 4 → 9-bin window matches marl/crepe's reference. */
const LOCAL_AVG_HALF_WIDTH = 4
/** Candidates carried per frame on the track (E3/R9 — pYIN §5.6). */
const PITCH_CANDIDATES_K = 5
/**
 * σ in bins for the Viterbi transition kernel. 12 bins ≈ 240 cents at CREPE's
 * 20.0 cents/bin spacing.
 *
 * Note this is NOT the same construction as marl/crepe's `to_viterbi_cents`, which
 * an earlier comment here claimed: upstream uses a *triangular* distribution with a
 * hard cutoff at ±12 bins, whereas this is a Gaussian σ truncated at ±`bandBins`.
 * The behaviours differ, so do not treat the two as interchangeable.
 */
const VITERBI_SIGMA_BINS = 12
/**
 * ±band beyond which the transition kernel is truncated. 4·σ keeps us well within
 * the tail (transitions there contribute < 3.4e-4).
 *
 * A useful consequence: CREPE's grid is exactly 60.0 bins per octave, and 48 < 60,
 * so a one-frame octave jump lies outside the band and is **impossible** under this
 * decode. Any octave error we see therefore cannot be born mid-phrase — it can only
 * originate at a voicing onset, where the first frame is scored under a uniform
 * prior with no predecessor to constrain it. That narrows where to look.
 */
const VITERBI_BAND_BINS = VITERBI_SIGMA_BINS * 4
/** Trailing cached frames recomputed every pass. ffmpeg's resampler tail
 *  produces slightly different output samples when given a longer input, so
 *  the very last cached frames are tentative until the next pass confirms them. */
const RECOMPUTE_TAIL_FRAMES = 5

/**
 * Jump-cost floor for the transition prior (see ViterbiOptions.jumpLogFloor),
 * in nats — e.g. -2.5 lets the path leave a reverb tail after a few frames of
 * evidence for the new note. OFF BY DEFAULT: the 2026-07 adverse eval measured
 * it within noise on the synthetic matrix (-0.001 overall) and mildly negative
 * on real reverberant singing — the reverb-tail-tracking theory it encodes is
 * not what actually limits reverb recall. Set RECORDING_VITERBI_JUMP_FLOOR to
 * a negative number to experiment.
 */
const VITERBI_JUMP_FLOOR = envOptionalNumber('RECORDING_VITERBI_JUMP_FLOOR')

const VITERBI_OPTS: ViterbiOptions = {
    numBins: NUM_BINS,
    sigmaBins: VITERBI_SIGMA_BINS,
    bandBins: VITERBI_BAND_BINS,
    jumpLogFloor: VITERBI_JUMP_FLOOR,
}

const SEGMENT_OPTS: SegmentOptions = {
    ...SEGMENT_DEFAULTS,
    hopSize: HOP_SIZE,
    sampleRate: SAMPLE_RATE,
    minFreqHz: 65,
    maxFreqHz: 1100,
}

/**
 * Per-recording state for the CREPE provider: CNN activations cached by absolute
 * frame index, which is what makes re-passing the whole growing buffer
 * incremental — and why it must never be fed a sliding window.
 */
class CrepeSession implements PitchSession {
    cachedFrames = 0
    activations: Float32Array = new Float32Array(0)
    confidence: Float32Array = new Float32Array(0)
    /**
     * Reverb evidence frozen once enough loud audio exists (`ReverbDecodeAdaptation`):
     * a live take keeps one gate instead of one per pass. Only with the adaptation on.
     */
    frozenEvidence: ReverbEvidence | undefined
    /** Every distinct decision a pass of this session ran with, keyed — see `voicingAdaptationDrifted`. */
    readonly decisions = new Map<string, ReverbDecision>()
    /** The latest pass's decision: after the final pass, the whole take's. */
    lastDecision: ReverbDecision | undefined
}

/**
 * Monophonic pitch transcriber on the crepe-tiny CREPE model, whose forward pass
 * runs through a `ModelBackend` (in-process TF.js or the remote gRPC service).
 * Takes 16 kHz audio (its declared `sampleRate` — the decoder resamples), slides
 * 1024-sample windows, runs the CNN to get per-frame activations, decodes a
 * smooth pitch trajectory via Viterbi, then segments it into `NoteEventTime[]`
 * (runs of stable pitch, or the voice decode when the profile routes voice).
 */
export class CrepeProvider implements TrajectoryProvider {
    readonly name: string
    readonly sampleRate = SAMPLE_RATE
    readonly normalizeLoudness = false
    readonly hasNativeOnsets = false

    private readonly logger = new Logger(CrepeProvider.name)
    private readonly centMapping: Float32Array = buildCentMapping()

    /**
     * @param timeScale model seconds per real second of the audio this provider is
     *   fed — 1 at pitch; the octave-down wrapper feeds it half-speed audio (2). Only
     *   the decode-side reverb adaptation reads it, so its seconds stay real seconds.
     */
    constructor(
        private readonly backend: ModelBackend,
        name: string,
        private readonly timeScale = 1,
    ) {
        this.name = name
        this.logger.log(`${name} provider ready`)
    }

    async init(): Promise<void> {
        await this.backend.warm('crepe-tiny')
    }

    createSession(): CrepeSession {
        return new CrepeSession()
    }

    async transcribe(samples: Float32Array, options?: PitchTranscribeOptions, session?: PitchSession): Promise<NoteEventTime[]> {
        const sess = session instanceof CrepeSession ? session : new CrepeSession()
        const track = await this.track(samples, sess)
        if (!track) return []
        const voice = options?.segmentMode === 'voice'
        // The envelope on the trajectory's own frame grid: the voice decoder's dip and
        // accent channels read it, and so does the reverb evidence. Computed here
        // because this is the only place holding both the decoded PCM and the grid it
        // must align to — the channels are meaningless if the two are off by a frame.
        const energy = voice || REVERB_DECODE_ADAPTATION ? frameEnergy(samples, SAMPLE_RATE, track.hopSec, track.frames) : undefined
        const decision = energy && REVERB_DECODE_ADAPTATION ? this.reverbDecision(track, energy, options, sess) : undefined
        const tuned = decision ? { ...options, confidenceThreshold: decision.gate } : options
        if (voice && energy) return this.decodeVoice(track, energy, tuned ?? {})
        const notes = segmentNotes(track.cents, track.confidence, track.frames, this.segmentOptionsFrom(tuned))
        return decision?.backExtend ? track.backExtendOnsets(notes, decision.backExtend) : notes
    }

    /**
     * The decode-side reverb adaptation for this pass (`ReverbDecodeAdaptation`).
     *
     * One whole-buffer call — the benchmark, the eval harness's cached replay —
     * measures the whole take. A streaming session measures every pass until
     * `freezeSec` of loud audio exist and then keeps that evidence, so the gate
     * stops moving under notes it has already committed; the final pass measures
     * the whole take again, and `voicingAdaptationDrifted` tells the pipeline when
     * that moved the decision away from one an earlier pass ran with.
     */
    private reverbDecision(track: PitchTrack, energy: Float32Array, options: PitchTranscribeOptions | undefined, sess: CrepeSession): ReverbDecision {
        const adaptation = REVERB_DECODE_ADAPTATION
        if (!adaptation) throw new Error('reverbDecision without an adaptation')
        const realHopSec = track.hopSec / this.timeScale
        let evidence = sess.frozenEvidence
        if (!evidence || options?.finalPass) {
            evidence = track.reverbEvidence(energy, realHopSec)
            if (!options?.finalPass && evidence.loudFrames * realHopSec >= adaptation.freezeSec) sess.frozenEvidence = evidence
        }
        const decision = adaptation.decide(
            evidence,
            options?.confidenceThreshold ?? SEGMENT_OPTS.confidenceThreshold,
            options?.segmentMode === 'voice',
            realHopSec,
        )
        sess.decisions.set(`${decision.gate}|${decision.backExtend ? 1 : 0}`, decision)
        sess.lastDecision = decision
        return decision
    }

    /**
     * True when an earlier pass of `session` ran with a reverb decision the latest
     * (final) one does not agree with (`ReverbDecodeAdaptation.agrees`: the same
     * onset treatment, gates within the drift tolerance) — i.e. notes committed live
     * were decoded under a gate the final pass no longer uses. A final gate a hair
     * off the frozen one is not drift: the live notes stand. Always false with the
     * adaptation off (production).
     */
    voicingAdaptationDrifted(session: PitchSession): boolean {
        const adaptation = REVERB_DECODE_ADAPTATION
        if (!adaptation || !(session instanceof CrepeSession) || !session.lastDecision) return false
        const final = session.lastDecision
        return [...session.decisions.values()].some((d) => !adaptation.agrees(d, final))
    }

    /** The voice path: a note-level HMM over the trajectory *and* the envelope. */
    private decodeVoice(track: PitchTrack, energy: Float32Array, options: PitchTranscribeOptions): NoteEventTime[] {
        return new VoiceNoteDecoder({
            ...SHIPPING_VOICE_OPTS,
            confidenceThreshold: options.confidenceThreshold ?? SEGMENT_OPTS.confidenceThreshold,
            minFreqHz: options.minFreqHz ?? SEGMENT_OPTS.minFreqHz,
            maxFreqHz: options.maxFreqHz ?? SEGMENT_OPTS.maxFreqHz,
            // The profile's floor is declared in provider frames; the decoder wants
            // seconds, converted here where the frame grid is known.
            minNoteSec: (options.minFramesPerNote ?? SEGMENT_OPTS.minFramesPerNote) * track.hopSec,
        }).decode(track, energy)
    }

    /**
     * Frame-level pitch trajectory for `samples` — the model's actual measurement,
     * before any decision about where notes start and stop. Same caching as
     * `transcribe` (which is now just this plus a segmenter), so callers that want
     * the trajectory pay nothing extra.
     */
    async track(samples: Float32Array, session?: PitchSession): Promise<PitchTrack | null> {
        const sess = session instanceof CrepeSession ? session : new CrepeSession()

        const numFrames = Math.max(0, Math.floor((samples.length - FRAME_SIZE) / HOP_SIZE) + 1)
        if (numFrames === 0) return null

        if (numFrames < sess.cachedFrames) {
            sess.cachedFrames = 0
            sess.activations = new Float32Array(0)
            sess.confidence = new Float32Array(0)
        }

        if (numFrames * NUM_BINS > sess.activations.length) {
            const grownAct = new Float32Array(numFrames * NUM_BINS)
            grownAct.set(sess.activations)
            sess.activations = grownAct
            const grownConf = new Float32Array(numFrames)
            grownConf.set(sess.confidence)
            sess.confidence = grownConf
        }

        const recomputeStart = Math.max(0, Math.min(sess.cachedFrames, numFrames) - RECOMPUTE_TAIL_FRAMES)

        for (let batchStart = recomputeStart; batchStart < numFrames; batchStart += INFERENCE_BATCH) {
            const batchEnd = Math.min(batchStart + INFERENCE_BATCH, numFrames)
            const batchCount = batchEnd - batchStart
            // Framing stays here (the forward pass is the only thing the backend runs).
            const flat = new Float32Array(batchCount * FRAME_SIZE)
            for (let f = 0; f < batchCount; f++) {
                const start = (batchStart + f) * HOP_SIZE
                const window = samples.subarray(start, start + FRAME_SIZE)
                flat.set(normalizeFrame(window), f * FRAME_SIZE)
            }
            const actBatch = await this.backend.crepePredict(flat, batchCount)
            // Confidence is the per-frame activation max — derived here so it never
            // crosses the wire (it's a trivial reduction of `actBatch`).
            const confBatch = new Float32Array(batchCount)
            for (let f = 0; f < batchCount; f++) {
                let max = -Infinity
                const base = f * NUM_BINS
                for (let b = 0; b < NUM_BINS; b++) {
                    if (actBatch[base + b] > max) max = actBatch[base + b]
                }
                confBatch[f] = max
            }
            sess.activations.set(actBatch, batchStart * NUM_BINS)
            sess.confidence.set(confBatch, batchStart)
        }
        sess.cachedFrames = numFrames

        const path = viterbi(sess.activations, numFrames, VITERBI_OPTS)
        const cents = localCentsFromPath(sess.activations, path, numFrames, this.centMapping, NUM_BINS, LOCAL_AVG_HALF_WIDTH)
        // Per-frame top-k candidates (E3/R9): cheap (one scan of the activation
        // row), and what lets the voice decode consider a non-argmax hypothesis.
        const cand = topKCandidates(sess.activations, numFrames, this.centMapping, NUM_BINS, LOCAL_AVG_HALF_WIDTH, PITCH_CANDIDATES_K)

        return new PitchTrack(
            cents,
            sess.confidence.subarray(0, numFrames),
            numFrames,
            HOP_SIZE / SAMPLE_RATE,
            cand.cents,
            cand.strength,
            PITCH_CANDIDATES_K,
        )
    }

    private segmentOptionsFrom(options?: PitchTranscribeOptions): SegmentOptions {
        return {
            ...SEGMENT_OPTS,
            ...(options?.minFreqHz !== undefined && { minFreqHz: options.minFreqHz }),
            ...(options?.maxFreqHz !== undefined && { maxFreqHz: options.maxFreqHz }),
            ...(options?.confidenceThreshold !== undefined && {
                confidenceThreshold: options.confidenceThreshold,
            }),
            ...(options?.minFramesPerNote !== undefined && {
                minFramesPerNote: options.minFramesPerNote,
            }),
            ...(options?.pitchBinToleranceCents !== undefined && {
                pitchBinToleranceCents: options.pitchBinToleranceCents,
            }),
            // 'voice' is handled by `decodeVoice`, never by `segmentNotes`.
            ...(options?.segmentMode === 'median' || options?.segmentMode === 'semitone' ? { mode: options.segmentMode } : {}),
            ...(options?.smoothFrames !== undefined && { smoothFrames: options.smoothFrames }),
            ...(options?.tuningCorrect !== undefined && { tuningCorrect: options.tuningCorrect }),
        }
    }
}

/**
 * CREPE bin index → absolute MIDI cents (A4 = 6900). CREPE outputs cents
 * referenced to 10 Hz; we shift to A4-reference so downstream `cents/100`
 * gives the MIDI note number directly.
 */
function buildCentMapping(): Float32Array {
    const arr = new Float32Array(NUM_BINS)
    const offset = 6900 + 1200 * Math.log2(10 / 440)
    for (let i = 0; i < NUM_BINS; i++) {
        const crepeCents = CREPE_CENTS_OFFSET + (CREPE_CENTS_RANGE * i) / (NUM_BINS - 1)
        arr[i] = crepeCents + offset
    }
    return arr
}
