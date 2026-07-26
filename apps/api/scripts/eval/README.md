# Recording-pipeline evaluation harness

Everything under this directory measures the audio→notes transcription pipeline
(`src/recordings/`) against ground truth, so tuning changes are gated by numbers
instead of vibes. Nothing here ships to production; scripts run standalone with
`tsx` and import the pipeline classes directly.

Run any script as:

```sh
pnpm --filter @mushee/api exec tsx scripts/eval/<script>.ts
```

The two everyday entry points are also wired into package.json:
`pnpm --filter @mushee/api eval:generate` and `pnpm --filter @mushee/api eval:run`.

## Prerequisites

- **fluidsynth** on PATH (`brew install fluid-synth`) — renders instrument
  clips for the synthetic corpus.
- **Soundfont**: `./fetch-soundfont.sh` downloads `assets/FluidR3_GM.sf2`
  (~150 MB, gitignored).
- ffmpeg comes from the app's own `ffmpeg-static` dependency; nothing to install.

## Corpus layout

- `scripts/fixtures/eval/` — **synthetic** corpus, built by `generate.ts`:
  one clean clip plus degraded variants per (scenario × melody), each with
  `<melody>.truth.json`.
- `scripts/fixtures/eval-real/<dataset>/` — **real** recorded corpora (singing
  *and* monophonic instruments), built by the `fetch-*.ts` scripts:
  `<clip>__real.wav` + `<clip>.truth.json` + `dataset.json` manifest.
  `degrade-real.ts` adds `<clip>__<condition>.wav` variants for the adverse
  conditions — real performances under synthetic wind/reverb/babble are the most
  honest robustness measure we have.

  Each dataset dir carries ONE `instrumentId` hint (`lib/realCorpus.ts`), so a
  corpus that spans instruments is split per instrument — hence `urmp-violin`,
  `urmp-flute`, … rather than one `urmp/`.

Both fixture trees are gitignored; regenerate them locally with the scripts below.

### Degradation conditions (scenarios.ts)

Two tiers: the moderate originals (`clean`, `room-mic`, `noisy-phone`) and the
**adverse tier** modelling real recording circumstances — `echoey-room`
(impulse-response reverb, RT60 0.9 s), `wind-outdoor` (gusty synthesized wind,
`lib/acoustics.ts`), `street-noise` (speech-shaped babble), and `distant-mic`
(wet-dominant RT60 1.3 s + noise + air absorption). Reports aggregate per
condition as well as per scenario.

### Noise-adaptation env knobs (production code, sweepable)

The pipeline's noise adaptation reads these (defaults in parentheses):
`RECORDING_NOISE_ADAPT` (1; `0` = the legacy scan), `RECORDING_HARMONICITY_GATE`
(4.0), `RECORDING_NOISY_MAX_SNR_DB` (25), `RECORDING_NOISY_MIN_NOISINESS` (0.5).
The classifier's ACTIONS all default to no-ops after the adverse-eval verdict
(see profile-resolver.ts): `RECORDING_NOISY_CONF_BUMP` (0),
`RECORDING_NOISY_MIN_FRAMES` (4), `RECORDING_NOISY_DENOISE` (0 — set 1 to run
`RECORDING_DENOISE_FILTER`, afftdn + its 25 ms delay-compensating atrim), and
`RECORDING_VITERBI_JUMP_FLOOR` (unset — pass nats, e.g. -2.5, to enable the
Gaussian+uniform mixture transition prior).

## Scripts

### Harness core

| Script | Purpose |
|---|---|
| `types.ts`, `melodies.ts`, `scenarios.ts` | The evaluation matrix: register-agnostic melodies placed into scenario registers (whistle-high, voice-bass, trumpet-mid control, …). |
| `generate.ts` | Build the synthetic corpus (fluidsynth/direct synthesis + degradations). Idempotent. |
| `run-eval.ts` | Score the pipeline over the corpus under a fixed config (env-driven: `EVAL_PROVIDER`, `EVAL_MIN_FREQ`, …). The baseline/tuning workhorse. |
| *(findings)* | **Start with the [Findings log](#findings-log-2026-07-accuracy-push) at the bottom of this file** — the state of accuracy, what shipped (with confidence intervals), the dead ends, and the open items. |
| `lib/` | Shared plumbing: synthesis (`synth.ts`, `midi.ts`, `wav.ts`), degradations (`degrade.ts`), scoring (`metrics.ts`, mir_eval-style), corpus discovery (`groundTruth.ts`, `realCorpus.ts`), and `pipelineRun.ts` (drives the production `RecordingPipeline` end-to-end). |
| `lib/trackCache.ts` | Caches each clip's frame-level pitch trajectory (+ energy, onsets, resolved profile) to disk. Model inference dominates a corpus run, but everything worth tuning is downstream of it — so this turns a 40-minute experiment into a sub-second one. Bump `CACHE_VERSION` when the decoder, resolver or CREPE decode changes meaning. |
| `lib/stats.ts` | Paired-bootstrap confidence intervals, resampling **clips** (not notes) and pairing configs on the same clips. Also reports measured σ, ρ and the minimum detectable effect, so a null result can be told apart from an underpowered one. |
| `lib/split.ts` | Deterministic dev/test split drawn over **performer/piece groups**, not clips — one Annotated-VocalSet singer has dozens of clips, so a per-clip split puts the same voice in both halves. Tune on `dev`, confirm on `test` once. |
| `lib/notation.ts` | Notation metrics **in beats**: onset-in-beats F1 (with the metrical scale searched and reported, so half/double-tempo errors surface), note-value accuracy, and reference-free readability counters. Needed because seconds-based F1 rewards *not* quantising — see the Findings log below. |

### Real-corpus fetchers

| Script | Purpose |
|---|---|
| `fetch-vocadito.ts` | vocadito (ISMIR 2021) — real solo singing. |
| `fetch-mir-qbsh.ts` | MIR-QBSH — low-fi sung/hummed queries (8 kHz). |
| `fetch-annotated-vocalset.ts` | Annotated-VocalSet — studio-quality professional singing. |
| `fetch-urmp.ts` | URMP (CC0) — 48 isolated **orchestral instrument** tracks (13 instruments: strings, winds, brass), 15 s each, one `urmp-<instrument>` dataset per instrument. Range-fetches only the bytes it needs (~100 MB, not the 12 GB Dryad tarball). |
| `fetch-guitarset.ts` | GuitarSet (CC-BY) — 50 **acoustic guitar** solo excerpts, 15 s each, mono mic (`GUITARSET_AUDIO=pickup` for the DI mix). Strummed `_comp` excerpts are excluded as polyphonic. |
| `fetch-n20emv2.ts` | N20EMv2 (CC BY-SA) — 120 solo-singing excerpts, 15 s each, 10 subjects, **expert-corrected note annotations** (Melodyne draft + two music experts) and the harness's only **external yardstick**: the corpus publishes COnPOff 73.06 / COnP 79.56 / COn 93.66 at 50 cents / 50 ms. Its own train/valid/test split is preserved as two datasets, `n20emv2` (102, tunable) and `n20emv2-test` (18, confirm-only). Range-fetches *inside* the record's ten zips (~180 MB, not the 11.5 GB record); `N20EMV2_TARGET` sets the subset size. |
| `fetch-soundfont.sh` | FluidR3_GM soundfont for `generate.ts`. |
| `degrade-real.ts` | Adverse-condition variants of the fetched real clips (run after the fetchers). |

A corpus that ships its OWN train/test split gets **two dataset dirs**, so their
test material can never leak into a sweep: `n20emv2` is tunable, `n20emv2-test`
is confirm-only (`SWEEP_EXCLUDE=n20emv2-test`, and it is the half the published
numbers refer to). Note that `lib/split.ts` does not yet know the n20emv2 naming
convention, so the harness's own dev/test split falls back to per-clip there —
clip ids are `sub<NN>_<song>` precisely so adding it is a one-liner.

**Deliberately NOT added: Belyk et al. sung + whistled pitch imitation**
(`doi:10.5061/dryad.504t7`, CC0) — the only clean whistling pitch data in
existence, and we have zero real whistling test data. It cannot carry note-level
truth: per the paper's methods the archived annotation is one Praat F₀ value per
imitated note, taken from *the centre 250 ms* of each note, with **no onsets or
offsets recorded anywhere**, and the trials are 5-note imitations whose *intended*
pitches are known but whose produced pitches deliberately are not (the study's
result is that singers are imprecise and sing flat). Labelling it from the
stimulus would reproduce the mir-qbsh mistake (§4.4a) one level worse. Its Dryad
downloads are also behind a proof-of-work bot check, so no fetcher can run
unattended. If whistling stays a supported input, record and annotate a corpus
(see the Findings log's open items) rather than deriving one.

### Gates & benchmarks (re-run when touching the relevant subsystem)

| Script | Purpose |
|---|---|
| `check-inference-parity.ts` | **Parity gate for the remote gRPC inference services** vs the in-process TF.js path — tensor diff + end-to-end pipeline. Referenced from the root README's inference section. |
| `check-streaming.ts` | Streaming-decode correctness: `StreamingDecoder` vs one-shot decode PCM parity, windowed-transcription equivalence. |
| `bench-streaming.ts` | Performance proof of the O(n²)→O(n) streaming change (see `meta/notes.md` §4). |
| `measure-concurrency.ts` | Steady-state real-time factor of one session → sessions-per-core capacity estimate (see `meta/notes.md` §4). |

### Diagnostics (rerunnable analysis tools for tuning passes)

| Script | Purpose |
|---|---|
| `diagnose-real.ts` | Decompose where note-F1 is lost on the real corpus (pitch vs timing vs MusicXML round-trip). |
| `note-errors.ts` | Classify note disagreement: ±1-semitone pitch errors vs missed vs spurious. |
| `sweep-real.ts` | Sweep post-processing params (segmentation/extractor/tempo) on the real corpus; model runs once per clip. |
| `probe-realpath.ts` | System-bias probe through the production `RecordingPipeline` + webm/opus codec path, hunting constant timing offsets the WAV eval can't see. |
| `annotator-agreement.ts` | Inter-annotator F1 ceiling on vocadito — the honest upper bound for targets (measured: 0.760 at ±100 ms). |
| `notation-eval.ts` | **Score the NOTATION, in beats.** Compares tempo strategies (fixed 120 / annotated / median-IOI / residual+complexity fit) on a metric that cannot be gamed by refusing to quantise, and reports readability counters on every corpus. Use this for anything rhythm-related. |
| `ablate.ts` | Stage-by-stage loss decomposition from the raw trajectory to the notated score, **with oracle upper bounds**, so effort goes where headroom actually exists. |
| `sweep-segmenter.ts` | Config sweep over the cached corpus with paired-bootstrap CIs, reported **per dataset** plus mean/F2/worst. `SWEEP_STAGE`, `SWEEP_ONLY`, `SWEEP_BASELINE`, `SWEEP_EXCLUDE`. |
| `inspect-clip.ts` | One clip in full: ground truth, an ASCII pitch contour, and every stage's output. Sweeps say which config wins; this says why — and it is what found the bugs. |

## Pruning log

- 2026-07-08: deleted `tempo-experiment.ts` — both of its questions are answered
  and acted on (tempo adoption shipped in `7a4ab0f`; the round-trip-loss
  measurement lives on in `diagnose-real.ts`).
- Earlier: `brainstorm-workflow.js` / `tuning-workflow.js` deleted as orphaned
  one-offs (see git history of `meta/structure-report.md`).


---

## Findings log (2026-07 accuracy push)

Distilled from the accuracy investigation of 2026-07-24/25 (the working `PLAN.md` it condenses has
been deleted; this section is the durable record). Every number below was **measured on this
machine**, on the corpus above, almost always as a paired-bootstrap comparison over clips with a
95 % CI — `*` marks an interval excluding zero.

### State of accuracy

| what | value |
|---|---|
| Real-corpus headline, clean condition (COnP@0.1, 18 datasets / 658 clips, mir-qbsh excluded) | **0.763** |
| vocadito vs its measured human inter-annotator ceiling | 0.671 / **0.760** (≈ 88 %) |
| Real monophonic instruments (URMP, 13 instruments) | 0.66–0.96, note counts ≈ correct |
| Sustained vibrato-heavy singing (annotated-vocalset) — the weak spot | ~0.45, ~1.7× over-segmented |
| Adverse: echoey-room / distant-mic (after the adaptive gate) | ~0.55 / ~0.44 (oracle ceiling: +0.14 / +0.23 above that) |
| External yardstick (N20EMv2 test split): us zero-shot vs their in-domain supervised model | 0.489 @±100 ms vs **79.56 @±50 ms** — ≥31 pts. The strategic read: remaining singing headroom is a **learned note model**, not more post-processing |
| Statistical floor: per-clip σ ≈ 0.20–0.28; paired ρ ≈ 0.98–0.99 → MDE ≈ 0.01 at n≈300 | nothing under ~1 pt is a result |

### Metric conventions (violating these silently invalidates results)

- The note metric is **COnP** (onset+pitch, **no offset gate**) at **±100 ms** — deliberately, per the
  only large human study of AMT metrics (75–150 ms matches human preference). It is **not comparable
  to published COnPOff figures**, and only to COnP at matching tolerance. `lib/metrics.ts` documents this.
- **Tune on `EVAL_SPLIT=dev`, confirm on `test` once.** The split groups by **performer**, not clip.
- `mir-qbsh` (manufactured note labels) and `n20emv2-test` (external yardstick) are excluded from
  sweeps and pooled headlines **by default, in code** — do not opt them back in for tuning.
- Seconds-based onset F1 **cannot evaluate the notation stage** (a finer grid always scores better —
  not quantising at all beats quantising at the true tempo, 0.851 vs 0.798). Use `notation-eval.ts`
  (metrics in beats) for anything rhythm-related.
- Vocadito is scored **best-of-annotators** (`scoreNotesBest`) — annotator disagreement is stylistic.
- A change to the decoder/resolver/CREPE decode must bump `CACHE_VERSION` in `lib/trackCache.ts`.

### Shipped (all with CIs on dev AND held-out test unless noted)

- Drop `pitchOutliers` + `merge` cleanup on the trajectory path: **+0.024 test** *.
- `adaptiveFloorFraction: 0.3` on the trajectory path: **+0.018 dev / +0.014 test** * (708-clip corpus).
- Reverberance-adaptive voicing gate: **+0.024 echoey / +0.043 distant on test** *, clean-neutral.
  Diagnosis: reverb halves CREPE's *confidence*, barely touches pitch — the gate was the breakage.
- Metrical duration spelling in `MxmlBuilder`: boundary violations **33 % → 0 %** over 6,840 rhythms.
- Fixed: touching notes read as overlapping (float epsilon) — silently dropped notes from contiguous runs.
- Fixed: held notes emitted only in their first bar; fully-silent bars never emitted at all.
- Fixed (web): capture started only **after** the WebSocket handshake at beat 1 — 100–400 ms of every
  take never captured and every note notated early (a simulated 100 ms lag costs **−0.47**
  phase-locked notation F1). Plus, from the post-hoc review of that fix: the final ≤100 ms of every
  take was dropped on stop(), and the MIME-type hint was lost in the normal ordering — both fixed with
  regression tests.
- Benchmark fixes: `degrade-real.ts` truncated 10–13 s clips (reverb numbers were ~0.023 flattering);
  vocadito best-of-annotators (**+0.011**, not the ~6 pts predicted from the published baseline —
  gaps measured on someone else's system do not transfer); mir-qbsh exclusion (validity — Δ headline
  only +0.006).

### Dead ends — measured, do not redo

- **Raising the note-length floor** (literature says 100–127 ms): 60/80/100 ms identical — the
  4-frame smoother already removes anything shorter; 120/140 ms cost −0.013/−0.039.
- **Widening the vibrato A-B-A folder** (0.25/0.35 s): monotonically worse. But do **not** remove it:
  disabling costs −0.020 dev / −0.024 test *.
- **Semitone-track smoother width**: 4 frames optimal; 2, 6, 8 all worse.
- **pYIN's amplitude-ratio onset splitter** (took Tony's COnPOff 0.38→0.50): at best **+0.001**
  [−0.002,+0.004] here, worse at any higher sensitivity — the shipping dip-then-rise detector already
  captures it. The literature gain does not transfer to a pipeline that already splits.
- **Dereverberation by spectral subtraction** (`lib/dereverb.ts`): every setting significantly
  negative despite a +0.14/+0.23 oracle ceiling — reverb costs *confidence*, and subtraction erodes
  the harmonic magnitudes confidence is computed from. A future front end must preserve harmonic
  structure (neural dereverb / reverb-robust model).
- **"Reverb fills the dips → tighten the onset splitter"**: false; splitter behaviour is
  material-dependent, not room-dependent.
- **Constant onset back-shift for reverb**: +0.049 wet but −0.137 clean — it is a smear, not a latency.
- **Coarsening the onset grid** (8th/quarter): −0.13…−0.19 phase-locked beat F1 for zero note-value
  gain. The 16th grid is right; 16th rests are its honest price (and are fragments of longer rests,
  conventionally correct — measured **zero** gaps under a quarter beat, so there is nothing to absorb).
- **Tie density after the new speller** (audited): 1.42 tie-starts/bar, 80.6 % of bars ≤2, 6.4 % ≥4.
  Acceptable; the ≥4 tail is where a future "simplify" preference could act. Not a defect.
- **Replacing CREPE-tiny**: SwiftF0 ties overall but −0.17 in the mid band and worse under
  degradation (its published robustness win does not reproduce here); HarmoF0's 27.5–4371 Hz range is
  unusable (sub-octave from ~1.2 kHz). `TRAJECTORY_MODEL_CEILING_HZ = 1900` is empirically correct
  (CREPE accurate to 1976 Hz, halves at 2094). Our Viterbi decode is worth +0.010 RPA and halves
  octave errors — keep it. SwiftF0 remains a **cost/ops** option only (5.6× cheaper CPU, would delete
  the CREPE sidecar; ~3–5 days via a new `ModelBackend` method + `onnxruntime-node`).
- **The global-config note HMM** (`note-segmenter.ts`, kept off the shipping path): every config
  significantly worse (−0.06…−0.16 *); it wins only on vocadito, which is at its human ceiling. Its
  merges eat *substantive* notes (median 0.368 s, 3× as many as shipped), not ornaments.
- Older: noise-adapt actions + `afftdn` (neutral-to-negative), Viterbi jump floor (noise),
  tuning-offset correction (hurts — truth is absolute A=440), glide-note dropping by shape (eats real
  passing tones), median-IOI tempo (worse than fixed 120).
- **Tempo estimation entirely — a product decision, not a dead end**: the user records against a
  metronome at a tempo they chose; that tempo is authoritative. Do not re-add an estimator. (The
  measured stakes, kept as motivation for keeping the click honest: fixed-120 scores 0.245
  onset-beat F1 where the true tempo scores 0.714.)

### Open items

Decisions for the team:
- **Model-weight provenance**: CREPE-tiny (shipping) was trained partly on NC-licensed data
  (MDB-stem-synth CC-BY-NC; RWC research licence) — same class of exposure as the rejected RMVPE.
  If ever forced, the remedy is a retrain, not a swap. Decide deliberately.
- **Whistling has zero real test data** (no note-annotated whistling corpus exists anywhere; Belyk is
  CC0 but f0-only and download-gated). The `very-high`/basic-pitch path is validated on synthetic
  audio only — the real corpus's highest note is MIDI 84 and 99.5 % of frames sit below 700 Hz.
  Closing this means **recording and annotating our own clips**.
- A browser-level `/verify` pass of the recording flow before shipping the `RecordingEngine` changes
  (all three review-found bugs lived in the one path without end-to-end coverage).
- A 2AFC human panel remains the right tiebreaker for close segmentation calls (F1 vs repair-time).

Research directions (in expected-value order):
1. **A learned note model for singing** — the N20EMv2 yardstick says supervised note models reach
   ~0.80 COnP@50 ms where we reach 0.49@100 ms zero-shot; post-processing cannot close that.
2. **Density/vibrato-adaptive change cost** for the note HMM (the measured diagnosis of why one
   global config cannot serve both sustained vibrato and fast humming).
3. **Reverb front end that preserves harmonics** (oracle: +0.14/+0.23 still on the table).
4. **Whistle-specific FFT peak tracker** (whistling is near-sinusoidal; blocked on real whistle audio).
5. MV2H metre+value integration for publication-comparable notation numbers; MRSSing corpus
   (CC-BY 4.0, verify annotation granularity + a paper/card licence mismatch first).
