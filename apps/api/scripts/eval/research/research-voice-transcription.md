# A voice-specific transcription flow (singing / scatting / humming) — research notes

> **Status of every proposal in this document — shipped, built-off, discarded, not pursued — is tracked in [`../RESEARCH-STATUS.md`](../RESEARCH-STATUS.md), which also lists where this text is now stale.** This file is kept as the record of the reasoning, not edited to match the code.

> ## ✅ IMPLEMENTATION STATUS (2026-08-08) — read this before acting on §10
>
> **V0 and V1 are built and shipped behind the voice profile.** The durable record of what
> was measured is the *2026-08 voice flow* section of [`README.md`](README.md); wherever this
> doc and that log disagree, **the log wins** (it is measurement, this is prediction).
>
> - **§10b (V0) — done.** Segmentation/decode options are on `PipelineProfile` and forwarded by
>   `RecordingPipeline.pitchOptions()`; `ProfileResolver.applyVoice()` exists on the `applyReverb`
>   template; routing is the score's instrument family plus an explicit `sourceKind` on the meta
>   frame; `run-eval.ts` now reports Molina split/merged/missed **and** the re-onset/transition
>   metric (`lib/onsetClasses.ts`, Yong's definition verbatim). The **articulated synthetic voice
>   (§6.1 / §9.2) is done too**: `lib/synth.ts` gained a phase-continuous articulated
>   synthesizer (plosive closure + burst / continuant dip / dark hum / pure legato vowel, with
>   scoops, 19-cent scatter and 11-cent drift) and four `voice-*` scenarios at one register.
>   Those legato scenarios are the only clips in the whole corpus that contain a genuine
>   re-onset.
> - **§10c (V1) — run, one at a time, eval-gated.** E1 shipped and is large:
>   **COnP 0.570 → 0.668 on held-out test** (+0.123 [+0.102, +0.144]), living in
>   `src/recordings/pipeline/voice-note-decoder.ts`. **Everything else is a measured null**
>   (E2 octave prior, E3 SiPTH guard, E5 voicing sweep; E4 boundary evidence is worth ~+0.005
>   and ships as part of E1's config), and so are two ideas this doc did not propose: an
>   in-decode re-onset transition with Ryynänen's accent, and a second cheaper price for wide
>   intervals. Each null is recorded in the log **with its reason**, and the reasons matter more
>   than the verdicts — two are nulls *because E1 removed the failure they targeted* (octave
>   errors are now 0.001; a mandatory-silence decode emits no contiguous ±1-semitone pairs for
>   the guard to act on), and one shows the split/merge trade sits on a **flat repair-time
>   frontier**, i.e. the remaining transition misses are the limit of pitch + energy rather than
>   a mis-set constant. Do not re-run any of them against this decode without reading the entry.
> - **The prediction this doc got most right:** §4's claim that the transition structure should
>   be mandatory-silence for articulated input. The sweep did not need to be told — at a
>   note-change cost ≥ 2.5 nats the direct jump is never taken, and every higher cost scores
>   identically. The decode converges on that structure on its own.
> - **The prediction it got most wrong (by omission):** nothing in §3–§4 anticipated that the
>   single largest effect would be **onset calibration** — a pYIN-style attack state enters
>   where the contour departs the previous note, a measured 52 ms before the annotated onset,
>   and correcting that constant is worth +0.15 by itself. Every other mechanism here is
>   second-order next to it.
> - **Corpus update (2026-08-08, acquisition policy):** the voice slice gained three REAL
>   corpora with real note truth — ESMUC (271 per-singer choral stems, manually corrected),
>   CSD (96 stem excerpts, hand-corrected per-section notes) and HUST_Solfege (73 solo
>   solfège recordings, MIT). See `research-voice-datasets.md` §policy for why the earlier
>   consent-archaeology blocks were removed. §6's "vocadito is the only fully clean real
>   corpus" is superseded.
> - **Routing update (2026-08-08): the audio classifier from §7 is BUILT, within policy.**
>   Not the YAMNet-embedding + logistic-head design (that fits weights, which D5 bars) but
>   the training-free alternative §7 itself named: thresholding YAMNet's **stock** class
>   scores. Measured 98.7 % decided / 11.8 % abstain on the 1,148 labeled real clips
>   (`probe-source-classifier.ts`); shipped in `profiles/source-classifier.ts`; the web
>   mic-source chip is removed and an abstention falls back to the score's instrument
>   prior. D5 is thereby moot for routing.
> - **Still open from §10:** the §10d external-checkpoint benchmark (Yong-2023, Omnizart),
>   decisions D1/D2/D3, and the §8 UX backlog.
>   The **re-onset channel remains the weakest part of the voice flow** — recall 0.389 against
>   the old segmenter's 0.461 — and §3.2's selective in-note SuperFlux splitter is the one
>   untried idea there. The in-decode Ryynänen accent was tried and is a null *because a
>   broadband envelope cannot discriminate*, which is an argument FOR the band-wise version, so
>   §3.2 is the right next move rather than a repeat.


Research notes, 2026-08-02. Scope: how to build a **dedicated flow for human-voice input** — the
syllable problem ("puh-duh" / "ta-da" / lyrics / humming), note-boundary evidence for voice, the
learned-note-model path, and voice-vs-instrument routing. Companions (this doc does not repeat them):

- `research-pitch-models.md` — f0 estimators, note-level SOTA tables, octave errors, licensing (P0–P5).
- `research-benchmarks.md` — eval corpora, metrics, tier structure, gating discipline (authoritative on eval).
- `research-daw-products.md` — product mechanisms and UX affordances.
- `README.md` Findings log — what we have **measured on our own harness**; wherever this doc conflicts
  with a measured result, the measurement wins.

Evidence tiers: **[P]** primary source read (paper PDF / source code / license file, URL given) ·
**[S]** secondary (review, README claim) · **[T]** thin (search summary, digitised figure) ·
**[X]** claim checked and NOT supported · **[M]** measured in our own harness (Findings log).

> ⛔ **POLICY (product owner, 2026-08-02): Mushee will never create or train its own model.**
> Not from scratch, not a retrain of a published recipe, not a fine-tune — nothing that involves us
> training model weights. **This is a permanent no-go; do not revisit or re-propose it.** Passages
> below that describe training recipes or training-data assembly are retained only as context for
> judging *other people's* models. A learned note model can enter the product exclusively by
> acquisition: an existing pretrained checkpoint used as-is (license permitting), a directly
> licensed checkpoint (§11), or a third-party API.

**In a hurry? §10 is the actionable plan**: §10a the four decisions → §10b tasks that can start
today → §10c the eval-gated experiment queue → §10d the one measurement that gates the big build.
**§12 is the code map** (files, commands, cache-bump invariants) for implementing §10 cold.
§1–§9 are the evidence behind each line of §10; §11 is the licensing analysis.

---

## 0. Executive summary

1. **The syllable problem is quantified, and it inverts the "make users sing vowels" idea.**
   Li et al. (NLP4MusA 2021) measured note-transcription F by lyric content on the same system:
   Spanish lyrics **0.709**, English **0.523**, /Na/+/La/ **0.520** — and on a corpus sung entirely
   on **/Ta/**, *plain voicing-based segmentation alone scored 0.645 and beat their full pipeline*,
   because a voiceless plosive delimits every note for free. **[P]** Consonants are boundary
   *evidence*, not noise; vowel-only singing is the **hardest** input. If we ever nudge users, the
   evidence-backed tip is the opposite of the vowels idea: *"if notes run together, try ta-ta-ta"*.
   No surveyed product hard-constrains articulation; all soft-guide (§8).
2. **Note onsets in voice come in two kinds and need different evidence.** Yong/Su/Nam (ICASSP
   2023) split onsets into **transitions** (pitch changes) and **re-onsets** (same pitch, new
   syllable/energy, ≤20 ms gap). Spectral/pitch features catch transitions; phonetic features catch
   re-onsets (re-onset recall 0.811 → 0.902 when swapping mel for a phonetic posteriorgram at
   matched architecture **[T — digitised from their Fig. 3]**). For wordless humming/scatting there
   is no phonetic channel — energy is the only re-onset evidence, which is what our
   `OnsetDetector` already implements (research-pitch-models §4g stands). The *new* cheap channels
   worth trialing are a **pitch-dip detector** and a **selective in-note flux splitter** (§3).
3. **The learned voice note model (Findings-log research direction #1) — acquisition only; we
   never build one (see policy note).** The acquirable candidates:
   (a) **Yong et al. 2023 is MIT-licensed *with* a downloadable checkpoint** — the July survey
   missed this. Best published numbers on the one benchmark that matches our users (ISMIR2014
   untrained singers: COnPOff **0.773** vs Tony 0.46) and directly models re-onsets. Benchmark it
   as an external reference immediately (like P3.8/omnizart); shippable only if its training-data
   chain clears (§11). **[P]**
   (b) **ROSVOT (ACL 2024)**: 12 M params, robustness trained-in via noise augmentation (COnPOff
   77.4 clean → 77.0 noisy), code MIT / weights NC-tainted — enters the product only if the
   checkpoint is licensed as-is from its holders (§11). **[P]**
   (c) **Klangio** sells an API for exactly this task, and their now-sourced JAES 2022 paper
   (note-F1 **74.19 %** on real non-professional recordings) is why the offer is credible. **[P]**
4. **Voice routing does not exist in the pipeline** (only register-based bands). In beta the answer
   is free: the score's instrument as a prior plus an **explicit user toggle** (§10b). An audio
   classifier (YAMNet embeddings + a tiny head, or its stock class scores) is post-beta polish and
   gated on D5; the binding constraint is the **1.2 s profile lock** (§7). **[S/P]**
5. **The single best contained code change remains the silence-state decode** (research-pitch-models
   P3.5), now with more support: Dynamic HumTrans's mechanism + Li's /Ta/ result both say that for
   articulated input, *silence between notes is the boundary signal*. Make the transition structure
   **profile-dependent** (mandatory-silence for hum/syllable input, jump-permitted for legato) (§4).
6. **Do not redo what we already measured.** The literature (and our agents) re-suggest several
   things the Findings log has already killed: the pYIN amplitude-ratio splitter (+0.001 here — our
   dip-then-rise already covers it) **[M]**, raising the min-note floor to 100–130 ms (−0.013 to
   −0.039 here) **[M]**, a *globally configured* note HMM (−0.06…−0.16) **[M]**, tuning-offset
   correction (hurts; truth is A440) **[M]**, and afftdn-style denoising **[M]**. Where this doc
   proposes HMM-family or tuning ideas, it is only in the **profile-gated** form that the measured
   diagnosis ("one global config cannot serve sustained vibrato and fast humming") actually calls for.

---

## 1. Mapping our failure modes to the literature's taxonomy

The user-visible failures map exactly onto Molina et al.'s error taxonomy (ISMIR 2014,
[PDF](https://archives.ismir.net/ismir2014/paper/000298.pdf); adopted for our harness per
research-benchmarks §7):

| Our symptom | Taxonomy | What the literature says |
|---|---|---|
| Long notes split into ±1-semitone fragments | **Split** + OBP | Universal on amateur voice: "all methods have problems with pitch bendings at the beginning of the notes, since they tend to split them" **[P]**. Our measured instance: annotated-vocalset ~0.45 COnP, **1.7× over-segmented** **[M]**. |
| Dropped notes | **ND** (+ PU for spurious) | Voicing errors dominate; our measured chain is reverb → CREPE *confidence* collapse → gate → fragmentation/drops **[M]**. Tune voicing for **low false-alarm**, not recall (P3.2) — but on the voice tier specifically. |
| Syllable-dependent artifacts | **re-onset / transition** miss + onset bias | Onset ground truth sits at the *vowel*, and voiceless consonants delay the pitch onset by tens of ms (Molina annotation rules; ROSVOT §3.4) **[P]** — so different syllables shift onsets relative to truth even when detection is "right". |
| Wrong-octave phrases | octave error at voicing onsets | Already diagnosed: our Viterbi band makes mid-phrase flips impossible; errors are born at voicing onsets under a uniform prior (research-pitch-models §3b-bis, P3.3 item 5) **[M/P]**. |

Two expert annotators agree at only COnPOff **0.64** on solo vocals and the automatic ceiling across
products/papers is ~**0.6–0.75** on amateur voice (research-pitch-models §2a; Klangio SingReal 0.742;
Li et al. 0.610) — the flow design below assumes correction UX absorbs the rest (§8), it does not
promise magic.

---

## 2. The syllable problem: consonants are evidence

### 2a. Li, Demirel, Proutskova & Dixon — NLP4MusA 2021 [P]

[Paper](https://aclanthology.org/2021.nlp4musa-1.4.pdf). Rule-based 3-step cascade, no training:
(1) voiced segments from pYIN; (2) split at phonetic changes — take the ASR phoneme alignment,
reduce to **vowel/consonant**, expand each inter-vowel region **±50 ms**, place the boundary at the
**argmax of spectral flux inside that window**; (3) Tony's note HMM *within* vowel regions only
(pitch-change threshold ⅔ semitone).

- Whole-pipeline ablation (Molina set): Steps 1+3 (no phonemes) COnPOff 0.520 → Steps 1+2+3
  **0.610**; **Merged errors 0.233 → 0.078 (~3× reduction)** — the phoneme step is what stops
  same-pitch syllables collapsing into one note.
- **Lyric-content spread** (COnPOff F, full system): Spanish **0.709**, English 0.523, /Na/+/La/
  0.520, mixed 0.596. The system's accuracy depends heavily on *what* the user sings.
- **The /Ta/ counter-result**: on the Dai et al. corpus (three tunes sung entirely on /Ta/),
  **Step 1 alone (voicing) scored 0.645**, beating the full pipeline (0.614) — each note is a voiced
  segment delimited by a voiceless consonant, so extra machinery only adds Split errors.

**Read for our users:** "puh-duh / teh-reh / ta-da" articulation — the thing the user flagged as an
unknown — is actually the *favourable* case, if our decode exploits inter-note energy dips/gaps
instead of fighting them. The hard cases are legato vowels, voiced continuants (/la/, /na/, /ma/),
and closed-mouth humming.

### 2b. Yong, Su & Nam — ICASSP 2023 (MIT, with weights) [P]

[Paper](https://arxiv.org/abs/2304.05917) ·
[code + pretrained model, MIT](https://github.com/seyong92/phoneme-informed-note-level-singing-transcription).
Two-branch CRNN: log-mel + **phonetic posteriorgram** (39 CMUdict phones; PPG net trained with
CTC + a mel-reconstruction loss to de-spike CTC), concatenated into a shared BiLSTM emitting
frame-wise onset/offset/activation (20 ms frames, triangular onset-label smoothing to 100 ms,
decode threshold 0.2). Note pitch = Hann-weighted **median** of pYIN f0 over the segment ("to
reduce the influence of the F0 near the boundaries, which are the most expressive part").

- ISMIR2014 (untrained adults + children, noisy): COn **0.9305** / COnP **0.8975** / COnPOff
  **0.773** vs Tony 0.66/0.60/0.46 and Omnizart 0.80/0.62/0.50. SSVD: COnPOff 0.830.
- **Re-onset vs transition** (their Fig. 3, digitised **[T]**): at matched architecture, PPG input
  lifts re-onset recall 0.811 → **0.902** and costs transition recall 0.837 → 0.784; fusing both
  keeps 0.907 / 0.827. This is the only quantified same-pitch-repeat result in the literature.
- Caveats: research-grade repo (torch 1.13, BPM CLI arg); **no noise augmentation** in training;
  PPG trained on TIMIT (**LDC-licensed** — redistribution/derivative terms need checking **[T]**)
  and models trained on SSVD/CSD whose terms are unstated/NC → treat the checkpoint as
  **benchmark-only** until its data chain is cleared with the holders (§11). Under the no-training
  policy there is no retrain escape hatch — what the checkpoint does on our clips is what we get.

### 2c. ROSVOT's word-boundary channel — lyrics not required at inference [P]

[Paper](https://arxiv.org/abs/2405.09940) · [code MIT](https://github.com/RickyL-2000/ROSVOT).
Constraint: *"the presence of a word boundary at timestep t implies the existence of a note
boundary at t, but the reverse may not hold true"* (melisma). Implementation: word-boundary
sequence as a conditioning input + post-hoc regulation (predicted note boundaries within **40 ms**
of a word boundary snap to it). Ablation: word boundaries are worth **+7.2 pp COnPOff** (70.2 →
77.4) — and a **learned word-boundary extractor recovers almost all of it (77.1)**, so the channel
works without lyrics at inference. Boundary decode details (from source **[P]**): sigmoid threshold
0.8 (CLI 0.85), runs collapsed to their prob-argmax, **90 ms minimum boundary gap** (merged to
midpoint), consecutive equal-pitch notes within a word merged.

### 2d. Others, briefly

- **SongTrans** (arXiv 2409.14619, no code) — ASR predicts note **count k per word**, then the top
  k−1 boundary probabilities within the word span become splits. A hard cardinality constraint from
  syllables; reimplementable for a future lyric mode. **[P]**
- **SOFA** ([MIT](https://github.com/qiuqiao/SOFA)) beats MFA on singing alignment (BER 20.9 vs
  40.3 on Chinese singing, STARS Table 1) — the forced aligner to use if a lyric mode ever needs
  one; **do not** use vanilla MFA on singing. **[P]**
- **STARS / VocalParse**: need lyrics/phonemes as input or 1.7 B GPU-class params — watch list,
  wrong shape for hum/scat input (research-pitch-models §2g stands). **[P]**

---

## 3. Note-boundary channels for the voice profile (DSP-now candidates)

Ordered by novelty to us; each is a **splitter, never a creator** (Tony's principle), and each must
be gated on the voice eval tier per research-benchmarks §7 discipline.

1. **Pitch-dip channel for steady-pitch re-onsets** — Kroher & Gómez
   ([TASLP 2016](https://arxiv.org/abs/1510.04039)) detect steady-pitch onsets with two deliberately
   separate detectors: a **local volume decay** (r_LOC < −10 dB against ±145 ms context; their code
   ships 6 dB — paper/code conflict flagged) and a **pitch-dip z-score** (z < −2 on the segment's
   cent contour; code 3.0), because "at a given onset either one or both … can be present". **[P]**
   Our dip-then-rise detector ≈ their volume channel. The **pitch-dip channel is new to us**: singers
   often drop pitch momentarily at a re-articulation even when RMS barely dips.
2. **Selective in-note flux splitter** — the CREPE Notes pattern
   ([arXiv 2311.08884](https://arxiv.org/abs/2311.08884)): pure f0 segmentation "structurally cannot
   split same-pitch repeats", so they run an onset detector **at a very high threshold (0.7), only
   inside notes that are already long and pitch-flat**, and re-segment there. **[P]** Their ODF is
   the Schlüter/Böck CNN — whose madmom weights are **CC-BY-NC** (⛔, research-pitch-models §4a) —
   so our model-free option is **SuperFlux** (BSD): 138 quarter-tone bands 27.5 Hz–16 kHz, µ=2 @
   200 fps, **max-filter ±1 bin** (a designed vibrato false-positive suppressor, −55…−61 % FPs on
   voice/strings), peak-picking pre_max 30 ms / post_max 30 ms / pre_avg 100 ms / post_avg 70 ms /
   combine 30 ms. **[P]** Solo-singing onset F for SuperFlux is only ~0.65 standalone — fine, since
   here it only votes inside already-suspicious regions.
3. **SiPTH sustained-deviation merge guard** — Molina et al.
   ([TASLP 2015](https://emilio-molina.github.io/publications/Molina-et-al.-2015-SiPTH-Singing-transcription-based-on-hysteresis-defined-on-the-pitch-time-curve.pdf)):
   only accept a pitch-motivated split when the deviation from the note's running mean exceeds
   **δ_th = 0.5 semitones** with accumulated area ≥ **Γ_th = 0.1 semitone·seconds** (≈ a full
   semitone held ~200 ms). Vibrato integrates toward zero area and never fires. **[P]** As a
   *post-decode merge guard* on adjacent ±1-semitone fragments (merge unless the boundary is
   justified by sustained area OR an energy/pitch-dip onset), this attacks our fragmentation mode
   from a direction we have **not** measured (distinct from the A-B-A folder, min-duration, and
   `mergeAdjacent`). Note pitch via **α-trimmed mean, α=0.3** (excludes scoops/tails) is their
   companion trick.
4. **Vibrato-robust contour handling** — Kroher explicitly *rejects* low-pass filtering the contour
   ("also affects the steep slopes which indicate a note change") in favour of (a) tracking the
   **upper envelope** of the contour (local maxima stay in a tight range under vibrato even when
   the contour swings a semitone; 80-cent threshold between adjacent envelope maxima), and (b) a
   **first-derivative Gaussian, σ = 43.5 ms** (≈300 ms support = one period of 4 Hz vibrato) as the
   interval-onset detector. **[P]** Citable constants if we revisit the smoother — but note our
   9-frame median at 20 ms hop is already in this regime and measured optimal **[M]**.
5. **What NOT to re-add** **[M]**: pYIN's amplitude-ratio splitter (measured +0.001 — the dip-rise
   detector already captures it); min-note floors of 100–130 ms (literature consensus, measured
   −0.013…−0.039 here because the 4-frame smoother already removes shorter runs); onset detection as
   the *primary* boundary signal (MIREX solo-singing onset F ≈ 0.56–0.62 vs >0.95 percussive —
   reconfirmed with per-class tables **[P]**).

---

## 4. Decoding: the silence-state Viterbi, profile-gated

Research-pitch-models P3.5 is the centrepiece contained change; this pass adds evidence and one
design refinement.

- **Mechanism** (Dynamic HumTrans, [arXiv 2410.05455](https://arxiv.org/abs/2410.05455)): add an
  explicit **silence/rest state** to the decode state space and make transitions structurally
  sparse — `note n → n`, `n → silence`, `silence → any`. On humming this decode (plus domain
  training) is the difference between basic-pitch's 0.268 and their 0.651 octave-aware F. **[P]**
- **New supporting evidence**: Li's /Ta/ result (§2a) — voicing alone hits 0.645 when articulation
  guarantees gaps — is exactly the regime where a mandatory-silence transition is correct. ROSVOT's
  resolution ablation (10.7 ms → 85.3 ms boundary step = **+6.7 COnPOff**) says decode boundaries
  should be *coarse*: ~80 ms is the true articulation/label uncertainty (P3.6 stands). **[P]**
- **Profile gating** (the refinement): the transition structure must differ by articulation —
  **hum/syllable profile**: `n → m (m≠n)` forbidden outright (every note change passes through
  silence; the energy dip *is* the boundary); **legato-voice profile**: `n → m` allowed with the
  existing jump cost (vibrato absorbed by the pitch-band, scoops by an attack-tolerant entry).
  Which profile applies can itself be estimated from the first seconds (density of RMS dips below
  the voiced floor) or simply swept per-recording and picked by decode likelihood.
- **Reconciling with the measured HMM dead end** **[M]**: `note-segmenter.ts` lost globally
  (−0.06…−0.16) with *one* config across all material — and the Findings log's own diagnosis was
  that sustained vibrato and fast humming need different change costs. A voice-routed profile is
  precisely the setting where the HMM family gets a second, *fair* test: attack/stable σ asymmetry
  (pYIN: attack σ = 5 st, stable σ = 0.8–0.9 st — the published scoop/portamento absorber **[P]**),
  silence state, and per-profile costs. Test it **only under the voice profile**, never re-litigate
  the global config.
- **Octave prior at voicing onsets** (P3.3 item 5) rides along: seed frame-0/post-silence priors
  from the session register estimate instead of uniform. Ryynänen's **accent feature inside the
  attack state** (band-wise spectral energy rise as an emission feature — the original published
  same-pitch-repeat mechanism, SAPA 2004 **[P]**) is the natural way to let energy evidence enter
  the same decode rather than remaining a separate post-pass.

---

## 5. Tuning drift and key-aware snapping

- **Drift is smaller than assumed**: Mauch, Frieler & Dixon (JASA 2014,
  [PDF](https://www.eecs.qmul.ac.uk/~simond/pub/2014/JASA_136_1_401_1.pdf)) — unaccompanied singers'
  median note error **19 cents**, but whole-performance drift averages only **11 cents** and is
  significant in just 22 % of recordings. **[P]** Per-note scatter, not drift, dominates — consistent
  with our measured result that tuning-offset correction *hurts* against absolute-pitch truth **[M]**.
  Keep drift correction off the eval-driven path.
- If a tuning reference is ever needed (e.g., display-layer cents), the citable estimator is
  **Dressler & Streich's circular mean** (ISMIR 2007): per-frame deviation mod 100 cents → unit
  vectors → `Δc = (100/2π)·arg(z̄)`, with `|z̄|` as a free confidence measure; quantization-free
  and 20 lines of code. **[P]**
- **The product-shaped lever is key-aware snapping, and we hold the key.** Every surveyed product
  snaps only to a **user-declared** scale (research-daw-products §18.12); our users record *into a
  score with a key signature*. An opt-in "snap to key" for notes landing 40–60 cents between
  semitones is a UX feature, not an eval-gated pipeline change (the eval's absolute truth cannot
  reward it). Route to the product track (§8).

---

## 6. The learned voice note model — candidates, licenses, data

The Findings log already concluded the remaining singing headroom is a learned note model
(supervised systems reach ~0.80 COnP@50 ms where we reach 0.49@100 ms zero-shot on N20EMv2) **[M]**.
⛔ **Per the policy note at the top of this doc, we will never train one ourselves — every row
below is evaluated purely as something to *acquire* (checkpoint as-is, licensed weights, or API);
recipe details are context for judging vendors, not build instructions.**

| Candidate | What it is | Amateur-voice evidence | License (code / weights) | Verdict |
|---|---|---|---|---|
| **Yong et al. 2023** | 2-branch CRNN, mel+PPG, tiny | ISMIR2014 COnPOff **0.773**; re-onset modelling | MIT / **MIT checkpoint published** (training data terms unclear: SSVD unstated, CSD-reannot. NC-adjacent, TIMIT=LDC) | **Benchmark as-is now** (external reference, like P3.8). Shippable only if the data chain clears (§11, KAIST/LDC/HUST) — no retrain escape hatch under the policy. |
| **ROSVOT** | U-Net + Conformer boundary head + attention pitch decoder, 12 M | COnPOff 77.4→**77.0 under noise** (MUSAN aug is the mechanism: w/o it 76.4→70.1); OOD honesty: MIR-ST500 47.4, TONAS 30.0 — domain data matters | MIT / ⛔ NC (M4Singer + proprietary) | **Ship-as-is candidate only if the checkpoint is licensed** (§11, Zhejiang). Mandarin bias cannot be fine-tuned away (no-training policy) — the §10d benchmark must test the released checkpoint on our clips before any money moves. |
| **Klangio DTMST** (JAES 2022) | **two small nets** (onset + pitch), trained on **synthetic singing**, eval'd on real amateurs ("SingReal") | note F1 **74.19 %**, ≥3.5 pp over all SOTA tested | [code exists](https://github.com/klangio/dtmst), license unverified **[T]** | Context: this is why **Klangio's API** (the buy route, §11) is credible on amateur voices. |
| Dynamic HumTrans | basic-pitch-family CNN + silence-state DP | 0.651 octave-aware on humming | no license / weights not released / data NC | Take the decode idea (§4); ignore the artifact. |
| Omnizart vocal | VOCANO re-impl | ISMIR2014 COnPOff ~0.50 | MIT | External benchmark only (P3.8 stands). |

**Data strategy — under the no-training policy these corpora serve *evaluation only*** (they
remain essential: acquired models must be judged on our input distribution, and research-benchmarks'
"don't touch NC data" stays binding, including HumTrans):

1. **Synthetic articulated singing** — the Klangio-validated path. Our `lib/synth.ts` voice proxy
   is a *continuous* 3-formant vowel: it has **no articulation**, so neither training data nor the
   synthetic eval tier currently exercises re-onsets at all. Add a syllable model (voiceless-gap +
   burst for /ta,pu/; nasal/lateral amplitude-dip-without-gap for /la,na,ma/; none for hum), plus
   scoops into notes, per-note pitch scatter (~19 cents, §5), and drift — then reuse `lib/degrade.ts`
   for the adverse variants. Closes the re-onset eval gap (any training use is void per policy).
2. **vocadito** (CC-BY-4.0) — already fetched; the only fully clean real corpus.
3. **Self-collected corpus** via the HumTrans protocol (sing along to a played reference on
   headphones → self-labelling), lag-corrected — research-pitch-models P0.6 stands; stratify by
   articulation class: plosive syllables / voiced continuants / vowels-only / lyrics / closed-mouth
   hum (Li's Table 3 is the reason — the spread across these classes is up to 19 pp **[P]**).
4. **Consented user recordings** (T4 golden tier, research-benchmarks §7) — the archiving
   machinery exists (`recording-archiver.ts`), **but as of 2026-08 the product is in beta with a
   handful of users at 1–2 recordings each: there is no usable volume, and passive accumulation is
   months away.** Two consequences: (a) bake data-use consent into the **beta terms now** — free to
   do pre-launch, expensive to retrofit after; (b) don't wait passively — run **active collection**
   with the beta community: guided "sing these melodies" sessions (the HumTrans self-labelling
   protocol, P0.6) pointed at our own users. A dozen cooperative beta users singing 20 prepared
   melodies each in their real rooms beats months of passive archive growth.
5. ~~Pseudo-labeling at scale (the VocalParse/SingCrawl recipe)~~ — **void under the no-training
   policy**; kept only so nobody re-researches it.

**Deployment shape:** a 12 M-param PyTorch model fits the existing gRPC pattern (the `ModelBackend`
seam — touchpoints enumerated in §12c) or, if exportable, ONNX in-process via `onnxruntime-node`
(the SwiftF0 precedent from P1). No published CPU RTF for any note-level model **[P — absence]**;
measure before committing to CPU-only serving.

---

## 7. Routing: the voice/instrument classifier and the profile seam

- **Nothing exists today**: routing is register-based (`PROFILE_BANDS`); `SourceKind` lives only in
  the eval harness. The noise classifier is telemetry-only and documented as "the wrong trigger".
- **Free prior**: the score's instrument (the app already keys `instrument-ranges.ts` hints by
  instrument id; `voice-lead` exists). Not sufficient alone — users will sing a line into a piano
  score — but it should bias the decision.
- **Audio classifier** (⚠️ **post-beta, and gated on D5** — fitting even a logistic head is training
  weights, which the policy note bars as written; beta ships an explicit user toggle instead):
  **YAMNet embeddings (Apache-2.0, MobileNetV1, 3.7 M params, ~0.1 s CPU per 2 s audio) + a tiny
  logistic head** on a few hundred labeled clips **[S/P]** — better than raw AudioSet class scores,
  far cheaper than PANNs/CLAP, stronger than MFCC+RF (~0.82 acc in the lightweight-SVD literature
  **[T]**). Falls within the existing 1.2 s profile-lock budget (YAMNet windows are 0.96 s); on low
  confidence, fall back to `default-wide` exactly as the unvoiced-scan path does today. A
  training-free alternative if D5 says no: threshold YAMNet's **stock** AudioSet
  Singing/Humming/Speech vs instrument class scores, no fitting involved.
- **Plumbing gap (must precede everything in §3–4)**: `PipelineProfile` cannot express segmentation
  choices — `segmentMode`, `smoothFrames`, decode flags exist on `PitchTranscribeOptions` but are
  not on the profile and not forwarded by `RecordingPipeline.pitchOptions()`. Add the fields +
  forwarding + a `voice` band family (an `applyVoice()` in the resolver, following the graded
  `applyReverb` template). Re-resolving the profile on the final pass (already flagged in
  `profile-resolver.ts`) matters more once routing decides more than a frequency window.
- **Whistling stays out of scope** for the voice flow: it is a genuine literature gap with opposite
  needs (P3.4 stands — band-limit C5–C8, ACF-family, no real test data).

---

## 8. What products do about imperfect voices (delta to research-daw-products.md)

New primary material this pass **[P unless noted]**:

- **Klangio DTMST retrieved** (§6) — the "only profitable company in our market" trains small
  dual-task nets on synthetic voices and expects an Edit Mode to absorb the rest.
- **imitone devlogs**: even the resonator-DSP purist added an ML tracker specifically "better at
  capturing brief notes … better in rooms with reverberation"; ships an explicit *interpretation*
  layer above the raw tracker (Hold/Lock slide modes = "change notes only when pitch stabilizes");
  prescribes **syllables per instrument preset** ("daah" keys, "dooh" plucked, "waah" trombone).
- **Dubler 2**: ~30 s per-user calibration (range + timbre) seeds its tracker — the analogue of our
  pitch-scan profile, but user-blessed; a **Stickiness** slider is literally a user-facing
  split/merge control; scale-lock + "sing in notes to suggest a key".
- **ScoreCloud**: officially tips "singing with **da-de-dum** etc. is easier … than lyrics"; no
  metronome needed but listens for a *foot stomp* as a beat cue; flagship correction UX is
  **audio-vs-MIDI A/B playback** ("far more efficient than reading the notation").
- **Answer to the "impose behaviour" question**: no product imposes; all soft-guide (quiet room,
  headphones, syllable *tips*). The measured evidence (§2a) says the one constraint with real
  payoff is *plosive syllables*, which users largely do naturally — and which our decode currently
  ignores rather than exploits. **Vowels-only would be counterproductive.** Constraint policy:
  exploit articulation in the decode first; ship a one-line tip second; impose nothing.

Product-track backlog distilled from this (not eval-gated): opt-in key-snap from the score's key
(§5) · split/merge sensitivity as a user slider (NeuralNote naming) · live pitch feedback while
recording (SOS: users learn to "sing as if Auto-Tuned" within minutes) · A/B playback of recording
vs transcription · the "ta-ta-ta" tip in the recording UI · optional 30 s voice calibration seeding
the profile.

---

## 9. Eval additions specific to voice (delta to research-benchmarks.md)

research-benchmarks §7 (tiers, Molina taxonomy, Amax scoring, both tolerances, bootstrap gating,
"don't touch NC data") is authoritative and already covers most needs. Voice-flow deltas only:

1. **A re-onset/transition subset metric** — adopt Yong et al.'s definition verbatim (onset ≤20 ms
   after previous offset; same pitch = re-onset, changed pitch = transition) and report recall per
   class. Nobody publishes COnPOff conditioned on repeats; this is the metric that will actually
   show whether §3's channels work. Verified absent from the harness (2026-08-02: no
   re-onset/transition concept anywhere in `scripts/eval/lib/`). **[P definition]**
   ⚠️ **Do not rebuild what exists**: `lib/segErrors.ts` **already implements** Molina's
   split/merged/missed/spurious taxonomy (overlap-based, pitch-agnostic matcher, plus
   `repairSecondsPer100` weighting by the Tony correction-time study) — research-benchmarks §7's
   "Split and Merged are the two we lack" is **stale**. The real gap is that it is wired only into
   `sweep-segmenter.ts`, **not into `run-eval.ts`** — so our headline runs do not report the very
   split/merge counts this whole project targets. Wiring it in is a cheap prerequisite for §10c.
2. **Articulation-stratified fixtures**: synthetic tier gains a syllable model (§6 item 1 — today's
   "ah"-vowel proxy cannot produce a re-onset at all); self-collected/golden clips labeled by
   articulation class (plosive / continuant / vowel / lyrics / hum).
3. ~~**ISMIR2014/Molina mirror-chase stays open**~~ — **⛔ CLOSED 2026-08-08: non-commercial
   licence.** Chased to the primary source; the dataset README states the audio, transcriptions and
   annotations are "for non-commercial use only" and non-redistributable, which puts it in the same
   barred class as HumTrans. It would indeed have been the best-matched external testbed (38
   untrained singers incl. children, noisy) and that is exactly why it is worth recording as closed
   rather than leaving it to be re-discovered. See research-benchmarks §"Explicit gaps" for the
   full evidence chain. **[P — primary source, the dataset's own readme.txt]**
4. **HumTrans**: research-benchmarks' "don't touch NC data" stands (it is stricter than
   research-pitch-models' "legal judgement call" — follow the stricter doc). Humming evaluation
   comes from the self-collected corpus and active beta-community collection (§6 item 4) — the
   passive T4 golden set has no volume during beta.

---

## 10. Actionable plan

Organized by who acts: §10a decisions (product owner) → §10b tasks that can start today →
§10c the eval-gated experiment queue → §10d the measurement that gates the big build.

**Beta-context note (2026-08-02).** The product is in beta: a handful of users, 1–2 recordings
each, nothing truly live. This shifts the plan in four ways. (1) **No user data exists** — every
data-dependent line below (classifier training, golden eval tier, eval corpora) runs on
synthetic + self-recorded + actively-collected beta-community audio instead of a passive archive.
(2) **Consent is nearly free right now** — data-use consent goes into the beta terms before launch
(D2), instead of being retrofitted onto a live product. (3) **Restructuring is cheap** — no live
traffic means the voice flow can be built properly rather than bolted on (e.g. if E1 wants it,
finally split segmentation out of the providers and drive it from the `PitchTrack` type that exists
for exactly that; the SwiftF0 ops swap from P1 is also cheapest now), and
recording-UX guidance (tips, live pitch feedback, an explicit "voice/instrument" toggle) can be
trialed on beta users without churn risk — moving parts of the V3/§8 backlog earlier. (4) The
**2AFC human panel** (research-benchmarks T5) has no user pool yet — team-level listening tests
substitute during beta.

### 10a. Decisions needed (nothing below §10b blocks on these)

| # | Decision | Options → consequence | Blocks | Default until decided |
|---|---|---|---|---|
| **D1** | Pursue direct licenses? (§11) | Yes → cheap emails + TIMIT purchase; existing checkpoints (ROSVOT, Yong) become shippable **as-is**. No → the only learned-model route left is a vendor API (Klangio), else the DSP ceiling stands. Building/training our own is a permanent no-go (policy note) — this decision is purely about *acquisition* | the learned-model route only | send the cheap emails, commit nothing |
| **D2** | Put data-use consent in the **beta terms now** (+ optionally a guided "help us improve" recording flow for active collection, §6.4) | Pre-launch this is a terms edit; post-launch it becomes a migration/consent-UX project. Payoff is deferred but compounds from day one | the golden **eval** tier + model-selection evidence (not training — policy) — months from now | consent ships with beta terms; active collection when §10d says a model is worth acquiring |
| **D3** | V2 serving shape/budget | New inference sidecar on GKE (Autopilot bills per pod request 24/7) vs ONNX in-process | V2 deployment only | decide after the §10d measurement |
| **D4** | UX backlog priority (§8): key-snap from score key, split/merge slider, live pitch feedback, A/B playback, "ta-ta-ta" tip, optional calibration | apps/web track, independent of the pipeline | nothing | parked |
| **D5** | Exact scope of the no-training policy: does "never train weights" also bar a **tiny classifier head** (e.g. logistic regression on frozen YAMNet embeddings for voice-vs-instrument routing, §7)? As written it does | the post-beta audio router only — beta uses an explicit toggle instead, so nothing is blocked now | policy read literally: **no**, so no classifier head |

### 10b. Start now — no decision needed, no license risk (V0)

| Task | Where | Size | Done when |
|---|---|---|---|
| Plumb segmentation/decode options through the profile | `profiles/pipeline-profile.ts` (new fields) · `recording-pipeline.ts` `pitchOptions()` (forward them) · `profiles/profile-resolver.ts` (`applyVoice()` on the `applyReverb` template) | S | a `voice` profile can select decode mode + gates end-to-end |
| Route on the score's instrument | resolver consumes the existing instrument hint; Voice family → voice profile | XS | voice-lead scores hit the voice profile |
| Report split/merge in the headline run | `lib/segErrors.ts` already implements Molina split/merged/missed/spurious but is wired **only** into `sweep-segmenter.ts` — wire it into `run-eval.ts` (§9.1) | XS | every eval run prints split/merged/missed + repair-seconds |
| Re-onset/transition metric (genuinely new) | `scripts/eval/lib/metrics.ts` (or extend `segErrors.ts`); Yong definition verbatim (onset ≤20 ms after previous offset; same pitch = re-onset) | S | per-class recall in every eval run |
| Articulated synthetic voice | `scripts/eval/lib/synth.ts` + `generate.ts`: plosive gap+burst (/ta,pu/), continuant amplitude dip (/la,na,ma/), hum = none; onset scoops; ~19-cent per-note scatter (§5) | M | synthetic tier produces re-onsets; fixtures regenerated (bump both `CACHE_VERSION`s) |
| Routing for beta: score instrument + explicit toggle | With a handful of beta users, an explicit "what are you recording?" source choice in the recording UI (defaulted from the score's instrument) is acceptable and 100 % accurate — beta is exactly when adding a required control is free. The YAMNet-embedding audio classifier (§7) is **deferred to post-beta polish** — and note fitting even a tiny logistic head is *training weights*, so it needs the D5 ruling first | S | voice recordings reliably reach the voice profile in beta |

### 10c. Experiment queue (V1) — one at a time, eval-gated

House rules apply (Findings log + research-benchmarks): tune on `EVAL_SPLIT=dev`, confirm on
`test` once; paired-bootstrap CI must exclude 0; <1 pt is not a result; sub-10-pt changes route to
the 2AFC panel before shipping; decoder changes bump `CACHE_VERSION` in both caches. Score on the
voice slice (annotated-vocalset + vocadito + articulated synth), gate on no regression elsewhere.

| # | Experiment | Targets which failure | Where | Kill if |
|---|---|---|---|---|
| **E1** | Silence-state sparse Viterbi; transitions profile-gated — mandatory-silence (hum/syllable) vs jump-permitted (legato) (§4) | fragmentation + re-onsets (the measured 1.7× over-segmentation) | `providers/pitch-decoder.ts` + profile flag | no CI-positive delta on the voice slice |
| **E2** | Octave prior at voicing onsets, seeded from the pitch-scan register | wrong-octave phrases | frame-0/post-silence prior in `pitch-decoder.ts` | octave-error rate unmoved |
| **E3** | SiPTH sustained-deviation merge guard (δ=0.5 st, Γ=0.1 st·s) (§3.3) | ±1-semitone fragment chains | note post-pass (`note-extractor.ts` or decoder post) | Split↓ but COnP↓ |
| **E4** | Pitch-dip channel + high-threshold SuperFlux, applied only inside long pitch-flat notes (§3.1–3.2) | missed re-onsets ("la-la-la" on one pitch) | `onset-detector.ts` + fusion point | re-onset recall unmoved, or Split↑ |
| **E5** | Low-false-alarm voicing sweep on the voice profile (P3.2) | spurious + dropped notes | profile gates via existing eval env vars | — (pure sweep) |

### 10d. The V2 gate — measure before deciding to acquire

Benchmark **Yong-2023** and **Omnizart vocal** as external references on our voice slice (run in
Docker, score their note output with our harness — one afternoon each). This is the number that
turns D1/D3 from taste into arithmetic: **if a checkpoint beats our best V1 configuration by
>5 pts on real amateur clips, that is the go signal for *acquiring* a model — we never build one
(policy note).** D1 then picks the acquisition route — clear the winning checkpoint's encumbrances
(Yong via KAIST/HUST/LDC, ROSVOT via Zhejiang, §11) or trial a vendor API (Klangio, batch mode) —
and D3 picks the serving shape (ModelBackend sidecar vs ONNX in-process). If nothing clears and
the API is unacceptable, **V1 + UX guidance is the accepted ceiling** — that is a legitimate
outcome, not a failure state.

**Side experiment (bounded, kill-by-default, anytime):** the reverb oracle gap (+0.14/+0.23) remains open;
the only two front-ends worth one trial each are **DeepFilterNet3 with observation-adding**
(mix ~0.7 enhanced + 0.3 raw — the artifact literature's mitigation: artifacts, not residual noise,
are what hurt downstream models **[P, Iwamoto 2022]**) on wind/babble, and **nara_wpe** (WPE, MIT,
linear-prediction dereverb → fewer nonlinear artifacts) on the reverb tier. The literature predicts
both lose to a noise-trained estimator (RMVPE-class); kill unless they beat it. No published
with/without-dereverb transcription benchmark for singing exists **[P — absence]**.

---

## 11. If license issues could be resolved directly with the holders

Assumption for this section: any NC/unstated-license asset can be cleared by negotiating with its
rights holder (a direct license supersedes the public CC terms, including the ShareAlike clause).
Grouped by **counterparty**, because several assets share one:

| Counterparty | Assets unlocked | What it buys us | Ask difficulty |
|---|---|---|---|
| **JKU Linz (Widmer)** — the madmom LICENSE *explicitly invites* commercial-licensing contact (gerhard.widmer@jku.at) **[P]** | madmom pretrained onset CNN/RNN (+ beat/downbeat models) | The best published onset detector (F = 0.903 Böck set) as the learned third boundary channel — the exact ODF CREPE Notes uses for its in-note splitter — without training one ourselves | **Lowest** — the invitation is in the license text |
| **Zhejiang University (Zhao's lab)** — one counterparty for both | **M4Singer** (CC-BY-NC-SA) + thereby the **ROSVOT checkpoint** (and STARS lineage) | Under the no-training policy this is **the** main route for a learned note model: license the checkpoint and ship it **as-is**. Mandarin bias cannot be fine-tuned away, so §10d must benchmark the released checkpoint on our clips *before* any money moves | Medium (academic, active lab) |
| **KAIST (Nam's lab)** + LDC + HUST | **Yong-2023 checkpoint's** training-data chain: CSD (KAIST, same lab), **TIMIT** (LDC — a *purchase*, not a negotiation), **SSVD** (HUST, unstated) | The best amateur-voice model (ISMIR2014 COnPOff 0.773) goes from benchmark-only to shippable **as-is** (no retraining under the policy — what the checkpoint does on our clips is what we get; note it lacks noise-augmented training) | Medium (three parties, but TIMIT is just money and CSD/Yong share a lab) |
| ~~**Tencent ARC Lab**~~ | ~~**HumTrans**~~ | ⛔ **DELETE THIS ROW (2026-08-08).** HumTrans is not merely NC-barred, it is **quality-disqualified**: Dynamic HumTrans §1.2 confirms its onsets/offsets are unaligned self-labelling *"without any post-processing"*, and its own baseline table shows four SOTA transcribers scoring F1 2.7–6.7 — the signature of broken labels, not of bad models. Even free permission would buy a corpus we cannot score against. See research-voice-datasets.md §4.1 | — |
| **NYU/MARL (MedleyDB)** | **MDB-stem-synth** (CC-BY-NC; ⚠️ the "known commercial-licensing contact route" claim was **checked 2026-08-08 and is NOT supported — re-marked [X]**: the only contact is one researcher's personal academic address, given in a *republication* paragraph, not a licensing offer. See research-voice-datasets.md §4.4) | **Moot under the no-training policy** (its value was training-side). The CREPE-tiny weight-provenance open item is instead resolved by swapping to a clean pretrained model (SwiftF0, P1) | — (drop from the shortlist) |
| **RMVPE parties** (Dream-High authors / yxlllc fork / MIR-1K + PTDB holders) | The shipped **RMVPE checkpoint's** provenance | P2 (RMVPE as the noisy-voice f0 provider: pub-noise 0 dB 86.3 RPA vs CREPE 61.2). Only **artifact-level** clearance helps — the "just retrain it from the Apache-2.0 code" escape hatch is void under the policy | Messy multi-party; if the artifact can't be cleared, RMVPE is out |
| **GTSinger / Opencpop holders** | 80 h multilingual + Mandarin pro corpora | **Moot under the no-training policy** | — (drop) |

Two cheaper variants of the ask worth knowing:

- **Benchmarking-only permission** is a much smaller ask than train-and-ship rights, and unlocking
  HumTrans/MDB *for internal eval only* would already relax research-benchmarks' "don't touch NC
  data" rule where it hurts most (humming has no other benchmark).
- **Buy instead of build**: Klangio sells a transcription API (Sing2Notes is our exact use case),
  and DoReMIR has done B2B licensing. Under the no-training policy this is one of only **two**
  remaining routes to a learned model (the other: licensed checkpoints above). Counterarguments
  stand: it breaks our streaming architecture (live score updates during recording; their APIs are
  batch), adds per-recording cost and a competitor dependency, and sends user audio to a third
  party. A batch-mode trial is justified only if §10d shows a large gap and no checkpoint clears.

**What licensing cannot buy, at any price:** a corpus of *amateur, noisy-phone, arbitrary-syllable*
recordings (every clearable corpus is pro/clean/Mandarin or humming-by-music-students) — the T4
golden set and the articulated-synthetic generator stay on the critical path regardless; whistling
data (none exists); and the correction-UX work (the ceiling stays ~0.75–0.8 even with every asset
cleared). V0/V1 are also unaffected — they were never license-blocked.

**Negotiation shortlist if we only send three emails (no-training policy applied):** JKU (madmom
onset models — explicit invitation), Zhejiang (the ROSVOT checkpoint **as-is** — the main
learned-model route), KAIST/HUST (clears the Yong checkpoint; plus the LDC TIMIT purchase, which
is just a checkout flow). Tencent/HumTrans drops to a benchmarking-only ask, whenever convenient.

## 12. Implementation orientation (for whoever picks this up cold)

Verified against the tree on 2026-08-02. `apps/api/scripts/eval/README.md` remains the operational
doc (how to run, corpora, env vars) and the Findings log; this section is only the voice-flow map.

### 12a. Files you will touch, and what each does today

| Path (under `apps/api/src/recordings/pipeline/`) | Role | Why it's in scope |
|---|---|---|
| `recording-pipeline.ts` | session orchestrator: 1 s debounce passes, profile lock, streaming decode, commit watermark, measure emission | `pitchOptions()` is where profile→decode options must be forwarded (§7 plumbing gap); `resolveProfile()` runs **once** after ≥1.2 s of audio and is never revisited — any voice routing must decide from that prefix or the pipeline must re-resolve on the final pass |
| `profiles/pipeline-profile.ts` | `PipelineProfile` type + `PROFILE_BANDS` table + global clamps | add the voice band family and the segmentation/decode fields (the table is documented as the thing tuning edits; the rest of the pipeline never forks) |
| `profiles/profile-resolver.ts` | band routing + graded adaptations | add `applyVoice()` following the existing `applyReverb()` template (graded ramp + `id` suffix, not a binary switch) |
| `profiles/pitch-scan.ts` | coarse register scan, also emits `snrDb`/`noisiness`/`harmonicityMedian` | the prefix features a routing decision can reuse; also the register estimate for the octave prior (E2) |
| `providers/pitch-decoder.ts` | shared frame→note math: `viterbi`, `localCentsFromPath`, `segmentNotes`, `segmentNotesBySemitone` | **E1/E2 live here** (silence state, sparse transitions, onset priors) |
| `providers/crepe-provider.ts` | CREPE trajectory provider + its `SEGMENT_OPTS` defaults | the shipping segmentation defaults it passes to the decoder |
| `providers/pitch-provider.ts`, `provider-registry.ts` | the provider seam (a new *algorithm*) | only if a voice flow needs its own provider rather than a profile variant |
| `providers/model-backend.ts` + `local-`/`remote-`/`composite-`/`create-model-backend.ts` | the forward-pass seam (a new *model/service*) | §12c, only if an acquired model ships |
| `note-extractor.ts` | post-processor: `clean()` (selectMonophonic → filterPitchOutliers → suppressTransients → adaptive floor → mergeAdjacent → splitAtOnsets) then `quantize()` | **E3** (SiPTH merge guard) belongs here or immediately after the decoder; note the trajectory path already disables `pitchOutliers`+`merge` and sets `adaptiveFloorFraction 0.3` **[M]** |
| `onset-detector.ts` | RMS envelope + dip-then-rise re-attack detector (10 ms hop, `minIoiSec` 0.09, dipRatio 0.5, riseRatio 1.8) | **E4** adds the pitch-dip channel and the selective in-note flux splitter alongside it |
| `note-segmenter.ts` | pYIN-style note HMM, **not on the shipping path** — kept for its measured diagnosis | the starting point for E1's HMM-family variant; re-test **only** under the voice profile (§4) |
| `audio-converter.ts` | provider-agnostic PCM→notes; picks the per-provider `NoteExtractor` cleanup set (branches on `hasNativeOnsets`) | where a voice-specific cleanup set would be selected |

Eval side (`apps/api/scripts/eval/`): `run-eval.ts` (headline runner), `lib/metrics.ts` (COnP@±100 ms
headline + timing stats), `lib/segErrors.ts` (Molina split/merged/missed/spurious — **exists, not
wired into `run-eval.ts`**), `lib/notation.ts` (beats-domain rhythm metrics), `lib/split.ts`
(dev/test split grouped by performer), `lib/synth.ts` (+`generate.ts`) for synthetic voices,
`lib/degrade.ts`+`lib/acoustics.ts` for the adverse tier, `sweep-segmenter.ts` (drives
`note-segmenter.ts` from a `PitchTrack` — the existing harness for decoder experiments).

### 12b. Commands and invariants

- Run: `pnpm --filter @mushee/api eval:run` · regenerate fixtures: `pnpm --filter @mushee/api eval:generate`
  (needs `fluidsynth` + the gitignored soundfont via `./fetch-soundfont.sh`). Other scripts:
  `pnpm --filter @mushee/api exec tsx scripts/eval/<script>.ts`.
- **Any change to the decoder, resolver, or CREPE decode must bump `CACHE_VERSION` in *both*
  `lib/trackCache.ts` and `lib/variantCache.ts`** (or delete the fixture cache dirs) — otherwise you
  will measure stale tracks and conclude nothing changed.
- `EVAL_SPLIT=dev` for all tuning, `test` once to confirm. `mir-qbsh` and `n20emv2-test` are
  excluded from pooled tuning **in code** — do not opt back in.
- Headline metric is **COnP @ ±100 ms, no offset gate** — not comparable to published COnPOff.
- Statistical floor: per-clip σ ≈ 0.20–0.28, paired ρ ≈ 0.98–0.99 → **nothing under ~1 pt is a
  result**; sub-10-pt changes route to a human listening comparison before shipping.

### 12c. If an acquired model ever ships (the `ModelBackend` seam)

The seam is currently model-specific (`crepePredict`, `basicPitchForward`), so a third model means:
`packages/inference-proto/inference.proto` (new service + messages; regenerate Python stubs via
`generate-python.sh`) → `model-backend.ts` (`ModelKey` + method) → `local-model-backend.ts` (needed
for dev **and** the whole eval harness) → `remote-model-backend.ts` (its service-constructor
ternary must become a map) → `composite-model-backend.ts` → `create-model-backend.ts` (new
`*_INFERENCE_URL` env) → `provider-registry.ts` → `apps/inference-<name>/` (server + Dockerfile) →
`deploy/k8s/base/` (Deployment/Service/HPA + `kustomization.yaml` + API env + PDB/NetworkPolicy) →
`docker-compose.yml` → `scripts/eval/check-inference-parity.ts` → the `MODELS` const duplicated
across `run-eval.ts`, `ablate.ts`, `sweep-segmenter.ts`, `bench-pitch-models.ts`,
`lib/trackCache.ts`, `lib/variantCache.ts`. Budget accordingly; the in-process ONNX route
(`onnxruntime-node`) skips most of it.

---

## 13. Explicit gaps / unverified

- ~~**ISMIR2014/Molina availability**~~ — **⛔ CLOSED 2026-08-08, and not for the reason this doc
  assumed.** §9.3 called it "the single best-matched external testbed" and treated it as an
  availability problem worth chasing. It is a **licence** problem: the dataset's own `readme.txt`
  (recovered from the Wayback Machine; the live path is a soft-404 and the real URL was
  `…/ismir2014singing`, not `…singingdataset`) says the audio, transcriptions and annotations are
  "offered free of charge for **non-commercial use only**" and may not be redistributed. That is
  the HumTrans category, which research-benchmarks bars. Delete it from the plan rather than
  chasing a mirror; the `.rar` was never archived anyway, and 24 of its 38 clips are MTG-QBH
  retrieval queries with no note truth of their own.
  Ruled out in the same pass: **Dagstuhl ChoirSet**, the one remaining CC-BY singing corpus we do
  not hold — its release zip contains no performed-note annotation at all (score representation +
  CREPE/pYIN-derived f0), so it cannot carry note truth either.
  **Net effect on §9.3 and §10 — SUPERSEDED 2026-08-08, see `research-voice-datasets.md`.** This
  read *"there is no obtainable external voice corpus we are missing … the articulated synthetic
  generator and a self-collected corpus are the only path."* That is **still true of note truth**
  (the sweep's one surviving annotated candidate, HUST_Solfege, is wounded and conditional) and
  **decisively false of raw audio**. We do not need note truth to be given to us; we need
  *annotatable* singing, and there is a lot of it under CC-BY/CC0 — chiefly **SingBAP** (7
  inexperienced singers captured simultaneously on iPhone, MacBook and condenser, with published
  interval patterns so only onsets need marking) and **Belyk et al.** (CC0, singers deliberately
  recruited from *both* ends of the ability range, ~7,600 notes against known targets).
  Note also that **24 of ISMIR2014's 38 clips are MTG-QBH queries and MTG-QBH is separately
  deposited** — its licence is in conflict between two sources, but the audio under two thirds of
  a corpus we closed was not as unreachable as this bullet assumed.
- **Yong-2023 checkpoint's training-data terms** (SSVD unstated, TIMIT LDC) and **klangio/dtmst
  license**: unverified — required before anything beyond internal benchmarking.
- **MUSAN's license** (needed for the ROSVOT-recipe noise augmentation): not verified this pass.
- **CPU inference cost** of every note-level model (ROSVOT, Yong, Omnizart): unpublished; measure.
- Yong et al.'s re-onset/transition numbers are **digitised from a figure** (±~0.003), and their
  figure caption's colour legend contradicts the labels (labels + body text used).
- **No study runs modern neural systems against tuned classical pipelines on amateur *wordless*
  input** (hum/scat) — HumTrans is the only humming benchmark and it is NC. Our own corpus is the
  only way to know.
- Whistling: still no literature, no data (unchanged).
