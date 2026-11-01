# Corpus register

The single answer to "which corpora can actually carry a decision, and which are
merely here". Layout, trust, licence and gaps for every real dataset the harness
knows, plus the register of everything researched and _not_ adopted. The deep
provenance arguments live in `research/research-voice-datasets.md` (voice),
`research/research-benchmarks.md` (datasets & metrics) and `research/research-whistle-corpus.md`
(whistling); this file is the index you read first.

## The two tiers

Every dataset also declares its **`material`** in `dataset.json` — `singing`,
`humming`, `whistling`, `instrument` or `vocal-percussion` — the axis
`benchmark.ts` groups by (`lib/realCorpus.ts` falls back to `kind` for manifests
that predate the field). It is descriptive only; pooling is still decided by the
flags below.

`scripts/fixtures/eval-real/` is split at the directory level
(`lib/realCorpus.ts` discovers both):

- **`benchmark/`** — numbers from these datasets may gate decisions. Entry
  criteria, all three: (1) human or expert ground truth on at least one axis,
  or complete resynth note truth (see _Resynth truth_ below), (2) a real human
  performance, (3) a licence that permits our commercial use at face value
  (CC-BY / CC-BY-SA / CC0 / MIT, or our own recordings — see the
  licence-verdict rule in research/research-voice-datasets.md §0).
- **`context/`** — audio we keep because it covers material, registers or
  conditions nothing else does, but whose _numbers must never gate anything_:
  derived truth, constructed performances, a research-only or NC licence, or an
  explicit opt-out. Reported separately, excluded from pooled headlines and sweeps.

The tier is **placement and documentation, not mechanism**. What actually keeps
a dataset out of pooled numbers is `isPooled()` in `lib/realCorpus.ts`: a dataset
pools unless it is `noteTruthDerived`, `pitchless`, `constructedPerformance` or
`licenceRestricted`, or says `pooled: false`. Sweeps also honour `corpusSplit`.
Moving a dataset between tiers therefore never changes a measured number. A
dataset can sit in `benchmark/` with truth on one axis only (jacrc-students:
human syllable onsets, `pitchless`). Each manifest also names its
**`truthSource`** (`human` | `resynth` | `derived` | `constructed` | `onsets`).
The benchmark reports its headline twice: over human-truth datasets only
(continuous with the history) and over every pooled dataset. Fetchers write
straight into their tier. A resynth dataset is moved by hand once its export
is complete (2026-10-31: whistle-real and whistled-high-register, `context/` →
`benchmark/`).

## Dataset index (2026-10-31)

Every real dataset, as `lib/realCorpus.ts` discovers it. The tables below carry
the provenance and caveats.

| Dataset                         | Tier      | Material         | Truth       | Clips / notes      | Pooled                       |
| ------------------------------- | --------- | ---------------- | ----------- | ------------------ | ---------------------------- |
| `vocadito`                      | benchmark | singing          | human       | 40 / 2,237         | yes                          |
| `annotated-vocalset`            | benchmark | singing          | human       | 400 / 3,118        | yes                          |
| `n20emv2`                       | benchmark | singing          | human       | 102 / 2,565        | yes                          |
| `n20emv2-test`                  | benchmark | singing          | human       | 18 / 357           | yes (confirm-only in sweeps) |
| `esmuc-choir`                   | benchmark | singing          | human       | 271 / 16,955       | yes                          |
| `csd`                           | benchmark | singing          | human       | 96 / 3,580         | yes                          |
| `hust-solfege`                  | benchmark | singing          | human       | 73 / 3,671         | yes                          |
| `dagstuhl-choir`                | benchmark | singing          | resynth     | 94 / 2,193         | yes                          |
| `jacrc-notes`                   | benchmark | singing          | resynth     | 175 / 12,496       | yes                          |
| `app-takes-singing`             | benchmark | singing          | resynth     | 52 / 1,675         | yes                          |
| `whistle-real`                  | benchmark | whistling        | resynth     | 117 / 2,243        | yes                          |
| `app-takes-whistling`           | benchmark | whistling        | resynth     | 19 / 597           | yes                          |
| `whistled-high-register`        | benchmark | whistling        | resynth     | 6 / 60             | yes                          |
| `urmp-*` (13 instruments)       | benchmark | instrument       | human       | 48 / 1,326         | yes                          |
| `guitarset-solo`                | benchmark | instrument       | human       | 50 / 2,535         | yes                          |
| `avp`                           | benchmark | vocal-percussion | onsets      | 280 / 9,778 onsets | no (pitchless)               |
| `jacrc-students`                | benchmark | singing          | onsets      | 175 / 5,175 onsets | no (pitchless)               |
| `humtrans` + `humtrans-aligned` | context   | humming          | derived     | 769 / 19,955       | no (derived, CC BY-NC)       |
| `mir-qbsh`                      | context   | humming          | resynth     | 50 / 782           | no (research-only licence)   |
| `whistle-vintage`               | context   | whistling        | resynth     | 6 / 297            | no (`pooled: false`)         |
| `tinysol-*` (6 instruments)     | context   | instrument       | constructed | 64 / 512           | no (constructed)             |

`humtrans-aligned` holds 18,853 notes. `mir-qbsh` keeps `noteTruthDerived: true`
next to its resynth truth: the export leaves that flag alone on a
licence-restricted set, so the research sweeps keep skipping it.

## Benchmark corpora (`eval-real/benchmark/`)

Voice — note-level truth (the pooled note-F1 headline):

| Dataset              | Clips / notes | Truth provenance                                                                                     | Licence      | Caveats that survive adoption                                                                                        |
| -------------------- | ------------- | ---------------------------------------------------------------------------------------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------- |
| `vocadito`           | 40 / 2,237    | Human annotation, two annotators (A1 scored, A2 kept → the 0.760 inter-annotator ceiling at ±100 ms) | CC-BY-4.0    | —                                                                                                                    |
| `annotated-vocalset` | 400 / 3,118   | Pitch = written exercise score; timing semi-automatic (pYIN-segmented, author-reviewed)              | CC-BY-4.0    | Systematically semitone-sharp labels (findings log); timing approximate                                              |
| `n20emv2`            | 102 / 2,565   | Melodyne draft corrected by two music experts — best provenance in the harness                       | CC-BY-SA-4.0 | Tunable half (train+valid); song-opening selection bias                                                              |
| `n20emv2-test`       | 18 / 357      | Same                                                                                                 | CC-BY-SA-4.0 | **Confirm-only** external yardstick (`SWEEP_EXCLUDE=n20emv2-test`); publishes COnPOff 73.06 / COnP 79.56 / COn 93.66 |
| `esmuc-choir`        | 271 / 16,955  | Manually corrected per-singer notes                                                                  | CC-BY-4.0    | Real mic bleed — a genuine adverse condition, never a clean tier                                                     |
| `csd`                | 96 / 3,580    | Tony-extracted, hand-corrected                                                                       | CC-BY-4.0    | Truth is per SECTION (4 unison singers share one note file); bleed                                                   |
| `hust-solfege`       | 73 / 3,671    | Human onsets + calibrated pitch                                                                      | MIT          | Durations derived from inter-onset gaps; per-file pitch-offset convention                                            |

Voice and whistling — resynth note truth (pooled; see _Resynth truth_ below):

| Dataset                  | Clips / notes | Truth provenance                                                                                 | Licence                       | Caveats that survive adoption                                                                                                                                                                                                                                                                   |
| ------------------------ | ------------- | ------------------------------------------------------------------------------------------------ | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dagstuhl-choir`         | 94 / 2,193    | Resynth, 94/94 passed 2026-10-31; the DTW score alignment is kept as `<clip>.truth-derived.json` | CC-BY-4.0                     | Quartet stems with mic bleed. Re-fetched as 94 clips after the 2026-10-30 float-stem fix (37f7ea02): every earlier dagstuhl number is void (FINDINGS.md, 2026-10-31)                                                                                                                            |
| `jacrc-notes`            | 175 / 12,496  | Resynth anchored on jacrc-students' human syllable onsets, 175/175 passed 2026-10-31             | CC-BY-4.0                     | Same audio as `jacrc-students` (hard links); amateur jingju, melismatic                                                                                                                                                                                                                         |
| `app-takes-singing`      | 52 / 1,675    | Resynth from a blind f0 segmentation, 52/52 passed                                               | internal — our own recordings | Real takes through the product recording chain (Opus, browser AGC and noise suppression), from `apps/api/debug/recordings` and `storage/recordings`. 40 takes of the 2026-06-17 batch were the vocadito corpus re-encoded through the server path and are excluded (`excluded` in dataset.json) |
| `whistle-real`           | 117 / 2,243   | Resynth with the `lib/sineTrack.ts` drafts as prior, 117/117 passed 2026-10-30                   | CC0 / PD / CC BY-SA, per clip | 112 Freesound CC0 previews + 5 Wikimedia Commons clips; the never-verified label-TSV drafts are kept as `<clip>.truth-derived.json`                                                                                                                                                             |
| `app-takes-whistling`    | 19 / 597      | Resynth from a blind f0 segmentation, 19/19 passed                                               | internal — our own recordings | Same capture chain as app-takes-singing; none duplicated an eval clip                                                                                                                                                                                                                           |
| `whistled-high-register` | 6 / 60        | Resynth with the performance-aligned prescribed melody as prior, 6/6 passed                      | internal — our own recordings | High register (f0 958–1838 Hz). The prescribed melody (12–13 st off the performance, COnP 0.00) is kept as `<clip>.truth-derived.json`; the `-aligned` copy was deleted 2026-10-31 (labels kept in `annotations/whistled-high-register-aligned/`)                                               |

Instruments — note-level truth:

| Dataset                   | Clips / notes | Truth provenance                                                        | Licence   | Caveats                                                            |
| ------------------------- | ------------- | ----------------------------------------------------------------------- | --------- | ------------------------------------------------------------------ |
| `urmp-*` (13 instruments) | 48 / 1,326    | Score alignment + manually corrected pitch tracking by the URMP authors | CC0-1.0   | 2–4 clips per instrument — per-instrument strata are unpowered     |
| `guitarset-solo`          | 50 / 2,535    | Hexaphonic-pickup tracking, author-corrected                            | CC-BY-4.0 | Ring-over between plucked notes; comp (strummed) excerpts excluded |

Special-axis benchmarks (trusted truth on an axis other than note-F1):

| Dataset          | Clips / truth                   | Benchmark axis                                                                                                        | Licence   | Caveats                                                          |
| ---------------- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------- | --------- | ---------------------------------------------------------------- |
| `avp`            | 280 / 9,778 onsets              | Onset detection in isolation (COn) — human-labelled, no pitch anywhere in the chain                                   | CC-BY-4.0 | `pitchless`: keep out of any pitch aggregate                     |
| `jacrc-students` | 175 / 5,175 syllable onsets     | Onset recall on melismatic amateur voices                                                                             | CC-BY-4.0 | `pitchless`; read RECALL, not F1 (syllable onsets ⊂ note onsets) |
| `dagstuhl-choir` | 94 clips, each with a beat grid | **The harness's only real tempo on singing** — hand-tapped, second-annotator-reviewed beat grids for notation-eval.ts | CC-BY-4.0 | Its note truth is resynth and pools (table above); mic bleed     |

## Licence standard (2026-09-01)

The product owner reset the bar: **a dataset is usable when our use of it is
defensible — internal evaluation, nothing redistributed, nothing of it entering
the product.** The dataset's own published record still governs at face value
(no upstream archaeology), and a permissive licence (CC-BY / CC-BY-SA / CC0 /
MIT / Apache) is still what the **benchmark tier** requires. What changed is
the context tier: NC and research-only corpora may now be fetched and reported
there, flagged `licenceRestricted: true` in `dataset.json`, shown with their
licence wherever their numbers appear, never pooled, never gating, and never
part of anything we ship. Delete the directory if the decision changes.

## Context corpora (`eval-real/context/`)

| Dataset                                                                                    | Why it cannot gate                                                                                                                                                                                                                                                                                                                                                  | What it is for                                                                                                             |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `humtrans` (769 / 19,955, the corpus's own test split) + `humtrans-aligned` (769 / 18,853) | **CC BY-NC 4.0 → `licenceRestricted`**; truth is the reference MIDI the hummer followed (exact identity, nominal timing). The aligned sibling takes onsets from the audio via `fetch/align-prescribed-truth.ts`; both stay `noteTruthDerived`. Resynth: 1 pilot clip exported, 768 held until Karel decides the scope; `humtrans-aligned` is the prior for that run | **The only real humming with note truth anywhere.** 10 hummers, 44.1 kHz. Drives the benchmark's _provisional_ humming row |
| `mir-qbsh` (50 / 782)                                                                      | Licence is academic/research-only → `licenceRestricted`. Note truth is resynth since 2026-10-31 (50/50 passed; the `.pv`-derived notes are kept as `<clip>.truth-derived.json`)                                                                                                                                                                                     | Low-fi (8 kHz/8-bit) hummed/sung realism checks; the second humming context set                                            |
| `tinysol-*` (6 instruments, 64 / 512)                                                      | `constructedPerformance`: real Ircam tone, but WE spliced the melodies — no human phrasing, truth exact by construction                                                                                                                                                                                                                                             | The only real audio in the `very-high` band (measured 0.654 vs 0.924 high); register questions                             |
| `whistle-vintage` (6 / 297)                                                                | Resynth truth (6/6 passed), but accompanied 78-rpm sides, adverse by nature → `pooled: false`                                                                                                                                                                                                                                                                       | Real whistling + real accompaniment + real surface noise; never pool with whistle-real                                     |

Two **synthetic corpora** are a third thing: truth exact by construction, never
in the real tiers — see the README's corpus layout.

- `fixtures/eval/` (generate.ts): the original toy corpus, fluidsynth and additive
  voices, used for controlled-condition tiers (adverse, intonation, capture-codec).
- `fixtures/eval-synth/` (the standalone `synthetic-corpus/` project, `EVAL_SYNTH=1`,
  `benchmark.ts --synth`): the **realistic synthetic corpus**, v1.1, 463 clips over
  36 instrument timbres and 8 voice types. It is rendered from real recordings
  (sample libraries, VocalSet singers), performed along the click and recorded
  through measured rooms and phone microphones. Changes found on it ship only once
  the real corpus agrees (FINDINGS.md, 2026-09-27).

## Measured-RIR tier (opt-in conditions, 2026-11-01)

Two adverse conditions convolve the real takes with **measured** room impulse
responses instead of the modelled exponential rooms (`fetch/fetch-rirs.ts` →
`fixtures/eval-rir/`, `scenarios.ts` `rir-near` / `rir-far`). They are `optIn`:
never in a default condition list, never pooled into a headline, scored only
with `benchmark.ts run --conditions rir-near,rir-far`. Generated
(`DEGRADE_CONDITIONS=rir-near,rir-far fetch/degrade-real.ts`) for vocadito,
annotated-vocalset, guitarset-solo and the 13 URMP sets, both splits.

| condition  | source (DOI, licence)                                                                                                                       | member                                            | RT60 (T30, 0.5/1/2 kHz mean) | DRR      | receiver |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ---------------------------- | -------- | -------- |
| `rir-near` | Arni variable-acoustics room, Aalto Acoustics Lab (Prawda, Schlecht, Välimäki 2022), `10.5281/zenodo.6985104`, **CC-BY-4.0** (record field) | `IR_numClosed_40_numComb_3942_mic_4_sweep_1.wav`  | 0.80 s                       | −2.5 dB  | 4, ≈1.7 m |
| `rir-far`  | same record                                                                                                                                 | `IR_numClosed_55_numComb_0_mic_3_sweep_1.wav`     | 1.27 s                       | −10.8 dB | 3, ≈2.9 m |

They are the measured twins of `echoey-room` (modelled 0.9 s / +2 dB) and
`distant-mic` (1.3 s / −4 dB), one milder and one harsher, and exist so a reverb
conclusion drawn on the modelled rooms is checked on a real one before it ships
(the 2026-11-01 degrade defect showed the modelled chain can manufacture a
feature). Conditioning follows synthetic-corpus's `RoomIR` (direct path at
0.5 ms, tail cut at the noise floor); the IR's mean power gain over 200 Hz–4 kHz
is −3 dB, and each variant gets one static gain keeping its peak ≤ −1 dBFS (a
measured room builds up at its modes; at a fixed gain 69 of 1,076 variants
clipped). Arni has no receiver nearer than ≈1.5 m. **OK5**
(`10.5281/zenodo.18622201`, CC-BY-4.0, 25 real work rooms at 1.5/2/3 m) is the
cleared room-diversity follow-up; it ships SOFA/HDF5, which the TypeScript
harness cannot read without a new dependency.

## Resynth truth (2026-10-30/31)

Every dataset marked `resynth` above got its note truth from `synthcorpus.resynth`
(method, conventions and file formats: `synthetic-corpus/RESYNTH.md`). An agent drafts a
note list, a copy is rendered from it, a second agent compares copy and original and
sends it back until they match, and the notes are then read from the copy. Per clip
the export writes `<clip>.truth.json` (the resynth truth), moves the previous truth
once to `<clip>.truth-derived.json`, and adds `<clip>__resynth.flac` (the copy) and
`<clip>.f0.json` (both contours). A clip the judge never passed gets
`<clip>.truth-unresolved.json` instead and the harness skips it (none so far). The
durable record is `annotations/resynth/<dataset>/<clip>.resynth.json` (git-tracked). A
dataset switches to `truthSource: "resynth"` only when every clip is exported.

Calibration: the same loop was run blind on clips with human truth and scored against
it (COnP@100 ms). The yardstick is a second human annotator: vocadito A2 vs A1. The
numbers are in the progress log of `meta/test-data-2026-10.md` (entries of 2026-10-30
19:55 and 2026-10-31 03:15–03:31). In short: on vocadito, resynth vs A1 is 0.643 and
the best match against either annotator is 0.707, against the annotators' own 0.732
(n = 9); n20emv2/hust 0.652 (n = 9). Almost every disagreement is a convention
(same-pitch sung syllables merged, ornaments under 150 ms folded into a neighbour,
±1 st on notes between semitones). Only 6 of 423 unmatched annotator notes were truly
missed. The v4 convention (split same-pitch syllables when in doubt) brought the next
canary to 0.760 vs A1, against A2-vs-A1 0.717.

## Gaps in the benchmark tier

The living version of the findings log's 2026-08-20 gap register. Corpus
_acquisition is exhausted_ (research/research-voice-datasets.md §5, research/research-whistle-corpus.md §8):
each gap below means "record and annotate our own" or "build a harness
capability", not "find another dataset".

**Material with no benchmark-tier data at all:**

- **Humming** — a primary product input with **no benchmark-grade corpus**: no hummed
  corpus anywhere carries human note truth under a permissive licence. Since 2026-09-01
  the benchmark shows a _provisional_ humming row from the context tier — `humtrans`
  (CC BY-NC, reference-MIDI truth repaired by audio alignment; the only hummed audio
  with note truth in existence) and `mir-qbsh`. Still barred: CHAD (NC, retrieval-only,
  no truth), MLEnd Hums & Whistles (no licence stated, Kaggle login required, and no
  reference melodies — the eight songs are in-copyright). **MTG-QBH** (118 hummed/sung
  queries, 17 amateurs, laptop mic) is CC-BY-4.0 on its own Zenodo record and is now
  ADOPTABLE under the face-value rule — but it has no note truth, so it is an
  annotatable-audio lead, not a fetch. Resynth truth does not change this: both
  hummed sets stay in `context/` on their licences (humtrans's resynth run is held
  for Karel's scope decision). Closing the gap for real = record beta users humming
  _freely_ (not to a click) and resynth or annotate the takes; consent language is
  already in the terms.
- **The `very-high` band / piccolo** — only TinySOL splices (context). A real
  _performance_ above ~700 Hz is unrepresented; piccolo has no permissive
  corpus at all.
- **Harmonica** — in the synthetic matrix, no real counterpart anywhere
  (research/research-voice-datasets.md §6k).

**Material whose benchmark data is resynth, not human:**

- **Whistling** — closed as a gap on 2026-10-30/31. **Whistling now has
  benchmark-grade truth**: `whistle-real` (117), `app-takes-whistling` (19) and
  `whistled-high-register` (6), 142 clips in `benchmark/`, all resynth and pooled.
  `whistle-vintage` stays context (`pooled: false`). No whistling corpus with human
  note labels exists anywhere (re-searched 2026-09-01, research-whistle-corpus.md §8),
  and none of the label-TSV drafts was ever verified (`VERIFY-WORKLIST.md` is kept as
  history), so whistling appears in the all-pooled headline but not in the human-only
  one. More volume = record our own per research/research-whistle-corpus.md §6 and
  resynth it.
- **Real in-app takes** — `app-takes-singing` (52) and `app-takes-whistling` (19) are the
  first real performances through our own capture chain (Opus, browser AGC and noise
  suppression). The 40 vocadito re-encodes and the 157 soundfont 'instrument' takes
  were excluded at triage.

**Benchmark strata too thin to power conclusions:**

- Low/high-band instruments: 6 / 5 real clips (URMP is 2–4 × 15 s per
  instrument) — register-specific instrument questions are unanswerable.
- Solo high-register voice: the stratum is almost entirely choral bleed stems
  (ESMUC/CSD sopranos) — "tuned for the high band" means tuned on bleed.
- Low-register voice: ~⅔ annotated-vocalset operatic males; amateur low solo
  singing would fix it.

**Conditions:**

- No genuinely RECORDED adverse takes — the adverse tier is synthetic
  degradation of real performances (whistle-vintage is the one real-adverse
  specimen). Since 2026-11-01 two MEASURED rooms (Arni) exist as the opt-in
  `rir-near` / `rir-far` conditions (above); DEMAND noise beds and OK5's room
  diversity are cleared with DOIs (research/research-voice-datasets.md §6b–6d)
  but not wired; new condition ids required so historical numbers keep meaning.
- N20EMv2 has no degraded variants (fetch/degrade-real.ts never run on it) — adverse
  voice evidence rests on annotated-vocalset + vocadito.
- Real out-of-tune singing with intended-note truth: the R20 intonation tier is
  synthetic by design; one real specimen (the Frère Jacques dogfood take).

**A label, not a corpus:** nothing marks "this clip carries neighbour bleed"
except dataset identity — three +0.02-class wins on choral material are waiting
on a bleed/ensemble annotation to gate them (findings log, per-band pass).

**Truth-quality limits inside the benchmark tier** (documented at each fetcher;
listed so nobody tunes against them): annotated-vocalset's semitone-sharp
labels; CSD's per-section truth; HUST's derived durations + pitch-offset
convention; the resynth conventions (RESYNTH.md "Truth conventions": vibrato,
scoops and ornaments under ~150 ms fold into a neighbour).

## Researched and not adopted

research/research-voice-datasets.md is the authoritative licence-and-provenance
register; research/research-whistle-corpus.md closes whistling; research/research-benchmarks.md
covers the instrument/benchmark side. The short version: **~90 candidates were
run through the three gates (licence → real audio → trustworthy note truth) and
every one failed at least one.** By failure mode:

- **Licence-barred (≈45)** — NC/ND/research-only/unlicensed. The painful near
  misses: Meertens Tune Collections (ideal shape, NC-SA, single rightsholder —
  the strongest possible acquisition target), Music Lab vocalization corpus
  (NC-SA), SSVD v2.0 (best annotation protocol found, no licence — worth one
  email), MIR-ST500 (unlicensed + YouTube audio), SingStyle111 (performer
  releases scoped to research), DAMP (withdrawn + research-only), Molina/ISMIR2014
  (NC and link-rotted). Full list: research/research-voice-datasets.md §2.
- **No usable note truth (≈30)** — built for classification/retrieval/phonetics,
  so no onsets: Cantoría (f0 only), Belyk sung+whistled imitation (mean F0 per
  note, no timing — the "only clean whistling pitch data in existence" and still
  unusable), HumTrans (misaligned reference score, also NC), PJS's shipped MIDI
  (the guide melody, not the performance). §4–§5 of the voice register.
- **Not actually obtainable** — never released, dead links, bot-gated,
  auth-walled: Viitaniemi 2003, PJS audio (Drive quota), MRSSing (announced
  CC-BY, never uploaded), Cadenza CLIP1 (mapping unpublished).
- **Wrong material** — polyphonic mixes, synthetic voices, unpitched
  beatboxing, in-copyright compositions (the Pink Panther whistles stay behind
  `WHISTLE_INCLUDE_ENCUMBERED=1`).

**Watch items** (re-check occasionally, do not re-search the world):
PJS audio (labels already in hand, one curl to retry) · MRSSing upload ·
SSVD/AID/CSD-re-annotation licence answers · Cadenza CLIP1 mapping ·
paid routes if ever wanted (Meertens, Deeply, Opencpop).
**Cleared but unwired** (adverse-tier upgrades, decisions already made):
DEMAND noise beds, OK5 measured RIRs (Arni is wired: the opt-in measured-RIR
tier above), MUSAN/FSDnoisy18k et al.
(research/research-voice-datasets.md §6b–d, research/research-benchmarks.md §5).

## Adding a corpus

1. Run the three gates (research/research-voice-datasets.md §0): permissive licence at
   face value → real recorded human audio → human/expert truth on the axis you
   will score. All three pass → fetcher writes to `benchmark/`; audio-only or
   derived-truth value → `context/`, with the honest flag set in dataset.json.
   Audio without truth can earn it through resynth (one `DatasetConfig` line in
   `synthetic-corpus/synthcorpus/resynth/datasets.py`); a permissive set whose
   export completes moves to `benchmark/` and its config tier with it.
2. One dataset dir per instrument hint; a corpus with its own published split
   gets two dirs so the test half never enters a sweep (the n20emv2 pattern).
3. Record licence, provenance and every caveat in dataset.json, add the fetcher
   row to the README table, and add the dataset to the tables above.

## apps/eval

`apps/eval` is the benchmark viewer (results, timeline, original ↔ resynth copy ↔ notes); it no longer records or generates corpora.
