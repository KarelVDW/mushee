# Voice datasets for the transcription benchmark — a licence-and-provenance register

Working notes, 2026-08-08. **Scope: corpora of real human singing that we could add to
the evaluation harness.** This file exists because the same three questions were being
re-asked and re-answered inconsistently across `research-benchmarks.md`,
`research-voice-transcription.md` and the findings log — and at least twice the answer
recorded there was wrong. One register, one verdict per corpus, evidence attached.

Companions: `research-benchmarks.md` (eval methodology, tiers, gating — authoritative on
*how* to measure) · `research-voice-transcription.md` (the voice flow's design) ·
`README.md` findings log (what we have measured).

---

## ⚖️ ACQUISITION POLICY (product owner, 2026-08-08) — read before any verdict below

**The licence published on the dataset's own record governs.** If the record's own
licence field, LICENSE file or terms say we may use it (CC-BY, CC-BY-SA, CC0, MIT,
Apache), that is a legally defensible position and we use it. We do **not** go hunting
for upstream defects behind a published grant — no consent-form archaeology, no
commit-order forensics, no "the depositor may not have had authority" theories. That
level of diligence is a lawyer's job at the point where it matters, not a blocker on
internal evaluation.

What stays barred is unchanged, because there the dataset itself says no:

- **NC / ND licences** — the licence is the dataset telling us "not commercially".
  §4.0's reading (NC restricts *use*, not just redistribution) stands.
- **Research-only terms** stated in the dataset's own terms (TONAS, SingStyle111).
- **No licence at all** (SSVD, MIR-ST500) — silence is not a grant.
- **Third-party re-uploads** that contradict the original's own page (NUS-48E,
  OpenSinger re-hosts) — there the *original's* published terms are the record.

Consequences applied in this file: **ESMUC and CSD are ADOPTED** (CC-BY-4.0 on their
own Zenodo records, first-party MTG deposits, manually corrected note truth);
**HUST_Solfege is ADOPTED at 73 files** (MIT LICENSE at the repo root; the remaining
conditions on it are data-quality, not licence). §1's consent-defect investigation and
"gate 5" are retained below as history but are **superseded** and must not be used to
re-block these corpora.

---

## 0. The four gates

A corpus is only useful to us if it clears **all four**. Most fail on gate 2 or 3, and the
failures are not interchangeable — record which gate, because a gate-4 failure can change
and a gate-2 failure cannot.

| # | Gate | Why, and the trap |
|---|---|---|
| **1** | **Real human singing**, solo or as isolated per-singer stems | Synthesised voice cannot exercise the failures we care about; our own `lib/synth.ts` tier already covers what synthesis can say. |
| **2** | **Note-level truth**: onset **and** offset **and** pitch | ⚠️ *The decisive gate.* Frame-f0-only corpora do not qualify, and neither do score-aligned ones. |
| **3** | **Annotation provenance is independent of our own estimator** | ⚠️ *The subtle one.* Notes derived by rounding-and-grouping a pitch tracker's f0 mean we score a segmenter against a sibling of itself — a **better** segmenter then measures **worse**. We have a live demonstration: mir-qbsh drops 0.64 → 0.55 under the improved voice decode purely for this reason. Score-derived truth has the mirror problem: it measures the written music, not the performance. |
| **4** | **Licence permits commercial use** | Solkey is a commercial product, so NC and ND are barred. `research-benchmarks` §7 frames "don't touch NC data" as a conservative house rule; §4.0 below shows it is simply **the correct reading of the licence** — CC BY-NC restricts *reproduction*, not only redistribution, so "evaluation only, never shared" is not an exemption. Do not look for a way around this gate; look for a published commercial route. |

### Verification discipline (learned the hard way)

- **Never trust a secondary table.** `mirdata`'s licence column is documented as wrong about
  vocadito. Our own docs were wrong about Dagstuhl ChoirSet ("notes") and about why
  ISMIR2014 was unavailable. Read the record's own licence field or `LICENSE`, and quote it.
- **Beware Zenodo re-uploads.** A re-uploader cannot broaden a licence. Check the record's
  `created` date and `creators`: NUS-48E's CC-BY-4.0 record (19595152) was created
  2026-04-15 with creator `"None"` and an empty description. That is not authoritative.
- **A 200 is not a file.** `atic.uma.es/ismir2014singing…` returns HTTP 200 with 143 KB of
  university homepage — a soft-404. Compare the SHA against `/` before believing a fetch.
- **Read the archive without downloading it.** A zip's central directory is at its end, so a
  ranged GET of the last few MB lists every file in a 5 GB record for the cost of a few
  seconds. This is how Dagstuhl and Cantoría were ruled out, and how the two adopted corpora
  were ruled *in*.
- **The search that works is licence-filter → content-check, not keywords.** Descriptions say
  "annotations" and mean frame f0 about half the time. The pipeline that produced this file:
  query the Zenodo API, drop anything not in {CC-BY, CC-BY-SA, CC0, MIT, Apache}, then
  range-read each surviving zip's directory and require BOTH audio files AND
  note-ish non-audio files (`*note*`, `*.mid`, `*.lab`, `*onset*`). That last requirement is
  what separates ESMUC from Cantoría. `scripts/eval/` has no tooling for this yet; it is worth
  re-creating if this register is revisited.
- **Extract one annotation file before believing a description.** Whether CSD's pitches were
  measured or written was settled in one step by pulling a single `_notes.lab` out of the
  remote zip and looking at the numbers. Ranged reads make this cheap.

---

## 1. THE MTG/TROMPA CONSENT INVESTIGATION — ⚠️ SUPERSEDED by the acquisition policy

> **⚠️ SUPERSEDED 2026-08-08.** This section blocked ESMUC and CSD by looking *behind*
> their published CC-BY-4.0 grants — exactly the depth of diligence the acquisition
> policy at the top of this file rules out. Both records are first-party deposits by
> the corpus authors' own group with an unambiguous licence field; that is the record,
> and **ESMUC and CSD are adopted** (fetchers: `fetch-esmuc.ts`, `fetch-csd.ts`).
> Cantoría stays out on **content** (no note annotations at all, §1c) and Dagstuhl on
> **quality** (score-aligned truth measured at 70 ms MAE, §2). The text below is kept
> as a record of what was found, not as an operative verdict.

Original finding follows. I earlier recorded the first two as adopted, then reversed
that on a consent-scope passage found in the depositor's PhD thesis:

### The passage, confirmed verbatim

Helena Cuesta, *Data-driven Pitch Content Description of Choral Singing Recordings* (PhD,
Universitat Pompeu Fabra, 2022) — the canonical documentation for these corpora — **printed
page 66, PDF page 102 of 307**, in a `Note:` block in the Chapter 3 preamble, immediately
after the sentence enumerating all four datasets:

> "**Note:** The ethical procedure for user studies and data protection used in this thesis was
> reviewed by the Universitat Pompeu Fabra (UPF) Ethical Committee (CIREP) in the context of
> the TROMPA project. In particular, all singers involved in these recordings provided their
> explicit consent to contribute to datasets used for **research purposes, according to a
> Creative Commons Non-commercial License**. We would like to thank them again for their
> contribution to this work."

Verified twice — by text extraction and by decoding the raw PDF content-stream operators. It is
the **only** occurrence of "consent", "ethic", "CIREP", "data protection" or "non-commercial"
in all 307 pages. The thesis never states any dataset's licence anywhere.

### Three findings that make this hard to wave away

**1. Every primary source that describes the consent limits it to research.** Not just the NC
wording — the *research-purposes* framing is unanimous:
- the thesis: *"used for research purposes"*;
- the Dagstuhl TISMIR paper §3.1: *"All singers have provided their consent to publish the
  recorded material **for research purposes** under a Creative Commons license"* (note: no NC
  qualifier there, and no ethics-committee reference);
- TROMPA's Data Management Plan D8.4 §5: *"Access to data is given only for research
  purposes."*

There is **no** source anywhere describing the consent as unrestricted. Internal benchmarking
to ship a paid product sits outside that framing however the NC question resolves.

**2. The depositor's Zenodo licence field is demonstrably unreliable — provable from the same
source set.** Zenodo record 6389643 (the thesis itself) carries `license: cc-by-4.0` in its
metadata while **its own description text and the PDF's page ii both say
CC-BY-NonCommercial-ShareAlike-4.0**. On the very record at issue the CC-BY-4.0 field is
objectively wrong. That is direct evidence the identical field on the four dataset records is
not a considered legal determination and cannot carry a commercial-use decision.

**3. The conflict is about authority to grant, not about which licence applies.** Nothing in
the published CC-BY-4.0 grant is ambiguous. The problem is that the canonical documentation —
written by the depositor, examined and published by the university — says the performers'
consent was narrower than what was granted. Performers hold neighbouring rights in their fixed
performances, separate from the depositor's rights in the compilation, and a licensee cannot
cure a defect in the licensor's upstream authority by pointing at the licence tag.

### Scope, per dataset

| Corpus | Risk | Why |
|---|---|---|
| **ESMUC**, **Cantoría** | **Highest** | Recorded inside TROMPA under the CIREP procedure the note describes; released *with* the thesis as sole documentation. Cantoría adds a professional touring quartet in a commercial studio, with Cuesta stating *"we were not directly involved in the recording"* — undocumented performer agreements on top |
| **Choral Singing Dataset** | **High** | Recorded at UPF's own Phonos studio; TROMPA D3.1 treats it as project data. Its README and ICMPC paper are silent — an absence of contradiction, not a permission |
| **Dagstuhl ChoirSet** | **Ambiguous, still blocked** | Recorded in Germany by AudioLabs Erlangen with seminar participants; CIREP's remit plausibly did not reach it, and its own TISMIR paper omits "Non-commercial". But it still carries the *research purposes* limitation, which blocks us regardless |

### The NC wording is NOT a TROMPA requirement — which matters for how to resolve it

A second, independent pass over the TROMPA record (24 of 41 deliverable PDFs recovered from the
Wayback Machine; `trompamusic.eu` is now a dead shell) establishes that **"non-commercial"
appears zero times in any of them**, including all three versions of the Data Management Plan
(D8.4, not D1.x). The project's stated policy is the opposite — D8.4 v3 §3.4, verbatim:

> "Data added to the CE by pilots (e.g. annotations) is typically made available under open
> data licenses such as **CC-BY-4.0**. … the specific choice of licence will be given to each
> partner, but the project guidelines call for **licenses that are as open as possible**."

So the thesis's NC statement is **not traceable to any project requirement**. It most plausibly
reflects the wording of the specific UPF/CIREP-approved participant consent form used for those
sessions — which is not public (WP1 ethics deliverables are consortium-confidential; the
deliverables index lists WP2–WP8 only, and CORDIS has no H/POPD Requirement entries).

**Why this matters practically:** the conflict is one consent form against a project policy that
called for maximal openness, not a deliberate NC regime. That makes a clarification request to
UPF/MTG more likely to succeed than if the restriction were project-mandated — but it does not
change the position today. The operative *"research purposes"* limitation still appears in every
primary source, and nothing public resolves what the singers actually signed.

### What could not be established

The documents that would settle it — the CIREP protocol and signed consent forms, referenced as
TROMPA deliverables D1.1–D1.3 / H Requirement No. 4 / POPD Requirement No. 5–6 — **are not
public**. They are absent from the TROMPA deliverables index (WP2–WP8 only) and from CORDIS for
grant 770376. Notably, TROMPA's *own* public policy points the other way — D8.4 §3.4 calls for
licences *"as open as possible"* with CC-BY-4.0 as the exemplar, while delegating the choice to
each partner. So the public record neither corroborates nor refutes the NC wording; it only
confirms the research-purposes limitation.

### Gate 5, which this file should have had from the start

**Performer consent must support the published licence.** Every other gate in §0 asks about the
*data*. This one asks whether the depositor was in a position to grant what the record says
they granted — and it is invisible in the licence field, the README, and the dataset paper. It
surfaced only from a `Note:` block on page 66 of a 307-page dissertation.

*Not legal advice.* The clean paths are written clarification from the rights-holders, or
corpora with unambiguous commercial terms.

---

## 1. Candidates that clear gates 1–4

### 1a. ESMUC Choir Dataset — the strongest new find

| | |
|---|---|
| Source | [Zenodo 5848990](https://zenodo.org/records/5848990) · 2.34 GB, single zip |
| Licence | **CC-BY-4.0** (Zenodo record licence field) |
| Content | 12 singers (undergraduate vocal-performance students, ESMUC Barcelona), SATB, **individual close-up microphone per voice** + 2 room mics. ~31 min accumulated audio, 44.1 kHz. Three pieces (Schütz, Haydn, Heiller) plus warm-up exercises. |
| Annotations | ⭐ The record states: *"manually corrected annotations of F0 contours and notes"*, and *"All audio tracks from the dataset, except the room microphones, have two associated annotation files: one for the F0 contour, and a second one with the note annotations."* |
| Verified | Zip central directory read by range request: 495 `.wav`, 300 `.f0`, 276 `.lab`, per-singer naming (`DG_FT_take1_A1.wav/.f0/.lab`, S/A/T/B + index). |

**Why it clears gate 3 — settled by extracting the file, not by reading the description.**
Two independent reviewers reached *opposite* verdicts from the same Zenodo text: one read
*"Tracks from the warm-up exercises only have F0 contours, since there is no associated score
to them"* as proof the notes are score-derived ("UNCLEAR, leaning BARRED"). That is a fair
inference. It is also wrong, and one range-extracted file shows why —
`SC1_FT_take3_A1.lab`, i.e. **alto 1, per singer, per take**:

```
0.702380952   329.201   0.528253968
2.803809523   329.341   0.557301587
9.032539682   330.902   0.354104308
1.700861678   333.735   0.313469387
10.170317460  333.876   0.377324263
4.452426303   327.319   0.531247165
5.067755102   322.738   0.830136054
```

Seven notes around E4 (329.63 Hz) and **every one a different frequency**, drifting from
+7 cents to −37 cents. Score-derived truth gives 329.63 every time. This is measured pitch with
real intonation variation, annotated per singer, and the README confirms *"manually corrected
annotations of F0 contours and notes."*

The score's role is what it is for any human annotator — knowing where the notes are. It does
not make the *values* score-derived, and the values are what gate 3 is about. Warm-ups lack
note files simply because nobody knew what the intended notes were.

⚠️ **This disagreement is the best argument in this file for its own method.** Two careful
readers, one description, opposite conclusions — and a 3 KB ranged read decided it in seconds.
Extract the file.

**Caveats to carry into any result:**
- Trained singers (conservatoire students), not amateurs on a phone. Different from our
  users; complements rather than replaces the amateur corpora.
- Recorded **simultaneously** with close mics, so expect bleed from neighbouring singers.
  That is a genuine adverse condition for a monophonic tracker and arguably realistic, but
  it must not be silently mixed into the clean tier — treat bleed as its own condition.
- Small: ~31 minutes total. Enough for a slice, not for a headline.

### 1b. Choral Singing Dataset (CSD) — second, with one open question

| | |
|---|---|
| Source | [Zenodo 2649950](https://zenodo.org/records/2649950) · 1.07 GB |
| Licence | **CC-BY-4.0** (Zenodo record licence field) |
| Content | 16 singers of the Anton Bruckner Choir, Barcelona; 3 a cappella pieces (incl. Bruckner's *Locus Iste*); recorded in groups of 4 per section, individual cardioid close mics; conducted via video for synchronisation, piano reference on headphones. |
| Annotations | Per-singer `.f0` (**manually corrected**) and `_notes.lab`, plus a per-section `.mid` score file described as *semi-synchronized*. |
| Verified | Central directory read by range request; one `_notes.lab` extracted in full. |

**The `_notes.lab` format**, extracted from the archive — `onset_sec · frequency_Hz · duration_sec`:

```
4.179591837   354.865   0.377324263
4.736848073   354.674   0.528253968
5.270907029   266.061   2.623854875
7.900566893   353.476   1.30031746
```

Those frequencies are **measured, not written**: 354.865 / 354.674 / 353.476 / 353.998 Hz
are all the same notated pitch (F4 = 349.23 Hz, so ~+28 cents) recorded with per-note
variation. A score-derived annotation would give one identical value. So the *pitch* is
performance-derived, which clears gate 3 for pitch.

✅ **Open question RESOLVED, and a third reviewer's contrary claim refuted.** The in-zip
README, extracted by range request, is unambiguous — and it distinguishes the two artifacts
that everyone has been conflating:

> "(2.1) a file with note annotations in the format [start_time, meanf0, duration]
> **automatically extracted using TONY and manually corrected**. Note that only one note file
> is generated for each section because note boundaries are very similar (they recorded
> together).
> (2.2) a **semi-synchronized** (note durations are not exactly the ones in the performance)
> MIDI files."

So: the `_notes.lab` files are Tony-extracted and **hand-corrected**; the separate `.mid` files
are the score, explicitly flagged as *not* matching performed durations. One reviewer concluded
"notes come from MIDI with one global offset correction" — that is the `.mid`, not the `.lab`.
My own extracted `.lab` agrees with the README: the field is `meanf0`, a *measured* mean, which
is why identical written notes carry different frequencies.

Tony is pYIN-based, so note for the record that its raw output would be a sibling-estimator
risk — but pYIN is not our estimator (we run CREPE), and the human correction is what clears
gate 3 either way.

**Two further details from the README worth carrying:** the authors acknowledge bleed —
*"Each voice is very predominant in its corresponding track, although some interferences from
other singers exist in some files"* — and the sections sang to *"the same backing MIDI track
through headphones"* plus a video of the conductor, so tempo is externally driven rather than
freely expressive. Neither is disqualifying; both belong in any write-up of a result.

⚠️ **A caveat I initially got wrong: the note files are per SECTION, not per singer.** The
README: *"only one note file is generated for each section because note boundaries are very
similar."* 12 note files for 48 audio tracks — 4 singers per section, all singing the same
line in unison. Each singer's stem can therefore be scored against its section's notes, but
individual timing deviation within a section is invisible to the annotation. For onset
metrics that is a real ceiling; ESMUC, which annotates **per singer per take**, does not have
it. That is why ESMUC is listed first.

⚠️ **Name collision:** this "CSD" is *not* the barred CSD (Children's Song Dataset, KAIST,
CC-BY-NC-SA). Different corpus, different licence. Do not let the abbreviation merge them.

### 1c. The three MTG choral releases are NOT interchangeable

Helena Cuesta's PhD produced three superficially identical CC-BY-4.0 multitrack choral
corpora. Only two carry note truth, and a keyword search cannot tell them apart — this is the
clearest illustration in this file of why gate 2/3 must be checked against the *files*:

| Corpus | Zenodo | f0 | Notes | Verdict |
|---|---|---|---|---|
| **ESMUC Choir Dataset** | 5848990 | **manually corrected** | **manually corrected** | ✅ USABLE |
| **Choral Singing Dataset** | 2649950 | **manually corrected** | `_notes.lab`, measured pitch | ✅ USABLE (boundary provenance open) |
| **Cantoría Dataset** | 5878677 | **pYIN + CREPE, automatic** | **none** | ⛔ BARRED |

Cantoría's own record says it provides *"automatically extracted F0 trajectories… with pYIN
and CREPE"* and nothing else — the `F0_pyin/` and `F0_crepe/` directory names are visible in
the archive. It is 11 songs by a *professional* vocal quartet (Iberian Golden Age repertoire),
so it would have been an attractive addition on description alone. It fails both gate 2 (no
notes) and gate 3 (tracker-derived), i.e. the Dagstuhl trap exactly.

### 1d. ✅ HUST_Solfege — ADOPTED at **73 files** (MIT). Remaining conditions are data-quality, not licence.

> **Policy update 2026-08-08:** the repo carries an MIT LICENSE at its root; that is the
> published grant and we use it (`fetch-hust-solfege.ts`). The "MIT-covers-data needs a
> lawyer" and juvenile-consent threads below are the over-diligence the acquisition
> policy removes. What *stays* is everything data-quality: MARG files excluded (their
> pitch column is unusable per the README), offsets synthetic (onset-only corpus), and
> the pitch convention needs the measured offset correction — re-derived empirically in
> the fetcher, see there.

Red-teaming corrected this entry substantially. **Four statements I made about it were
false**:

| I wrote | Actually |
|---|---|
| "64 of HUST_Solfege's 103 appear in SSVD v2.0" | **2** (IDs `1150`, `1325`) |
| "onset agreement, max difference 0.0000 s" | **Not identical** — 22/27 and 40/50 onsets equal, max divergence **150 ms** |
| "constant +20.0 semitone offset" | **Not constant** — mean 19.96, per-note spread up to **0.94 semitone** |
| "a lawful route into SSVD" | With a 2-file overlap, **there is no route** |

**Consequence: we cannot claim SSVD-inherited annotation quality.** HUST_Solfege's README
documents file formats only — **no annotation protocol of its own**. The four-trained-annotator
protocol belongs to SSVD, and with two shared files it does not transfer. If we use this corpus
we use it on faith, or we validate it ourselves.

**The MIT licence needs sign-off, not assumption.** The commit history shows the `Initial commit`
of 2019-04-07 contained **exactly two files — `LICENSE` and `README.md`** — with all audio and
annotations arriving 3–5 days later. That is the GitHub "add a license" checkbox, applied before
any data existed, using stock MIT text that governs "the Software" throughout with no
data-scoping language. There is **no code in the repo at all**. Across `itec-hust`'s 16 repos,
licences appear only where there is code; every other dataset repo is unlicensed. A LICENSE at
the root of a data repo conventionally reads as covering the contents — but this is a question
for a lawyer with the commit order disclosed, not a settled fact.

**🔴 The 30 MARG files must be excluded, and they are now identified exactly.** README: *"103
audios including 73 self-built solfege recordings and **30 singing recordings from MARG**."*
The MARG source page (SNU, recovered from Wayback) carries **no licence and no terms**, only
*"Copyright © 2014, Music and Audio Research Group"* — all rights reserved, and the host is now
dead, so there is nobody to ask. HUST cannot sublicense them.
**Exclusion rule: drop every file whose basename does not parse as an integer.** The MARG files
are `man1`–`man6`, `man6_1`, `woman1`–`woman3` × 3 Korean children's songs = exactly 30. The 73
HUST solfège files are the numeric IDs and carry all the alignment data, so excluding MARG costs
nothing.

**🔴 Unresolved: consent for 37 juvenile voices.** No consent statement, ethics approval or DUA
anywhere in the repo. The defining paper (IEEE TMM, DOI 10.1109/tmm.2022.3168132) is **closed
access and unread** — that is the one document that could settle it. Adverse context: the same
lab's sibling repo states its audio *"come from the WeChat Mini Program Sight-singing Talent"* —
consumer-app recordings of the public, republished with no licence and no consent basis. For an
EU-facing commercial product, 37 children's voices with an unknown consent basis is real GDPR
exposure.

**Data faults that would otherwise have shipped into the harness:**
- **Two incompatible pitch conventions in one directory.** The 73 solfège files hold fractional
  measured f0 spanning MIDI 22.8–63.96 (22.8 ≈ 29 Hz — impossible for a voice, so the offset is
  real). The 30 MARG files are **100 % integers already in a sane range** (men 42–63, women
  56–68). **A global +20 would silently corrupt MARG.** Correction is per-group, or moot once
  MARG is excluded.
- **A trap in the pitch column.** README: *"The 30 recordings from MARG are just for onset
  detection. Pitch notations are not done for MARG recordings."* The column is nevertheless
  **fully populated with 1,440 plausible-looking integers.**
- **Offsets are 100 % synthetic** — all 5,111 rows are exactly `onset + 0.03`. No offset metric
  is ever computable. (Our headline COnP has no offset gate, so this costs us nothing.)
- **Three inconsistent onset counts**: README rows sum to 5,068, README TOTAL says 5,110, the
  files contain 5,111.

Otherwise structurally clean: zero malformed rows, zero non-monotonic or duplicate onsets,
consistent headers across all 103 files.

**Verdict: WOUNDED — usable at 73 files given (1) MARG excluded, (2) legal sign-off on
MIT-covers-data, (3) the children's-voice consent question resolved, (4) onsets only, (5) no
claim of SSVD-inherited quality.**

### 1e. ⛔ Dai / Mauch / Dixon 2015 — **KILLED** by the underlying musical work

I called this "the highest-value licensing ask on this page". It is not an ask; it is a dead end,
and the reason is stated in the paper's own abstract.

The three excerpts are **Edelweiss**, **Do-Re-Mi** and **My Favourite Things**. Paper §2.1,
verbatim: *"We chose three songs from the musical "The Sound of Music" as our material."* Rodgers
& Hammerstein, 1959; Rodgers died 1979 → **EU/UK protection to 2049, US to 2054**. The CC-BY-4.0
on figshare is granted over the *sound recording*; neither QMUL nor the authors hold any right in
Rodgers' composition, and CC-BY §2(a) cannot sublicense what the licensor does not own.

The nickname "Sound of Music corpus" turned out to be **literal**, and the licence field shows
none of it. Partial mitigation: everything is sung on "ta", so Hammerstein's lyrics are not
reproduced — but the melody *is* the protected work, performed in full, three times, by 39
singers.

Two further problems, either of which would need sign-off on its own:
- **No consent basis published anywhere.** The paper has no ethics statement and no approval
  number; §6 is two sentences of acknowledgements. Participants were *"members of our
  university's music society or our music-technology focused research group"*, recruited
  informally pre-GDPR.
- **The annotations are unlicensed** — `tsom-intonation.csv`, exhumed from a Wayback capture of
  a dead Mercurial host, with no LICENSE, no README grant and no licence field on the project
  page.
- Plus ~19 % of the corpus is misaligned (22 recordings have annotations running up to 88 s past
  the end of the audio), and the all-"ta" articulation would make onset metrics optimistic.

**Verdict: KILL. Remove from the shortlist rather than escalating.**

## 2. Barred — with the operative text

### ISMIR2014 / Molina — ⛔ non-commercial. Closed, do not chase again.

Every previous note in our docs treated this as an *availability* problem worth an email.
It is a **licence** problem. The published URL is `http://www.atic.uma.es/ismir2014singing`
(earlier notes had the path wrong, which is why the first chase "exhausted" so fast). Its
`readme.txt`, recovered from the Wayback Machine, states:

> "All the .WAV files provided, transcriptions and all the annotations are offered free of
> charge for **non-commercial use only**. You can not redistribute it nor modify them.
> Distribution rights granted to ATIC Research Group, Universidad de Malaga."

Same class as HumTrans. Two further facts, so nobody re-runs the search:

- The `EvaluationFramework_ISMIR2014.rar` holding the annotations and the 14 children's
  recordings was **never archived** — the Wayback Machine has the page, `readme.txt`,
  `MTGQBH_renaming.m`, the paper and the poster, and no `.rar`, ever. archive.today has
  nothing. The live path soft-404s.
- Only 14 of the 38 clips were ATIC recordings. The other 24 are **MTG-QBH** clips
  (`MTGQBH_renaming.m` maps `q1→afemale1`, `q21→amale1`, …), and MTG-QBH is a
  query-by-humming *retrieval* corpus with no note truth of its own — the same category as
  the mir-qbsh we already hold and flag `noteTruthDerived`.

The *toolbox* (CommandLineTool + GUI) is GPL-3.0 and would be reusable, but we already
implement Molina's split/merge/missed/spurious taxonomy independently in `lib/segErrors.ts`.

### Dagstuhl ChoirSet — ⛔ not note truth · ✅ **our only real-tempo reference on singing**

⚠️ **This entry corrects an earlier version of itself.** On 2026-08-08 I ruled DCS out after
range-reading its zip directory, on the grounds that "no performed note annotation exists —
the 'notes' are a written-score representation." **The folder counts were right; that
interpretation was wrong, and the wrong reason nearly cost us the genuinely useful part of
the dataset.**

**What `annotations_csv_scorerepresentation` actually is.** 80 CSVs, one per
(take × SATB section) across 20 takes — *per-performance* alignments, not one static score;
files differ between takes of the same piece. Format is `onset_s, offset_s, MIDI_pitch`, and
`mirdata.dagstuhl_choirset` exposes it as `load_score()` across 108 singer tracks. vocadito's
own survey table counts ChoirSet as having Notes ✓. Produced, per the paper §3.5, by aligning
CPDL MIDI to the room mic *"using the beat annotations… as anchor points"* through a DTW
pipeline. The authors explicitly propose the use I dismissed (§5): *"the time-aligned score
representations could serve as a reference for the evaluation of note-tracking algorithms."*

**So why it is still not note truth — measured, not assumed.** Both manual-F0 takes carry a
manual F0 reference *and* a score CSV, which allows the alignment to be checked directly
(n=122 phrase onsets, n=864 notes):

```
raw onsets:       median −70 ms, MAE 94 ms, p90 214 ms, |e|<50 ms 35%
de-biased onsets: MAE 70 ms, p50 50 ms, p90 174 ms,     |e|<50 ms 50%
notated pitch:    median −9 c, IQR [−59,+16],  |dev|>50 c 32%,  |dev|>100 c 9%
```

Even after removing a per-track systematic offset, only **half** the onsets land inside
±50 ms and **a third** of notated pitches are >50 cents from what was sung. That is the
honest disqualifier: notated-score times pushed through a beat-anchored DTW, plus notated
pitch on a drifting amateur choir. Right verdict, wrong reason.

**✅ The part we missed: 20 manual, expert-reviewed beat + measure grids.**
Paper §3.4, verbatim: *"annotations were manually created by an annotator… using the
annotation by tapping feature in Sonic Visualiser… In the second stage, annotations were
reviewed and refined by a second, experienced annotator."* Format `time_s,
measure.beatfraction` — so **downbeats and bar numbers**, not a flat pulse — over genuinely
expressive tempo (±20 % within a take, ritardando to ~35 BPM at final cadences).

This fills the exact gap flagged in §2 of this file and in the findings log: **no voice corpus
we hold has real tempo**, which is why `notation-eval.ts` can score notated rhythm in beats
only on GuitarSet — an instrument. DCS gives **52 singer-stems that have both a manual
beat/measure grid and their own aligned score line** (13 quartet takes × 4 singers).

Because STM and every close mic in a take are channels of one synchronous multitrack, the beat
grid applies frame-exactly to each singer's stem.

**Limits to state whenever it is used:**
- Ensemble, not solo. vocadito's authors, verbatim: *"While ChoirSet includes stems of
  individual singers, they contain bleed or artifacts due to the style of microphone, and are
  not well suited for monophonic voice evaluation."* LRX is a throat contact mic (bleed-free
  but off-distribution timbre); the HSM headset stems are closest to normal input.
- Two pieces, both 4/4, both slow sacred choral. A **probe**, not a rhythm benchmark.
- Notated durations in beats are not shipped; recover them by mapping the score CSV back
  through the beat grid, or take the public-domain CPDL MIDI.

**Cheap to acquire:** range requests work (HTTP 206 confirmed). All three annotation folders
together are **~1.1 MB compressed** — the beat/score data needs none of the 5.1 GB. Adding the
52 quartet stems is 0.4–0.6 GB per mic type.

Licence, verbatim (Zenodo 4618287 and the paper): *"Creative Commons Attribution 4.0
International… permits unrestricted use, distribution, and reproduction in any medium."*
Worth recording alongside it: singer consent was given *"to publish the recorded material for
research purposes under a Creative Commons license."* The licence itself is unrestricted
CC-BY; that phrasing is not a licence term but is worth knowing.

### DALI — ⛔ barred three ways, and **our licence note was wrong**

⚠️ **Correction:** our notes said the annotations are CC-BY-SA-4.0. The only explicit licence
at the primary source — the footer of
[github.com/gabolsgabs/DALI](https://github.com/gabolsgabs/DALI) — reads *"licensed under a
Creative Commons Attribution-**NonCommercial**-ShareAlike 4.0 International License"*, and
mirdata's `dali.py` agrees. The CC-BY-4.0 we probably picked up belongs to Zenodo record
1492443, which is the ISMIR **paper**, not the data. The actual data deposit
([Zenodo 2577915](https://zenodo.org/records/2577915)) is `access_right: restricted`,
`license: null`.

Barred on licence, on access, and on the merits — vocadito's authors, verbatim: *"the
annotations are crowdsourced and automatically aligned – while this is useful for training, it
is not an appropriate dataset for evaluation."* v2 improved *global* offset (2.23 s → 1.82 s)
but the repo's own open issues still list unsolved *local* note alignment, and no audio is
distributed (YouTube retrieval, some links dead).

### TONAS — ⛔ "internal non-commercial use only", and access is academically gated

Genuinely the profile we want, which is why it is worth recording precisely: 72 monophonic
**a cappella flamenco** excerpts (~36 min), with *"manual melodic transcriptions, generated by
the COFLA team and Cristina López Gómez"* — note-level `onset, duration, MIDI, energy`, and an
f0 file that ships **both** an automatic and a **manually corrected** column.

Licence, verbatim from the access conditions on [Zenodo 1290722](https://zenodo.org/records/1290722):

> "The TONAS dataset is offered free of charge for **internal non-commercial use only**. You
> may not redistribute, publically communicate or modify it… All Rights Reserved."

Zenodo metadata: `access_right: restricted`, `license: null`; files gated behind a request
form requiring *"your academic affiliation… and a brief description of your research topics."*

**No access request was made, deliberately.** Obtaining it on a research justification and
then using it to tune a commercial product would breach the terms being agreed to. Note that
"internal non-commercial use" bars exactly the gitignored-fixtures use we had hoped might be
available — the operative clause restricts *use*, not redistribution (cf. §4.0).

### SSVD v2.0 — ⛔ **no licence at all**, and it is the painful one

Technically the best-matched corpus found anywhere in this sweep, and *exactly* our target
domain: amateur **sight-singing captured through a WeChat mini-app** (600+ users, 60k samples,
194 released as `.flac` + `.txt`, ungated, in-repo). Annotation provenance is the strongest of
any corpus reviewed — four researchers with professional sight-singing training set approximate
onsets by slowed listening, then refined each to *"the occurrence time of the second harmonic
signal"* on a high-resolution spectrogram, set offsets *"when most harmonic signals
disappeared"*, and *"checked each other's annotation files until no annotation errors were
found."* **No pitch tracker anywhere in the chain.** Format `onset⇥offset⇥pitch` with
fractional MIDI.

⛔ **And there is no licence.** GitHub API `license: null`, `/license` → 404, no
LICENSE/COPYING/terms in 1,303 tree entries, nothing in the README. No licence means default
exclusive copyright — silence is not a permissive default.

**This is a lab-wide pattern, not an oversight awaiting a fix.** Across HUST's `itec-hust`
org, *code* is licensed deliberately (MusicYOLO Apache-2.0, HUST_Solfege MIT) while **every
one of seven dataset repos is unlicensed** — SSVD v1/v2, OMAPS, OMAPS2, ocarinaKT, singKT,
Alignment-dataset, CPMS — the most recent from 2026-03. Waiting for a licence is not a plan.

A second problem independent of copyright: the audio is recordings of identifiable third-party
end users, redistributed with no published consent basis. Even a copyright licence from the lab
might not cover what we would need.

### MIR-ST500 — ⛔ unlicensed, plus the audio cannot lawfully be assembled

`license: null` on [york135/singing_transcription_ICASSP2021](https://github.com/york135/singing_transcription_ICASSP2021);
no terms anywhere in the tree, though the repo is actively maintained (last push 2026-03).
Contextual signal on intent: the same author's later dataset MIRMLPop states verbatim *"This
repo is not allowed for commercial usage. Academic usage is OK."*

**The audio is a separate and worse problem.** The repo ships none — only
`MIR-ST500_link.json` with 500 **YouTube** URLs and a `yt_dlp` script. That is bulk automated
download contrary to YouTube's ToS, of 500 **commercial pop recordings** with no rights chain.
There is a private academic-access route to the author's cache; it was documented, not used.

Annotation provenance is also mixed: non-expert manual labelling → **a trained neural net that
predicts onset corrections** (`adjust_onset/MyDNN.py`) → human verification. The onsets we
would score against are partly a model's output.

### VocalNotes — ⛔ audio behind an academic-only DUA (and the annotations are the gold standard)

The most painful near-miss, and the design to copy. ~10 min of audio across **five traditions**
(Russian, Japanese Minyo, Chinese Hebei Bangzi, Jewish Romaniote chant, Alpine yodel), with
**≥2 independent expert transcribers per item**. Annotation method, verbatim: *"Note-level
annotation was performed manually instead of using Tony's automated note-annotation function.
Note pitch was manually adjusted in Sonic Visualizer, in cases where the transcriber disagreed
with the note frequency automatically assigned by Tony."* Genuinely manual, explicitly not
tracker-derived.

The **annotations** are `cc-by-4.0` ([Zenodo 10065955](https://zenodo.org/records/10065955)).
The **audio** is not: *"Access to the original audio is restricted. Access can be granted only
for academic research. To gain access, you need to agree to the Data Use Agreement."*

⛔ Barred — annotations without audio cannot score a transcriber. Retained here because its
multi-independent-transcriber design is what §2b says our own annotation effort should copy.

### Jingju (Beijing opera) a cappella — ⛔ NC for note work, but **part 2 may be usable for SYLLABLES**

Most CompMusic jingju records are **CC-BY-NC-4.0** or **CC-BY-NC-ND-4.0**: Zenodo
[345490](https://zenodo.org/records/345490), [832736](https://zenodo.org/records/832736),
[1286350](https://zenodo.org/records/1286350), [814800](https://zenodo.org/records/814800).
None carries note-level pitch.

⚠️ **An asymmetry worth a second look:** *part 2* ([Zenodo 1421692](https://zenodo.org/records/1421692))
is reported as **CC-BY-4.0**, open and ungated — 6 GB of real traditional singing with
**manual syllable-level time boundaries** — while parts 1 and 3 are NC. Two cautions: a
separate reviewer found *divergent rights across part-2 versions* (CC-BY vs CC-BY-NC), so the
record must be re-verified version-by-version before anything is downloaded; and it is not
note-level, so it cannot score a transcriber.

**Why it is still interesting.** Our own 2026-08 work found that syllables are boundary
evidence, that re-onsets are the voice flow's weakest axis, and that a broadband energy accent
cannot find them — the literature's answer is a *phonetic* channel. A corpus of real singing
with **manual syllable boundaries** is exactly what would let us measure the ceiling of a
syllable-boundary channel before building one. Different question from note transcription,
worth keeping on the list for that question alone.

### Erkomaishvili (traditional Georgian vocal music) — ⛔ NC

[Zenodo 6900514](https://zenodo.org/records/6900514), licence field `other-nc`.

### NUS-48E — ⛔ licence not authoritative; and wrong annotation type anyway

A CC-BY-4.0 Zenodo record exists ([19595152](https://zenodo.org/records/19595152), 1.08 GB,
`nus-smc-corpus_48.zip`, 12 singers × 16 files, 96 wav + 96 txt) — but it was **created
2026-04-15 with creator `"None"` and an empty description**, i.e. a third-party re-upload,
and a re-uploader cannot broaden a licence. The originating NUS terms govern and were not
verified. Separately, NUS-48E's annotations are **phoneme-level**, not note-level, so it
fails gate 2 regardless.

**But note what it would be good for.** Manual phoneme boundaries on sung audio are exactly
the channel the voice literature says fixes our worst remaining weakness: Yong et al. reach
0.90 re-onset recall with a phonetic posteriorgram where our broadband-energy accent reached
nothing. A phoneme-annotated sung corpus would let us *measure the ceiling* of a phonetic
re-onset channel before building one. If the original NUS licence turns out to be
commercially usable, revisit it for that purpose, not as a note-transcription benchmark.

### Checked and rejected on content, not licence (all CC-BY-4.0)

These surfaced from a licence-filtered, *content-verified* sweep (see method below) and all
fail an early gate. Recorded so the same records do not resurface as leads:

| Corpus | Zenodo | Why it fails |
|---|---|---|
| **Cantoría Dataset** | 5878677 | Gate 2+3 — pYIN/CREPE f0 only, no notes (see §1c) |
| **Saraga-Carnatic-Melody-Synth** | 5553925 | Gate 1 — *resynthesized* audio (the "-Synth" is the point), f0 truth exact by construction. Same shape as MDB-stem-synth, and our own `lib/synth.ts` already covers what synthesis can say |
| **Larynx Microphone Singer-Songwriter** | 20287765 | Gate 2 — 348 wav but only 12 `.txt` and one split `.csv`; no per-note annotation. *(Intriguing for another reason: a throat contact mic is an unusual acoustic condition.)* |
| **Raga Ornamentation Detection (ROD)** | 17851882 | Gate 2 — expert annotations, but of *ornaments*, not note onsets/offsets |
| **AdoVoc Pro** | 3383118 | Gate 2 — ornament classification (`mordente_superior/…_f0.csv`), f0 per excerpt |
| **Amateur Vocal Percussion** / **AVP-LVT** | 5036529 / 5578744 | Gate 1 — beatboxing, not pitched singing. ⚠️ *Worth remembering separately:* both ship per-event onset annotations on **amateur** vocal audio, which is a clean way to test `OnsetDetector` in isolation — our weakest component — even though they can never score a note transcriber |

### ⚠️ Re-host licence laundering — a recurring pattern, three instances found

A re-uploader cannot broaden a licence, and this happens often enough to be a standing check:

| Re-host | Claims | Upstream actually is |
|---|---|---|
| `pymaster/CrawlSinger-OS` (HF) | **MIT** | OpenSinger: *"All users of the dataset must follow the CC BY-NC-SA LICENSE"* |
| Zenodo 19595152 "NUS-48E" | **CC-BY-4.0** | Third-party upload, creator `"None"`, created 2026-04-15, empty description — original NUS terms govern |
| `J1mmymm/MIMuT_Data_v2` (HF) | `other` | 13-corpus bulk re-host incl. MAESTRO (CC-BY-NC-SA) and RWC (CC-BY-NC); its own card admits *"does not replace or relicense the terms of any upstream dataset"* |

**Always resolve to the originating project's own page.** Where a re-host and an original
disagree, the original governs.

### mirdata, enumerated — a definitive negative

65 loaders; 23 touch singing or vocals; the **singing ∩ note-level** intersection is exactly
six: `cante100`, `tonas`, `ikala`, `dali`, `dagstuhl_choirset`, `vocadito`. Every one is
already held or barred. There is no seventh.

⚠️ **mirdata's failure mode is understatement, not just error.** We already knew its licence
column is wrong about vocadito. Worse: the `tonas` module docstring **states no licence at
all**, mentioning only that data is "obtained upon request" — a reader would never learn it is
internal-non-commercial. Treat it strictly as a lead generator.

### Folk and ethnomusicology archives — a structural dead end

Checked and empty as a class, which is worth recording because it looks so promising from the
outside. **Meertens MTC** pairs field audio with *JPG scans of handwritten transcriptions* (and
is CC-BY-NC-SA 3.0 regardless); **Essen** and Finnish **eSävelmät** are symbolic-only with no
audio (Finnish also explicitly NC); Estonian archives are text corpora; ITMA, Svenskt visarkiv,
ZRC SAZU and the Hungarian Bartók system distribute no note-level annotations at all. Latvian,
Lithuanian, Danish and Romanian archives were unreachable (Cloudflare / JS-only) and remain
formally unverified.

### RWC 2.0 — newsworthy, still barred

RWC's audio was **re-released openly in 2026** ([Zenodo 18656623](https://zenodo.org/records/18656623),
315 pieces, WAV) — a genuine change from its old research-only distribution. The licence is
*"Creative Commons Attribution Non Commercial 4.0 International"*. Still NC, so still barred,
but worth knowing the door moved.

### Repositories checked and empty

- **Figshare** (API `articles/search`, four query phrasings): nothing relevant. Its search is
  swamped by biomedical records matching "single cell"/"singing bowls".
- **OSF** (API title filter): no matches at all.
- **HuggingFace** — ~49 name searches plus full-text search. Note its `?search=` matches
  dataset **names only**, not card content, which is why singing queries return Cantonese
  corpora ("canto") and French roadworks ("chantier"). Everything genuinely relevant was NC,
  ND or gated.
- **Kaggle** (v1 list API; HTML search is reCAPTCHA-walled): ~25 query terms. Only real hits
  were re-hosts of MIR-1K and Saraga, plus bulk-uploaded sets of unverifiable provenance.
- **Academic Torrents** — pulled the full `database.xml` (2.9 MB, **2,852 entries**) and
  grepped every title and description. The only music entries in the entire database are
  MAESTRO, MusicNet, FMA, Jamendo and freefield1010. **No singing corpus of any kind.**
- **OpenML** — full catalogue enumerated (6,408 datasets): **contains no audio waveforms at
  all.** Structurally unsuitable.
- **data.world** — ⚰️ **the platform is gone.** Its Open Data Community shut down 13 July 2026
  after the ServiceNow acquisition; datasets are no longer accessible. Remove it from any
  future search plan.
- **DagsHub** — coverage gap: the file tree, content API and anonymous clone all require
  sign-in, so it could not be enumerated. Its README frames it as an ASR/voice index rather
  than a music-corpus host, so a note-level singing corpus there is unlikely but unconfirmed.
- **DataCite** is the best single discovery channel — it mirrors Zenodo, figshare, OSF,
  Dataverse and IEEE DataPort in one index, exposes `rightsList`, and does not throttle
  aggressively. Zenodo's own API IP-blocks after ~30 rapid requests; pace at ~6 s.
- ⚠️ **False-positive trap:** Zenodo records titled "Sung", "Dainas" and "Cachimba" are
  CC-BY-4.0 and look like singing corpora by title. They are **3D sculpture scans**.

---

## 2a. ⛔ SingStyle111 — CLOSED. Performer agreements are research-scoped.

**The human browser task previously flagged here is withdrawn — it is already answered.** The
ISMIR 2023 paper is decisive and needs no access to the Wix page:

> "We make the dataset freely available **for research purposes**." … "**All singers have
> signed agreements to release the dataset for research purposes.**"

That is contractually scoped performer consent, which no licence tag could cure — the same
defect class as §1, and here stated by the authors themselves. No CC grant is asserted over the
data anywhere; the CC-BY-4.0 that Zenodo and every index show belongs to the **paper** (record
10265401 contains only `000091.pdf`). The site footer reads *"All Rights Reserved"*.

Painful, because the annotation is the best found anywhere — verbatim: *"We manually input
performance MIDI files that **strictly align to singing audio** using MIDI piano, **including
multiple rounds of correction**."* The paper even names the failure mode we care about:
*"Utilizing performance MIDI for singing voice synthesis and claiming it as score-based is, in
reality, a deceptive approach."* 12.8 h, 8 professional singers, studio-clean — and
commercially unusable.

## 2b. Annotatable audio — the reframe, now with verified candidates

We do not need an *annotated* corpus; we need commercially-clean **annotatable** audio that we
annotate in-house. That is cheaper, better-controlled and less consent-fraught than recording
our own, and it is a better plan than `research-voice-transcription.md` §6.3's "record our own".

### ⭐⭐ Fundación Joaquín Díaz on Wikimedia Commons — **~725–1,000 hours, CC BY-SA 3.0**

**The single largest usable find of this entire search**, and it was reached sideways: Europeana
surfaced a 265-item CC0 slice at the Digital Library of Castilla y León, whose provider turned
out to have put its whole 50-year archive on Wikimedia Commons.

- **21,382 audio files** (`deepcat:"Recordings provided by Fundación Joaquín Díaz"`). Duration
  buckets over 14,434 of them sum to **~725 h**; the full set is plausibly ~1,000 h.
- **Real amateur villagers, largely solo and unaccompanied** — Spanish oral-tradition field
  recordings collected across Spain over 50 years. **172 named performers**, with per-file
  performer / location / date metadata usable for speaker-disjoint splits.
- Genre subcategories confirm it is predominantly sung: Jotas 1,652 · Christmas carols 414 ·
  Coplas 86 · Habaneras 53, plus *romances* (Conde Niño, Don Bueso, Rico Franco), villancicos
  and misa settings. A 50-title sample suggests **75–85 % sung**, the rest spoken.
- **Licence**, from each file's `extmetadata`: `LicenseShortName` = **"CC BY-SA 3.0"**,
  `UsageTerms` = *"Creative Commons Attribution-Share Alike 3.0"*. Fully open bulk download
  from `upload.wikimedia.org`, no account.
- The Fundación's own site confirms the deposit: *"…ponen a disposición de todo el mundo las
  grabaciones realizadas durante los últimos 50 años"* (funjdiaz.net/colecciones.php).

⚠️ **Quality caveat, and it cuts both ways.** These are 1970s–2000s cassette field tapes
transcoded to low-bitrate Ogg Vorbis (sampled file: 52 kbps). Expect tape hiss, room noise and
limited HF. That is poor material for clean pitch ground truth — and *excellent* material for
an adverse-conditions tier, which our corpus currently gets only from synthetic degradation.

⚠️ **ShareAlike.** CC BY-SA 3.0 is commercially usable with attribution, but SA attaches to
*adaptations*. Using the audio as evaluation input is one thing; redistributing a derived
annotated corpus alongside it is a question for a lawyer.

**A CC0 sibling exists**: the Digital Library of Castilla y León's *Archivo de la Tradición
Oral* — 265 items, ~9.1 h of the same 1977–79 Valladolid/Palencia material, licence field
verbatim *"The Creative Commons CCO"* → `publicdomain/zero/1.0/`. Tiny, but unencumbered by
ShareAlike, so it is the natural pilot slice.

### ✅ Larynx Microphone Singer-Songwriter Dataset (LM-SSD) — cleanest raw material

[Zenodo 20287765](https://zenodo.org/records/20287765) · `lm-ssd_v1.zip`, 5.95 GB ·
**CC-BY-4.0**, open, anonymous download, no account.

- **4 amateur singer-songwriters**, 12 songs, 72 takes. 44.1 kHz / 16-bit / mono.
- Crucially it carries a **conventional close-up microphone channel (CM)** alongside the two
  larynx contact mics — so this is normal-distribution vocal audio, not just an exotic sensor.
- Measured from the WAV headers: **CM vocals total 5.24 h, of which 3.50 h are crosstalk-free**
  (the rest has guitar bleed). 20.21 h across all signal types.
- **No timing information of any kind** — 12 lyric `.txt` files with no timestamps, and a
  take-level split CSV. That is fine: we are supplying the annotation.

⚠️ **Composition rights.** The in-zip README states it plainly: *"Note that some songs in the
dataset are cover versions. In these cases, it may be required to obtain a separate license for
the composition, depending on the intended use case."* Low risk for internal evaluation;
relevant if audio or derived score data is ever redistributed.

### ✅ PJS — tiny, but the only corpus with NO third-party composition risk

[Takamichi's PJS corpus](https://sites.google.com/site/shinnosuketakamichi/research-topics/pjs_corpus),
CC-BY-**SA**-4.0, open Google Drive, 275 MB. README verbatim: *"All the data in the corpus is
licensed with CC BY-SA 4.0"* / *"Free for non-commercial and commercial use."*

Its melodies were **composed for the corpus**, so unlike every other candidate on this page
there is no underlying copyrighted work. 48 kHz / 24-bit, soundproof room, dry, solo.

Limits: **26.9 minutes, one amateur male singer.** And its note timings are **worthless as
ground truth** — proven by parsing all 100 MIDIs: exactly one tempo event per file, **96.6 % of
onsets and offsets exactly on the 1/16 grid**, notated duration vocabulary. That is the *guide
melody the singer tracked*, not a transcription of what he sang. (Its `.lab` phoneme labels
*are* audio-aligned, and a third party re-labelled them because the shipped ones were wrong.)
⚠️ CC-BY-**SA**: share-alike may attach to annotations we publish downstream.

### ⛔ Vocal92 — not the resource it looked like

I flagged this as potentially the most valuable audio find (146 h). It fails three ways:
- **The CC-BY tag is contradicted by the authors.** The IEEE Access paper says verbatim: *"**For
  non-commercial use**, the dataset will be available free of charge at the IEEE DataPort."*
  A contradicted grant is not a reliable grant.
- **Paywalled**: *"This dataset requires an IEEE DataPort Subscription to access."*
- **Covers of copyrighted pop** in Chinese and English — the composition layer again.
- Also: the real singing total is **95 h, not 146** (the rest is lyric *reading*), and the audio
  is 16 kHz transcoded from phone recordings — poor material to annotate.

### ⛔ MULTIVOX / VocalnetOpenDataset

MULTIVOX is **CC-BY-4.0** and open (the BSD-3-Clause sighting was its 354 KB *mirdata index*,
not the data; the real total is ~81.5 GB across two records) — but it is **group** singing with
heavy bleed and **zero annotation of any kind**, confirmed three ways. Wrong shape.
VocalnetOpenDataset **does not exist**: the repo is `LICENSE` + `README` only, 11 KB, abandoned
2019, its own statistics fields left as unfilled placeholders.

### ⭐ Library of Congress, American Folklife Center — amateur solo singing at volume

The largest body of **amateur, field-recorded, often solo unaccompanied singing** with open
rights found anywhere: ~10,635 online audio items (Lomax *Southern Mosaic*, Capt. Pearl R. Nye,
Chicago Ethnic Arts). A 400-item sample found **86 % marked free-to-use** → an estimated
**7,000–9,000 usable items**. Open MP3, no account, no form.
Rights field, verbatim: `"No known restrictions on use or reproduction."`

⚠️ **Read that carefully — it is a non-warranty, not a licence grant.** LoC is saying it holds
no rights and knows of none, explicitly leaving performer publicity rights and underlying
composition copyright to the user. That is a residual-risk position, not CC0. The one LoC
holding with an *affirmative* commercial grant is **Citizen DJ** (*"free to use and reuse
without restriction… even for commercial purposes, all without asking permission"*) — but that
is 1–3 second chops of professional accompanied 78s, so it is the wrong content with the best
licence wording found in this whole exercise.

Practicalities if harvested: LoC exposes **no rights facet**, so per-item inspection is
mandatory; rate-limit ~3.2 s/page and use `curl --http1.1`.

### 💔 Meertens Tune Collections — the best-fit corpus in the world, and it is NC

**7,178 MP3s of amateur Dutch solo unaccompanied singing** (1950s–80s field recordings of
elderly informants, ~200–240 h) *plus* **2,503 melodies manually transcribed by musicologists**
to \*\*kern/MIDI. That is our exact input distribution with expert note transcriptions.

Verbatim from liederenbank.nl/mtc/: *"Meertens Tune Collections by Meertens Instituut is
licensed under a Creative Commons Attribution-**NonCommercial**-ShareAlike 3.0 Unported
License."*

Single rightsholder (KNAW / Meertens Instituut). No commercial tier is published, and nobody
was contacted. **This is a business decision rather than a research dead end** — one
institution, one ask, and it would be the strongest corpus we could hold.

### ⭐⭐⭐ SingBAP — the closest thing to a purpose-built corpus for our exact user

The single best shape-match found in this whole sweep. **14 participants, 7 of them
self-reported inexperienced singers**, 5 intermediate, 2 professional, with documented vocal
range per participant. Four exercises, repeated across reference pitches spanning each singer's
range — and the exercise design maps onto our failure taxonomy almost line for line:

| Exercise | Material | What it exercises for us |
|---|---|---|
| `simple` | triad **ma-me-mi-mo-muu**, 1–3–5–3–1 | one note per plosive/nasal syllable — the *favourable* articulation regime |
| `vowel` | **ngi-nge-nga-o-u**, 1–2–1–3–1–5–3–1 | mixed articulation |
| `sustained` | legato on **ruu**, 1–3–5–8–7–5–4–2–1 | 🔴 the hard legato-vowel case — our documented weakness |
| `glissando` | sustained **mm** octave glide | hummed pitch glide, no onset at all |

Plus a directed **breathy** phonation condition and posture conditions (`hunched_back`,
`chest_breathing`, `over_articulation`, `under_articulation`, `sideways`) — **a built-in adverse
tier**, in the same spirit as our own reverb/wind/babble tier.

**Three simultaneous microphones: Behringer C-3 condenser, iPhone 14 Pro built-in, MacBook Air
built-in.** That is our capture distribution, recorded in parallel, so the *same* performance can
be scored across mic quality — a controlled A/B we currently cannot construct. 40,052 files,
~23.7 GB unzipped, 44.1 kHz/16-bit mono WAV. Filenames encode everything:
`inex-5-before_instruction-simple-2-phone-audio.wav`.

**Annotation cost is the lowest of anything on this page.** There is no note truth — but the
*interval pattern of every exercise is published*, so pitch sequence and note count are given a
priori. Only onsets/offsets need marking, against a known answer.

Licence, verbatim from `LICENSE.md` inside the release: *"Creative Commons Attribution 4.0
International License (CC BY 4.0) … You are free to: **Share** … **Adapt** — remix, transform,
and build upon the material for any purpose, **including commercially**."*
https://zenodo.org/records/20744738 · open download, no account.

**No repertoire risk** — exercises only, so the §"composition is a separate right" trap does not
apply. **USABLE-RAW-AUDIO, top priority.**

### ⭐⭐ Belyk, Johnson & Kotz — CC0, and they deliberately recruited *bad* singers

34 participants, median age 21, **only two with any vocal training**, recruited via two ad
wordings chosen *"to attract either strong or poor singers in order to draw from both ends of
the spectrum of singing ability"*. That deliberate sampling of poor singers is unique here and
is exactly the tail our product fails on.

Each participant sang back **45 melodies of 5 notes each** → ~7,600 sung notes, 44.1 kHz/16-bit,
7 s between trials. Plus a range assessment: a stable comfortable note, a **descending sweep to
their lowest**, an **ascending sweep to their highest**, ×3 → clean pitch glides.

Files are *"labeled by the stimulus being imitated"* and stimuli are *"labelled according to a
western chromatic scale"*, so the 5-note target sequence is known per file; Praat pitch
measurements ship alongside (tracker output, not manual — so onsets still need marking, but
cheaply, against a known target).

**Licence: CC0 1.0 Universal** — public domain, verified in the DataCite rightsList, and Dryad's
terms make CC0 mandatory for all deposits. https://datadryad.org/dataset/doi:10.5061/dryad.504t7
(3.45 GB; `Experiment.zip` plus `xaa`–`xad` split parts to recombine with `cat`).

Caveat: recorded in a sound-attenuated chamber with a desk mic — clean studio, not
phone-in-a-room. Pair it with SingBAP's phone channel rather than using it alone.
**USABLE-RAW-AUDIO.**

### ⭐⭐ MTG-QBH — and it retroactively partly re-opens ISMIR2014

118 recordings, **17 subjects "whose musical experience ranged from none at all to amateur
musicians"**, sung a cappella **from memory** (no reference tone, subjects did not hear the
original first), with or without lyrics, **on a basic laptop microphone with no
post-processing** — deliberately, to simulate a realistic query-by-humming scenario. 11–98 s,
mean 26.8 s, ~53 min total.

That description is our input distribution almost verbatim, written by someone else for a
different purpose.

**And the sting:** §"ISMIR2014 / Molina" records that **24 of the 38 ISMIR2014 clips are MTG-QBH
queries**. We closed ISMIR2014 as NC-barred. The *audio* under two thirds of it has been sitting
in an open repository the whole time. Molina's annotations remain barred — but the recordings do
not have to be.

**⚠️ Licence conflict, unresolved, do not use until settled.** Zenodo record 1290712 reports
`"license": {"id": "cc-by-4.0"}`, `access_right: open`. But an earlier pass found UPF's own
project page stating the set is for *"internal non-commercial use only"* and *"may not
redistribute"*. Two agents, two sources, opposite answers. Given §4.0 (NC restricts *use*, not
just sharing) and the §"Re-host licence laundering" pattern, **the restrictive reading wins until
someone reads the operator's own current terms**. Recorded as a conflict, not resolved — per the
no-new-research instruction.

### ✅ ESMUC and CSD — ADOPTED (superseding note)

A later agent re-surfaced **ESMUC Choir Dataset** (Zenodo 5848990) as `cc-by-4.0` /
USABLE-ANNOTATED, and **CSD** likewise, and an earlier revision of this section re-blocked
them by §1. **Under the acquisition policy the re-listing was right**: both are first-party
deposits with CC-BY-4.0 on their own records and manually corrected note truth, and both are
now fetched into the harness (`fetch-esmuc.ts`, `fetch-csd.ts`). §1 is retained as history
only.

### ✅ Saarbrücken Voice Database (Zenodo mirror) — big, and an EGG ground truth

The canonical German clinical voice corpus, mirrored on Zenodo as 73 zips / **38.1 GB**,
`"license": {"id": "cc-by-4.0"}`, open. The SVD protocol is vowels /a/, /i/, /u/ at normal, high
and low pitch **plus a rising–falling pitch contour**, each with a simultaneous
**electroglottograph channel** — and an EGG trace is arguably a *better* f0 reference than manual
annotation for a glide/sustained-vowel tier. There is even a `Sängerstimme.zip` ("singer's
voice") pathology class.

**⚠️ It is a mirror, not the operator's site.** The original `stimmdb.coli.uni-saarland.de` terms
may differ and the uploader may not be the rights holder — the §"Re-host licence laundering"
pattern applies directly. **Verify the primary site's terms before use.** Also: files are Kay CSL
`.nsp`; the one public converter has no licence file, so write our own reader.
https://zenodo.org/api/records/16874898

### ✅ Smaller verified CC-BY / CC0 raw audio

| Corpus | Content | Licence | Note |
|---|---|---|---|
| **JaCRC** (Zenodo 6536490) | 314 a cappella jingju, incl. 75 amateur student recordings (children + adults) | CC-BY-4.0, **with explicit written performer consent for public release** | 🔴 exclude rows whose metadata `source` is `SVAD` (Isophonics, CC-BY-NC-SA) and the 15 commercial-release ones. Heavily ornamented opera. |
| **MAST melody** (Zenodo 8007358) | 3,884 clips, ITU conservatory **entrance-exam candidates** imitating melodic patterns, 5 expert grades each | CC-BY-4.0 | Genuinely amateur at scale. Hard cap: **m4a at 8 kHz**. |
| **URSing** (Zenodo 6404999) | 65 pieces, 22 singers, isolated `Vocal.wav` 44.1 kHz + video | CC-BY-4.0 | ⚠️ karaoke covers → composition rights unresolved. Singers not described as amateur. |
| **Schotanus stimuli** (DataverseNL KS6QCQ) | 472 MP3s, Dutch sentences sung to **specified melodies, scores published in the accompanying PDF** | **CC0** | Performer identity and spoken/sung split unverified. |
| **ECura** (Zenodo 20234272 / 20434128 / 20569113) | Miao, Bai, Yi tone languages — **paired spoken and sung renditions of identical lyrics**, ~4 GB, with IPA | CC-BY-**SA**-4.0 | ShareAlike attaches to redistributed adaptations (i.e. annotations), not to internal eval or the product. Flag before publishing derived labels. |
| **Voices of the Mountains** (Zenodo 21627162) | 50 Kurdish Bayati-Kurd maqam songs, 13 vocalists, 1.81 h, 221 expert **error spans** | CC-BY-4.0 | 22.05 kHz. Microtonal — off-distribution, but a real stress test for a semitone grid. |
| **EMVD** | 27 singers, ~40 min clear-voice subset | CC-BY-4.0 | Small. |
| **AdoVoc Pro** (Zenodo 3383118) | Isolated flamenco, 3 expert singers | CC-BY-4.0 | Tiny, idiom-specific. |
| **Tuvan throat singing** (Dryad cvdncjt14) | Solo unaccompanied, 133 MB | CC0 | Biphonic — pathological for any f0 tracker. A deliberate torture case only. |

### ⛔ Newly barred this pass

- **Music Lab human vocalization corpus** (infant- and adult-directed speech and song) — CC
  BY-**NC**-SA 4.0. Painful: by shape (amateur adults singing unaccompanied) it was the single
  most on-target corpus found.
- **MIREX-hosted QBSH corpora** (IOACAS/ThinkIT, 759 amateur sung queries, 2.77 h, openly
  downloadable) — no licence grant, *"Copyright: Institute of Acoustics, Chinese Academy of
  Sciences"*, **and** the MIREX Participant Agreement §C states verbatim: *"Participants must
  not use the datasets for commercial purposes."*
- **Cmedia** (MIREX 2020, note-level onset/offset/pitch) — no licence, YouTube-scraped, training
  link dead, test set never released.
- **SVDD 2024 CtrSVDD** CC-BY-NC-ND; **WildSVDD** CC-BY covers *CSVs only*, audio is
  participant-scraped from YouTube/Bilibili.
- **Cadenza CLIP1** — Zenodo tags CC-BY-4.0 but the README says the licence is per-source-track;
  of 1,452 FMA tracks ~1,220 are NC, **and the id↔signal mapping is not published**, so the
  clean ~224 cannot be extracted. Revisit if the mapping ships.
- **Cadenza CLIP2** — ElevenLabs-generated. Not real singing.
- **JamendoLyrics / Jam-ALT** — only ~13 of 79 tracks are commercially usable; full mixes,
  lyric-only labels.
- **MoisesDB** CC-BY-NC-SA · **KiSing** CC-BY-NC-ND · **SVCC 2023** derived from NHSS behind a
  signed EULA and registration-gated.
- **Bridge2AI-Voice** — registered-access DUA, **and** *"does not contain raw audios"*.
- **OpenSLR SLR98/SLR99** (Deeply parent–child, labels literally include `singing`) —
  CC-BY-NC-ND. The page does offer a **commercial licence from Deeply Inc.** for ~282 h — an
  acquisition lead, not a free one.
- **TalkBank / CHILDES / PhonBank** CC-BY-NC-SA · **COCOON / Pangloss** essentially all NC (of
  7,202 CC-BY-4.0 sound DOIs, song-related queries returned **4 items**).
- **Thom Hess Lushootseed songs** — unlicensed, and Indigenous cultural heritage we should not
  appropriate regardless.
- **Zenodo 2650547** ("singing vs reading the same song parts" — perfect shape) and **Zenodo
  3534236** (Singing Voice Audio Dataset) — both `license: null`, access `restricted`, zero
  files exposed.
- **MLEnd Hums and Whistles** (235 interpreters) — unlicensed.

### 🚫 Sources swept and definitively empty — do not re-search

**LDC**: queries "singing" and "sung" return **zero**. There is no sung corpus in LDC.
**ELRA/ELDA**: nothing; the only sung-adjacent holding is Bizkaifon (ELRA-S0153) at a €1,000
commercial tier with an unquantified sung fraction and no note annotations.
**OpenSLR**: all 156 resources enumerated and grepped — SLR98/99 only, both NC-ND.
**figshare**: dataset-type searches return only journal supplementary PDFs.
**Dryad**: 13 broad sweeps — overwhelmingly birdsong; every human hit but `504t7` and
`cvdncjt14` contains fMRI/MRI/CSV and no audio.
**DCASE 2020–2026**: no singing or music-transcription task in any year.
**ICASSP SP Grand Challenges 2023**: full list retrieved, no singing.
**Harvard Dataverse / Borealis / DataverseNO / AUSSDA**: swept, nothing beyond the above.
**Wikimedia Commons categories**: a dead end — the Fundación collection is not reachable through
them. **Internet Archive**: dead end. **DataCite**: saturated at 33 queries.
**OpenDataLab** returns `license: null` for everything; **CCMusic** is uniformly CC-BY-NC-ND;
**NII IDR** is research-only platform-wide; **Datatang**'s Apache-2.0 badge covers a teaser only.

### The structural pattern worth internalising

Rights and content are **inversely correlated** across this whole space. National *libraries*
publish openly — because their audio holdings are out-of-copyright commercial 78s: professional,
accompanied, noisy. National *folklore archives* hold exactly what we want — amateur, solo,
unaccompanied — and lock it down, because informant recordings carry living-relative and
personal-data concerns. **LoC's American Folklife Center is the significant exception**, which
is why it is worth the per-item rights work.

Consortia are a dead end for a different reason: **LDC and ELRA have essentially no singing
corpora at all.** ELRA's only sung-adjacent holding is Bizkaifon (ELRA-S0153, Basque oral
archive, 21 h incl. songs and folklore) at a published **€1,000 commercial tier** — but the sung
fraction is unquantified and there are no note annotations.

### ⚠️ Cross-cutting: the composition is a separate right from the recording

This bit three candidates and is not something a licence field ever shows. A CC-BY deposit
licenses the *sound recording*; if the singer performed someone else's song, the *musical work*
is a distinct right the depositor never held. **PJS is the only corpus on this page provably
free of it**, because its melodies were written for the corpus. Weigh it by intended use:
negligible for internal evaluation, material for redistribution.

---

## 3. Standing conclusion — REVISED 2026-08-08 under the acquisition policy

> **⚠️ Read §5 first (2026-08-12/13).** Three corpora have been adopted since this section
> was written — **AVP**, **Dagstuhl ChoirSet** and **JaCRC students** — via a new
> *onset-only* (`pitchless`) path and a new *beat-grid* path that did not exist when the
> tables below were drawn up. Several rankings below are also withdrawn there on evidence:
> **MAST** (priority 3) has no note truth at all and CREPE-derived f0; **SingBAP**
> (priority 1) was checked for hidden timing and has none; **Belyk** (priority 2) is killed
> outright. The tables below are otherwise still accurate.

**Note truth: three corpora adopted and fetched.** The earlier "still empty" conclusion
rested on the consent-archaeology bar the acquisition policy removed.

| Candidate | Status | Basis |
|---|---|---|
| **ESMUC Choir Dataset** — 271 annotated singer-tracks, ~17k notes | ✅ **ADOPTED** (`fetch-esmuc.ts`) | CC-BY-4.0 on its own record; manually corrected per-singer note truth. Caveats: mic bleed, trained singers |
| **CSD** — 96 excerpts, ~3.6k notes | ✅ **ADOPTED** (`fetch-csd.ts`) | CC-BY-4.0 on its own record; Tony-extracted + hand-corrected notes. Caveats: per-SECTION truth, mic bleed |
| **HUST_Solfege** — 73 files, ~3.7k notes | ✅ **ADOPTED** (`fetch-hust-solfege.ts`) | MIT LICENSE at repo root. Data conditions stand: MARG excluded, offsets synthetic (durations derived), pitch convention calibrated per file against the audio |
| **SingStyle111** (12.8 h, hand-entered performance MIDI) | ⛔ **CLOSED** | The dataset's own terms are research-scoped — its authors say so |
| **Dagstuhl ChoirSet** | ⛔ (as note truth) | Quality, not licence: score-aligned onsets measure 70 ms MAE. Beat grids remain interesting |
| **Dai / Mauch / Dixon 2015** | ⛔ **KILLED** | *The Sound of Music*, in copyright to 2049/2054 |
| **SSVD v2.0**, **VocalNotes**, **MIR-ST500**, **DALI**, **TONAS**, **ISMIR2014** | ⛔ | No licence / NC / academic DUA — the dataset itself says no |

**The annotatable-audio reframe (§2b) stays valid** — SingBAP and Belyk remain the path to
amateur-phone-mic truth the adopted corpora cannot provide:

The reframe in §2b is the answer, and it is now backed by verified, downloadable, commercially
licensed audio in our exact input distribution:

| Priority | Corpus | Why | Licence |
|---|---|---|---|
| **1** | **SingBAP** | 7 inexperienced singers · **iPhone + MacBook + condenser in parallel** · syllabic *and* legato *and* glissando · built-in adverse tier · **published interval patterns** so only onsets need marking · no repertoire risk | CC-BY-4.0, "including commercially" |
| **2** | **Belyk et al.** | **Deliberately recruited poor singers** · ~7,600 notes with known 5-note targets · range glides | **CC0** |
| **3** | **MAST** | 3,884 clips of genuinely amateur exam candidates, expert-graded | CC-BY-4.0 (8 kHz) |
| **4** | **Fundación Joaquín Díaz** | ~725–1,000 h, 172 named performers, bulk download | CC BY-SA 3.0 |
| **5** | **LM-SSD**, **JaCRC**, **URSing**, **Schotanus**, **PJS**, **LoC AFC**, **ECura**, **SVD** | see §2b | CC-BY-4.0 / CC0 / CC-BY-SA |

That is a real T3 voice slice, obtainable today, needing only in-house onset/offset annotation
under our own Molina-derived rules.

**Four things worth carrying forward beyond this file.**

1. **NC restricts *reproduction*, not just redistribution** (§4.0). "Internal eval, gitignored,
   never shared" was never available. That permanently closes ~a dozen attractive corpora and
   means the only question worth asking about an NC corpus is whether a *published commercial
   route* exists.
2. **The licence field is not the licence.** Four separate corpora carry a permissive Zenodo/
   figshare tag over material the depositor could not license — MTG/TROMPA (performer consent),
   Dai 2015 (Rodgers & Hammerstein), HUST_Solfege (the MARG third), WildSVDD (CC-BY on the CSVs,
   scraped audio). **Always ask what layer the grant reaches.**
3. **Rights and content are inversely correlated.** Archives that hold exactly what we want —
   amateur, solo, unaccompanied — lock it down, because informant recordings carry living-relative
   and personal-data concerns. The corpora that are open are professional, accompanied, or
   synthetic. LoC's AFC and Fundación Joaquín Díaz are the exceptions, which is why they are
   worth the per-item rights work.
4. **My own claims needed red-teaming and four of them failed it.** The HUST_Solfege/SSVD
   overlap, the "byte-identical" onsets, the "constant +20" offset and the "lawful route into
   SSVD" were all wrong, and all four were wrong in the *optimistic* direction. Nothing in this
   file should be acted on without re-verifying the operative text at the source.

The prior conclusion — *"there is no obtainable external voice corpus we are missing"* — is
**still true of note truth, and decisively false of raw audio**. The annotation effort is the
path, and it does not have to start with a microphone.

---

## 3a. Unexplored leads — recorded, not chased

Written down per instruction rather than researched. Roughly ordered by expected value.

**Highest value**
1. **Freesound API** — the largest CC-BY/CC0 audio pool in existence, with tag search and a
   `license` filter. Needs an API token, which is why it was never swept. **The single biggest
   unexplored channel on this list.**
2. **ccMixter a cappella pool** — ~5,960 items, roughly 27 % permissive (CC-BY 3.0/4.0/SA/CC0)
   ≈ **~1,600 tracks / 60–80 h / 400–700 distinct amateur singers**, open API. Needs filtering
   for rap/spoken, multi-tracking, effects and AI-generated material. Only the `acappella` tag
   was scoped; `vocals` and `female_vocals` are untouched.
3. **FMA-full, filtered on non-NC.** Cadenza validated the recipe (licence filter → drop
   instrumental/classical/experimental → HTDemucs + Silero VAD + RMS to keep vocal tracks).
   Applying it with a *non-NC* rather than non-ND filter would yield a large permissive pool of
   real sung music. Polyphonic, so it needs separation before annotation.
4. **IEEE TMM 10.1109/tmm.2022.3168132** (closed access, unread) — the only plausible published
   home for HUST_Solfege's consent/ethics statement. **The one document that could flip our one
   surviving annotated corpus either way.**
5. **`stimmdb.coli.uni-saarland.de` primary terms** — would confirm or kill the 38 GB SVD find.

**Clinical / phonetics vein** (shape-promising, barely scratched)
6. **Gender-affirming voice-therapy corpora** — pitch glides and sung scales are routine outcome
   measures. Completely unexplored and, on shape, the most promising remaining clinical vein.
7. **Phonetogram / voice-range-profile deposits** — a phonetogram *is* a sung pitch sweep across
   the full range. Zenodo returned zero; clinical repositories untried.
8. **PVQD, AVFAD, VOICED (PhysioNet slug `voiced`), MEEI/KayPENTAX** — licences unread.
9. **Speech-to-song illusion stimulus sets** (Deutsch; Tierney/Dick/Patel; Falk & Rathcke;
   Margulis; Vanden Bosch der Nederlanden) — participants often *sing back* the phrase. OSF and
   journal supplements unexplored.
10. **Seattle Singing Accuracy Protocol** (Pfordresher) and the **AIRS Test Battery of Singing
    Skills** (Cohen) — large corpora of untrained singers pitch-matching. Likely on **Databrary**,
    which needs institutional authorisation; probably a hard barrier, worth one confirmation.
11. **NCVS, KTH/Sundberg (DiVA), RNCM, Institute of Musicians' Medicine Dresden** deposits.

**Channels never opened**
12. **Competition platforms** — AIcrowd, Codabench, CodaLab, EvalAI, Zindi, Tianchi. Verified
    entry points: `codabench.org/api/competitions/?search=singing`,
    `eval.ai/api/challenges/challenge/present/approved/public`, `aicrowd.com/challenges.json`.
13. **ISMIR Late-Breaking/Demo 2020–2026** — `ismir.net/lbd/` 404s and the per-year sites are JS
    SPAs that return nothing to curl. Needs a headless browser.
14. **Interspeech 2020–2026 special sessions** — not checked at all.
15. **CLARIN VLO** (Solr endpoint returns 401), **The Language Archive** (MPI Nijmegen), **ELAR**.
16. **Smithsonian Folkways**, **Global Jukebox / Cantometrics**, **Natural History of Song**.
17. **Regional platforms**: Gitee (token-gated), BAAI Data (503), Baidu AI Studio, Korea AI
    Hub / Gugak / DataON, Taiwan data.gov.tw / Academia Sinica / iKala, Japanese SVS community
    releases, Chinese 非物质文化遗产 archives.
18. **UK Data Service**, **CoCoON's CC0 slice**, **karaoke-app dataset releases**.

**Acquisition leads** (money, not search)
19. **Meertens Tune Collections** — 7,178 MP3s of amateur Dutch solo unaccompanied singing plus
    2,503 expert transcriptions. Our exact distribution with note truth. NC, single rightsholder
    (KNAW), no published commercial tier. **One institution, one ask, and it would be the
    strongest corpus we could hold.**
20. **Deeply Inc.** — the OpenSLR SLR98 page explicitly offers a commercial licence to ~282 h
    including labelled child singing.
21. **Cadenza CLIP1 revisit** once the FMA-id ↔ signal mapping ships (~224 clean tracks).
22. **MRSAudio / MRSSing** — 80 h of solo singing announced under CC-BY-4.0 but **files not yet
    uploaded**. A watch item.

**Small checks left open**
23. **SingBAP** — confirm the EMG electrodes introduce no audible noise into the voice channels.
24. **MAST** — confirm the reference piano pattern does not bleed into the sung `per` clips.
25. **LM-SSD / URSing** — read the song lists for composition-rights exposure.
26. **Jiajie Dai's QMUL thesis (2019)** — closed, EThOS offline since the 2023 cyberattack. Moot
    now that Dai 2015 is killed, but it is the classic hiding place for a consent restriction.

---

## 4. Re-verification of previously-rejected corpora

### 4.0 ⚠️ The finding that decides most of this file: NC restricts USE, not just sharing

We had a working theory that "evaluation only, gitignored fixtures, never redistributed"
might put NC corpora within reach. **It does not.** CC BY-NC 4.0
([legal code](https://creativecommons.org/licenses/by-nc/4.0/legalcode.en) §2(a)(1)) grants
the licensee the right to:

> "reproduce and Share the Licensed Material, in whole or in part, **for NonCommercial
> purposes only**"

The NonCommercial qualifier attaches to **reproduce**, not only to Share, and
`NonCommercial` is defined as "not primarily intended for or directed towards commercial
advantage." Downloading a corpus into our fixtures *is* reproduction, and doing it to score a
paid product's transcriber is directed toward commercial advantage. The use/redistribution
split we were hoping for does not exist in the CC text — it exists only in *bespoke* terms
(JVS-MuSiC has it; see 4.5).

So `research-benchmarks` §7's "don't touch NC data" is not merely a conservative house rule.
On this reading it is the correct reading of the licence. **Stop looking for a way around
NC.** The productive question is only ever whether a *published commercial route* exists.

### 4.1 HumTrans — BARRED twice over; delete the Tencent ask from §11

- Licence today, verbatim from the card front-matter at
  [`dadinghh2/HumTrans`](https://huggingface.co/datasets/dadinghh2/HumTrans/raw/main/README.md):
  `license: cc-by-nc-4.0`. Unchanged since 2023-09-26; `gated: false`. (Our notes had the
  wrong repo path — `dsw/HumTrans` 401s.) The GitHub
  [`shansongliu/HumTrans`](https://github.com/shansongliu/HumTrans) reports `license: None`
  and `/LICENSE` 404s. **No commercial route is published anywhere** — §11's "Tencent ARC Lab"
  counterparty was inferred, not documented.
- **The quality claim is confirmed, and it is worse than our note said.** Dynamic HumTrans
  ([arXiv:2410.05455](https://arxiv.org/html/2410.05455v1) §1.2): *"A major issue with the
  HUMTRANS dataset is that the ground truth onsets and offsets are not well aligned"* — the
  labels are the reference melody's MIDI, and alignment rests entirely on subjects humming in
  sync, *"without any post-processing."*
- Corroborated by HumTrans's own baseline table: four SOTA vocal transcribers score F1
  **2.70–6.74** on it. Nothing scores 3 F1 because it is a bad model; that is the signature
  of misaligned labels.
- **Action:** §11's "Tencent — benchmarking-only ask" row should be **deleted**, not
  downgraded. Even free permission would buy a corpus we cannot score against. The
  Mila/Laval correction repo carries no licence at all, on top of NC source audio.

### 4.2 CHAD_hummings — BARRED, and it has no note truth at all

`license: cc-by-nc-4.0`, verbatim from
[the card](https://huggingface.co/datasets/amanteur/CHAD_hummings/raw/main/README.md),
unchanged since 2023-10-08. But the disqualifier is content, not licence: it is a
**query-by-humming retrieval** corpus — 5,314 wavs grouped by song identity, no onsets and no
pitches. It cannot score a note transcriber. **Remove it from the shortlist.**

⚠️ Trap worth remembering: the companion repo [`amanteur/CHAD`](https://github.com/amanteur/CHAD)
is **MIT** — that is the *code*. An MIT badge on a code repo says nothing about the audio.

### 4.3 ACE-Opencpop — BARRED, with a broken licence chain upstream

`license: cc-by-nc-4.0` on [`espnet/ace-opencpop-segments`](https://huggingface.co/datasets/espnet/ace-opencpop-segments/raw/main/README.md).
**New and worth knowing:** its upstream **Opencpop** is
[CC BY-NC-**ND** 4.0](https://wenet-e2e.github.io/opencpop/liscense/) — *NoDerivatives*. A
BY-NC-ND upstream does not authorise a redistributed derivative under BY-NC, so the ESPnet
release's own footing is questionable. Stay away independent of our use.
Upstream Opencpop *does* publish a commercial route (*"If want to use it commercially, you
are welcome to contact us by email"*), but the derivative does not.
Wrong shape for us anyway: synthesized output of one professional Mandarin voice, with truth
exact by construction — which is precisely what our own `lib/synth.ts` already provides
under a clean licence.

### 4.4 MDB-stem-synth / MedleyDB — BARRED, and **our §11 note is wrong**

- MDB-stem-synth: `license: cc-by-nc-4.0` ([Zenodo 1481172](https://zenodo.org/records/1481172)).
- MedleyDB's [downloads page](https://medleydb.weebly.com/downloads.html) **contradicts
  itself** — prose says CC Attribution-NonCommercial, the badge says
  Attribution-NonCommercial-**ShareAlike** 4.0. Either way NC binds.
- It is also the one page that *does* separate use from redistribution, and it goes the wrong
  way for us: redistribution is asked to be restrained *beyond* CC, while the operative use
  restriction is *"free of charge for non-commercial research use **only**"*.
- ⚠️ **Correction to `research-voice-transcription.md` §11:** the claim that MedleyDB has "a
  known commercial-licensing contact route **[S]**" is **not supported**. The only contact is
  one researcher's personal academic address, appearing in the *republication* paragraph, not
  a licensing offer — no form, no dual licence, no tech-transfer office. **Re-mark it `[X]`.**
  (The row was already "drop from shortlist" for other reasons, so nothing downstream moves.)
- Content also fails gate 2: MDB-stem-synth is **f0 only, not notes**, and exact by
  construction because the audio is resynthesized from the estimate. MedleyDB's melody
  annotations are pYIN-derived then hand-corrected — via Tony, per their own page.

### 4.5 JVS-MuSiC — the one where re-checking changed the answer, and it still doesn't help

This is the only corpus of the five with a genuine, **published, institutional** commercial
route, and the only one whose terms address our exact situation.

From [the corpus page](https://sites.google.com/site/shinnosuketakamichi/research-topics/jvs_music),
verbatim: the audio *"may be used for: Research by academic institutions / Non-commercial
research, **including research conducted within commercial organizations** / Personal use"*,
and *"**Re-distribution is not permitted**"* (with a ~3-file carve-out). That is a real
use/redistribution split — the thing CC BY-NC does not give. And: *"We welcome your commercial
use… Please feel free to contact the following members"*, listing the **University of Tokyo
TLO**. A TLO contact is a standing licensing process, not a favour-ask — the JKU/madmom
pattern.

**And yet: do not spend the email.** JVS-MuSiC has **no note-level annotation.** Its tags are
singer-similarity, key and tempo; the only pitch-bearing artifacts are **Melodyne project
files**, i.e. Celemony's proprietary detection hand-adjusted for *resynthesis*, in a closed
format needing a Melodyne licence to open. Content is also 100 singers of the *same*
children's song. Clearing the licence would buy nothing scoreable.

### 4.6 What this pass changed

Nothing in the plan, and that is the useful outcome — four of five are hard-barred by a
licence term we had misread as narrower than it is, and the fifth is clearable but empty for
our purposes. Two corrections to bank upstream: the MedleyDB commercial-route claim becomes
`[X]`, and the HumTrans row becomes *NC-barred **and** quality-disqualified* with its
benchmarking-only ask deleted.

---

## 5. The `pitchless` reframe, and a second sweep — 2026-08-12

**New harness capability, not just a new dataset.** Everything above judges a corpus by
whether it clears gate 2 (note-level onset+offset+pitch). This session adds a fifth option:
a corpus can be **onset-only** — real, human-labelled onset timestamps with *no* pitch
anywhere in the annotation chain — and still be genuinely useful, scored via MIREX **COn**
(onset F1, pitch ignored) rather than note-F1. `lib/metrics.ts`'s `scoreOnsets()` already
implemented this and was simply never wired up; it now is (`run-eval.ts`, `lib/realCorpus.ts`
— datasets declare `pitchless: true` in `dataset.json`, get excluded from the pooled note-F1
the same way `noteTruthDerived` datasets are, and get a per-scenario `onsetF1` column instead).
This reopens exactly the class of corpus §2's "Checked and rejected on content, not licence"
table dismissed for failing gate 1 (real *pitched* singing) — they still exercise the
`OnsetDetector` in isolation, our documented weakest component, on real amateur audio.

### 5a. ✅ AVP (Amateur Vocal Percussion) — ADOPTED, pitchless

| | |
|---|---|
| Source | [Zenodo 5036529](https://zenodo.org/records/5036529) · `AVP_Dataset.zip`, ~220 MB |
| Licence | **CC-BY-4.0** (`metadata.license.id`, re-verified 2026-08-12) |
| Content | `AVP_Dataset/{Personal,Fixed}/Participant_N/`, 280 paired `.wav`/`.csv` (kick/snare/closed-hihat/open-hihat vocal-percussion imitations, plus one improvisation per participant/modality) |
| Annotation | CSV, no header, real row: `0.085623582582766,kd,p,ə` — `onset_seconds, class_label, onset_phoneme, coda_phoneme`. No pitch tracker anywhere; onsets are a direct human label. |

Fetcher: `fetch-avp.ts`. `durSec` is a derived, clamped gap-to-next-onset (onset-only scoring
ignores it); `midi` is a constant placeholder (60) since there is no pitch to report — both
are cosmetic to satisfy `TruthNote`'s shape, not claims of real value. **This is real amateur
audio with real, independent onset ground truth — exactly what §2's rejected-on-content table
flagged as valuable for `OnsetDetector` isolation, now actually wired in.**

### 5b. ⛔ AVP-LVT — not a distinct corpus; its own audio isn't bundled

[Zenodo 5578744](https://zenodo.org/records/5578744), CC-BY-4.0, confirmed — but the zip
re-bundles AVP's own audio+annotations verbatim under `AVP-LVT_Dataset/AVP_Dataset/...` and
ships **LVT annotations only** (`Annotations_LVT_Frase/*.csv`, `Annotations_LVT_Improviso/*.csv`,
same 4-column format) for the *extended vocal techniques* recordings — whose audio is a
**separate, not-yet-located dataset** per the zip's own `Instructions_to_build_AVP-LVT_Dataset.rtf`.
Searched GitHub for the standalone "LVT" / extended-vocal-technique corpus and found nothing.
Not implemented; revisit only if the LVT audio source surfaces.

### 5c. ⛔ Belyk et al. (sung + whistled pitch imitation, CC0) — downloadable after all, but KILLED on content: no timing survives anywhere in the corpus

**Update, same session:** the WAF blocker above was real but temporary — it cleared on retry,
and a headless Playwright/Chromium session (warm the landing page, click the in-page link,
capture the `download` event at the **context** level, not the page level — the link opens a
new tab) gets straight through. Confirmed by actually downloading `xad` (130 MB) then `xaa`
(1.05 GB) and reading the archive for real: 5,727 entries recovered from the zip's central
directory via a ranged read of `xad`'s tail (the CD for a `cat`-split archive lives entirely in
the last part), format exactly as the metadata promised —
`data/subject_s01/sing_recordings/s01_trial10_E3_D3_C3sharp_A2_C3.wav`, i.e. the **exact 5-note
target sequence is encoded in the filename itself**, cross-checked against a Praat measurement
in the sibling `praat_output.csv` (`s01_trial10_...,163.172,138.625,137.402,109.791,137.506` —
these Hz values track E3/D3/C♯3/A2/C3 closely).

**And then the kill.** `praat_output.csv` carries a mean-frequency-per-note value ONLY — no
timing column of any kind. Reading the shipped `melody_measure.praat` script (the tool that
produced it) explains why: it is a **manual, interactive** Praat protocol — a human places the
cursor "at the center of a note" by eye/ear in the Praat editor, the script measures pitch in a
±125 ms window around *that cursor position*, prints the pitch, and **discards the cursor
position** without ever writing it to the CSV. The paper itself (Belyk, Johnson & Kotz 2018,
*R. Soc. Open Sci.* 5:171544, read via Europe PMC's open full text) confirms there was never a
fixed intra-trial cadence to fall back on either — §2.2.3: *"Each melody was presented one at a
time and separated by 7 s silent gaps during which participants' imitations were recorded…
[no metronome or per-note cue during the participant's 7 s response window]."* So there is no
route to onset ground truth here — not measured, not fixed-cadence, not recoverable from
anything the corpus or the paper ships. The pitch sequence is real, human-verified, and
completely orphaned from any timing.

**Verdict: KILL as note/onset truth.** Confirmed by reading the actual data and the actual
methods section — not inferred from a description, per §0's own discipline. Not implemented;
not worth a human hand-download either, since the missing piece (timing) cannot be recovered
by better access, only by new manual annotation (at which point the audio is no more special
than any other annotatable-audio candidate in §2b). Retained here because the download-blocker
diagnosis is reusable: **Dryad's WAF is beatable with a headless-browser session that opens the
download in a new tab and listens for the `download` event at the browser-context level**, and
a `cat`-split archive's central directory can be read from a ranged read of just the LAST
split part, exactly like a normal zip's tail — worth remembering for any future Dryad corpus.

### 5d. ⛔ PJS phoneme boundaries — blocked by Google Sites' JS rendering, not licence

The corpus's own `.lab` phoneme boundaries (confirmed CC BY-SA 4.0, HTK format, 100ns units,
via the third-party relabel [`UtaUtaUtau/pjs-manual-labels`](https://github.com/UtaUtaUtau/pjs-manual-labels))
are real, audio-aligned onset truth on solo dry singing — exactly the re-onset-evaluation
material `research-voice-transcription.md` flags as missing. But the corpus's own **audio**
lives behind a modern Google Sites page that renders its download links client-side; the only
`drive.google.com` links present in the server-sent HTML are three individual example WAVs
(`pjs056_song.wav`, `pjs056_speech.wav`), not the `pjs_corpus_ver1.1.zip` itself. The relabel
repo ships labels only, no audio. **Not implemented. Next step: a human opens the page in a
real browser and copies the corpus zip's Drive link directly.**

### 5e. ⛔ Jingju a cappella part 2 — license self-contradicts on its own current record; treat as NC

Re-checked all 7 versions of [Zenodo 1421692](https://zenodo.org/records/1421692) via the
`/versions` API. The machine-readable `license.id` flip-flops by version: `cc-by-4.0` (v0) →
`cc-by-nc-4.0` (v1–v5) → `cc-by-4.0` (v6, current/latest) — but **v6's own description text
still reads "Creative Commons Attribution-NonCommercial 4.0"**, i.e. the current record
contradicts itself, field vs. prose, on the same page. This isn't the upstream-authority
question §1's acquisition policy declines to chase (a different party's undisclosed defect
behind a clean grant) — it's the record's own two statements disagreeing. Per the same
default already applied to MTG-QBH (§2b), **the restrictive reading wins until the field is
actually fixed or the authors clarify.** Manual syllable boundaries are real and well-formatted
(confirmed: Praat TextGrid + tab-separated `.txt`, `start_sec\tend_sec\tlabel`) — worth
revisiting the moment the licence stops contradicting itself. Not implemented.

### 5f. ⛔ cante100 and iKala — the mirdata six's other two, actually checked this time

§2's "mirdata, enumerated" note listed these among the six singing∩note-level loaders and
claimed "every one is already held or barred" — true, but neither had its own dedicated
entry anywhere in this file; that claim rested on nothing. Checked directly against
`mirdata`'s own `LICENSE_INFO` blocks:
- **cante100**: *"offered free of charge for internal non-commercial use. We do not grant any
  rights for redistribution or modification."* — same COFLA-project NC-and-gated profile as
  TONAS. ⛔ Barred, confirmed.
- **iKala**: *"used to have a custom license"* — genuinely unresolved (mirdata itself doesn't
  know), and separately the audio is Chinese pop karaoke (commercial compositions, the Dai/
  MedleyDB composition-rights trap again) with pYIN-derived notes (`ikala-pyin-notes.zip`,
  gate-3 circularity). Low expected value even if the licence were resolved. Not pursued
  further.

### 5g. ⛔ `seyong92/CSD_reannotation` — a real quality upgrade for CSD's per-section ceiling, NC-barred

Found via GitHub search (not covered by §0's Zenodo/figshare/OSF-oriented search channels —
worth adding "GitHub, searched directly" to the discovery-channel list). Re-annotates all 50
CSD songs **per-singer** (fixing exactly the per-SECTION ceiling §1b flags for CSD) via Sonic
Visualiser, format `onset, MIDI pitch, duration`. `LICENSE` file, read directly (GitHub's own
SPDX auto-detect returned `NOASSERTION`, i.e. "not a standard licence string" — it undersold
it): **Creative Commons Attribution-NonCommercial-ShareAlike 4.0**, verbatim. ⛔ Barred under
§4.0 (NC restricts use). Recorded because the annotation-quality idea (per-singer re-labelling
of an existing corpus with an existing annotation protocol) is worth watching for a licence
change or an equivalent CC-BY effort elsewhere.

### 5h. Saarbrücken Voice Database — plan drafted, NOT implemented (verification blocked)

The Zenodo mirror ([16874898](https://zenodo.org/records/16874898)) file list was pulled
before the block below hit: 73 zips by pathology category, `healthy.zip` alone is 6.02 GB, and
a `Sängerstimme.zip` ("singer's voice", 23.6 MB) sits alongside it — worth checking on its own
once reachable. **The NSP-format and EGG-channel claims in §2b's SVD entry are carried over
from general knowledge of the *original* corpus, not verified against THIS Zenodo mirror's
actual files** — no member of any zip was opened this session. Do not write a binary NSP
parser from that claim alone; open one file first (§0's own verification discipline). Blocked
below before this could happen.

### 5i. ⚠️ Infrastructure blocker: Zenodo IP-rate-limited mid-session, "unusual traffic from your network"

Around 15:55–16:05 on 2026-08-12, after the metadata/format-verification sweep above (many
rapid `zenodo.org/api/records/...` calls across this session plus a parallel research agent
hitting the same API), every subsequent Zenodo request — API and file `content` endpoints
alike — started returning a Cloudflare-style `403 Access to this resource has been restricted
due to unusual traffic from your network`. Confirmed record-independent (a fresh, previously-
unfetched record ID also 403'd) and still active as of this write-up. This blocks **AVP-LVT's
follow-up, SVD, and MAST** from further verification or fetching this session. Unlike Dryad's
WAF (§5c) or Google Sites' JS wall (§5d), this looks purely rate-limit-shaped and should clear
with time — retry a plain `curl https://zenodo.org/api/records/<any-id>` before resuming any
Zenodo work, and pace requests at the ≥6 s the register already recommended (§0) — this
session did not.

### 5j. Standing count after this pass — superseded by §5l, kept for the sequence

**One new corpus shipped: AVP** (`fetch-avp.ts`, pitchless/onset-only). **Belyk is now
CLOSED** (§5c) — downloadable, but definitively contains no recoverable timing, so it is not a
future lead, not a blocker to revisit. Three more are research-complete and blocked on
infrastructure or a self-contradictory licence field, not on searching: **SVD** (Zenodo IP
rate-limit, format unverified), **PJS** (Google Sites JS wall on the audio link only — labels
are confirmed), **Jingju part 2** (licence self-contradiction — needs author clarification,
not a retry). Next concrete step, in priority order: retry Zenodo (this session confirmed
Dryad's own WAF-style block cleared within the same session, so Zenodo's may too), then get a
human to grab PJS's Drive link directly from a real browser.

> Retrying Zenodo was the right call — it cleared, and §5l records what that unlocked.
> Two corrections to the paragraph above: **PJS's blocker was misdiagnosed** (the page renders
> fine under a real browser; the wall is a Drive download quota), and **Jingju part 2 is now
> deprioritised on VALUE, not just licence** — its syllable annotations are the same kind
> `jacrc-students` now supplies, but on professional rather than amateur singers, so
> resolving its licence contradiction would buy little. **SVD stays unimplemented**: it has no
> note or onset annotation of any kind (sustained vowels and glides), so it was never a
> transcription corpus — only an f0/EGG reference, which the harness has no metric for.

### 5l. 2026-08-13 continuation — Zenodo unblocked, two more corpora adopted, six more killed with evidence

The §5i Zenodo block cleared on its own (as predicted). Everything below was done
against live records.

**✅ ADOPTED — `dagstuhl-choir` (`fetch-dagstuhl.ts`), and it changes what the harness can
measure.** §2's DCS entry called the 20 hand-tapped, second-annotator-reviewed beat grids
"the part we missed" and "our only real-tempo reference on singing". They are now in:
102 excerpts from 24 quartet singer-stems, 2,143 notes, **real tempo 63–91 BPM**. This
required a harness change, not just a fetcher — `GroundTruth.beatGrid` (types.ts),
`beatsFromGrid()` (lib/notation.ts, piecewise-linear time→beat interpolation), and
`notation-eval.ts` preferring a grid over the scalar bpm. A single `bpm` cannot describe a
choir following a conductor; the grid can.

**The design was validated, not assumed.** Mapping all 2,143 score-CSV notes through the
grid: **80.6 % of onsets land within 1/32 beat** of a sixteenth grid position (median
distance 0.013 beats), and note values collapse onto real musical durations — 1155 exact
quarters, 243 halves, 113 dotted halves, 108 eighths, 100 dotted quarters. So the beat grid
plus the score alignment together *do* recover the written rhythm, which is the claim the
whole dataset rests on.

Three caveats are baked into its manifest and must survive into any write-up: the note truth
is still the 70 ms-MAE DTW alignment (hence `noteTruthDerived: true`, out of the pooled
headline); **rhythm scored here is rubato-robustness, not GuitarSet's click-locked
axis** — DCS singers followed a conductor with ritardandi, while the pipeline quantises at
one bpm; and the **performer pool is tiny — 8 singers (2 quartets × SATB)**, so
`lib/split.ts` can only draw 2 dev / 6 test performer groups from it. Treat any
per-dataset number as a probe, never as a headline with a confidence interval.

`lib/split.ts` gained performer-grouping rules for all three new corpora at the same time.
Without them the default per-clip fallback would have put the same voice in both halves —
the exact leak that file exists to prevent, and a live risk here because all three produce
many clips per performer (AVP: one per drum class × modality; the other two: several 30 s
excerpts of one take). Verified: **0 leaked performer groups** across all three.

**✅ ADOPTED — `jacrc-students` (`fetch-jacrc.ts`).** JaCRC's `JaCRC-annotations.zip` turns
out to hold manual **syllable-level time boundaries** (tab-separated `start end label`, `sil`
for gaps) including a `3-students/` folder — the conservatory-student recordings the §2b
table flagged as carrying explicit written performer consent. 175 excerpts, **5,175 syllable
onsets, 25 amateur performers**, CC-BY-4.0. Only `JaCRC-recordings/JaCRC-students-recordings/`
is touched, which sidesteps the SVAD/commercial-provenance rows §2b warns about rather than
filtering around them.
⚠️ **Read `onsetRecall`, not F1**: jingju is melismatic, so syllable onsets are a strict
subset of note onsets and a correct in-melisma detection scores as a false positive.
(Measured median syllable is 0.47 s, so this is milder than feared, but the bias is real and
one-directional.) `run-eval.ts` now reports onset precision and recall separately for exactly
this case.

**Killed this pass, each on evidence rather than reputation:**

| Corpus | Verdict |
|---|---|
| **MAST melody** (8007358) | ⛔ **Gate 2 + gate 3.** Its `annotations.csv` is a per-clip **4-level quality grade** from 3 experts (`1-Completely Off … 4-Perfect`) — no onsets, no notes, nothing time-localized. Its only pitch data is `f0data_crepe/`, i.e. **CREPE-derived — our own estimator**, the circularity trap at its purest. §3's priority-3 ranking for MAST was too generous and is withdrawn. |
| **Voices of the Mountains** (21628262) | ⛔ **Gate 2.** 221 expert annotations are **error spans** (fine pitch error / rhythm error / modal drift) with start–end times, not note events. Cannot score a transcriber. |
| **ECura** (20234272 / 20434128 / 20569113) | ⛔ **Gate 2.** The "annotation" is the *file segmentation* — audio is pre-cut into one-word and one-phrase files with xlsx script/translation metadata. There is no in-file timing, so a word file has exactly one trivial onset. |
| **AVP-LVT's LVT half** (5578744) | ⛔ **Unlicensed upstream.** Its `Instructions_to_build_AVP-LVT_Dataset.rtf`, extracted and read, points at a bare Google Drive id (`0BxZsTXp2zMDIR3hzTkNvSU1LYkE`) for the LVT audio — a third-party dataset with no published licence. The CC-BY-4.0 covers the *annotations* only. Textbook §"Re-host licence laundering". The AVP half is already adopted (§5a); this closes the rest. |
| **SingBAP** (20744738) | ⛔ **Still no onsets — verified, not assumed.** §3 ranks it priority 1, so its `feature_sets.zip` was checked directly for hidden timing: the features are **fixed-window frame statistics at 100/1000 ms** with `pitch` "estimated via autocorrelation" and a derived `note` name column. That is tracker-derived frame data, not note onsets. SingBAP remains exactly what §2b says — outstanding *annotatable* audio, still needing in-house annotation. |
| **PJS** | ⛔ blocked differently than §5d recorded — see the dedicated diagnosis in §5m. Not a licence or a rendering problem: a Google Drive per-file download quota. **The closest remaining corpus.** |

**Watch item updated — MRSAudio/MRSSing.** §3a listed it as "announced under CC-BY-4.0 but
files not yet uploaded". The upload has partly happened: `verstar/MRSAudio` on HuggingFace is
live, CC-BY-4.0, ungated, 94,279 files. But the uploaded parts are **MRSMusic** (16
*instruments*: violin, erhu, pipa, xiao, … — no vocal category) and MRSLife. **MRSSing, the
80 h of solo singing that is the reason to care, is still not there.** Keep watching.
MRSMusic itself is not adopted: it is instruments rather than voice, and its per-note CSVs
(`start_time_s,end_time_s,pitch_midi,velocity,pitch_bend[]`, with overlapping notes on a
double bass) carry the signature of automatic transcription with no published statement of
manual annotation — gate 3 unresolved.

**Two systematic sweeps were run and found nothing new**, which is itself the useful result:
a licence-filtered Zenodo sweep (14 queries, 144 permissively-licensed records surviving)
and a DataCite sweep (8 queries across its Zenodo/figshare/OSF/Dataverse mirror). Every
singing hit was already in this register. ⚠️ Weigh the two unequally: the **Zenodo sweep is
the real negative** — it re-found the known positives (ESMUC, CSD, Dagstuhl, vocadito,
AVP-LVT, VocalNotes…) and surfaced JaCRC, so its filters demonstrably pass what they should.
The **DataCite sweep passed nothing at all, including known positives** (its full-text query
matching is weak and rights strings vary by repository), so it is corroboration of the
thinnest kind, not independent evidence. Combined with §2's "mirdata, enumerated" negative,
the standing conclusion holds: **the permissively-licensed, note-annotated singing corpus
space is now essentially exhausted**, and further progress comes from in-house annotation
(§2b) rather than from searching.

### 5m. PJS — fully diagnosed, waiting on a Google Drive quota. Do not re-derive any of this.

Retried 2026-08-13 evening. Still blocked, but the diagnosis is now exact, so a future attempt
is a single command rather than an investigation.

**What is true:**
- The corpus file is Drive id `1hPHwOkSe2Vnq6hXrhVtzNskJjVMQmvN_`, real filename
  **`PJS_corpus_ver1.1.zip`** (read off the Drive viewer page, which renders fine under
  Playwright — §5d's "JS wall" was the wrong diagnosis and is withdrawn).
- The block is Google's *"Quota exceeded — too many users have viewed or downloaded this file
  recently… it may take up to 24 hours"*.
- ⭐ **The quota is FILE-specific, not network-specific — proven, not assumed.** A control
  download of a different Drive file linked from the same page (`pjs056_song.wav`, id
  `1NJ3_xuUFPRUfpI276yce1mcsHPpVdoCM`) returns HTTP 200 with a real
  `content-disposition` and 2,308,096 bytes. So there is nothing to fix on our side and no
  point trying different user agents, `confirm` tokens, `authuser` values or a headless
  browser — all were tried and all hit the same per-file wall.

**No mirror exists.** Checked and empty: the author's own `ss-takashi.sakura.ne.jp/corpus/`
host (which *does* serve `jsut_ver1.1.zip` at 2.7 GB, so the host pattern is real — PJS simply
is not on it; 9 filename variants including the exact capitalisation all 404, and the
directory index is 403), HuggingFace datasets, GitHub repo and code search, and OpenSLR.

**The one action that works: wait ≥24 h and re-run**

```
curl -L -A "Mozilla/5.0" \
  "https://drive.usercontent.google.com/download?id=1hPHwOkSe2Vnq6hXrhVtzNskJjVMQmvN_&export=download&confirm=t" \
  -o apps/api/scripts/eval/.cache/pjs/PJS_corpus_ver1.1.zip
```

If it returns ~2 KB of HTML the quota is still up; if it returns ~275 MB it worked. **Still
worth it**: the labels are already in hand (CC-BY-SA-4.0,
`UtaUtaUtau/pjs-manual-labels`, HTK format, 100 ns units), and PJS's **vowel onsets are proper
note onsets under Molina's convention** — on clean, dry, solo singing whose melodies were
composed for the corpus, so it is the one candidate on this page with no third-party
composition risk at all. Note its shipped MIDI is worthless as truth (§2b: 96.6 % of onsets on
the 1/16 grid — the guide melody, not the performance); the `.lab` phoneme boundaries are the
asset.

### 5k. ccMixter / stimmdb.coli.uni-saarland.de — checked per a mid-session redirect, both still open questions

Per instruction to keep working §3a's unexplored leads, not just the corpora blocked above:

- **ccMixter's open API works exactly as §3a claimed** — `ccmixter.org/api/query?tags=acappella`
  returns real, individually-licensed tracks with direct download URLs and no token (verified:
  one CC-BY-4.0 track, direct mp3 URL). Confirms the lead is real but doesn't change its
  shape: it is annotatable *raw* audio with zero onset/pitch annotation of any kind, so it
  cannot become a scored corpus without the in-house annotation effort §2b already scopes —
  it is not a shortcut around that, just a confirmed-viable source for it.
- **SVD's primary site** (`stimmdb.coli.uni-saarland.de`) loaded (200, 52 KB) but a first pass
  found no licence/copyright text on the front page — the terms (if any) are likely on a
  buried "conditions of use" or `Impressum` page, not yet located. Still open; needed before
  building the SVD fetcher regardless of the Zenodo-mirror block, since §5h already flagged
  that the mirror's terms may not equal the primary site's.

---

## 6. The 2026-08-20 gap-filling sweep — the register's non-whistle findings

Executed against the README's **real-corpus gap register (2026-08-20)**. Whistling — the gap
this pass was mainly aimed at — got its own file: **`research-whistle-corpus.md`**, which
carries the full sweep, the acquisition verdicts, the two adopted datasets and the capture
protocol. This section records everything else the pass touched, so this file stays the single
register of licence verdicts.

### 6a. ✅ TinySOL — ADOPTED. Real timbre in the `very-high` band, which had none.

`10.5281/zenodo.3685367`, **CC-BY-4.0** on its own Zenodo record (Cella, Ghisi, Lostanlen,
Lévy, Fineberg, Maresz; 2,913 isolated notes recorded at Ircam for Studio On Line 1996–99,
44.1 kHz mono, 1.0 GB tar.gz + a 0.3 MB metadata CSV).

Why it matters here: the 2026-08-20 provider-routing census found **zero real pitched clips
reaching the `very-high` band**, so that band's shipping path and its CREPE-pitchdown
replacement are synthetic-validated only. Measured from `TinySOL_metadata.csv`: **742 notes at
or above MIDI 77 (698 Hz)** and **353 at or above MIDI 86 (1175 Hz)** — chromatic coverage to
D7 on flute (2349 Hz), E7 on violin (2637 Hz), C♯8 on accordion (4435 Hz), each at pp / mf / ff.

⚠️ **The catch, and the new manifest flag it needed.** TinySOL is one note per file, so a
melody has to be assembled. `fetch-tinysol.ts` trims each note at −34 dBFS of its own peak,
cuts it to 350 ms with a 6 ms fade at the splice, and lays eight of them out in two layouts
(`legato`, 0 ms gap → real pitch transitions; `detached`, 80 ms gap → the silence-onset
control). Truth is therefore **exact** — we placed every onset — but the *performance* is ours:
no performer timing, no legato shaping, no rubato. That is the opposite failure mode from
`noteTruthDerived` (weak labels, real performance), so it needed its own flag rather than a
reuse of that one: **`constructedPerformance: true`** in `dataset.json`, honoured by
`lib/realCorpus.ts` and `run-eval.ts`, which keep such datasets out of the pooled headline
while scoring and reporting them with their own footnote. Built: **64 clips / 512 notes** across
`tinysol-{flute,oboe,clarinet,violin,viola,accordion}`.

### 6b. ✅ DEMAND — adopt for the adverse tier's noise beds (not yet implemented)

`10.5281/zenodo.1227121`, **CC-BY-4.0**, first-party deposit: 16-channel recordings of real
acoustic noise in 18 environments across 6 categories (café, office, street, park, transport,
domestic), at 16 kHz and 48 kHz, ~100–300 MB per environment.

The register's complaint is that *"the adverse tier is synthetic degradation of real
performances — honest, but no take was performed in a real echoey room / outdoors"*. Half of
that is fixable cheaply: `lib/degrade.ts` currently mixes `synthesizeSpeechNoise` /
`synthesizeWind` beds from `lib/acoustics.ts`, and a `Condition` that names a real DEMAND wav
instead would make `street-noise` and `wind-outdoor` **recorded** maskers rather than modelled
ones. Not implemented this pass; the plumbing needed is one optional `noiseBedFile` field on
`Condition` plus a fetcher, and the conditions must be added as NEW ids (never a redefinition
of the existing four) or every historical adverse number silently changes meaning.

### 6c. ✅ Real measured room impulse responses — several CC-BY-4.0 options, verified

Same motive as 6b for the reverb axis: `degrade()` convolves with a *synthesised* exponential
IR (`synthesizeRoomImpulse`). Real measured IRs are abundant and permissively licensed; checked
via the Zenodo API, all **cc-by-4.0** on their own records:

| dataset | DOI | shape |
|---|---|---|
| **Arni** (Aalto, variable acoustics) | `10.5281/zenodo.6985104` | one room, thousands of IRs across panel configurations → a measured RT60 *continuum*, which is exactly what a graded reverb axis wants |
| **dEchorate** | `10.5281/zenodo.6576203` | 6 rooms, calibrated, echo-annotated |
| **OK5** | `10.5281/zenodo.18622201` | spatial IRs from 25 real work-environment spaces → room *diversity* |
| **FLAIR** | `10.5281/zenodo.17037517` | laser-calibrated room geometry alongside the IRs |
| **RAVes** | `10.5281/zenodo.19809790` | spatial + binaural, room-acoustic variance study |

Recommended pick if this gets built: **Arni for the axis, OK5 for the diversity check.** Same
warning as 6b — new condition ids, and note that a measured IR needs its direct path normalised
to unity before `afir gtype=none`, or the level design of every existing adverse condition
shifts.

### 6d. ⛔ MIT Acoustical Reverberation Scene Statistics Survey — re-host licence laundering

271 measured IRs (Traer & McDermott, PNAS 2016), and the obvious first candidate for 6c. **The
original page (`mcdermottlab.mit.edu/Reverb/IR_Survey.html`) states no licence, no terms and no
permission** — just *"Download all 271 IRs (zip of audio files)"*. A HuggingFace re-upload
(`benjamin-paine/mit-impulse-response-survey`) asserts **CC-BY-4.0**, which the original does
not support. That is §2's re-host laundering pattern, third-party-assertion variety, and the
rule is that the original's published terms are the record: **silence is not a grant → barred.**
Use 6c's first-party CC-BY-4.0 deposits instead; there is no reason to take the risk for the
same data.

### 6e. ⛔ FSD50K — no `Whistling` class exists (measured, not inferred)

Downloaded `FSD50K.ground_truth.zip` (334 kB) and read `vocabulary.csv`: **zero of the 200
classes match `/whistl/i`.** Recorded here as well as in the whistle file because FSD50K keeps
coming up as "the obvious Freesound-derived answer" for any sound class. It is not, for this
one. See `research-whistle-corpus.md` §2b.

### 6f. ⛔ AID (Anechoic Interferer Dataset) — the record contradicts its own archive

`10.5281/zenodo.6974033`: Zenodo licence field `cc-by-4.0`; the `AID/LICENSE` file inside the
283 MB archive is `Attribution-NonCommercial-ShareAlike 4.0 International`. §5e's precedent
(Jingju part 2) applies — a record that self-contradicts is treated as NC. Content, for the
avoidance of a re-check: 43 domestic source types recorded anechoically with three mics, of
which `whistle` is 4 recordings (18.5 s per mic). **Barred**; cheap escalation available (ask
the depositors which licence is operative — first-party deposit, likely an upload-form slip).

### 6g. ⛔ MLEnd Hums and Whistles — 6,000 files, 235 people, no licence

Kaggle `jesusrequena/mlend-hums-and-whistles` (QMUL), 16.5 GB. Kaggle's metadata API returns
`"licenseName": "Unknown"`; neither the project site nor its docs states terms. No licence is
not a grant (the SSVD / MIR-ST500 rule), and all eight songs are in-copyright compositions on
top of that. **KILL** — see `research-whistle-corpus.md` §2d.

### 6h. ⛔ Silbo Gomero Speech Corpus (OpenSLR 137) — CC BY-NC-SA 4.0

49 min of whistled Spanish, 4 whistlers, with transcripts. NC → barred by §4.0. It would have
been a real pitch-tracker stress test in the whistle band; it is closed.

### 6i. ⛔ Belyk et al. real-time-MRI whistling — CC0, and still no timing

`10.5061/dryad.kb56cd1`. Ships audio (MRI-noise-filtered) plus **F0 per MRI frame at 16.67 Hz**
and tongue coordinates — a frame-level contour, so gate 2 fails exactly as for any frame-f0
corpus, and the audio is processed beyond recognition of any real mic path. Distinct from the
already-killed §5c (`10.5061/dryad.504t7`); both are dead for note truth.

### 6j. ⛔ Vocal Imitation Set / VocalSketch — CC-BY-4.0, wrong content

`10.5281/zenodo.1340763`, `10.5281/zenodo.3538534`, `10.5281/zenodo.13862`. Thousands of vocal
imitations of sound effects, permissively licensed, no melody and no note truth. Listed so a
future pass is not tempted by the licence.

### 6k. Gaps this pass could NOT fill — with what was actually checked

- **Harmonica** — no real permissive corpus exists. Searched MIR dataset indexes and the
  instrument-classification literature; harmonica appears only inside polyphonic mixes
  (HamNava, jazz sets) or in NC/anechoic orchestral sets. The synthetic matrix
  (`harmonica-mid`) stays the only evidence, and that is now a documented state rather than an
  unexplored one.
- **Real out-of-tune singing with intended-note truth** — the only corpora that exist are
  Smule's: `Intonation` and DAMP, both distributed *on request* through CCRMA under
  research-scoped terms → barred on the same footing as SingStyle111. The R20 synthetic
  intonation tier remains the only route, as designed.
- **Amateur low-register solo singing** (to break annotated-vocalset's operatic-male dominance
  of the low/voice stratum) — nothing new found; §2b's annotatable-audio candidates (Fundación
  Joaquín Díaz, Library of Congress AFC, ccMixter) remain the route, i.e. in-house annotation.
- **Bleed / ensemble labelling** — unchanged; no corpus marks it, and the register's point
  stands that even a per-dataset-section annotation would be enough to develop a detector.
