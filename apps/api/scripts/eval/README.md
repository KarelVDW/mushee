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

## Start here

| Read | For |
|---|---|
| **[`benchmarks/README.md`](benchmarks/README.md)** | **The product benchmark** — one command per material (singing, humming, whistling, instruments), committed results, paired comparison between runs. `benchmarks/RESULTS.md` has the current numbers and the history. |
| [`CORPORA.md`](CORPORA.md) | The corpus register: which datasets may gate a decision, which are context only, the gaps, and everything researched and rejected. |
| [`FINDINGS.md`](FINDINGS.md) | The findings log — every experiment ever run here, what shipped (with CIs), the ~40 measured dead ends nobody should redo, the open items. |
| [`RESEARCH-STATUS.md`](RESEARCH-STATUS.md) | Research → implementation status: for every proposal in the research documents, whether it shipped, was built and measured null, was discarded, or was never pursued — and what is left, ranked. |
| `research/` | The eight standing research documents (state of the art, datasets, rhythm, DAW products, plugin source code, whistling). Kept as the record of the reasoning; `RESEARCH-STATUS.md` says where they are stale. |

Folder layout: harness core, sweeps, probes and gates at this level; corpus
fetchers and the annotation chain in `fetch/`; research documents in
`research/`; the committed benchmark results in `benchmarks/`; hand-corrected
label files in `annotations/`.

## Prerequisites

- **fluidsynth** on PATH (`brew install fluid-synth`) — renders instrument
  clips for the synthetic corpus.
- **Soundfont**: `fetch/fetch-soundfont.sh` downloads `assets/FluidR3_GM.sf2`
  (~150 MB, gitignored).
- ffmpeg comes from the app's own `ffmpeg-static` dependency; nothing to install.

## Corpus layout

- `scripts/fixtures/eval/` — **synthetic** corpus, built by `generate.ts`:
  one clean clip plus degraded variants per (scenario × melody), each with
  `<melody>.truth.json`.
- `scripts/fixtures/eval-real/<tier>/<dataset>/` — **real** recorded corpora
  (singing *and* monophonic instruments), built by the `fetch-*.ts` scripts:
  `<clip>__real.wav` + `<clip>.truth.json` + `dataset.json` manifest.
  `fetch/degrade-real.ts` adds `<clip>__<condition>.wav` variants for the adverse
  conditions — real performances under synthetic wind/reverb/babble are the most
  honest robustness measure we have.

  The tier is the corpus's standing, visible in the tree (see **`CORPORA.md`**,
  the register, and `lib/realCorpus.ts` for the discovery rules):
  - `benchmark/` — trusted truth, real human performance, permissive licence;
    these numbers may gate decisions.
  - `context/` — kept for realism/register coverage (mir-qbsh, the TinySOL
    splices, the unverified whistling); reported, never pooled, never gates.

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

Plus the **intonation tier** (`intonation-0c` … `intonation-80c`, R20): the
performer's error rather than the room's — every note detuned by exactly N
cents with a random sign, clean acoustics, applied at the synthesizer for the
articulated voice scenarios only. Ground truth stays the written notes; the
applied per-note detunes are recorded in `<melody>__<condition>.detune.json`.
This is the ground truth for tuning-offset / spelling / key experiments
(plan tasks E2/E6/E8).

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

### Voice-routing kill-switches

`RECORDING_VOICE_DECODE` (1; `0` sends singing back through the shared
semitone-run segmenter). Two jobs: it is production's rollback for the voice
decode without a deploy, and it is the only clean A/B of that decode over the
whole pipeline — `EVAL_NO_HINT` also strips the frequency-window hint, so it
cannot isolate the routing change. `lib/decodeCached.ts` honours it too, so an
A/B works off an already-built track cache (where `isVoice` is baked into the
stored profile) without a rebuild.

`RECORDING_SOURCE_CLASSIFY` (1; `0` disables the stock-YAMNet voice/instrument
source classifier and reverts routing to the score-instrument prior). In the
harness the classifier is inert by construction — every eval path passes an
explicit `sourceKind` per dataset — except under `EVAL_NO_HINT`, which is how
to exercise it end-to-end. `probe-source-classifier.ts` measures it directly
(98.7 % decided / 11.8 % abstain over the 1,148 labeled real clips).

## Scripts

### Harness core

| Script | Purpose |
|---|---|
| `types.ts`, `melodies.ts`, `scenarios.ts` | The evaluation matrix: register-agnostic melodies placed into scenario registers (whistle-high, voice-bass, trumpet-mid control, …). |
| `generate.ts` | Build the synthetic corpus (fluidsynth/direct synthesis + degradations). Idempotent. |
| `run-eval.ts` | Score the pipeline over a corpus (env-driven: `EVAL_REAL`, `EVAL_ADAPTIVE`, `EVAL_PROVIDER`, `EVAL_MIN_FREQ`, …) and print the full diagnostic report. The everyday tuning entry point; the scorer itself is `lib/evalRun.ts`. |
| `benchmark.ts` | **The product benchmark**: `run` scores the production path over every real corpus and records the result with its git provenance under `benchmarks/results/`; `compare` pairs two results with bootstrap CIs per material / dataset / condition; `render` regenerates `benchmarks/RESULTS.md`. See `benchmarks/README.md`. |
| `lib/evalRun.ts` | The corpus scorer shared by `run-eval.ts` and `benchmark.ts`: transcribe → score → aggregate per dataset, per condition and per **material** (`lib/realCorpus.ts` `Material`, from `dataset.json`). |
| `lib/` | Shared plumbing: synthesis (`synth.ts`, `midi.ts`, `wav.ts`), degradations (`degrade.ts`), scoring (`metrics.ts`, mir_eval-style, incl. COnPOff), corpus discovery (`groundTruth.ts`, `realCorpus.ts`), and `pipelineRun.ts` (drives the production `RecordingPipeline` end-to-end). |
| `lib/trackCache.ts` | Caches each clip's frame-level pitch trajectory (+ energy, onsets, resolved profile) to disk. Model inference dominates a corpus run, but everything worth tuning is downstream of it — so this turns a 40-minute experiment into a sub-second one. Bump `CACHE_VERSION` when the decoder, resolver or CREPE decode changes meaning. |
| `lib/stats.ts` | Paired-bootstrap confidence intervals, resampling **clips** (not notes) and pairing configs on the same clips. Also reports measured σ, ρ and the minimum detectable effect, so a null result can be told apart from an underpowered one. |
| `lib/split.ts` | Deterministic dev/test split drawn over **performer/piece groups**, not clips — one Annotated-VocalSet singer has dozens of clips, so a per-clip split puts the same voice in both halves. Tune on `dev`, confirm on `test` once. |
| `lib/notation.ts` | Notation metrics **in beats**: onset-in-beats F1 (with the metrical scale searched and reported, so half/double-tempo errors surface), note-value accuracy, and reference-free readability counters. Needed because seconds-based F1 rewards *not* quantising — see the Findings log below. |

### Real-corpus fetchers (`fetch/`)

Each fetcher writes into its corpus's tier (`CORPORA.md`) and records licence,
provenance and caveats in the dataset's `dataset.json`, including its
`material` (`singing` / `humming` / `whistling` / `instrument` /
`vocal-percussion`) — the axis the benchmark groups by.

| Script | Purpose |
|---|---|
| `fetch/fetch-vocadito.ts` | vocadito (ISMIR 2021) — real solo singing. |
| `fetch/fetch-mir-qbsh.ts` | MIR-QBSH — low-fi sung/hummed queries (8 kHz). |
| `fetch/fetch-annotated-vocalset.ts` | Annotated-VocalSet — studio-quality professional singing. |
| `fetch/fetch-urmp.ts` | URMP (CC0) — 48 isolated **orchestral instrument** tracks (13 instruments: strings, winds, brass), 15 s each, one `urmp-<instrument>` dataset per instrument. Range-fetches only the bytes it needs (~100 MB, not the 12 GB Dryad tarball). |
| `fetch/fetch-guitarset.ts` | GuitarSet (CC-BY) — 50 **acoustic guitar** solo excerpts, 15 s each, mono mic (`GUITARSET_AUDIO=pickup` for the DI mix). Strummed `_comp` excerpts are excluded as polyphonic. |
| `fetch/fetch-n20emv2.ts` | N20EMv2 (CC BY-SA) — 120 solo-singing excerpts, 15 s each, 10 subjects, **expert-corrected note annotations** (Melodyne draft + two music experts) and the harness's only **external yardstick**: the corpus publishes COnPOff 73.06 / COnP 79.56 / COn 93.66 at 50 cents / 50 ms. Its own train/valid/test split is preserved as two datasets, `n20emv2` (102, tunable) and `n20emv2-test` (18, confirm-only). Range-fetches *inside* the record's ten zips (~180 MB, not the 11.5 GB record); `N20EMV2_TARGET` sets the subset size. |
| `fetch/fetch-esmuc.ts` | ESMUC Choir Dataset (CC-BY-4.0) — 271 per-singer choral stems (~4.8 h), **manually corrected per-singer note truth**, 13 conservatoire singers. Real mic bleed (simultaneous recording) — a genuine adverse condition, kept as its own dataset. |
| `fetch/fetch-csd.ts` | Choral Singing Dataset (CC-BY-4.0) — 96×30 s per-singer stem excerpts, Tony-extracted + **hand-corrected** notes. ⚠️ truth is per SECTION (4 unison singers share one note file) and stems carry bleed. |
| `fetch/fetch-hust-solfege.ts` | HUST_Solfege (MIT) — 73 real solo solfège recordings (amateur incl. juvenile voices, ~44 min, 3.7k notes). Offsets in the source are synthetic → durations derived from inter-onset gaps; the pitch column's ~+19.8 st convention is calibrated per file against the audio. See research/research-voice-datasets.md §1d. |
| `fetch/fetch-dagstuhl.ts` | Dagstuhl ChoirSet (CC-BY-4.0) — 102×30 s quartet singer-stem excerpts. **The harness's only real tempo on singing**: 20 hand-tapped, second-annotator-reviewed beat/measure grids, emitted as `GroundTruth.beatGrid` (63–91 BPM, genuinely expressive) so `notation-eval.ts` can score notated rhythm on a *voice* corpus for the first time. Its NOTE truth is a 70 ms-MAE DTW score alignment → `noteTruthDerived`, never pooled. Mic bleed throughout. See research/research-voice-datasets.md §5l. |
| `fetch/fetch-avp.ts` | AVP (CC-BY-4.0) — 280 clips / 9.8k **human-labelled onsets** on real amateur vocal percussion (kick/snare/hihat imitations). `pitchless`: no pitch exists anywhere in the chain, so it scores the `OnsetDetector` in isolation via COn. See research/research-voice-datasets.md §5a. |
| `fetch/fetch-jacrc.ts` | JaCRC students (CC-BY-4.0) — 175×30 s excerpts / 5.2k **manual syllable onsets** from 25 amateur conservatory students singing jingju. `pitchless`. ⚠️ **read `onsetRecall`, not F1**: syllable onsets are a strict subset of note onsets on melismatic singing, so precision is understated by construction. Students-only folder (documented performer consent); the collection's professional/commercial rows are deliberately untouched. See research/research-voice-datasets.md §5l. |
| `fetch/fetch-whistle-real.ts` | **The only real whistling the harness has.** Stages permissively-licensed whistling audio for annotation: `whistle-real` = 112 Freesound CC0 clips (screened from 537 candidates) + 5 Wikimedia Commons clips (PD / CC BY-SA) = 18.3 min; `whistle-vintage` = 6×30 s excerpts of public-domain art-whistling 78s (Alice J. Shaw, Frank Stafford), accompanied and noisy by nature. Verifies each file's licence live against the source's API, then applies a metadata gate (must be *described* as whistling; vetoes tin/slide whistles, synths, animals, machines) and an acoustic screen (`whistleScreen`) — both needed, see the findings log. Needs a Freesound key in `FREESOUND_TOKEN` or `scripts/eval/.freesound-token` (gitignored) for the CC0 sweep; `FREESOUND_MAX` sets how many candidates to screen; `WHISTLE_LOCAL_DIR` ingests our own takes; `WHISTLE_INCLUDE_ENCUMBERED=1` adds clips whose *composition* is still in copyright. See research/research-whistle-corpus.md. |
| `fetch/draft-note-labels.ts` | Draft note labels for staged audio via `lib/sineTrack.ts` (framewise FFT peak → semitone runs; deliberately NOT our model family), written as Audacity label TSVs under `annotations/` — **tracked**, because a corrected label file is the one artefact nobody can regenerate. Never overwrites an existing TSV without `--force`. |
| `fetch/import-note-labels.ts` | Hand-corrected label TSVs → a scoreable dataset. Enforces the provenance rule: while any clip's `.meta.json` still says `verifiedBy: null`, the dataset is written `noteTruthDerived` and stays out of every pooled number. `--verified-by="<name>"` stamps a reviewed set — and the dataset's TIER follows: unverified drafts land in `eval-real/context/`, a fully verified set is promoted to `eval-real/benchmark/` automatically. |
| `fetch/fetch-tinysol.ts` | TinySOL (CC-BY-4.0) — the harness's **only real audio in the `very-high` band**. Splices Ircam single notes into 8-note clips: 64 clips / 512 notes over flute/oboe/clarinet/violin/viola/accordion × 2 bands × 3 dynamics × {legato, detached}. Truth is exact by construction and the performance is not human, so the datasets declare `constructedPerformance` and are reported but never pooled. |
| `fetch/fetch-soundfont.sh` | FluidR3_GM soundfont for `generate.ts`. |
| `fetch/degrade-real.ts` | Adverse-condition variants of the fetched real clips (run after the fetchers). |

A corpus that ships its OWN train/test split gets **two dataset dirs**, so their
test material can never leak into a sweep: `n20emv2` is tunable, `n20emv2-test`
is confirm-only (`SWEEP_EXCLUDE=n20emv2-test`, and it is the half the published
numbers refer to). `lib/split.ts` groups n20emv2 by subject (`sub<NN>_…`), so
the harness's own dev/test split never puts one singer on both sides there either.

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
| `notation-eval.ts` | **Score the NOTATION, in beats.** Quantises the cached notes at the annotated tempo (or a hand-tapped beat grid where a corpus has one) and scores onset-in-beats F1 (phase-locked and scale-searched), note-value accuracy and readability counters on every corpus — a metric that cannot be gamed by refusing to quantise. Also carries the `lag=50/100/200 ms` capture-latency probe rows. Use this for anything rhythm-related. |
| `ablate.ts` | Stage-by-stage loss decomposition from the raw trajectory to the notated score, **with oracle upper bounds**, so effort goes where headroom actually exists. |
| `sweep-segmenter.ts` | Config sweep over the cached corpus with paired-bootstrap CIs, reported **per dataset** plus mean/F2/worst. `SWEEP_STAGE`, `SWEEP_ONLY`, `SWEEP_BASELINE`, `SWEEP_EXCLUDE`. |
| `sweep-voice.ts` | **The voice flow's harness.** Scores two slices at once — VOICE (annotated-vocalset, N20EMv2, vocadito) is what a change targets, GUARD (every instrument corpus) is what it must not break — and reports where the loss is, not just how big: COn beside COnP (boundary vs pitch), Molina split/merged/missed, and **re-onset/transition recall**. `VOICE_EXP=<groups>`, `VOICE_ONLY=substr`, `VOICE_GUARD=0`. |
| `inspect-clip.ts` | One clip in full: ground truth, an ASCII pitch contour, and every stage's output. Sweeps say which config wins; this says why — and it is what found the bugs. |
| `bench-external-notes.ts` | Score an EXTERNAL system's per-clip note JSONs under the harness's conventions — the §10d gate for "should we acquire a learned model". `EXT_DIR=<dir> EVAL_SPLIT=test`. |
| `bench-yong-runner.py` | The runner half for Yong-2023 (ICASSP 2023, MIT checkpoint): batch inference into the JSON format above. Setup + measured verdict in its header. |
| `bench-onset-detector.ts` | **The re-attack detector in isolation** on real human-placed onsets — AVP (vocal percussion) and JaCRC (syllable onsets), from the cached 10 ms envelope, at the shipping constants and over a small grid. The isolated onset benchmark `run-eval` cannot give (its path emits onsets only where CREPE finds a note); `ONSET_TOL`, `ONSET_DATASETS`, `EVAL_SPLIT`. |
| `probe-source-classifier.ts` | Measures the stock-YAMNet voice/instrument classifier over every labeled real clip: forced-choice accuracy and the abstain-band trade table. |
| `sweep-bands.ts` | Does any gated feature want a PER-BAND (`PROFILE_BANDS`) setting? Paired Δ vs the production config within band × path strata over the cached corpus; `BAND_STRATA=band-rev\|ds-band` swaps in the confound strata (reverb flag / dataset) that decide whether an apparent band effect is real. |

## Pruning log

- 2026-09-01: the folder was tiered — research documents to `research/`, fetchers
  and the annotation chain to `fetch/`, the findings logs out of this file into
  `FINDINGS.md` (the anchors moved with them), the product benchmark into
  `benchmarks/`. Deleted: `probe-provider-routing.ts` (its census answered the
  provider question; basic-pitch is gone), `bench-take-key.ts` (E8's verdict is in
  the findings log; the estimator and `research/design-take-key.md` stay for a
  future attempt with a real abstain bar), `plan-plugin-improvements.md` (all 19
  tasks executed 2026-08-19; the record is the findings log, the untaken ideas are
  in `RESEARCH-STATUS.md`). Fixed on the way: `sweep-voice.ts` / `sweep-segmenter.ts`
  had let the `pitchless` corpora (avp, jacrc-students) into the VOICE slice since
  2026-08-13 — see the 2026-09-01 findings entry for what that did to the aggregates.
- 2026-08-22: deleted `bench-crepe-pitchdown.ts`, `bench-default-provider.ts` and
  `bench-contour-pitch.ts` with the basic-pitch provider they measured against — their
  questions are answered and acted on (the octave-down CREPE wrapper ships for the `very-high`
  band and the trajectory default replaced the fallback; see the 2026-08-20/22
  provider-consolidation entries below, which remain the durable record of every number). The
  E2 contour-head verdict ("not worth the wire", plus the one-bin `pitchBends` offset any
  consumer of the TS port must know about) is preserved in its findings entry.
- 2026-07-08: deleted `tempo-experiment.ts` — both of its questions are answered
  and acted on (tempo adoption shipped in `7a4ab0f`; the round-trip-loss
  measurement lives on in `diagnose-real.ts`).
- Earlier: `brainstorm-workflow.js` / `tuning-workflow.js` deleted as orphaned
  one-offs (see git history of `meta/structure-report.md`).


