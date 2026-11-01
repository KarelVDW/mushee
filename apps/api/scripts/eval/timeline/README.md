# The benchmark-score timeline

How good was the transcription at each point in its history, measured with
**today's** scorer and **today's** truth? Sixteen sampled pipeline states
(`commits.json`) each transcribe the same fixed clip set (`clipset.json`) through
their own `RecordingPipeline`; the notes are cached per commit, and scoring is a
separate, seconds-long step that can be re-run whenever the truth improves. The
scored results are git-tracked JSON in `apps/eval/data/timeline/`, in the same
schema as the product benchmark's results (`../benchmark.ts` `BenchResult`).

```sh
cd apps/api
# 1. materialise the 14 pipelines (idempotent; ~20 s the first time, ~2 s after)
pnpm exec tsx scripts/eval/timeline/prepare.ts
# 2. transcribe the clip set with every commit (resumable; see "Runtime")
pnpm exec tsx scripts/eval/timeline/run.ts --commits all --parallel 3
# 3. score against the current truth → apps/eval/data/timeline/*.json + index.json
pnpm exec tsx scripts/eval/timeline/score.ts
# any two points, paired per clip (timeline files are benchmark results)
pnpm exec tsx scripts/eval/benchmark.ts compare ../eval/data/timeline/2026-08-19_ab26a103.json ../eval/data/timeline/2026-08-22_61f86a96.json
```

`run.ts` and `score.ts` take `--commits <short>,…` to work on a subset. After the
truth changes (resynth waves, the corpus reorganisation) only step 3 is re-run.

## Files

| what                                                   | where                                                                   | tracked |
| ------------------------------------------------------ | ----------------------------------------------------------------------- | ------- |
| sampled commits, with why each is in                   | `timeline/commits.json`                                                 | yes     |
| the clip set + its rule and counts                     | `timeline/clipset.json` (`clipset.ts` writes it, `--check` verifies it) | yes     |
| shared paths, notes format, **dataset alias table**    | `timeline/timeline.ts`                                                  | yes     |
| the era-adaptive worker (template)                     | `timeline/worker.ts` → `trees/<short>/apps/api/timeline-worker.ts`      | yes     |
| extracted trees, shared model dirs, the legacy install | `scripts/eval/.cache/timeline/{trees,models,legacy}/`                   | no      |
| per-commit notes, run summaries                        | `scripts/eval/.cache/timeline/notes/<short>.{jsonl,summary.json}`       | no      |
| scored results, one per commit; the index              | `apps/eval/data/timeline/<commit day>_<short>.json`, `index.json`       | yes     |

## How a historical commit runs

`prepare.ts` never checks anything out. Per commit it `git archive`s
`apps/api/src` (spec files dropped), the API's `package.json`/`tsconfig.json`
and `tsconfig.base.json` into `trees/<short>/`; links the model dirs to one
shared copy per distinct git tree (crepe-tiny's weights are byte-identical
from 04-26 to HEAD); and links `node_modules`:

- **after the basic-pitch deletion (458b3a05)**: HEAD's `apps/api/node_modules`.
- **before it**: one shared install in `legacy/`, made from the last lockfile that
  still had `@spotify/basic-pitch` (ec173e9c) with
  `pnpm install --frozen-lockfile --filter @mushee/api... --offline`. It falls back
  to an online `--prefer-offline` install only if that fails, and records which in
  `legacy/.prepared.json`. On 2026-10-30 it installed **offline** in 12 s.
  Dependency resolutions are identical from 2026-04-19 to HEAD (tfjs 4.22,
  ffmpeg-static 5.3.0), so the two installs differ only by basic-pitch.

Every `commits.json` field is checked against git first (sha, ancestry of
HEAD, date, subject, era by file layout, legacy deps by `package.json`).

The worker is found by file existence, four entry points:

| era | commits                      | layout                                      | pipeline                                                                                                           |
| --- | ---------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| A   | bb4d8165                     | `recordings/BasicPitchModelLoader.ts`       | `new RecordingPipeline(modelPromise)`, basic-pitch only                                                            |
| B   | bec075de                     | `recordings/AudioConverter.ts`              | `new RecordingPipeline(new AudioConverter(new BasicPitchProvider(…)))` — the code default (`PITCH_PROVIDER` unset) |
| C   | cf7d6173, 9771190d, eb323a97 | `recordings/providers/ProviderRegistry.ts`  | `new RecordingPipeline(registry, resolver)`                                                                        |
| D   | 15344df4 → f2611442 (9)      | `recordings/pipeline/recording-pipeline.ts` | the same, kebab-case paths                                                                                         |

Each clip goes through `setMeta({bpm, 4/4, transpose 0, instrumentId,
sourceKind})` → 12 × `appendChunk` → `finalize()`, as the eval app's former
`transcribe-worker.ts` (removed 2026-10) fed HEAD. The hints are the ones the benchmark gives the same dataset
(`evalRun.ts` `hintsFor`: `sourceKind` explicit, so YAMNet never decides);
eras that predate a key ignore it, exactly as the product did. HEAD turns the
returned measures into notes (`lib/pipelineRun.ts` `measuresToNotes`; the
MxmlMeasure shape and 0-based measure index are unchanged since bb4d8165).
The worker runs under `env -i` plus PATH, HOME, TMPDIR, `FFMPEG_BIN` (HEAD's
ffmpeg-static binary) and `RECORDINGS_DEBUG_DIR=/dev/null/off`: every knob any
era ever read is unset, i.e. at its shipped default, and the pre-2026-07 debug
bundle (a copy of the audio per take) cannot be written — the worker also
stubs `writeDebugBundle`.

## The clip set

536 clips, 187.0 min of audio, from 34 datasets (clip-set hash `ffae19cba3d4`; redrawn 2026-11-01 when
`lib/split.ts` regrouped whistle-real by uploader and the app takes by session):
every pitched real dataset in `fixtures/eval-real` (benchmark and context
tiers, including those whose truth is still being made), plus jacrc-students
(its audio gets note truth in jacrc-notes); minus the byte-identical
`-aligned` siblings and avp. The `real` recording only, the **test half only**
(`lib/split.ts`, performer-grouped), at most 40 clips per dataset in
sha1(`dataset/clip`) order. The cap keeps esmuc-choir (145 test minutes) from
dominating; it still contributes the most audio (39.7 min). `clipset.json`
lists the counts per dataset.

Clips are named by the dataset their AUDIO was in when the set was drawn.
Truth is looked up through `DATASET_ALIASES` in `timeline.ts` (an editable
table: `jacrc-students` → `jacrc-notes`, `humtrans-aligned` → `humtrans`,
`whistled-high-register-aligned` → `whistled-high-register`), the dataset
itself last; clips with no truth anywhere are skipped and counted. A clip
scored against a re-homed truth dataset keeps `split: "test"` — the selection
says which half it is in, not a re-hash under the new name.

## Runtime

Measured on 2026-10-30 (M-series, 10 cores / 6 performance, 16 GB; the
machine was otherwise busy, load average ≈ 10), on a 30-clip stratified sample
(10.2 min of audio). Worker time per second of audio (real-time factor):

| era                     | measured on        | RTF                          | per commit, full clip set, 1 worker |
| ----------------------- | ------------------ | ---------------------------- | ----------------------------------- |
| A, B (basic-pitch)      | bb4d8165, bec075de | 0.110                        | ≈ 20 min                            |
| C                       | cf7d6173           | 0.136                        | ≈ 25 min                            |
| D on the legacy install | ab26a103           | 0.166                        | ≈ 30 min                            |
| D on HEAD's deps        | f2611442           | 0.166 (1 worker) – 0.176 (3) | ≈ 31 min                            |

Throughput scales almost linearly with workers up to 5: the per-clip RTF moved
by under 7 % from 1 to 5 workers. Over the 14 commits (2 × A/B, 3 × C, 9 × D)
that is ≈ 6.5 h of worker time:

| `--parallel` | per commit                 | all 14 commits  |
| ------------ | -------------------------- | --------------- |
| 3            | 7 min (A/B) – 10.5 min (D) | **≈ 2.2 h**     |
| 5            | 4 min (A/B) – 6.5 min (D)  | **≈ 1.3–1.5 h** |

Clips run longest first, so the lanes finish together. Peak RSS per worker on
the longest clip (173 s): 1.2 GB for era A (basic-pitch), 0.5 GB for era D.
`--recycle 150` restarts each worker after 150 clips, costing about 2 s for the
model load. Treat the estimates as ±30 %: they come from one sample on a busy
machine.

## Robustness

- **Append-only, fsynced per line**: a sleep, a crash or Ctrl-C loses at most
  the clips in flight; a torn last line is skipped on read and redone.
- **Resumable per (commit, clip)**: re-running skips every clip already in
  the notes file; `--retry-errors` redoes the ones recorded with `err`. A later
  line supersedes an earlier one.
- **A worker crash or hang** (budget: 2 min + 8 × the clip's length) is killed
  and replaced, and the clip is recorded as `crash: …` / `timeout: …`. A
  worker that fails to start three times aborts that commit. A lock file stops
  two runs from writing one notes file.
- **Deterministic**: the same commit gives byte-identical notes across runs
  and across 1, 3 and 5 workers (checked on 30 clips × 2 commits).
- **No network** once `prepare.ts` has run.

## Reading the numbers — risks

1. **Not comparable to RESULTS.md.** This is the RecordingPipeline (chunked
   feed, profile lock, MusicXML round trip) on the test half of a capped clip
   set; the benchmark scores the converter-level path on every clip. Compare
   timeline points with each other. `score.ts` prints a calibration line for
   each commit that has a committed benchmark result at the same sha
   (2b83e008, d77db1db): the clip-mean offset and a paired interval on the
   shared clips. On the 5-clip smoke the timeline sat 0.03–0.04 COnP below the
   benchmark (ρ ≈ 0.93); the full run gives the real figure.
2. **Silent zeros.** Every era logs a failed pass as a warning and emits
   nothing, which scores 0. The worker captures the Nest logger: a swallowed
   failure ("Process pass failed", a decode that gives up) comes back as
   `err: pass: …`. A random-bytes WAV was flagged as such on nine commits
   covering all four eras. The run summary and each result's `meta.counts` report
   `pipelineErrors` and `emptyOutputs`. Pipeline failures score as given: they
   are what the product did. Harness failures (`crash`, `timeout`, `no audio`)
   block `score.ts` unless `--partial`. An empty output with no `err` is the
   pipeline's real answer. Example: whistling in eras A and B, where
   basic-pitch's 1100 Hz ceiling sits below the whistle register (MIDI 89–99).
3. **Tuning bias.** Thresholds since 2026-07 were tuned on the dev half, so
   the set is test-only. Even so, later commits had more chances to fit this
   corpus's style. At n ≈ 500 the minimum detectable effect is about 0.01
   COnP, so adjacent points closer than 0.01–0.015 are noise. Use
   `benchmark.ts compare`, which pairs clips.
4. **Truth moves under the history.** Scoring always uses the current truth,
   so a rescore after the resynth waves changes every point at once, which is
   the intent. `meta.truthHash` and `index.json`'s `sameTruth` show whether
   all points were scored against the same truth. The headline is given twice,
   as in the benchmark: over all pooled datasets, and over human truth only.
5. **Instrument hints follow history.** `guitar` only exists from 07-18 and
   `whistle` from 07-25, and the 08-08 source classifier only from its era.
   Before that, the pipeline does what it did then: a blind scan.
6. **Two controls.** ab26a103 should score about the same as 0b217b4f (the
   null-heavy plugin pass), and f2611442 about the same as d77db1db (the
   10-22 refactors). On the smoke, d77db1db and f2611442 gave identical notes
   on all 5 clips. bb4d8165 and bec075de also gave identical notes on all 35
   clips tried. That is expected, because B refactored A's basic-pitch path
   without changing its filters, thresholds or sample rate.
