# Whistling: the corpus question, answered — 2026-08-20

**The one-line answer: there is no whistling corpus, and there will not be one. Build it.**

This file exists because "whistling has zero real test data" has been an open item in the
README's findings log since 2026-07 and was re-listed in the 2026-08-20 gap register with the
instruction *"→ team-decision bullet"*. This is the sweep that closes the acquisition question
so nobody re-opens it: every route to whistling audio was checked, with the evidence attached,
and the conclusion is that **acquisition is exhausted at ~34 seconds of clean modern whistling
and ~3 minutes of accompanied public-domain art whistling** — all of which is now fetched,
drafted and wired in — and that everything beyond that has to be recorded by us.

Companions: `research-voice-datasets.md` (the licence-and-provenance register; its §0 gates and
its acquisition policy govern here too) · `research-benchmarks.md` (how to measure) ·
`README.md` findings log + real-corpus gap register (what we have measured).

---

## 0. Why whistling deserves its own file

It is the input mode with the widest gap between **how much users will use it** and **how much
we know about it**:

- The pipeline has a whistle profile (`instrument-ranges.ts`: `whistle: 500–4300 Hz`), a
  `whistle` `SourceKind`, two synthetic scenarios (`whistle-mid` root C6, `whistle-high` root
  F♯6), and a dedicated very-high-band provider decision (`crepe-pitchdown-provider.ts`,
  gated `RECORDING_VERY_HIGH_CREPE`).
- Every one of those was tuned and validated on **synthesis** — `lib/synth.ts` renders a
  whistle as at most two harmonics with 0.4 % vibrato and 1.2 % noise. The 2026-08-20
  provider-routing census confirmed the consequence: **zero real pitched clips in the corpus
  reach the `very-high` band**, so both the shipping path and its replacement are
  synthetic-validated only.
- Whistling is also the register where the pipeline's known failure modes concentrate: a
  near-sinusoidal source (no harmonics for a harmonic-sum tracker to lean on), fundamentals
  above CREPE's 1975.5 Hz ceiling, portamento between notes, and an amplitude envelope with
  no consonant to mark a re-onset.

So the value of even a *small* real whistle corpus is not statistical power — it is finding out
whether the synthetic tuning transfers at all.

## 1. The gates, restated for whistling — and the one that is different

`research-voice-datasets.md` §0's four gates apply unchanged (real human production;
note-level onset+offset+pitch; annotation provenance independent of our estimator; commercial
licence). Two whistling-specific notes:

**Gate 2 is where every candidate dies.** Not one whistling dataset in existence carries note
events. The datasets that exist were built for *classification* (is this whistling?),
*retrieval* (which song is this?) or *phonetics* (whistled speech) — none of which needs an
onset.

**Gate 3 is easier here than anywhere else, and that is a trap.** A whistle is a single
near-sinusoidal partial 15–30 dB above the rest of the spectrum. Measured on the audio adopted
below (`lib/sineTrack.ts`, 2048-point FFT, 10 ms hop): **0.95 of a voiced frame's spectral
energy sits in the peak's three bins** on clean modern whistling (`commons-donna`). So
"strongest peak in 0.4–5 kHz" is closer to a *reading* than an estimate, and a draft
annotation from it is genuinely useful — it saves an annotator most of the work while leaving
every decision that matters (is this one note or two? where does it start? is it an octave
out?) to a human.

The trap: the README's open direction 4 is **"whistle-specific FFT peak tracker"**. If we ship
that, this drafter becomes its sibling, and any label that was never human-corrected turns into
self-measurement — the exact mechanism that made mir-qbsh drop 0.64 → 0.55 under a *better*
decoder (§0's gate 3). Hence the mechanism in `fetch/import-note-labels.ts`: a clip whose
`.meta.json` still says `verifiedBy: null` keeps the dataset flagged `noteTruthDerived`, which
run-eval already honours by scoring and reporting it while keeping it out of the pooled
headline. **Verify the clips and the flag flips off by itself; ship an FFT tracker before
verifying and the numbers become circular.**

## 2. Definitive negatives — checked, with the evidence

### 2a. ⛔ No note-annotated whistling corpus exists anywhere

Searched: the ISMIR dataset index (`ismir/mir-datasets`), `mirdata` and `soundata` registries
(the mirdata enumeration was already a definitive negative in §2 of the register), Zenodo
(dataset-type queries for *whistled melody*, *whistling recordings*, *query by whistling*),
Dryad, OSF, OpenSLR, HuggingFace datasets, Kaggle, arXiv 2024–2026. Every hit is one of:
whistled *speech*, animal whistles (dolphins, birds, marmots), referee/kettle whistles, or
whistling as a *class label* with no timing. The two academic works on whistling transcription
(a Técnico Lisboa thesis on "Automatic Transcription of Musical Whistling"; Ghosh et al. on
embedded whistle pitch detection) evaluate on private audio and publish none.

### 2b. ⛔ FSD50K — no `Whistling` class at all

Worth recording because it looks like the obvious answer (200 human-labelled Freesound classes,
CC-BY, per-clip licences). Downloaded `FSD50K.ground_truth.zip` (334 kB) and read
`vocabulary.csv`: **zero of the 200 classes match `/whistl/i`.** The human-sound classes it does
carry are `Human_voice`, `Male_singing`, `Female_singing`, `Singing`, `Whispering`,
`Human_group_actions`. AudioSet's ontology *does* have `Whistling` (`/m/01w250`) — FSD50K
simply did not include it. Do not re-check this.

### 2c. ⛔ AudioSet / VGGSound — the class exists, the audio is not licensable

AudioSet's labels are CC-BY, its *audio* is YouTube video IDs. There is no grant over the
recordings, the set decays as videos are deleted, and downloading is against YouTube's terms.
Same for VGGSound and AudioCaps. This is a licence dead end, not a data dead end — nothing to
chase.

### 2d. ⛔ MLEnd Hums and Whistles — the largest whistling collection in existence, unlicensed

**6,000 audio files, 8 songs, 235 interpreters** (QMUL, Data Science and AI Teaching Group,
via Kaggle: `jesusrequena/mlend-hums-and-whistles`, 16.5 GB). It is exactly the corpus this
project would want, and it cannot be used:

- Kaggle's own metadata API for the record returns `"licenseNameNullable": "Unknown"`,
  `"licenseName": "Unknown"`. The sample dataset (`…-sample`, 250 MB) reports `Unknown` too.
- Neither `mlenddatasets.github.io` nor `mlend.readthedocs.io` states any licence or terms.

Per the acquisition policy, **no licence at all is not a grant** (the SSVD / MIR-ST500 rule).
And even with one, the eight songs are Harry Potter, Star Wars, Pink Panther, Frozen, Hakuna
Matata, Mamma Mia, The Greatest Showman and a Bond theme — all in-copyright compositions, i.e.
the §1e problem at full scale. **Verdict: KILL.** The only route would be QMUL publishing a
licence, which would still leave the composition question; do not chase it.

### 2e. ⛔ Silbo Gomero Speech Corpus (OpenSLR 137) — CC BY-NC-SA

49 minutes, 4 fluent whistlers, read whistled Spanish with transcripts. Whistled *speech* is
not melody, but acoustically it is the same production mechanism in the same band, so it would
have been a real pitch-tracker stress test. Licence: **Attribution-NonCommercial-ShareAlike
4.0** → barred by §4.0 (NC restricts use, not only redistribution). Closed.

### 2f. ⛔ AID (Anechoic Interferer Dataset) — licence self-contradiction, treat as NC

Zenodo `10.5281/zenodo.6974033` looked like a small win: 43 domestic sound-source types
recorded **anechoically** with three microphones, and `whistle` is one of them. Downloaded and
inspected (283 MB):

- Content: `AID/wavs/whistle_{01..04}_{RHODE_NT1,RHODE_NT5,SH_MKH800}.wav` — **4 recordings ×
  3 mics**, 48 kHz PCM16, durations 1.5 / 5 / 5 / 7 s ⇒ **18.5 s per mic**. As an *interferer*
  corpus this is incidental whistling, not performed melody.
- Licence: the Zenodo record's licence field says `cc-by-4.0`; the **`AID/LICENSE` file inside
  the archive is `Attribution-NonCommercial-ShareAlike 4.0 International`** (verbatim first
  line). A record that contradicts itself is the §5e situation (Jingju part 2), and the
  precedent there is explicit: *treat as NC*. **Verdict: barred**, with a cheap escalation
  available if it ever matters (ask the depositors which is operative — it is a first-party
  deposit and the mismatch is probably an upload-form slip).

At 18.5 s it would not have changed a conclusion anyway. Recorded so the mismatch is not
re-litigated.

### 2g. ⛔ Belyk et al. 2018 (sung + whistled pitch imitation) — already killed, and still dead

`doi:10.5061/dryad.504t7`, CC0. The register's §5c killed it by reading the data and the
methods: `praat_output.csv` carries one mean-F0 value per imitated note and **no timing column
of any kind**, because the shipped `melody_measure.praat` is an interactive protocol that
discards the cursor position. Nothing has changed. Do not re-derive this.

### 2h. ⛔ Belyk et al., real-time-MRI whistling — CC0, and no timing either

New this pass: `doi:10.5061/dryad.kb56cd1`, *"Whistling shares a common tongue with speech:
bioacoustics from real-time MRI of the human vocal tract"*, 210 MB, licensed for reuse. Ships
`filtered_audio.zip` (67 MB of WAV cut to each MRI scanning run, **with the scanner's noise
artefacts filtered out**), `extracted_data.zip` (tongue coordinates + F0), `video.zip`.

The annotation is **F0 per MRI frame at 16.67 Hz, synchronised to the video** — a frame-level
pitch contour, not note events, so it fails gate 2 exactly like a frame-f0 corpus. Its audio is
also heavily processed to remove gradient noise, which makes it unrepresentative of any
microphone path we care about. **Verdict: kill for note truth.** Retained as a curiosity: if we
ever want a pathological "whistling recorded inside a rock crusher" robustness probe, it exists
and is free.

### 2i. ⛔ Vocal Imitation Set / VocalSketch — CC-BY-4.0, wrong content

`10.5281/zenodo.1340763` (Vocal Imitation Set v1.1.3), `10.5281/zenodo.3538534` (Fine-grained),
`10.5281/zenodo.13862` (VocalSketch v1.0.4) — all CC-BY-4.0, thousands of vocal imitations of
hundreds of sound effects, some of them whistled. No melody, no note truth, and the material is
*imitation of noise*, which exercises nothing we ship. Not adopted; listed so the CC-BY licence
does not tempt a future pass.

### 2j. ⛔ Jamendo / archive.org CC-licensed music tagged "whistling"

466 CC-licensed archive.org audio items match whistling; the musical ones are Jamendo tracks
(`Happy And Positive Whistling`, `Whistling Mandolin`, …) and they are **full mixes** — the
whistle sits over guitar and percussion, so they fail the isolated-monophonic requirement — and
the great majority are NC or ND anyway. Nothing to salvage.

## 3. What DOES exist, and is now adopted

### 3a. ✅ Wikimedia Commons — 5 clips, ~34 s, all PD or CC-BY-SA

Commons is the only place with modern, unaccompanied, permissively-licensed whistling. The
whole of it, enumerated by `Category:Whistling` plus a File-namespace audio search (everything
else in that category is birds, marmots, police whistles, wolf-whistles, whistled *languages*,
or sheet-music scans):

| clip | Commons file | licence (verified live via the imageinfo API) | dur | median f0 |
|---|---|---|---|---|
| `commons-donna` | `Whistling la donna a mobile.ogg` | CC BY-SA 4.0 (Stanislav Kozlovskiy) | 8.9 s | 1089 Hz |
| `commons-glide` | `Whistle.ogg` | CC BY-SA 3.0 (Ruan123) | 11.8 s | 2250 Hz |
| `commons-untune` | `Unidentified Tune.ogg` | public domain | 6.5 s | 1225 Hz |
| `commons-soft` | `Soft whistle.ogg` | public domain | 5.4 s | 1450 Hz |
| `commons-human` | `Human whistling.ogg` | public domain | 1.5 s | 1550 Hz |

`commons-donna` is whistled *La donna è mobile* — Verdi died 1901, so unlike every other
recognisable tune on offer the composition is public domain too. `commons-glide` reaches
**~4.4 kHz**, which makes it the highest-pitched real audio in the entire harness.

Licences are re-read from the Commons API on every fetch and checked against an allowlist, so a
re-licensed file fails the run rather than entering the corpus quietly.

### 3b. ✅ Public-domain art whistling — 2 sides, 6 × 30 s excerpts

The acoustic era had professional whistlers, and their sides are public domain (US: everything
published before 1923 entered the public domain on 2022-01-01 under the Music Modernization
Act; both of these are also flagged PD on Commons):

- **Alice J. Shaw and her daughters** ("The Whistling Prima Donna"), 134 s, median f0 1475 Hz.
- **Frank Stafford**, *Der Spottvogel* (Septimus Winner, 1827–1902 — PD composition), 160 s,
  median f0 1325 Hz.

These are real whistling from real users-of-the-1900s, but with piano/orchestra behind them and
78-rpm surface noise, so they are a **separate dataset** (`whistle-vintage`) that must never be
pooled with the clean tier. Read them as what they are: an *adverse* whistle tier that nobody
synthesised — the accompaniment is a masker in the same band, which is precisely the condition
the synthetic tier cannot manufacture honestly.

The Internet Archive's Great 78 Project has **166 more** whistling hits (Guido Gialdini, Joe
Belmont, Margaret McKee, Sibyl Sanderson Fagan…), same character. Not fetched: the two Commons
sides already carry the condition, and the Great 78 items carry no explicit licence field of
their own (their PD status is inferred from the recording date, which is fine for pre-1923 but
means each one needs checking by hand). Documented as a known reserve if the vintage tier ever
proves interesting enough to grow.

### 3c. ⚠️ ebezzam/melody-detection — MIT, and only half of it is whistling

A LauzHack 2018 workshop repo (`github.com/ebezzam/melody-detection`, MIT LICENSE at the root)
with 13 wavs. Measured with `lib/sineTrack`, they are two different things:

- `ppA, ppAfast, ppAslow, ppAup, ppB, ppBdown, ppBslow` — **real whistling**, 762–1800 Hz,
  1.4–3.5 s each (~17 s total). They are Pink Panther phrases (Mancini, d. 1994): the recording
  is MIT, the composition is not, so they are staged only under
  `WHISTLE_INCLUDE_ENCUMBERED=1`. This is the §1e call, applied consistently.
- `a, a6, b, c, c3, c4` — **not whistling**. Stable fundamentals at 247 / 262 / 440 / 523 /
  910 Hz with ~0.7 of the frame energy in the fundamental's three bins, i.e. pitch reference
  tones named after their note (real whistling reads ~0.95 in the same tracker). Deliberately
  not staged: they would put synthetic tones into a corpus whose whole purpose is being real.

### 3d. 🔑 Freesound CC0 — the only route to real whistling *at volume*, and it needs 2 minutes of a human's time

Freesound is where modern whistling actually lives. Its API is usable for this:

- Token auth (not OAuth2) is enough to reach **previews** — 128 kbps mp3, which is lossy but
  harmless at 1–3 kHz and recorded in the manifest. Only *original* downloads need OAuth2,
  which no unattended script can do.
- The licence filter is exact: `filter=license:"Creative Commons 0"`, so nothing NC or
  attribution-encumbered enters.

`fetch/fetch-whistle-real.ts` implements this path and skips it with a notice when no key is present.
**Getting a key is free and instant at `https://freesound.org/apiv2/apply/`** (log in, describe
the application, then copy the **Client secret/Api key** column — the long alphanumeric string;
the `client_id` beside it is for OAuth2 and is not what token auth wants). Supply it either as
`FREESOUND_TOKEN` or as a single line in **`scripts/eval/.freesound-token`** (gitignored), which
is the better default: the key then lives in one file on disk instead of in shell history, and
re-running the sweep needs no environment set up.

Rate limits: **60 requests/minute, 2,000/day** on token auth, 429 on exceeding them. Searches
are paced 1.1 s apart for that reason; preview downloads go to the CDN, not the API.

**⚠️ Do not follow the API's `next` link to page.** Measured: `next` points at
`/apiv2/search/` — no `/text/` — which does not answer, so paging died silently after the first
150 results and the sweep quietly under-sampled. `page=1,2,3…` against `/search/text/` works and
reports a stable `count`.

**What the CC0 slice actually contains** (measured counts, `duration:[1.0 TO 40.0]`):

| query | hits | first page is… |
|---|---|---|
| `whistling` | **936** | steam locomotives — "Train Passing By 114 with Bells, Horn, Pitch Change, Whistling" — plus stadium crowds, kettles, wind, a shower head |
| `whistling` + exclusions (`-train -crowd -applause -kettle -wind -bird -steam -shower -bottle -referee -horn -cheer`) | **537** | real whistling |
| `tag:whistling` | 205 | more precise, but the tag is on the trains too |
| `tag:whistling tag:melody` | 2 | unusable |
| licence comparison: `Attribution` | 663 | — |
| licence comparison: `Attribution NonCommercial` | 229 | barred anyway |

Two things follow. **CC0 is not a compromise**: at 936 vs 663 it is the *bigger* slice than
CC-BY, so we take the permissive licence and no attribution obligations. And **the query cannot
be the filter** — breadth plus screening beats a tight query, because the tight queries collapse
to single digits.

### 3d-i. The content screen, and what it is calibrated on

`whistleScreen()` (lib/sineTrack.ts) decides whether a candidate is a person whistling a
melody, on the property that defines whistling: essentially all the energy sits in one moving
partial. Calibrated over 45 staged clips whose identity was known from title and from the five
hand-checked Commons files — the separation is not marginal:

| material | tonal fraction (energy in the peak's 3 bins, audible frames) |
|---|---|
| real human whistling | **0.61 – 1.00** (the Commons five: 0.61–0.86) |
| wolf-whistle glide | 0.43 |
| trains / crowds / wind / shower head | **≤ 0.08** |

So the gate sits at 0.5 with ~0.1 of headroom either side, plus a 450–4200 Hz median and a
requirement of ≥3 notes at ≥2 distinct pitches — which is what excludes the two cases tonality
alone cannot: a single sustained synth "whistle" one-shot scored **1.00**, and a wolf whistle is
a glide rather than a melody.

Two accepted false negatives, both correct for a *clean* tier: whistling buried under street
traffic (measured 0.08 — "Man whistling and kicking bottle on Sandringham Road", which would be
a fine *adverse* clip if the drafter could handle it) and very quiet breathy whistling.

### 3d-ii. 🔴 The acoustic screen is necessary and NOT sufficient — a metadata veto is required

Learned by reading the output rather than trusting it. Over 170 CC0 candidates the acoustic
screen kept 82, and the titles of those 82 included **`tin whistle.wav`**, **`Celtic Whistle
Melody`**, **`Slide-whistle.wav`**, **`Hoary marmot whistles`**, **`Retro video game sfx - Wolf
Whistle`** and **`synth Crystal`**.

That is not a threshold problem, and no better threshold fixes it: a tin whistle, a slide
whistle, a sine synth and a marmot all put nearly all their energy in one moving partial, which
is exactly what the screen tests for. **Acoustically they are the same class of signal as human
whistling.** The separation has to come from metadata, and it has to be a veto (a hard no) rather
than a score, so `FREESOUND_VETO` matches name + tags before anything is downloaded —
instruments that whistle (tin/slide/penny whistle, recorder, flute, ocarina), synthesis
(synth, chiptune, 8-bit, video game, sfx), animals (marmot, bird, dolphin), machines (train,
kettle, siren, escalator) and processing (distorted, vocoder, reverse, granular).

Deliberately biased towards **precision, not recall**: a wrong clip costs a human's
verification time and then poisons the truth, while a missing clip costs only yield — and the
pool (537 hits) is far larger than the corpus needs. Every verdict, veto and acoustic alike, is
cached by sound id under a `SCREEN_VERSION`-stamped filename, so re-runs neither re-download nor
inherit verdicts from superseded criteria, and the audit trail for any absent sound is on disk.

**The general lesson, which is not about whistling:** when a corpus is assembled by search, the
screen has to be able to fail. Ours could not tell a flute from a person until someone read the
titles, and a corpus that had shipped at that point would have measured flute transcription
under the name "whistling".

### 3d-iii. Measured yield of the sweep

Over the whole CC0 pool the funnel is (SCREEN_VERSION 3, 537 candidates from four queries):

| stage | dropped | left |
|---|---|---|
| candidates found (`page=1..4`, four queries, deduped) | — | 537 |
| **not described as whistling** in name or tags | 165 | 372 |
| **vetoed** as an instrument / synth / animal / machine / non-melodic | ~90 | ~282 |
| **acoustic screen** (tonality, band, ≥3 notes at ≥2 pitches) | ~170 | **112** |

**112 CC0 clips kept**, and reading all 112 titles finds no obvious survivor of the earlier
problem — the residual uncertainty is now limited to plausibly-processed human whistling
(`Ghostly Whistling`, `spooky eerie whistling 01–03`, `Whistle - Sustain tonal`), which is
exactly the kind of judgement the verification pass is for, and every clip's `.meta.json`
carries its Freesound title so that call is cheap to make.

## 4. What was implemented, and what it measures

Four scripts, one chain, one new lib module:

```
fetch/fetch-whistle-real.ts   acquire + licence-verify + normalise  → .cache/whistle-staging/
fetch/draft-note-labels.ts    FFT-peak draft annotation             → annotations/<ds>/*.labels.tsv  (TRACKED)
  (human corrects the TSVs in Audacity / Sonic Visualiser)
fetch/import-note-labels.ts   labels → scoreable dataset            → fixtures/eval-real/<ds>/
lib/sineTrack.ts        the deliberately-dumb tracker + run segmenter
```

Design decisions worth not re-litigating:

- **Audio is cached, labels are committed.** Every wav is re-fetchable from a URL in the
  fetcher; the label TSVs are the only artefact nobody can regenerate, so they live in
  `scripts/eval/annotations/` under version control, in Audacity's own three-column format so
  the correction round trip is lossless. `staging.json` / `<clip>.meta.json` carry licence,
  attribution, source URL and excerpt window, which makes the corpus reproducible from tracked
  files alone — the same principle as `generate.ts` being the tracked source of the synthetic
  corpus.
- **Two datasets, not one** (`whistle-real` clean, `whistle-vintage` accompanied), because
  pooling them would hide exactly the effect the vintage tier exists to expose.
- **`x` / `-` / empty labels mark ignore-regions**, so an annotator can say "there is sound
  here and it is not a note" without deleting the evidence.
- **Overlapping labels are reported, never repaired.** On monophonic material an overlap means
  a boundary was left crossed; silently trimming one would move a truth onset the metric then
  scores against.

State of the corpus (draft labels, nothing human-verified yet). The Freesound sweep is what
took this from a smoke test to something with an n:

| dataset | clips | notes | audio | source |
|---|---|---|---|---|
| `whistle-real` | **117** | **2,777** | **18.3 min** (median clip 7.8 s) | 112 Freesound CC0 + 5 Commons PD/CC-BY-SA |
| `whistle-vintage` | 6 | 249 | 3 min | public-domain art-whistling 78s |

(Before the token: 5 clips / 34 s. The 32× is entirely §3d.)

Both are flagged `noteTruthDerived: true` until verified, so they report but do not pool. The
draft's own tightness is a useful signal in itself: median |Δ¢| from the nearest semitone is
**7–17 ¢ on the clean tier** (i.e. real whistling really does sit on semitones, and the
tracker really is reading it) against **15–31 ¢ on the vintage tier**, where the accompaniment
pulls the peak around.

### 4a. The real-whistle measurement — four findings, and one retraction

`EVAL_REAL=1 EVAL_ADAPTIVE=1 EVAL_SCENARIOS=whistle-real,whistle-vintage`, adaptive routing,
draft truth, **n = 117 clips / ~2,800 notes**. Read as diagnosis, not accuracy: the truth is a
draft.

| dataset | COnP@100 ms | octErr | missed | spur/100 | onset bias | trans recall |
|---|---|---|---|---|---|---|
| `whistle-real` | 0.36 | **0.00** | 55 % | **3** | +31 ms (med +20) | 0.258 (n=1270) |
| `whistle-vintage` | 0.02 | 0.16 | 58 % | **102** | +62 ms | 0.293 (n=41) |

1. **No octave errors on clean real whistling — confirmed at scale.** 0.00 over ~2,800 notes.
   This *contradicts* the obvious prediction (a near-sinusoidal source has almost no harmonics
   with which to disambiguate an octave), and it settles the question before anyone builds a
   whistle octave prior: on this evidence there is nothing for one to fix. The vintage tier
   shows 0.16, which is the accompaniment, not the whistle.
2. **The failure mode is conservative, not noisy.** 55 % of drafted notes missed against only
   **3 spurious per 100** — the pipeline drops whistled notes rather than inventing them. Part
   of the missed rate is the draft's own over-segmentation (2.5 notes/s; the drafter splits a
   vibrato-wide sustain into neighbours), so the missed:spurious *ratio* is the robust part and
   the absolute is an upper bound that verification will lower.
3. **Transitions are where it goes, and now with weight**: transition recall 0.258 over
   **1,270** real transitions, against 0.344 on silence onsets. Whistling has no consonant to
   mark a re-onset; this is the harness's first non-synthetic measurement of what that costs,
   and it is the single largest identified loss on the input mode.
4. **On accompanied material the resolver locks onto the accompaniment.** Every vintage clip
   resolved `mid+noise` / `high+noise` with a 1900 Hz ceiling from a scan reporting
   p10/med/p90 ≈ 215–530 Hz — that is the *piano*, while the whistled line sits at 1.3–2.2 kHz.
   102 spurious notes per 100 reference notes is the same fact seen from the metric's side.
   Nobody synthesised this condition, which is why it was invisible until now; it generalises
   well beyond whistling (any user recording over a backing track).

**🔴 Retracted, and worth keeping as a lesson in sample size.** On the first five clips it
looked as though the resolver's 1900 Hz `high` ceiling routinely sat under real whistling — 2 of
5 clips had a scan p90 above their own analysis ceiling, which read as a structural band-boundary
problem. Over 117 clips it is **3 of 120 analyses (2 %)** and the overflow is trivial (median
26 Hz, worst 53 Hz). The routing is in fact mostly right:

| resolved band | clips | ceiling | median scan f0 |
|---|---|---|---|
| `very-high` → basic-pitch | 71 (61 %) | 4300 Hz | 1570 Hz |
| `high` → crepe-tiny | 40 (34 %) | 1900 Hz | 1106 Hz |
| `mid` / `low` → crepe-tiny | 9 (8 %) | 1600–1900 Hz | 377 / 121 Hz |

The 40 `high` routings are legitimate — 1106 Hz is comfortably inside CREPE's range. The nine
`mid`/`low` routings are the interesting residue: a scan median of 377 or 121 Hz on a clip
described as whistling almost certainly means the whistle is not the loudest thing in it, so
those nine are the first clips the verification pass should look at.

## 5. The honest limits of what section 4 bought

- **No performer metadata, so no honest split.** 117 clips carry a mean, but `lib/split.ts`
  groups by performer and Freesound gives us an *uploader*, not a whistler — so the split is
  per-clip there and one uploader's several takes can land on both sides. Read the number as a
  corpus mean, never as a tuning target, and do not gate a config on it.
- **Draft labels are algorithmic** until someone verifies them; §1's trap explains exactly how
  they go wrong if that never happens.
- **No dogfood, no phone capture, no room.** Every clip is somebody else's recording of
  themselves; none went through the product's webm/opus path and none was performed in a real
  echoey room. That is what §6 exists for, and Freesound cannot supply it.
- **Uneven material.** The pool is what people upload to a sound-effects site: plenty of short
  one- or two-second whistles alongside real phrases (median clip 7.8 s). It is not a corpus of
  *melodies* the way a dogfood set would be.

## 6. The capture protocol — how to get from 34 s to a real corpus

This is the part that no dataset can replace, so it is written down as a procedure rather than
a wish. Target: **~30 minutes of one person's time for ~40 clips**, which is more real
whistling than everything in §3 combined.

**What to record.** 40 takes of 8–15 s, whistled, each a short melodic phrase. Deliberately
spread across:

1. **Register** — 8 takes each centred low (~600–900 Hz), mid (~1–1.5 kHz), high (~2–3 kHz).
   The high group is the point: it is the only real audio that will ever reach the `very-high`
   band, and the band's whole provider decision currently rests on synthesis.
2. **Articulation** — separated notes (a fresh breath/tongue stop per note) vs legato phrases
   with audible portamento between pitches. Whistling has no consonants, so the re-onset
   problem is at its worst here, and the synthetic tier cannot produce a genuine one at all
   (see `scenarios.ts`'s note on `gapSec`).
3. **Competence** — deliberately include unsteady, flat/sharp and wobbling takes. The corpus's
   value is being *bad* in the ways users are bad; a set of clean takes measures nothing the
   synthetic tier does not already.
4. **Capture path** — record ~10 of the 40 **through the product** (browser mic → webm/opus)
   rather than into a DAW, and ~6 in a genuinely echoey room / near a window with traffic. Both
   are gaps the 2026-08-20 register lists in their own right; whistling takes can close them at
   the same time.

**What NOT to do: whistle along to a click or a rendered melody.** That produces
*score-derived* truth — the mirror of gate 3 — and it measures the written music instead of the
performance. It is the mistake §4.4a records. Whistle freely; annotate what came out.

> **This happened, 2026-08-22.** The first dogfood batch (`context/whistled-high-register`, 6
> clips) was recorded exactly this way — generated melody, performed to a metronome, melody kept
> as truth — and scored **COnP 0.00**. Two independent reasons, both inherent to the method:
> the performer whistled it **12–13 semitones up** (and not by a constant: three clips at +12,
> three at +13, so even "assume an octave" fails), and the metronome grid misses the actual
> attacks by a median 90 ms, putting **40 % of notes outside the ±100 ms tolerance** before the
> pipeline does anything. The recording is still valuable — `fetch/align-prescribed-truth.ts` repairs
> it to COnP 0.41 by keeping the note identities, fitting the key per clip and taking timing from
> the audio — but the repair needs a second estimator pass and leaves derived truth. Two changes
> for the next batch: **whistle freely**, and if a prescribed melody is used to make annotation
> cheap, **record the key the performer actually chose**.

**Annotate.** `WHISTLE_LOCAL_DIR=<folder>` on the fetcher stages the takes as
`whistle-dogfood`; the drafter then produces labels to correct. Budget 2–4 minutes per 10 s
clip in Audacity's spectrogram view (whistling is one bright line — onsets and offsets are
*visible*, which is why this is fast). Then
`fetch/import-note-labels.ts --verified-by="<name>"` stamps them and the dataset stops being flagged
as derived.

**Durability.** Dogfood wavs are the one input that is not re-fetchable from a URL. They must
go to our own storage (a GCS bucket under the eval-fixtures prefix) with the object path
recorded in the clip's `.meta.json`, or the corpus dies with the laptop.

**Second annotator, later.** vocadito's inter-annotator ceiling (0.760 at ±100 ms, measured by
`annotator-agreement.ts`) is the only honest target the harness has. Two independent passes over
a 10-clip subset of the dogfood set would give whistling its own ceiling — worth doing once the
set exists, not before.

## 7. Open items this file does not close

1. ~~Freesound token~~ — **done 2026-08-20**, and it was the difference between a smoke test
   and a corpus: 34 s → 18.3 min (§3d-iii).
2. **Verify the drafted clips** (§4) — 123 of them now, so this is no longer a 40-minute job.
   Verify a *stratified subset* first: the nine `mid`/`low`-routed clips (§4a's residue), the
   handful whose titles suggest processing (`Ghostly Whistling`, `spooky eerie whistling 01–03`,
   `Whistle - Sustain tonal`), and ~20 drawn at random. That is enough to measure how far the
   draft is off, which decides whether verifying the rest is worth it.
3. **Dogfood capture** (§6) — the actual answer to the gap.
4. **The whistle-specific FFT peak tracker** (README open direction 4) is now unblocked on
   audio — `lib/sineTrack.ts` is already a working baseline of exactly that shape, and
   `whistle-real` + `whistle-vintage` are the material to test it on. Note the ordering
   constraint: **verify the labels by hand before evaluating a tracker of the same family
   against them**, or the result is circular by construction.
5. ~~A whistling-specific octave prior.~~ **Measured and not needed on this evidence** —
   `octErr` is 0.00 over the clean tier's 107 notes (§4a), and 0.00 in every one of
   `fetch/fetch-tinysol.ts`'s six instrument datasets across both bands. The very-high band does not
   lose notes to octave confusion; it loses them outright, and most of all when they are
   *quiet* (TinySOL `very-high` pp 0.451 vs ff 0.780). If anything is worth building for this
   register it is sensitivity at low level, not an octave prior.

## 8. Search log — queries already run (do not repeat)

Zenodo API (`type=dataset`): *whistled melody dataset*, *whistling recordings dataset audio*,
*query by whistling*, *vocal imitation set*, *VocalSketch*, *dEchorate*, *Arni*, *BUT
ReverbDB*. Wikimedia Commons API: File-namespace audio search for *whistling* (20,369 keyword
hits, all non-human bar the five above), `Category:Whistling`, `Category:Human_whistling`
(empty), `Category:Whistled_languages`. Internet Archive advancedsearch: `collection:georgeblood`
whistling (166), CC-licensed audio whistling (466). Kaggle metadata API: MLEnd Hums and
Whistles + its sample. Direct downloads and file-level inspection: FSD50K ground truth, AID,
TinySOL metadata, `ebezzam/melody-detection` wav_files. Web search: whistling note/f0/onset
datasets 2024–2026, whistled speech corpora, HuggingFace whistling datasets, GitHub CC0/CC-BY
whistling corpora, Library of Congress National Jukebox whistling subgenre, public-domain
whistling 78s.
