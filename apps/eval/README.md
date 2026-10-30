# @mushee/eval — benchmark workbench

A local, read-only UI over the recording pipeline's benchmark (`apps/api/scripts/eval`):
the latest numbers, every run and run-vs-run comparisons, the score timeline over
historical commits, the test corpus, and a compare view that plays each original
recording against its synthetic copy over the notes extracted from it.

```sh
pnpm dev:eval   # http://localhost:3600
```

No database, no auth and no deploy target. The pages are server components that read
JSON and audio straight from this checkout. Nothing in the app writes. Producing
benchmark runs, timeline points and resynth truth is the job of the harness scripts.

## What it reads

| Data                                            | Where                                                                                                                                                               | Tracked                      |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| Benchmark runs (one compact JSON per run)       | `apps/eval/data/benchmarks/real/`, `…/synth/`. `synth/archive/` holds superseded corpus versions and is not listed. Written by `apps/api/scripts/eval/benchmark.ts` | git                          |
| Score timeline                                  | `apps/eval/data/timeline/index.json` and `<commitDate>_<short>.json` (result schema). `timeline/run.ts` transcribes, `timeline/score.ts` writes these               | git                          |
| Timeline plan and build progress                | `apps/api/scripts/eval/timeline/commits.json` and `clipset.json`, plus `.cache/timeline/notes/<short>.summary.json`                                                 | plan: git; progress: ignored |
| Corpus: audio, truth, `dataset.json`            | `apps/api/scripts/fixtures/eval-real/{benchmark,context}/<ds>/` and `apps/api/scripts/fixtures/eval-synth/<ds>/`                                                    | ignored                      |
| Resynth output (copy, contours, replaced truth) | in the dataset directory: `<clip>__resynth.flac`, `<clip>.f0.json`, `<clip>.truth-derived.json`, `<clip>.truth-unresolved.json`                                     | ignored                      |
| Resynth verdicts                                | `apps/api/scripts/eval/annotations/resynth{,-calibration}/<ds>/<clip>.resynth.json`                                                                                 | git                          |
| Resynth work in progress                        | `synthetic-corpus/work/resynth/<ds>/<clip>/`: `state.json`, `spec.json`, `judge.json`, `report.json`, `panels/`, `synth.flac`                                       | ignored                      |
| Pipeline notes per clip (optional)              | `apps/api/scripts/eval/.cache/notes/<resultId>.jsonl` (benchmark runs) and `.cache/timeline/notes/<short>.jsonl` (historical commits)                               | ignored                      |

Every location is defined once, in `src/server/paths.ts`. A checkout from before the
2026-10-30 move still finds the benchmark results under
`apps/api/scripts/eval/benchmarks/results{,-synth}`. Set `EVAL_TIMELINE_DIR` to preview
a timeline that is being built somewhere else.

The readers tolerate missing data. The fields added on 2026-10-30 (per-dataset
`truthSource`, the human-only headline, `meta.env` and `meta.corpus`) are inferred or
left out for older result files. Any missing corpus, resynth, timeline or notes file
shows an empty state that names the command which produces it.

## Pages

- **`/` Overview**: the latest real run's headline, computed twice (all pooled
  datasets, and human-truth datasets only), with one row per material showing the
  truth sources behind it and its provisional or context marks. Also the latest
  synthetic run, a timeline preview, datasets by truth source, and resynth progress.
- **`/timeline`**: COnP of the product `RecordingPipeline` at historical commits, on
  the test split of a fixed clip set. These numbers cannot be compared with the
  converter-level numbers in `RESULTS.md`. The page has one chart for the headline
  and small multiples per material on a shared y scale; hovering or the arrow keys
  show a commit's numbers, and a click opens the commit's per-dataset breakdown. It
  also has a table of every commit, and the sampled commits' build progress while the
  timeline is being built.
- **`/runs`** (tabs: real, synthetic, timeline commits) and **`/runs/[id]`**: one run
  broken down per material, per dataset (truth source, pooled, licence, segmentation
  errors), per condition, and its worst clips. Each worst clip links to its compare
  view with that run's notes overlaid.
- **`/compare?a=&b=`**: paired per-dataset bars with each dataset's change B − A,
  plus the paired change: per dataset, the mean of B − A over the clips (dataset,
  clip, condition) both runs scored; as a headline, the mean of those over the
  datasets both runs pooled, once over all of them and once over human truth only.
  A dataset whose truth source changed between the runs (derived → resynth) is shown
  but left out of the paired headline, with the reason; changed truth files under the
  same source are only flagged. Comparing a timeline commit with a benchmark run says
  so: their levels differ by construction. For confidence intervals, use
  `benchmark.ts compare`.
- **`/datasets`** (tabs: real, synthetic) and **`/datasets/[id]`**: tier, material,
  truth source, licence, pooling and resynth progress (passed, unresolved, in
  progress, pending). The clip list can be filtered by name and resynth status, and
  sorted by COnP or length.
- **`/datasets/[id]/[clip]`, the compare view**: A/B playback of the original against
  the synthetic copy on one shared playhead. Switching sides keeps the moment.
    - Copy source: the exported `__resynth.flac`, otherwise the loop's latest
      `synth.flac`. Synthetic-corpus datasets compare their conditions instead.
    - Keys: <kbd>Space</kbd> plays and pauses, <kbd>A</kbd> / <kbd>B</kbd> pick the
      side, <kbd>←</kbd> <kbd>→</kbd> seek 2 s (10 s with <kbd>⇧</kbd>),
      <kbd>[</kbd> <kbd>]</kbd> go to the previous or next clip, and <kbd>+</kbd>
      <kbd>−</kbd> zoom.
    - Piano roll layers (time × MIDI, zoomable, click to seek):
        - the copy's notes, with uncertain-flagged notes hatched and marked "?";
        - the truth they replace, or the human truth beside a calibration copy;
        - the pipeline's notes from any run or timeline commit whose notes are cached;
        - the original's and the copy's f0 contours;
        - the resynth report's open differences.
    - Side panel: the judge's verdict, the work state, the compare metrics, the
      comparison panels the judge sees, and this clip's score in every run.

## Code layout

| Path                        | What                                                                                                                                                                                                                                                                                 |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/server/`               | The data module. `EvalData` is the entry point; it uses `BenchmarkStore`/`BenchmarkRun`, `TimelineStore`, `Corpus`/`Dataset`, `ResynthStore`/`ResynthClip`, `PipelineNotes` (byte-indexed JSONL), `FileCache` (re-parse only on change), `WavInfo`, and `AudioResponse` (HTTP Range) |
| `src/lib/dto.ts`            | Every shape that crosses into client components and routes                                                                                                                                                                                                                           |
| `src/app/api/audio`         | `?ds&clip&src`: Range-aware WAV/FLAC (Safari needs Range to seek). Only serves files found by listing the dataset, so no request text is ever joined into a path                                                                                                                     |
| `src/app/api/notes`         | `?ds&clip&source`: one clip's cached pipeline notes                                                                                                                                                                                                                                  |
| `src/app/api/resynth-panel` | `?ds&clip&file`: one comparison panel PNG from the loop's work directory                                                                                                                                                                                                             |
| `src/lib/playback/ABPlayer` | Two `<audio>` elements playing in lockstep, only the selected one audible; the muted one is kept on the clock by a playback-rate nudge (not in WebKit, which stalls on rate changes)                                                                                                 |
| `src/lib/pianoRoll/`        | `PianoRollModel`: the roll's geometry                                                                                                                                                                                                                                                |

The UI follows `apps/web/DESIGN.md` and `apps/web/design/README.md` through the shared
`@mushee/ui` theme. Charts use only the two validated series colours (`chart-cyan`,
`chart-magenta`); anything with more series is drawn as small multiples.

## History

Until 2026-10-30 this app generated melodies, recorded them through the microphone
into new corpora, kept them in a Postgres `eval` schema, and transcribed takes with a
long-lived worker. We concluded that going from notes to recorded tracks is not the way
to get good test data (see `meta/test-data-2026-10.md`), so all of that was removed.
`apps/api/scripts/eval/transcribe-worker.ts` was its only client. Nothing drops the
leftover `eval` schema in the dev database; it is harmless.
