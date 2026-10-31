# Test data pass — 2026-10-30 (branch `test-data-2026-10`)

Karel's brief (2026-10-30):

1. Close out the previous test-data work.
2. Generate real note truth for every eval track that lacks it. The method: a synthetic copy
   of the track, an agent comparing copy and original, iterating until they match, and the
   notes then read deterministically from the copy.
3. Organise the tracks for easy benchmarking.
4. Rework apps/eval into a benchmark-only interface: no database, no corpus
   generation or recording, plus an original ↔ synthetic copy ↔ notes comparison view.
5. A benchmark score timeline over historical pipeline states, stored as git-tracked JSON
   inside apps/eval.

Run as an autonomous, multi-session job. It must survive the laptop going offline and stay
within session limits.

## Phases

| # | phase | status |
|---|---|---|
| 0 | Scoping (6 parallel readers: test-data status, truthless inventory, synth engine, harness, eval app, pipeline history) | done |
| 1 | Close out the previous test-data work (docs and small fixes; see "Close-out") | in progress |
| 2 | Build the `synthcorpus.resynth` tool (`synthetic-corpus/RESYNTH.md`) + perturbation self-test | in progress |
| 3 | Pilot: whistled-high-register (6) + calibration clips → cost per clip, prompt tuning | todo |
| 4 | Waves over every dataset that lacks truth (order below), gated on usage | todo |
| 5 | Organise datasets + harness truth-source/pooling + fresh HEAD benchmark | todo |
| 6 | apps/eval rework (benchmark-only, JSON data, compare view) | todo |
| 7 | Timeline: historical pipelines → per-commit notes cache → scored JSON in `apps/eval/data/timeline/` | todo |

## Scope: tracks that lack trustworthy note truth

| dataset | clips | min | prior for the draft | copy timbre | after |
|---|---|---|---|---|---|
| whistled-high-register (+ the byte-identical `-aligned`) | 6 | 1.1 | aligned truth | whistle | one dataset, benchmark tier (our own recordings) |
| mir-qbsh | 50 | 6.7 | pv-derived truth | voice `u` | context (licence-restricted) |
| whistle-real | 117 | 18.3 | sineTrack drafts | whistle | benchmark tier |
| dagstuhl-choir | 102 | 51.0 | DTW score alignment (the hand-tapped beatGrid is kept) | voice `a`, register by part | benchmark tier |
| jacrc-students → new `jacrc-notes` (hard links) | 175 | 85.3 | f0 segmentation + syllable onsets | voice `a` | `jacrc-students` keeps its human syllable onsets |
| whistle-vintage | 6 | 3.0 | sineTrack drafts | whistle | context (accompanied 78 rpm, never pooled) |
| humtrans (+ the byte-identical `-aligned`) | 769 | 183.2 | humtrans-aligned truth | voice `u` | context (CC BY-NC) |
| in-app dev takes (`apps/api/debug/recordings`, `storage/recordings`) | ≤ 310 | ≤ 65 | f0 segmentation, after triage | by material | a new dataset if melodic |

Out of scope:

- **avp**: beatboxing has no pitch; its human onsets are already its truth.
- **Datasets with human truth on at least one axis** (annotated-vocalset, csd, esmuc,
  hust): already pooled; their known defects are listed in `apps/api/scripts/eval/CORPORA.md`.

**Licence rule** (unchanged): NC and research-only corpora stay in the context tier and are
never pooled, whatever the quality of their truth.

## Pooling and truth-source policy (decided)

- `dataset.json` `truthSource`: `human` | `resynth` | `derived` | `constructed` | `onsets`.
- A dataset is pooled when all of these hold:
  - `!noteTruthDerived && !pitchless && !constructedPerformance && !licenceRestricted && pooled !== false`
  - `licenceRestricted` is new in the pooling rule. It changes nothing today, because every
    restricted set is also derived.
  - `pooled: false` is the explicit opt-out, used for whistle-vintage.
- Benchmark results carry `truthSource` per dataset. The headline is reported twice: over
  human-truth datasets only (continuous with the history) and over all pooled datasets.
- **Calibration gate**: resynth truth counts as benchmark-grade if blind resynth on
  human-truth clips agrees with the human truth at least as well as a second human annotator
  does. The yardstick is vocadito A2 vs A1, 0.760 COnP. The measured numbers go below.

## Locations (decided)

| what | where |
|---|---|
| resynth tool | `synthetic-corpus/synthcorpus/resynth/` (doc: `synthetic-corpus/RESYNTH.md`) |
| per-clip work state (gitignored) | `synthetic-corpus/work/resynth/<dataset>/<clip>/` |
| committed truth artifacts | `apps/api/scripts/eval/annotations/resynth/<dataset>/<clip>.resynth.json` |
| harness truth / copies / contours (gitignored fixtures) | `eval-real/<tier>/<ds>/<clip>.truth.json`, `__resynth.flac`, `.f0.json` |
| benchmark results (git-tracked JSON) | `apps/eval/data/benchmarks/{real,synth}/*.json` (moved from `apps/api/scripts/eval/benchmarks/results*`) |
| timeline results (git-tracked JSON) | `apps/eval/data/timeline/<date>_<sha>.json` + `index.json` |
| timeline work (gitignored) | `apps/api/scripts/eval/.cache/timeline/{trees,legacy,notes}/` |
| per-run pipeline notes (gitignored) | `apps/api/scripts/eval/.cache/notes/<resultId>.jsonl` |

## Resume runbook (after going offline, a crash, or a new session)

1. `cd synthetic-corpus && PYTHONPATH=. .venv/bin/python -m synthcorpus.resynth status` shows
   per-dataset counts by status.
2. Check `claude-usage --short`. Launch the next wave only while session use is below ~70%.
3. Relaunch the resynth wave workflow (script: `resynth-wave` — saved copy at
   `synthetic-corpus/work/resynth/_wave.js`; args `{"clips": ["<ds>/<clip>", …]}`) with the clips still pending. It is idempotent: every
   clip resumes from its `state.json`. Never resume a workflow run mid-flight (see the
   memory note on workflow resume); start a fresh run instead.
4. Export passed clips: `resynth export --dataset <id>`.
5. Timeline: `apps/api/scripts/eval/timeline/run.ts` is resumable per (commit, clip).

## Close-out of the previous test-data work

Source: the phase-0 audit, items 1–21. "Done" means changed in this pass. "Concluded" means
decided and recorded without changing behaviour. "Open" means left with a reason.

| # | loose end | outcome |
|---|---|---|
| 1 | `import-note-labels.ts` could stamp every clip of every dataset as verified | **Done.** New `--clips=a,b\|all` and `--verified-list=<file>` (a worklist counts only its ticked items). `--verified-by` is refused without `--dataset` and a clip selection, and unknown clip ids are refused. Checked in a scratch copy. `VERIFY-WORKLIST.md`'s command is fixed |
| 2 | synthetic README lists "two real notes never share a slot" as shipped | **Done.** Moved to "measured null, not shipped", with the DP-quantiser lead |
| 3 | 37 timbres / "v1" header / ~12 GB / after-table aggregation unlabelled | **Done.** 36 timbres (README and FINDINGS), v1.1, ~10 GB (`du`: 10G). The after-table is labelled as clip means vs the baseline's dataset means (0.720 vs 0.717). Also fixed: 90 → 92 sources (the export's distinct source ids), and "bagpipe (with drones)" → drones not mixed |
| 4 | `benchmark.ts` history links and synthetic headline | Separate phase-1 task (the `benchmark.ts` owner), not in this brief |
| 5 | synthetic tier missing from the harness docs | **Done** in `scripts/eval/README.md`: the `eval-synth` corpus layout, `EVAL_SYNTH`, `--synth`, and a table for the five synth scripts. `CORPORA.md` now names both synthetic corpora. `benchmarks/README.md` belongs to the `benchmark.ts` owner |
| 6 | `CORPORA.md` context table lacked `whistled-high-register(-aligned)` | **Done.** Two rows added; only `-aligned` feeds the provisional whistling row |
| 7 | stale triage in `VERIFY-WORKLIST.md` | **Done.** Re-ran `triage-verify-worklist.ts` (0.9 s), now ranked from `2026-09-27T06-23-29_d77db1d_onset-policy`. freesound-74388 left the list and freesound-250718 joined it. The file is marked SUPERSEDED and kept as history |
| 8 | no benchmark since the 2026-10-22 refactor | Open until phase 5: the fresh HEAD benchmark and the timeline control point cover it |
| 9 | eval-script adoption (`master-todo.md`) | Open, as documented |
| 10 | cached-onset gap untracked; DETECT_* "moves numbers" | **Done.** Added to the `master-todo.md` item. `trackCache.ts` uses the default `OnsetDetector`, `RESOLVER_ENV_KEYS` lacks the onset variables, and all 4,274 `eval-cache` files predate 2026-09-27; the effect size is unmeasured. The DETECT_* sub-item is noted as de-duplication only |
| 11 | A/B-only onset variables undocumented | **Concluded: keep all six** (no code deleted). The eval README has a new "Onset-policy kill-switches and A/B levers" table with each variable's measured status. `VOICE_ONSET_MIN_TROUGH_SEC`: no measurement recorded |
| 12 | no corpus version or env provenance | **Done (corpus part).** `export.py` writes `corpusVersion` (`CORPUS_VERSION = 'v1.1'`). The 44 existing `eval-synth/*/dataset.json` files were stamped in place, with their format kept and no re-export. Result metadata (env overrides, corpus version) belongs to the `benchmark.ts` owner |
| 13 | `FINDINGS.md:1976` says the lead-in probe is "still to be run" | **Done.** It now points to the `probe-leadin.ts` section |
| 14 | `RESEARCH-STATUS.md` stale | **Done.** §3 J marked done (8173811c). §3 B: the "promotes 117" claim is corrected and the item is superseded by resynth truth. New §5 addendum covers the 2026-09-27 ship, its nulls and its leads |
| 15 | SSO alto flute kept by the v1.1 audit without a record | **Concluded: keep** (v1.1 is final). Recorded in the synthetic README caveats with the audit scores: SSO English horn 13.2 and SSO piccolo 10.3 dropped, SSO alto flute 12.6 kept, Iowa alto flute 9.0. `work/sustain-audit.txt` is summarised there, not committed |
| 16 | `CORPORA.md` apps/eval prescribed-truth section contradicts the DISCARDED verdict | **Done.** Marked discarded (COnP 0.00 dogfood) and notes the 2026-10-30 benchmark-only rework |
| 17 | human whistle verification (0 of 898) | Superseded by resynth truth (phases 3–4). Recorded in the worklist, `CORPORA.md` and RESEARCH-STATUS §3 B |
| 18 | corpus v1.2 realism leads | Deferred, one line each in the synthetic README's "Status (2026-10-30)" |
| 19 | pipeline leads (joint DP quantiser, short-note change cost) | Open; listed in RESEARCH-STATUS §5 |
| 20 | humming provisional; MTG-QBH | Open. humtrans and mir-qbsh get resynth truth in phase 4 but stay context (licence). MTG-QBH remains an audio lead |
| 21 | `out/_showcase` listening check never recorded | Open for Karel; stated in the synthetic README's Status section |

## Calibration

(filled by phase 3)

## Progress log

- 2026-10-30 15:20: branch created; scoping workflow done (6 readers, ~1.2 M agent tokens,
  about 12 % of a session window).
- 2026-10-30 17:20: phase-1/2/6/7 builds done and committed (92bc7278…81ba8611): close-out, resynth tool (27 tests;
  perturbation self-test over 24 clips: pitch 100 %, delete 97 %, split 96 %, onset ±100 ms 99 %), harness
  (results → apps/eval/data, truthSource, human-only headline, seams), timeline infra (14 commits, 509-clip
  clipset), eval app rework. **dagstuhl-choir audio was corrupt** (float stems sliced as 16-bit) → fixed in
  37f7ea02, re-fetched as 94 clips; every earlier dagstuhl number is void.
- 2026-10-30 17:30: timeline transcription launched in the background (`run.ts --commits all --parallel 3`,
  log `apps/api/scripts/eval/.cache/timeline/run.log`).
- 2026-10-30 17:44: pilot wave launched (17 clips: 6 whistled-high-register, 4 calibration, 7 targets);
  usage before: session 26 %, week 31 %.
- 2026-10-30 19:55: pilot done — 16/16 real clips passed (12 in round 1, 4 in round 2); 52 agents / 4.5 M agent
  tokens (12 of them wasted on a non-existent clip-06 ref → loop now stops on non-actionable status). Cost
  ≈ 1.9 % of a session window per clip, driven by ad-hoc Python (judges median 44 tool calls). Calibration
  (blind resynth vs human, COnP@100): vocadito_3 0.81 (A2-vs-A1 0.85), vocadito_14 0.61 (A2-vs-A1 0.73;
  resynth-vs-A2 0.75), n20emv2 0.95, hust 0.88.
- 2026-10-30 21:00: resynth upgrade (efef927b): inspect/zoom/note commands, sung-syllable evidence; wave
  script v2 (tool budget, generator at medium effort, syllable convention).
- 2026-10-30 21:21: wave 1 launched (45 clips: whistled-high-register/clip-08, whistle-vintage ×6, whistle-real
  ×30, calibration ×8); usage before: session 0 % (fresh window), week 39 %.
- 2026-10-30 22:06: wave 1 done — 45/45 passed (mean 2.2 rounds; whistle-vintage 3.8), 204 agents / 12 M tokens
  (≈ 266 k per clip; judge thinking ≈ 2/3 of it). Judge moved to medium effort (wave script v3), queue-driven
  waves via `work/resynth/_next_wave.py` with 2 calibration canaries per wave.
- 2026-10-30 22:20: wave 2 done — 38/38 passed (mean 1.45 rounds), 110 agents / 5.5 M tokens (≈ 144 k per clip).
  usage after: session 67 %, week 50 %. HumTrans scope (769 clips) put to Karel; held out of the queue until answered.
- 2026-10-30 22:36: wave 3 done — 50/50 passed (mean 1.34 rounds), 134 agents / 6.5 M tokens (≈ 0.34 % session per whistle clip); whistle-real 116/117 exported. usage: session 85 %, week 52 %.
- 2026-10-30 22:42: wave 4 (fill-up) done — 10/10 passed; **whistle-real complete (117/117) → resynth truth, poolable**; app-takes-whistling 9/19.
- 2026-10-30 22:45: wave 5 (fill-up) done — 6/6 passed; app-takes-whistling 15/19.
- 2026-10-31 02:45: wave 6 launched (mir-qbsh ×49, dagstuhl ×29, 2 canaries) into the fresh window. In-app takes
  content-deduped against every eval clip (peak-contour fingerprint, octave-folded, ±1.5 s): the 40 takes of the
  2026-06-17 batch were the vocadito corpus re-encoded through the server path (lag 0, 98–100 % match) → removed.
  app-takes-singing = 52 genuine takes, app-takes-whistling = 19 (none duplicated). The 157 'instrument' takes were
  the old soundfont corpus (excluded at triage).
- 2026-10-31 03:08: wave 6 done — 80/80 passed (mean 1.51 rounds; dagstuhl 1.9), 242 agents / 12.2 M tokens (≈ 0.45 % session per clip); **mir-qbsh complete (50/50)**. usage: session 36 %, week 59 %.
- 2026-10-31 03:15: calibration check (18 blind clips): vocadito resynth-vs-A1 0.643, best-of-annotators 0.707 vs
  annotators' own A2-vs-A1 0.732 (n=9); n20emv2/hust 0.652 (n=9). Of 423 vocadito annotator notes resynth does not
  match: 133 are same-pitch sung syllables resynth merged, 180 short (< 150 ms) ornaments/scoops resynth folds into a
  neighbour (convention 5 — n20emv2/hust experts are even coarser than resynth), 79 ±1 st calls on between-semitone
  notes, 6 truly missed. → wave script v4: sung same-pitch syllable doubt defaults to SPLIT (+ uncertain-split).
  Wave 7 restarted fresh under v4 (dagstuhl 31 clips + mir-qbsh passed under v3 — candidates for a syllable re-check).
- 2026-10-31 03:31: wave 7 (v4) done — 80/80 passed (mean 1.44 rounds); **app-takes-singing (52/52) and app-takes-whistling (19/19) complete**; canaries under v4: vocadito_37 0.760 vs A1 (A2-vs-A1 0.717; 49 vs 51 notes — the under-split is gone), urmp-flute 1.000. usage: session 72 %, week 65 %.
- 2026-10-31 03:43: wave 8 done — 30/30 passed (mean 1.5 rounds); dagstuhl 82/94; urmp-flute canary 2/4.
- 2026-10-31 03:47: wave 9 (fill-up) done — 8/8 passed; dagstuhl 90/94.
- 2026-10-31 07:43: wave 10 launched (dagstuhl last 4, jacrc ×75, 1 canary) into the fresh window (reset was 07:40, not 07:19 — the window starts at the first request after expiry). Overnight CPU work: timeline notes for the 37 app-take clips × 14 commits; full HEAD benchmark (2026-10-31T06-12-44_d16420ef, notes cached for re-scoring after the last truth lands). usage: session 0 %, week 69 %.
- 2026-10-31 08:11: wave 10 done — 80/80 passed (mean 1.68 rounds), 268 agents / 14.6 M tokens; **dagstuhl-choir complete (94/94) → resynth truth**; jacrc 76/175. usage: session 45 %, week 76 %.
- 2026-10-31 08:37: wave 11 done — 67/67 passed; jacrc 142/175.
- 2026-10-31 08:43: wave 12 done — 15/15 passed; jacrc 157/175 (18 left). Week reset at 09:00 → new-week policy: finish jacrc only, then the finalize workflow (`synthetic-corpus/work/resynth/_finalize.js`: organise → rescore HEAD benchmark + timeline → eval-app verify); humtrans held for Karel.
- 2026-10-31 12:58: wave 13 done — 19/19 passed; **jacrc complete (175/175 → jacrc-notes, resynth truth, poolable)**. Every non-humtrans target is done: 520 target clips + 24 calibration clips exported, 0 unresolved. Finalize workflow launched.
