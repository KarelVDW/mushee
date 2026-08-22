/**
 * Chooses a `PipelineProfile` for one recording from a coarse pitch scan of the
 * first audio, optionally seeded by an instrument hint. This is what makes the
 * single pipeline adapt to any register: it fits the provider's frequency
 * window and the decoder high-pass to the input instead of using one fixed band.
 */

import { Logger } from '@nestjs/common';

import { OnsetDetector } from '../onset-detector';
import { isVoiceInstrument, rangeForInstrument } from './instrument-ranges';
import {
  DEFAULT_PROFILE,
  GLOBAL_MAX_FREQ_HZ,
  GLOBAL_MIN_FREQ_HZ,
  PITCHDOWN_MODEL_CEILING_HZ,
  PITCHDOWN_PROVIDER_NAME,
  type PipelineProfile,
  PROFILE_BANDS,
  TRAJECTORY_MODEL_CEILING_HZ,
  VOICE_OVERLAY,
} from './pipeline-profile';
import { scanPitch } from './pitch-scan';
import { SourceClassifier } from './source-classifier';

/**
 * What the caller knows about the source before any audio is analysed.
 *
 * `sourceKind` is authoritative when set — it comes from an explicit caller
 * declaration (the eval harness knows each dataset; an API client may still
 * send one) — and `instrumentId` is the fallback prior drawn from the score's
 * own staff. Deliberately two fields rather than one: "the caller told us" and
 * "the score suggests" are different levels of evidence, and collapsing them
 * would make the second silently override a correction of the first.
 *
 * When `sourceKind` is absent the resolver asks the audio itself
 * (`SourceClassifier`, stock YAMNet at the lock prefix, 98.7 % decided
 * accuracy) and only falls back to the instrument prior when the classifier
 * abstains — which is what made the recording UI's mandatory mic-source chip
 * removable.
 */
export interface ProfileHint {
  instrumentId?: string;
  /** Explicit caller declaration of what is being recorded. */
  sourceKind?: 'voice' | 'instrument';
}

/**
 * Noise-adaptation thresholds (tuned against the adverse tier of the eval
 * corpus — scripts/eval). A recording counts as noisy when either a
 * meaningful share of its energetic frames are broadband (wind gusts,
 * chatter) or its quiet frames sit close to its loud ones (steady backdrop).
 */
/** A/B kill-switch shared with pitch-scan.ts: RECORDING_NOISE_ADAPT=0 = legacy. */
const NOISE_ADAPT = process.env.RECORDING_NOISE_ADAPT !== '0';
/**
 * Kill-switch for voice routing: `RECORDING_VOICE_DECODE=0` sends singing back
 * through the shared semitone-run segmenter.
 *
 * Two jobs. In the eval harness it is the only way to get a clean A/B of the
 * voice decode over the *production* path — `EVAL_NO_HINT` also removes the
 * frequency-window hint, so it cannot isolate this. In production it is the
 * rollback: the decode is a large behavioural change on the one input class the
 * product exists for, and reverting it should not need a deploy.
 */
const VOICE_DECODE = process.env.RECORDING_VOICE_DECODE !== '0';

/** Env override with default — lets the eval sweep explore without code edits. */
function envNum(key: string, fallback: number): number {
  const v = Number(process.env[key]);
  return Number.isFinite(v) ? v : fallback;
}

/**
 * A take counts as noisy when the measured signal-to-backdrop ratio drops
 * below this. Takes with no measurable backdrop (snrDb undefined — e.g.
 * wall-to-wall clean legato) are never flagged: absence of quiet frames is
 * not evidence of noise.
 */
const NOISY_MAX_SNR_DB = envNum('RECORDING_NOISY_MAX_SNR_DB', 25);
const NOISY_MIN_NOISINESS = envNum('RECORDING_NOISY_MIN_NOISINESS', 0.5);
/**
 * Actions taken on a noisy take. ALL DEFAULT TO NO-OPS: the 2026-07 adverse
 * eval (scripts/eval, echoey-room/wind/street/distant conditions on both the
 * synthetic and real corpora) measured the confidence/min-frames tightening
 * as a net LOSS wherever it fired (recall drops outweigh precision gains,
 * echoey-room -0.03) and the afftdn denoise pass as exactly neutral. The
 * classifier itself stays on as telemetry (the NOISY flag in the resolver
 * log + the archived profile id), and the env knobs let ops re-enable the
 * actions for experiments on real-world traffic.
 *
 * 2026-07-25, on reverberant audio specifically: the LOSS above is not just a
 * failed tuning, the sign is wrong. Reverb collapses CREPE's confidence, so it
 * needs the gate LOWERED (see `applyReverb`, +0.024/+0.043 note-F1) and raising
 * it makes the same clips worse. And this classifier is the wrong trigger in any
 * case — it fires on 84 % of reverberant takes but also on 60 % of clean ones,
 * because `snrDb`/`noisiness` are built for an additive stationary interferer
 * and reverberation is neither.
 */
const NOISY_CONFIDENCE_BUMP = envNum('RECORDING_NOISY_CONF_BUMP', 0);
const NOISY_CONFIDENCE_CAP = 0.75;
const NOISY_MIN_FRAMES_PER_NOTE = envNum('RECORDING_NOISY_MIN_FRAMES', 4);
const NOISY_DENOISE = process.env.RECORDING_NOISY_DENOISE === '1';

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

/**
 * How far the voicing gate may be relaxed on a fully reverberant take, and the
 * floor it may never go below. See `estimateReverberance` for why this is the
 * adaptation reverb actually wants.
 */
const REVERB_CONFIDENCE_RELIEF = envNum('RECORDING_REVERB_CONF_RELIEF', 0.25);
const REVERB_CONFIDENCE_FLOOR = envNum('RECORDING_REVERB_CONF_FLOOR', 0.25);
/**
 * `dipDepth` anchors for the reverberance ramp: the measured medians of the
 * clean (0.34) and reverberant (0.50–0.55) halves of the corpus. Below the low
 * anchor a take is treated as dry, above the high anchor as fully reverberant,
 * and in between the relief is applied proportionally — a graded response,
 * because the feature is only weakly separating (see `estimateReverberance`) and
 * a hard threshold would mean applying the full relief to false positives.
 */
const REVERB_DIP_DRY = envNum('RECORDING_REVERB_DIP_DRY', 0.36);
const REVERB_DIP_WET = envNum('RECORDING_REVERB_DIP_WET', 0.52);
/**
 * Minimum envelope modulation (coefficient of variation over above-silence
 * frames) for the fill measurement to mean anything.
 *
 * `dipDepth` reads "the quiet moments sit close to the loud ones". A signal with
 * essentially NO dynamic variation — a synthesized steady tone, a sustained
 * drone, a test fixture — satisfies that trivially and would otherwise be scored
 * maximally reverberant. This is the same trap `PitchScan` already guards for
 * `snrDb` ("absence of quiet frames is not evidence of noise"), and it needs the
 * same answer: absence of dips is not evidence of FILLED dips.
 *
 * 0.15 is far below anything real. Measured over all 1,282 clip/condition pairs
 * of the real corpus the minimum modulation is 0.195 (p1 = 0.233), so the guard
 * never fires on real material; a constant-amplitude synthetic tone measures
 * 0.027.
 */
const REVERB_MIN_MODULATION = envNum('RECORDING_REVERB_MIN_MODULATION', 0.15);

/**
 * Blind reverberance of a take, 0 (dry) … 1 (heavily reverberant), from the
 * amplitude envelope alone.
 *
 * ## Why reverb needs its own signal, and why it is this one
 *
 * `PitchScan` already measures `snrDb` and `noisiness`, and neither one sees
 * reverberation: over 197 reverberant singing clips paired against their own
 * clean takes, `noisiness` did not move at all (0.00 → 0.00) and `snrDb` fell
 * only 23.7 → 17.8 dB, catching 25 % of reverberant takes at a 10 % false-
 * positive rate. That is unsurprising — both are built to find an ADDITIVE,
 * roughly stationary interferer, and reverberation is a delayed copy of the
 * signal itself.
 *
 * What reverberation does do is FILL IN the quiet moments: the tail of each note
 * covers the gaps and the decays, so the envelope's floor rises toward its peak.
 * `dipDepth` — the median above-silence envelope level as a fraction of the
 * clip's peak — measures exactly that, and it moved 0.340 → 0.498 (echoey-room)
 * and 0.346 → 0.549 (distant-mic) on the same clips, the best separation of the
 * four candidates measured (`scripts/eval/sweep-reverb.ts`, MODE=diagnose).
 *
 * It is still far from a clean detector (46 % / 70 % of reverberant takes past
 * the clean p90), which is why the caller applies it as a RAMP rather than a
 * switch: a weak signal used proportionally is worth much more than the same
 * signal used as a binary gate.
 */
export function estimateReverberance(
  samples: Float32Array,
  sampleRate: number,
): number {
  const env = new OnsetDetector().envelope(samples, sampleRate);
  if (env.length < 20) return 0;
  let peak = 0;
  for (const v of env) peak = Math.max(peak, v);
  if (peak <= 0) return 0;
  // Frames above the silence floor only — trailing/leading silence would
  // otherwise drag the median down and read as a dry room.
  const loud: number[] = [];
  for (const v of env) if (v > peak * 0.08) loud.push(v);
  if (loud.length < 8) return 0;

  // A take with no dynamic variation has no dips for a room to fill, so its
  // fill ratio carries no information — see REVERB_MIN_MODULATION.
  const mu = loud.reduce((a, b) => a + b, 0) / loud.length;
  if (mu <= 0) return 0;
  const sd = Math.sqrt(
    loud.reduce((s, v) => s + (v - mu) ** 2, 0) / loud.length,
  );
  if (sd / mu < REVERB_MIN_MODULATION) return 0;

  loud.sort((a, b) => a - b);
  const dipDepth = loud[loud.length >> 1] / peak;
  return clamp(
    (dipDepth - REVERB_DIP_DRY) / (REVERB_DIP_WET - REVERB_DIP_DRY),
    0,
    1,
  );
}

/**
 * Relax the voicing gate in proportion to a take's measured reverberance.
 *
 * ## The measurement this encodes
 *
 * Reverberation barely disturbs CREPE's PITCH — on frames voiced in both a clip
 * and its reverberant twin, 73 % agree within 50 ¢ and only 1.1 % are octave
 * errors. What it does is destroy the model's CONFIDENCE: mean per-frame
 * confidence falls 0.765 → 0.517 (echoey-room) and → 0.502 (distant-mic), so
 * 43–45 % of the frames that were voiced when dry fall under a gate calibrated
 * at 0.5. Crucially those frames are lost from INSIDE held notes, not from their
 * edges: the median detected note halves in length (0.40 s → 0.23 s) while the
 * note count barely changes, i.e. the gate chops sustained notes into fragments
 * and precision and recall fall together.
 *
 * So the gate, not the pitch tracker, is what reverb breaks — and the fix is to
 * recalibrate it for the take. Measured with paired bootstrap CIs over the
 * corpora with trustworthy note labels (annotated-vocalset, guitarset-solo,
 * vocadito — mir-qbsh excluded — its note labels are derived, see scripts/eval/README.md) with
 * `scripts/eval/sweep-reverb.ts`, MODE=sweep, `EVAL_SPLIT=dev|test`, Δ note-F1
 * (COnP @100 ms) at the detection stage, `*` = 95 % CI excludes zero:
 *
 * ```
 *                     clean                    echoey-room              distant-mic
 * dev  fixed 0.40     -0.003 [-0.008,+0.002]   +0.016 *                 +0.029 *
 * dev  fixed 0.30     -0.009 [-0.016,-0.003]*  +0.025 *                 +0.050 *
 * dev  THIS RAMP      -0.003 [-0.007,+0.002]   +0.022 [+0.013,+0.032]*  +0.055 [+0.044,+0.067]*
 * test THIS RAMP      -0.000 [-0.004,+0.003]   +0.024 [+0.016,+0.032]*  +0.043 [+0.032,+0.054]*
 * n (dev/test)        234 / 256                197 / 199                197 / 199
 * ```
 *
 * On F₂ — the product-relevant weighting (a missed note costs ~40× a spurious one to repair) — the gain is larger
 * still: dev +0.030 / +0.066, test +0.032 / +0.053, all CIs excluding zero.
 * And the dry-audio safety check was run over the WHOLE corpus, all 17 datasets
 * including the URMP instruments: ΔF1 -0.003 [-0.007,+0.002] on 270 dev clips
 * and -0.001 [-0.003,+0.002] on 318 test clips. Nothing distinguishable from
 * zero anywhere on dry audio.
 *
 * ### It survives the production profile lock, which is the real constraint
 *
 * `RecordingPipeline.resolveProfile` locks the profile from the first
 * `DETECT_MIN_SEC` = 1.2 s of audio and never revisits it, so the estimate that
 * ships is made from a ~1.5 s prefix, not a whole take. Re-measured that way:
 *
 * ```
 *                     clean                    echoey-room   distant-mic
 * dev  prefix 1.5 s   -0.008 [-0.015,-0.002]*  +0.026 *      +0.055 *
 * test prefix 1.5 s   -0.003 [-0.008,+0.002]   +0.025 *      +0.040 *
 * ```
 *
 * The reverb gain is fully intact — a room is audible in a second and a half.
 * The dry cost roughly triples (and reaches significance on dev, though not on
 * test), because a short prefix is a noisier estimate and produces more false
 * positives. **Follow-up worth taking:** re-estimate reverberance on the FINAL
 * pass, where the whole take is available (full-clip estimate: dry -0.002 dev /
 * -0.000 test, same reverb gain). That needs `recording-pipeline.ts`, which
 * re-resolves nothing today.
 *
 * The ramp dominates every fixed value: it buys the reverb gain of a 0.25–0.30
 * gate while costing what a 0.40 gate costs on dry audio (which is nothing
 * distinguishable from zero). A fixed low threshold cannot do both, because the
 * optimum genuinely differs by condition — ~0.5 dry, ~0.25 wet.
 *
 * Related dead end, recorded so it is not retried: this is NOT the noise
 * adaptation below. `applyNoise` RAISES the gate and was measured as a loss;
 * reverb wants it LOWERED, and the NOISY flag is useless as the trigger anyway
 * (it fires on 84 % of reverberant takes but also 60 % of clean ones).
 *
 * ⚠ The eval harness caches the RESOLVED PROFILE, so this function's output is
 * baked into `scripts/fixtures/eval-cache/` and `eval-cache-variant/`. A cache
 * built before this change stores the old gate; bump `CACHE_VERSION` in
 * `scripts/eval/lib/trackCache.ts` (or delete the directory) before trusting
 * absolute numbers from `ablate.ts` / `sweep-segmenter.ts` again.
 */
function applyReverb(base: PipelineProfile, reverberance: number): PipelineProfile {
  if (reverberance <= 0 || base.confidenceThreshold === undefined) return base;
  const relaxed = Math.max(
    REVERB_CONFIDENCE_FLOOR,
    base.confidenceThreshold - REVERB_CONFIDENCE_RELIEF * reverberance,
  );
  if (relaxed >= base.confidenceThreshold) return base;
  return { ...base, id: base.id + '+reverb', confidenceThreshold: relaxed };
}

/**
 * Overlay the voice decode onto a resolved band.
 *
 * Follows the `applyReverb` template (an adaptation on top of a band anchor, with
 * an `id` suffix so the routing decision is visible in logs and in the archived
 * session metadata) but is a **binary switch rather than a ramp**, and for a
 * reason: reverberance is a weak continuous measurement, so applying it
 * proportionally is worth more than thresholding it, whereas "is this a human
 * voice" is a fact the caller either knows or does not. Where we do not know, we
 * do not guess — the instrument bands stay exactly as they were.
 *
 * Only the at-pitch trajectory providers reach the voice decode; the
 * `very-high` band is whistling/piccolo territory, which the voice literature
 * explicitly does not cover (whistling is a documented gap with opposite
 * needs — see research-pitch-models P3.4).
 */
function applyVoice(base: PipelineProfile, isVoice: boolean): PipelineProfile {
  // The pitch-down wrapper is excluded: the very-high band is whistling
  // territory, which the voice decode's literature and calibration explicitly
  // do not cover — and its cleanup set must not switch to the voice one either.
  if (!isVoice || !VOICE_DECODE || base.providerName === PITCHDOWN_PROVIDER_NAME)
    return base;
  return { ...base, ...VOICE_OVERLAY, id: base.id + '+voice' };
}

function band(id: string): PipelineProfile {
  const found = PROFILE_BANDS.find((b) => b.id === id);
  return found ?? DEFAULT_PROFILE;
}

/**
 * Map the detected median fundamental to a register band. Boundaries chosen so
 * piccolo / whistling (median ≳ 1.3 kHz, with notes reaching above the
 * CREPE ~1997 Hz ceiling) land in the octave-down `very-high` band, while
 * everything the trajectory providers can fully cover routes to them.
 */
function bandFor(medianHz: number): PipelineProfile {
  if (medianHz >= 1300) return band('very-high');
  if (medianHz >= 550) return band('high');
  if (medianHz >= 200) return band('mid');
  return band('low');
}

export class ProfileResolver {
  private readonly logger = new Logger(ProfileResolver.name);
  // Shared model under the hood, so per-recording resolver instances are free.
  private readonly sourceClassifier = new SourceClassifier();

  /**
   * @param samples     mono PCM of the first ~seconds of the recording
   * @param sampleRate  sample rate of `samples`
   */
  resolve(
    samples: Float32Array,
    sampleRate: number,
    hint?: ProfileHint,
  ): PipelineProfile {
    const scan = scanPitch(samples, sampleRate);
    const hintRange = rangeForInstrument(hint?.instrumentId);
    // An explicit caller declaration wins outright. Absent one, the audio
    // itself decides (stock-YAMNet classifier, 98.7 % decided accuracy at this
    // very prefix), and only an abstention — near-silence, ambiguity, model
    // not loaded yet — falls back to the score's instrument prior.
    const classified =
      hint?.sourceKind === undefined
        ? this.sourceClassifier.classify(samples, sampleRate)
        : undefined;
    const isVoice =
      hint?.sourceKind === 'voice' ||
      (hint?.sourceKind === undefined &&
        (classified !== undefined
          ? classified === 'voice'
          : isVoiceInstrument(hint?.instrumentId)));
    const sourceDecidedBy: PipelineProfile['sourceDecidedBy'] =
      hint?.sourceKind !== undefined
        ? 'explicit'
        : classified !== undefined
          ? 'classifier'
          : 'prior';
    const sourceBelief: PipelineProfile['sourceBelief'] = isVoice
      ? 'voice'
      : 'instrument';
    const noisy =
      (scan.snrDb !== undefined && scan.snrDb <= NOISY_MAX_SNR_DB) ||
      scan.noisiness >= NOISY_MIN_NOISINESS;
    const reverberance = estimateReverberance(samples, sampleRate);

    if (!scan.voiced) {
      // No reliable pitch yet — fall back to a wide default, widened to the
      // hint range if we have one. (With the harmonicity gate this is also
      // where pure-backdrop lead-ins land, instead of locking a garbage band.)
      const base = {
        ...applyVoice(this.applyNoise(DEFAULT_PROFILE, noisy), isVoice),
        sourceBelief,
        sourceDecidedBy,
      };
      if (!hintRange) return base;
      return this.finalize(base, hintRange.minHz, hintRange.maxHz, base.id + '+hint');
    }

    // Fit a window around the detected distribution, with headroom: pad below
    // for the lowest note's fundamental and above for vibrato / the top note.
    // The low bound is deliberately generous — a too-high floor *clips* notes
    // (catastrophic), while a too-low floor only mildly risks an octave error
    // the high-pass and post-processing still suppress. Allowing ~1.7 octaves
    // below the median guards against the scan locking onto a harmonic of a low
    // brass / double-reed fundamental (e.g. a trombone whose energy peaks at the
    // 3rd harmonic), which would otherwise clip its real low notes with no hint.
    let lowHz = Math.min(scan.p10Hz * 0.6, scan.medianHz * 0.3);
    let highHz = scan.p90Hz * 1.5;

    // Union with the hint range so early/extreme notes aren't clipped before
    // the scan saw them.
    if (hintRange) {
      lowHz = Math.min(lowHz, hintRange.minHz);
      highHz = Math.max(highHz, hintRange.maxHz);
    }

    const base = {
      ...applyVoice(
        applyReverb(this.applyNoise(bandFor(scan.medianHz), noisy), reverberance),
        isVoice,
      ),
      sourceBelief,
      sourceDecidedBy,
    };
    const profile = this.finalize(base, lowHz, highHz, base.id);
    this.logger.debug(
      `Resolved profile=${profile.id} provider=${profile.providerName} ` +
        `window=${profile.minFreqHz.toFixed(0)}-${profile.maxFreqHz.toFixed(0)}Hz ` +
        `hp=${profile.highpassHz.toFixed(0)} ` +
        `conf=${profile.confidenceThreshold?.toFixed(2) ?? 'n/a'} ` +
        `(scan p10/med/p90=${scan.p10Hz.toFixed(0)}/${scan.medianHz.toFixed(0)}/${scan.p90Hz.toFixed(0)}Hz, ` +
        `frames=${scan.voicedFrames}, snr=${scan.snrDb?.toFixed(0) ?? 'n/a'}dB, ` +
        `noisiness=${scan.noisiness.toFixed(2)}${noisy ? ' NOISY' : ''}, ` +
        `reverberance=${reverberance.toFixed(2)}, ` +
        `hint=${hint?.instrumentId ?? 'none'}/${hint?.sourceKind ?? 'auto'}` +
        `${hint?.sourceKind === undefined ? `, classified=${classified ?? 'abstain'}` : ''}` +
        `${profile.isVoice ? ' VOICE' : ''})`,
    );
    return profile;
  }

  /**
   * Adapt a band anchor to a measured noisy backdrop: turn on the decoder's
   * spectral denoiser and tighten the note gates, trading a sliver of clean
   * recall for not hallucinating notes out of wind, chatter, or reverb wash.
   */
  private applyNoise(base: PipelineProfile, noisy: boolean): PipelineProfile {
    if (!noisy || !NOISE_ADAPT) return base;
    return {
      ...base,
      id: base.id + '+noise',
      denoise: NOISY_DENOISE || undefined,
      confidenceThreshold:
        base.confidenceThreshold === undefined
          ? undefined
          : Math.min(NOISY_CONFIDENCE_CAP, base.confidenceThreshold + NOISY_CONFIDENCE_BUMP),
      minFramesPerNote: NOISY_MIN_FRAMES_PER_NOTE,
    };
  }

  /** Apply the dynamic window + high-pass to a band anchor, with safety rules. */
  private finalize(
    base: PipelineProfile,
    lowHz: number,
    highHz: number,
    id: string,
  ): PipelineProfile {
    // The at-pitch CREPE provider can't see above its ~1997 Hz ceiling, so cap
    // its window there — the band router already sends sources whose register
    // sits above the ceiling to the octave-down `very-high` band, which hears
    // to 2× that ceiling.
    const ceiling =
      base.providerName === PITCHDOWN_PROVIDER_NAME
        ? PITCHDOWN_MODEL_CEILING_HZ
        : TRAJECTORY_MODEL_CEILING_HZ;

    const minFreqHz = clamp(lowHz, GLOBAL_MIN_FREQ_HZ, ceiling - 100);
    const maxFreqHz = clamp(
      Math.max(highHz, minFreqHz + 100),
      minFreqHz + 100,
      ceiling,
    );
    // High-pass must sit safely below the lowest fundamental we want to keep.
    const highpassHz = clamp(minFreqHz * 0.6, 30, 400);

    return {
      ...base,
      id,
      providerName: base.providerName,
      minFreqHz,
      maxFreqHz,
      highpassHz,
    };
  }
}
