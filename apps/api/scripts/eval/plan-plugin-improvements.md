# Plan: pipeline improvements from the plugin-source research

Execution plan for the proposals in `research-plugin-sources.md` §17 (validated 2026-08-19 against
both our source and the cited repos). This file is the **what/how/in-what-order/how-to-verify**; the
research doc is the **why** — each task links its rationale by section number. An implementing agent
should work from this file and open the research doc only at the referenced sections.

Status legend: `[ ]` open · `[~]` in progress · `[x]` done (findings-log entry written) · `[n]` null
result (also logged). Update statuses in place as work lands.

---

## Standing rules (read before any task)

1. **Never transcribe code from the cited repositories.** Everything below is implementable from the
   prose in the research doc. Licences: Essentia is AGPL-3 (strictly read-only — never vendor, link,
   or port line-by-line, not even in the harness); most others are GPL (ideas only); two repos have
   no licence at all (stricter than GPL). The one exception is NeuralNote (Apache-2.0), whose
   `_addPitchBends` may be *adapted* with attribution + NOTICE. Full register:
   `research-plugin-sources.md` §18.
2. **House metric rules** (from the eval README's "Metric conventions" — violating them silently
   invalidates results): tune on `EVAL_SPLIT=dev`, confirm on `test` **once**; a result needs a
   paired-bootstrap CI excluding 0; nothing under ~1 pt is a result; `mir-qbsh` and `n20emv2-test`
   stay excluded from sweeps; the note metric is COnP@±100 ms.
3. **Every outcome goes in the Findings log** in `scripts/eval/README.md` — nulls too, with the CI.
4. **Cache discipline:** any change that alters what the decoder/resolver/CREPE decode means bumps
   `CACHE_VERSION` in **both** `lib/trackCache.ts` and `lib/variantCache.ts`.
5. **Guard slice:** every change to shared machinery runs `sweep-voice.ts`, which scores VOICE
   (annotated-vocalset, N20EMv2, vocadito) and GUARD (all instrument corpora) together. Voice-tuned
   settings have been measured to cost instruments ~0.03 — a VOICE win that dents GUARD is a null.
6. **Quoted numbers are sweep starting points, never values to adopt on authority**
   (`research-plugin-sources.md` §18, closing note).
7. **Harness setup** (once): `brew install fluid-synth`, `./fetch-soundfont.sh`, then
   `pnpm --filter @mushee/api eval:generate`; real corpora via the `fetch-*.ts` scripts +
   `degrade-real.ts`. Run any script as `pnpm --filter @mushee/api exec tsx scripts/eval/<script>.ts`.
8. **One task per commit**, each independently revertable, each gated by its own "done when".

**Ordering constraints (hard):** Batch 1 task 1 (R11) goes **first** — it changes what every later
sweep number means. Batch 2 (R20) goes **before** Batch 3's R1/R2/R13 — it creates the ground truth
they are measured against. Within Batch 3, E1 precedes E2.

---

## Batch 1 — mechanical, self-contained (research doc §17a)

### [x] 1. R11 — hop-normalise every per-frame cost  *(XS; do first)*
- **Change:** declare per-frame costs in `NoteSegmenterOptions` / `VoiceDecoderOptions` per **10 ms**
  and scale by `hopSec / 0.01` at construction. Convert the frame-denominated constants to seconds:
  `minFrames`, `attackFrameCost` (both files), `ENERGY_TOLERANCE` and `MIN_NOTE_LEN_FRAMES`
  (`basic-pitch-provider.ts`). Delete the hand-derived 3.4× note in `note-segmenter.ts`.
- **Files:** `src/recordings/pipeline/note-segmenter.ts`, `voice-note-decoder.ts`,
  `providers/basic-pitch-provider.ts`.
- **Verify:** convert constants *exactly* (e.g. a per-frame cost at a 20 ms hop halves when declared
  per 10 ms), then confirm **bit-identical output** at the current hop via `sweep-voice.ts` and
  `sweep-segmenter.ts` against the unchanged baseline.
- **Done when:** identical results at the current hop; a hop change no longer silently re-tunes the
  model. Record the conversion table in the Findings log so historical sweep numbers stay readable.
- **Why:** §6.1, §16.10.

### [n] 2. R15 — joint duration × velocity note filter  *(XS)*
- **Change:** drop a note only if short **AND** quiet; add the missing long-**AND**-quiet filter
  (reverb-tail shape). Inputs already exist: basic-pitch events carry `amplitude`, the pitch track
  carries `energy`. Behind options, swept.
- **Files:** `note-segmenter.ts` (`minFrames` path), `voice-note-decoder.ts` (`absorbShortRuns`),
  the basic-pitch min-length path.
- **Verify:** `sweep-segmenter.ts` + `sweep-voice.ts` on the adverse tier (`degrade-real.ts` variants).
- **Done when:** precision rises on the reverb/adverse tier with recall unchanged — or logged null.
- **Why:** §9.3.

### [n] 3. R19 — voiced-fraction quorum before reporting pitch  *(XS)*
- **Change:** block-level quorum (fourth independent instance in the survey: >¼ voiced in outotune,
  ≥50 %/15 ms in Essentia, median-of-6 in aubio) as a new option on `PitchTrack.voicedMask` or as a
  decoder voicing term.
- **Files:** `pitch-track.ts` (preferred — benefits both trajectory consumers) or
  `voice-note-decoder.ts`.
- **Done when:** spurious sub-100 ms notes fall on the reverb tier; no change on clean. Bump both
  `CACHE_VERSION`s if implemented at track level.
- **Why:** §11.3, §7.2, §4.5.

### [n] 4. R21 — fill single-frame voicing dropouts on the track  *(XS)*
- **Change:** pre-pass on `PitchTrack`: an **unvoiced** frame whose both neighbours are voiced gets
  the interpolated pitch (max gap 1–2 frames, behind an option). NOTE: the reference implementation
  also smooths voiced frames — ours must not (§14.2 *(validation)* note).
- **Files:** `pitch-track.ts`; bump both `CACHE_VERSION`s.
- **Done when:** no regression anywhere, and `unvoicedPitchCost` re-sweeps to a flatter optimum —
  the sign it was doing two jobs.
- **Why:** §14.2.

### [x] 5. R7 — constant onset-delay compensation per profile  *(XS)*
- **Change:** aubio-style `delay` constant subtracted from reported onsets, calibrated per profile.
  Target: the measured −52 ms mean / −44 ms median bias documented at
  `voice-note-decoder.ts` (`onsetShiftSec` docstring).
- **Files:** `profiles/pipeline-profile.ts`, `onset-detector.ts`.
- **Done when:** the bias goes to ~0 without hurting F1 (`sweep-voice.ts` COn/COnP both slices).
- **Why:** §4.2, §16.6. Pairs with E5 (R12) later — don't double-compensate.

### [n] 6. R3 — adaptive onset threshold  *(S)*
- **Change:** add `adaptiveThreshold?: { windowSec, k }` to `OnsetDetectorOptions`:
  `novelty − movingMedian(window) − k·movingMean(window)`, replacing the fixed
  `dipRatio`/`riseRatio` pair when enabled.
- **Files:** `onset-detector.ts`; sweep via `sweep-reverb.ts`.
- **Done when:** beats the fixed-ratio baselines on **both** the sustained-singing slice and
  guitarset/vocadito — the thing the file's own doc comment says no fixed setting managed. If only
  one slice improves, log the split result and keep it off.
- **Why:** §4.1, §16.5.

### [n] 7. R17 → R4 → §1.3 — three `pitchEstimator` variants, in that order  *(S)*
- **Change:** new variants in `voice-note-decoder.ts` `noteCents`, joining the existing
  trimmed-mean/Hann-median sweep: (1) slew-rate limiter with momentum (arrives and holds — try
  first), (2) causal one-pole with hard reset at boundaries, (3) linear-detrend-then-centre.
- **Done when:** any variant beats `trimmed-mean` on the VOICE slice — or all three logged as nulls.
- **Why:** §12.2, §3.2, §1.3.

---

## Batch 2 — the intonation eval tier (R20; before Batch 3's E2/E6/E8)

### [x] 8. R20 — per-note intonation degradation tier  *(S)*
- **Scope decision (made):** **synthetic-only.** `synthesizeArticulated` already applies per-note
  detune natively (`pitchScatterCents`, 19 ¢ Gaussian per note, plus drift/scoop) — the tier
  parameterises an existing render knob. Detuning the **real** corpora (what Deep Autotuner did)
  needs new per-note shifting machinery and is **parked** as a follow-up if the synthetic tier
  proves out.
- **Change:** extend `scenarios.ts` with `intonation-<N>c` conditions sweeping per-note detune
  magnitude (e.g. 0 / 20 / 40 / 60 cents; ±100 is the outer bound), applied per note, ground truth
  = the *undetuned* notes. Articulated voice scenarios only.
- **Files:** `scenarios.ts`, `lib/synth.ts` (parameter plumbing only), `generate.ts` reruns.
- **Gate (hard):** the current pipeline must show a **monotone** accuracy loss as detuning grows.
  If the curve is flat or non-monotone, the tier is not measuring what it claims and nothing built
  on it is trustworthy — stop and report.
- **Why:** §14.3; it is the only proposal that creates new ground truth, and E2/E6/E8 are
  unmeasurable without it.

---

## Batch 3 — experiments (research doc §17b; each is measure-first, ship-second)

### [x] E1 — fractional pitch for trajectory-path instruments  *(new, from validation; before E2)*
- Normal-register instruments ride the CREPE path, where fractional pitch already exists in-process
  (`PitchTrack.cents`) but is never attached to their notes (`pitchMidiFloat` is set only by the
  voice decoder). Attach a `noteCents`-style estimate over each segmented note's span in the
  instrument segmentation path — **no wire change**. Measure: does tuning-offset estimation /
  spelling improve on the instrument corpora (needs the Batch 2 tier for spelling; COnP as guard)?
- **Why:** §2.1 *(validation)* scope note in §17b's R1 row.

### [n] E2 — R1: is the contour posteriorgram worth the wire?  *(after E1)*
- Offline only, in `scripts/eval`: the **local backend already computes the contour head and drops
  it at the seam**, so no service change is needed to measure. Compute `pitchMidiFloat` per
  NeuralNote's Gaussian argmax (±25 bins, σ=5 — adapt under Apache-2.0 with attribution), then
  answer the doc's three questions (tuning offset on basic-pitch takes; R2 histogram improvement;
  R5's median-of-frames-3..9 vs integer pitch — R5 falls out of the same run). Scope is now only
  the `very-high` band + default/fallback profile takes. Only if ≥2 of 3 pay does
  `inference.proto` change.
- **Why:** §2.1, §4.5, §17b.

### [n] E3 — R9 + R16: multi-candidate pitch track  *(the headline experiment)*
- Extract top-k (k=3–5) local maxima per frame from the CREPE activations `crepePredict` already
  returns; widen `PitchTrack` to carry them **behind a flag**; give the decoder pYIN's
  `minDistProb^yinTrust` emission and the octave tie-break (when two candidates are ~an octave
  apart and the lower is not clearly stronger, take the higher fundamental). Bump both
  `CACHE_VERSION`s.
- **Kill criteria (from the doc, keep verbatim):** kill if the single-candidate baseline is not
  beaten on the VOICE slice at k=3 **and** k=5.
- **Why:** §5.6, §12.1, §13.2, §16.8, §16.11.

### [n] E4 — R10: interval-proportional change cost + pitch memory across silence
- (a) **Start from the shelved `wideChangeCost`/`wideIntervalSemitones`** (`voice-note-decoder.ts`
  :137-139, defaulted off) and its recorded O(states) rationale; then try pYIN's Gaussian (σ 0.7,
  cap 13 st) and Praat's linear-in-log form. (b) Give silence pitch memory: per-pitch silence
  states (pYIN, §5.2) *or* Praat's cheaper path-lookback (§6.4). Run (a) first.
- **Why:** §5.3, §6.2, §16.7.

### [x] E5 — R12: asymmetric onset/offset confirmation + delay compensation
- Split `STABLE_MARGIN_SEC` (0.4, `recording-pipeline.ts`) into onset/offset confirmations and
  subtract the confirmation delay from timestamps. Essentia's 75/200 ms is the starting point.
  Sweep on the articulated synthetic tier + Dagstuhl beat grids. Coordinate with task 5 (R7) so the
  bias is compensated exactly once.
- **Why:** §7.2, §16.6.

### [x] E6 — R13: running-mean segmenter baseline + tuning-first ordering  *(needs Batch 2)*
- Two separable questions: (a) add Essentia's ±60-cent running-mean island-building segmenter
  (~20 lines, written from the §7.1 prose — AGPL, do not port) as a **baseline** in
  `sweep-segmenter.ts`; (b) move `estimateTuningOffsetCents` upstream of segmentation and re-run
  unchanged — a pure ordering change, so any delta is real.
- **Why:** §7.1.

### [n] E7 — R6: split `unvoicedPitchCost` into note-survival vs pitch-identity
- Second transition cost behind a flag; sweep on the articulated synthetic tier where dropouts are
  ground-truthed. Cheaper after task 4 (R21) has taken the trivial gaps.
- **Why:** §3.3.

### [n] E8 — R2 (+R14/R18): take-key fallback, two-mask design  *(needs Batch 2; design doc first)*
- Before code: write the short design per §12.3/§7.3/§8.2 — **two masks** (take-key for
  interpretation, score key signature for spelling), an **abstain** outcome that competes as a
  candidate, profile type as a parameter. Then: duration-weighted pitch-class histogram +
  24-template correlation in `voice-notation.ts` / `mxml-builder.ts`, used only when the score's
  `keyFifths` is absent or unhelpful. **Spelling-only — zero pitch changes in the diff.**
- **Judged on the page, not on F1:** accidental-spelling error on the Batch 2 detuned tier +
  `notation-eval.ts` readability counters, with takes whose sung key ≠ score key as the target
  slice.
- **Why:** §1.1, §7.3, §8.2, §12.3, §16.9.

---

## Batch 4 — round-4 addendum (research doc §20; added 2026-08-19 after Batches 1–3 ran)

### [ ] 9. R23 — benchmark OpenVPI GAME as an external note transcriber  *(the live item)*
- **Licence check first (blocking):** GAME's checkpoints are OpenVPI's, not in OpenTune's repo, and
  their licence is unverified. No download into the repo, no benchmark result in the Findings log,
  until the checkpoint licence is confirmed compatible. (OpenTune itself is AGPL-3 — ideas only.)
- **Change:** a runner in the style of `bench-yong-runner.py` — batch GAME inference (encoder →
  D3PM segmenter ×8 passes → bd2dur → estimator, ONNX, CPU-only) into per-clip note JSONs, scored
  by `bench-external-notes.ts` under house conventions (`EXT_DIR=<dir> EVAL_SPLIT=test`).
- **Deployment lore (from OpenTune's wrapper, §20.2):** chunk clips > 45 s at silence midpoints;
  dedupe seams at 50 ms keeping the earlier chunk's note; do not use the CoreML EP (silent kernel
  failures on GAME's graph).
- **Done when:** GAME's COnP on the VOICE slice is measured against ours (0.668 held-out test) and
  the verdict — acquire, ignore, or hybrid — is in the Findings log. This is the §10d gate; the
  external-yardstick row already says a learned note model is where the remaining headroom is.
- **Why:** §20.1–§20.2.

### [ ] 10. R24 — angle-band-gated slope rotation as a fourth `pitchEstimator` variant  *(XS, optional)*
- Detrend only when the note's slope angle (normalised at 7 st/s) is in the 10°–30° band; leave
  flat notes and deliberate glides alone. Joins the task-7 sweep, whose three unconditional
  variants all measured null — expectation is low; a fourth null closes the family for good.
- **Why:** §20.5.

### [ ] 11. R25 — two-tier silence rule in the onset detector  *(XS, optional)*
- Silent if total RMS ≤ −40 dBFS, or ≤ −30 dBFS while the 60 Hz–3 kHz band is < −40 dBFS. Sweep on
  the adverse tier (wind/rumble is the target shape).
- **Why:** §20.5.

*(R26 — the RMVPE "uv" inversion trap — is a recorded note, not a task: research doc §20.4.)*

---

## Explicitly not in scope (do not implement; see research doc §17c)

MXTune's segmentation or in-scale grid · `melodiaTrick` while input is monophonic · aubio's
adaptive whitening (already bettered) · WaoN's harmonic-template peeling (polyphony) · a DSP f0
estimator swap (WORLD/Harvest — `research-pitch-models.md`'s call) · the score-as-pitch-prior
(parked deliberately) · Deep Autotuner's shift regressor (trained weights = standing no-go, and it
needs a backing track) · anything requiring model training · real-audio per-note detuning (parked
behind Batch 2's synthetic gate).
