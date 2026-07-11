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
- `scripts/fixtures/eval-real/<dataset>/` — **real** singing corpora, built by
  the `fetch-*.ts` scripts: `<clip>__real.wav` + `<clip>.truth.json` +
  `dataset.json` manifest. `degrade-real.ts` adds `<clip>__<condition>.wav`
  variants for the adverse conditions — real singing under synthetic
  wind/reverb/babble is the most honest robustness measure we have.

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
| `lib/` | Shared plumbing: synthesis (`synth.ts`, `midi.ts`, `wav.ts`), degradations (`degrade.ts`), scoring (`metrics.ts`, mir_eval-style), corpus discovery (`groundTruth.ts`, `realCorpus.ts`), and `pipelineRun.ts` (drives the production `RecordingPipeline` end-to-end). |

### Real-corpus fetchers

| Script | Purpose |
|---|---|
| `fetch-vocadito.ts` | vocadito (ISMIR 2021) — real solo singing. |
| `fetch-mir-qbsh.ts` | MIR-QBSH — low-fi sung/hummed queries (8 kHz). |
| `fetch-annotated-vocalset.ts` | Annotated-VocalSet — studio-quality professional singing. |
| `fetch-soundfont.sh` | FluidR3_GM soundfont for `generate.ts`. |
| `degrade-real.ts` | Adverse-condition variants of the fetched real clips (run after the fetchers). |

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
| `annotator-agreement.ts` | Inter-annotator F1 ceiling on vocadito — the honest upper bound for targets. |

## Pruning log

- 2026-07-08: deleted `tempo-experiment.ts` — both of its questions are answered
  and acted on (tempo adoption shipped in `7a4ab0f`; the round-trip-loss
  measurement lives on in `diagnose-real.ts`).
- Earlier: `brainstorm-workflow.js` / `tuning-workflow.js` deleted as orphaned
  one-offs (see git history of `meta/structure-report.md`).
