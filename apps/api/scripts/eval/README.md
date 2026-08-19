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

## Research notes

Standing research documents live beside the harness. They are the durable record; the Findings
logs below are the measurements.

| File | Covers |
|---|---|
| `research-benchmarks.md` | Datasets, metrics, tolerances, benchmark-suite design |
| `research-pitch-models.md` | Frame-level f0 and note-level transcription state of the art |
| `research-voice-transcription.md` | The voice-specific flow: syllables, silence-state decode, V0–V3 plan |
| `research-voice-datasets.md` | Licence-and-provenance register for every voice corpus considered |
| `research-rhythm.md` | Tempo/beat tracking and score-level rhythm quantisation |
| `research-daw-products.md` | How commercial products do it (docs, patents, press) |
| `research-plugin-sources.md` | Sixteen open-source projects' **source code** mined for transferable ideas — plugins, the reference implementations we cite, and autotune |
| `plan-plugin-improvements.md` | **Execution plan** for research-plugin-sources.md §17 — batched tasks with gates, for an implementing agent |

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
| `fetch-esmuc.ts` | ESMUC Choir Dataset (CC-BY-4.0) — 271 per-singer choral stems (~4.8 h), **manually corrected per-singer note truth**, 13 conservatoire singers. Real mic bleed (simultaneous recording) — a genuine adverse condition, kept as its own dataset. |
| `fetch-csd.ts` | Choral Singing Dataset (CC-BY-4.0) — 96×30 s per-singer stem excerpts, Tony-extracted + **hand-corrected** notes. ⚠️ truth is per SECTION (4 unison singers share one note file) and stems carry bleed. |
| `fetch-hust-solfege.ts` | HUST_Solfege (MIT) — 73 real solo solfège recordings (amateur incl. juvenile voices, ~44 min, 3.7k notes). Offsets in the source are synthetic → durations derived from inter-onset gaps; the pitch column's ~+19.8 st convention is calibrated per file against the audio. See research-voice-datasets.md §1d. |
| `fetch-dagstuhl.ts` | Dagstuhl ChoirSet (CC-BY-4.0) — 102×30 s quartet singer-stem excerpts. **The harness's only real tempo on singing**: 20 hand-tapped, second-annotator-reviewed beat/measure grids, emitted as `GroundTruth.beatGrid` (63–91 BPM, genuinely expressive) so `notation-eval.ts` can score notated rhythm on a *voice* corpus for the first time. Its NOTE truth is a 70 ms-MAE DTW score alignment → `noteTruthDerived`, never pooled. Mic bleed throughout. See research-voice-datasets.md §5l. |
| `fetch-avp.ts` | AVP (CC-BY-4.0) — 280 clips / 9.8k **human-labelled onsets** on real amateur vocal percussion (kick/snare/hihat imitations). `pitchless`: no pitch exists anywhere in the chain, so it scores the `OnsetDetector` in isolation via COn. See research-voice-datasets.md §5a. |
| `fetch-jacrc.ts` | JaCRC students (CC-BY-4.0) — 175×30 s excerpts / 5.2k **manual syllable onsets** from 25 amateur conservatory students singing jingju. `pitchless`. ⚠️ **read `onsetRecall`, not F1**: syllable onsets are a strict subset of note onsets on melismatic singing, so precision is understated by construction. Students-only folder (documented performer consent); the collection's professional/commercial rows are deliberately untouched. See research-voice-datasets.md §5l. |
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
| `sweep-voice.ts` | **The voice flow's harness.** Scores two slices at once — VOICE (annotated-vocalset, N20EMv2, vocadito) is what a change targets, GUARD (every instrument corpus) is what it must not break — and reports where the loss is, not just how big: COn beside COnP (boundary vs pitch), Molina split/merged/missed, and **re-onset/transition recall**. `VOICE_EXP=<groups>`, `VOICE_ONLY=substr`, `VOICE_GUARD=0`. |
| `inspect-clip.ts` | One clip in full: ground truth, an ASCII pitch contour, and every stage's output. Sweeps say which config wins; this says why — and it is what found the bugs. |
| `bench-external-notes.ts` | Score an EXTERNAL system's per-clip note JSONs under the harness's conventions — the §10d gate for "should we acquire a learned model". `EXT_DIR=<dir> EVAL_SPLIT=test`. |
| `bench-yong-runner.py` | The runner half for Yong-2023 (ICASSP 2023, MIT checkpoint): batch inference into the JSON format above. Setup + measured verdict in its header. |
| `probe-source-classifier.ts` | Measures the stock-YAMNet voice/instrument classifier over every labeled real clip: forced-choice accuracy and the abstain-band trade table. |

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
| Sustained vibrato-heavy singing (annotated-vocalset) — was the weak spot | ~0.45, ~1.7× over-segmented → **0.59** at 1.3× after the voice decode (2026-08) |
| Voice slice (annotated-vocalset + N20EMv2 + vocadito), held-out test | 0.570 → **0.668** after the voice decode |
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

---

## Findings log (2026-08 voice flow)

The V0/V1 work from `research-voice-transcription.md` §10b–§10c. One headline result,
and — as usual — most of the individually-plausible ideas measuring as nulls.

### Shipped: a voice-only note decode (`src/recordings/pipeline/voice-note-decoder.ts`)

Reached only through a profile whose source is known to be a voice
(`ProfileResolver.applyVoice`, driven by the score's instrument family or the
client's explicit `sourceKind`). Instruments are untouched — and must stay so:
this decode costs the instrument corpora ~0.03.

Two measurements, because they answer different questions.

**Cached sweep** (`sweep-voice.ts`, segmentation only, paired bootstrap over clips):

| slice | before | after | paired Δ |
|---|---|---|---|
| VOICE, dev (253 clips) | 0.567 | 0.683 | **+0.145 [+0.123, +0.168]** * |
| VOICE, **held-out test** (289 clips) | 0.570 | 0.668 | **+0.123 [+0.102, +0.144]** * |
| annotated-vocalset (test) | 0.46 @1.71× | 0.59 @1.29× | over-segmentation largely gone |
| N20EMv2 (test) | 0.54 | 0.69 | |
| vocadito (test) | 0.70 | 0.73 | at its 0.760 human ceiling |

**Full production path** (`run-eval.ts EVAL_REAL=1 EVAL_ADAPTIVE=1`, every clip of
both split halves, A/B'd with `RECORDING_VOICE_DECODE=0/1`) — profile resolution,
routing, streaming decode, cleanup and the MusicXML round-trip included. This is
the number that corresponds to what a user hears:

| dataset | baseline | voice decode | Δ |
|---|---|---|---|
| annotated-vocalset (400) | 0.396 | **0.557** | **+0.160** |
| N20EMv2 (102) | 0.537 | **0.639** | **+0.102** |
| N20EMv2-test — the external yardstick (18) | 0.471 | **0.567** | **+0.096** |
| vocadito (40) | 0.668 | 0.700 | +0.032 |
| mir-qbsh (50, not pooled) | 0.642 | 0.554 | −0.089 — see below |
| **all 14 instrument datasets** | — | — | **+0.000, every one** |
| **repo headline (18 pooled datasets)** | 0.760 | **0.782** | **+0.022** |

Two things in that table are worth more than the headline. First, the instrument
corpora are **bit-identical**, which is the strongest available evidence that a
change this large is genuinely confined to the input class it was built for.
Second, pooled over the *whole* corpus the segmentation profile changes shape
rather than degree:

```
            clean  split  merged  missed  spur  pWrong  repair
baseline     53%     27      3       4      7      6     729 s/100 notes
voice        62%      8      6       3      4      9     555 s/100 notes   (−24 %)
```

Split — the fragmentation this project set out to fix — falls from 27 per 100
reference notes to 8. The onset taxonomy shows where the cost is paid: the
majority class improves (silence-onset recall 0.811 → 0.869 over 8,516 onsets)
while transitions (0.781 → 0.709) and re-onsets (0.501 → 0.471) give a little
back. That trade is the same one every experiment below ran into, and §"What is
still wrong with voice" says why it is a frontier rather than a tuning failure.

Composition of the win, in the order the experiments found it:

1. **Onset calibration is the single biggest effect (+0.15 on its own).** A pYIN-style
   note HMM enters its `attack` state where the contour *departs* the previous note;
   an annotator marks where the pitch *arrives*. Measured lead: −52 ms mean / −44 ms
   median. Two controls establish this is a latency of the decode and not a habit of
   the annotations: applying the same shift to the *shipping* segmenter buys almost
   nothing (+0.028 at 40 ms, +0.008 at 60 ms — it is already calibrated at −2 ms
   bias), and all three voice corpora peak at the same 70–100 ms, including N20EMv2,
   whose onsets are expert-corrected. Structural rules that try to find arrival
   per-note measure *worse* than the constant (`'arrival'` +0.07, `'stable'` +0.05):
   the lead is consistent, per-note estimates of it are noisy, and the noise costs
   more than the bias it removes.
2. **The decode chooses mandatory-silence by itself.** Sweeping the note-change cost,
   everything at ≥ 2.5 nats scores *identically to three decimals* — the direct
   note→note jump is simply never taken, which is Dynamic HumTrans's silence-state
   structure arrived at by pricing rather than by construction (§4 of the research
   doc predicted exactly this). The transition is kept in the state space anyway, so
   the evidence discount below can re-open it for genuine slurs.
3. **Boundary evidence, as a discount and not a detector** (Kroher & Gómez's two
   channels: local volume decay + pitch-dip z-score). A boundary backed by either
   channel costs 0.35× — worth ~+0.005 and, more usefully, it recovers legato
   transitions (0.62 → 0.65 recall) that mandatory-silence forbids outright.
4. **α-trimmed-mean note pitch (α = 0.3, Molina et al.) is worth +0.03** over a plain
   mean — dropping the scoop and the release rather than averaging them in.
5. **`trust: 0.7`, not pYIN's 0.1.** pYIN decodes a probabilistic pYIN contour; we
   decode CREPE's *already Viterbi-smoothed* trajectory, so trusting per-frame pitch
   that little merges real notes (t0.1 → 0.627 vs t0.7 → 0.684 on dev).
6. **Downstream cleanup shrinks to `onsetSplit` alone.** The A-B-A vibrato folder
   (−0.003) and the adaptive length floor (−0.008 as part of the full set) exist to
   undo fragmentation the decode no longer produces. `onsetSplit` stays because it is
   the pipeline's only **re-onset** channel: it lifts re-onset recall 0.124 → 0.329
   (dev) / 0.168 → 0.389 (test) at no cost to COnP.

### Held-out validation on three newly adopted corpora (2026-08-08)

The acquisition-policy pass (`research-voice-datasets.md` §policy) adopted three
real-singing corpora with real note truth — ESMUC (271 per-singer choral stems,
manually corrected), CSD (96 stem excerpts, hand-corrected per-section notes)
and HUST_Solfege (73 solo solfège recordings) — **after** the voice decode was
tuned and shipped. None of their 24,206 notes influenced any constant in the
decoder, which makes this the cleanest generalization test the harness has ever
run. Full production path (`run-eval.ts EVAL_REAL=1 EVAL_ADAPTIVE=1`, A/B'd
with `RECORDING_VOICE_DECODE=0/1`):

| dataset | baseline | voice decode | Δ |
|---|---|---|---|
| csd (96, bleed, per-section truth) | 0.520 | 0.622 | **+0.102** |
| esmuc-choir (271, bleed) | 0.463 | 0.603 | **+0.141** |
| hust-solfege (73, solo, amateur incl. juvenile) | 0.600 | 0.743 | **+0.143** |
| pooled (440 clips) | 0.528 | 0.656 | **+0.129** |

The +0.123 held-out-test result above therefore **reproduces on fully external
data**, slightly larger. The internal shape also reproduces: precision is where
the win lives (pooled 0.39 → 0.56 while recall moves 0.68 → 0.73), silence-onset
recall rises 0.827 → 0.875, transitions give back 0.874 → 0.774 and re-onsets
0.330 → 0.300 — the same trade every earlier experiment measured. Onset medians
land at +10…+31 ms (baseline −5…−25 ms), so the 70 ms calibration constant is
marginally high on these corpora but comfortably inside the ±100 ms gate.

Caveats that travel with these numbers: the choral stems carry real neighbour
bleed (kept as their own datasets, never mixed into a clean tier); CSD's truth
is per section, so within-section timing deviation is invisible; HUST's
durations are derived (source offsets are synthetic) so overlap-based counters
are approximate there, and its truth pitch rides a per-file offset calibrated
against the audio (one scalar per file — see `fetch-hust-solfege.ts`).

### The expanded-slice tuning pass (2026-08-08, evening): one ship, one null, one confirmation

With the adopted corpora in the cache, the voice slice grew to 6 datasets /
~1,000 clips, and three questions were re-asked on it (`sweep-voice.ts`,
dev to explore, test once to confirm):

**Shipped: the adaptive length floor returns to the voice cleanup**
(`AudioConverter.cleanupFor`, `adaptiveFloorFraction: 0.3`). +0.009 dev /
**+0.010 held-out test** (split+floor +0.133 vs split +0.123, both vs the
semitone anchor, n=506, mde 0.019), spurious notes 26 → 24 per 100, re-onset
recall unchanged. The gain is carried entirely by the bleed-heavy choral
corpora — the floor prunes neighbour-bleed fragments — while vocadito, N20EMv2
and HUST are untouched, which is what makes it safe for the product's solo
users. Two caveats recorded honestly: the earlier "adaptive floor −0.008" was
measured as part of the FULL cleanup set, not alone (no contradiction, but the
log's wording invited one); and at exactly +1 pt with a +4 % repair-time tick
this is 2AFC-panel territory under the house rules — flagged for a team listen
rather than skipped, because the change can only ever delete sub-floor
fragments. NOT shipped: the full old cleanup set (transients+monophonic back
on) — +0.006 more, but only on choral bleed, at +18 % repair time and a
vocadito regression.

**Null: the §3.2 selective spectral-flux re-onset splitter — the last untried
model-free re-onset idea is now measured.** SuperFlux-style band-wise ODF
(`lib/spectralFlux.ts`, quarter-tone filterbank, ±1-band max filter), peaks
applied only inside long pitch-flat notes, on top of the shipping broadband
`onsetSplit`. At the high threshold it recovers ~6 of 1,253 dev re-onsets
(recall 0.406 → 0.411) at no COnP change; looser thresholds only manufacture
splits (split 9 → 13–14/100, COnP −0.005…−0.012). The synthetic sanity check
proves the channel itself works (a same-pitch same-RMS spectral change peaks at
124× a ±50-cent vibrato ridge) — so the null is a statement about the corpus:
on real singing, re-articulations the broadband envelope misses leave almost no
band-wise trace either. Combined with the e9 threshold proof and the
accent-bonus null, every DSP route to re-onsets is now measured closed; what
remains is the learned-model gap.

**Confirmed: the tuned constants generalize.** On a slice twice the size and
dominated by corpora the decoder never saw, `trust 0.7 / onsetShiftSec 0.07`
remains the plateau (s80 +0.001–0.005, inside noise; t0.5/t1 flat-to-worse),
and the +0.15-class win over the semitone segmenter reproduces (+0.137 dev /
+0.123 test for the bare decode). The constants were not re-tuned.

### Voice notation spelling (2026-08-08, night): the eval cannot see it, on purpose

A real dogfood take (Frère Jacques, sung a cappella against a click) exposed the
gap the §5 research predicted: routing, decode and melody were all CORRECT — the
sung scale sat ~59 cents off the keyboard with near-perfect intervals — and the
notation still came out as chromatic soup, because pitch NAMES were assigned by
nearest absolute key while the singer's degrees straddled semitone boundaries.

Three product-layer changes, all in the NOTATION stage (`voice-notation.ts` +
`MxmlBuilder`), none in the decode:

1. **Per-take tuning normalization** — Dressler & Streich circular mean over the
   decoder's unrounded pitches (`pitchMidiFloat`, new on voice notes), applied
   before naming. Confidence-gated: incoherent scatter → offset 0 (today's
   behaviour). The naming of a reference-free take is inherently ±1 semitone
   ambiguous (a take 41 c flat of B *is* 59 c sharp of B♭ — same lattice);
2. **the key signature votes** — `keyFifths` now travels in the client's meta
   frame; it breaks the naming ambiguity (duration-weighted in-key count) and
   snaps individual notes only inside the ≥35 c ambiguity band, never moving a
   confidently-sung accidental;
3. **syllabic seam-fill** — voice cleanup sets `seamFillBeats: 0.6` (default
   0.3): sung syllables phonate ~50–70 % of the slot, and the old value wrote
   every quarter as fragment+rest+ties.

Verified against the take that motivated it: the same audio now notates as
B♭–C–D–B♭ ×2, D–E♭–F ×2 — textbook Frère Jacques, zero accidental churn.

**Why the eval headline is deliberately blind to 1–2, and how neutrality was
still measured.** COnP scores against measured-absolute truth, where renaming
toward the singer's grid is *by construction* a mismatch (the old "tuning
correction hurts" finding) — yet it is exactly what the product must write.
So spelling happens after `deduced` (which run-eval scores) and only in
`buildMeasure`. The seam-fill DOES touch `deduced` (durations only):
`ship voice-shipped` on held-out test = **0.686, identical per-dataset to
split+floor** — COnP has no offset gate, so the claim is measured, not assumed.
One pipeline fix rode along: the finalize pass now re-emits ALL measures for
voice takes, because spelling is take-global and early measures were spelled
from a half-built estimate (the live demo showed exactly that).

### The §10d gate, run: Yong-2023 vs the shipped decoder (2026-08-08, night)

The external-checkpoint benchmark the research doc gated the learned-model
decision on. Yong, Su & Nam's ICASSP 2023 checkpoint (MIT, code + weights
published; usable under the acquisition policy) was run over the **held-out
test half of the full voice slice** (515 clips) and scored with the harness's
own conventions (`bench-external-notes.ts`; COnP@±100 ms, Amax, per-dataset
means — comparable to sweep rows, not to published COnPOff):

| dataset | ours (split+floor) | Yong-2023 | Δ |
|---|---|---|---|
| annotated-vocalset | 0.60 | 0.444 | **−0.16** |
| vocadito | 0.73 | 0.730 | ±0.00 |
| n20emv2 | 0.69 | 0.743 | +0.05 |
| hust-solfege | 0.76 | 0.843 | +0.08 |
| esmuc-choir | 0.65 | 0.727 | +0.08 |
| csd | 0.68 | 0.739 | +0.06 ⚠️ CSD was in its training data — read as inflated |
| **mean** | **0.686** | **0.704** | **+0.018** |

Onset classes tell the real story: **re-onset recall 0.403 vs our 0.263** —
the phonetic posteriorgram reads the re-articulations we proved unreachable by
DSP — and silence-onsets 0.925 vs 0.911, but transitions 0.653 vs our 0.776
and a heavy loss on annotated-vocalset (1.19× over-segmentation there: it
splits professional sustained vibrato, the exact failure our decoder was built
to fix; plausibly because its training data contains no operatic vibrato).
The two HUST files that overlap its SSVD training set (1150, 1325) are not in
the test half, so that +0.08 is clean, though solfège is stylistically
in-domain for it.

**Verdict: not a blanket go — a complementary profile.** On the product's
actual segment (amateur solo: vocadito/n20emv2/HUST) it is +0.00…+0.08 with a
big re-onset win; on trained expressive voices it is a 16-point regression.
CPU cost is a non-issue (measured RTF 0.15 on an M-series core, model loads
once). Paths forward, in preference order: (1) trial it as the voice provider
behind a flag and let the adverse tier + a team listen decide — the win/loss
profile may be acceptable if vibrato-heavy users are rare; (2) fuse: keep our
decoder's boundaries and take its re-onset channel only (its frame-wise onset
head is separable in principle); (3) keep ours and bank the corpus. Deploying
it is a D3 serving decision (torch sidecar via the ModelBackend seam;
§12c enumerates the touchpoints).

### Dead end: WPE dereverberation is structurally wrong for singing (2026-08-08)

The reverb-oracle gap (+0.14/+0.23) invited the one dereverb family not yet
tried: linear weighted-prediction-error (nara_wpe's algorithm), implemented in
full (`lib/wpe.ts`) and killed by mechanism tests BEFORE reaching the corpus —
the cheapest kill this log has recorded. WPE cancels whatever is linearly
predictable from the signal's past; for speech that is the reverb tail (our
implementation reproduces the published behaviour there: −4.6 dB tail on a
speech-like burst train, signal kept), but a sustained sung note is
quasi-periodic and MORE predictable than the tail, so on singing the filter
eats the note itself: passthrough destruction ≈ 0 dB rel at 0–±50 cents of
vibrato, −0.8 dB even at ±100 cents. Not a tuning failure — the objective is
inverted for this input class. Do not re-attempt WPE or any
self-prediction-based dereverb on voice; the remaining front-end candidate for
the reverb gap is learned enhancement (DeepFilterNet-class, observation-adding
mix), whose objective is not self-prediction but whose speech-centric training
is its own domain-shift risk to measure.

### Source classification without training (2026-08-08)

The §7 routing question is settled within policy: **stock YAMNet class scores**
(Apache-2.0 checkpoint committed under `model-yamnet/`, no fitted head) decide
voice vs instrument from the same ≥0.96 s prefix the profile lock waits for.
Measured over all 1,148 labeled real clips (`probe-source-classifier.ts`):
forced choice **97.74 %**; the shipped abstain band (top ≥ 0.51, margin ≥ 0.005)
**98.72 % decided with 11.8 % abstain**, where an abstain falls back to the
score-instrument prior (the pre-classifier behaviour). Residual errors are
bleed-heavy choral soprano stems reading as "Flute" — off the product's input
distribution. Two mechanics worth remembering: this TF.js conversion emits
**logits** whose absent classes sit near sigmoid ≈ 0.5, so group *sums* measure
group size — compare each group's strongest member instead; and near-silent
prefixes are exactly what the abstain band is for. Production wiring:
`profiles/source-classifier.ts`, explicit `sourceKind` still wins, kill-switch
`RECORDING_SOURCE_CLASSIFY=0`. The web mic-source chip is removed; eval paths
pass explicit `sourceKind` per dataset so cached profiles stay corpus-pure.

### Re-onsets: the shipped operating point is optimal, and here is the proof

Re-onset recall is the one axis the voice decode made *worse* (pooled 0.501 →
0.471) and the most user-visible one — someone singing "la-la-la" on one pitch
gets one note. The decode cannot see these by construction, so the only lever
without new DSP is `OnsetDetector`, whose thresholds were tuned for a segmenter
that fragmented heavily and therefore wanted a timid splitter.

Swept over the detector's **own 10 ms envelope** (see the resolution note below —
the first attempt at this used the trajectory's 20 ms grid and measured the frame
rate instead of the rule). Voice slice, dev, on top of the shipping decode:

| onsets | re-onset recall | COnP | split/100 | missed/100 | repair |
|---|---|---|---|---|---|
| **shipped** (dip 0.5, rise 1.8) | 0.329 | **0.683** | **9** | 4 | **715 s** |
| dip 0.65, rise 1.5 | 0.400 | 0.665 | 18 | 4 | 742 s |
| dip 0.8, rise 1.2 | 0.494 | 0.610 | 55 | 4 | 851 s |

`missed` **does not move — 4 per 100 at every setting.** That is the whole result.
The extra sensitivity is not recovering notes the pipeline lost; it is cutting up
notes it had already found, so the re-onset recall gain is bought entirely with
spurious splits and repair time rises monotonically away from the shipped point.
On the metric denominated in what the product costs its user, the current
thresholds are a local optimum in every direction available.

The corollary is the useful one: this weakness is **not reachable by thresholding
amplitude at all**. Separating a re-articulation from a note-internal amplitude
wobble needs a channel that can see the *spectrum* change — which is exactly what
the literature reports (Yong et al. reach 0.90 re-onset recall with a phonetic
posteriorgram; our broadband accent experiment failed for the same reason). §3.2's
selective in-note SuperFlux splitter is the remaining model-free candidate.

Sanity check that the harness is faithful: re-detecting at the shipping constants
(`dip0.5 rise1.8`) reproduces the cached shipping onsets exactly — same COnP to
three decimals, same re-onset recall.

#### Why this had to be swept on the 10 ms grid

At *identical* thresholds, re-detecting from the cached 20 ms trajectory-grid
energy scores re-onset recall **0.218** where the same rule on the detector's own
**10 ms** envelope scores **0.329**. A re-articulation dip lasts ~30–50 ms, so
halving the frame rate leaves one or two samples of it and loses a third of them.
`TrackCache` v5 therefore stores the fine envelope and derives the shipping onsets
from that same array; `OnsetDetector` gained a `hopSec` option, without which every
duration threshold silently doubled when a harness drove `detectFromEnvelope`.

### Under heavy reverb the voice decode is neutral, and the mechanism is legible

A/B'd on the adverse tier (`echoey-room` RT60 0.9 s and `distant-mic` RT60 1.3 s),
voice datasets only. N20EMv2 has no degraded variants — `degrade-real.ts` has never
been run on it — so this rests on annotated-vocalset (800 clip/conditions) and
vocadito (80):

| dataset | baseline | voice decode | Δ |
|---|---|---|---|
| annotated-vocalset (800) | 0.210 | 0.218 | +0.008 |
| vocadito (80) | 0.446 | 0.390 | −0.056 |
| dataset-mean | 0.219 | 0.203 | −0.016 |
| repair time | 5140 s/100 | **4939 s/100** | −4 % |

Read this as **neutral**: the dataset-mean weights 80 clips equally with 800, and
per clip the two are within noise of each other. Both are also simply *bad* here
(0.21–0.25), which is the pre-existing reverb problem the findings log already
documents with a +0.14/+0.23 oracle ceiling still on the table.

The interesting part is why the gain disappears. Transition recall falls much
further in the voice arm under reverb (0.475 → 0.298) than it does dry
(0.781 → 0.709), and that is exactly the predicted failure of an evidence-gated
decode: **reverberation fills the dips the evidence channels read**, so the
discount stops firing and every boundary reverts to full price. Note this is a
*different* mechanism from the 2026-07 dead end "reverb fills the dips → tighten
the onset splitter" (which was false — splitter behaviour is material-dependent,
not room-dependent). Here the room really is what removes the evidence.

**Not acted on, deliberately.** Gating `applyVoice` on measured reverberance was
the obvious response and is the wrong move on this evidence: the effect is about
one MDE, it is carried by the smaller dataset, and `estimateReverberance` is
documented as a weak detector (46–70 % of reverberant takes clear the clean p90) —
the resolver applies it as a graded ramp precisely because it is too noisy to
threshold on. Revisit if a reverb-robust front end ever lands.

### The articulation tier's verdict: the voice decode LOSES on clean synthetic audio

The new tier (§9.2, `lib/synth.ts`) was built to stratify voice by articulation, and
the first thing it says is uncomfortable — scored adaptive, clean condition, voice
decode on vs off:

| scenario | semitone segmenter | voice decode |
|---|---|---|
| voice-alto (the old continuous-vowel proxy) | 1.00 | 1.00 |
| voice-plosive ("ta-ta-ta") | 1.00 | 1.00 |
| voice-continuant ("la-la-la") | 0.88 | 0.87 |
| voice-hum (closed mouth) | 0.93 | **0.81** |
| voice-legato (sustained vowel) | 0.93 | **0.68** |
| pooled | **0.946** | 0.871 |

This does **not** overturn the real-corpus result, and the reason is the point of
having both tiers. Synthetic singing here has ±8 cents of vibrato, exact intonation
and no breath — so the failure the voice decode exists to fix (wide vibrato
shattering held notes) does not occur, and all that is left to measure is its
merging. The real corpora, which are authoritative under research-benchmarks' tier
discipline, say +0.16 / +0.10 / +0.10 / +0.03 on the same change.

What the tier *does* establish, and nothing else could:

1. **Where the decode is weak is legato with no boundary evidence at all.**
   `voice-legato` is adversarial by construction — `dipFloor: 1`, no closure, no
   pitch dip, only a 70 ms portamento — and that is precisely where the note model
   merges (0.93 → 0.68) while a local semitone rule does not. Real singing always
   leaks *some* cue, which is why the real corpora do not show this. Treat it as the
   boundary of the decode's competence, not as a contradiction.
2. **Li et al.'s articulation spread reproduces.** Plosive 1.00 → continuant 0.87 →
   hum 0.81 → legato 0.68 is the same ordering (and nearly the same 19-point spread)
   the NLP4MusA 2021 paper measured on a different system. The evidence-backed user
   tip — *"if notes run together, try ta-ta-ta"* — now has in-house support.
3. **Re-onset recall is 0.000 on every legato scenario, in BOTH arms.** Neither
   decode finds a single same-pitch re-articulation when voicing never stops. That
   is the sharpest available statement of the weakest part of the voice flow, and it
   is a measurement the harness simply could not make before this tier existed.

⚠️ **A pre-existing corpus defect this exposed.** The synthetic melodies' *truth* has
always contained re-onsets — 7 per scenario, from the repeated notes in `tune` and
`rhythm` — but `synthesize` detaches every note by `gapSec` = 40 ms, so the rendered
audio disagrees with its own labels and those onsets arrive as trivially easy
silence-onsets. `voice-alto` therefore scores re-onset recall **1.000** and means
nothing by it; only the articulated scenarios, which honour the truth's timing, put
a real re-onset in the audio. Left unfixed deliberately: closing the gap would change
the bytes of every clip in the standing corpus and invalidate the numbers in this
log. Read any re-onset figure from a non-articulated synthetic scenario as an
artefact.

### A worked example of why `noteTruthDerived` datasets are excluded

mir-qbsh scores **0.64 → 0.55** under the voice decode — a 9-point *drop*, and not
a regression. Its note events are the harness's own derivation of the corpus's
frame-pitch labels (semitone-rounding plus run-grouping), i.e. the same algorithm
family as the segmenter the voice decode replaces, so a decode that stops
rounding-and-grouping necessarily agrees with them less. This is exactly the
failure mode the `noteTruthDerived` flag exists to keep out of the headline, and
the clearest demonstration of it the harness has produced. Do not "fix" it.

### Why the note HMM lost globally in 2026-07 and wins here

The July verdict ("every config −0.06…−0.16, do not reuse") was correct **and** its
stated diagnosis was incomplete. Two things were wrong with the earlier test, both
invisible without the metrics added this pass:

- It was scored on one global config across instruments *and* voice. On the voice
  slice alone the same family was already competitive on the product-relevant metric
  in July: repair time 271 s/100 notes vs the shipping segmenter's 1107, with
  missed = 1 vs 6.
- Its onsets were 50 ms early and nothing reported onset bias, so a calibration
  defect read as a modelling failure.

**What this means for the general rule:** "the HMM family is a dead end" is now false
as stated. The accurate version is *"a single global segmentation config cannot serve
both instruments and voice"* — which is what the July diagnosis actually said, and
which is why the fix was a profile flag rather than a better global config.

### Measured nulls this pass — do not redo

- **Octave prior at voicing onsets (E2).** No effect at any weight (0.677–0.684 vs
  0.679). The reason is worth keeping: with the new decode, measured octave-error
  rate is **0.001** and chromaF1 equals COnP to three decimals. There is nothing left
  to fix; the mechanism was sound, the failure it targeted no longer exists.
- **SiPTH sustained-deviation merge guard (E3).** Literally zero change on the voice
  decode at every (δ, Γ) — because a mandatory-silence decode never emits two
  *contiguous* ±1-semitone notes, so the guard has nothing to act on. On the shipping
  segmenter it is worth +0.007. Implemented and kept (`VoiceDecodeOptions.mergeGuard`,
  `guardOnly`) since it is the right tool if a future decode reopens that failure.
- **An in-decode re-onset transition (`reonsetCost` + `accentBonus`).** The
  principled version of the same-pitch-repeat problem — Ryynänen's accent feature
  inside the attack state — and a null **with the broadband RMS envelope we have**.
  Three findings, in the order they came:
  (a) as a pure transition it never fires — re-articulating the same pitch changes
  no emission, so it is pure added cost and a Viterbi will not take it however
  cheaply it is priced;
  (b) credited as an attack-state *emission* it fires, but the credit lands on every
  attack frame of every note, so re-onset recall rose 0.12 → 0.31 while transition
  recall fell 0.62 → 0.50 and COnP with it;
  (c) credited against the *transition* only — the correct construction — it is a
  clean trade with no sweet spot: at 0.5–1 nats it barely fires (recall 0.129), at
  2–4 nats recall reaches 0.29 but COnP collapses to 0.40–0.53 and onset bias runs
  to +40 ms. Broadband RMS rises inside a sustained note nearly as often as at a
  re-articulation, so the credit cannot discriminate. Reviving this needs Ryynänen's
  actual **band-wise** feature, not another sweep of these constants.
  ⚠️ The first run of (c) was invalid — `coalesce` rejoined same-pitch runs across a
  re-articulation whenever any short run elsewhere in the take triggered an
  absorption pass, silently undoing the transition. Fixed; the numbers above are
  from after.
- **A second, cheaper price for wide intervals (`wideChangeCost`).** One change
  cost has to price both "a semitone with no dip" (almost always vibrato) and "a
  fourth with no dip" (almost always a real slurred leap), and the cost that
  protects held notes forbids the leap. Splitting it in two works *mechanically* —
  every onset class improves at once (transition 0.65 → 0.74, re-onset 0.33 → 0.37,
  silence 0.91 → 0.92) — and still loses COnP (0.683 → 0.653), because precision
  falls faster than recall rises. The informative part is that **estimated repair
  time is flat across the entire sweep** (698–745 s/100 notes vs 715 shipped): the
  merge/split trade is on a frontier, not leaving anything on the table. The
  decode's remaining transition misses are the limit of pitch + energy, not a
  mis-set cost.
- **Voicing-gate sweep on the voice profile (E5).** 0.5 is already optimal (0.35 →
  0.664, 0.65 → 0.671, 0.5 → 0.682). The reverberance ramp still applies on top.

### What is still wrong with voice, in order

1. **Pitch, not boundaries.** `pWrong` is 15 per 100 reference notes — cleanly
   segmented, wrong semitone — and it is *not* octave error (octErr 0.001). This is
   now the largest single bucket, and it survived a direct attack: both published
   note-pitch estimators were implemented and measured (Molina's α-trimmed mean and
   Yong et al.'s Hann-weighted median) and they are equivalent overall (0.683 vs
   0.686, inside the MDE) while disagreeing about *which corpus to help* — Hann is
   +0.03 on N20EMv2's long notes and −0.02 on vocadito's short ones. Restricting the
   estimate to the post-glide part of the note (`pitchWindow: 'onset'`) has the same
   shape and is a net loss. Two independent estimators that cannot reduce it, and
   that trade one corpus against the other, is the signature of a modelling limit
   rather than a tuning one — the learned-note-model gap the N20EMv2 yardstick
   already identified.
   One caveat worth carrying: annotated-vocalset reads a **systematic semitone
   sharp** (+1: 18 % of notes, −1: 8 %) and does so *identically with the voice
   decode off*, so it is a property of that corpus's score-derived pitch labels, not
   of the pipeline. Do not tune against it.
2. **Re-onsets: 0.389 vs the shipping segmenter's 0.461.** The one place the new
   decode is behind. See the null above for what has been tried.
3. **Transitions: 0.650 vs 0.798.** The price of a decode that prefers silence
   between notes; the evidence discount recovers part of it, not all.

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
  ⚠️ **Superseded in part, 2026-08** — read "Why the note HMM lost globally in 2026-07 and wins
  here" in the voice findings log above before citing this row. The result stands *as a global
  config*; restricted to a voice profile, and with its 50 ms onset lead corrected, the same model
  family is now what ships for singing (+0.123 on held-out test).
- Older: noise-adapt actions + `afftdn` (neutral-to-negative), Viterbi jump floor (noise),
  tuning-offset correction (hurts — truth is absolute A=440), glide-note dropping by shape (eats real
  passing tones), median-IOI tempo (worse than fixed 120).
- **Tempo estimation entirely — a product decision, not a dead end**: the user records against a
  metronome at a tempo they chose; that tempo is authoritative. Do not re-add an estimator. (The
  measured stakes, kept as motivation for keeping the click honest: fixed-120 scores 0.245
  onset-beat F1 where the true tempo scores 0.714.)

### Three new corpora + two new scoring paths (2026-08-13) — and what measuring them exposed

Adopted `avp`, `dagstuhl-choir` and `jacrc-students` (all CC-BY-4.0; see the fetcher table and
`research-voice-datasets.md` §5). Two harness capabilities had to exist first:

- **`pitchless`** (`lib/realCorpus.ts`) — a corpus with real human-placed onsets but no pitch.
  Excluded from pooled note-F1 like `noteTruthDerived`, scored via MIREX **COn**. `scoreOnsets()`
  had been sitting unused in `lib/metrics.ts`; it is now wired in, and `run-eval` reports onset
  **precision and recall separately** because for some corpora only one of them is meaningful.
- **`GroundTruth.beatGrid`** (`types.ts`) + `beatsFromGrid()` (`lib/notation.ts`) — a hand-tapped
  beat axis, used in preference to the scalar `bpm`. One `bpm` cannot describe rubato; a grid can.
  **This gives `notation-eval.ts` its first real tempo on a voice corpus** (previously GuitarSet
  only, an instrument).

`lib/split.ts` gained performer grouping for all three at the same time — all three emit many
clips per performer, so the default per-clip fallback would have leaked the same voice into both
halves. Verified 0 leaked groups.

**Measured, `EVAL_REAL=1 EVAL_ADAPTIVE=1`, all three excluded from the headline by design:**

| dataset | COnP | COn | COnRec | split | missed | spurious |
|---|---|---|---|---|---|---|
| avp (280 clips) | 0.00 | 0.19 | 0.16 | 2 | **71** | 3 |
| dagstuhl-choir (102) | 0.01 | 0.13 | 0.18 | **28** | 20 | **36** |
| jacrc-students (175) | 0.01 | 0.28 | **0.52** | 60 | **3** | 42 |

🔴 **AVP is mis-scoped for `run-eval`, and only measuring it showed that.** It misses **71 of
every 100** onsets — not because the onset detector is weak, but because `run-eval` exercises the
*whole pitch-based pipeline*, and AVP is unpitched percussion: CREPE finds no notes, so no onsets
are ever emitted to score. The register's pitch — "a clean way to test `OnsetDetector` in
isolation" — is right about the corpus and wrong about the path. **To get value from AVP, drive
the onset detector directly (the `sweep-segmenter.ts` route), not `run-eval`.** Its `run-eval`
row should be read as a property of the harness wiring, not of the detector.

✅ **JaCRC behaves exactly as designed** and is the most informative of the three: **0.52
syllable-onset recall** with only **3 per 100 syllables missed entirely**. The high split (60) and
spurious (42) are the melisma effect predicted up front — in-melisma note onsets are correct
detections the syllable truth does not list — which is why its manifest says read recall, not F1.

⚠️ **Dagstuhl quantifies a warning that was previously only editorial.** vocadito's authors say
DCS stems are "not well suited for monophonic voice evaluation" because of bleed. Measured: COnP
0.01 with **28 splits and 36 spurious per 100 notes** — the pipeline over-segments badly on
bleed-laden legato choral audio, and the profile resolver flags every clip `NOISY` at ~0 dB SNR.
`notation-eval` accordingly gives beat-F1 **0.03** vs GuitarSet's 0.637. That number is *not*
evidence about the notation stage: transcription has already failed upstream, and the reference's
own pitch is 32 % more than 50 cents off. **Dagstuhl's worth is the beat-grid capability and the
rubato probe, not an accuracy score** — treat any headline use of it as a mistake.

(One real defect was found and fixed while checking that 0.03: the fetcher rebased excerpt *times*
to t=0 but left beat *numbers* absolute, so a late excerpt carried beats 380–420 against an
estimate counting from 0. Phase search was hiding most of it while making `beatF1lock` measure
nothing else. Beats are now shifted by whole bars, preserving metrical phase. The corrected score
is unchanged at ~0.03, confirming the cause is the audio, not the alignment.)

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
   **Status 2026-08-13:** `verstar/MRSAudio` is now live on HuggingFace (CC-BY-4.0, ungated,
   94k files) but the uploaded parts are MRSMusic (16 *instruments*) and MRSLife — **MRSSing,
   the solo singing, is still not there.** Still a watch item.
6. **Wire AVP to the onset detector directly.** The corpus is fetched and its truth is sound
   (9.8k human-placed onsets on real amateur audio), but `run-eval`'s pitch-based path cannot
   score unpitched percussion — see the 2026-08-13 entry. A `sweep-segmenter`-style runner
   would turn an already-paid-for corpus into the isolated onset benchmark we lack.

---

## Findings log (2026-08 plugin-source pass)

Execution of `plan-plugin-improvements.md` (the batched proposals from
`research-plugin-sources.md` §17). One entry per task, nulls included, as usual.

### R11: every frame-denominated knob is now hop-independent (2026-08-19)

Praat's convention (`research-plugin-sources.md` §6.1, §16.10), applied to the four constants
§16.10 lists: per-frame *costs* are now declared in nats **per 10 ms** and rescaled by
`hopSec / 0.01` at decode time; frame *counts* are now declared in **seconds** and rounded onto
the track's own grid per decode. A hop change can no longer silently re-tune the model, and the
hand-derived "3.4×" note in `note-segmenter.ts` is gone. `minFramesPerNote` (profile/provider
seam) deliberately stays in provider frames — it is converted where the frame grid is known
(`crepe-provider.decodeVoice`, the sweeps).

**Conversion table** — read this to translate historical sweep numbers:

| knob | was | now declared | at the 20 ms hop |
|---|---|---|---|
| `NoteSegmenterOptions.attackFrameCost` | 0.35 nats/frame | **0.175 nats / 10 ms** | ×2 → 0.35, unchanged |
| `NoteSegmenterOptions.minFrames` | 5 frames | **`minNoteSec` 0.1 s** | round → 5, unchanged |
| `VoiceDecodeOptions.attackFrameCost` | 0.35 nats/frame | **0.175 nats / 10 ms** | ×2 → 0.35, unchanged |
| `VoiceDecodeOptions.minFrames` | 4 frames | **`minNoteSec` 0.08 s** | round → 4, unchanged |
| basic-pitch `MIN_NOTE_LEN_FRAMES` | 11 frames | **`MIN_NOTE_LEN_SEC` 0.128 s** | ÷(256/22050) → 11, unchanged |
| basic-pitch `ENERGY_TOLERANCE` | 11 frames | **`ENERGY_TOLERANCE_SEC` 0.128 s** | → 11, unchanged |

Sweep-name translation: `e1c minFrames3/4/5/6` → `e1c minNote60/80/100/120ms`;
`e1c attackFrame0.15/0.35/0.7` (per frame) → `e1c attackFrame0.075/0.175/0.35` (per 10 ms).

**Verified bit-identical at the current hop** (every conversion is floating-point-exact:
`0.175 × (0.02/0.01) === 0.35` etc.): `sweep-segmenter.ts` (dev, 742 clips, all configs) and
`sweep-voice.ts` (dev, groups base+e1c+ship, 693 voice + 49 guard clips) both reproduce the
pre-change output to the last digit, including the paired-bootstrap CIs. No `CACHE_VERSION`
bump needed — the cached CREPE decode is upstream of everything touched.

### R15: joint duration × velocity note filters — null, and the mechanism is legible (2026-08-19)

WaoN's two-condition filters (`research-plugin-sources.md` §9.3) implemented behind options on all
three planned paths — `keepShortLoudRatio` (a short run survives the note floor when its peak
energy reaches k × the clip's median voiced energy) and `dropLongQuiet` (drop a note ≥ minSec long
whose mean energy sits below q × that median): `voice-note-decoder.ts`, `note-segmenter.ts`, and
`basic-pitch-provider.ts` (env-sweepable via `EVAL_KEEP_SHORT_LOUD` / `EVAL_LQ_QUIET` /
`EVAL_LQ_MINSEC`). `sweep-reverb.ts` gained `segment`/`vsName` config hooks (voice-decode rows,
anchored paired CIs incl. ΔP/ΔR) to measure them on the adverse tier they were built for.

**Every leg is a null.** The gate was "precision up on the adverse tier, recall unchanged":

- **Voice decode, adverse tier** (`sweep-reverb`, annotated-vocalset+vocadito dev, vs `voice OFF`):
  short-loud is *exactly* zero everywhere (Δ 0.000 on real/echoey-room/distant-mic — at
  changeCost 2.5 the decode emits essentially no short runs for the exemption to save). Long-quiet
  is zero-to-negative: echoey-room lq.45 ΔR −0.005*, ΔP −0.002; distant-mic lq.45 ΔP −0.007*,
  ΔR −0.012* — under reverb it removes real quiet notes, not tails.
- **Why the tail theory fails here:** a reverb tail never becomes a note on the trajectory path —
  CREPE's confidence collapses on tails, so the voicing gate has already eaten the thing the
  long-quiet filter was built to catch (same reason the 2026-07 gates/afftdn attempts were dead
  ends).
- **Clean corpus** (`sweep-voice` r15 group, 693 voice/49 guard; `sweep-segmenter`, 742 clips):
  lq ≤ 0.3 trims spurious (23→21 voice, 22→20 hmm) with recall intact — +0.002
  [+0.002,+0.003]*, real but far under the ~1 pt bar; lq 0.45 starts eating true notes.
  Short-loud on the HMM: +0.000 [−0.000,+0.001].
- **basic-pitch, very-high band** (run-eval, whistle-mid/high + piccolo × 7 conditions, fixed
  provider at the band's 500–4500 Hz window): baseline COnP 0.556; lq.3@.35s identical 0.556
  (pooled spurious is already 0/100 — nothing long-and-quiet exists to drop); keepShortLoud 1.5
  slightly WORSE at 0.552 (lowering the library floor readmits glitches the joint rule then keeps).

Options stay in the code, defaulted off, documented with these numbers. Do not re-sweep the same
grid; the one setting with any signal (lq ≤ 0.3) is worth revisiting only if a future front end
starts letting tails through the voicing gate.

### R19: voiced-fraction quorum before reporting pitch — null (2026-08-19)

The survey's fourth independent block-quorum design (outotune >¼ per block, Essentia ≥50 %/15 ms,
aubio median-of-6; `research-plugin-sources.md` §11.3/§7.2/§4.5), implemented as
`quorum?: { minFraction, windowSec }` on `PitchTrack.voicedMask` (demote-only: a frame that fails
the raw gate is never promoted) and plumbed through `voicedQuorum` options on both trajectory
consumers. **No `CACHE_VERSION` bump**, deviating from the plan's precaution deliberately: the
caches store cents/confidence/energy and the mask is derived downstream at decode time, so a
defaulted-off option cannot invalidate a cached byte.

**Null on its own target.** The claim was "spurious short notes fall on the reverb tier, clean
unchanged" (grid: minFraction 0.25/0.5/0.75 × window 60/120/200 ms, `sweep-reverb` voice rows
anchored on `voice OFF`, plus the `sweep-voice` r19 clean group):

- Mild quorums (≤0.5) are zeros everywhere; the best cell in the whole grid is echoey-room
  q.5w60 at ΔP +0.002 [+0.001,+0.004]* — real, microscopic, far under the ~1 pt bar.
- Strict quorums collapse under reverb, and the direction is the mechanism's own: reverb HALVES
  CREPE's confidence inside held notes (the 2026-07 diagnosis), so mid-note frames barely clear
  the gate and a strict neighbourhood vote guts exactly the notes it was meant to protect —
  q.75w120: echoey-room ΔR −0.081*, distant-mic ΔR −0.053*.
- The one tempting cell, q.75w60 (+0.006 over anchor on the clean VOICE slice), was checked on
  the adverse tier and is the same trade: echoey-room −0.027*, distant-mic −0.023* — a clean-only
  gain bought by breaking the condition the mechanism exists for.

Reading: the voice decode already has the quorum's job covered — the silence state prices stray
voiced flickers out of the path, and `minNoteSec` absorbs what leaks through. A frame-level vote
adds nothing on top of a note-level decode; the references that ship it (Essentia's Pitch2Midi,
outotune) have **no note-level decode** to lean on. Option stays, defaulted off.

### R21: single-frame dropout fill — fails its gate on clean voice, but is the largest reverb
### relief ever measured here (2026-08-19)

Deep Autotuner's `interpolate_pyin` (corrected to fill **unvoiced** frames only), as
`PitchTrack.fillDropouts` + `fillUnvoicedGapSec` options on both trajectory decoders. An unvoiced
run ≤ maxGap whose both flanks pass the gate gets interpolated cents and the quieter flank's
confidence. No cache bump (decode-time, defaulted off).

**The plan's two predictions both confirmed, and the second is why it cannot ship as-is:**

- `unvoicedPitchCost` flattens exactly as predicted: with fill on, u0.8/1.5/3 score identically
  (0.503 ×3); raw they spread (0.509/0.515/0.514). The cost was doing two jobs; the fill takes the
  trivial one.
- But "no regression anywhere" FAILS: the clean VOICE slice pays ~1 pt (0.515 → 0.503 at
  fill=20 ms, → 0.494 at 40 ms), concentrated in the legato/choir corpora (esmuc, csd, vocadito,
  n20emv2) — because **the 1–2-frame unvoiced dips ARE the legato boundary evidence**, and the
  fill erases them. chromaF1 also slides (0.520 → 0.511), the interpolated frames polluting
  `noteCents`.

**The bonus finding is the real news.** On the reverb tier (`sweep-reverb`, vs `voice OFF`):
fill40 +0.096*/+0.088* (echoey/distant), monotone to fill120 (+0.137*/+0.151*) — reverb halves
CREPE's mid-note confidence (the 2026-07 diagnosis), and the fill repairs exactly those punctures.
Against the standing reverb oracle (+0.14/+0.23 for a perfect front end), a reverberance-adaptive
fill (`fillSec = 0.15 × estimateReverberance`) captures **+0.125*/+0.153*** — most of the
echoey-room oracle — from the trajectory side, with sweep-reverb's own clean condition at −0.005
(n.s.).

**Why it still doesn't ship:** the gate isn't selective. `probe-reverberance.ts` (new diagnostic)
shows the distributions overlap — clean corpora sit at median 0 but with heavy tails
(annotated-vocalset clean p90 = 0.79, vocadito p90 = 1.00, n20emv2 p90 = 0.84) while some degraded
takes register 0 — so every gating variant tried (proportional, ×0.1…0.2; profile-locked 1.5/3 s)
still costs the broad clean VOICE slice −0.010…−0.016. A REVERB win bought with a clean-slice
dent is the same trade the house rule forbids for GUARD; off by default.

**Follow-ups recorded, in value order:** (1) a reverberance feature that does not false-fire on
sustained clean singing is now worth real effort — it unlocks ~+0.13 sitting in a merged option;
(2) exclude filled frames from `noteCents` (the chromaF1 slide says they pollute pitch naming);
(3) gap-statistics gating (count of 1–2-frame dropouts/sec) was considered and rejected on
mechanism: consonant dips and reverb punctures have the same width signature.

### R7: per-profile onset-delay constant — the knob now exists, and calibration says 0 (2026-08-19)

aubio's `delay` parameter (§4.2/§16.6 of the survey), added as `OnsetDetectorOptions.delaySec`
(signed; + = report later, since our detector reports the trough of the inter-note dip) and
`PipelineProfile.onsetDelaySec` for per-profile calibration, wired through `AudioConverter`.

**Calibrated on dev (sweep-voice r7 group, delay −30…+50 ms on BOTH consumers of the detector's
onsets), and the answer is 0:**

- Shipping segmenter path: overall onset bias at d0 is **−1 ms** — there is nothing to subtract.
  d±10–30 ms are zeros-to-negative; d+50 costs GUARD −0.018*. The historical output is the optimum.
- Voice-decode path: +10…50 ms trend +0.001 (inside noise, mde 0.015); the residual +19 ms mean /
  +29 ms median lateness there belongs to `onsetShiftSec` (70 ms), which the e1a/e1c sweeps chose
  on COnP over the bias-zero ~50 ms — deliberately, re-confirmed by this grid. Do not "fix" the
  bias to zero at the cost of the F1 optimum.

So the −52 ms target the plan quotes was already fully absorbed by the voice decoder's shipped
constant, and the re-attack detector — the one uncalibrated source — measures as needing no
correction. The knob ships (unset = 0) so any future profile that develops a bias has the aubio
mechanism waiting, and E5 (asymmetric confirmation delays) now has a single documented place to
put a compensation.

### R3: aubio's adaptive onset threshold — null, and the reason is structural (2026-08-19)

`adaptiveThreshold: { windowSec, k }` on `OnsetDetectorOptions`: onsets become local maxima of the
half-wave-rectified envelope rise that clear `movingMedian + k·movingMean` of their own
neighbourhood, replacing the fixed dip-then-rise state machine (§4.1/§16.5's five-for-five
"nobody ships a fixed threshold").

**Null everywhere, at every setting** (window 150/300/500 ms × k 0.5–4, both consumers, both
sweeps): the detector fires ~2× as often (est 21 → 40+ per clip on the trusted-3), precision
halves, and the least-bad cell (`w500 k4` on the voice path) is still −0.003 VOICE / −0.096*
GUARD. Under reverb it is −0.06…−0.10* on top of an already-degraded baseline.

The mechanism, worth keeping: the fixed "ratios" this was meant to replace are not mere
thresholds — **the dip requirement is a structural gate** (energy must genuinely leave the note
before a rise counts), and no threshold *level* on a plain RMS-rise novelty can substitute for it,
because vibrato/tremolo swells produce rises without dips at every dynamic. aubio's scheme
presupposes a real novelty function (spectral flux/HFC); applied to the broadband envelope it
answers a different question. **If R3 is ever revived, put the median+mean threshold on the
spectral-flux sidecar** (`lib/spectralFlux.ts`, already in the harness for the `flux` group) —
not on the RMS envelope. Option stays, defaulted off.

### R17/R4/§1.3: the survey's three remaining pitch estimators — all nulls (2026-08-19)

Three new `pitchEstimator` variants in `voice-note-decoder.ts`, tried in the doc's own order:
`'slew-limit'` (TalentedHack's rate limiter with momentum — arrives and holds), `'one-pole'`
(fat1's within-note smoother, hard reset per note), `'detrend'` (MXTune's per-note linear
detrend-then-centre). Swept on dev with the e8 SPLIT cleanup:

| estimator | vs SHIPPED (anchor +0.094) | pWrong/100 | chromaF1 |
|---|---|---|---|
| trimmed-mean (ships) | +0.094 | 17 | 0.522 |
| slew 30 ms | +0.094 (identical) | 17 | 0.522 |
| one-pole τ20 ms | +0.093 | 17 | 0.519 |
| slew 50 / pole 40 / detrend | +0.091 / +0.088 / +0.085 | 18 | 0.516→0.508 |
| slew 100 / pole 80 | +0.076 / +0.075 | 19–20 | ≤0.493 |

The pattern is monotone and unambiguous: **any smoothing gentle enough not to hurt reproduces the
trimmed mean's answer, and anything stronger strictly worsens semitone-level naming.** This is the
third estimator family to hit the same wall (after e8's Hann median and e6's onset-window), and it
closes the question: the residual `pWrong` ≈ 15–17/100 is not an estimator problem — it is the
learned-note-model gap the N20EMv2 yardstick measures. Variants stay in the code with these
numbers; do not sweep more smoothers.

### R20: the per-note intonation tier exists, and its gate passes (2026-08-19)

Deep Autotuner's synthetic de-tuning (§14.3), as five new conditions on the articulated voice
scenarios: `intonation-{0,20,40,60,80}c` — every note detuned by **exactly N cents, random sign**
(a controlled dose, deliberately not the synth's Gaussian `pitchScatterCents`, which stays the
realistic error model on the standing clips), clean acoustics, truth = the written notes, applied
detunes recorded per clip in a `.detune.json` sidecar. Real-audio detuning stays parked per the
plan. `generate.ts` reruns confirmed byte-safe: the regenerated clean condition reproduces the
standing articulation-tier numbers exactly (1.000/0.869/0.812/0.676 vs the logged
1.00/0.87/0.81/0.68).

**The hard gate — monotone accuracy loss with dose — passes** (adaptive production pipeline,
pooled over the four articulated scenarios):

| ±0¢ | ±20¢ | ±40¢ | ±60¢ | ±80¢ |
|---|---|---|---|---|
| 0.836 | 0.832 | 0.761 | 0.099 | 0.011 |

The shape is the mechanically-honest one: near-lossless below the rounding boundary, ~half the
notes lost at 40¢ (vibrato + trim decide which side of the line each lands on), collapse past
±50¢ where the nearest semitone is genuinely the wrong one. That collapse row is the tier's whole
value: past ±50¢ "transcribe what was sung" and "recover what the singer intended" diverge, and
COnP-against-written-notes measures the second. E2/E6/E8 are now measurable.

### E1: fractional pitch attached on the instrument segmentation path (2026-08-19)

Both trajectory segmenters (`segmentNotes` median mode and `segmentNotesBySemitone`) now attach
`pitchMidiFloat` — the median of the run's own voiced contour, absolute (A=440) — exactly as the
voice decoder does. No wire change; `pitchMidi` and every scored number are untouched (the eval
reads `pitchMidi` only), verified by re-running the sweep-voice base group: SHIPPED reproduces to
the last digit (VOICE 0.430, GUARD 0.805).

What this buys: the notation layer's tuning-aware spelling (`voice-notation.ts`, applied in
`MxmlBuilder`) acts on any note carrying the float and was previously voice-only by omission —
"notes without it (instruments, basic-pitch) pass through untouched". Trajectory instruments now
participate. On today's in-tune instrument corpora the offset estimator sits below its confidence
floor (`MIN_OFFSET_CONFIDENCE`), so behaviour changes only for genuinely off-grid takes — which is
the point. The measurable spelling benefit is judged with E8's instrument (accidental-spelling
error on the intonation tier + `notation-eval.ts` counters), where this float is a prerequisite;
E2 will additionally compare this in-process float against the contour-posteriorgram version on
the basic-pitch path.

### E2 (R1): the contour posteriorgram is NOT worth the wire — and it hides an off-by-one (2026-08-19)

`bench-contour-pitch.ts` (new): basic-pitch's contour head read offline on the very-high band
(whistle-mid/high + piccolo × 7 conditions, 96 clips), via the library's own
`addPitchBendsToNoteEvents` (Apache-2.0) plus a parabolic **sub-bin** refinement of the same
Gaussian-argmax. The plan's three questions, answered:

- **Q1 (tuning offset): the mechanism works, through a calibration constant.** Clean in-tune
  audio reads a constant **+33 ¢ ≈ exactly one contour bin** against `midiPitchToContourBin` —
  an off-by-one between the TS port's bin mapping and the model's actual contour grid (the
  detuned control reads −0.1 ¢ = +33 − 35, confirming the constant). After calibrating it, a
  known −35 ¢ global detune is recovered to ~2 ¢ by the sub-bin read; the library's **integer**
  bends are quantized to 1/3 semitone and recover 0.0 ¢ — structurally unable to see tuning.
- **Q2 (histogram): no change** (cosine vs truth 0.910 → 0.910) — offset-corrected rounding
  reproduces the integer pitches on this band.
- **Q3 (R5, contour note pitch): no change anywhere** — f1(int) = f1(sub) to three decimals on
  all seven conditions; aubio's frames-3..9 window *hurts* under reverb (echoey −0.006,
  distant-mic −0.032) because degraded notes are short enough that skipping the attack starves
  the median.

**Verdict: 0–1 of 3 pay → `inference.proto` does not change.** The fractional contour pitch
never alters which semitone is written on the one band that rides basic-pitch, and the notation
layer's offset machinery has nothing to correct there. Two by-products worth keeping: (1) the
one-bin mapping offset matters to ANY consumer of the TS port's `pitchBends` (e.g. a future
MIDI-with-bends export would be a third-tone sharp); (2) if real whistle/piccolo corpora ever
materialise with tuning error, the sub-bin read in this bench is the calibrated instrument to
revisit with.

### E3 (R9+R16): multi-candidate pitch track — killed by its own criteria (2026-08-19)

The headline experiment, fully built: `topKCandidates` extracts the 5 strongest activation maxima
per frame with sub-bin cents (`pitch-decoder.ts`), `PitchTrack` carries them, both caches store
them (`CACHE_VERSION` 6 / 2 — the rebuild this forced is done), and the voice decoder gained
pYIN's §5.6 emission behind `candidates` (nearest candidate per state + `yinTrust·−ln` relative
weakness) plus the §16.11 octave tie-break (`octaveBias`).

**Kill criteria were "beaten at k=3 AND k=5"; it lost at both** (dev VOICE slice, vs SHIPPED):

| config | VOICE | splits/100 | pWrong | chromaF1 |
|---|---|---|---|---|
| single-candidate anchor | **+0.095** | 13 | 17 | 0.520 |
| k=3 (y 0.5/1/2 identical) | +0.088 | 14–15 | 16 | 0.514 |
| k=5 | +0.078 | 16–17 | 16 | 0.507 |
| k=5 + octave tie-break | +0.075…+0.077 | 17 | 16 | 0.506 |

The failure is monotone in k and indifferent to `yinTrust` — it is the *availability* of
alternatives, not their weighting: every extra candidate is another place a pitch state can sit,
and the decode spends that freedom on splits (13→17/100) while buying only pWrong 17→16. The
octave tie-break has nothing to fix (octErr was already 0.006).

**Why pYIN needs this and we do not:** our per-frame trajectory is already Viterbi-smoothed over
the full 360-bin activation — frame-level continuity is applied *before* the note model — so the
note layer's candidate freedom re-admits exactly the stray maxima that smoothing removed. pYIN's
YIN candidates carry no frame-level smoothing; its note model is the only continuity there. The
"single-candidate approximation" the research doc worried about is not an approximation of pYIN —
it is a different, and for this front end better, factorisation of the same total smoothing.

Infrastructure stays (candidates on the track and in the caches — ~14 % blob growth): the decoder
option is documented-off with these numbers, and the per-frame candidates are the right input for
any future octave-repair or whistle-tracker work. Do not re-sweep this grid.

### E4 (R10): interval-proportional change cost + pitch memory across silence — both null (2026-08-19)

The survey's single strongest cross-reference (§16.7: pYIN's Gaussian, Praat's per-octave cost)
and its companion (§6.4/§5.2: a jump across a rest is not free), implemented as
`intervalChange: { form: 'gaussian'|'linear', σ/perOctave, capSemitones }` (capped scan replaces
the O(1) prefix/suffix relaxation — pYIN's maxJump 13 is what keeps it bounded) and
`silenceMemory: { perOctaveNats, amortize }` (Praat's greedy path-lookback: charge the interval
from the pitch the silence run left, optionally amortised by gap length).

**(a) Interval-proportional cost — the e7 flat frontier, now confirmed for smooth shapes.**
Grid: base changeCost {0.5,1,1.5} × gaussian σ {0.7,1.5,3} / linear {2,5,10} nats/octave, dev
VOICE slice. Steep shapes at base 1.5 reproduce the saturated flat anchor exactly (+0.095/+0.096
— the direct jump is again never taken); softer shapes do exactly what the theory promises —
transition recall 0.760 → 0.793 at linear c1.5 o2 — and COnP still falls (+0.085), because the
same cheapening splits held notes faster than it recovers slurs. Two tiers (e7), smooth Gaussian,
and smooth linear now all land on the same frontier: the decode's transition misses are not a
mis-priced cost at ANY shape. That closes R10(a) as a family, not a setting.

**(b) Silence memory — the prior is wrong for singing.** perOctave {1,3,6,12} × {amortised,
fixed}: the weakest settings equal the anchor (+0.096, inside mde), and every stronger one is
monotonically worse (fixed o12: +0.081, GUARD −0.072). Singers legitimately re-enter after a rest
anywhere in their register; a return-to-pitch prior taxes real phrase starts to prevent an octave
error that no longer occurs (octErr 0.006). pYIN needs per-pitch silence because its front end
produces octave candidates; ours does not survive to the note layer.

Both options stay, documented-off. With e7, r10a and r10b together: **stop trying to buy
transition recall with transition prices** — the remaining misses are the learned-note-model gap.

### E5 (R12): asymmetric confirmation + delay compensation — mostly not applicable, and the
### applicable part is now measured (2026-08-19)

Two of R12's three ideas do not map onto this pipeline, and saying so precisely is the finding:

- **Asymmetric onset confirmation** (Essentia's 75 ms note-on): our streaming commit unit is a
  WHOLE note — an onset is never committed before its offset — so there is no separate onset
  confirmation to shorten. (A tentative-note-on emission protocol would be a product feature, not
  a threshold.)
- **Delay compensation**: we report measured note times, never confirmation times, so there is no
  confirmation delay in any timestamp — and R7's calibration independently measured the reported-
  time bias at −1 ms. Nothing to subtract; nothing was being double-compensated.

The applicable third: `STABLE_MARGIN_SEC` (0.4 s) IS an offset confirmation — a note commits once
that much audio exists past its end. Now env-overridable (`RECORDING_STABLE_MARGIN_SEC`) and
measured with `check-streaming.ts` (paced-feed vs whole-buffer, 6 scenarios incl. all four
articulations × 2 melodies, margins 0.4/0.3/0.2/0.1):

| margin | paced vs whole-buffer |
|---|---|
| 0.4 (ships) / 0.3 | identical rows (incl. the same pre-existing 1-note cello quirk) |
| 0.2 | first divergence (voice-continuant tune 0.815 → 0.769) |
| 0.1 | broad divergence, 2-note deltas on the legato scenarios |

So 300 ms is validated-equal and 200 ms — Essentia's own default — is the measured edge, because
our margin is not confirming the note-off acoustically; it is confirming that CREPE's trailing
window context can no longer change the tail decode, a stricter requirement. **Default stays
0.4** (the check is 12 clips and the prize is 100 ms of mid-recording commit latency); anyone
wanting the latency has a measured, env-gated knob and this table.

### E6 (R13): the running-mean baseline earns its place as a baseline — not as a ship (2026-08-19)

(a) Essentia's `PitchContourSegmentation`, written from §7.1's prose (AGPL — never read/ported),
now lives in `sweep-segmenter.ts` as `runningMean` configs (island building against the note's own
accumulated mean; per-segment RMS z-cut). At ±80 ¢ it beats the LEGACY shipping segmenter pooled:
**+0.011 [+0.002, +0.020]*** over 742 dev clips — the survey's "cheapest thing that could
plausibly beat the semitone-run segmenter" claim confirmed. But the decomposition kills the ship:
the gain is entirely on VOICE corpora (vocadito 0.68→0.73, csd 0.57→0.66, hust 0.69→0.74), where
production routes to `VoiceNoteDecoder`, which beats rm80c decisively (annotated-vocalset 0.62 vs
0.38, n20emv2 0.68 vs 0.61); on the instruments the legacy segmenter actually serves it is a
wash-to-negative (guitarset +0.01, urmp-violin **−0.09**). So the 2026-07 lesson repeats in
miniature: segmentation quality is a property of the SOURCE, and the per-source routing already
banks what this baseline offers. It stays in the sweep as the calibration point it was meant to be.

(b) Tuning-first ordering re-measured on the widened corpus via the existing `tuningCorrect`
(2026-07: off, harmful vs absolute truth): −0.006 [−0.013, +0.002] — still a null, same reason
(the eval's truth is absolute; per-note scatter, not take drift, dominates). §7.1's "genuine
correctness point" is genuine only under tuning-relative truth, which is the notation layer's
domain — where the offset is already consumed.

### E7 (R6): splitting unvoicedPitchCost — an exact null, and the reason is the silence state (2026-08-19)

fat1's two-stage voicing decay as `unvoicedChangeRelease: { afterSec, discount }`: after N
consecutive unvoiced frames the note-change cost is discounted (down to 0) while
`unvoicedPitchCost` alone keeps pricing survival. Swept afterSec {40,80 ms} × discount
{0.5, 0.2, 0} on the dev VOICE slice: **every row reproduces the anchor to the last digit** —
even a FREE change after 40 ms of dropout is never on the winning path.

The structural reason, worth keeping: riding a dropout as a pitch state costs
`unvoicedPitchCost` = 1.5 nats/frame while the silence route costs `off + on` = 1.0 total, so any
gap long enough to trigger the release has already been taken through silence — where pitch
identity is forgotten globally. **The silence state IS the released path.** fat1 needs a two-stage
decay because it has no silence state: its only options are "hold the note" or "release
everything". In a three-state note model the two jobs R6 wants split are already assigned to two
different states, and the r10b silence-memory null says re-adding identity across that route hurts.
Option stays, documented-off; this also closes the "cheaper after R21" branch — R21 itself stayed
off, and the release is unreachable regardless.

### E8 (R2+R14/R18): take-key spelling fallback — built to its design, and it does not ship (2026-08-19)

Design first per the plan (`design-take-key.md`): TalentedHack's two-mask correction (take-key =
interpretation, score key = spelling; the score's `keyFifths` stays absolutely authoritative and
the take-key is a FALLBACK for keyless takes only), profile as a parameter
(Krumhansl/Temperley/diatonic), abstain competing as the incumbent (libKeyFinder's all-zeros
profile). Built as `estimateTakeKeyClasses` in `voice-notation.ts` (duration-weighted pitch-class
histogram over offset-normalised floats, 24-rotation Pearson), judged on the page by
`bench-take-key.ts` (new): spelling error + accidentals/100 against INTENDED notes on the
intonation tier, fallback on vs off.

**It does not ship, and both failure modes are the estimator's, not the wiring's:**

| detune | wrong% off→key | keyRight | abstain |
|---|---|---|---|
| ±0¢ | 1.8 → 1.8 | 9/16 | 0/16 |
| ±20¢ | 1.8 → **2.4** | 9/16 | 0/16 |
| ±40¢ | 31.1 → 32.2 | 7/16 | 0/16 |
| ±60/80¢ | 65.7→66.9 / 98.8→97.1 | 1/16 / 0/16 | 0/16 |

1. **The abstain-as-incumbent never fires** (0/80): Pearson against all-positive profiles on a
   12-bin histogram essentially never lands ≤ 0, so the survey's "cleanest possible answer" needs
   a real bar (a margin over the second-best key, or zero-mean chroma) before it means anything.
2. **Short diatonic takes under-determine the profiles**: on 15-note single-scale melodies the
   estimator recovers the actual key only 9/16 even at perfect intonation (relative-key and
   neighbour confusions — textbook K-S behaviour), and a wrong key snaps borderline notes AWAY
   from the intended spelling, which is exactly the "confidently mis-spelling" risk §8.2 warned
   about. The builder keeps the score-key-only mask; the estimator, design doc and bench stay for
   a future attempt with a real abstain bar and longer material.

That closes the plugin-improvements plan: 15 tasks executed, every outcome logged above.
