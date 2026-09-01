# Evaluation datasets & benchmark methodology for monophonic → note transcription

> **Status of every proposal in this document — shipped, built-off, discarded, not pursued — is tracked in [`../RESEARCH-STATUS.md`](../RESEARCH-STATUS.md), which also lists where this text is now stale.** This file is kept as the record of the reasoning, not edited to match the code.

Research notes, 2026-07-24. Commercial-SaaS context (EU-based). Primary sources cited inline.

Confidence markers: **[verified]** = read from a primary source this session.
**[secondary]** = one non-authoritative source only. **[thin]** = evidence weak, flagged.

---

## 0. Headline findings (read this first)

1. **Our ±100 ms onset tolerance is 2× the field convention — and the perceptual literature says
   we are right and the convention is wrong.** Ycart et al. (TISMIR 2020) ran the only large
   human study of AMT metrics (186 participants, 4,501 judgements) and found agreement with
   human preference **peaks at onset tolerances of 75–150 ms**, and that **onset-only note F
   beats onset+offset F** as a perceptual proxy. Molina et al. independently concluded ±50 ms is
   "very restrictive … many onsets are not clear even for an expert musician." So keep ±100 ms as
   the **product** headline; add ±50 ms only as the **literature-comparable** number. What we
   must fix is labelling: our "note F1" is MIREX **COnP** (no offset gate) at a non-standard
   tolerance, and has been compared loosely against published COnPOff figures. See §2.3, §4.1.
2. **The vocadito human ceiling under our own matcher is F1 ≈ 0.76 at ±100 ms / 0.72 at
   ±50 ms** — measured this session (§2.4). Any target above ~0.76 on vocadito is measuring
   annotator idiosyncrasy, not transcription quality.
3. **MIR-QBSH has no note-level ground truth and no license grant.** Its `.pv` files are
   frame-level pitch, hand-labelled by the students who made the recordings, with an explicit
   "no guarantee for their correctness" disclaimer. Our harness manufactures notes by
   quantising + run-grouping. **I measured that derivation's ceiling: F1 0.43–0.55 against
   human note annotations** (§1.4). MIR-QBSH note-F1 is dominated by label artefacts.
4. **MIR-ST500 is not commercially usable**: annotations have no stated license and the audio
   must be scraped from YouTube. It is also polyphonic pop, not solo voice — the wrong
   distribution for us regardless.
5. Datasets that are **note-annotated AND commercially clean (CC-BY 4.0, verified on Zenodo)**:
   vocadito, Annotated-VocalSet, VocalSet, GuitarSet, TinySOL, Dagstuhl ChoirSet, Slakh2100.
   That is the whole safe list for our task shape.
6. **`mirdata`'s license table is wrong for vocadito** (says CC-BY-NC-SA; Zenodo says CC-BY-4.0).
   Trust the Zenodo record, and snapshot it.
7. **There is no commercially usable note-annotated humming corpus, at all.** HumTrans (the only
   real candidate, 56 h) is CC-BY-NC-4.0 *and* its onset/offset ground truth is independently
   documented as broken — a follow-up paper salvaged only ~55 % of it. Every other note-annotated
   singing corpus (M4Singer, CSD, Opencpop, GTSinger, TONAS, cante100) is NonCommercial too.
   And **Smule DAMP, the one large in-the-wild phone-sung corpus, has been withdrawn** and was
   non-commercial with a no-re-hosting clause regardless (§1.2b). **Our primary input mode can
   only be evaluated on a self-collected consented golden set** — this is now the highest-leverage
   item on the roadmap, not a nice-to-have (§1.2).
8. **Whistling: nothing exists.** No note- or f0-annotated whistling corpus was found (§1.3).
9. **F-measure is unreliable precisely in the range we tune in.** Ycart et al. found that when
   ΔF < 10 %, confident human raters disagree with F-measure ~40 % of the time. Statistical
   significance ≠ perceptual improvement; sub-10-point changes need a human panel (§4.1, §7).
10. **The best target anchor is ROSVOT on M4Singer** (COnPOff 77.4 / COnP 80.3 / COn 94.0) —
   monophonic solo singing, same task shape as ours — **not** the MIR-ST500 leaderboard, which is
   polyphonic pop where the wins come from source separation (§2.5).

---

## 1. Datasets

### 1.1 Master table

Licenses marked [verified] were read from the Zenodo REST API (`/api/records/<id>` →
`metadata.license.id`) or the dataset's own documentation this session.

| Dataset | Size | Annotation type | License | Commercial eval? | Available? | Published SOTA to compare against |
|---|---|---|---|---|---|---|
| **vocadito** | 40 clips, solo voice, 7 languages, 29 singers | frame f0 **+ 2 independent human note sets (A1/A2)** + lyrics | **CC-BY-4.0** [verified] | ✅ **YES** | ✅ [Zenodo 5578807](https://zenodo.org/records/5578807) | ✅ Vocano: F=0.50, Fno=0.64 (Amax); CREPE f0: RPA .98, OA .82 |
| **Annotated-VocalSet** | annotations for 3,560 clips / 10.1 h, 20 pro singers, 17 techniques | f0 contour, note onset/offset, note f0, MIDI pitch, duration, lyrics | **CC-BY-4.0** [verified] | ✅ **YES** | ✅ [Zenodo 7061507](https://zenodo.org/records/7061507) (annotations only, 411 MB) | ❌ none |
| **VocalSet** (audio for the above) | 10.1 h, 3,560 clips, 20 singers (9M/11F) | audio + technique labels only | **CC-BY-4.0** [verified] | ✅ **YES** | ✅ [Zenodo 1193957](https://zenodo.org/records/1193957) (2.1 GB) | n/a |
| **MIR-QBSH** | 4,431 clips, ~195 subjects, 8 kHz/8-bit mono; 48 reference MIDIs | **frame-level pitch only** (`.pv`, 256-sample frames, semitone units). Self-labelled by student recordists; "no guarantee for their correctness" | **NONE STATED** — citation request only, worded "for your research" [verified from bundled `index.htm`] | ⚠️ **NO / unclear** — no commercial grant | ✅ [mirlab.org](http://mirlab.org/dataset/public/) `MIR-QBSH.zip` (145 MB, HTTP only) | QBSH *retrieval* (MRR/top-k) only; no note-transcription benchmark |
| **MIR-ST500** | 500 Chinese pop songs, ~30 h, >160k notes | note-level (onset/offset/pitch), vocal part of polyphonic mixes | **NONE STATED**; audio not distributed (YouTube URLs + `yt-dlp`) | ❌ **NO** (unlicensed annotations + YouTube ToS/copyright on audio) | annotations ✅ [`MIR-ST500_20201014.zip`](http://mirlab.org/dataset/public/) (1.3 MB); audio ✗ scrape or email author | ✅ **strongest leaderboard in the field** — see §2.5 |
| **ISMIR2014 / "Molina"** | 38 melodies, 1,154 s, untrained adult+child singers | note-level, cross-annotated by 2 expert musicians | unstated | ⚠️ moot | ❌ **DEAD** — `atic.uma.es/ismir2014singing` 302s to a group homepage; the Wayback capture from 2023-10 already shows the same redirect [verified] | Molina et al. 2014 report a 4-system comparison (§2.2) but only as a bar chart |
| **iKala** | 252 clips | vocal f0 + lyrics | withdrawn | ❌ **NO** | ❌ **GONE** — `mirdata` marks both audio and annotations unavailable [verified] | historical only |
| **GuitarSet** | 360 excerpts, 6 players, hex-pickup | note-level (onset/offset/pitch) + f0 + beats/chords/key | **CC-BY-4.0** [verified] | ✅ **YES** | ✅ [Zenodo 3371780](https://zenodo.org/records/3371780) | polyphonic-guitar AMT numbers exist; not our task shape |
| **TinySOL** | 2,913 isolated notes, 14 instruments | note pitch + instrument + technique (one note per file) | **CC-BY-4.0** [verified] | ✅ **YES** | ✅ [Zenodo 3685367](https://zenodo.org/records/3685367) | ❌ none (not a transcription benchmark) |
| **Dagstuhl ChoirSet** | 108 tracks | ⚠️ **NOT note-annotated** — see below. f0 (CREPE/pYIN-derived) + *score representation* + beats; amateur multitrack choir, individual singer stems | **CC-BY-4.0** [verified: [Zenodo 4618287](https://zenodo.org/records/4618287)] | ✅ licence yes, ⛔ **unusable as note truth** | ✅ Zenodo | ❌ none |
| **Slakh2100** | 2,100 synthesized multitracks (1,710 in `mirdata`) | note-level (from source MIDI) + instrument | **CC-BY-4.0** [verified: [Zenodo 4599666](https://zenodo.org/records/4599666)] | ✅ **YES** | ✅ | multi-instrument AMT numbers; synthetic |
| **MAESTRO v3** | **1,276 performances, 198.7 h** | note-level, Disklavier-captured (near-perfect alignment); MIDI keeps velocities + pedals | **CC-BY-NC-SA-4.0** [verified: [Magenta](https://magenta.withgoogle.com/datasets/maestro)] | ❌ **NO** (NC) | ✅ | piano AMT SOTA is very high (>95 note F1) but irrelevant to voice |
| **MedleyDB / -pitch / -melody** | 93 / 103 / 108 | f0 only (no notes) | **CC-BY-NC-SA-4.0** [secondary]; Zenodo 'MedleyDB 2.0 Audio' record shows **license `null`** (restricted) [verified] | ❌ **NO** | 🔑 request required | melody-extraction numbers |
| **MDB-stem-synth** | 230 stems | f0 only (resynthesized, perfect f0) | **CC-BY-NC-4.0** [secondary] | ❌ **NO** (NC) | ✅ | f0 tracking (CREPE etc.) |
| **TONAS** | 72 flamenco a cappella excerpts | **f0 + notes**, musician cross-annotated | unstated; 🔑 request-gated via MTG | ⚠️ **NO / unclear** | 🔑 `mtg.upf.edu` returns 403 [verified] | used to train Vocano; no clean leaderboard |
| **cante100** | 100 flamenco tracks | f0 + **vocal notes** | custom (`:cante:` ref in mirdata) | ⚠️ unclear | 🔑 request | — |
| **Filosax** | 48 sets, saxophone | f0 + notes + beats/chords | **none stated** [verified: `mirdata` shows ❌] | ⚠️ **NO / unclear** | 🔑 request | — |
| **DALI** | 7,756 (v1) / 513 (`DALI_multi`) | notes + lyrics, **crowdsourced & automatically aligned** | CC-BY-SA-4.0 (annotations); audio = YouTube 📺 | ❌ **NO** (audio) | annotations ✅ | vocadito authors explicitly say DALI is "not an appropriate dataset for evaluation" — alignment is automatic |
| **IDMT-SMT-Audio-Effects** | — | notes | CC-BY-**NC-ND**-4.0 [secondary] | ❌ **NO** | ✅ | — |
| **PHENICX-Anechoic** | — | notes | CC-BY-NC-SA-4.0 [secondary] | ❌ **NO** | ✅ | — |
| **TONAS** (detail) | 72 a cappella flamenco excerpts, ~36 min, 2,983 notes | manually corrected f0 **+ notes** (onset/dur/pitch in Hz) | **Custom, explicit: "offered free of charge for internal non-commercial use only. You may not redistribute, publicly communicate or modify it."** [verified] | ❌ **NO** — explicitly | 🔑 Zenodo **restricted**, access request + academic affiliation | no leaderboard; Kroher & Gómez 2016 use a loose 150 ms tol |
| **CSD** (Children's Song Dataset) | 100 songs (50 KR/50 EN) × 2 keys = 200 recordings, 1 pro female singer, 1.9 GB | **note-level MIDI, manually fine-tuned onset/offset**; 1 syllable = 1 note; + grapheme/phoneme lyrics | **CC-BY-NC-SA-4.0** [verified] | ❌ **NO** | ✅ Zenodo, open | phoneme-informed model: **COn F1 0.9145**, COff 0.7723 @50 ms |
| **CSD re-annotation** (seyong92) | 50 CSD songs | note onset/offset/MIDI, manual in Sonic Visualiser, **Molina-style rules** | CC-BY-NC-SA-4.0 [verified repo LICENSE] | ❌ **NO** | ✅ GitHub | — |
| **Opencpop** | 100 Mandarin songs, **5.2 h**, 3,756 utterances, 1 pro female singer, 44.1 kHz | utterance/**note**/phoneme boundaries + note pitch + slur labels | **CC-BY-NC-**ND**-4.0** — NC *and* NoDerivatives | ❌ **NO** by default; **commercial licence obtainable by email** (zpcoftts@gmail.com) | 🔑 Google Form → email | — |
| **M4Singer** | 700 Mandarin pop songs, 20 pro singers, full SATB (~26.5 h per ROSVOT) | **note pitch + note duration + slur**, phoneme alignment; script pass then **manual fine annotation** | **CC-BY-NC-SA-4.0** + indemnity clause [verified `dataset_license.md`] | ❌ **NO** | ✅ Google Drive, free | ✅ **ROSVOT: COnPOff 77.4 / COnP 80.3 / COn 94.0** — best modern monophonic-singing leaderboard (§2.5) |
| **GTSinger** (2024, NeurIPS spotlight) | **80.59 h** singing + 16.16 h paired speech, 20 singers, 9 languages | MusicXML scores + note durations, manual phoneme alignment, 6 technique labels | **CC-BY-NC-SA-4.0** [verified] | ❌ **NO** | ✅ HF (54.2 GB) + Drive | — |
| **HumTrans** | 56.22 h, 14,614 hums, 1,000 segments / 500 compositions, 10 students | note MIDI — **score-derived, known-broken** (§1.2) | **CC-BY-NC-4.0** [verified HF API] | ❌ **NO** | ✅ HF, ungated | baselines all very low (§1.2) |
| **PTDB-TUG** | **9.6 h**, 20 native-EN speakers, 4,720 TIMIT sentences, 3.9 GB | **f0 only** — laryngograph-derived (physiological, not hand-labelled). **Speech, not singing** | **ODbL 1.0** + DbCL 1.0 — §3.1: *"These rights explicitly include commercial use, and do not exclude any field of endeavour."* [verified] | ✅ **YES** | ✅ `www2.spsc.tugraz.at/databases/PTDB-TUG` | ✅ best-documented f0 leaderboard (§2.5) |
| **SSVD v2.0** | 194 sight-singing recordings (67 train/val + 127 test) | **note-level (onset/offset/pitch)**, fully manual: 4 trained sight-singers, spectrogram-refined, cross-checked | **none stated** [unverified] | ⚠️ **NO / unclear** | ✅ GitHub (`xk-wang/SSVD-v2.0`) | MusicYOLO 84.60 % F1; phoneme-informed COnP 0.8558 / COnPOff 0.8303 |
| **NUS-48E** | 169 min, 48 recordings (20 songs), 12 subjects | **phone-level durations only — NO note/pitch annotations** | none stated [unverified] | ❌ **NO / unclear** | ✅ open Drive | — |
| **JVS-MuSiC** | 100 singers × 2 songs, 24 kHz, 0.6 GB | **no note annotations**; Melodyne project files + similarity/key/tempo tags | tags CC-BY-SA-4.0; audio *"non-commercial research"*, **"re-distribution is not permitted"** | ⚠️ **treat as NO** | ✅ Drive | — |
| **ACE-Opencpop** | 106k segments, 12 synthetic singers | note MIDI + phoneme onset/offset | CC-BY-NC-4.0 [verified HF] | ❌ **NO** | ✅ HF | — |
| **cante100** (detail) | 100 flamenco tracks | vocal sections + **automatic** note transcriptions | CC-BY-NC-4.0 (Zenodo 1322542) | ❌ **NO** | metadata open; audio = commercial recordings | — |

**The systematic pattern.** Every note-annotated *singing* corpus other than vocadito and
Annotated-VocalSet is NonCommercial or worse. This is not bad luck: the entire Chinese
singing-voice-synthesis lineage (Opencpop → M4Singer → GTSinger → ACE-Opencpop) ships the same
CC-BY-NC-SA text, and the flamenco line (TONAS, cante100) is explicitly internal-non-commercial.
**Our two CC-BY corpora are not merely convenient — they are essentially the entire lawful
universe for this task.** That materially raises the value of (a) treating them carefully and
(b) building our own golden set.

Still unverified — assigned to search streams that did not report: **Bach10**, **URMP**,
**MusicNet**, **Good-sounds**, **IDMT-SMT-Guitar/Bass**, **Erkomaishvili**, **Smule DAMP**,
**Hum2Song**, MIREX QBSH corpora beyond MIR-QBSH, and **whistling corpora**. See §6.

### 1.2 Humming: both known corpora are NonCommercial [verified]

This matters more to us than anything else in the table, because humming is a primary input mode.

| Dataset | Size | Annotations | License | Commercial? |
|---|---|---|---|---|
| **HumTrans** (2023) | **500 compositions → 1,000 segments, ~56.22 h**, 10 college students (music majors / instrumentalists), each hummed every segment twice, 44.1 kHz. Largest known humming dataset. | MIDI note ground truth (`all_midi.zip` + `all_wav.zip`) | **CC-BY-NC-4.0** [verified via HF API, `cardData.license`] | ❌ **NO** |
| **CHAD_hummings** | 1K–10K clips | — | **CC-BY-NC-4.0** [verified via HF API] | ❌ **NO** |

Sources: [arXiv 2309.09623](https://arxiv.org/abs/2309.09623),
[HF `dadinghh2/HumTrans`](https://huggingface.co/datasets/dadinghh2/HumTrans).

**Worse, HumTrans's note ground truth is known-broken.** The follow-up paper *Dynamic HumTrans*
([arXiv 2410.05455](https://arxiv.org/abs/2410.05455)) states it "identif[ies] and address[es]
inherent problems with the offset and onset ground truth provided by the dataset". Its
[repo](https://github.com/shubham-gupta-30/humming_transcription) is blunter: *"the dataset we
are working with has incorrect onsets and offsets as ground truth"* — they had to correct onsets
with librosa's onset detector and run a semi-supervised offset-correction pass that **retained
only ~55 % of the data as usable**. The corrected repo states no license, so it inherits
HumTrans's NC restriction anyway.

The likely root cause is the collection design: subjects hummed *while reading a score with the
melody audio playing*, so the "ground truth" is the **reference score**, not an annotation of
what was actually hummed. That is the same flaw as the unreleased Viitaniemi/Ryynänen 2003 set,
and it makes onset/offset ground truth systematically unreliable regardless of licensing.

**Conclusion: there is no commercially usable, note-annotated humming corpus.** For humming we
have only (a) our synthetic corpus and (b) a self-collected consented golden set. This is the
strongest argument in this entire report for prioritising the T4 golden set (§7) — it is not a
nice-to-have, it is the only lawful route to measuring our primary input mode.

### 1.2b In-the-wild / phone-recorded singing: Smule DAMP is gone [verified]

DAMP (Digital Archive of Mobile Performances) is the largest in-the-wild sung corpus and the
obvious candidate for "real phone-recorded singing". Both doors are closed:

- **The vocal datasets have been withdrawn.** [ccrma.stanford.edu/damp](https://ccrma.stanford.edu/damp/)
  states verbatim: *"The DAMP vocal datasets are no longer available for download."* Only Magic
  Piano performance data remains.
- **The license was never commercial-compatible anyway.** Per the same page, Smule's Research Data
  License Agreement required that *"the data could only be used for non-commercial, research
  purposes"*, that it *"could not be shared with anyone who did not also accept the terms"*, and
  that it *"could not be re-hosted in any way. This includes hosting on either a public website or
  repository, or private server"* — the last clause alone would forbid our fixture cache.
- **DAMP-MVP** (Smule Multilingual Vocal Performance 300×30×2,
  [Zenodo 2747436](https://zenodo.org/records/2747436)) still has a record, but its Zenodo
  `license` field is **null** and the description requires accepting the same Research Data
  License Agreement. ❌ **NO.**

**Verdict: no large in-the-wild phone-recorded singing corpus is available to us.**

**But the good news, and it's better than expected: the two corpora we already use *are* our
phone-recorded corpora.** This is worth stating explicitly because it reframes them from
"small/low-quality" to "on-distribution":

- **vocadito is deliberately consumer-device audio.** From the paper §2.1, verbatim: *"In order to
  simulate a 'real-world' setting, we did not restrict volunteers to record using high-quality
  microphones, and **many of the recordings are from cell phone or computer microphones**."* 28
  volunteers of varying singing experience, self-chosen original/public-domain songs, 10–40 s each,
  and *"volunteers agreed to their recordings being anonymously included in this dataset and
  publicly released"* — a clean consent model we can copy for T4. **CC-BY-4.0.** This makes
  vocadito the single most on-distribution licensed corpus in existence for our product, which is
  precisely why its human ceiling is so low (0.76) — it is genuinely hard audio.
- **MIR-QBSH is 8 kHz/8-bit mono from ~195 untrained people** — worse than any phone we'd see
  today, which makes it a useful pessimistic bound on capture quality (its problem is labels, not
  audio; §1.4).

So the gap is not "realistic capture conditions" — we have those. The gap is **humming**,
**whistling**, and **volume** (labelled clips at n≥200 for statistical power).

**One genuinely useful find, though:** `smulelabs/ExtremeDegradationBench`
([HF](https://huggingface.co/datasets/smulelabs/ExtremeDegradationBench),
[arXiv 2510.21659](https://arxiv.org/abs/2510.21659)) is **MIT-licensed** [verified via HF API],
<1K real recorded *heavily degraded singing* clips, and it ships **`pairwise-ranking.csv` plus the
Gradio `app.py` used to collect those 2AFC rankings**. Two uses for us: (a) MIT-licensed real
adverse singing audio for qualitative/smoke checks (it has no note labels, so it cannot score
note-F1), and (b) **a ready-made, permissively licensed 2AFC rating harness we can adapt for the
T5 human panel** (§4.6) instead of building one.

### 1.3 Whistling: an evidence gap

I found **no** note-annotated whistling corpus. The only trace in the literature is
Viitaniemi/Ryynänen 2003–2004 (66 melodies incl. "singing, humming and whistling", Table 1 of
Molina et al. 2014) — never publicly released, and its ground truth was *the original score*,
not an aligned transcription. **[thin — treat as a genuine gap.]** Our synthetic
whistle-register corpus is, as far as I can tell, the only evaluation signal available for
whistling, and it should be labelled internally as unvalidated against real whistling.

### 1.4 The MIR-QBSH label problem — measured, not assumed

MIR-QBSH's `index.htm` (the authoritative doc, bundled in the zip) states verbatim:

> `*.pv`: … contains manually labelled pitch (in the unit of semitone, or MIDI number), with
> frame size = 256 and overlap = 0 … **since the pitch was labelled by the students who did the
> recording, there is no guarantee for their correctness.**

So there are no note events — our `fetch/fetch-mir-qbsh.ts` synthesizes them by rounding each voiced
frame to the nearest semitone, grouping equal runs, and dropping runs < 3 frames (96 ms).

vocadito is the ideal probe for how much that derivation costs, because it ships **both** frame
f0 **and** two human note annotations. I reimplemented our `lib/metrics.ts` matcher (greedy
nearest-onset within tolerance, exact-MIDI gate) in Python, applied our exact MIR-QBSH
derivation to vocadito's f0, and scored it against the human notes across all 40 tracks
(f0 hop = 5.80 ms):

| Comparison | ±50 ms | ±100 ms | ref notes | est notes |
|---|---|---|---|---|
| quantised-f0 (min 3 frames) vs A1 | 0.427 | 0.494 | 56 | **150** |
| quantised-f0 (min 3) vs A2 | 0.358 | 0.424 | 47 | **150** |
| quantised-f0 (min 3) vs Amax | 0.429 | 0.496 | — | 150 |
| quantised-f0 (min 5) vs Amax | 0.456 | **0.547** | — | 120 |
| **human A1 vs A2 (ceiling)** | **0.723** | **0.760** | 47 | 56 |

The derivation over-segments by **~2.7–3.2×** (150 derived notes vs 47–56 human notes). This
independently reproduces the vocadito paper's own finding (they report F=0.20 / Fno=0.38 for
quantised f0 using mir_eval with offset gating; our looser onset-only matcher at a wider
tolerance is the same phenomenon, less harshly scored).

**Consequence:** a *perfect* f0 tracker fed through our MIR-QBSH label pipeline would score
≈0.50 note-F1. Any MIR-QBSH note-F1 movement below that is noise from the label derivation.

**Recommendation:** stop reporting note-F1 on MIR-QBSH. Keep MIR-QBSH, but re-scope it to what
its labels actually support:
- **frame-level f0 metrics** (RPA / RCA / VR / VFA / OA — `mir_eval.melody`), which is exactly
  what `.pv` is; and
- **a retrieval proxy** (does our transcription retrieve the right one of the 48 reference
  MIDIs?), which is the task the corpus was actually built and MIREX-scored for.

Its real value to us is **acoustic realism** — 8 kHz 8-bit phone-grade mono from ~195 untrained
people — not label precision. That, plus the missing license, argues for using it as a
*smoke/robustness* corpus and never as a gate.

### 1.5 Licensing cautions

- **`mirdata`'s table disagrees with Zenodo on vocadito** (CC-BY-NC-SA vs CC-BY-4.0). Zenodo is
  the authors' own deposit and the paper itself is CC-BY-4.0, so CC-BY-4.0 is right and our
  fetcher's annotation is correct. But **snapshot the Zenodo record** (JSON + PDF) into the repo
  as evidence, because "a well-known library said NC" is the kind of thing that surfaces later.
- **Annotated-VocalSet is a two-license composite** in practice: the annotations (Zenodo 7061507)
  and the audio (Zenodo 1193957) are separate records. Both CC-BY-4.0 [verified], so we owe
  **two** attributions, to Faghih & Timoney and to Wilkins et al.
- **CC-BY obliges attribution even for internal use** if we redistribute anything derived. Emit a
  `NOTICE`/`ATTRIBUTIONS` file from the corpus manifest automatically.
- **Do not commit derived audio.** Fixtures are already gitignored — keep it that way; it also
  sidesteps every share-alike/ND clause in the augmentation data (§5).
- "Internal QA of a paid product" **is** commercial use. NC corpora are genuinely off the table,
  not merely risky.

---

## 2. Metrics — exact definitions, conventional tolerances, SOTA

### 2.1 `mir_eval.transcription` defaults [verified from source]

Read from
[`mir_eval/transcription.py`](https://raw.githubusercontent.com/mir-evaluation/mir_eval/main/mir_eval/transcription.py):

```python
def precision_recall_f1_overlap(ref_intervals, ref_pitches, est_intervals, est_pitches,
                                onset_tolerance=0.05,       # 50 ms
                                pitch_tolerance=50.0,       # 50 cents = ±½ semitone
                                offset_ratio=0.2,           # 20 % of ref note duration
                                offset_min_tolerance=0.05,  # floor of 50 ms
                                strict=False, beta=1.0)
```

- Offset tolerance = `max(offset_ratio * ref_duration, offset_min_tolerance)`.
- `offset_ratio=None` disables offset matching entirely → that variant is **COnP**.
- `onset_precision_recall_f1(..., onset_tolerance=0.05)` → **COn**.
- Matching is a **maximal bipartite matching** (not greedy), so one ref note ↔ one est note.

`mir_eval.melody` defaults: `cent_tolerance=50` for `raw_pitch_accuracy`,
`raw_chroma_accuracy`, `overall_accuracy`; `voicing_recall` / `voicing_false_alarm` need no
tolerance. Conventional hop for melody eval is 10 ms.

### 2.2 MIREX / ISMIR2014 note-tracking definitions [verified from the paper PDF]

Molina, Barbancho, Tardón & Barbancho, *Evaluation Framework for Automatic Singing
Transcription*, ISMIR 2014 ([PDF](https://archives.ismir.net/ismir2014/paper/000298.pdf)) —
this is the canonical framework for **singing** specifically, and it defines the three
correctness criteria plus an error taxonomy we should adopt wholesale.

Three independent conditions:
- **Correct Onset**: `|onset_est − onset_ref| ≤ 50 ms`
- **Correct Pitch**: `|pitch_est − pitch_ref| ≤ 0.5 semitone` (= 50 cents)
- **Correct Offset**: within `max(50 ms, 20 % × duration(ref))`

Combined into the three MIREX criteria, each reported as Precision / Recall / F-measure:
- **COnPOff** — onset + pitch + offset. Most restrictive; the MIREX Multi-F0 note-tracking standard.
- **COnP** — onset + pitch, offset ignored. *This is what our harness computes.*
- **COn** — onset only.

One ref note may match at most one est note in every criterion.

> Note a **typo in the published paper**: eq. (9) prose reads `OffRan = max(50ms,
> duration(nGT))` while Figure 1 and the surrounding text say ±20 % of duration. The 20 %
> reading is correct and matches MIREX/`mir_eval`.

**The error taxonomy is the valuable part** — it turns one F1 into an actionable diagnosis:

| Category | Meaning | Reported as |
|---|---|---|
| **OBOn** | Only-Bad-Onset — pitch & offset right, onset wrong | rate over GT |
| **OBP** | Only-Bad-Pitch — onset & offset right, pitch wrong | rate over GT |
| **OBOff** | Only-Bad-Offset — onset & pitch right, offset wrong | rate over GT |
| **S** (Split) | one GT note → several est notes (≥40 % mutual time overlap) | rate over GT + `SRatio > 1` |
| **M** (Merged) | several GT notes → one est note (≥40 % mutual overlap) | rate over GT + `MRatio < 1` |
| **PU** | spurious est note, no overlap with any GT note | rate over transcription |
| **ND** | non-detected GT note, no overlap with any est note | rate over GT |

Molina et al.'s own finding is directly relevant to us: **OBOn was ~20 % for every system
tested**, and they concluded that *"onset detection within a range of ±50 ms is very restrictive
in the case of singing voice with lyrics, since many onsets are not clear even for an expert
musician."* That is the strongest published justification for a wider tolerance on sung input —
worth citing in our own docs when we defend a non-standard tolerance.

Our existing `scripts/eval/note-errors.ts` (pitch-error / missed / spurious) is a partial
version of this; **S / M / OBOn are the missing, most diagnostic three** for singing.

### 2.3 What tolerances are conventional

Confirmed directly from the
[MIREX 2018 Multi-F0 / Note Tracking wiki](https://music-ir.org/mirex/wiki/2018:Multiple_Fundamental_Frequency_Estimation_%26_Tracking):
pitch *"within a half semitone (+/- 3%)"*, onset *"within a 100ms range (+/- 50ms)"*, offset
*"within 20% range of the ground truth note's offset"*. Note MIREX phrases the onset tolerance as
a **100 ms window** = ±50 ms — a recurring source of confusion when comparing papers, and worth
being precise about in our own reporting since we use ±100 ms (a 200 ms window).

| Setting | Onset tol | Pitch tol | Offset | Used by |
|---|---|---|---|---|
| **`mir_eval` / MIREX default** | **±50 ms** | 50 cents | `max(50 ms, 20 %·dur)` | the entire AMT literature |
| Singing transcription papers (MIR-ST500 line) | **50 ms** | 50 cents | 20 % ratio for COnPOff | Mel-RoFormer, SpecTNT, JDCnote, EFN |
| POP909 (looser labels) | **80 ms** | 50 cents | — | Mel-RoFormer, "due to the less precise nature of note onsets and offsets in its labeling method" |
| **Our harness** | **100 ms** | exact MIDI (after rounding) | **not gated** | — |

Two divergences to be deliberate about:

1. **100 ms vs 50 ms — keep 100 ms, and now we can cite why.** Three independent lines of
   evidence support it: Ycart et al.'s human study finds agreement peaks at **75–150 ms** (§4.1);
   Molina et al. found OBOn ≈ 20 % for every system and concluded ±50 ms is "very restrictive …
   many onsets are not clear even for an expert musician"; and Mel-RoFormer itself relaxes to
   80 ms on POP909 "due to the less precise nature of note onsets". The requirement is to
   **label it and also report ±50 ms** for comparability, not to abandon it. Measured cost of the
   choice: A1-vs-A2 agreement rises 0.723 → 0.760, so ±100 ms buys ~4 points of scoring
   generosity — applied equally to us and to the human ceiling, which is why reporting
   fraction-of-ceiling neutralises the concern entirely.
2. **Exact-MIDI vs 50 cents.** We round to integer MIDI and require equality; `mir_eval`
   compares continuous pitches within 50 cents. These coincide *only if* the reference is also
   integer-quantised. vocadito's notes are annotated in **Hz with cent resolution** (singers were
   not in 440 Hz tuning), so rounding the reference to integer MIDI injects error for any singer
   who is >25 cents off concert pitch — plausibly a systematic penalty on flat/sharp singers.
   **Worth measuring**: score with a 50-cent gate on un-rounded reference pitches and see how
   much of our vocadito gap is really a tuning artefact. This is a concrete, cheap experiment
   with a real chance of recovering points for free.

### 2.4 The human ceiling — the most important number we have

vocadito paper, Table 2 (Annotator 2 as reference, mir_eval, 40 tracks):

| Metric | mean | σ | min | max |
|---|---|---|---|---|
| Frame Accuracy (10 ms, ±1 semitone) | 0.83 | 0.08 | 0.61 | 0.92 |
| **F (with offset)** | **0.64** | 0.13 | 0.34 | 0.88 |
| **Fno (no offset)** | **0.74** | 0.09 | 0.57 | 0.94 |

My reimplementation under our matcher: **0.723 at ±50 ms, 0.760 at ±100 ms** — reassuringly
close to the paper's Fno = 0.74, which cross-validates both our metric code and my port.

Why the annotators disagree (paper §3.1, worth internalising because it dictates what we can
ever measure): **A1 labelled grace notes and ornaments as separate notes; A2 grouped them into
single longer notes.** A1 segmented on pitch fluctuation, A2 on lyrical content. The note-length
histograms differ almost entirely in the count of short notes.

Two immediate consequences for our harness:

- **We default to `VOCADITO_ANNOTATOR=A1`**, the *fine-grained* annotator. The paper's own
  baseline scored F=0.43 on A1 vs 0.49 on A2 vs 0.50 Amax — i.e. **choosing A1 costs ~6–7 points
  versus the recommended Amax scoring**, and it penalises a pipeline that (sensibly, for a
  notation product) merges ornaments into one note. The authors' explicit recommendation: *"if
  any style of transcription is acceptable, we recommend reporting the scores as in Amax."*
  **We should switch the headline vocadito number to Amax** (per-track max over A1/A2), and keep
  A1/A2 as a reported spread. This is the single cheapest correctness fix in the whole harness.
- **Any vocadito target above ~0.76 is meaningless.** Express our score as a *fraction of the
  human ceiling*, not an absolute.

### 2.5 Published SOTA figures

**MIR-ST500 test set** — Mel-RoFormer, ISMIR 2024, Table 3
([arXiv 2409.04702](https://arxiv.org/pdf/2409.04702)). mir_eval, 50 ms onset tol, 50 cents
pitch tol. Split: train 330 / val 37 / test 98 (of the official 100 — some audio unobtainable).

| Model | #Param | COn | COnP | COnPOff |
|---|---|---|---|---|
| Efficient-b1 (Wang et al. 2021) | — | .754 | .666 | .458 |
| JDCnote | — | .762 | .697 | .422 |
| A-VST (audio-visual) | — | .783 | .707 | .538 |
| Perceiver TF | — | — | .777 | — |
| MERT (324M) | 324M | .775 | .751 | .530 |
| SpecTNT | 8.4M | .801 | .778 | .550 |
| Mel-RoF-small | 14.5M | .807 | .786 | .609 |
| **Mel-RoF-large** | 64.6M | **.819** | **.798** | **.625** |

**POP909 test set** — same paper, Table 4, **80 ms** tolerance. Best: Mel-RoF-large COn .869 /
COnP .842 / COnPOff .486.

**vocadito** — the only published note baseline is Vocano (vocadito paper, Table 3):

| Metric | vs A1 | vs A2 | Amax |
|---|---|---|---|
| Frame Acc | 0.55 (.11) | 0.55 (.10) | 0.56 (.10) |
| F (with offset) | 0.43 (.11) | 0.49 (.10) | **0.50 (.10)** |
| Fno (no offset) | 0.57 (.11) | 0.63 (.09) | **0.64 (.09)** |

And CREPE f0 on vocadito (Table 4): **VR 0.89, VFA 0.31, RPA 0.98, RCA 0.98, OA 0.82.** Note
RPA ≈ RCA ⇒ CREPE makes essentially **no octave errors** on clean solo voice. If our
octave-error rate on clean vocadito is materially above ~0, the fault is in our note-forming
stage or our register windowing, not in pitch tracking.

**Sanity floor** (vocadito paper §3.2): quantising ground-truth f0 to notes gives **F=0.20,
Fno=0.38, Acc=0.55**. Our pipeline must beat this by a wide margin or it is doing nothing a
one-line quantiser doesn't.

**M4Singer (clean, monophonic, professional singing) — the best anchor for our task shape.**
ROSVOT, [arXiv 2405.09940](https://arxiv.org/html/2405.09940v2); 50 ms onset, 50 cents pitch:

| Model | COnPOff (clean) | COnPOff (noisy) | COnP | COn |
|---|---|---|---|---|
| **ROSVOT** | **77.4** | 77.0 | **80.3** | **94.0** |
| Yong et al. 2023 | 65.8 | 62.1 | — | — |
| MusicYOLO | 58.9 | 51.5 | — | — |
| VOCANO | 50.2 | 43.4 | — | — |
| TONY | 43.9 | 28.4 | — | — |

This is the single most useful comparison point in the report: **monophonic, solo, no separation
required** — the same task shape as ours. Note COn 94.0 vs COnPOff 77.4: even SOTA loses ~17
points purely to offset placement. And note the spread: TONY (a well-regarded pYIN-based
tool) manages only 43.9, and degrades to 28.4 under noise, while ROSVOT barely moves. Robustness
is where the modern gap lies, which is exactly what our adverse tier is for.

Caveat: M4Singer is *professional* singers reading composed scores, so 77.4 is an easier
distribution than untrained consumer humming. And it is CC-BY-NC-SA, so we can read the number
but cannot run on the data.

**Other note-level figures** (phoneme-informed model,
[arXiv 2304.05917](https://arxiv.org/pdf/2304.05917); 50 ms onset, 50 cents, offset
`max(50 ms, 0.2·dur)`):
- **ISMIR2014/Molina**: COn F1 **0.9305**, COff 0.8576
- **CSD**: COn F1 **0.9145**, COff 0.7723
- **SSVD v2.0**: COnP **0.8558**, COnPOff **0.8303**; MusicYOLO reports 84.60 % F1

COn ≈ 0.91–0.93 on clean solo singing is a useful reality check: **onset detection on clean solo
voice is close to solved**; the value is in pitch, offsets, and robustness.

**f0 tracking on PTDB-TUG** (licence-clean, ODbL) — *Cross-domain Neural Pitch and Periodicity
Estimation*, [ar5iv 2301.12258](https://ar5iv.labs.arxiv.org/html/2301.12258), 50-cent tolerance:

| Model | RPA | Δ¢ |
|---|---|---|
| FCNF0++ | .9825 | 12.72 |
| DeepF0++ | .9828 | 12.66 |
| CREPE++ | .9783 | 15.15 |
| CREPE (original) | .9748 | 21.07 |
| torchcrepe | .9103 | 59.40 |
| pYIN | .8477 | 110.5 |
| DIO+Stonemask | .6961 | 80.10 |

Useful because it is the one **commercially licensed** corpus with a real leaderboard, so we can
legitimately publish/compare our own f0 stage against it. Note the large gap between CREPE
(.9748) and `torchcrepe` (.9103) — implementation and post-processing matter as much as the model.

**Critical caveat on the MIR-ST500 numbers:** that leaderboard is **vocal melody transcription
from full polyphonic pop mixes** — the models' advantage comes substantially from source
separation (Mel-RoFormer *is* a separation model). Our task is **solo, dry, consumer-mic voice /
humming / whistling**. The two are not comparable in either direction. Do not adopt .798 COnP as
a target; the right anchor is the vocadito Vocano baseline (Fno 0.64) and the vocadito human
ceiling (0.74–0.76).

### 2.6 Realistic target-setting

Anchors, all onset+pitch (COnP-style, offset ignored), on solo voice:

| Anchor | Value | Meaning |
|---|---|---|
| quantised-f0 floor | 0.38 (Fno) | do-nothing baseline |
| Vocano baseline, Amax | 0.64 (Fno) | a real published system |
| Human A1-vs-A2 ceiling | 0.74 (mir_eval) / **0.76 (our matcher, ±100 ms)** | the measurement limit |

So the entire usable dynamic range on vocadito is roughly **0.38 → 0.76**, and a "good" system
lands near 0.64. Expressed as fraction-of-ceiling: Vocano ≈ 86 %.

**Why the numbers differ so much across corpora** — worth internalising before setting targets,
because the corpus matters more than the model:

| Corpus | Singers | COn | COnP | COnPOff |
|---|---|---|---|---|
| ISMIR2014/Molina (untrained, incl. children) | untrained | 0.93 | — | — |
| CSD (1 professional) | pro | 0.91 | — | — |
| M4Singer (20 pro, composed scores) | pro | 0.94 | 0.80 | 0.77 |
| SSVD v2.0 (sight-singing) | trained | — | 0.86 | 0.83 |
| **vocadito (volunteers, consumer mics)** | **mixed/untrained** | — | **0.64 human ceiling** | **0.64 F human** |
| MIR-ST500 (polyphonic pop) | pro, with backing | 0.82 | 0.80 | 0.63 |

**vocadito is by far the hardest, and it is also by far the closest to our users.** Untrained
singers on cell-phone mics produce audio whose *human annotator agreement* (0.64–0.74) is below
the *machine COnP* on professional corpora (0.80–0.86). Any target we set must be corpus-specific;
a single global "note F1 ≥ X" gate across mixed corpora would be meaningless.

---

## 3. Benchmark suite design (see §7 for the concrete proposal)

### 3.1 Statistical power — measured for our corpus sizes

Simulated with the per-clip F1 σ actually observed on vocadito (σ ≈ 0.085–0.10), 10k bootstrap
resamples, resampling **at clip level**.

**Unpaired: 95 % bootstrap CI half-width on mean note-F1**

| n clips | CI half-width |
|---|---|
| 20 | ±4.7 pts |
| 40 | ±2.5 pts |
| 100 | ±1.9 pts |
| 200 | ±1.4 pts |
| 500 | ±0.9 pts |

**At n=40 (vocadito's full size) a single-run F1 is only known to ±2.5 points.** Chasing a
1-point improvement on vocadito alone is not statistically possible.

**Paired: power to detect a true Δ (same clips, two pipeline versions, α=0.05 two-sided)**

per-clip difference σ = 0.04 (closely-related versions):

| n clips | Δ=+1pt | +2pt | +3pt | +5pt |
|---|---|---|---|---|
| 20 | 22 % | 61 % | 90 % | 100 % |
| 40 | 36 % | 89 % | 100 % | 100 % |
| 100 | 70 % | 100 % | 100 % | 100 % |
| 200 | **95 %** | 100 % | 100 % | 100 % |

per-clip difference σ = 0.08 (a change that reshuffles behaviour):

| n clips | Δ=+1pt | +2pt | +3pt | +5pt |
|---|---|---|---|---|
| 40 | 15 % | 36 % | 67 % | 97 % |
| 100 | 24 % | 71 % | 96 % | 100 % |
| 200 | 43 % | 95 % | 100 % | 100 % |
| 300 | 58 % | 99 % | 100 % | 100 % |

**Conclusions:**
- **Always compare paired** (same clips, both versions) and report the mean *difference* with a
  paired bootstrap CI. Paired testing is worth roughly a 4–5× reduction in required corpus size.
- **~200 clips** is the practical floor for reliably detecting the ~1–2 point changes that
  tuning work actually produces. vocadito's 40 clips cannot do it; **Annotated-VocalSet's 3,560
  clips can**, and it is CC-BY-4.0. That is the strongest argument for making
  Annotated-VocalSet — not vocadito — the primary statistical workhorse.
- Bootstrap **at the recording level, never the note level**. Notes within a clip are strongly
  correlated (same singer, same mic, same room); note-level resampling would understate the CI
  by roughly √(notes per clip) ≈ 7×.

### 3.2 Threshold-tuning discipline

Our harness is explicitly built for sweeping (`sweep-real.ts`, and a dozen `RECORDING_*` env
knobs). That is exactly the setup in which a small test corpus dies quietly: every sweep that
picks a winner *by test-set F1* transfers a little information from the test set into the
config, and after enough sweeps the reported number is partly memorised. With n=40 and a ±2.5
point CI, the "best" of 20 swept configs is expected to be ~1 σ above its own true value purely
by selection.

Minimum discipline:
- **Split the real corpora into dev and test, by singer** (not by clip — the same singer's clips
  are correlated). Sweep on dev only.
- Test set gets touched **on release candidates**, not per-commit.
- Record every test-set evaluation in a log (date, commit, config, result). The count of
  test-set looks is itself the overfitting risk metric.
- Any threshold chosen per-condition must be chosen on dev per-condition.

---

## 4. Perceptual / product metrics

### 4.1 The one large perceptual study — and it reshapes our metric choices

Ycart, Liu, Benetos & Pearce, *Investigating the Perceptual Validity of Evaluation Metrics for
Automatic Piano Music Transcription*, **TISMIR 3(1):68–81, 2020**
([DOI](https://doi.org/10.5334/tismir.57) ·
[PDF](https://transactions.ismir.net/articles/10.5334/tismir.57) ·
[data](https://zenodo.org/record/3746863) · [PEAMT code](https://github.com/adrienycart/PEAMT)).

Design: **two-alternative forced choice** ("which transcription sounds most similar to the
reference?"), 5–10 s phrases from MAPS, 4 systems, **186 participants**, **4,501 answers**,
1,080 questions with 4 ratings each. They deliberately rejected absolute Likert scales because
raters use different, drifting scales.

Findings that bear directly on our harness:

- **Onset-only note F (COnP) is the benchmark metric that best matches human preference**, and
  agreement peaks at onset tolerances of **75–150 ms**. This is a direct endorsement of our
  ±100 ms choice.
- **They explicitly contradict the received wisdom** that onset+offset F is the most
  perceptually relevant metric: *"the OnOff-Note metric, presented as the most
  perceptually-relevant evaluation metric by Hawthorne et al. (2018), is actually not the best
  metric in terms of agreement with human ratings."* They keep it only as "a meaningful objective
  that is difficult to achieve."
- **F-measure is unreliable exactly where we operate.** When ΔF > 50 % raters always agree with
  it; **when ΔF < 10 %, confident raters disagree with F nearly 40 % of the time.** The authors:
  *"F_n,On is a good enough metric in clear-cut cases … but should probably be treated with
  caution for small differences between AMT systems … very often, differences between systems are
  of the order of a few percentage points."* **This is the regime all our tuning work lives in.**
- **Inter-rater agreement: Fleiss κ = 0.59** overall, rising to **κ = 0.90** on questions all
  raters called easy. Adding a 5-point self-reported difficulty question is the cheapest quality
  control available.
- More musical training correlated with **less** agreement with F-measure (Gold-MSI −0.014,
  p=0.011) and less agreement with each other — trained musicians attend to melody, harmony and
  meter that note-F ignores.
- **Rhythm features were the most valuable non-benchmark contribution** in their ablation.
  Octave-error and out-of-key features were *counter-productive* in their linear model — keep
  those as diagnostics, not as score components.
- Their trained metric **PEAMT** buys only **~1 percentage point** over onset-only F (p < 10⁻⁶).
  It is piano-only, needs target velocities + sustain-pedal CC#64. **Take the feature
  definitions, not the model.**
- Two scope limits the authors state, both relevant: (i) *"should not be generalised e.g. to
  singing voice"* — so treat the 75–150 ms finding as strong but not proven for our domain;
  (ii) perceptual similarity is the right criterion *"when the overall musical quality … matters
  more than precise transcription of every note, e.g. quick dictation of musical ideas"* — which
  is exactly our product, as opposed to music education where COnPOff = 1 is the goal.

### 4.2 MV2H — and why not to report it as a single number

McLeod & Steedman, *Evaluating Automatic Polyphonic Music Transcription*, ISMIR 2018
([PDF](https://ismir2018.ircam.fr/doc/pdfs/148_Paper.pdf)); non-aligned extension
[arXiv:1906.00566](https://arxiv.org/pdf/1906.00566); [code](https://github.com/apmcleod/MV2H)
(Java, MIT). Its organising principle is **disjoint penalties** — one error must be penalised
only once. Five sub-metrics, combined as an **unweighted arithmetic mean**: multi-pitch F (50 ms
onset, offsets ignored), voice F (edge-based, after deleting notes that weren't multi-pitch TPs),
metrical F (sub-beat/beat/bar groupings, 50 ms, level-agnostic), note-value score (100 ms
tolerance then linear decay), harmony (weighted key score + chord symbol recall).

**For monophonic singing, two of the five are degenerate or unavailable:**
- **Voice F pins near 1.0** — with one voice, every surviving consecutive-pair edge is correct by
  construction. It only dilutes the mean.
- **Harmony needs chord ground truth**, which solo humming does not have.

And the composite actively hides what we care about. The IJCAI 2024 hierarchical-decoding paper
([arXiv:2405.13527](https://arxiv.org/pdf/2405.13527)) on real recordings reports multi-pitch
F = **63.3** but composite **MV2H = 74.2**, because the near-constant voice (88.4) and note-value
(90.7) terms hold the average up. The authors themselves never validated the weighting: they
promised to investigate it in future work and, as far as this search found, **no follow-up ever
did.**

**Verdict: do not report an MV2H composite. Do steal its metrical F-measure and note-value
score** — those are the two sub-metrics that survive the move to monophonic, and they are exactly
the rhythm dimension Ycart's ablation found most perceptually important.

### 4.3 Edit distance = correction effort — the best product-level metric

This is where the literature converges on something a musician actually feels.

- **MUSTER** (Nakamura et al., ICASSP 2018 / ISMIR 2021; tool at
  [amtevaluation.github.io](https://amtevaluation.github.io/)) decomposes into
  `E_p` pitch, `E_e` extra, `E_m` missing, `E_on` onset (via a *rhythm correction cost* = minimum
  scale/shift operations on onset score times), `E_off` offset, `E_v` voice, and `E_all` as their
  mean. Their argument, quotable: *"The edit-distance-based metrics have a clear interpretation:
  they count how many notes or score elements should be edited to obtain the correct score."*
- **Sheet Music Benchmark** (ISMIR 2025, [arXiv:2506.10488](https://arxiv.org/html/2506.10488v1))
  on Symbol Error Rate: *"it still stands as the best metric to correlate the human correction
  effort that is necessary to obtain the desired score. However such correction effort does not
  indicate in which aspect of the transcription process the OMR is struggling."* — i.e. pair a
  scalar edit distance with a categorical decomposition.
- **Cogliati & Duan** (ISMIR 2017, [PDF](https://archives.ismir.net/ismir2017/paper/000131.pdf))
  regressed 12 notation-error counts onto human ratings: **R² = 0.558 / 0.534 / 0.601**
  (r ≈ 0.75/0.73/0.78) for pitch notation / rhythm notation / note positioning. Their documented
  failure is a disjoint-penalties one: a single meter error exploded barline and duration counts,
  predicting 2.78 vs a human 5.98.
- **Mongeau & Sankoff (1990)** is the canonical monophonic melodic edit distance and the only
  classical formulation with **fragmentation and consolidation** (= split and merge) as
  first-class operations — precisely the dominant sung-note error modes. Ycart et al. dismiss it
  for frame-level AMT because it assumes quantised durations; **our output is a quantised score,
  so that objection does not apply to us.**
- Román et al. (ISMIR 2018, [PDF](http://ismir2018.ircam.fr/doc/pdfs/87_Paper.pdf)), the one
  **monophonic** audio-to-score precedent, used ASR-style **CER 5.36 % / WER 15.67 %** and found
  *"the majority of errors are due to wrong time signatures, barline locations, and clefs"* — a
  single wrong time signature propagates into every note. Same conclusion as Cogliati.

**Third-party numbers for commercial notation software** (MUSTER `E_all` on MAPS piano, lower is
better): **Finale 2014 = 31.1 %**, **MuseScore 2 = 29.0 %**, vs Nakamura's own NMetHMM = 21.4 %.
This is the only published quantitative comparison against shipping notation products I found.

### 4.4 Retrieval (QBH) as a guardrail, not a target

MIREX QBSH scoring is *"Mean reciprocal rank (MRR) of the ground truth, as well as the simple
hit(1)/miss(0) counting … over the top 10 returns"*
([MIREX wiki](https://music-ir.org/mirex/wiki/2017:Query_by_Singing/Humming)). MIR-QBSH provides
4,431 queries against 48 reference MIDIs — and it is the one metric MIR-QBSH's labels genuinely
support.

But it is structurally blind to the errors that break a *score*: Molina et al. note directly that
*"frame-based systems for query-by-humming are not affected by splits."* QBH matches pitch
contours with DTW, so splits, merges, offsets and quantisation are invisible to it. It also
saturates (modern top-10 hit rates 0.75–0.99) and is wildly corpus-dependent — in MIREX 2009 the
same system scored **0.94 on one corpus and 0.43 on another**.

**Verdict: cheap automatic guardrail against gross pitch-contour regressions. Never a north star.**

### 4.5 Nobody in this market publishes accuracy

Checked vendor pages directly: **Klangio**, **AnthemScore/Lunaverus**, **ScoreCloud**,
**Samplab**, **Celemony Melodyne** — **none publishes any accuracy figure**, only qualitative
claims ("high-accuracy results", "usually most of the work … is done for you"). Dorico "audio
input" appears not to exist as a feature (Steinberg's audio-to-MIDI is in Cubase). Every one of
them ships an **editing UI as the accuracy escape hatch**, which strongly implies the quantity
the whole category is implicitly optimising is **edits-to-acceptable**.

Two consequences: publishing an accuracy percentage invites scrutiny we cannot win and no
competitor has invited; and *correction effort* is both the honest metric and the competitive axis.

### 4.6 Human-panel sizing and rubric design

- **Prefer 2AFC over absolute scales** for ship/no-ship decisions (Ycart's rationale above).
  **Always add the 5-point difficulty question** — it moved κ from 0.59 to 0.90.
- **Give explicit criteria.** Cogliati & Duan attribute their rater variance to annotators "not
  given exact instructions on what features to consider."
- **Adopt Molina et al.'s annotation conventions** for any singing ground truth we create
  ourselves: ornaments and vibrato are *not* separate notes; portamento does *not* create a third
  note; onsets at the start of voiced segments and at each clear pitch/phoneme change; for voiced
  consonants (l/m/n) + vowel the onset goes at the **vowel**; pitch annotated in cents.
- **Agreement targets**: Krippendorff **α ≥ 0.80** reliable, 0.67–0.79 tentative, < 0.67 reject
  the round ([k-alpha.org](https://www.k-alpha.org/methodological-notes)). Cohen's κ ≥ 0.60 as a
  hard floor; McHugh (2012) also advises **≥ 30 comparisons** minimum.
- **Sizing** (binomial 95 % CI half-width on a win-rate at p=0.5): n=30 → ±17.9 pp; n=50 → ±13.9;
  n=100 → ±9.8; **n=200 → ±6.9**; n=384 → ±5.0. Mean of a 1–5 rubric (SD≈1.0): n=100 → ±0.20,
  n=200 → ±0.14. **~150–300 rated clips per release** is the sweet spot; resolving sub-10 pp
  differences needs 400+.
- **Evidence gap**: no MOS-style absolute-scale listening test for AMT appears to exist. If we
  build one we are ahead of the literature — and must validate agreement ourselves.

### 4.7 Tooling gap

**There is no published Python tool that computes split/merge/octave/quantisation decomposition
for monophonic sung input.** Molina's toolbox is Matlab (2014, and its host is dead — §1.1);
PEAMT is piano-specific and needs velocities + pedal; `mir_eval` has no edit-distance or
split/merge module at all; MUSTER is a Java/script bundle over MusicXML. The Molina definitions
are complete enough to reimplement in a few hundred lines, and that is the recommendation.

---

## 5. Degradation / augmentation toolkits

Full license audit in the parallel stream's report; the operative conclusions:

**Code stack, commercially clear:** `audiomentations` (**MIT**) as the engine, with
`pyroomacoustics` (MIT) for parametric `RoomSimulator`, `fast-mp3-augment` (**LGPL-2.1**, no
obligations since we never distribute it), `ffmpeg` for codec round trips, `scipy.signal` for
IR convolution. `torch-audiomentations` (MIT) is unnecessary for a fixture generator.

**Quarantine, never importable from API/worker code:** `pedalboard` (**GPLv3** — but has the
uniquely useful `Convolution` and `GSMFullRateCompressor`) and **ITU-T G.191 STL** (ITU-T
GPLv1-derived copyleft — the reference IRS/P.341 handset filters, MNRU, and the EID frame-erasure
simulator). Enforce with an import lint, not convention. Our `scripts/eval` boundary already
matches this shape.

**Rejected:** `torchaudio.sox_effects` (deprecated, removed in 2.9), `muda` (dormant),
`audio_degrader` (GPL-3 **and** bundles unprovenanced IR/noise data), unlicensed WADA-SNR ports.

**Data, commercially clear:** BUT ReverbDB (CC-BY-4.0) for real rooms; OpenSLR **SLR26** /
SLR28-`simulated_rirs` (Apache-2.0); MUSAN (CC-BY-4.0), DEMAND (CC-BY-SA-3.0), CHiME-5
(CC-BY-SA-4.0, explicitly "free for both academic and commercial purposes"), FSDnoisy18k
(CC-BY-4.0), FSD50K **filtered to CC0+CC-BY** (drops ~6,041 NC/Sampling+ clips), MS-SNSD (MIT).

**Two traps worth flagging:**
- **OpenSLR SLR28 is labelled Apache-2.0 but its `real_rirs_isotropic_noises/` aggregates RWCP
  (OpenSLR SLR13: "research and development use only") and REVERB-2014.** An aggregator can't
  relicense upstream data. Use only `simulated_rirs/` and `pointsource_noises/` (MUSAN-derived).
  This mislabel is repeated throughout Kaldi/ESPnet/lhotse recipes and most papers.
- **Excluded on license grounds:** WHAM!/WHAMR!, ESC-50, UrbanSound8K (all CC-BY-**NC**), TAU
  Urban Mobile (Non-Commercial — a real loss, it's the one real multi-device mobile corpus),
  AudioSet audio (YouTube ToS), ACE Challenge (CC-BY-**ND**), MIT IR Survey (**no license at
  all** — despite being widely used and mirrored on HuggingFace as "CC-BY-4.0").

**The phone-capture gap, and why it matters more than reverb for us.** There is **no usable,
commercially licensed corpus of measured phone-mic transfer functions** — model it
parametrically from the ITU-T P-series masks (P.48 IRS, P.830 Annex D, P.341, P.501) instead.
The chain worth building, in occurrence order: MEMS mic response → handling/proximity → room →
additive noise → **AGC** → **noise suppression** → Opus → packet loss.

Two of those are under-modelled everywhere and are likely top failure modes for us specifically:

- **The MEMS high-pass knee sits on our fundamental.** Phone mics roll off hard below
  ~100–150 Hz. A male hum at f0 ≈ 100–150 Hz can arrive with its fundamental attenuated 6–20 dB
  relative to H2 — the classic octave-error trigger, and directly connected to the
  register-dependent frequency windowing already in our pipeline. **Sweep the HPF corner as a
  first-class eval axis.**
- **AGC and browser noise suppression are on by default** (`getUserMedia`
  `autoGainControl: true`, and WebRTC's APM runs spectral NS). AGC is a *time-varying* envelope:
  it pumps soft onsets and drifts on sustained notes. NS can gate the decaying tail of a hum as
  "noise", truncating offsets. Both are degradations to survive, not filters to apply — and we
  should also check which constraints our web client currently requests, since they can be
  disabled client-side.
- **Bluetooth is a distinct, harsher path**: HFP/HSP is narrowband **CVSD at 8 kHz** or mSBC at
  16 kHz. A user humming into AirPods gives us 16 kHz at best.
- **Codec scope:** simulate **Opus** at 12/16/24 kbps `-application voip` with `-cutoff
  4000/8000` and `-packet_loss`. Skip AMR-NB/GSM — they only occur on PSTN, nobody hums into our
  product over a phone call, and AMR is our only real patent exposure.

---

## 6. Where the evidence is thin

- **Whistling**: no note-annotated public corpus found at all. Our synthetic whistle tier is
  unvalidated against real whistling. Genuine gap.
- **Humming**: near-total absence of note-annotated humming. **HumTrans (2023)** is the one
  promising lead and I did not verify it this session — highest-value single follow-up.
- **Datasets not verified this session**: **Bach10, URMP, MusicNet, Good-sounds,
  IDMT-SMT-Guitar/Bass, Erkomaishvili, Smule DAMP, Hum2Song**, and MIREX QBSH corpora other than
  MIR-QBSH. (HumTrans, Opencpop, M4Singer, GTSinger, CSD, NUS-48E, JVS-MuSiC, PTDB-TUG, TONAS,
  SSVD were verified — see §1.1/§1.2.) None of the outstanding ones is likely to change the
  picture: they are instrument corpora, and our task is voice.
- **SSVD v2.0 is the one tempting unknown**: 194 sight-singing recordings with *fully manual*
  note-level annotations (4 trained annotators, cross-checked) and a published SOTA (MusicYOLO
  84.60 % F1) — but **no license file at all**. Worth an email to the authors; if they'd grant
  CC-BY it would be a genuinely valuable third clean corpus.
- **The "±100 ms is perceptually better" evidence is piano-only.** Ycart et al. state explicitly
  that their results *"should not be generalised e.g. to singing voice."* The 75–150 ms finding is
  the best evidence available and it is corroborated by Molina's OBOn result, but it is not proven
  for our domain. Our own T5 human panel would be the way to confirm it.
- **The vocadito ceiling is n=2 annotators on 40 clips.** 0.76 is the best ceiling estimate we
  have, but it rests on two people's stylistic conventions, and the paper shows they differ
  systematically (ornaments as separate notes vs grouped). Treat it as an estimate with real
  uncertainty, not a constant.
- **Licenses marked [secondary]** in §1.1 come from `mirdata`'s table only — and `mirdata` is
  demonstrably wrong about vocadito. Since verified against primary sources: Dagstuhl ChoirSet
  ✅ CC-BY-4.0, Slakh2100 ✅ CC-BY-4.0, MAESTRO ❌ CC-BY-NC-SA-4.0 (confirmed on Magenta's own
  page), MedleyDB ❌. **Still unverified: MDB-stem-synth, IDMT-SMT-Audio-Effects,
  PHENICX-Anechoic** — all three are NC per `mirdata` and none matters much for our task, so this
  is low priority.
- **Beware third-party Zenodo re-uploads.** Searching Zenodo for "MAESTRO" surfaces several
  derivative records labelled CC-BY-4.0, while the authoritative Magenta page says CC-BY-NC-SA-4.0.
  A re-uploader cannot broaden a license. Always resolve to the originating project's own page.
- **ISMIR2014/Molina dataset — ⛔ CLOSED, 2026-08-08: it is NON-COMMERCIAL, and that was never
  the question anyone asked.** Every previous note in these docs framed this as an *availability*
  problem ("dead URL", "mirror unconfirmed", "worth an email"). It is a *licence* problem, and the
  primary source says so plainly. The real published URL is
  `http://www.atic.uma.es/ismir2014singing` (not `…singingdataset` — earlier notes had the path
  wrong), and its `readme.txt`, recovered from the Wayback Machine, states:

  > "All the .WAV files provided, transcriptions and all the annotations are offered free of
  > charge for **non-commercial use only**. You can not redistribute it nor modify them.
  > Distribution rights granted to ATIC Research Group, Universidad de Malaga."

  That is the same restriction as HumTrans, M4Singer, CSD and GTSinger, so §7's "don't touch NC
  data" rule bars it outright. **Stop chasing it.** Note the split: the *toolbox* (CommandLineTool
  + GUI) is GPL-3.0 and could be reused, but we already implement Molina's taxonomy independently
  in `scripts/eval/lib/segErrors.ts`; only the data is barred, and the data is the part we wanted.

  For the record, the availability question is also settled and the answer is "gone": the live path
  soft-404s (143 KB of UMA homepage, identical SHA to `/`), and the Wayback Machine holds the page,
  `readme.txt`, `MTGQBH_renaming.m`, the paper and the poster — but **never** the
  `EvaluationFramework_ISMIR2014.rar` that contained the annotations and the 14 children's clips.
  Crawlers skipped the binary. archive.today has nothing.

  One structural detail worth keeping, since it explains why partial recovery would not have helped
  either: only 14 of the 38 clips (the children) were ATIC recordings shipped in the `.rar`. The
  other 24 are **MTG-QBH** clips (`MTGQBH_renaming.m` maps `q1→afemale1`, `q21→amale1`, …), and
  MTG-QBH is a query-by-humming *retrieval* corpus — song-identity metadata, no note-level truth,
  the same category as the `mir-qbsh` we already hold and flag `noteTruthDerived`. The value was
  always in ATIC's annotations, and those are the NC part.
- **Dagstuhl ChoirSet is NOT a note corpus — verified against the artifact, 2026-08-08.** The row
  in §1.1 said "f0 + notes + beats"; range-reading the release zip's central directory
  (`DagstuhlChoirSet_V1.2.3.zip`, 5.1 GB) shows what it actually ships:
  `annotations_csv_F0_CREPE` (1,186 files), `annotations_csv_F0_PYIN` (1,186),
  `annotations_csv_F0_manual` (**9**), `annotations_csv_beat` (21),
  `annotations_csv_scorerepresentation` (81), `audio_wav_22050_mono` (1,658).
  There is **no performed-note annotation anywhere in it**: the "notes" are a *score*
  representation — the written music, not what was sung — and the f0 is our own estimator's output
  for all but nine files. Deriving note truth from either would reproduce the mir-qbsh mistake
  (scoring a segmenter against a sibling of itself) with the extra sin of using CREPE to judge
  CREPE. Genuinely a shame: it is amateur singers on close-up per-singer mics, which is closer to
  our users than Annotated-VocalSet's professionals. Its **beat** annotations remain interesting on
  their own — no voice corpus we hold has real tempo, which is why `notation-eval.ts` can score the
  notation stage in beats only on GuitarSet.
- **TONAS / cante100 / Filosax**: request-gated, terms unknown; MTG's download host 403s.
- **Realistic-user-corpus practice** (crowdsourcing mechanics, GDPR posture, nightly-eval
  engineering): that stream had not reported at the time of writing. I verified the Smule DAMP
  question myself (§1.2b — withdrawn *and* non-commercial), but **GDPR lawful basis and retention
  design for collecting user recordings is not covered here and needs legal input**, not just
  research. That is a genuine open item before T4 collection starts.
- **No MOS-style absolute-scale listening test for AMT exists** in the literature (§4.6). Our T5
  rubric design would be novel and must self-validate agreement rather than lean on precedent.
- **My ±100 ms and exact-MIDI reimplementation** matches `lib/metrics.ts` semantics as I read
  them, but is a port, not the real code. The A1-vs-A2 = 0.723 @ 50 ms vs the paper's Fno = 0.74
  gives reasonable confidence. Re-run inside the harness before quoting externally.

---

## 7. Recommendation: the benchmark suite to build

### Tier structure

| Tier | Corpus | n | Runs | Purpose | Gate |
|---|---|---|---|---|---|
| **T0 smoke** | synthetic clean, one melody per register | ~10 | every commit | catch crashes / gross regressions | note-F1 ≥ 0.90 absolute |
| **T1 dev** | synthetic × degradations + **Annotated-VocalSet dev split** | ~300 | nightly + per-PR | the tuning surface; all sweeps happen here | no per-condition drop > 3 pts vs baseline |
| **T2 test** | **Annotated-VocalSet test split** (held-out singers) + **vocadito (all 40)** | ~200 + 40 | release candidates only | the honest number | paired bootstrap CI on ΔF1 excludes −1 pt |
| **T3 realism** | MIR-QBSH (f0 + retrieval metrics only) + phone-chain degradations | ~50 | nightly, non-gating | acoustic realism, trend watch | report-only |
| **T4 golden** | real user recordings, consented | 100→300 | weekly | the only tier that measures the product | report-only until stable |
| **T5 human** | 2AFC panel, new build vs production, + difficulty question | 150–300 judgements | per release, and for any sub-10-pt F change | is it actually *better* | win-rate CI excludes 50 % |

Splits **by singer**, never by clip. Annotated-VocalSet's 20 singers make this easy and give a
genuine generalisation test; its 3,560 clips are what make T1/T2 statistically capable.

### Metrics to report at every tier

Primary, per the ISMIR2014 framework (§2.2) — and report **both tolerances** so we stay
comparable to the literature while keeping a sung-input-appropriate headline:

1. **COnP F1 @ 100 ms** (headline — perceptually validated, §4.1) **and @ 50 ms**
   (literature-comparable). One code path, two numbers.
2. **COnPOff F1 @ 50 ms**, offset tol `max(50 ms, 20 %·dur)` — currently missing entirely.
   Track it as an engineering objective (it is what separates a correct *note value* from a
   correct pitch), but **do not headline it**: Ycart et al. show it is a worse perceptual proxy
   than onset-only F.
3. **COn F1** — isolates segmentation from pitch.
4. **Chroma-F1 and octave-error rate** — keep as **diagnostics**. CREPE's RPA≈RCA on vocadito
   means any nonzero octave error is ours to fix. Note Ycart's finding that octave features were
   counter-productive as *score components* — so diagnose with them, don't optimise them.
5. **The Molina error taxonomy**: OBOn / OBP / OBOff / **Split (+SRatio)** / **Merged (+MRatio)** /
   PU / ND. Split and Merged are the two we lack and the two that most directly explain a
   notation-product failure — Molina found systems split systematically on initial pitch bends,
   and segmentation quality (not pitch) decided which system won their comparison.
6. **Onset bias / std** — keep; bias is calibratable, std is not.
7. **Fraction of human ceiling** on vocadito (F1 ÷ 0.76) as the headline framing.
8. **"Notes to fix"** — normalised note edit distance in score space (§4.3): DTW-align on pitch,
   then count insert / delete / substitute-pitch / substitute-duration / **split** / **merge** over
   quantised (pitch, note-value) pairs, normalised by reference length. **Report median and P90
   per clip, not the corpus mean** — the product question is "what fraction of takes need more
   than N fixes". This is the number to put in front of a musician, a support ticket, or a
   roadmap discussion, and it is the metric the literature ties most directly to human correction
   effort.
9. **Rhythm/meter score** — MV2H's metrical F + note-value score (§4.2), the two sub-metrics that
   survive monophony. Rhythm was the most perceptually important non-benchmark feature in Ycart's
   ablation, and a wrong time signature is the error that propagates into every note.

Scoring fixes to make first, cheapest-first:
- **vocadito → Amax scoring** (per-track best of A1/A2). Costs nothing, recovers ~6 pts of
  mis-attributed error, and follows the dataset authors' explicit recommendation.
- **50-cent pitch gate on un-rounded reference pitch**, instead of exact integer-MIDI equality.
  vocadito annotates in Hz at cent resolution; rounding penalises singers off concert pitch.
- **Drop MIR-QBSH note-F1**; replace with `mir_eval.melody` metrics + retrieval top-k.

### Target numbers (solo voice, COnP-style)

| Corpus | Metric | Floor | Target | Ceiling |
|---|---|---|---|---|
| vocadito, Amax | COnP @ ±100 ms | 0.38 (quantiser) | **0.60–0.65** (≈ Vocano, ≈85 % of ceiling) | 0.76 (human) |
| vocadito, Amax | COnP @ ±50 ms | — | 0.55–0.60 | 0.72 (human) |
| vocadito, Amax | COnPOff @ ±50 ms | 0.20 | 0.45–0.50 | 0.64 (human) |
| Annotated-VocalSet (studio, pro) | COnP @ ±50 ms | — | **0.78+** (pro + studio ⇒ should track M4Singer's 0.80) | no published number |
| Annotated-VocalSet | COnPOff @ ±50 ms | — | **0.70+** (cf. ROSVOT 0.774 on M4Singer) | — |
| Annotated-VocalSet | COn @ ±50 ms | — | **0.90+** (cf. 0.91–0.94 across clean corpora) | — |
| synthetic clean | COnP @ ±50 ms | — | **0.90+** | ~1.0 |
| synthetic adverse tier | COnP | — | ≥ 0.70 × clean score | — |
| f0 stage, PTDB-TUG | RPA @ 50 cents | 0.70 (DIO) | **0.95+** (CREPE-class = .975) | .983 |
| vocadito clean | octave-error rate | — | **< 0.02** (CREPE has ~0 on solo voice) | 0 |

Anchor choice matters:
- **Do target the ROSVOT/M4Singer numbers** (COnPOff 0.774, COnP 0.803, COn 0.940) for our
  *clean professional* tier — same task shape (monophonic solo, no separation).
- **Do not target the MIR-ST500 numbers** (COnP .798): polyphonic pop where the gains come from
  source separation, plus unusable licensing.
- **Do not target the clean-corpus COn numbers (0.91–0.94) on vocadito-like input** — untrained
  singers on phone mics are a different world, and the human ceiling there is 0.76.

### Gating rules

- Gate on **paired** ΔF1 with a **clip-level bootstrap CI (10,000 resamples, percentile)**.
  Block a merge when the 95 % CI upper bound is below 0 (a real regression), not when the point
  estimate dips — at n=40 the point estimate moves ±2.5 pts on noise alone.
- **Never ship a decision on a sub-10-point F difference on automatic metrics alone.** Ycart et
  al. found that when ΔF < 10 %, confident human raters disagree with F-measure ~40 % of the time
  (§4.1). Statistical significance and perceptual meaningfulness are different things: a
  bootstrap CI can confirm a +2 pt change is *real* while saying nothing about whether it is
  *better*. For changes in that band, route to the T4 human 2AFC panel before shipping. This is
  the single most important discipline point in this report, because ~all our tuning work lives
  in the sub-10-point band.
- **Worst-slice gating**, not mean-only: no single condition (register × degradation) may drop
  more than 3 points. Report the worst slice on every run; a mean that holds while
  `wind-outdoor` collapses is the failure mode our current reporting would miss.
- Apply **Benjamini-Hochberg FDR** across the per-condition tests — with ~7 conditions × several
  registers, uncorrected per-slice testing will flag phantom regressions nightly. (The commonly
  cited "MIREX uses Friedman + Tukey-Kramer HSD" is **unverified**: the MIREX 2018 note-tracking
  task page describes no significance testing at all. Don't cite MIREX as precedent here.)
- **Fixed seeds** for every degradation; the corpus must be byte-reproducible from a recipe.
- **Log every T2 evaluation.** The number of test-set looks is the overfitting exposure.

### Build order

1. **Fix scoring** (Amax, 50-cent gate, add COnPOff, add Split/Merged). Pure upside, no new data.
2. **Add paired bootstrap CIs + per-condition slicing to `run-eval.ts`.** Without these the
   nightly numbers cannot be acted on.
3. **Promote Annotated-VocalSet to the primary corpus with singer-disjoint dev/test splits.**
   It is the only CC-BY corpus large enough for the statistics we need.
4. **Re-scope MIR-QBSH** to f0 + retrieval; stop gating on its note-F1.
5. **Build the phone chain** (MEMS HPF sweep → AGC → NS → Opus/packet-loss) with audiomentations
   + ffmpeg. Highest expected yield of any new adverse condition, because it models our actual
   capture path.
6. **Start the T4 golden set** — consented real user recordings. Nothing else measures the
   product; it is the **only lawful way to evaluate humming at all** (§1.2); and it is the one
   corpus no competitor has.
7. **Add "notes to fix" (edit distance) and the T5 human 2AFC panel.** These are what make the
   benchmark *product*-facing rather than research-facing.
8. Chase an ISMIR2014/Molina mirror (38 cross-annotated untrained-singer melodies is exactly our
   distribution) and decide whether to email Opencpop for a commercial licence.

### What not to do

- **Don't report an MV2H composite** — voice degenerates to ~1.0 in monophony, harmony needs
  chords we don't have, and the weighting was never perceptually validated (§4.2).
- **Don't adopt PEAMT** — piano-only, needs velocities and sustain pedal, buys ~1 pt over
  onset-only F. Take its feature definitions instead.
- **Don't publish an accuracy percentage.** No competitor does, and the only third-party numbers
  for shipping notation tools are unflattering (Finale `E_all` 31.1 %, MuseScore 2 29.0 %).
  Compete on correction effort and editing UX; keep accuracy work internal.
- **Don't gate on MIR-QBSH note-F1** (§1.4) or on MIR-ST500-derived targets (§2.5).
- **Don't touch NC data** — HumTrans, M4Singer, CSD, Opencpop, TONAS, MAESTRO, MedleyDB are all
  off the table for a paid product, however convenient.
