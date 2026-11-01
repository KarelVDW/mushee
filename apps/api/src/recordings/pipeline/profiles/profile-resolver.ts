/**
 * Chooses a `PipelineProfile` for one recording from a coarse pitch scan of the
 * first audio, optionally seeded by an instrument hint. This is what makes the
 * single pipeline adapt to any register: it fits the provider's frequency
 * window and the decoder high-pass to the input instead of using one fixed band.
 */

import { Logger } from '@nestjs/common'

import type { DecodeOptions } from '../audio-decoder'
import { envFlag, envNumber, envOptionalNumber, NOISE_ADAPT, VOICE_DECODE } from '../env'
import { OnsetDetector } from '../onset-detector'
import { isStruckOrPluckedInstrument, isVoiceInstrument, rangeForInstrument } from './instrument-ranges'
import {
    DEFAULT_PROFILE,
    GLOBAL_MIN_FREQ_HZ,
    type PipelineProfile,
    PITCHDOWN_MODEL_CEILING_HZ,
    PITCHDOWN_PROVIDER_NAME,
    PROFILE_BANDS,
    SUSTAINED_ONSET_DIP_RATIO,
    TRAJECTORY_MODEL_CEILING_HZ,
    VOICE_ONSET_DIP_RATIO,
    VOICE_OVERLAY,
} from './pipeline-profile'
import { scanPitch } from './pitch-scan'
import { estimateReverberance } from './reverberance'
import { SourceClassifier, YAMNET_SAMPLE_RATE } from './source-classifier'

/**
 * The resolver's input contract: how a caller must decode audio before
 * `resolve`. The rate is the source classifier's native one — on any other
 * rate the classifier silently abstains, and routing falls back to the score's
 * instrument prior — and the decode is a 30 Hz rumble high-pass with no
 * loudnorm. Exported so every caller decodes the resolver's input the same
 * way. The pipeline's lock uses it; the eval scripts still declare their own
 * DETECT_SR/{ loudnorm: false, highpassHz: 30 } copies pending adoption.
 */
export const DETECT_SAMPLE_RATE = YAMNET_SAMPLE_RATE
export const DETECT_DECODE: Readonly<DecodeOptions> = { loudnorm: false, highpassHz: 30 }

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
    instrumentId?: string
    /** Explicit caller declaration of what is being recorded. */
    sourceKind?: 'voice' | 'instrument'
}

/**
 * Onset-sensitivity policy (see `SUSTAINED_ONSET_DIP_RATIO`). Kill-switch:
 * `ONSET_POLICY=legacy` restores the detector's default for every source. The
 * numeric overrides and `SUSTAINED_ONSET_REVERB_RAMP=0` (flat sustained ratio)
 * exist for A/B runs only.
 */
const ONSET_POLICY_LEGACY = process.env.ONSET_POLICY === 'legacy'
const VOICE_DIP_OVERRIDE = envOptionalNumber('VOICE_ONSET_DIP_RATIO')
const SUSTAINED_DIP_OVERRIDE = envOptionalNumber('ONSET_DIP_RATIO')
const SUSTAINED_REVERB_RAMP = envFlag('SUSTAINED_ONSET_REVERB_RAMP')
const VOICE_ONSET_MIN_TROUGH_SEC = envOptionalNumber('VOICE_ONSET_MIN_TROUGH_SEC')

/**
 * The whistle family (2026-11) — BUILT OFF: every knob defaults to today's
 * behaviour, and with all of them unset no profile changes anywhere.
 *
 * A take belongs to the family when the score hint is exactly `whistle`, or when
 * `RECORDING_WHISTLE_DETECT=1` and the stock YAMNet "Whistling" class ranks in
 * the top 3 of the lock prefix (`SourceAnalysis.whistling`). A `tin-whistle`
 * hint alone does not qualify: a tin whistle tongues, so its re-attacks are real
 * and it keeps the sustained family. The whistle check runs even when the caller
 * declared `sourceKind`, and a family member is never routed to the voice
 * decode (whistling is the documented gap the voice literature does not cover).
 *
 * - `RECORDING_WHISTLE_DETECT=1`: let the verdict admit a take (WH-H3).
 * - `RECORDING_WHISTLE_PITCHDOWN=1`: route the family to the octave-down
 *   `very-high` band whatever its median (WH-H2).
 * - `RECORDING_WHISTLE_ONSET=off|<dip>`: the family's re-attack dip — `off` is
 *   0, which the detector can never fire on (no amplitude splitter); a number is
 *   a fixed dip with no reverb ramp (WH-H1). Unset / `legacy`: the sustained
 *   policy as today.
 *
 * ## Measured 2026-11-01 (dev tuning below; the test look failed — stays BUILT OFF)
 *
 * **The one test look** (final harness: grid/tempo corrections in, app takes at
 * their session bpm; cached, `--split test`, the three knobs DETECT + PITCHDOWN +
 * ONSET 0.2 vs production): whistling **−0.001 [−0.020, +0.017]** (0.642 → 0.641;
 * whistle-real −0.003, app-takes-whistling +0.002; 60 clips, MDE 0.026), against
 * +0.037 [+0.021, +0.056] on dev on the same harness. Every singing and instrument
 * dataset note-identical on test, all conditions (the identity guarantee holds).
 * Product-faithful (undeclared source, test): on a `voice-lead` score +0.033
 * [+0.006, +0.061] (the verdict keeps whistles out of the voice decode, which costs
 * them −0.042 against the declared row); on a `piano` score +0.011 (n.s.).
 *
 * Whistling material = mean of the whistle-real / app-takes-whistling /
 * whistled-high-register dataset means; cached replay = the benchmark note for
 * note (`benchmark.ts run --cached`), paired bootstrap over 82 clips, `*` = CI
 * excludes 0. The track caches the pitch-down routing builds are bit-identical to
 * the 2026-11 diagnosis's forced-band tracks (30/30 clips).
 *
 * ```
 *                                    material         clips Δ                    re-onset recall (43)
 * production                         0.606            —                          0.58
 * PITCHDOWN                          0.617            +0.019 [+0.007, +0.032]*   0.65
 * PITCHDOWN + ONSET 0.2              0.623            +0.013 [+0.004, +0.023]* over PITCHDOWN
 * DETECT + PITCHDOWN + ONSET 0.2     0.636            +0.035 [+0.018, +0.052]*   0.56
 * DETECT + PITCHDOWN + ONSET off     0.653            +0.042 [+0.025, +0.059]*   0.40
 * ```
 *
 * Why 0.2 and not `off`, although `off` scores higher: the splitter is the only
 * channel for a repeated note whose gap a room fills. `off` loses 8 of the 43 real
 * re-onsets and, on the exact-truth synthetic whistles (rendered with the fixed
 * degrade), every repeat under a slapback room-mic (14/14 → 0/14, COnP −0.07);
 * 0.2 keeps both at production's level. What 0.2 still gives up is the
 * synthetic echoey/distant re-onsets (0.97 → 0.81 overall), where production's
 * ramped dip finds them only by splitting 85 notes per 100 (est/ref 1.97 → 1.04,
 * COnP +0.18 there). Dips 0.1 / 0.15 sit between (material 0.644 / 0.638).
 *
 * In a room (whistle-real dev re-rendered echoey / distant with the fixed degrade,
 * not pooled): PITCHDOWN + 0.2 +0.004 / −0.005 (n.s.); pitch-down ALONE −0.013* /
 * −0.013 — the 2026-08-20 reverb counter-signal, real but small and cancelled by
 * the onset change. Undeclared input, as the app sends it (no sourceKind; the
 * score is whatever the user picked — `EVAL_UNDECLARED_*`), all three knobs on:
 * whistling on a voice score 0.607 → 0.631, clips +0.039 [+0.019, +0.059]*; on a
 * piano score 0.588 → 0.630, +0.031 [+0.017, +0.045]* (the harness's verdict sees
 * a clip's first 4 s, recall 0.84, so the lock's 0.77 makes this a slight
 * overestimate).
 *
 * The verdict at the lock prefix (first pitched ≥ 1.2 s, +1 s passes, as
 * `RecordingPipeline` locks): recall 63/82 dev whistles (0.77; 0.78 from 2.2 s,
 * 0.84 on the first 4 s); false positives 1 / 1,730 non-whistle real dev clips (a
 * TinySOL accordion top note), 0 / 652 adverse variants, 2 / 1,170 realistic
 * synthetic clips (shakuhachi over a phone mic), 0 / 612 legacy synthetic. Top 5
 * would reach 0.80 at the lock with the same false positives; top 3 was kept as
 * fixed a priori. A miss costs nothing: the take routes as it does today.
 */
const WHISTLE_DETECT = envFlag('RECORDING_WHISTLE_DETECT', false)
const WHISTLE_PITCHDOWN = envFlag('RECORDING_WHISTLE_PITCHDOWN', false)
const WHISTLE_ONSET_DIP = whistleOnsetDip(process.env.RECORDING_WHISTLE_ONSET)
/**
 * `RECORDING_WHISTLE_ONSET_RAMP=1`: ramp the family dip toward the detector
 * default with reverberance, as the sustained family does. Measured null on real
 * whistles: material 0.627 for a ramped 0.2 vs 0.635 flat (stacked replay on
 * PITCHDOWN), identical in the re-rendered rooms, because the reverberance
 * estimate barely fires on real reverberant whistling. It only restores the
 * synthetic echoey re-onsets (12/14) by bringing back their over-splitting.
 */
const WHISTLE_ONSET_RAMP = envFlag('RECORDING_WHISTLE_ONSET_RAMP', false)
/** No family at all unless some whistle knob is on — the identity guarantee above. */
const WHISTLE_FAMILY = WHISTLE_DETECT || WHISTLE_PITCHDOWN || WHISTLE_ONSET_DIP !== undefined

/**
 * WH-H2b — BUILT OFF: `RECORDING_HIGH_BAND_PITCHDOWN=1` sends every non-voice take
 * the register router puts in the `high` band (flute, oboe, violin, at-pitch
 * whistling) to the octave-down provider as well. Voice keeps its band: the voice
 * overlay refuses the pitch-down provider, so a sung take there would lose the
 * voice decode.
 *
 * Measured 2026-11-01, dev, all conditions (fixed adverse tier): it reroutes 7
 * pooled dev clips (GuitarSet 3, URMP flute 2, oboe 2) and nothing else.
 * GuitarSet +0.006 [−0.004, +0.018], URMP flute +0.020 [−0.025, +0.067], oboe
 * −0.006 [−0.045, +0.028] — about +0.001 on the 14-set instrument material, under
 * any ship bar; distant-mic −0.011 (n.s.), echoey +0.015. TinySOL high strata
 * (exact truth, context) +0.032 [+0.008, +0.063]*, as the 2026-11 diagnosis found.
 * The CREPE-tiny confidence gain on near-sines played at half speed is real, but
 * the material it applies to is too thin in the pooled sets to show.
 */
const HIGH_BAND_PITCHDOWN = envFlag('RECORDING_HIGH_BAND_PITCHDOWN', false)

/**
 * The struck / plucked onset family from the AUDIO (2026-11-01): when the caller
 * declared no `sourceKind` — the app never does — the score names no instrument
 * (a voice part, which is also the app's fallback score, or none) and the
 * classifier hears a struck or plucked instrument (`SourceAnalysis.struckOrPlucked`),
 * the take gets that family's onset policy: the detector's default dip, and so no
 * same-pitch gap bridge (`AudioConverter.bridgesSamePitchGaps` reads the family
 * from `onsetDipRatio`). A declared `sourceKind` never reads the verdict, so every
 * declared profile is unchanged; a score that names an instrument keeps deciding
 * the family as before. `RECORDING_PLUCKED_DETECT=0` is the kill-switch.
 *
 * Why: the score is a prior, and a guitar or piano played into a voice or empty
 * score was given the sustained dip and the bridge. The dip was measured to COST
 * on plucked/struck takes (`SUSTAINED_ONSET_DIP_RATIO`: GuitarSet −0.008*), and the
 * bridge's guards ("GuitarSet note-identical", "piano, guitar, bass exactly 0")
 * were measured with declared hints only.
 *
 * Why only on a score that names no instrument: the verdict's false positives sit
 * on low sustained instruments, which YAMNet often hears as plucked strings or a
 * keyboard (first 4 s, both splits: URMP tuba 11 of 15 clip × conditions, synthetic
 * contrabassoon 9/20, euphonium 7/24, tuba 7/24), so letting it overrule a `tuba`
 * score would take the sustained policy from tubas recorded into their own part —
 * the common case — to fix a guitar played into a tuba part. That case stays: a
 * plucked or struck take on a score naming a sustained instrument still gets the
 * sustained dip and the bridge (its cost is on `EXTRACTOR_BRIDGE_GAP_SEC`).
 *
 * ## Measured 2026-11-01 (rule fixed a priori, nothing tuned; both splits as guard looks)
 *
 * The verdict, at the production lock prefix (first pitched ≥ 1.2 s) / from 2.2 s /
 * on the first 4 s the harness cache resolves on: GuitarSet 235 / 244 / 248 of 250
 * clip × conditions (real 50/50, echoey 49/50, distant 40/50, measured RIRs 96/100 at
 * the lock); synthetic piano, guitar and bass guitar 41 / 59 / 60 of 60. False
 * positives at the lock (4 s): URMP + TinySOL 25/400 (31), synthetic sustained
 * instruments 22/684 (31), singing app takes 1/52, whistles 1/142, synthetic voices 0/162.
 *
 * Undeclared rows (`EVAL_UNDECLARED_SOURCE=1`, score `voice-lead` / none; this vs
 * `RECORDING_PLUCKED_DETECT=0`, which is the old resolver profile for profile):
 *   GuitarSet (cached, all conditions): COnP +0.000 [−0.008, +0.009] dev, +0.002
 *     [−0.010, +0.017] test (no score: +0.000 / +0.001); COnPOff +0.015* / +0.017*
 *     (+0.014* / +0.019*); clean +0.011* / +0.009, rooms −0.002…−0.008 n.s. — the
 *     bridge's room gain given back for the dip's clean loss: on a `voice-lead`
 *     score it is the declared `guitar` row note for note, but for 2 dev distant-mic
 *     clips the verdict misses.
 *   Synthetic piano / guitar / bass guitar (model path, home-phone + room): +0.006
 *     [+0.002, +0.011]* over both splits (dev +0.009*, test −0.001), COnPOff +0.015*.
 *   What a false positive costs, sustained instruments on a `voice-lead` score: URMP
 *     −0.002 [−0.003, −0.001]* dev, +0.003 test; synthetic, the 8 instruments it ever
 *     fires on, home-phone −0.003 [−0.006, −0.000]* (both splits), room +0.000.
 * The harness verdict sees 4 s where production sees the lock prefix, and a miss
 * leaves a take exactly as before; keeping the gated rows only where the verdict fires
 * at the lock: GuitarSet COnP −0.002…+0.003 (n.s.), COnPOff +0.013…+0.017* on every
 * split × score; synthetic +0.004…+0.006*.
 */
const PLUCKED_DETECT = envFlag('RECORDING_PLUCKED_DETECT')

function whistleOnsetDip(raw: string | undefined): number | undefined {
    if (raw === undefined || raw === '' || raw === 'legacy') return undefined
    if (raw === 'off') return 0
    const v = Number(raw)
    return Number.isFinite(v) && v >= 0 ? v : undefined
}

/**
 * Noise-adaptation thresholds (tuned against the adverse tier of the eval
 * corpus — scripts/eval). A recording counts as noisy when either a
 * meaningful share of its energetic frames are broadband (wind gusts,
 * chatter) or its quiet frames sit close to its loud ones (steady backdrop).
 *
 * `NOISY_MAX_SNR_DB`: a take counts as noisy when the measured
 * signal-to-backdrop ratio drops below this. Takes with no measurable
 * backdrop (snrDb undefined — e.g. wall-to-wall clean legato) are never
 * flagged: absence of quiet frames is not evidence of noise.
 */
const NOISY_MAX_SNR_DB = envNumber('RECORDING_NOISY_MAX_SNR_DB', 25)
const NOISY_MIN_NOISINESS = envNumber('RECORDING_NOISY_MIN_NOISINESS', 0.5)
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
const NOISY_CONFIDENCE_BUMP = envNumber('RECORDING_NOISY_CONF_BUMP', 0)
const NOISY_CONFIDENCE_CAP = 0.75
const NOISY_MIN_FRAMES_PER_NOTE = envNumber('RECORDING_NOISY_MIN_FRAMES', 4)
const NOISY_DENOISE = envFlag('RECORDING_NOISY_DENOISE', false)

function clamp(x: number, lo: number, hi: number): number {
    return Math.max(lo, Math.min(hi, x))
}

/**
 * How far the voicing gate may be relaxed on a fully reverberant take, and the
 * floor it may never go below. See `estimateReverberance` for why this is the
 * adaptation reverb actually wants.
 */
const REVERB_CONFIDENCE_RELIEF = envNumber('RECORDING_REVERB_CONF_RELIEF', 0.25)
const REVERB_CONFIDENCE_FLOOR = envNumber('RECORDING_REVERB_CONF_FLOOR', 0.25)

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
 * `RecordingPipeline.resolveProfile` locks the profile as soon as the scanned
 * prefix — at least `DETECT_MIN_SEC` = 1.2 s — holds pitch (deferring up to
 * `DETECT_MAX_WAIT_SEC` = 8 s while it does not), and only a take locked on the
 * fallback is re-resolved, on the final pass (`rerouteFinal`). So for a take
 * that starts pitched, the estimate that ships is made from a ~1.5 s prefix, not
 * a whole take. Re-measured that way:
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
 * -0.000 test, same reverb gain). The plumbing for a final-pass re-resolve now
 * exists (`RecordingPipeline.rerouteFinal`), but it re-resolves fallback takes
 * only; re-estimating reverberance over the whole of a pitched take is still open.
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
    if (reverberance <= 0 || base.confidenceThreshold === undefined) return base
    const relaxed = Math.max(REVERB_CONFIDENCE_FLOOR, base.confidenceThreshold - REVERB_CONFIDENCE_RELIEF * reverberance)
    if (relaxed >= base.confidenceThreshold) return base
    return { ...base, id: base.id + '+reverb', confidenceThreshold: relaxed }
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
    if (!isVoice || !VOICE_DECODE || base.providerName === PITCHDOWN_PROVIDER_NAME) return base
    const onsetMinTroughSec = VOICE_ONSET_MIN_TROUGH_SEC ?? base.onsetMinTroughSec
    return { ...base, ...VOICE_OVERLAY, id: base.id + '+voice', ...(onsetMinTroughSec !== undefined ? { onsetMinTroughSec } : {}) }
}

/**
 * Re-attack sensitivity per source family: sung and sustained-instrument takes need a
 * deeper envelope dip before a re-attack counts (vibrato in a room is not one);
 * struck / plucked instruments keep the detector's default. For sustained instruments
 * the deeper dip gives way to the default as the take gets more reverberant, since a
 * heavy room fills the short gap between tongued repeated notes. See
 * `SUSTAINED_ONSET_DIP_RATIO` for the measurements. `struckOrPlucked` is the score's
 * instrument or, undeclared, the audio (`RECORDING_PLUCKED_DETECT`).
 */
function applyOnsetPolicy(
    base: PipelineProfile,
    isVoice: boolean,
    struckOrPlucked: boolean,
    reverberance: number,
    whistle = false,
): PipelineProfile {
    if (ONSET_POLICY_LEGACY || base.onsetDipRatio !== undefined) return base
    if (whistle && WHISTLE_ONSET_DIP !== undefined) {
        const dip = WHISTLE_ONSET_RAMP
            ? WHISTLE_ONSET_DIP + (OnsetDetector.DEFAULT_DIP_RATIO - WHISTLE_ONSET_DIP) * clamp(reverberance, 0, 1)
            : WHISTLE_ONSET_DIP
        return { ...base, onsetDipRatio: dip }
    }
    if (isVoice) return { ...base, onsetDipRatio: VOICE_DIP_OVERRIDE ?? VOICE_ONSET_DIP_RATIO }
    if (struckOrPlucked) return base
    const dry = SUSTAINED_DIP_OVERRIDE ?? SUSTAINED_ONSET_DIP_RATIO
    if (!SUSTAINED_REVERB_RAMP) return { ...base, onsetDipRatio: dry }
    return { ...base, onsetDipRatio: dry + (OnsetDetector.DEFAULT_DIP_RATIO - dry) * clamp(reverberance, 0, 1) }
}

/** Tag a whistle-family anchor in its id, so the routing shows in logs and archived sessions. */
function markWhistle(base: PipelineProfile, whistle: boolean): PipelineProfile {
    return whistle ? { ...base, id: base.id + '+whistle' } : base
}

function band(id: string): PipelineProfile {
    const found = PROFILE_BANDS.find((b) => b.id === id)
    return found ?? DEFAULT_PROFILE
}

/**
 * Map the detected median fundamental to a register band. Boundaries chosen so
 * piccolo / whistling (median ≳ 1.3 kHz, with notes reaching above the
 * CREPE ~1997 Hz ceiling) land in the octave-down `very-high` band, while
 * everything the trajectory providers can fully cover routes to them.
 */
function bandFor(medianHz: number): PipelineProfile {
    if (medianHz >= 1300) return band('very-high')
    if (medianHz >= 550) return band('high')
    if (medianHz >= 200) return band('mid')
    return band('low')
}

export class ProfileResolver {
    private readonly logger = new Logger(ProfileResolver.name)
    // Shared model under the hood, so per-recording resolver instances are free.
    private readonly sourceClassifier = new SourceClassifier()

    /**
     * Resolves once the source classifier's model has loaded (or failed to).
     * Production never waits — until then the classifier abstains and the prior
     * decides — but a caller that needs the verdict to be a pure function of the
     * audio (the eval harness's cache builds) awaits this first, and passes
     * `requireClassifier` when it will declare no `sourceKind`: a missing model
     * then throws instead of quietly resolving by the prior. The whistle check
     * (`RECORDING_WHISTLE_DETECT`) reads the verdict whatever the caller declares,
     * so under it a missing model always throws here.
     */
    async ready(requireClassifier = false): Promise<void> {
        await this.sourceClassifier.ready(requireClassifier || WHISTLE_DETECT)
    }

    /**
     * @param samples     mono PCM of the first ~seconds of the recording
     * @param sampleRate  sample rate of `samples`
     */
    resolve(samples: Float32Array, sampleRate: number, hint?: ProfileHint): PipelineProfile {
        const scan = scanPitch(samples, sampleRate)
        const hintRange = rangeForInstrument(hint?.instrumentId)
        // An explicit caller declaration wins outright. Absent one, the audio
        // itself decides (stock-YAMNet classifier, 98.7 % decided accuracy at this
        // very prefix), and only an abstention — near-silence, ambiguity, model
        // not loaded yet — falls back to the score's instrument prior.
        // One YAMNet pass answers both questions; it runs when the caller declared
        // nothing, or when the whistle check is on (which ignores a declaration).
        const analysis = hint?.sourceKind === undefined || WHISTLE_DETECT ? this.sourceClassifier.analyze(samples, sampleRate) : undefined
        const classified = hint?.sourceKind === undefined ? analysis?.source : undefined
        const heardWhistling = WHISTLE_DETECT && analysis?.whistling === true
        const whistle = WHISTLE_FAMILY && (hint?.instrumentId === 'whistle' || heardWhistling)
        const voiceOtherwise =
            hint?.sourceKind === 'voice' ||
            (hint?.sourceKind === undefined && (classified !== undefined ? classified === 'voice' : isVoiceInstrument(hint?.instrumentId)))
        const isVoice = voiceOtherwise && !whistle
        const scoreNamesNoInstrument = hint?.instrumentId === undefined || isVoiceInstrument(hint.instrumentId)
        const heardStruckOrPlucked =
            PLUCKED_DETECT && hint?.sourceKind === undefined && scoreNamesNoInstrument && analysis?.struckOrPlucked === true
        const struckOrPlucked = isStruckOrPluckedInstrument(hint?.instrumentId) || heardStruckOrPlucked
        const sourceDecidedBy: PipelineProfile['sourceDecidedBy'] =
            whistle && voiceOtherwise
                ? heardWhistling
                    ? 'classifier'
                    : 'prior'
                : hint?.sourceKind !== undefined
                  ? 'explicit'
                  : classified !== undefined
                    ? 'classifier'
                    : 'prior'
        const sourceBelief: PipelineProfile['sourceBelief'] = isVoice ? 'voice' : 'instrument'
        const noisy = (scan.snrDb !== undefined && scan.snrDb <= NOISY_MAX_SNR_DB) || scan.noisiness >= NOISY_MIN_NOISINESS
        const reverberance = estimateReverberance(samples, sampleRate)

        if (!scan.voiced) {
            // No reliable pitch yet — fall back to a wide default, widened to the
            // hint range if we have one. (With the harmonicity gate this is also
            // where pure-backdrop lead-ins land, instead of locking a garbage band.)
            const base = {
                ...applyOnsetPolicy(
                    applyVoice(this.applyNoise(markWhistle(DEFAULT_PROFILE, whistle), noisy), isVoice),
                    isVoice,
                    struckOrPlucked,
                    reverberance,
                    whistle,
                ),
                sourceBelief,
                sourceDecidedBy,
            }
            if (!hintRange) return base
            return this.finalize(base, hintRange.minHz, hintRange.maxHz, base.id + '+hint')
        }

        // Fit a window around the detected distribution, with headroom: pad below
        // for the lowest note's fundamental and above for vibrato / the top note.
        // The low bound is deliberately generous — a too-high floor *clips* notes
        // (catastrophic), while a too-low floor only mildly risks an octave error
        // the high-pass and post-processing still suppress. Allowing ~1.7 octaves
        // below the median guards against the scan locking onto a harmonic of a low
        // brass / double-reed fundamental (e.g. a trombone whose energy peaks at the
        // 3rd harmonic), which would otherwise clip its real low notes with no hint.
        let lowHz = Math.min(scan.p10Hz * 0.6, scan.medianHz * 0.3)
        let highHz = scan.p90Hz * 1.5

        // Union with the hint range so early/extreme notes aren't clipped before
        // the scan saw them.
        if (hintRange) {
            lowHz = Math.min(lowHz, hintRange.minHz)
            highHz = Math.max(highHz, hintRange.maxHz)
        }

        // The whistle family may leave the register router for the octave-down band.
        const register = bandFor(scan.medianHz)
        const anchor = markWhistle(
            whistle && WHISTLE_PITCHDOWN
                ? band('very-high')
                : HIGH_BAND_PITCHDOWN && !isVoice && register.id === 'high'
                  ? { ...band('very-high'), id: 'high+pitchdown' }
                  : register,
            whistle,
        )
        const base = {
            ...applyOnsetPolicy(
                applyVoice(applyReverb(this.applyNoise(anchor, noisy), reverberance), isVoice),
                isVoice,
                struckOrPlucked,
                reverberance,
                whistle,
            ),
            sourceBelief,
            sourceDecidedBy,
        }
        const profile = this.finalize(base, lowHz, highHz, base.id)
        this.logger.debug(
            `Resolved profile=${profile.id} provider=${profile.providerName} ` +
                `window=${profile.minFreqHz.toFixed(0)}-${profile.maxFreqHz.toFixed(0)}Hz ` +
                `hp=${profile.highpassHz.toFixed(0)} ` +
                `conf=${profile.confidenceThreshold?.toFixed(2) ?? 'n/a'} ` +
                `(scan p10/med/p90=${scan.p10Hz.toFixed(0)}/${scan.medianHz.toFixed(0)}/${scan.p90Hz.toFixed(0)}Hz, ` +
                `frames=${scan.voicedFrames}, snr=${scan.snrDb?.toFixed(0) ?? 'n/a'}dB, ` +
                `noiseFloor=${scan.noiseFloorDb.toFixed(0)}dB, ` +
                `noisiness=${scan.noisiness.toFixed(2)}${noisy ? ' NOISY' : ''}, ` +
                `reverberance=${reverberance.toFixed(2)}, ` +
                `hint=${hint?.instrumentId ?? 'none'}/${hint?.sourceKind ?? 'auto'}` +
                `${hint?.sourceKind === undefined ? `, classified=${classified ?? 'abstain'}` : ''}` +
                `${profile.isVoice ? ' VOICE' : ''}${whistle ? ' WHISTLE' : ''}${heardStruckOrPlucked ? ' PLUCKED' : ''})`,
        )
        return profile
    }

    /**
     * Adapt a band anchor to a measured noisy backdrop: turn on the decoder's
     * spectral denoiser and tighten the note gates, trading a sliver of clean
     * recall for not hallucinating notes out of wind, chatter, or reverb wash.
     */
    private applyNoise(base: PipelineProfile, noisy: boolean): PipelineProfile {
        if (!noisy || !NOISE_ADAPT) return base
        return {
            ...base,
            id: base.id + '+noise',
            denoise: NOISY_DENOISE || undefined,
            confidenceThreshold:
                base.confidenceThreshold === undefined
                    ? undefined
                    : Math.min(NOISY_CONFIDENCE_CAP, base.confidenceThreshold + NOISY_CONFIDENCE_BUMP),
            minFramesPerNote: NOISY_MIN_FRAMES_PER_NOTE,
        }
    }

    /** Apply the dynamic window + high-pass to a band anchor, with safety rules. */
    private finalize(base: PipelineProfile, lowHz: number, highHz: number, id: string): PipelineProfile {
        // The at-pitch CREPE provider can't see above its ~1997 Hz ceiling, so cap
        // its window there — the band router already sends sources whose register
        // sits above the ceiling to the octave-down `very-high` band, which hears
        // to 2× that ceiling.
        const ceiling = base.providerName === PITCHDOWN_PROVIDER_NAME ? PITCHDOWN_MODEL_CEILING_HZ : TRAJECTORY_MODEL_CEILING_HZ

        const minFreqHz = clamp(lowHz, GLOBAL_MIN_FREQ_HZ, ceiling - 100)
        const maxFreqHz = clamp(Math.max(highHz, minFreqHz + 100), minFreqHz + 100, ceiling)
        // High-pass must sit safely below the lowest fundamental we want to keep.
        const highpassHz = clamp(minFreqHz * 0.6, 30, 400)

        return {
            ...base,
            id,
            providerName: base.providerName,
            minFreqHz,
            maxFreqHz,
            highpassHz,
        }
    }
}
