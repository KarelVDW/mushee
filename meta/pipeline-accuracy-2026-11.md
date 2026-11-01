# Pipeline-accuracy pass — 2026-11-01 (branch `pipeline-accuracy-2026-11`)

The brief: raise the product benchmark's accuracy on real recordings without training anything and without
estimating tempo, keeping every measurement correction apart from every pipeline gain. Run as one orchestrated
pass: diagnosis lanes, a planner, four implementation lanes in git worktrees, and one integration step. The durable
numbers are in `apps/api/scripts/eval/FINDINGS.md`, "Findings log (2026-11-01: pipeline-accuracy pass …)"; this
file is the plan, the outcome and the timeline.

## Plan (as written before anything ran)

- **Wave 0, blocking:** fix the adverse tier (`lib/degrade.ts` ran loudnorm at 192 kHz inside the filter graph:
  every adverse WAV lost its last ~2.5 s and the reverb ones clipped), regenerate it, record `h0-fixed`.
- **Wave 1, four lanes on dev only**, every production change behind an env knob that defaults OFF:
  - L1 whistling: a whistle family (YAMNet "Whistling" verdict WH-H3, octave-down provider WH-H2, no or a flat
    amplitude splitter WH-H1), optional high-band pitch-down WH-H2b;
  - L2 voice onsets: onset shift 0.05 s re-fitted on quantised output (SING-H1), sub-gate voice back-extension
    (ADV-H3 voice part);
  - L3 reverb front end: re-validate the shipped dipDepth relief and sustained ramp, then a confidence-relative
    voicing gate (ADV-H2) and an instrument onset back-extension (ADV-H3);
  - L4 instruments: a same-pitch, onset-vetoed gap bridge for sustained instruments (INST-H4);
  - L0b: performance-cluster bootstrap, a measured-RIR tier (Arni), staged grid/tempo corrections (GuitarSet on its
    click, Dagstuhl on its first beat at the mean tempo, app takes at their session tempo, URMP tested).
- **Integration:** merge, swap the staged corrections in, record the final-harness baseline, re-run every candidate
  on dev, give each survivor ONE test look (plus the RIR tier for ADV-H2/H3 and one stacked look), flip what passes,
  confirm on the model path.
- Ship bar (benchmarks/README.md): paired 95 % CI on test excludes 0 AND Δ ≥ ~+0.005 on the target material;
  routing-gated changes exactly 0 elsewhere. Plan expectation for the pipeline items combined: ALL +0.012…+0.025.
- Dropped at planning: INST-H3 (fits the misaligned grid), INST-H5 joint DP quantiser (≤ +0.001), SING-H2
  (≤ +0.002, partly circular), ADV-H4 (≈ +0.001), ADV-H5 DeepFilterNet3 (needs owner approval).

## Outcome

### Measurement corrections (same pipeline; mean of dataset means, COnP)

| scope | old HEAD (d16420ef) | h0-fixed (degrade fix) | h1-final (+ grid/tempo) | total Δ [95 % CI] |
|---|---|---|---|---|
| ALL (27) | 0.6385 | 0.6721 | 0.6717 | +0.033\* [+0.025, +0.041] |
| human (21) | 0.6549 | 0.6981 | 0.6989 | +0.044\* [+0.034, +0.054] |
| singing | 0.5824 | 0.5895 | 0.5900 | +0.008\* |
| whistling | 0.6009 | 0.6009 | 0.5895 | −0.011\* |
| instrument | 0.6867 | 0.7464 | 0.7476 | +0.061\* |
| real only ALL / human | 0.7280 / 0.7700 | same | 0.7280 / 0.7713 | −0.000 |

Grid step alone: GuitarSet +0.017\*, Dagstuhl +0.033\*, app singing −0.027\*, app whistling −0.034\*; ALL −0.000.

### Pipeline candidates (vs h1-final; cached = the benchmark; performance-cluster CIs)

| candidate | knob (default now) | lane dev | final-harness dev | test look | decision |
|---|---|---|---|---|---|
| SING-H1 voice onset shift | `VOICE_ONSET_SHIFT_SEC` (0.05 ships; 0.07 = off) | singing +0.016\* | +0.016\* | **singing +0.013\* [+0.009, +0.017]** | **SHIPPED** |
| INST-H4 same-pitch gap bridge | `EXTRACTOR_BRIDGE_GAP_SEC` 0.12 + `_FRAGMENT_SEC` 0.2 (0 = off) | instrument +0.0074\* | +0.0074\* | **instrument +0.0046\* [+0.0030, +0.0062]** (at the bar) | **SHIPPED** |
| ADV-H2 confidence-relative gate | `RECORDING_CONF_RELATIVE_GATE` (off) | ALL +0.010\* | +0.010\* | ALL +0.0057\* [+0.005, +0.007]; RIR ALL +0.012\* but plucked rir-near −0.004 n.s. | built off: pre-registered RIR sign rule; **owner call** |
| WH-H1+H2+H3 whistle family | `RECORDING_WHISTLE_DETECT/_PITCHDOWN/_ONSET=0.2` (off) | whistling +0.030\* | +0.037\* | whistling −0.001 [−0.020, +0.017] | built off (test null); undeclared voice score +0.033\* |
| ADV-H3 instrument back-extension | `RECORDING_INSTR_ONSET_BACKEXTEND` (off) | +0.004\* instr. on top of H2 | clean GuitarSet −0.004 (bar ≥ −0.002) | — | built off (dev bar failed on the re-cut GuitarSet) |
| ADV-H3 voice back-extension | `VOICE_ONSET_BACKEXTEND` (off) | +0.0027\* on top of S | +0.002 n.s. on top of S + H2 | — | dropped at dev |
| WH-H2b high-band pitch-down | `RECORDING_HIGH_BAND_PITCHDOWN` (off) | instrument ≈ +0.001 | — | — | null |
| whistle onset ramp | `RECORDING_WHISTLE_ONSET_RAMP` (off) | 0.627 vs 0.635 | — | — | null |
| L3 step 0: dipDepth relief off | `RECORDING_REVERB_CONF_RELIEF=0` | AVS −0.018\* | — | — | relief kept (blind but not inert) |
| L3 step 0: sustained ramp off | `SUSTAINED_ONSET_REVERB_RAMP=0` | URMP +0.001 n.s. | — | — | ramp inert; removal is a follow-up |
| SDRY-1 existence floor (after the pass) | `VOICE_ONSET_EXISTENCE_SHIFT_SEC` (0.07 ships; 0.05 = off) | — | singing +0.0076\* (two-fold +0.0065\* / +0.0087\*) | **singing +0.0079\* [+0.0067, +0.0091]**, ALL +0.0031\*, human +0.0026\* (vs HEAD) | **SHIPPED** |

### Test, all at once and what ships

| scope | all four dev survivors stacked | **shipped (SING-H1 + INST-H4)** |
|---|---|---|
| ALL | +0.012\* [+0.009, +0.014] | **+0.008\* [+0.006, +0.010]** (0.680 → 0.688) |
| human-only | +0.012\* [+0.010, +0.015] | **+0.007\* [+0.005, +0.009]** |
| singing | +0.020\* | +0.013\* |
| whistling | −0.001 | +0.002 (n.s.) |
| instrument | +0.007\* | +0.005\* |
| real only ALL / human | +0.005\* / +0.004\* | +0.005\* / +0.004\* |

Both splits, cached, after the flips (`int-after-cached-all`, env {}): ALL 0.6717 → 0.6808, human 0.6989 → 0.7076.

### Model-path confirmation

- `--scratch` (the real model, no caches), 7 identical shards per arm, all pooled datasets, all conditions, both
  splits.
  - Before (knobs forced off) is note-identical to the cached `h1-final` on 2,813 / 2,813 clip×conditions.
  - After (defaults) is note-identical to the cached shipped set on 2,813 / 2,813.
  - Test Δ = the cached test look: ALL +0.008\*, human +0.007\*, singing +0.013\*, instrument +0.005\*.
- `--synth` (home-phone + room): ALL +0.002\*, singing +0.008\*, instrument +0.001\*.
- `check-streaming`: identical rows before and after.
- `notation-eval`: app-takes-singing beat F1 +0.009, phase-locked +0.035; dagstuhl −0.003; readability counters
  unchanged.

### Review fixes (benchmark notes unchanged on 2,813 / 2,813)

- **Bridge on plucked takes in the app** (`12b97b36`, `b113fc40`): the web app declares no source, so a guitar
  into a voice-lead score got the sustained dip and the bridge (GuitarSet COnPOff −0.007\* dev). YAMNet's new
  `struckOrPlucked` verdict sends such takes to the struck/plucked onset family when the score names no instrument:
  COnPOff +0.015\* / +0.017\* (dev / test), COnP ±0.002. Kill-switch `RECORDING_PLUCKED_DETECT=0`. Declared
  profiles byte-identical.
- **Streaming held notes** (`bf471983`, `e0bb7de1`; pre-existing): passes committed still-sounding notes at a
  short length that stuck. Now a note commits only once its performed end is 0.4 s behind the audio: 37 → 0
  still-sounding commits on 39 real dev takes; held notes (3.9 %) appear a median 1.0 s later.
- **ADV-H2 hardening** (`a4a423dc`, `cd81950f`, built off): see owner decision 1.

### After the pass: SING-H1's condition-masked loss (dry diagnosis, dev, then one test look)

- **The finding:** the pooled dataset mean hid two SING-H1 losses on test, annotated-vocalset real −0.044\* and
  esmuc −0.011\* (AVS's pooled row was −0.001 n.s. on test). Read singing A/Bs per dataset × condition.
- **AVS real is the truth's onset convention:** its notes start where the pYIN glide (a dropped "Transition" row,
  median 93 ms) ends. Re-timed to the glide midpoint, AVS peaks at 0.05 like every human-annotated set; nothing
  the pipeline can observe separates it. No product rule.
- **esmuc was not timing:** the shift also lowered the decoder's minimum note from 100 to 80 ms (its existence test
  runs after the shift), admitting 7.7 short runs per take, mostly choir bleed; timing alone gained +0.012\*.
- **Shipped SDRY-1** (`existenceShiftSec` 0.07, kill-switch `VOICE_ONSET_EXISTENCE_SHIFT_SEC=0.05`): one
  pre-registered rule, the previous value. Test vs HEAD: singing +0.0079\* [+0.0067, +0.0091], ALL +0.0031\*, human
  +0.0026\*, esmuc +0.025\*, AVS real +0.002\*, no singing cell significantly negative, whistling and instruments
  exactly 0. Knob off, the flipped default and the kill-switch are each note-identical to their references on
  2,813 / 2,813; `check-streaming` identical. Numbers in FINDINGS.md ("After the pass: SING-H1's condition-masked
  loss").

### Committed benchmark pair (RESULTS.md)

Two full model-path runs: every dataset, all 16 conditions, both splits, clean trees. Each is note-identical to its
cached replay on 2,813 / 2,813 pooled clip×conditions.

| run | pipeline | ALL | human | singing | whistling | instrument |
|---|---|---|---|---|---|---|
| `test-data-2026-10` (d16420ef, rescored) | before the pass, broken degrade | 0.638 | 0.655 | 0.582 | 0.601 | 0.687 |
| `harness-2026-11` (a9baf46e, env `VOICE_ONSET_SHIFT_SEC=0.07` `EXTRACTOR_BRIDGE_GAP_SEC=0`) | before the pass, corrected harness | 0.672 | 0.699 | 0.590 | 0.589 | 0.748 |
| `pipeline-accuracy-2026-11` (bf982160 = 5302a5bb code) | shipped | **0.684** | **0.710** | 0.612 | 0.592 | 0.754 |

- **Measurement correction** (first → second row): ALL +0.033\* [+0.025, +0.041], real-only −0.000. It is the same
  pipeline, so this is not a gain.
- **Pipeline gain** (second → third row, paired cluster bootstrap):
  - both splits: ALL +0.012\* [+0.010, +0.013], human +0.011\*, singing +0.022\*, instrument +0.006\*, whistling
    +0.003\*; every condition gains (real +0.009\*, distant-mic +0.014\*);
  - the test half alone: ALL +0.011\* [+0.009, +0.013], singing +0.021\*.
  - Per-dataset losses: none significant over both splits (urmp-trombone −0.003 n.s.). The test half's
    urmp-tuba −0.008 is a single performance, so its "interval" has zero width.

## Owner decisions left open

1. **ADV-H2**: ship despite the one non-significant negative cell (GuitarSet, rir-near) on the measured-RIR tier?
   Everything else passed (test ALL +0.0057\*, RIR ALL +0.012\*). One line: `envFlag('RECORDING_CONF_RELATIVE_GATE', true)`.
   The hardening is merged (`a9baf46e`): silent and noise-only takes no longer produce junk notes with it on, and
   a final gate within 0.02 of the frozen one no longer rebuilds the score at stop. Benchmark notes are unchanged.
2. **Whistle family**: the declared benchmark row is null on test, but the undeclared "whistling on a voice score"
   case gains +0.033\*. A DETECT-only variant (keep whistles out of the voice decode, nothing else) is the natural
   next hypothesis; it needs its own dev/test cycle.
3. **INST-H4 shipped at the bar** (+0.0046 against ~+0.005); kill-switch `EXTRACTOR_BRIDGE_GAP_SEC=0`.
4. **App-take tempo correction** lowers the reported whistling material (−0.011\*): seconds-COnP punishes correct
   quantisation at slow tempi. The beat-domain numbers (notation-eval) move the other way.
5. **Committed benchmark run + RESULTS.md**: done (`6f5cb940`); see "Committed benchmark pair" above.
6. The corpus corrections (re-cut GuitarSet and Dagstuhl, app-take truth bpm, URMP `nominalTempo`) live in the
   gitignored fixtures; only the 48 app-take resynth annotations are tracked (commit `dadfb29b`). Rollback:
   `swap-grid.sh --rollback` from `.cache/scratch/l0b/pre-swap/`.
7. **Voice grid-phase re-writing** (FINDINGS, 2026-11): the written score moves a sung take by a whole off-beat
   phase when that halves its notation cost. It fires on ~3 % of timeline clips, mostly free-tempo corpora where
   there is no click to lag behind, at 0.04–0.78 COnP per clip. Gate it on the metronome being on? (Needs the web
   app to send that.)

## Timeline (2026-11-01, CET)

| time | what |
|---|---|
| morning | harness readiness (cache v7, `--cached`/`--scratch`, slices), four diagnosis lanes, the plan |
| 12:39 | `3444df59` degrade fix (variant cache v4); `6fa3680f` readiness harness; worktrees cut |
| ~13:08 | L0a: 1,452 adverse WAVs regenerated, v4 cache rebuilt (19 min, 5 processes); `h0-fixed` (H0-READY) |
| 12:59–14:43 | lanes L1–L4 on dev (commits on pa-l1…pa-l4); L0b: cluster bootstrap `530e591d`, RIR tier `66ac7c7b` (RIR-READY), staged grid `9f7e49ef`, `999e2b1f` |
| 14:46 | integration: four `--no-ff` merges, no conflicts; knobs-off cached run note-identical to h0-fixed (2,813/2,813) |
| 14:49–15:02 | `swap-grid.sh` (GS + Dagstuhl rebuilt, 2 processes); `grid-fixed` = L0b's table exactly; `h1-final` |
| 14:51 | `dadfb29b` app-take resynth annotations (bpm only) |
| 14:51–15:20 | whistle-family per-env cache built for every pooled dataset, both splits, all conditions (8 processes) |
| 15:05–15:27 | dev re-runs and interactions; the test looks (SING-H1, ADV-H2 + RIR, INST-H4, L1, stacked) |
| 15:30 | `9c520676` SING-H1 ships, `edf8df6b` INST-H4 ships, `6a476dbc` built-off doc numbers |
| 15:32–16:35 | model-path confirmation (`--scratch`, 7 shards per arm, ~50 min), `--synth` home-phone + room, notation-eval, check-streaming; docs |
| 17:16–18:01 | review fixes (`RECORDING_PLUCKED_DETECT`, streaming commit margin, ADV-H2 hardening) merged at `a9baf46e` |
| 18:05–21:47 | committed run `harness-2026-11` (model path, the pre-pass knobs) |
| 18:52–19:40 | SING-H1 dry diagnosis on dev (shift sweep, stage decomposition, AVS convention test); SDRY-1 pre-registered 19:09, two-fold dev check, one test look 19:14, flipped |
| 19:45 | `5302a5bb` the existence test never judges below the reporting shift (verifier caveat; note-identical in three states) |
| 19:45–20:00 | timeline points `a9baf46e` and `5302a5bb` scored; grid-phase finding `44692bbf` |
| 19:45–23:24 | committed run `pipeline-accuracy-2026-11`; `69f83ab4` RESULTS.md shows a run's env; `6f5cb940` the pair |

## Where things are

- Lane write-ups and the integration log: the orchestrator's scratchpad `diag/{L0a,L0b,L1,L2,L3,L4}-results.md`,
  `diag/integration.md`, `diag/sing-h1-dry.md` (not in the repo).
- Result files: `apps/api/scripts/eval/.cache/bench-scratch/real/*_{h0-fixed,grid-fixed,grid-fixed-rir,h1-final,int-*,pa-*}.json`.
- Scratch tools: `apps/api/scripts/eval/.cache/scratch/{h0,l0b,l1,l2,l3,l4,int}/` (gitignored).
- Committed results: `apps/eval/data/benchmarks/real/2026-11-01T*_{harness-2026-11,pipeline-accuracy-2026-11}.json`,
  rendered in `apps/api/scripts/eval/benchmarks/RESULTS.md`.
- The lane worktrees and `pa-*` branches are removed (all merged).
