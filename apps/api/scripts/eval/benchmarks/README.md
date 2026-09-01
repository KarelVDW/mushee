# The product benchmark

One command, one number per thing a user can do at the microphone — **sing, hum,
whistle, play an instrument** — measured on real recordings through the exact
production path, recorded with its provenance, and comparable across time with
confidence intervals. `RESULTS.md` (generated) holds the current numbers and the
history; this file says how to run it and how to read it.

```sh
cd apps/api
# the full benchmark: every real corpus, `real` + all adverse conditions (~1–2 h, CPU)
pnpm exec tsx scripts/eval/benchmark.ts run --label <what-changed>
# quicker: real recordings only (~30–40 min)
pnpm exec tsx scripts/eval/benchmark.ts run --quick --label <what-changed>
# did a change help? paired per-clip intervals between two recorded runs
pnpm exec tsx scripts/eval/benchmark.ts compare <a> <b> [--split test]
# regenerate RESULTS.md from the committed results
pnpm exec tsx scripts/eval/benchmark.ts render
```

`<a>`/`<b>` accept a path, a result id, or any unique substring of one (the git
sha, the label). Prerequisite: the real corpus is fetched
(`fetch-*.ts`, see `../README.md`), and — for the adverse conditions —
`degrade-real.ts` has produced variants.

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
5. Commit the two result files with the change. `RESULTS.md` regenerates
   itself; its history table is the release-to-release record.

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

| column | meaning | read it as |
|---|---|---|
| **COnP** | note F1 with the onset within **±100 ms** and the **exact MIDI pitch**; no offset gate. Mean of per-clip F1 within a dataset; the material / overall lines are means of **dataset means**, so a 400-clip corpus does not drown a 40-clip one. | the headline. ±100 ms is deliberate (the human-preference tolerance in the only large study of AMT metrics); it is **not comparable to published COnPOff** figures |
| **COnPOff** | as COnP, plus the offset within max(50 ms, 20 % of the reference duration) — mir_eval's defaults, at our onset window | the secondary, duration-aware number, and the one to set beside a published figure at a matching window (N20EMv2 publishes 73.06 at 50 ms) |
| **COn** / **COn recall** | onset-only F1 / recall, pitch ignored | boundaries vs pitch; the only meaningful columns for `pitchless` corpora; for `jacrc-students` read recall only (syllable onsets ⊂ note onsets) |
| **octErr** | fraction of reference notes matched at the right pitch class but the wrong octave | ~0.00 everywhere on this pipeline — a non-problem, do not build for it |
| **split / merged / missed / spurious** per 100 reference notes | Molina's segmentation taxonomy | *how* a dataset is wrong. Missed is the expensive one |
| **repair s/100** | estimated expert editing time per 100 notes (3.2 s split, 5.6 s merge, 145 s missed, 3.5 s spurious) | the product-relevant weighting: a missed note costs ~40× a spurious one, so two equal F1s can be very different products |
| **pooled** | whether the dataset enters any aggregate | `no` rows are reported for information and must never gate a decision |

The **vocal-percussion** row (AVP) is scored through the product path like every
other row, and the product path finds no pitched notes in beatboxing — so its
COn stays low and that is the honest product answer. The re-attack detector's
own precision/recall on those 9.8k human onsets (≈0.65 F1 at ±50 ms) is a
component benchmark, measured by `../bench-onset-detector.ts`.

Materials come from each corpus's `dataset.json` (`material`), falling back to
its `kind`. **Humming** currently has no benchmark-grade corpus: the only hummed
audio (`mir-qbsh`) is context-only (derived truth, research licence), so the
humming row reads "no benchmark-grade data" honestly rather than borrowing a
singing number. The gap register in `../CORPORA.md` tracks what would close it.

## Which corpora count

`../CORPORA.md` is the register. Two tiers, visible in the fixture tree:

- **benchmark/** — human or expert truth on at least one axis, a real human
  performance, a permissive licence. These rows pool.
- **context/** — derived or unverified truth (`noteTruthDerived`), constructed
  performances (`constructedPerformance`: real timbre, spliced phrasing), or
  onset-only truth (`pitchless`). Reported, never pooled, never a gate. The
  tier is documentation; the flags are the mechanism.

Adverse conditions (`echoey-room`, `distant-mic`, `wind-outdoor`,
`street-noise`) are synthetic degradations of the real performances, applied by
`degrade-real.ts` — honest robustness measures, but modelled rooms, not recorded
ones (measured RIR / noise corpora are cleared but unwired; see CORPORA.md).
They pool into the headline together with `real`; the per-condition table
separates them.

## Statistics

`compare` uses `lib/stats.ts`: a paired bootstrap over **clips** (not notes —
notes in one take share a singer, a room and a register and fail together),
with one index draw per replicate shared by both configs so between-clip
variance cancels. It also prints σ, ρ, n and the minimum detectable effect, so
an underpowered null cannot pass as a real one. The dev/test split
(`lib/split.ts`) is drawn over **performers**, not clips, so a voice never sits
on both sides.

## Files

- `results/<UTC timestamp>_<sha>_<label>.json` — one per run, committed. Compact:
  provenance, per-material / per-dataset / per-condition aggregates, and one line
  per clip × condition (F1, COnPOff, P, R, COn) — enough to pair against any later
  run. ~200 KB.
- `RESULTS.md` — generated: the latest run in full, then every run as one history
  row. Never edit by hand.
- The everyday tuning tools live one level up (`../README.md`); the findings
  log (`../FINDINGS.md`) is the durable record of every experiment, including
  the ~40 measured dead ends nobody should redo.
