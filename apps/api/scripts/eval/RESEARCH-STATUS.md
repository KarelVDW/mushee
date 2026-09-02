# Research → implementation status

What the eight research documents in `research/` proposed, and what became of
each proposal in the shipping pipeline (`src/recordings/pipeline/`). Compiled
2026-09-01 from a line-by-line audit of the documents against the source tree
and the findings log (`FINDINGS.md`, which holds every number cited here).
Read this before opening a research document: most of what they recommend has
already been built and measured, and roughly two-thirds of it measured null.

Status vocabulary:

- **SHIPPED** — in production code, on by default.
- **BUILT-OFF** — implemented as an option, measured null or negative, left in
  the code defaulted off with its numbers on the option's doc comment.
- **DISCARDED** — decided against on evidence or policy; no code.
- **NOT PURSUED** — no code, no measurement.
- **SUPERSEDED** — the document's premise no longer holds.

Two standing decisions bound everything below: **no model training or
fine-tuning, ever** (models enter only as permissive pretrained checkpoints or
vendor APIs), and **tempo is never estimated** (the user records to a
metronome at a tempo they chose).

## 1. The shipping pipeline, and which research each part came from

| stage | what ships | origin |
|---|---|---|
| Source routing | Stock-YAMNet class scores decide voice vs instrument from the first ~1 s (98.7 % decided, 11.8 % abstain → score-instrument prior); explicit client declaration wins | research-voice-transcription §7 (the training-free variant it named) |
| Register routing | Noise-hardened harmonic-summation pitch scan → low / mid / high / very-high band → dynamic frequency window + high-pass; instrument hint widens the window | 2026-06 rework; research-pitch-models §1a-bis (ceiling analysis) |
| Reverb adaptation | Voicing gate relaxed in proportion to a blind reverberance estimate (`dipDepth` ramp), +0.024/+0.043 on the reverb tier, clean-neutral | 2026-07 accuracy push (own diagnosis: reverb halves CREPE confidence, barely touches pitch) |
| f0 | CREPE-tiny, Viterbi-decoded, at pitch; **octave-down CREPE** (same checkpoint, audio read at half speed) for the very-high band ≈3.9 kHz | research-pitch-models wanted HarmoF0/SwiftF0 for range; both lost on our corpora, the wrapper collected the prize instead (+0.150 TinySOL very-high, +0.275 whistle-real) |
| Note decode — instruments | Semitone-run segmenter, 4-frame median smoother, amplitude re-attack splitter (`OnsetDetector`), fragment-guarded merge, vibrato A-B-A folder, adaptive length floor | 2026-06/07 own tuning; pYIN/Tony conventions (research-daw-products §13) |
| Note decode — voice | `VoiceNoteDecoder`: pYIN-style note HMM with silence state (reached by pricing, `changeCost 2.5`), attack/stable σ 5/0.9, boundary-evidence discount (volume decay + pitch dip), α-trimmed-mean pitch, **+70 ms onset calibration**. +0.123 held-out, +0.129 on three corpora adopted afterwards | research-voice-transcription §4/§10 (Dynamic HumTrans silence state, Kroher & Gómez channels, Molina pitch); the calibration constant was the doc's biggest omission and the single largest effect |
| Cleanup / quantisation | 16th-grid onset snap with coarseness penalty, seam-fill (0.3 beat; 0.6 for voice), metrical duration speller (dotted-vs-tie, boundary splits, no barline crossing) | research-rhythm §2.1/§2.4/§6.4 |
| Spelling | Per-take circular-mean tuning offset + key-signature vote + ≥35 ¢ ambiguity-band snap, voice takes only; grid-phase estimate (voice only) | research-voice-transcription §5, research-daw-products §18.12; Dressler & Streich |
| Streaming | Streaming ffmpeg decode, CREPE session cache, 0.4 s commit margin, profile locked from the first pitched ≥1.2 s (deferred while unvoiced, up to 8 s; re-resolved on the final pass — 2026-09-01) | 2026-06 O(n²) fix; E5/R12 measured the margin |

## 2. Per document

### research-pitch-models.md — frame-level f0 and note models

| proposal | status | evidence |
|---|---|---|
| Replace CREPE-tiny with SwiftF0 / HarmoF0 / RMVPE for range and robustness | **DISCARDED** (measured) | `bench-pitch-models.ts` + `bench_pitch_models.py`: SwiftF0 ties overall, −0.17 mid band, worse under degradation; HarmoF0 sub-octave from ~1.2 kHz; RMVPE barred (NC weights). SwiftF0 remains a *cost* option (5.6× cheaper CPU) |
| Cover the very-high band with a wider-range model | **SHIPPED another way** | `crepe-pitchdown-provider.ts` — no new model, +0.150*/+0.275* on real audio |
| Octave errors are the dominant failure; add octave priors / repair | **SUPERSEDED** — false for this pipeline | octErr 0.001 on voice, 0.00 on ~2,800 whistled notes and every TinySOL stratum (48 band bins < 60 bins/octave; documented at `crepe-provider.ts`). E2 octave prior BUILT-OFF |
| Dynamic HumTrans silence-state decode | **SHIPPED** | `voice-note-decoder.ts` — the largest win in the repo |
| Melodia-style outlier rejection; low-false-alarm voicing gate | **BUILT-OFF** | `filterPitchOutliers` off (+0.024 to remove); gate at 0.5 measured optimal |
| ROSVOT-style 85 ms boundary resolution | **DISCARDED** (opposite measured) | re-onset recall 0.218 on a 20 ms grid vs 0.329 on 10 ms |
| `VITERBI_SIGMA_BINS` comment bug | **FIXED** | `crepe-provider.ts` |
| Ensemble / median voting across estimators | **NOT PURSUED** | SwiftF0 ONNX already vendored in `.venv-pitchbench`; E5 says voicing is already optimal — low expected value |
| Reimplement + train Dynamic HumTrans / retrain ROSVOT, RMVPE, SwiftF0 | **DISCARDED** (policy) | never-train rule |
| Pretrained learned note model (VocalParse Apache-2.0; Yong-2023 MIT) | see §3, item A | |

### research-benchmarks.md — datasets, metrics, statistics

| proposal | status | evidence |
|---|---|---|
| Amax (best-of-annotators) scoring; singer-disjoint dev/test split; paired clip-level bootstrap with MDE; Molina split/merge taxonomy; exclude derived-truth corpora; codec tier | **SHIPPED** (harness) | `lib/metrics.ts`, `lib/split.ts`, `lib/stats.ts`, `lib/segErrors.ts`, `Condition.codec` |
| COnPOff at a matching window for publication comparison | **SHIPPED 2026-09-01** | `Metrics.f1Off` (mir_eval offset gate: max(50 ms, 20 %)), reported by run-eval and the benchmark |
| 50-cent pitch gate on un-rounded reference pitch | **NOT PURSUED** | needs cent-resolution truth on ingest; a cheap experiment with a chance of free points on off-pitch singers |
| Product benchmark grouped by material, with provenance + comparison | **SHIPPED 2026-09-01** | `benchmark.ts`, `benchmarks/` |
| Consented humming golden set | **NOT PURSUED** | the harness has no real hummed corpus with usable truth — see §3, item C |
| Recorded RIRs / noise beds instead of modelled ones | **NOT PURSUED** (cleared) | DEMAND, Arni, dEchorate, OK5 — DOIs and licences in `CORPORA.md` |
| 2AFC human panel | **NOT PURSUED** | invoked as a house rule three times, never available |
| "Notes to fix" per-clip edit distance (median/P90) | **NOT PURSUED** | `repairSecondsPer100` is the corpus-mean cousin and already decided the whistle provider question |
| Perform-to-a-click self-labelling protocol | **DISCARDED** (measured harmful) | dogfood whistling scored COnP 0.00 as recorded (wrong key on 3/6 clips); `research-whistle-corpus.md` §6 now forbids it |

### research-voice-transcription.md — the voice flow

| proposal | status | evidence |
|---|---|---|
| V0 plumbing (profile-level segmentation choice, `applyVoice`, segErrors + onset taxonomy in run-eval, articulated synthetic voice) | **SHIPPED** | `pipeline-profile.ts`, `profile-resolver.ts`, `lib/onsetClasses.ts`, `lib/synth.ts` |
| E1 silence-state Viterbi, voice-gated | **SHIPPED** | +0.123 held-out test |
| Onset calibration (the doc's omission) | **SHIPPED** | `onsetShiftSec 0.07`, +0.15 alone |
| E2 octave prior · E3 SiPTH merge guard · E5 gate sweep · Hann-median pitch · `pitchWindow: 'onset'` · Ryynänen accent (`reonsetCost`/`accentBonus`) · `wideChangeCost` · every later estimator variant (slew, one-pole, detrend, slope-gated) | **BUILT-OFF** | each null has its mechanism on the option's doc comment |
| E4a boundary evidence (volume decay + pitch dip) | **SHIPPED** | discount 0.35, +0.005 and recovers legato transitions |
| E4b selective SuperFlux re-onset splitter | **DISCARDED** (measured) | `lib/spectralFlux.ts`: ~6 of 1,253 re-onsets recovered. The doc's "one untried idea" line is stale |
| Explicit user mic-source toggle | **SUPERSEDED** | replaced by the YAMNet classifier; the chip was removed |
| Re-resolve the profile on the final pass | **SHIPPED 2026-09-01** | `RecordingPipeline.rerouteFinal` — for takes that locked the unvoiced fallback |
| §10d gate: benchmark Yong-2023 | **DONE** | +0.018 mean, re-onset recall 0.403 vs 0.263, −0.16 on operatic vibrato; verdict "complementary profile, not a swap" — see §3, item A |
| §10d: Omnizart, ROSVOT, Klangio benchmarks | **NOT PURSUED** | Omnizart weaker than Yong; ROSVOT weights NC-tainted; Klangio = vendor API trial |
| nara_wpe dereverberation | **DISCARDED** (mechanism) | `lib/wpe.ts`: WPE cancels the sustained note, not the tail |
| DeepFilterNet3 + observation-adding | **NOT PURSUED** | the last front-end candidate for the reverb gap; speech-centric training is the risk |
| D1 licence asks (JKU, Zhejiang, KAIST/HUST/LDC) · D3 serving shape · pseudo-labelling | **NOT PURSUED / policy** | `ModelBackend` still single-key |
| D2 consent for using recordings | **SHIPPED** | terms + privacy pages |
| §8 UX: key-snap | **SHIPPED** (automatic, not opt-in) | `voice-notation.ts` |
| §8 UX: split/merge slider, live pitch feedback, A/B playback, "ta-ta-ta" tip, 30 s calibration | **NOT PURSUED** | the tip now has in-house evidence: plosive 1.00 → legato 0.68 on the articulation tier |

### research-voice-datasets.md — corpora

Thirteen corpora adopted with fetchers and tiers; ~45 licence-barred and ~30
content-barred, each with a one-line reason in the register. `CORPORA.md` is
the operative index; the document is the provenance argument. Two facts worth
lifting out:

- **Humming has no real corpus with usable truth anywhere.** HumTrans (NC and
  mis-aligned), CHAD (NC, retrieval-only), MLEnd (unlicensed), MTG-QBH (Zenodo
  says CC-BY-4.0, UPF's page says non-commercial — unresolved), mir-qbsh
  (derived truth, research licence → context tier). The benchmark reports the
  humming row as "no benchmark-grade data" for that reason.
- **Amateur phone-mic singing** exists as annotatable audio only: SingBAP
  (CC-BY-4.0, iPhone + laptop + condenser in parallel, no onsets) is the best
  lead; PJS (labels in hand, audio behind a Drive quota) the second.

### research-rhythm.md and research-daw-products.md — notation and product behaviour

| proposal | status | evidence |
|---|---|---|
| Score notation in beats (note-value accuracy, onset-in-beats F1, readability counters) | **SHIPPED** (harness) | `lib/notation.ts`, `notation-eval.ts` |
| Coarseness-penalised nearest-grid snap, 16th cap, seam-fill, Stage A/B separation, metrical duration speller (rules 1–6) | **SHIPPED** | `note-extractor.ts`, `mxml-builder.ts`; boundary violations 33 % → 0 % |
| Grid-phase (φ) estimate | **SHIPPED, voice-only, unmeasured on the corpus** | `voice-notation.ts:estimateGridPhaseBeats` — unit tests only; ungating it for whistling/instruments is the cheapest untested notation lever |
| Any tempo estimation, tempo curve, tap tempo, beat tracker | **DISCARDED** (owner decision) | fixed-120 vs true tempo 0.245 vs 0.714 is why the click stays mandatory |
| Onset-detector delay constant (aubio) | **BUILT-OFF** | calibrated at 0 (R7) |
| pYIN amplitude-ratio splitter | **DISCARDED** (measured) | +0.001 at best — the dip-then-rise detector already covers it |
| Repair-cost weighting (missed ≫ spurious) | **SHIPPED** (metric) | `repairSecondsPer100`; decided the whistle provider swap against COnP |
| Editor Join / Split note actions | **NOT PURSUED** | the repair model assumes a one-keystroke merge the editor does not have |
| Global metrical DP quantiser · triplets · swing · anacrusis · post-hoc re-quantise · quantise-strength slider · senza misura · "simplify" preference · MV2H/MUSTER · click-bleed latency · recording-quality warning · whole-bar-rest rule · full IONV duration rule | **NOT PURSUED** | ranked in §3 |
| Melodia trick, activation-derivative onsets (basic-pitch internals) | **SUPERSEDED** | basic-pitch deleted 2026-08-22 |

### research-plugin-sources.md (+ the executed plan) — open-source implementations mined for ideas

All 19 plan tasks (R1–R25, E1–E8) were executed 2026-08-19 and logged. Default-on
outcomes: **R11** (hop-independent knobs), **E1** (`pitchMidiFloat` on instrument
paths), **R20** (intonation tier), **E6a** (running-mean baseline in the sweep).
**R7** ships a knob calibrated at 0. Everything else is BUILT-OFF with numbers
(R3, R15, R19, R21, R24, R25, E2, E3, E4, E7, E8, the estimator family) or
DISCARDED (R23 GAME — NC checkpoints). The executed plan document was deleted
2026-09-01; its record is FINDINGS.md.

Three §16–§20 ideas never became tasks and are still untested: **R8** the
split↔merge slider (product, parked as D4); **§20.5** drift/vibrato separation
by a per-note ~500 ms zero-phase moving average (the only surveyed mechanism
that models the whistled-sustain split, which is vibrato crossing a semitone
boundary); **§16.13** an editable note layer as the correction surface.

**R21 (dropout fill), corrected 2026-09-01:** its +0.13 reverb relief was
measured on a variant cache built *without* the shipped reverberance relief
(profiles at gate 0.5). Rebuilt with the relief in place, every fill variant —
unconditional, reverberance-scaled, energy-gated — is null-to-negative under
reverb and null on clean voice. The "better reverberance detector unlocks
+0.13" follow-up is closed; the reverb gap is a front-end problem.

### research-whistle-corpus.md — whistling

Acquisition is closed with evidence (no corpus exists, none is coming). What
exists is fetched: 117 Freesound/Commons clips (`whistle-real`), 6 vintage 78s,
6 dogfood takes — **all on unverified draft labels**, so every whistle number is
diagnosis, not accuracy. Octave prior DISCARDED (octErr 0.00). Whistle-specific
segmenter settings BUILT-OFF (rejected globally; the two whistle corpora
disagree because one's truth was drafted by an over-segmenting tracker). The
whistle FFT tracker is deliberately blocked until labels are verified (circular
otherwise). Open and unaddressed: the resolver locks onto the *accompaniment*
on accompanied whistling (piano 215–530 Hz vs whistle 1.3–2.2 kHz).

Stale in the document: the very-high band is octave-down CREPE at ~3.99 kHz,
not basic-pitch at 4300 Hz. Re-censused 2026-09-01 against the new ceiling: 5 of
3,083 whistle labels (0.16 %, one clip) sit above it — §4a's "overflow is trivial"
still holds (FINDINGS.md).

## 3. What is left, ranked

Everything below is reachable without training a model. Expected value is for
accuracy on real recordings unless marked product.

**A. Yong-2023 as a complementary voice profile, or its re-onset head fused.**
MIT code and checkpoint, already benchmarked on the held-out voice slice:
re-onset recall 0.403 vs our 0.263 (the one axis every DSP route has failed
at), +0.00…+0.08 on amateur solo singing, −0.16 on operatic vibrato. Must ship
behind a profile flag, never as a swap. 1–2 weeks: torch sidecar through the
`ModelBackend` seam (still single-key), a 2AFC listen, and the training-data
provenance check. The single largest accuracy lever left; a team decision.

**B. Verify the 30 staged whistle clips** (`annotations/whistle-real/VERIFY-WORKLIST.md`,
~1 h of a human in Audacity). Unblocks four parked whistling questions
(segmenter setting, the split investigation, the FFT tracker, the note floor)
and promotes 117 clips to benchmark grade. Nothing else in whistling can move
until this happens.

**C. A real humming corpus.** Partly addressed 2026-09-01: under the
defensible-use licence standard, HumTrans (CC BY-NC, the only hummed audio with
note truth anywhere) is fetched into the context tier and its reference-MIDI
labels are aligned to the audio with a YIN drafter, giving the benchmark a
*provisional* humming row. A benchmark-grade row still needs permissively
licensed, human-verified humming: record beta users humming freely (not to a
click) and annotate; the consent language is already in the terms and
`apps/eval` materialises in-house corpora.

**D. Annotate SingBAP's phone channel** (CC-BY-4.0, no onsets; interval
patterns published so only onsets need marking). The only route to amateur
phone-mic truth, and it de-skews the low-voice stratum from operatic males.

**E. Accompaniment-robust register resolution** — a melodic-salience criterion
in the pitch scan instead of "loudest band". The whole `whistle-vintage` result
and a general product mode (recording over a backing track). 1–3 days.

**F. Recorded RIRs + noise beds as new adverse conditions** (Arni for the RT60
axis, OK5 for room diversity, DEMAND for noise; all CC-BY-4.0). De-risks every
reverb conclusion, which today rests on modelled rooms. ~1 day.

**G. DeepFilterNet3 with observation-adding** — the last front-end candidate
for the +0.14/+0.23 reverb oracle. ~2 days to measure; domain-shift risk.

**H. Notation levers (cheap, measurable with `notation-eval.ts`):** ungate the
grid-phase estimate from voice and measure it; whole-bar rest rule; full
IONV duration rule (note-value accuracy 0.587 is the weakest notation number).

**I. Product (no accuracy metric moves, the user's repair effort does):**
editor Join/Split actions; the "if notes run together, try ta-ta-ta" tip;
surface the already-computed recording-quality verdict; a split↔merge
sensitivity control.

**J. Cheap harness items:** AVP wired directly to `OnsetDetector` (isolated
onset benchmark); 50-cent pitch gate on un-rounded truth; "notes to fix"
median/P90; §20.5 drift/vibrato separation for whistled sustains (after B).

**Do not revive** (measured, mechanisms logged): the pitch-estimator family,
multi-candidate emission, transition pricing in any shape, absolute-dBFS gates,
the octave prior, the SuperFlux splitter, WPE or any self-prediction dereverb,
noise-triggered gate tightening, afftdn, tempo estimation, R21's fill.

## 4. Documents now factually stale in places

The research documents are kept as the record of the reasoning, not edited to
match the code. Where they lag reality:

- **basic-pitch was deleted 2026-08-22**; every "what we ship" sentence about it
  (pitch-models §0/§1a/§1f/§2c/§3b/§5a, plugin-sources R1/R5/§16.11,
  whistle-corpus §0/§4a) describes a provider that no longer exists. The
  very-high band is octave-down CREPE.
- pitch-models §5a lists CREPE's weights as clean; the repo's open item on
  MDB-stem-synth/RWC exposure is resolved by the standing licence rule (the
  checkpoint's own MIT licence governs; we do not hunt upstream) — recorded in
  FINDINGS.md 2026-09-01.
- voice-transcription §9.1 (segErrors unwired), §13 (no external corpus), §6
  (vocadito the only clean corpus), §10 banner (SuperFlux untried), §5 (key-snap
  UX-only) — all superseded by shipped work.
- benchmarks §2.4 (`VOCADITO_ANNOTATOR=A1` default — Amax is), §1.1 Dagstuhl row,
  Molina "unavailable" (it is non-commercial), "whistling: nothing exists" (129
  clips exist; labels are unverified), HumTrans "unverified" (verified, rejected).
- rhythm/daw: `notation-eval.ts` no longer has the median-IOI / residual+complexity
  tempo strategies its README row advertised (fixed in the README 2026-09-01).
