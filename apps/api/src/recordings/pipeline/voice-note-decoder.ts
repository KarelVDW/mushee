import type { NoteEventTime } from './note-event';

import type { PitchTrack } from './pitch-track';

/**
 * Note decoding **for the human voice**.
 *
 * The shipping decoder (`providers/pitch-decoder.ts`, `segmentNotesBySemitone`)
 * rounds each frame to a semitone, median-smooths, and emits a note per run of
 * equal semitone. That is a good decoder for instruments and a poor one for
 * singing, and the corpus says so: on studio singing it emits ~1.9 notes for every
 * one sung, and ~29 of every 100 reference notes come back as a chain of
 * fragments. Two structural reasons, neither fixable by tuning the smoother:
 *
 *  - **It has no notion of a note.** Every boundary decision is local, so vibrato
 *    crossing a semitone line, a portamento passing through, and a real note change
 *    are the same event to it.
 *  - **It cannot see a re-onset at all.** Two "la"s on one pitch are one run of one
 *    semitone. Only energy or a pitch dip distinguishes them, and neither reaches
 *    the segmenter.
 *
 * This decoder is the voice answer to both. It is a Viterbi over
 * {silence} ∪ {attack(p), stable(p)} — the pYIN/Tony note model (Mauch et al.,
 * TENOR 2015), built for exactly our hardest input. Measured on the voice slice of
 * the real corpus, **COnP@±100 ms 0.570 → 0.668 on held-out test**
 * (+0.123 [+0.102, +0.144], paired over 289 clips).
 *
 * ## What actually ships, and what it is worth
 *
 * 1. **Onset calibration** (`onsetShiftSec`) — **the largest single effect, +0.15.**
 *    The attack state fits the contour the moment it *departs* the previous note;
 *    an annotator marks where the pitch *arrives*. Measured lead: 52 ms. Read that
 *    docstring before touching anything else here.
 * 2. **A silence state the decode reaches for on its own.** Sweeping the note-change
 *    cost, everything at ≥ 2.5 nats scores identically — the direct jump is never
 *    taken, so the model lands on Dynamic HumTrans's mandatory-silence structure
 *    (arXiv:2410.05455) by pricing rather than by construction, which is what §4 of
 *    `scripts/eval/research/research-voice-transcription.md` predicted.
 * 3. **Two boundary-evidence channels, fused** (Kroher & Gómez, TASLP 2016 — two
 *    deliberately separate detectors, "because at a given onset either one or both
 *    can be present"): a local volume decay against a ±145 ms context, and a pitch-
 *    dip z-score on the cent contour, the case an amplitude-only detector is blind
 *    to. Evidence *discounts* the cost of a boundary, never creates one — a
 *    splitter, never a creator — and it is what keeps genuine slurs writable when
 *    the change cost would otherwise forbid them (+0.005, transition recall
 *    0.62 → 0.65).
 * 4. **α-trimmed-mean note pitch** (α = 0.3, Molina et al.), not the state index:
 *    the states place boundaries, and once placed the contour is the better
 *    estimate. Worth **+0.03** over a plain mean — the trim is what drops the scoop
 *    and the release rather than averaging them in.
 *
 * ## What is implemented, measured, and OFF
 *
 * Each is a real mechanism from the literature that this corpus does not reward.
 * They are kept, defaulted off, and documented **with their numbers** on their own
 * options, because the reasons are the useful part and two of them are nulls only
 * *because* the list above already removed the failure they targeted:
 * `octavePriorWeight` (octave-error rate is now 0.001 — nothing to fix),
 * `mergeGuard` (SiPTH: a silence-separated decode emits no contiguous ±1-semitone
 * pair to act on), `reonsetCost`/`accentBonus` (Ryynänen's accent needs to be
 * band-wise; broadband RMS cannot discriminate), `wideChangeCost` (works, but the
 * split/merge trade is a flat repair-time frontier), `pitchWindow: 'onset'`.
 *
 * ⚠ Deliberately voice-only. The global-config version of this model family was
 * measured at −0.06…−0.16 F1 across the whole corpus (see the findings log in
 * `scripts/eval/README.md`): instruments do not want it, and it costs them ~0.03
 * here. It is reached only through a profile whose source is known to be a voice.
 */

export type VoiceTransitionMode = 'direct' | 'via-silence';

export interface VoiceDecodeOptions {
  // --- voicing gate (from the resolved profile) ---
  confidenceThreshold?: number;
  minFreqHz?: number;
  maxFreqHz?: number;
  /**
   * Block-level voiced-fraction quorum on the gate (R19; see
   * `PitchTrack.voicedMask`): a frame only stays voiced when at least
   * `minFraction` of its `windowSec` neighbourhood passes the raw gate, so a
   * few stray voiced frames — a reverb-tail flicker — cannot become a note.
   */
  voicedQuorum?: { minFraction?: number; windowSec?: number };
  /**
   * Fill unvoiced gaps up to this long (seconds) on the track before decoding
   * (R21; see `PitchTrack.fillDropouts`): a consonant or breath punching a
   * 1–2 frame hole mid-note gets interpolated pitch instead of relying on
   * `unvoicedPitchCost` to ride across it. Omit for the raw track.
   */
  fillUnvoicedGapSec?: number;
  /**
   * Energy gate on the fill above: only gaps whose per-frame energy stays at or
   * above this fraction of the quieter flank are filled (see
   * `PitchTrack.fillDropouts`). Separates a reverb puncture (confidence gone,
   * envelope sustained) from a consonant (envelope dips — real boundary
   * evidence, left alone). Needs `energy` in `decode`; omit for the
   * unconditional R21 fill.
   */
  fillEnergyFloor?: number;
  /** Context (seconds) for the fill's energy reference — see `PitchTrack.fillDropouts`. */
  fillEnergyContextSec?: number;
  /**
   * pYIN's multi-candidate emission (E3/R9/R16 — §5.6 of the plugin survey):
   * score each pitch state against the NEAREST of the frame's top-k activation
   * maxima (`PitchTrack.candCents`), adding `yinTrust · −ln(strength/maxStrength)`
   * nats for how much weaker that candidate is than the frame's best. The decode
   * can then keep a note on a non-argmax hypothesis — the recoverability that
   * makes pYIN's note model work, which a single collapsed trajectory
   * structurally cannot offer.
   *
   *  - `k`: candidates considered per frame (≤ the track's `candK`).
   *  - `yinTrust`: nats per e-fold of relative candidate weakness.
   *  - `octaveBias`: the survey's four-way convergent tie-break (§16.11 —
   *    "prefer the higher fundamental unless the lower is clearly better"):
   *    when two candidates sit within ±50 ¢ of an octave apart and the lower's
   *    strength is below `octaveBias` × the higher's, the lower is dropped.
   *    Omit to keep every candidate.
   *
   * Requires a track that carries candidates; omit for the single-trajectory
   * emission (the historical decode, bit-for-bit).
   */
  candidates?: { k?: number; yinTrust?: number; octaveBias?: number };
  /**
   * E4/R10(a): price a note change in PROPORTION to its interval — the single
   * strongest cross-reference agreement in the plugin survey (§16.7: pYIN's
   * Gaussian over semitone distance, Praat's cost per octave of leap), where we
   * charge a flat `changeCost`. The flat cost conflates the two events it must
   * separate: vibrato flutter is a ±1-step excursion, a melodic move is larger.
   *
   * cost(Δ) = changeCost · evidence + shape(Δ):
   *  - `'gaussian'` — Δ²/(2σ²) nats (pYIN §5.3; its σ is 0.7 semitones)
   *  - `'linear'`   — perOctaveNats · Δ/12 (Praat §6.2)
   * Jumps beyond `capSemitones` (pYIN's maxJump 13) are forbidden. Replaces the
   * O(1) prefix/suffix relaxation with a capped scan — the cap is what keeps
   * the frame cost bounded, the concern that shelved `wideChangeCost`'s smooth
   * form. Direct mode only; omit for the flat cost.
   */
  intervalChange?: {
    form: 'gaussian' | 'linear';
    sigmaSemitones?: number;
    perOctaveNats?: number;
    capSemitones?: number;
  };
  /**
   * E4/R10(b): pitch memory ACROSS SILENCE — Praat's path-lookback (§6.4),
   * the cheaper of the survey's two designs (pYIN's is per-pitch silence
   * states). Today a step and a minor tenth cost exactly the same after any
   * rest; with this, entering a note from silence adds
   * `perOctaveNats · |Δ|` nats, where Δ is the interval (in octaves) from the
   * pitch the current silence run left — read greedily off the running Viterbi
   * path, exactly as Praat does. `amortize` divides by the gap's length in
   * frames (Praat's form: a long rest forgets); without it the memory is a
   * fixed prior across any rest. Omit for the historical free jump.
   */
  silenceMemory?: { perOctaveNats?: number; amortize?: boolean };
  /**
   * E7/R6: fat1's two-stage voicing decay — split `unvoicedPitchCost`'s two
   * jobs. Today one scalar decides both whether a note SURVIVES a dropout and
   * whether its PITCH IDENTITY does. This releases the second first: once
   * `afterSec` of consecutive unvoiced frames have passed, the note-change
   * cost is multiplied by `discount` until voicing returns — a breath costs a
   * note its resistance to changing pitch before it costs the note its life
   * (which stays `unvoicedPitchCost`'s job alone). Under the shipping
   * saturated change cost this is what could let a slur through a consonant
   * be written without re-admitting vibrato splits on voiced frames.
   */
  unvoicedChangeRelease?: { afterSec?: number; discount?: number };

  // --- state space ---
  /** Pitch states per semitone. 3 (pYIN's value) resolves ~33-cent detuning. */
  stepsPerSemitone?: number;
  /** Emission σ for a note's attack phase, in semitones — deliberately wide. */
  sigmaAttackSemitones?: number;
  /** Emission σ for a note's stable phase, in semitones — deliberately narrow. */
  sigmaStableSemitones?: number;
  /** Exponent on the emission likelihood: how loudly per-frame pitch argues. */
  trust?: number;

  // --- transition structure ---
  transitionMode?: VoiceTransitionMode;
  /** Cost in nats of leaving a note for a different pitch ('direct' only). */
  changeCost?: number;
  /** Cost of a note's attack phase giving way to its stable phase. */
  attackCost?: number;
  /**
   * Cost of dwelling in attack — what makes the attack transient. Declared in
   * nats **per 10 ms** and rescaled to the track's hop at decode time (Praat's
   * convention), so a hop change cannot silently re-tune the model.
   */
  attackFrameCost?: number;
  /** Cost of starting a note out of silence. */
  onCost?: number;
  /** Cost of ending a note into silence. */
  offCost?: number;
  /** Emission cost charged to a pitch state on an UNVOICED frame. */
  unvoicedPitchCost?: number;
  /** Emission cost charged to silence on a VOICED frame. */
  voicedSilenceCost?: number;
  /** Minimum interval, in semitones, that counts as a note change (pYIN: 2/3). */
  minChangeSemitones?: number;
  /**
   * Cost of changing note across a **wide** interval — one of at least
   * `wideIntervalSemitones`.
   *
   * A single `changeCost` has to price two different events at once. A semitone
   * neighbour with no dip is nearly always vibrato or a scoop; a fourth with no dip
   * is nearly always a real slurred leap. Pricing them the same is what forces the
   * choice between splitting vibrato (cost too low) and merging slurs (cost too
   * high) — and at the cost that protects held notes, measured transition recall is
   * 0.65 against the shipping segmenter's 0.80.
   *
   * Two tiers rather than a smooth function of interval deliberately: the decode's
   * per-frame cost is O(states) only because the cheapest "far enough" predecessor
   * comes from a prefix/suffix minimum, and an arbitrary cost(interval) would make
   * it O(states²). Two tiers is two lookups per side.
   *
   * **Measured, and it does not pay — but the null is informative.** It works
   * mechanically: at `wideIntervalSemitones: 2, wideChangeCost: 0.6` every onset
   * class improves at once (transition recall 0.65 → 0.74, re-onset 0.33 → 0.37,
   * silence 0.91 → 0.92). COnP still falls 0.683 → 0.653, because the same
   * cheapening produces spurious splits and precision falls faster than recall
   * rises — and estimated repair time barely moves across the whole sweep
   * (698–745 s/100 notes against 715 for the shipping config).
   *
   * That flat frontier is the finding: the merge/split trade here is not leaving
   * accuracy on the table, so the decode's remaining transition misses are not a
   * mis-set cost. They are the limit of what pitch and energy alone can decide,
   * which is the learned-note-model gap the N20EMv2 yardstick already measures.
   *
   * Omit to price every interval at `changeCost`.
   */
  wideChangeCost?: number;
  /** Interval, in semitones, at or above which `wideChangeCost` applies. */
  wideIntervalSemitones?: number;
  /**
   * Cost in nats of **re-articulating the same pitch** — `stable(p) → attack(p)`,
   * the transition a pitch-only note model does not have.
   *
   * Without it "la-la-la" on one note is structurally one note: no pitch changes,
   * so no boundary exists to find. Adding the transition and pricing it against the
   * boundary-evidence channels is Ryynänen's mechanism (SAPA 2004 — an accent
   * feature *inside* the attack state) rather than a post-hoc splitter, which means
   * a re-onset competes against the alternative readings of the same frames instead
   * of being stamped on afterwards.
   *
   * Set high: the evidence discount is what makes it affordable, so with no dip in
   * either energy or pitch a held note is never shattered. `Infinity` removes the
   * transition entirely.
   */
  reonsetCost?: number;
  /** Shortest note kept, in seconds. Absorbed into a neighbour, not dropped. */
  minNoteSec?: number;

  // --- joint duration × velocity filters (WaoN §9.3 of the plugin survey) ---
  /**
   * Exempt a run shorter than `minNoteSec` from absorption when it is LOUD: its
   * peak energy reaches this multiple of the clip's median voiced energy.
   *
   * WaoN's reading of the short-note filter (`notes.c:232`): a short note that is
   * also loud is a real staccato note; only short AND quiet is a glitch. Our
   * duration-only floor cannot make that distinction. Needs `energy`; omit to
   * absorb every short run (the historical rule).
   */
  keepShortLoudRatio?: number;
  /**
   * Drop an emitted note that is long AND quiet — at least `minSec` long with
   * mean energy below `quietRatio` × the clip's median voiced energy.
   *
   * WaoN's second pass (`notes.c:319`), the filter we never had: a long, quiet
   * note is the shape of a reverb tail or bleed-through, which no duration-only
   * filter can express. Needs `energy`; omit to keep every long note.
   */
  dropLongQuiet?: { minSec?: number; quietRatio?: number };

  /**
   * Where in the decoded run a note's onset is reported.
   *
   * This is not cosmetic — it was worth ~50 ms of systematic error. The attack
   * state exists to absorb the **scoop into** a note (its σ is 5 semitones, so it
   * fits anything), which means the decode enters it as soon as the contour starts
   * travelling toward the new pitch. That is the right place for the *model* to
   * switch notes and the wrong place to say the note *began*: annotators put a
   * sung onset at the vowel, i.e. where the pitch arrives (Molina et al.'s
   * annotation rules; ROSVOT §3.4 makes the same point about consonants delaying
   * pitch onset). Measured on our voice slice, reporting the attack's start put
   * every onset a median 44–52 ms early against ground truth, where the shipping
   * segmenter sits at −19 ms.
   *
   *  - `'attack'`  — the run's first frame (what a naive pYIN port does).
   *  - `'arrival'` — the first frame whose contour is within `arrivalCents` of the
   *                  note's own decoded pitch. This is the principled one: it is
   *                  where the pitch *gets there*, which is what an annotator
   *                  marks, and it is (implicitly) where the shipping
   *                  semitone-run segmenter puts its boundaries — which is why
   *                  that segmenter's onset bias is already near zero.
   *  - `'stable'`  — the frame the decode leaves the attack phase. A model event
   *                  rather than an acoustic one, and measurably noisier.
   *  - `'mid'`     — halfway between attack and stable.
   */
  onsetAt?: 'attack' | 'arrival' | 'stable' | 'mid';
  /** `'arrival'` tolerance: how close to the note's pitch counts as arrived. */
  arrivalCents?: number;
  /**
   * Constant added to every onset, in seconds (+ = later): the **measured lead of
   * the attack-state entry over the annotated onset**.
   *
   * A constant is the right shape here, and the corpus is unusually clear about
   * it. Measured onset error at `onsetAt: 'attack'` is −52 ms mean / −44 ms median
   * across the voice slice, and correcting it is worth **+0.15 COnP** — by far the
   * largest single effect in this decoder. Two controls say it is a real latency of
   * *this decode* rather than a habit of the annotations or a smear:
   *
   *  - Applying the same shift to the shipping semitone-run segmenter buys almost
   *    nothing (+0.028 at 40 ms, +0.008 at 60 ms) — that segmenter is already
   *    calibrated (bias −2 ms), so the corpus is not systematically late.
   *  - All three voice corpora peak in the same place (70–100 ms), including
   *    N20EMv2, whose onsets are Melodyne drafts corrected by two music experts —
   *    the most credible annotation provenance in the harness.
   *
   * The cause is structural: the attack state has σ = 5 semitones, so it fits the
   * contour the instant it *departs* the previous note, whereas an annotator marks
   * where the pitch *arrives*. Rules that try to find arrival directly were tried
   * and measure worse (`'arrival'` +0.07, `'stable'` +0.05, vs +0.15 for the
   * constant): the lead is consistent, while any per-note estimate of it is noisy,
   * and the noise costs more than the bias it removes.
   */
  onsetShiftSec?: number;

  // --- boundary evidence (§ Kroher & Gómez) ---
  /**
   * Multiplier applied to `changeCost`/`onCost` on frames carrying boundary
   * evidence. 1 = evidence ignored; 0.2 = a boundary there is five times cheaper.
   */
  evidenceDiscount?: number;
  /** Local volume decay (dB, negative) against the ±context peak that counts. */
  energyDipDb?: number;
  /** Pitch-dip z-score (negative) on the local cent contour that counts. */
  pitchDipZ?: number;
  /** Half-width of the context window for both channels, in seconds. */
  evidenceContextSec?: number;

  /**
   * Nats credited against the **re-onset transition** on a frame where the energy
   * is rising — Ryynänen's **accent feature** (SAPA 2004), the published mechanism
   * for same-pitch repeats, reduced to the broadband envelope we have.
   *
   * It is what makes `reonsetCost` do anything at all. Re-articulating the same
   * pitch changes no emission by itself, so the transition is pure added cost and a
   * Viterbi never takes it however cheaply it is priced — measured: with the
   * transition enabled but no accent term, re-onset recall moved 0.118 → 0.124,
   * i.e. it essentially never fired.
   *
   * Credited against the TRANSITION rather than the attack state's emission, which
   * was tried first and is wrong: an emission credit applies on every attack frame
   * of every note, so it makes the whole decode reluctant to settle — re-onset
   * recall rose to 0.31 but transition recall fell 0.62 → 0.50 and COnP with it.
   * Against the transition it can only ever buy the one boundary it is evidence for.
   *
   * **Measured, and it does not pay — with a broadband envelope.** At credits small
   * enough to leave COnP intact (0.5–1 nats) the transition barely fires (re-onset
   * recall 0.124 → 0.129); at credits large enough to fire (2–4 nats) recall reaches
   * 0.29 but COnP collapses to 0.40–0.53 and onset bias runs to +40 ms, because
   * broadband RMS rises inside sustained notes almost as often as at a
   * re-articulation. Ryynänen's feature is **band-wise** spectral energy rise; the
   * whole-signal reduction of it is not selective enough, and reviving this needs
   * the per-band version, not another sweep of these two constants.
   *
   * (An earlier run of this experiment was invalid: `coalesce` rejoined same-pitch
   * runs across a re-articulation whenever any short run elsewhere in the take
   * triggered an absorption pass, so the transition was being silently undone. The
   * numbers above are from after that fix.)
   *
   * 0 disables the credit (and so, in practice, the re-onset transition).
   */
  accentBonus?: number;
  /** Energy rise, in dB over `accentLagSec`, that scores a full accent. */
  accentRiseDb?: number;
  /** Lag the rise is measured over, in seconds. */
  accentLagSec?: number;

  // --- octave prior at voicing onsets ---
  /** Session register centre in absolute MIDI cents (A4 = 6900). */
  registerCents?: number;
  /** Nats charged per octave of distance from `registerCents` when entering a note. */
  octavePriorWeight?: number;

  // --- post-decode ---
  /** SiPTH merge guard; omit to disable. */
  mergeGuard?: {
    /** Deviation from the running mean a split must exceed, in semitones. */
    deltaSemitones?: number;
    /** Accumulated deviation·time a split must reach, in semitone·seconds. */
    gammaSemitoneSec?: number;
    /** Largest interval the guard will consider rejoining, in semitones. */
    maxIntervalSemitones?: number;
  };
  /** Fraction trimmed from each tail before averaging a note's contour. */
  pitchTrim?: number;
  /**
   * How a note's pitch is read off its contour.
   *
   *  - `'trimmed-mean'` — α-trimmed mean, α = `pitchTrim` (Molina et al.'s
   *    companion trick to SiPTH).
   *  - `'hann-median'`  — Hann-weighted median over the note's span, i.e. the
   *    literature's other answer to the same problem: Yong, Su & Nam (ICASSP 2023)
   *    weight the contour by a Hann window "to reduce the influence of the F0 near
   *    the boundaries, which are the most expressive part". Where trimming *cuts*
   *    the tails, this *fades* them, which is gentler on short notes that cannot
   *    spare 30 % from each end.
   *
   * **Measured, and the two are equivalent** (dev voice slice: 0.683 trimmed vs
   * 0.686 Hann, both inside the ~0.03 minimum detectable effect; `pWrong` is 14 per
   * 100 either way). The split is the informative part and it repeats a pattern
   * seen elsewhere in this decoder: Hann lifts N20EMv2 (+0.03, long sustained notes)
   * and costs vocadito (−0.02, short expressive ones). The residual semitone-level
   * pitch error is not an estimator problem — the two published estimators disagree
   * about which corpus to help and neither reduces it — which is the same
   * conclusion the N20EMv2 yardstick reaches: it is the learned-note-model gap.
   *
   * Ships as `'trimmed-mean'`, i.e. the published α rather than the marginally
   * higher number, since choosing between them on 0.003 would be fitting noise.
   *
   * Three further variants from the plugin survey (task 7 of the plugin pass),
   * each a different answer to "the boundaries are the expressive part":
   *
   *  - `'slew-limit'`  — TalentedHack's rate limiter with momentum (§12.2):
   *    smooth the contour causally with a slew limit (small differences bypass
   *    it entirely; momentum accelerates, then snaps to the target when the
   *    remaining distance is smaller than the step), then take the median of
   *    the smoothed contour. Unlike a one-pole this *arrives and holds*.
   *  - `'one-pole'`    — fat1/zita-at1's within-note smoother (§3.2): causal
   *    one-pole (time constant `onePoleTauSec`), hard-reset at the note start
   *    since it runs per note; median of the smoothed contour.
   *  - `'detrend'`     — MXTune's per-note linear detrend (§1.3): least-squares
   *    line over the contour; the note's pitch is the line at the note's
   *    temporal centre plus the median residual — pulled less by a monotonic
   *    scoop or portamento tail than a median of the raw contour is.
   *  - `'slope-gated'` — R24 (OpenTune §20.5): the CONDITIONAL twist on
   *    detrend the unconditional variants lacked. Slope from medians of the
   *    first/last max(3, n/5) frames, converted to an angle normalised at
   *    7 st/s; only when 10° ≤ |angle| ≤ 30° is the contour rotated flat
   *    around its centre before the trimmed mean — scoops get straightened,
   *    flat notes and deliberate glides are left alone.
   */
  pitchEstimator?:
    | 'trimmed-mean'
    | 'hann-median'
    | 'slew-limit'
    | 'one-pole'
    | 'detrend'
    | 'slope-gated';
  /** `'slew-limit'`: seconds the limiter takes to close a full step. */
  slewTimeSec?: number;
  /** `'one-pole'`: the smoother's time constant, in seconds. */
  onePoleTauSec?: number;
  /**
   * Which frames of the run the note's pitch is measured over.
   *
   *  - `'run'`   — all of them, including the attack. The trim is expected to
   *                remove the scoop.
   *  - `'onset'` — only from the reported onset (see `onsetAt`/`onsetShiftSec`),
   *                i.e. from where the pitch has arrived. The attack frames are
   *                travel, not the note, and averaging them in is what pulls a
   *                scooped note flat.
   *
   * **Measured, and `'run'` wins** (dev voice slice: 0.683 vs 0.674). The theory is
   * right and the trade is real but goes the wrong way: excluding the glide lifts
   * the two corpora of sustained notes (annotated-vocalset 0.60 → 0.61, N20EMv2
   * 0.69 → 0.70) and costs vocadito 0.76 → 0.72, because vocadito's notes are short
   * and dropping their first 70 ms leaves too few frames to average. Kept as an
   * option because it is the right knob if the note-length distribution ever shifts.
   */
  pitchWindow?: 'run' | 'onset';
}

interface Run {
  start: number;
  end: number;
  /** Pitch-state index, or -1 for silence. */
  state: number;
  /**
   * True when this run begins at a re-articulation of the SAME pitch, i.e. the
   * decode paid `reonsetCost` for the boundary.
   *
   * Carried on the run because it is the one boundary that is invisible in the
   * state sequence: the pitch index does not change across it, so `coalesce`
   * would otherwise rejoin the two halves the moment any unrelated short run
   * elsewhere in the take triggered an absorption pass — silently undoing every
   * re-onset in the take.
   */
  reonset?: boolean;
}

const DEFAULTS = {
  confidenceThreshold: 0.5,
  minFreqHz: 55,
  maxFreqHz: 2200,
  stepsPerSemitone: 3,
  sigmaAttackSemitones: 5,
  sigmaStableSemitones: 0.9,
  trust: 0.1,
  transitionMode: 'direct' as VoiceTransitionMode,
  changeCost: 1.2,
  attackCost: 0.2,
  attackFrameCost: 0.175,
  onCost: 0.5,
  offCost: 0.5,
  unvoicedPitchCost: 1.5,
  voicedSilenceCost: 1.5,
  minChangeSemitones: 2 / 3,
  wideIntervalSemitones: 3,
  reonsetCost: Infinity,
  minNoteSec: 0.08,
  pitchEstimator: 'trimmed-mean' as NonNullable<VoiceDecodeOptions['pitchEstimator']>,
  slewTimeSec: 0.05,
  onePoleTauSec: 0.04,
  pitchWindow: 'run' as 'run' | 'onset',
  onsetAt: 'attack' as 'attack' | 'arrival' | 'stable' | 'mid',
  arrivalCents: 50,
  onsetShiftSec: 0.07,
  evidenceDiscount: 1,
  energyDipDb: -6,
  pitchDipZ: -2,
  evidenceContextSec: 0.145,
  accentBonus: 0,
  accentRiseDb: 6,
  accentLagSec: 0.04,
  octavePriorWeight: 0,
  pitchTrim: 0.3,
};

export class VoiceNoteDecoder {
  /** Every knob resolved, except the eleven that are meaningfully absent. */
  private readonly o: Required<
    Omit<
      VoiceDecodeOptions,
      | 'registerCents'
      | 'mergeGuard'
      | 'wideChangeCost'
      | 'keepShortLoudRatio'
      | 'dropLongQuiet'
      | 'voicedQuorum'
      | 'fillUnvoicedGapSec'
      | 'fillEnergyFloor'
      | 'fillEnergyContextSec'
      | 'candidates'
      | 'intervalChange'
      | 'silenceMemory'
      | 'unvoicedChangeRelease'
    >
  > &
    Pick<
      VoiceDecodeOptions,
      | 'registerCents'
      | 'mergeGuard'
      | 'wideChangeCost'
      | 'keepShortLoudRatio'
      | 'dropLongQuiet'
      | 'voicedQuorum'
      | 'fillUnvoicedGapSec'
      | 'fillEnergyFloor'
      | 'fillEnergyContextSec'
      | 'candidates'
      | 'intervalChange'
      | 'silenceMemory'
      | 'unvoicedChangeRelease'
    >;

  constructor(opts: VoiceDecodeOptions = {}) {
    this.o = { ...DEFAULTS, ...stripUndefined(opts) };
  }

  /**
   * Decode `track` into notes. `energy` (per-frame RMS on the track's own frame
   * grid) powers the volume-decay evidence channel; without it only the pitch-dip
   * channel contributes.
   */
  decode(track: PitchTrack, energy?: Float32Array): NoteEventTime[] {
    const frames = track.frames;
    if (frames === 0) return [];

    if (this.o.fillUnvoicedGapSec !== undefined) {
      track = track.fillDropouts({
        confidenceThreshold: this.o.confidenceThreshold,
        minFreqHz: this.o.minFreqHz,
        maxFreqHz: this.o.maxFreqHz,
        maxGapFrames: Math.max(
          1,
          Math.round(this.o.fillUnvoicedGapSec / track.hopSec),
        ),
        energy,
        energyFloorRatio: this.o.fillEnergyFloor,
        energyContextFrames:
          this.o.fillEnergyContextSec === undefined
            ? 0
            : Math.round(this.o.fillEnergyContextSec / track.hopSec),
      });
    }

    const voiced = track.voicedMask({
      confidenceThreshold: this.o.confidenceThreshold,
      minFreqHz: this.o.minFreqHz,
      maxFreqHz: this.o.maxFreqHz,
      quorum: this.o.voicedQuorum,
    });

    const grid = this.pitchGrid(track, voiced);
    if (!grid) return [];

    const evidence = this.boundaryEvidence(track, voiced, energy);
    const accent = this.accentCurve(track, energy);
    const { pitches, attack, reonset } = this.viterbi(
      track, voiced, grid, frames, evidence, accent,
    );
    const minFrames = Math.max(1, Math.round(this.o.minNoteSec / track.hopSec));
    // Joint duration × velocity filters (WaoN): both are anchored to the clip's
    // own median voiced energy, so "quiet" adapts to the take's level.
    const energyRef =
      this.o.keepShortLoudRatio !== undefined || this.o.dropLongQuiet
        ? medianVoicedEnergy(voiced, frames, energy)
        : null;
    const keepShortLoud =
      this.o.keepShortLoudRatio !== undefined && energyRef !== null && energy
        ? (run: Run): boolean =>
            peakOver(energy, run) >= this.o.keepShortLoudRatio! * energyRef
        : undefined;
    const longQuiet =
      this.o.dropLongQuiet && energyRef !== null && energy
        ? {
            minFrames: Math.max(
              1,
              Math.round((this.o.dropLongQuiet.minSec ?? 0.35) / track.hopSec),
            ),
            floor: (this.o.dropLongQuiet.quietRatio ?? 0.3) * energyRef,
          }
        : null;
    const runs = this.absorbShortRuns(
      this.runsOf(pitches, frames, reonset),
      minFrames,
      keepShortLoud,
    );

    const notes: NoteEventTime[] = [];
    for (const run of runs) {
      if (run.state < 0) continue;
      if (
        longQuiet &&
        energy &&
        run.end - run.start >= longQuiet.minFrames &&
        meanOver(energy, run) < longQuiet.floor
      ) {
        continue;
      }
      let cents = this.noteCents(track, voiced, run);
      if (cents === null) continue;
      const startFrame = this.onsetFrameOf(run, attack, track, cents);
      const start = startFrame * track.hopSec + this.o.onsetShiftSec;
      const end = run.end * track.hopSec;
      if (this.o.pitchWindow === 'onset') {
        // Re-measure over the ARRIVED part of the note — from the reported onset,
        // which includes the constant attack-lead correction, so the glide is
        // excluded rather than merely trimmed. (The first estimate above is still
        // needed: `onsetAt: 'arrival'` locates the onset by comparing the contour
        // against the note's own pitch, so it must exist first.)
        const from = Math.min(run.end - 1, Math.round(start / track.hopSec));
        if (from > run.start) {
          cents = this.noteCents(track, voiced, { ...run, start: from }) ?? cents;
        }
      }
      if (end - start < track.hopSec) continue;
      notes.push({
        startTimeSeconds: start,
        durationSeconds: end - start,
        pitchMidi: Math.round(cents / 100),
        // The unrounded pitch rides along for the NOTATION layer: a take sung
        // consistently between keys is renamed there on its own grid
        // (voice-notation.ts). Rounding here stays absolute — the eval's truth
        // is absolute — and extractor steps spread-copy, so the field survives.
        pitchMidiFloat: cents / 100,
        amplitude: this.peakConfidence(track, run),
      } as NoteEventTime);
    }
    return this.applyMergeGuard(notes, track, voiced);
  }

  /**
   * Run only the SiPTH merge guard, over notes produced by some other segmenter.
   *
   * Exists so the guard can be attributed independently of the decode it usually
   * rides on: bolted onto the shipping semitone-run segmenter it answers "does the
   * guard fix fragment chains?", which is a different question from "does the note
   * HMM fix them?" and has to be measurable apart.
   */
  guardOnly(notes: NoteEventTime[], track: PitchTrack): NoteEventTime[] {
    return this.applyMergeGuard(
      notes,
      track,
      track.voicedMask({
        confidenceThreshold: this.o.confidenceThreshold,
        minFreqHz: this.o.minFreqHz,
        maxFreqHz: this.o.maxFreqHz,
        quorum: this.o.voicedQuorum,
      }),
    );
  }

  /**
   * Sub-semitone state grid spanning the voiced frames' own range with a semitone
   * of padding, so a note sung consistently 40 cents flat has a state that fits it.
   */
  private pitchGrid(
    track: PitchTrack,
    voiced: Uint8Array,
  ): { centres: Float32Array; step: number } | null {
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < track.frames; i += 1) {
      if (!voiced[i]) continue;
      const c = track.cents[i];
      if (c < lo) lo = c;
      if (c > hi) hi = c;
    }
    if (!Number.isFinite(lo)) return null;
    const step = 100 / this.o.stepsPerSemitone;
    const start = Math.floor((lo - 100) / step) * step;
    const end = Math.ceil((hi + 100) / step) * step;
    const n = Math.round((end - start) / step) + 1;
    const centres = new Float32Array(n);
    for (let i = 0; i < n; i += 1) centres[i] = start + i * step;
    return { centres, step };
  }

  /**
   * Per-frame boundary-evidence multiplier in [`evidenceDiscount`, 1]: 1 where
   * nothing suggests a boundary, `evidenceDiscount` where either channel fires.
   *
   * Channel A — **local volume decay** (Kroher & Gómez r_LOC): this frame's energy
   * against the peak of a ±`evidenceContextSec` context, in dB. A real
   * re-articulation ducks; vibrato tremolo does not duck this far.
   *
   * Channel B — **pitch dip** (their z-score channel, and the one genuinely new to
   * this pipeline): the cent contour's deviation from its own local mean, in local
   * standard deviations. Singers dip in pitch at a re-attack even when the envelope
   * barely moves, which is the "la-la-la on one note" case amplitude cannot see.
   *
   * Fused with a min (either channel is sufficient), which is Kroher's own rule:
   * at a given onset either one or both may be present.
   */
  private boundaryEvidence(
    track: PitchTrack,
    voiced: Uint8Array,
    energy: Float32Array | undefined,
  ): Float32Array | null {
    const frames = track.frames;
    if (this.o.evidenceDiscount >= 1) return null;
    const w = Math.max(1, Math.round(this.o.evidenceContextSec / track.hopSec));
    const out = new Float32Array(frames).fill(1);
    const discount = this.o.evidenceDiscount;

    if (energy && energy.length >= frames) {
      const threshold = Math.pow(10, this.o.energyDipDb / 20);
      for (let i = 0; i < frames; i += 1) {
        let peak = 0;
        const lo = Math.max(0, i - w);
        const hi = Math.min(frames - 1, i + w);
        for (let j = lo; j <= hi; j += 1) if (energy[j] > peak) peak = energy[j];
        if (peak > 0 && energy[i] < threshold * peak) out[i] = discount;
      }
    }

    // Pitch dip: z of the contour against its own local statistics. Unvoiced
    // frames are skipped rather than counted as a dip — an unvoiced frame is a
    // gap, which the silence state already models.
    for (let i = 0; i < frames; i += 1) {
      if (out[i] === discount || !voiced[i]) continue;
      const lo = Math.max(0, i - w);
      const hi = Math.min(frames - 1, i + w);
      let sum = 0;
      let sumSq = 0;
      let n = 0;
      for (let j = lo; j <= hi; j += 1) {
        if (!voiced[j]) continue;
        sum += track.cents[j];
        sumSq += track.cents[j] * track.cents[j];
        n += 1;
      }
      if (n < 5) continue;
      const mu = sum / n;
      const varr = Math.max(0, sumSq / n - mu * mu);
      const sd = Math.sqrt(varr);
      // A flat contour has no meaningful z; 10 cents is well below any real dip.
      if (sd < 10) continue;
      if ((track.cents[i] - mu) / sd <= this.o.pitchDipZ) out[i] = discount;
    }
    return out;
  }

  /**
   * Per-frame accent in [0, 1]: how sharply the envelope is rising, as a fraction
   * of `accentRiseDb` measured over `accentLagSec`.
   *
   * Half-wave rectified on purpose — a *fall* in energy is the offset of the
   * previous note, already modelled by the silence state, and crediting it would
   * put onsets at note ends.
   */
  private accentCurve(
    track: PitchTrack,
    energy: Float32Array | undefined,
  ): Float32Array | null {
    if (this.o.accentBonus <= 0 || !energy || energy.length < track.frames) {
      return null;
    }
    const lag = Math.max(1, Math.round(this.o.accentLagSec / track.hopSec));
    const out = new Float32Array(track.frames);
    const eps = 1e-9;
    for (let t = lag; t < track.frames; t += 1) {
      const riseDb = 20 * Math.log10((energy[t] + eps) / (energy[t - lag] + eps));
      out[t] = Math.min(1, Math.max(0, riseDb / this.o.accentRiseDb));
    }
    return out;
  }

  /**
   * Viterbi over {silence} ∪ {attack(p), stable(p)}. Transitions are structured
   * rather than a full matrix, and the only non-local one — entering a note from a
   * *different* pitch — is resolved with prefix/suffix minima over the stable
   * states, so each frame costs O(states) rather than O(states²).
   *
   * Under `transitionMode: 'via-silence'` that non-local transition is removed
   * outright: the only way into a note is through silence. The state space then has
   * exactly the shape Dynamic HumTrans decodes with, and an articulated take's
   * inter-note gap becomes a structural requirement rather than a cost to weigh.
   */
  private viterbi(
    track: PitchTrack,
    voiced: Uint8Array,
    grid: { centres: Float32Array; step: number },
    frames: number,
    evidence: Float32Array | null,
    accent: Float32Array | null,
  ): { pitches: Int32Array; attack: Uint8Array; reonset: Uint8Array } {
    const { centres, step } = grid;
    const n = centres.length;
    // Layout: 0 = silence, 1..n = attack(p), n+1..2n = stable(p).
    const numStates = 2 * n + 1;
    const ATTACK = 1;
    const STABLE = n + 1;
    const guard = Math.max(1, Math.round((this.o.minChangeSemitones * 100) / step));
    const wideGuard = Math.max(
      guard + 1,
      Math.round((this.o.wideIntervalSemitones * 100) / step),
    );
    const wideChange = this.o.wideChangeCost;
    const viaSilence = this.o.transitionMode === 'via-silence';
    // E4/R10(a): interval-proportional change pricing (see `intervalChange`).
    const ic = this.o.intervalChange;
    const icCapSteps = ic
      ? Math.max(1, Math.round(((ic.capSemitones ?? 13) * 100) / step))
      : 0;
    const icTwoSigSq = ic ? 2 * (ic.sigmaSemitones ?? 0.7) ** 2 : 1;
    const icPerOct = ic ? ic.perOctaveNats ?? 5 : 0;
    // E4/R10(b): the pitch the current best path into silence left, and how
    // long ago — Praat's greedy path-lookback (see `silenceMemory`). Read when
    // an attack is entered from silence; updated at the end of each frame.
    const sm = this.o.silenceMemory;
    const smPerOct = sm ? sm.perOctaveNats ?? 3 : 0;
    let silenceFromPitch = -1;
    let silenceGapFrames = 0;
    // E7/R6: consecutive unvoiced frames ending just before t — once past the
    // release point, the note-change cost is discounted until voicing returns.
    const ucr = this.o.unvoicedChangeRelease;
    const ucrAfterFrames = ucr
      ? Math.max(1, Math.round((ucr.afterSec ?? 0.06) / track.hopSec))
      : 0;
    const ucrDiscount = ucr ? ucr.discount ?? 0.2 : 1;
    let unvoicedRun = 0;

    const cost = new Float32Array(numStates);
    const next = new Float32Array(numStates);
    const back = new Int32Array(frames * numStates);
    const prefix = new Float32Array(n);
    const prefixAt = new Int32Array(n);
    const suffix = new Float32Array(n);
    const suffixAt = new Int32Array(n);

    const twoSigAttackSq = 2 * this.o.sigmaAttackSemitones ** 2;
    const twoSigStableSq = 2 * this.o.sigmaStableSemitones ** 2;
    // Per-10 ms dwell cost rescaled to this track's hop (Praat's convention).
    const attackFrameCost = this.o.attackFrameCost * (track.hopSec / 0.01);

    // Octave prior: nats charged for entering a note this far from the session's
    // register centre. Zero when no register is known, which is the old behaviour.
    const octaveCost = new Float32Array(n);
    if (this.o.registerCents !== undefined && this.o.octavePriorWeight > 0) {
      for (let p = 0; p < n; p += 1) {
        const octaves = Math.abs(centres[p] - this.o.registerCents) / 1200;
        octaveCost[p] = this.o.octavePriorWeight * octaves;
      }
    }

    // Multi-candidate emission (E3): per frame, the kept candidates with their
    // relative-weakness cost in nats, octave tie-break already applied.
    const cand = this.candidateTable(track);

    const emit = (t: number, state: number): number => {
      if (state === 0) return voiced[t] ? this.o.voicedSilenceCost : 0;
      const isAttack = state < STABLE;
      if (!voiced[t]) {
        return this.o.unvoicedPitchCost + (isAttack ? attackFrameCost : 0);
      }
      const p = isAttack ? state - ATTACK : state - STABLE;
      let d = (track.cents[t] - centres[p]) / 100;
      let weak = 0;
      if (cand) {
        // pYIN §5.6: a state is scored against its NEAREST candidate, plus that
        // candidate's weakness relative to the frame's strongest.
        const base = t * cand.k;
        let bestAbs = Infinity;
        let bj = -1;
        for (let j = 0; j < cand.k; j += 1) {
          if (cand.strength[base + j] <= 0) break;
          const dd = Math.abs(cand.cents[base + j] - centres[p]);
          if (dd < bestAbs) {
            bestAbs = dd;
            bj = j;
          }
        }
        if (bj >= 0) {
          d = bestAbs / 100;
          weak = cand.weakness[base + bj];
        }
      }
      const twoSigSq = isAttack ? twoSigAttackSq : twoSigStableSq;
      const dwell = isAttack ? attackFrameCost : 0;
      return (this.o.trust * (d * d)) / twoSigSq + weak + dwell;
    };

    for (let s = 0; s < numStates; s += 1) cost[s] = emit(0, s);

    for (let t = 1; t < frames; t += 1) {
      let running = Infinity;
      let runningAt = -1;
      for (let p = 0; p < n; p += 1) {
        prefix[p] = running;
        prefixAt[p] = runningAt;
        const c = cost[STABLE + p];
        if (c < running) {
          running = c;
          runningAt = p;
        }
      }
      running = Infinity;
      runningAt = -1;
      for (let p = n - 1; p >= 0; p -= 1) {
        suffix[p] = running;
        suffixAt[p] = runningAt;
        const c = cost[STABLE + p];
        if (c < running) {
          running = c;
          runningAt = p;
        }
      }

      // Boundary evidence makes both kinds of boundary cheaper at this frame: a
      // note change (direct mode) and a note start out of silence (both modes) —
      // the latter is what carries the mechanism in via-silence mode.
      const ev = evidence ? evidence[t] : 1;
      const released = ucr !== undefined && unvoicedRun >= ucrAfterFrames;
      const change = this.o.changeCost * ev * (released ? ucrDiscount : 1);
      const on = this.o.onCost * ev;
      const silencePrev = cost[0];
      let bestStable = Infinity;
      let bestStableAt = -1;
      for (let p = 0; p < n; p += 1) {
        if (cost[STABLE + p] < bestStable) {
          bestStable = cost[STABLE + p];
          bestStableAt = p;
        }
      }

      // Silence: stay silent, or end a note.
      {
        let best = silencePrev;
        let from = 0;
        if (bestStableAt >= 0 && bestStable + this.o.offCost < best) {
          best = bestStable + this.o.offCost;
          from = STABLE + bestStableAt;
        }
        next[0] = best + emit(t, 0);
        back[t * numStates] = from;
      }

      for (let p = 0; p < n; p += 1) {
        // attack(p): keep attacking, start from silence, or (direct mode) change note.
        {
          let best = cost[ATTACK + p];
          let from = ATTACK + p;
          let fromSilence = silencePrev + on + octaveCost[p];
          if (sm && silenceFromPitch >= 0) {
            // A jump across a rest is not free (Praat §6.4): charge for the
            // interval from the pitch the silence run left, amortised by the
            // gap's length when configured.
            const octaves = (Math.abs(p - silenceFromPitch) * step) / 1200;
            fromSilence +=
              (smPerOct * octaves) /
              (sm.amortize ? Math.max(1, silenceGapFrames) : 1);
          }
          if (fromSilence < best) {
            best = fromSilence;
            from = 0;
          }
          // Re-articulation of the SAME pitch: the only boundary a pitch-only
          // model cannot represent, and the one the energy/pitch-dip channels
          // exist to find. Priced by `reonsetCost` and paid at the discounted
          // rate only where a channel fires.
          if (Number.isFinite(this.o.reonsetCost)) {
            // Priced by the dip channels and PAID FOR by the accent: a re-onset
            // is worth taking exactly where the envelope jumps. The credit is
            // allowed to drive the transition below zero, because it has to also
            // cover the attack phase's own dwell cost — otherwise the boundary is
            // never affordable however cheaply the transition itself is priced.
            const reonset =
              cost[STABLE + p] +
              this.o.reonsetCost * ev -
              (accent ? this.o.accentBonus * accent[t] : 0);
            if (reonset < best) {
              best = reonset;
              from = STABLE + p;
            }
          }
          if (!viaSilence) {
            // prefix[i] holds the cheapest stable state at index < i, so the
            // cheapest at p' ≤ p−guard is prefix[p−guard+1]; suffix[i] the
            // cheapest at index > i, so the cheapest at p' ≥ p+guard is
            // suffix[p+guard−1]. Clamped rather than skipped so a note at the edge
            // of the register can still be entered.
            const tryFrom = (lookup: number, side: 'left' | 'right', cost: number): void => {
              const at =
                side === 'left'
                  ? (lookup >= 1 ? prefixAt[Math.min(lookup, n - 1)] : -1)
                  : (lookup <= n - 2 ? suffixAt[Math.max(lookup, 0)] : -1);
              const c =
                side === 'left'
                  ? (lookup >= 1 ? prefix[Math.min(lookup, n - 1)] : Infinity)
                  : (lookup <= n - 2 ? suffix[Math.max(lookup, 0)] : Infinity);
              if (at >= 0 && Number.isFinite(c) && c + cost < best) {
                best = c + cost;
                from = STABLE + at;
              }
            };
            if (ic) {
              // E4/R10(a): interval-proportional pricing — a capped scan over
              // the reachable stable states (pYIN's maxJump is what bounds it).
              const lo = Math.max(0, p - icCapSteps);
              const hi = Math.min(n - 1, p + icCapSteps);
              for (let q = lo; q <= hi; q += 1) {
                const dq = Math.abs(q - p);
                if (dq < guard) continue;
                const dSemis = (dq * step) / 100;
                const shape =
                  ic.form === 'linear'
                    ? icPerOct * (dSemis / 12)
                    : (dSemis * dSemis) / icTwoSigSq;
                const c = cost[STABLE + q] + change + shape;
                if (c < best) {
                  best = c;
                  from = STABLE + q;
                }
              }
            } else {
              tryFrom(p - guard + 1, 'left', change);
              tryFrom(p + guard - 1, 'right', change);
              if (wideChange !== undefined) {
                const wide = wideChange * ev;
                tryFrom(p - wideGuard + 1, 'left', wide);
                tryFrom(p + wideGuard - 1, 'right', wide);
              }
            }
          }
          next[ATTACK + p] = best + emit(t, ATTACK + p);
          back[t * numStates + ATTACK + p] = from;
        }
        // stable(p): continue, or settle out of this pitch's own attack.
        {
          let best = cost[STABLE + p];
          let from = STABLE + p;
          const fromAttack = cost[ATTACK + p] + this.o.attackCost;
          if (fromAttack < best) {
            best = fromAttack;
            from = ATTACK + p;
          }
          next[STABLE + p] = best + emit(t, STABLE + p);
          back[t * numStates + STABLE + p] = from;
        }
      }
      if (ucr) unvoicedRun = voiced[t] ? 0 : unvoicedRun + 1;
      // Advance the silence path memory AFTER every use at this frame: the
      // from-silence jumps above priced against the path as of t−1.
      if (sm) {
        const from0 = back[t * numStates];
        if (from0 === 0) {
          silenceGapFrames += 1;
        } else {
          silenceFromPitch = from0 - STABLE;
          silenceGapFrames = 1;
        }
      }
      cost.set(next);
    }

    let endState = 0;
    let endCost = Infinity;
    for (let s = 0; s < numStates; s += 1) {
      if (cost[s] < endCost) {
        endCost = cost[s];
        endState = s;
      }
    }
    const path = new Int32Array(frames);
    path[frames - 1] = endState;
    for (let t = frames - 1; t > 0; t -= 1) {
      path[t - 1] = back[t * numStates + path[t]];
    }
    // Collapse attack/stable into the pitch index they share — the phase mattered
    // only for tolerating deviation — but keep it alongside, because where the
    // attack ends is where the note is heard to begin (see `onsetAt`).
    const pitches = new Int32Array(frames);
    const attack = new Uint8Array(frames);
    const reonset = new Uint8Array(frames);
    for (let t = 0; t < frames; t += 1) {
      const s = path[t];
      pitches[t] = s === 0 ? -1 : s < STABLE ? s - ATTACK : s - STABLE;
      attack[t] = s !== 0 && s < STABLE ? 1 : 0;
      // A re-articulation leaves the pitch index unchanged, so it would vanish
      // when attack/stable collapse — mark it here or the run splitter never
      // sees the boundary the decode just paid for.
      if (t > 0 && attack[t] && !attack[t - 1] && pitches[t] === pitches[t - 1]) {
        reonset[t] = 1;
      }
    }
    return { pitches, attack, reonset };
  }

  /**
   * The per-frame candidate table the multi-candidate emission reads (E3; see
   * `candidates`). Slots are strongest-first; `strength` 0 ends a frame's list.
   * `weakness` is `yinTrust · −ln(strength / frame's strongest)` — 0 for the
   * strongest candidate, growing for weaker ones. The octave tie-break drops
   * the LOWER of two candidates within ±50 ¢ of an octave apart unless it is
   * clearly stronger (strength ≥ `octaveBias` × the higher's).
   */
  private candidateTable(
    track: PitchTrack,
  ): { k: number; cents: Float32Array; strength: Float32Array; weakness: Float32Array } | null {
    const o = this.o.candidates;
    if (!o || !track.candCents || !track.candStrength || track.candK <= 0) return null;
    const k = Math.max(1, Math.min(o.k ?? 3, track.candK));
    const yinTrust = o.yinTrust ?? 1;
    const frames = track.frames;
    const cents = new Float32Array(frames * k);
    const strength = new Float32Array(frames * k);
    const weakness = new Float32Array(frames * k);
    for (let t = 0; t < frames; t += 1) {
      const srcBase = t * track.candK;
      const list: { c: number; s: number }[] = [];
      for (let j = 0; j < track.candK; j += 1) {
        const s = track.candStrength[srcBase + j];
        if (s <= 0) break;
        list.push({ c: track.candCents[srcBase + j], s });
      }
      let kept = list;
      if (o.octaveBias !== undefined && list.length > 1) {
        const drop = new Set<number>();
        for (let a = 0; a < list.length; a += 1) {
          for (let b = 0; b < list.length; b += 1) {
            if (a === b || drop.has(a)) continue;
            // `a` sits ~an octave ABOVE `b`: keep `b` only if clearly stronger.
            if (
              Math.abs(list[a].c - list[b].c - 1200) <= 50 &&
              list[b].s < (o.octaveBias ?? 1) * list[a].s
            ) {
              drop.add(b);
            }
          }
        }
        kept = list.filter((_, i) => !drop.has(i));
      }
      kept = kept.slice(0, k);
      const maxS = kept.length ? kept[0].s : 0;
      for (let j = 0; j < kept.length; j += 1) {
        cents[t * k + j] = kept[j].c;
        strength[t * k + j] = kept[j].s;
        weakness[t * k + j] =
          yinTrust * -Math.log(Math.max(1e-6, kept[j].s / maxS));
      }
    }
    return { k, cents, strength, weakness };
  }

  /**
   * The frame a run's note is reported to start on — see `onsetAt`. The attack
   * ends at the first frame the decode spends in a stable state; a run with no
   * stable frame at all (a very short note) reports its own start.
   */
  private onsetFrameOf(
    run: Run,
    attack: Uint8Array,
    track: PitchTrack,
    centsOfNote: number,
  ): number {
    if (this.o.onsetAt === 'attack') return run.start;
    if (this.o.onsetAt === 'arrival') {
      for (let i = run.start; i < run.end; i += 1) {
        if (Math.abs(track.cents[i] - centsOfNote) <= this.o.arrivalCents) return i;
      }
      return run.start;
    }
    let settled = run.start;
    while (settled < run.end && attack[settled]) settled += 1;
    if (settled >= run.end) return run.start;
    return this.o.onsetAt === 'mid'
      ? Math.floor((run.start + settled) / 2)
      : settled;
  }

  /**
   * Maximal runs of equal pitch-state index (-1 = silence), additionally broken
   * wherever the decode paid for a re-articulation of the same pitch.
   */
  private runsOf(pitches: Int32Array, frames: number, reonset: Uint8Array): Run[] {
    const runs: Run[] = [];
    let start = 0;
    for (let t = 1; t <= frames; t += 1) {
      if (t === frames || pitches[t] !== pitches[start] || reonset[t]) {
        runs.push({ start, end: t, state: pitches[start], reonset: !!reonset[start] });
        start = t;
      }
    }
    return runs;
  }

  /**
   * Remove runs shorter than `minNoteSec` (given here as `minFrames` on the
   * track's own grid) without punching holes: a short pitch run between two pitch
   * runs is absorbed into whichever neighbour is closer in pitch (the longer on a
   * tie); one adjacent to silence is dropped as noise. Repeats, because absorbing
   * can leave a neighbour newly adjacent to another short run.
   */
  private absorbShortRuns(
    runs: Run[],
    minFrames: number,
    keepShortLoud?: (run: Run) => boolean,
  ): Run[] {
    let work = runs;
    for (let guard = 0; guard < 256; guard += 1) {
      let idx = -1;
      let shortest = Infinity;
      for (let i = 0; i < work.length; i += 1) {
        const r = work[i];
        if (r.state < 0) continue;
        const len = r.end - r.start;
        if (len < minFrames && len < shortest) {
          // WaoN's joint rule: a short run that is LOUD is a real staccato
          // note, not a glitch — exempt it from absorption.
          if (keepShortLoud?.(r)) continue;
          shortest = len;
          idx = i;
        }
      }
      if (idx < 0) break;

      const prev = work[idx - 1];
      const cur = work[idx];
      const nxt = work[idx + 1];
      const prevOk = prev !== undefined && prev.state >= 0;
      const nextOk = nxt !== undefined && nxt.state >= 0;

      if (!prevOk && !nextOk) {
        cur.state = -1;
        work = this.coalesce(work);
        continue;
      }
      let target: Run;
      if (prevOk && nextOk) {
        const dPrev = Math.abs(prev.state - cur.state);
        const dNext = Math.abs(nxt.state - cur.state);
        if (dPrev < dNext) target = prev;
        else if (dNext < dPrev) target = nxt;
        else target = prev.end - prev.start >= nxt.end - nxt.start ? prev : nxt;
      } else {
        target = prevOk ? prev : nxt;
      }
      cur.state = target.state;
      work = this.coalesce(work);
    }
    return work;
  }

  /**
   * Merge temporally adjacent runs that ended up on the same state — except across
   * a re-articulation, which is a real boundary the decode paid for even though the
   * pitch index is unchanged either side of it. Without that exception one short
   * run anywhere in the take would rejoin every same-pitch pair in it.
   */
  private coalesce(runs: Run[]): Run[] {
    const out: Run[] = [];
    for (const r of runs) {
      const last = out[out.length - 1];
      if (last && last.state === r.state && last.end === r.start && !r.reonset) {
        last.end = r.end;
        continue;
      }
      out.push({ ...r });
    }
    return out;
  }

  /**
   * A note's pitch in cents: the **α-trimmed mean** of its voiced contour frames
   * (Molina et al.'s companion trick to SiPTH, α = 0.3). Trimming both tails drops
   * the scoop into the note and the release out of it — the two most expressive and
   * least representative parts of a sung note — where a plain mean would average
   * them in and a plain median would ignore the shape of what remains.
   */
  private noteCents(
    track: PitchTrack,
    voiced: Uint8Array,
    run: Run,
  ): number | null {
    // Collected in TIME order; `hannWeightedMedian` needs the position of each
    // frame within the note, so this must not be pre-sorted.
    const vals: number[] = [];
    for (let i = run.start; i < run.end; i += 1) {
      if (voiced[i]) vals.push(track.cents[i]);
    }
    if (!vals.length) return null;
    if (this.o.pitchEstimator === 'hann-median') return hannWeightedMedian(vals);
    if (this.o.pitchEstimator === 'slew-limit') {
      return medianOf(slewSmooth(vals, track.hopSec, this.o.slewTimeSec));
    }
    if (this.o.pitchEstimator === 'one-pole') {
      return medianOf(onePoleSmooth(vals, track.hopSec, this.o.onePoleTauSec));
    }
    if (this.o.pitchEstimator === 'detrend') return detrendCentre(vals);
    if (this.o.pitchEstimator === 'slope-gated') {
      return slopeGatedEstimate(vals, track.hopSec, this.o.pitchTrim);
    }
    return trimmedMean(vals, this.o.pitchTrim);
  }

  /**
   * SiPTH's sustained-deviation guard (Molina et al., TASLP 2015), applied as a
   * post-pass over adjacent near-semitone pairs.
   *
   * The rule: a pitch-motivated split is only justified when the contour's
   * deviation from the note's running mean exceeds `deltaSemitones` **and**
   * accumulates at least `gammaSemitoneSec` of area (deviation × time) — roughly a
   * full semitone held for 200 ms. Vibrato swings symmetrically about the mean, so
   * its area integrates toward zero however wide the swing; a genuine step holds
   * one side and accumulates. That distinction is what no threshold on deviation
   * alone can make, and it is precisely our fragment-chain failure.
   *
   * Applied only to neighbours within `maxIntervalSemitones` — a real melodic
   * interval is never a candidate — and never across a silent gap, since a gap is
   * independent evidence that the two are separate notes.
   */
  private applyMergeGuard(
    notes: NoteEventTime[],
    track: PitchTrack,
    voiced: Uint8Array,
  ): NoteEventTime[] {
    const g = this.o.mergeGuard;
    if (!g || notes.length < 2) return notes;
    const delta = g.deltaSemitones ?? 0.5;
    const gamma = g.gammaSemitoneSec ?? 0.1;
    const maxInterval = g.maxIntervalSemitones ?? 1;

    const out: NoteEventTime[] = [{ ...notes[0] }];
    for (let i = 1; i < notes.length; i += 1) {
      const prev = out[out.length - 1];
      const cur = notes[i];
      const prevEnd = prev.startTimeSeconds + prev.durationSeconds;
      const contiguous = cur.startTimeSeconds - prevEnd < track.hopSec * 1.5;
      const interval = Math.abs(cur.pitchMidi - prev.pitchMidi);
      if (!contiguous || interval === 0 || interval > maxInterval) {
        out.push({ ...cur });
        continue;
      }
      if (this.splitIsJustified(track, voiced, prev, cur, delta, gamma)) {
        out.push({ ...cur });
        continue;
      }
      // Rejoin: the pair is one note whose contour merely wandered. Frame indices
      // are derived with the onset lead removed — `startTimeSeconds` carries the
      // calibration constant, and reading the contour at the shifted position
      // would sample the wrong frames.
      const mergedEnd = cur.startTimeSeconds + cur.durationSeconds;
      prev.durationSeconds = mergedEnd - prev.startTimeSeconds;
      prev.amplitude = Math.max(prev.amplitude, cur.amplitude);
      const merged = this.noteCents(track, voiced, {
        start: Math.max(
          0,
          Math.round((prev.startTimeSeconds - this.o.onsetShiftSec) / track.hopSec),
        ),
        end: Math.min(track.frames, Math.round(mergedEnd / track.hopSec)),
        state: 0,
      });
      if (merged !== null) {
        prev.pitchMidi = Math.round(merged / 100);
        (prev as NoteEventTime & { pitchMidiFloat?: number }).pitchMidiFloat =
          merged / 100;
      }
    }
    return out;
  }

  /**
   * Does the second note's contour deviate from the pair's running mean by more
   * than δ semitones for long enough to accumulate Γ semitone·seconds? Measured on
   * the *second* note against the *first*'s pitch, which is the deviation a
   * boundary at that instant is claiming to have detected.
   */
  private splitIsJustified(
    track: PitchTrack,
    voiced: Uint8Array,
    prev: NoteEventTime,
    cur: NoteEventTime,
    delta: number,
    gamma: number,
  ): boolean {
    const from = Math.max(
      0,
      Math.round((cur.startTimeSeconds - this.o.onsetShiftSec) / track.hopSec),
    );
    const to = Math.min(
      track.frames,
      Math.round((cur.startTimeSeconds + cur.durationSeconds) / track.hopSec),
    );
    const reference = prev.pitchMidi * 100;
    const sign = Math.sign(cur.pitchMidi - prev.pitchMidi);
    let area = 0;
    for (let i = from; i < to; i += 1) {
      if (!voiced[i]) continue;
      // Signed toward the claimed interval: a contour that swings BOTH ways
      // (vibrato) cancels, while one that holds the new pitch accumulates.
      const dev = (sign * (track.cents[i] - reference)) / 100;
      if (Math.abs(dev) < delta) continue;
      area += dev * track.hopSec;
    }
    return area >= gamma;
  }

  private peakConfidence(track: PitchTrack, run: Run): number {
    let peak = 0;
    for (let i = run.start; i < run.end; i += 1) {
      if (track.confidence[i] > peak) peak = track.confidence[i];
    }
    return peak;
  }
}

/**
 * Weighted median of a note's contour under a Hann window over its own span
 * (Yong, Su & Nam, ICASSP 2023). `vals` must be in time order.
 *
 * A median rather than a mean because vibrato is symmetric but scoops are not, and
 * Hann-weighted rather than trimmed because a fade degrades gracefully on a short
 * note where a hard 30 % cut per side would leave almost nothing.
 */
function hannWeightedMedian(vals: number[]): number {
  const n = vals.length;
  if (n === 1) return vals[0];
  const weighted = vals.map((v, i) => ({
    v,
    // Hann over the span, floored so the extreme frames still count for something
    // rather than being deleted — that is the difference from trimming.
    w: 0.08 + 0.92 * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1))),
  }));
  weighted.sort((a, b) => a.v - b.v);
  const total = weighted.reduce((s, x) => s + x.w, 0);
  let acc = 0;
  for (const x of weighted) {
    acc += x.w;
    if (acc >= total / 2) return x.v;
  }
  return weighted[weighted.length - 1].v;
}

function medianOf(vals: number[]): number {
  const s = [...vals].sort((a, b) => a - b);
  return s[s.length >> 1];
}

/** α-trimmed mean (Molina et al.) — sorts a copy; `vals` keeps its time order. */
function trimmedMean(vals: number[], trim: number): number {
  const s = [...vals].sort((a, b) => a - b);
  const cut = Math.floor(s.length * trim);
  const kept = s.length - 2 * cut >= 1 ? s.slice(cut, s.length - cut) : s;
  return kept.reduce((a, b) => a + b, 0) / kept.length;
}

/**
 * R24: OpenTune's angle-band-gated slope rotation (§20.5). Slope from the
 * medians of the first/last max(3, n/5) frames; angle normalised at 7 st/s.
 * Inside 10°–30° the contour is rotated flat around its centre before the
 * trimmed mean; outside the band (flat notes below, deliberate glides above)
 * the plain trimmed mean stands.
 */
function slopeGatedEstimate(vals: number[], hopSec: number, trim: number): number {
  const n = vals.length;
  if (n < 6) return trimmedMean(vals, trim);
  const k = Math.max(3, Math.floor(n / 5));
  const medFirst = medianOf(vals.slice(0, k));
  const medLast = medianOf(vals.slice(n - k));
  const sepFrames = Math.max(1, n - k);
  const slopeStPerSec = (medLast - medFirst) / 100 / (sepFrames * hopSec);
  const angleDeg = Math.abs((Math.atan(slopeStPerSec / 7) * 180) / Math.PI);
  if (angleDeg < 10 || angleDeg > 30) return trimmedMean(vals, trim);
  const slopeCentsPerFrame = (medLast - medFirst) / sepFrames;
  const centre = (n - 1) / 2;
  return trimmedMean(
    vals.map((v, i) => v - slopeCentsPerFrame * (i - centre)),
    trim,
  );
}

/**
 * TalentedHack's slew-rate limiter with momentum (`SmoothPitch`,
 * pitch_smoother.c), run causally over a note's contour. Differences ≤ 4 cents
 * bypass smoothing entirely; otherwise the step closes the remaining distance
 * over `slewTimeSec`, with a three-way momentum rule — accelerate while the
 * fresh step is larger, SNAP to the target when the momentum already exceeds
 * the remaining distance (this is what makes it arrive instead of creeping),
 * otherwise coast.
 */
function slewSmooth(vals: number[], hopSec: number, slewTimeSec: number): number[] {
  const out = new Array<number>(vals.length);
  let s = vals[0];
  let momentum = 0;
  out[0] = s;
  const stepsToClose = Math.max(1, slewTimeSec / hopSec);
  for (let i = 1; i < vals.length; i += 1) {
    const diff = vals[i] - s;
    if (Math.abs(diff) <= 4) {
      s = vals[i];
      momentum = 0;
    } else {
      const toadd = diff / stepsToClose;
      if (Math.abs(momentum) < Math.abs(toadd)) momentum = toadd;
      if (Math.abs(momentum) > Math.abs(diff)) {
        s = vals[i];
        momentum = 0;
      } else {
        s += momentum;
      }
    }
    out[i] = s;
  }
  return out;
}

/** fat1's within-note one-pole, hard-reset at the note start. */
function onePoleSmooth(vals: number[], hopSec: number, tauSec: number): number[] {
  const alpha = 1 - Math.exp(-hopSec / Math.max(1e-6, tauSec));
  const out = new Array<number>(vals.length);
  let s = vals[0];
  out[0] = s;
  for (let i = 1; i < vals.length; i += 1) {
    s += alpha * (vals[i] - s);
    out[i] = s;
  }
  return out;
}

/**
 * MXTune's per-note linear detrend (§1.3): least-squares line over the contour;
 * the note's pitch is the line's value at the temporal centre plus the median
 * residual, so a monotonic scoop or portamento tail pulls the estimate less
 * than it pulls a median of the raw contour.
 */
function detrendCentre(vals: number[]): number {
  const n = vals.length;
  if (n < 3) return medianOf(vals);
  const xMean = (n - 1) / 2;
  let yMean = 0;
  for (const v of vals) yMean += v;
  yMean /= n;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i += 1) {
    sxy += (i - xMean) * (vals[i] - yMean);
    sxx += (i - xMean) * (i - xMean);
  }
  const slope = sxx > 0 ? sxy / sxx : 0;
  const residuals = vals.map((v, i) => v - (yMean + slope * (i - xMean)));
  return yMean + medianOf(residuals);
}

/**
 * The clip's own loudness anchor for the WaoN filters: median per-frame energy
 * over voiced frames. Null when there is no energy or nothing voiced, which
 * turns both filters off rather than comparing against a meaningless zero.
 */
function medianVoicedEnergy(
  voiced: Uint8Array,
  frames: number,
  energy: Float32Array | undefined,
): number | null {
  if (!energy || energy.length < frames) return null;
  const vals: number[] = [];
  for (let i = 0; i < frames; i += 1) {
    if (voiced[i]) vals.push(energy[i]);
  }
  if (!vals.length) return null;
  vals.sort((a, b) => a - b);
  return vals[vals.length >> 1];
}

function peakOver(energy: Float32Array, run: { start: number; end: number }): number {
  let peak = 0;
  const to = Math.min(energy.length, run.end);
  for (let i = run.start; i < to; i += 1) if (energy[i] > peak) peak = energy[i];
  return peak;
}

function meanOver(energy: Float32Array, run: { start: number; end: number }): number {
  const to = Math.min(energy.length, run.end);
  if (to <= run.start) return 0;
  let sum = 0;
  for (let i = run.start; i < to; i += 1) sum += energy[i];
  return sum / (to - run.start);
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(o).filter(([, v]) => v !== undefined),
  ) as Partial<T>;
}
