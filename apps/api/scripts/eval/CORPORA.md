# Corpus register

The single answer to "which corpora can actually carry a decision, and which are
merely here". Layout, trust, licence and gaps for every real dataset the harness
knows, plus the register of everything researched and *not* adopted. The deep
provenance arguments live in `research-voice-datasets.md` (voice),
`research-benchmarks.md` (datasets & metrics) and `research-whistle-corpus.md`
(whistling); this file is the index you read first.

## The two tiers

`scripts/fixtures/eval-real/` is split at the directory level
(`lib/realCorpus.ts` discovers both):

- **`benchmark/`** — numbers from these datasets may gate decisions. Entry
  criteria, all three: (1) human or expert ground truth on at least one axis,
  (2) a real human performance, (3) a licence that permits our commercial use
  at face value (CC-BY / CC-BY-SA / CC0 / MIT — see the licence-verdict rule in
  research-voice-datasets.md §0).
- **`context/`** — audio we keep because it covers material, registers or
  conditions nothing else does, but whose *numbers must never gate anything*:
  derived or unverified truth, constructed performances, or a research-only
  licence. Reported separately, excluded from pooled headlines and sweeps.

The tier is **placement and documentation, not mechanism**. What actually keeps
a dataset out of pooled numbers are the per-dataset flags (`noteTruthDerived`,
`constructedPerformance`, `pitchless`, `corpusSplit`) that run-eval.ts and the
sweeps always honoured — so moving a dataset between tiers never changes a
measured number. A dataset can sit in `benchmark/` while one of its axes is
flagged untrusted (dagstuhl-choir below). Fetchers write straight into their
tier; `import-note-labels.ts` promotes a hand-annotated dataset from `context/`
to `benchmark/` automatically once every clip is stamped `--verified-by`.

## Benchmark corpora (`eval-real/benchmark/`)

Voice — note-level truth (the pooled note-F1 headline):

| Dataset | Clips / notes | Truth provenance | Licence | Caveats that survive adoption |
|---|---|---|---|---|
| `vocadito` | 40 / 2,237 | Human annotation, two annotators (A1 scored, A2 kept → the 0.760 inter-annotator ceiling at ±100 ms) | CC-BY-4.0 | — |
| `annotated-vocalset` | 400 / 3,118 | Pitch = written exercise score; timing semi-automatic (pYIN-segmented, author-reviewed) | CC-BY-4.0 | Systematically semitone-sharp labels (findings log); timing approximate |
| `n20emv2` | 102 / 2,565 | Melodyne draft corrected by two music experts — best provenance in the harness | CC-BY-SA-4.0 | Tunable half (train+valid); song-opening selection bias |
| `n20emv2-test` | 18 / 357 | Same | CC-BY-SA-4.0 | **Confirm-only** external yardstick (`SWEEP_EXCLUDE=n20emv2-test`); publishes COnPOff 73.06 / COnP 79.56 / COn 93.66 |
| `esmuc-choir` | 271 / 16,955 | Manually corrected per-singer notes | CC-BY-4.0 | Real mic bleed — a genuine adverse condition, never a clean tier |
| `csd` | 96 / 3,580 | Tony-extracted, hand-corrected | CC-BY-4.0 | Truth is per SECTION (4 unison singers share one note file); bleed |
| `hust-solfege` | 73 / 3,671 | Human onsets + calibrated pitch | MIT | Durations derived from inter-onset gaps; per-file pitch-offset convention |

Instruments — note-level truth:

| Dataset | Clips / notes | Truth provenance | Licence | Caveats |
|---|---|---|---|---|
| `urmp-*` (13 instruments) | 48 / 1,326 | Score alignment + manually corrected pitch tracking by the URMP authors | CC0-1.0 | 2–4 clips per instrument — per-instrument strata are unpowered |
| `guitarset-solo` | 50 / 2,535 | Hexaphonic-pickup tracking, author-corrected | CC-BY-4.0 | Ring-over between plucked notes; comp (strummed) excerpts excluded |

Special-axis benchmarks (trusted truth on an axis other than note-F1):

| Dataset | Clips / truth | Benchmark axis | Licence | Caveats |
|---|---|---|---|---|
| `avp` | 280 / 9,778 onsets | Onset detection in isolation (COn) — human-labelled, no pitch anywhere in the chain | CC-BY-4.0 | `pitchless`: keep out of any pitch aggregate |
| `jacrc-students` | 175 / 5,175 syllable onsets | Onset recall on melismatic amateur voices | CC-BY-4.0 | `pitchless`; read RECALL, not F1 (syllable onsets ⊂ note onsets) |
| `dagstuhl-choir` | 102 / 20 beat grids | **The harness's only real tempo on singing** — hand-tapped, second-annotator-reviewed beat grids for notation-eval.ts | CC-BY-4.0 | Its NOTE truth is DTW score alignment → `noteTruthDerived`, never pooled; mic bleed |

## Context corpora (`eval-real/context/`)

| Dataset | Why it cannot gate | What it is for |
|---|---|---|
| `mir-qbsh` (50 / 1,082) | Note events are OUR derivation of self-labelled frame pitch ("no guarantee for their correctness"); licence is academic/research-only, which also bars product-relevant claims | Low-fi (8 kHz/8-bit) realism checks; f0/melody metrics only |
| `tinysol-*` (6 instruments, 64 / 512) | `constructedPerformance`: real Ircam tone, but WE spliced the melodies — no human phrasing, truth exact by construction | The only real audio in the `very-high` band (measured 0.654 vs 0.924 high); register questions |
| `whistle-real` (117 / 2,777) | Draft labels from `lib/sineTrack.ts`, zero clips human-verified → `noteTruthDerived` | The only real whistling we may use; **promotes to benchmark/ via `import-note-labels.ts --verified-by` once reviewed** |
| `whistle-vintage` (6 / 249) | Same unverified drafts; accompanied 78-rpm sides, adverse by nature | Real whistling + real accompaniment + real surface noise; never pool with whistle-real |

The **synthetic corpus** (`fixtures/eval/`, generate.ts) is a third thing:
truth exact by construction, phrasing synthetic, used for controlled-condition
tiers (adverse, intonation, capture-codec) — see the README's corpus layout.

## Gaps in the benchmark tier

The living version of the findings log's 2026-08-20 gap register. Corpus
*acquisition is exhausted* (research-voice-datasets.md §5, research-whistle-corpus.md §8):
each gap below means "record and annotate our own" or "build a harness
capability", not "find another dataset".

**Material with no benchmark-tier data at all:**
- **Whistling** — the flagship gap. All real whistling sits in `context/` on
  unverified draft labels. Two exits, both ours: (1) verify the drafted labels
  (`annotations/whistle-*`, then `import-note-labels.ts --verified-by=<name>`
  promotes automatically); (2) volume — record our own per the capture protocol
  in research-whistle-corpus.md §6. Nothing else exists to acquire.
- **The `very-high` band / piccolo** — only TinySOL splices (context). A real
  *performance* above ~700 Hz is unrepresented; piccolo has no permissive
  corpus at all.
- **Harmonica** — in the synthetic matrix, no real counterpart anywhere
  (research-voice-datasets.md §6k).

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
  specimen). Measured RIR/noise corpora to replace the modelled room/babble are
  cleared with DOIs (DEMAND, Arni, OK5 — research-voice-datasets.md §6b–6d) but
  not wired; new condition ids required so historical numbers keep meaning.
- N20EMv2 has no degraded variants (degrade-real.ts never run on it) — adverse
  voice evidence rests on annotated-vocalset + vocadito.
- Real out-of-tune singing with intended-note truth: the R20 intonation tier is
  synthetic by design; one real specimen (the Frère Jacques dogfood take).

**A label, not a corpus:** nothing marks "this clip carries neighbour bleed"
except dataset identity — three +0.02-class wins on choral material are waiting
on a bleed/ensemble annotation to gate them (findings log, per-band pass).

**Truth-quality limits inside the benchmark tier** (documented at each fetcher;
listed so nobody tunes against them): annotated-vocalset's semitone-sharp
labels; CSD's per-section truth; HUST's derived durations + pitch-offset
convention; dagstuhl's note events (flagged, excluded).

## Researched and not adopted

research-voice-datasets.md is the authoritative licence-and-provenance
register; research-whistle-corpus.md closes whistling; research-benchmarks.md
covers the instrument/benchmark side. The short version: **~90 candidates were
run through the three gates (licence → real audio → trustworthy note truth) and
every one failed at least one.** By failure mode:

- **Licence-barred (≈45)** — NC/ND/research-only/unlicensed. The painful near
  misses: Meertens Tune Collections (ideal shape, NC-SA, single rightsholder —
  the strongest possible acquisition target), Music Lab vocalization corpus
  (NC-SA), SSVD v2.0 (best annotation protocol found, no licence — worth one
  email), MIR-ST500 (unlicensed + YouTube audio), SingStyle111 (performer
  releases scoped to research), DAMP (withdrawn + research-only), Molina/ISMIR2014
  (NC and link-rotted). Full list: research-voice-datasets.md §2.
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
DEMAND noise beds, Arni/OK5 measured RIRs, MUSAN/FSDnoisy18k et al.
(research-voice-datasets.md §6b–d, research-benchmarks.md §5).

## Adding a corpus

1. Run the three gates (research-voice-datasets.md §0): permissive licence at
   face value → real recorded human audio → human/expert truth on the axis you
   will score. All three pass → fetcher writes to `benchmark/`; audio-only or
   derived-truth value → `context/`, with the honest flag set in dataset.json.
2. One dataset dir per instrument hint; a corpus with its own published split
   gets two dirs so the test half never enters a sweep (the n20emv2 pattern).
3. Record licence, provenance and every caveat in dataset.json, add the fetcher
   row to the README table, and add the dataset to the tables above.

## Corpora recorded via apps/eval

The eval workbench (`apps/eval`, `pnpm dev:eval`) creates corpora of generated
melodies and records our own performances of them, materializing straight into
this tree (`dataset.json` carries `source: "recorded in-house via apps/eval"`).
Their truth is *prescribed* — the generated notes are the labels and the
performer plays to a metronome — so the labels are exact but only as honest as
the take; the app's expected-vs-derived overlay is the review step. They
default to `context/`; move one to `benchmark/` (and add it to the table above)
only after its takes have been reviewed clip by clip. Licence is trivially ours.
