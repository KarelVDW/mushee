# The product benchmark

One command, one number per thing a user can do at the microphone — **sing, hum,
whistle, play an instrument** — measured on real recordings through the exact
production path, recorded with its provenance, and comparable across time with
confidence intervals. `RESULTS.md` (generated) holds the current numbers and the
history; this file says how to run it and how to read it.

```sh
cd apps/api
# the full benchmark: every real corpus, `real` + all adverse conditions
# (2.3 h measured on 2026-09-01, before HumTrans's 1,538 clips were added — expect more)
pnpm exec tsx scripts/eval/benchmark.ts run --label <what-changed>
# real recordings only (2.8–3.4 h; 1,538 of its 3,442 clips are the HumTrans context sets)
pnpm exec tsx scripts/eval/benchmark.ts run --quick --label <what-changed>
# a subset, e.g. to smoke-test the harness (seconds per dataset)
pnpm exec tsx scripts/eval/benchmark.ts run --quick --datasets urmp-flute,vocadito --label <what>
# did a change help? paired per-clip intervals between two recorded runs
pnpm exec tsx scripts/eval/benchmark.ts compare <a> <b> [--split test]
# the truth changed after a run: score its cached notes again (seconds, no model)
pnpm exec tsx scripts/eval/benchmark.ts rescore <result> [--label <new-label>]
# regenerate RESULTS.md from the committed results
pnpm exec tsx scripts/eval/benchmark.ts render
# the realistic synthetic corpus: add --synth to any command (≈ 23 min per condition)
pnpm exec tsx scripts/eval/benchmark.ts run --synth --conditions noisy-phone --label <what-changed>
```

`pnpm eval:benchmark <command> …` is the same entry point. `<a>`/`<b>` accept a
path, a result id, or any unique substring of one (the git sha, the label).
Prerequisite: the real corpus is fetched (`fetch-*.ts`, see `../README.md`),
and — for the adverse conditions — `degrade-real.ts` has produced variants.
Clips run one after another in one process (about 3 s per clip × condition);
the recorded synthetic runs got their parallelism from one process per
condition.

## The workflow

1. **Before touching the pipeline**, record the baseline on a clean tree:
   `benchmark.ts run --label before-<change>`.
2. Make the change. Tune on `EVAL_SPLIT=dev` with the cached sweeps
   (`sweep-voice.ts`, `sweep-segmenter.ts`, `sweep-reverb.ts`) — they run in
   seconds because model inference is cached. The benchmark is not a tuning tool.
3. **After**, `benchmark.ts run --label after-<change>`, then
   `benchmark.ts compare before-<change> after-<change> --split test`.
4. A change is a result only when the paired 95 % interval excludes zero on the
   `test` half (the dev half was looked at while tuning). Below one point,
   nothing is a result even when significant: per-clip σ is 0.2–0.3 and the
   minimum detectable effect on the full corpus is ~0.01.
5. Commit the two result files (`apps/eval/data/benchmarks/real/`) with the
   change. `RESULTS.md` regenerates itself; its history table is the
   release-to-release record.

`compare` reports Δ per material, per dataset and per condition, so a change
that helps singing and hurts instruments is visible as such — a routing-gated
change (voice-only, whistle-only) must show **exactly zero** on the materials it
does not route to, which is the strongest evidence it is what it claims.

## What is measured

The scorer is `lib/evalRun.ts` running the **production path**: coarse pitch
scan → profile resolution (register band, provider, gates, voice/instrument
routing, reverb relief) → CREPE inference → note decode → cleanup → onset
snapping to the 16th grid — everything the server does to a take except the
MusicXML measure build. It is the same path `EVAL_REAL=1 EVAL_ADAPTIVE=1
run-eval.ts` scores; the benchmark adds grouping, provenance and comparison.

Each dataset carries an explicit `sourceKind` and instrument hint, as the app
does (the score's instrument and, since 2026-08, the YAMNet source classifier).
The benchmark therefore measures the pipeline given a correct source
declaration; the classifier's own accuracy is measured separately
(`probe-source-classifier.ts`, 98.7 % decided).

## How to read the columns

| column                                                         | meaning                                                                                                                                                                                                                                       | read it as                                                                                                                                                         |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **COnP**                                                       | note F1 with the onset within **±100 ms** and the **exact MIDI pitch**; no offset gate. Mean of per-clip F1 within a dataset; the material / overall lines are means of **dataset means**, so a 400-clip corpus does not drown a 40-clip one. | the headline. ±100 ms is deliberate (the human-preference tolerance in the only large study of AMT metrics); it is **not comparable to published COnPOff** figures |
| **human-truth COnP**                                           | the headline over the pooled datasets whose `truth` is `human` only                                                                                                                                                                           | the number continuous with every run before resynthesised truth existed; until a `resynth` dataset pools, it equals the headline                                   |
| **truth**                                                      | where the dataset's note truth came from (`truthSource`, below)                                                                                                                                                                               | `derived`, `constructed` and `onsets` rows never pool; `resynth` rows pool once calibrated                                                                         |
| **COnPOff**                                                    | as COnP, plus the offset within max(50 ms, 20 % of the reference duration) — mir_eval's defaults, at our onset window                                                                                                                         | the secondary, duration-aware number, and the one to set beside a published figure at a matching window (N20EMv2 publishes 73.06 at 50 ms)                         |
| **COn** / **COn recall**                                       | onset-only F1 / recall, pitch ignored                                                                                                                                                                                                         | boundaries vs pitch; the only meaningful columns for `pitchless` corpora; for `jacrc-students` read recall only (syllable onsets ⊂ note onsets)                    |
| **octErr**                                                     | fraction of reference notes matched at the right pitch class but the wrong octave                                                                                                                                                             | ~0.00 everywhere on this pipeline — a non-problem, do not build for it                                                                                             |
| **split / merged / missed / spurious** per 100 reference notes | Molina's segmentation taxonomy                                                                                                                                                                                                                | _how_ a dataset is wrong. Missed is the expensive one                                                                                                              |
| **repair s/100**                                               | estimated expert editing time per 100 notes (3.2 s split, 5.6 s merge, 145 s missed, 3.5 s spurious)                                                                                                                                          | the product-relevant weighting: a missed note costs ~40× a spurious one, so two equal F1s can be very different products                                           |
| **pooled**                                                     | whether the dataset enters any aggregate                                                                                                                                                                                                      | `no` rows are reported for information and must never gate a decision                                                                                              |

The **vocal-percussion** row (AVP) is scored through the product path like every
other row, and the product path finds no pitched notes in beatboxing — so its
COn stays low and that is the honest product answer. The re-attack detector's
own precision/recall on those 9.8k human onsets (≈0.65 F1 at ±50 ms) is a
component benchmark, measured by `../bench-onset-detector.ts`.

Materials come from each corpus's `dataset.json` (`material`), falling back to
its `kind`. A material with **no benchmark-grade corpus** (humming and whistling
today) gets a **provisional row**, in italics: computed from the context-tier
datasets that carry pitched truth (derived, prescribed, or under a restricted
licence), listed in the row. It tracks the material across runs and never
enters the overall headline or gates a decision. Datasets whose licence permits
only our internal evaluation (`licenceRestricted`, e.g. HumTrans CC BY-NC) are
marked "⚠ internal eval only" in the dataset table — see `../CORPORA.md`,
"Licence standard". The gap register there tracks what would turn each
provisional row into a real one.

## Which corpora count

`../CORPORA.md` is the register. Two tiers, visible in the fixture tree:

- **benchmark/** — human or expert truth on at least one axis, a real human
  performance, a permissive licence. These rows pool.
- **context/** — derived or unverified truth (`noteTruthDerived`), constructed
  performances (`constructedPerformance`: real timbre, spliced phrasing), or
  onset-only truth (`pitchless`). Reported, never pooled, never a gate. The
  tier is documentation; the flags are the mechanism.

The mechanism is `isPooled()` in `../lib/realCorpus.ts`. A dataset pools when
its `dataset.json` sets none of `noteTruthDerived`, `pitchless`,
`constructedPerformance` and `licenceRestricted`, and does not opt out with
`"pooled": false` (whistle-vintage: accompanied 78 rpm transfers). Restricted
licences (NC, research-only) stay out whatever the quality of their truth.

Every dataset also carries a **truth source** (`truthSource` in `dataset.json`;
when absent it is inferred from the flags: `noteTruthDerived` → `derived`,
`constructedPerformance` → `constructed`, `pitchless` → `onsets`, the rendered
synthetic corpus → `constructed`, anything else → `human`):

| truthSource   | meaning                                                                                           | pools?                                                  |
| ------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `human`       | annotated by people (the corpus's own labels, or ours once verified)                              | yes, unless licence-restricted                          |
| `resynth`     | read from a synthetic copy iterated until it matches the original (`synthetic-corpus/RESYNTH.md`) | yes, once it passes the calibration gate                |
| `derived`     | machine-derived and unverified: frame pitch, score alignment, drafts                              | no                                                      |
| `constructed` | exact because we built the performance (TinySOL splices, the rendered corpora)                    | no (the synthetic corpus pools only in its own history) |
| `onsets`      | onset times only                                                                                  | no — read COn                                           |

The headline is therefore reported twice: over **all pooled datasets**, and
over the pooled datasets with **human** truth only. The second is the one
continuous with the history; the material rows add a human-only variant where
the two differ, and `compare` adds an `ALL (human truth)` row.

Adverse conditions (`echoey-room`, `distant-mic`, `wind-outdoor`,
`street-noise`) are synthetic degradations of the real performances, applied by
`degrade-real.ts` — honest robustness measures, but modelled rooms, not recorded
ones (measured RIR / noise corpora are cleared but unwired; see CORPORA.md).
They pool into the headline together with `real`; the per-condition table
separates them. This is why the benchmark headline (0.739 on the first
recorded run) sits below the findings log's historical clean-only figures
(0.760–0.782): those pooled the `real` condition alone over fewer datasets.
Compare benchmark runs only with each other, through `compare`.

## Statistics

`compare` uses `lib/stats.ts`: a paired bootstrap over **clips** (not notes —
notes in one take share a singer, a room and a register and fail together),
with one index draw per replicate shared by both configs so between-clip
variance cancels. It also prints σ, ρ, n and the minimum detectable effect, so
an underpowered null cannot pass as a real one. The dev/test split
(`lib/split.ts`) is drawn over **performers**, not clips, so a voice never sits
on both sides.

## The synthetic corpus (`--synth`)

`--synth` scores the realistic synthetic corpus (`fixtures/eval-synth`, exported
by `synthetic-corpus/`: every app instrument and eight voice types rendered from
real recordings, exact truth) instead of the real one. Its default conditions
are `studio`, `room`, `home-phone` and `noisy-phone` (`dry` is a diagnostic
reference: opt in with `--conditions dry`); `--synth --quick` runs
`home-phone` only. Its history is kept apart (`RESULTS-SYNTH.md`,
`apps/eval/data/benchmarks/synth/`) so the real trend line never mixes corpora.
Its headline is a mean over synthetic datasets; it has no human-truth variant.

## Files

- `apps/eval/data/benchmarks/real/<UTC timestamp>_<sha>_<label>.json` — one per
  run, committed, and read by the eval app. Compact: provenance,
  per-material / per-dataset / per-condition aggregates, and one line per
  clip × condition (F1, COnPOff, P, R, COn) — enough to pair against any later
  run. ~0.5 MB. Provenance (`meta`) since 2026-10-30 also records:
    - `env` — every pipeline / eval override set for the run (`RECORDING_*`,
      `ONSET_POLICY`, `EXTRACTOR_COLLAPSE_COINCIDENT`, `VOICE_ONSET_*`,
      `ONSET_DIP_RATIO`, `SUSTAINED_ONSET_REVERB_RAMP`, `EVAL_*`, `CREPE_*`);
      `{}` means the defaults.
    - `corpus` — per scored dataset: `truthSource`, `clips` and `truthHash` (sha1
      over its truth files), so a truth change is visible next to a number change;
      `corpusVersion` where the dataset declares one (the synthetic export).
    - `gitDirty` — the working tree differed from `gitSha` under `apps/api/src`
      or `scripts/eval`. Markdown, `annotations/` and the results do not count.
- `apps/eval/data/benchmarks/synth/` — the same for `--synth` runs, one file per
  condition. `synth/archive/v0-corpus/` and `v1-corpus/` hold the baselines
  scored on superseded corpus versions (before the v1.1 loop fix and source
  audit, 3b0604a7); `render` does not read them.
- `RESULTS.md` / `RESULTS-SYNTH.md` — generated: the latest run in full, then
  every run as one history row linking its file. Never edit by hand.
- `../.cache/notes/<result id>.jsonl` (gitignored) — the notes the pipeline
  produced in that run, one line per clip × condition:
  `{"d","c","cond","notes":[{"onsetSec","durSec","midi"}]}` (plus `error` when the
  clip failed and scored as zero). The eval app's comparison view reads them,
  and `rescore` scores them again against the current truth: the same corpus
  walk, `scoreClip` and `aggregateEval` as `run`, so on unchanged truth it
  reproduces the run exactly (checked on a fresh `urmp-flute` run, and on the
  37 datasets of `2026-10-31T06-12-44_d16420ef` whose truth had not changed:
  4,857 clip rows identical). It keeps the run's `gitSha`, `date`,
  `durationSec` and `env`, replaces `corpus` with the truth scored now, and
  adds `meta.rescoredAt` plus `meta.rescoredFrom` (`id`, and the fingerprints
  the run itself was scored against). Without `--label` it rewrites the result
  in place; with one, it writes a sibling `<timestamp>_<sha>_<label>` and copies
  the notes file to that id. A clip with no notes of its own takes the notes
  of a same-input twin: the same audio inode (a hard-linked dataset such as
  `jacrc-notes` → `jacrc-students`), the same hints and the same tempo. The twin
  must come from a dataset whose truth is unchanged since the run. Clips with
  neither are counted and left out, and so are notes whose truth is gone.
- The result schema and `compact()` are exported from `benchmark.ts`; with
  `scoreClip()` and `aggregateEval()` from `../lib/evalRun.ts` a scorer of notes
  produced elsewhere (an older pipeline) writes results `render` and `compare`
  read. `EvalOptions.transcribe` and `clipFilter` swap the pipeline and narrow
  the clips inside `runEval` itself.
- The everyday tuning tools live one level up (`../README.md`); the findings
  log (`../FINDINGS.md`) is the durable record of every experiment, including
  the ~40 measured dead ends nobody should redo.
