# Rhythm: tempo estimation, beat tracking, and score-level rhythm quantization

> **Status of every proposal in this document — shipped, built-off, discarded, not pursued — is tracked in [`../RESEARCH-STATUS.md`](../RESEARCH-STATUS.md), which also lists where this text is now stale.** This file is kept as the record of the reasoning, not edited to match the code.

Research notes for Solkey (sung/hummed/whistled/played → readable sheet music).
Date: 2026-07-24. Author: research agent.

**Current pipeline (baseline being critiqued):** user-supplied fixed BPM (default 120); assumes recording
starts exactly on beat 1 with zero offset; each detected onset snapped independently to nearest 1/1, 1/2 or
1/4 beat with a coarseness penalty; each duration snapped independently to {4, 3, 2, 1.5, 1, 0.75, 0.5, 0.25}
beats. No beat tracking, tempo estimation, downbeat/offset estimation, triplets, swing, tie/dotted logic, or
rests beyond the gap.

**TL;DR of the whole report.** The literature says three things loudly:

1. Your biggest error source is almost certainly **not** the grid resolution — it is that the grid's *phase*
   and *rate* are unverified (fixed BPM + assumed zero offset). A joint `(tempo, phase)` fit that *minimises
   total quantisation cost* is cheap, has no ML dependency, and is the single highest-ROI change.
2. **Per-note independent nearest-grid snapping is the wrong algorithm class.** Every serious system since
   Cemgil (1999/2001) and Raphael (2001) solves onset-quantisation + tempo *jointly* with a global
   DP/HMM over metrical positions. Empirically, moving from "simple prior, per-note" to a contextual global
   model cut note-value error from ~47% to ~26% on polyphonic piano
   ([Nakamura et al. 2017, MRF](https://ar5iv.labs.arxiv.org/html/1703.08144)).
3. **Automatic beat tracking on solo singing is genuinely weak** (beat F1 ≈ 0.78–0.81, downbeat F1 ≈ 0.6–0.68
   at 2025 SOTA). So do not build the product on the assumption that you can silently recover the beat grid
   from a hummed recording. Use it to *propose* candidates and let the UX (click track / tap tempo /
   confirm-and-requantise) close the gap.

Licensing headline: **madmom's pretrained models are CC BY-NC-SA 4.0 → not usable in a commercial SaaS
without written permission from JKU.** `beat_this` (2024 SOTA) is **MIT for both code and weights** — use that.

---

## 1. Tempo & beat tracking from monophonic melodic audio (no drums)

### 1.1 What the numbers actually say

**`beat_this` (Foscarin, Schlüter, Widmer — ISMIR 2024)** is the current reference point.
Paper: <https://arxiv.org/abs/2407.21658> / HTML <https://arxiv.org/html/2407.21658v1>.
Code: <https://github.com/CPJKU/beat_this>.

- Architecture: 128-bin mel → conv "frontend" (stem + 3 blocks with frequency/time-factorised partial
  transformers) → 6 transformer blocks, d=512, 16 heads, rotary embeddings, sigmoid gating → beat head +
  downbeat head + a "sum head" that couples them.
- **~20 M params** main model (`final0`, ~78 MB checkpoint). A **small variant** (d=128, 4 heads,
  **~2 M params, ~8.1 MB**) "still gives SOTA F1 scores" — quote from the paper. This matters for you.
- Trained on 18 datasets / 4,556 tracks (Ballroom, Hainsworth, Beatles, Harmonix, RWC, SMC, ASAP,
  GuitarSet, Filosax, Groove MIDI, JAAH, Candombe, TapCorrect, Simac, HJDB).
- **No DBN postprocessing** — plain peak-picking on the logits. Authors argue the DBN "is inherently bound to
  fail" on time-signature changes, tempi outside its preset range, and unusual beat/bar structures. A `--dbn`
  flag exists but **requires madmom** (licensing trap — see §1.4).

GTZAN test set (held out of training):

| Metric | beat_this | Hung et al. 2022 (prior SOTA) |
|---|---|---|
| Beat F1 | **89.1 ± 0.3** | 88.7 |
| Beat CMLt | 79.8 ± 0.6 | 81.2 |
| Beat AMLt | 89.8 ± 0.4 | 92.0 |
| Downbeat F1 | **78.3 ± 0.4** | 75.6 |
| Downbeat CMLt | 67.3 ± 0.8 | 71.5 |
| Downbeat AMLt | 79.1 ± 0.6 | 88.1 |

Per-dataset (8-fold CV), **beat F1 / downbeat F1** — the rows that matter for us are the *solo / monophonic
/ non-percussive* ones:

| Dataset | Character | Beat F1 | Downbeat F1 |
|---|---|---|---|
| Candombe | percussive, strong groove | 99.7 | 99.7 |
| **Filosax** | **solo saxophone (monophonic!)** | **99.5** | **98.5** |
| Ballroom | strong beat | 97.5 | 95.3 |
| Harmonix | pop | 95.8 | 90.7 |
| **GuitarSet** | **solo guitar, no drums** | **92.0** | **88.1** |
| RWC Classical | expressive, no drums | 77.1 | 66.3 |
| **ASAP** | **solo piano, heavy rubato** | **76.3** | **61.2** |
| SMC (deliberately hard) | soft onsets, expressive | 62.7 | — |

Read that carefully. Filosax at 99.5 is a solo monophonic wind instrument — but it is *played to a backing
track / with a steady jazz pulse*. GuitarSet at 92.0 is solo guitar with a metronome-ish pulse. ASAP at 76.3
is solo piano with real rubato. **The predictor of difficulty is not "monophonic" and not "no drums" — it is
"is there a steady, externally-referenced pulse".** That is exactly the axis your UX can control (§5).

### 1.2 The bad news: solo *singing* specifically

Two papers measure a cappella / separated-vocal beat tracking directly.

- Heydari & Duan, **"Singing beat tracking with self-supervised front-end and linear transformers"**,
  ISMIR 2022. <https://archives.ismir.net/ismir2022/paper/000074.pdf> / <https://arxiv.org/abs/2208.14578>.
  WavLM/DistilHuBERT front-end + self-attention. Reported beat F1 **0.733** on GTZAN separated vocals —
  and the paper's framing is that generic music beat trackers are beaten "by a large margin", i.e. generic
  trackers do much worse than 0.73 on solo voice.
- **"Efficient Adapter Tuning for Joint Singing Voice Beat and Downbeat Tracking with Self-supervised
  Learning Features"** (2025). <https://arxiv.org/html/2503.10086v1>. This is the cleanest quantitative
  picture available:

| System (beat F1 / downbeat F1) | GTZAN (sep. vocals) | RWC Pop | MUSDB18 |
|---|---|---|---|
| Spectrogram only (i.e. a generic audio beat tracker's information) | **0.48 / 0.26** | 0.65 / 0.53 | 0.31 / 0.15 |
| DistilHuBERT SSL only | 0.74 / 0.47 | 0.76 / 0.68 | 0.38 / 0.17 |
| Late weighted fusion | 0.79 / 0.58 | 0.88 / 0.84 | 0.47 / 0.26 |
| + Residual Adapter (20% params) | 0.80 / 0.65 | 0.91 / 0.80 | — |
| **Proposed (fusion + RA)** | **0.813 / 0.678** | — | — |
| Heydari & Duan 2022 baseline | 0.733 / — | — | — |

Also reported for the proposed system on GTZAN: P-score 0.801, Cemgil 0.713, Goto 0.757 (beat);
0.692 / 0.621 / 0.663 (downbeat). Datasets: ~25.4 h across GTZAN, RWC Pop, Ballroom, Hainsworth, MUSDB18,
URSing. **No code or weights released** as of the paper — you cannot use this off the shelf.

**Conclusions you should act on:**
- Spectral-only beat tracking on solo voice ≈ **0.48 beat F1 / 0.26 downbeat F1**. That is close to useless
  for silently deciding a user's bar structure.
- Even 2025 SOTA on solo voice is ~0.81 beat / ~0.68 downbeat, *and* those recordings are separated vocals
  from commercially-produced songs, so the singer was performing to a click. A user humming a fresh idea into
  a phone is a **harder** case than any of these benchmarks. Treat published numbers as an optimistic ceiling.
- SSL speech features (DistilHuBERT/WavLM) are the thing that makes singing beat tracking work at all — the
  spectral novelty function that librosa/madmom rely on is the weak link, because a sung/hummed legato line
  has almost no percussive onset energy.

### 1.3 Options table

| System | Ref | Params | Runtime | License (code / weights) | Fit for us |
|---|---|---|---|---|---|
| **beat_this** | [arXiv 2407.21658](https://arxiv.org/abs/2407.21658), [GitHub](https://github.com/CPJKU/beat_this) | 20 M (78 MB) / **small 2 M (8.1 MB)** | offline, PyTorch 2, CPU fallback, `--float16` on GPU; no published RTF | **MIT / MIT** | **Best choice.** Only viable commercial option at SOTA quality. |
| beat_this_cpp | [GitHub](https://github.com/mosynthkey/beat_this_cpp) | ~97 MB ONNX | **ONNX Runtime**, chunked 1500-frame windows w/ 6-frame borders | MIT (deps MIT/BSD-3) | **Yes** — gives you an ONNX path, no Python/PyTorch in prod. Optional DBN mode (HMM+Viterbi) implemented natively. |
| madmom `DBNBeatTracker` / `RNNBeatProcessor` | [GitHub](https://github.com/CPJKU/madmom), [LICENSE](https://raw.githubusercontent.com/CPJKU/madmom/main/LICENSE) | small RNN ensemble | fast CPU | **BSD-2-Clause code / CC BY-NC-SA 4.0 for `.npy/.npz/.h5/.hdf5/.pkl/.mat` models** | **BLOCKED for commercial use.** See §1.4. |
| BeatNet (online, CRNN + particle filter) | [ISMIR 2021](https://archives.ismir.net/ismir2021/paper/000033.pdf), [GitHub](https://github.com/mjhydri/BeatNet) | small CRNN | real-time capable; "information gate" cuts PF cost | **No license field in `setup.py`; `install_requires` includes `madmom>=0.16.1`** | **Avoid.** Unlicensed + hard madmom dependency. Nice property: estimates meter without being primed with a time signature. |
| Beat Transformer (demixed) | [ISMIR 2022](https://archives.ismir.net/ismir2022/paper/000019.pdf), [GitHub](https://github.com/zhaojw1998/Beat-Transformer) | dilated self-attn, time+instrument axes | needs a **demixer (Spleeter)** first | **MIT** | **Pointless for us.** Its entire gain (+~4 pts downbeat over TCN) comes from having *multiple instrument channels*. A solo voice demixes to itself. |
| TCN beat trackers (Böck et al.; Davies & Böck) | in madmom / standalone | ~4 M (Hung et al. 2022 variant) | fast | madmom-hosted weights ⇒ NC | Superseded by beat_this; licensing issue. |
| librosa `beat_track` (DP, Ellis) / `plp` | [docs](https://librosa.org/doc/main/generated/librosa.beat.plp.html) | n/a (DSP) | very fast | **ISC** | Useful as a *cheap tempo-candidate generator only*. `beat_track` assumes roughly constant tempo; `plp` (Grosche & Müller PLP, IEEE TASLP 19(6):1688–1701, 2011) handles varying tempo and streams. Both are onset-novelty based ⇒ weak on legato humming (cf. the 0.48 F1 spectrogram-only row above). |
| Essentia `RhythmExtractor2013` | — | — | fast C++ | **AGPL-3.0** *(recollection — verify)* | **Flag:** AGPL is hostile to a SaaS backend. Verify before use. |
| aubio `aubiotempo` | — | — | very fast | **GPL-3.0** *(recollection — verify)* | Same concern. |

Tempo-estimation-specific background if you want global-BPM-only:
[Schreiber, Urbano & Müller, "Music Tempo Estimation: Are We Done Yet?", TISMIR 3(1):111–125, 2020](https://transactions.ismir.net/articles/10.5334/tismir.43)
(also [ePrint](https://www.audiolabs-erlangen.de/content/05_fau/professor/00_mueller/03_publications/2020_SchreiberUM_MusicTempo_TISMIR_ePrint.pdf))
and [Hernandez-Olivan et al., "AI and Tempo Estimation: A Review", arXiv 2401.00209](https://arxiv.org/abs/2401.00209).
Key methodological warning from Schreiber et al.: **ACC1 vs ACC2 hide octave errors** — ACC2 forgives
integer multiples/fractions. For notation, an octave error is catastrophic (every note becomes half/double
its correct value), so **ACC2 is the wrong metric for you; report ACC1 and the AMLt/CMLt gap.** Note in the
beat_this GTZAN table above: beat CMLt 79.8 vs AMLt 89.8 — a **10-point gap that is entirely metrical-level
(octave / offbeat) confusion**. Those are exactly the errors that wreck notation.
Eval tooling: <https://github.com/tempoeval/tempo_eval>.

### 1.4 Licensing — read this before you `pip install`

madmom's `LICENSE` is explicitly dual:

- Source files (`.py`, `.pyx`, `.pxd`, `.c`, …): **BSD 2-Clause** (JKU Linz + OFAI Vienna, 2012–2014).
- **Data/model files (`.npy`, `.npz`, `.h5`, `.hdf5`, `.pkl`, `.mat`): Creative Commons
  Attribution-NonCommercial-ShareAlike 4.0.** The restriction is stated to extend to *pickled Processors*
  (i.e. the saved DBN/RNN objects). Commercial use requires contacting Gerhard Widmer
  (gerhard.widmer@jku.at).

So: `DBNBeatTracker`, `RNNBeatProcessor`, `DBNDownBeatTracker` — the actual useful things — are
**non-commercial**. This transitively poisons BeatNet (hard dep) and `beat_this --dbn` (optional dep; just
don't enable it). `beat_this`'s own README is unambiguous: *code and model weights are MIT*, with the caveat
that the **training datasets** may be copyrighted (irrelevant to you — you're using the weights, not
redistributing the corpora).

Other licenses confirmed in this research: PM2S **MIT** (<https://github.com/cheriell/PM2S/blob/main/LICENSE>,
© 2022 Lele Liu); MV2H **MIT**; Beat Transformer **MIT**; beat_this_cpp **MIT**; librosa **ISC**;
`mir_eval` **MIT** *(recollection)*. **Unknown/unstated:** qparse (Inria GitLab — no license shown on the
project pages), MIDI2ScoreTransformer (<https://github.com/TimFelixBeyer/MIDI2ScoreTransformer> — no license
in README), the 2025 singing-beat adapter work (no release at all).

### 1.5 Can you beat-track the *detected note onsets* instead of the audio? (symbolic beat induction)

Yes, it's a real and long-established line of work — but for your input type the evidence says **audio-domain
beat tracking is substantially better than symbolic**, which is a counter-intuitive and important finding.

The symbolic canon:

- **Dixon, "Automatic Extraction of Tempo and Beat from Expressive Performances"**, JNMR 2001 —
  **BeatRoot**. <https://ofai.at/papers/oefai-tr-2001-19.pdf>. Clustering of inter-onset intervals →
  tempo hypotheses at multiple metrical levels → a **multi-agent beam search** where competing agents each
  maintain a (tempo, phase) hypothesis and are scored by fit to the onsets. Works on MIDI *or* audio.
  Explicit finding: estimating the **perceptual salience** of each rhythmic event significantly improves
  results (for us: weight onsets by note duration and amplitude, not uniformly). No prior knowledge of tempo,
  meter or style assumed.
- **Temperley & Sleator, Melisma `meter` program** — <https://www.link.cs.cmu.edu/melisma/> ,
  <https://www.link.cs.cmu.edu/music-analysis/meter.html>, v2 <https://davidtemperley.com/melisma-v2/>.
  Preference-rule system over a *grid of beat levels* (level 2 = tactus). Three rules: (1) prefer beats
  aligned with onsets — more onsets better; (2) prefer beats aligned with *longer* events; (3) prefer beats
  regularly spaced at each level. Version 2 (2009) reformulates the same rules **probabilistically**, so the
  "total final score" is the probability of the note pattern.
- **Temperley, *Music and Probability*** (MIT Press, 2007) —
  <https://direct.mit.edu/books/monograph/2326/Music-and-Probability>. Ch. 3 is the rhythm/meter model:
  infer a **complete metrical grid** from a monodic sequence of note onsets, Bayesian, deliberately few
  parameters. This is the closest thing in the literature to *exactly your problem* (monophonic onsets →
  metrical grid) and it's a good source for prior shapes.
- **Inner Metric Analysis (IMA)** — Volk; de Haas & Volk, "Meter Detection in Symbolic Music Using Inner
  Metric Analysis", ISMIR 2016 <https://wp.nyu.edu/ismir2016/wp-content/uploads/sites/2294/2016/07/033_Paper.pdf>;
  code <https://www.projects.science.uu.nl/monochord/ima/>; theory
  <https://webspace.science.uu.nl/~fleis102/JMMPreprint.pdf>. Input is *just a list of onsets*; it enumerates
  "local meters" (start, period, #repeats) from equally-spaced onset subsets and sums them into a **metric
  weight profile** over time. Cheap, no training, and directly gives you a phase/period saliency map you can
  cross-correlate against 4/4 and 3/4 templates. Also used for syncopation analysis
  (<https://webspace.science.uu.nl/~veltk101/publications/art/JNMR08.pdf>). *License of the Utrecht code:
  unknown — check.*
- **Modern neural symbolic beat tracking:** PM2S (Liu et al., ISMIR 2022 — CRNN over MIDI note sequences,
  predicts per-note "is on a beat", plus downbeat, key sig, time sig, hand part) and a 2025 T5
  encoder–decoder (<https://arxiv.org/html/2507.00466>, code <https://github.com/klangio/midi-beat-tracking>).

The killer number — **symbolic beat F1 by dataset** (T5 paper, 70 ms tolerance):

| Dataset | T5 symbolic beat F1 | T5 symbolic downbeat F1 | PM2S beat / downbeat | **beat_this on the *audio*** |
|---|---|---|---|---|
| A-MAPS | 98.01 | 76.56 | 83.89 / 68.90 | — |
| ASAP | 78.13 | 27.81 | — | 76.3 / 61.2 |
| **GuitarSet** | **52.38** | **23.02** | — | **92.0 / 88.1** |

**GuitarSet: 52% beat F1 symbolically vs 92% from audio.** Symbolic beat induction degrades badly when the
note stream is sparse and monophonic, because you lose chord-simultaneity cues, note density, and timbre.
Our input is *even sparser* than solo guitar. So:

> **Do not build your beat/tempo estimation on the detected onsets alone.** Use audio-domain tracking (or
> better, UX-supplied tempo) for the grid, and use symbolic methods (IMA metric weight, Temperley-style
> priors) as a **rescoring / tie-breaking signal** on top — e.g. to choose between 2/4 vs 4/4, or to pick the
> downbeat phase among the beat_this beat candidates.

**Evidence gap:** I found no paper that evaluates beat tracking on *hummed / whistled / non-lyrical* audio
specifically. All the singing work uses lyric singing from produced music. Whistling in particular is pure
tone with extremely soft onsets — expect worse than the 0.48 spectrogram-only figure. This is a genuine hole;
you'd have to measure it yourself.

---

## 2. Score-level rhythm quantisation — the real literature

### 2.1 Why nearest-grid snapping fails (mechanistically)

Your current scheme has five specific, nameable defects. Each one is exactly what the literature fixes.

1. **Independence.** Each onset is snapped without reference to its neighbours, so nothing prevents two
   onsets landing on the same score time, or a sequence like `0, 0.25, 0.5, 0.5, 1.0` where a 16th got
   absorbed. Global DP/HMM enforces monotone, consistent score times by construction.
2. **Onsets and durations are quantised separately.** So `onset[i+1] - onset[i] ≠ duration[i] + rest[i]` in
   general. You then get overlaps or holes that the notation layer has to paper over. The literature splits
   this properly into **onset score-time quantisation** and **note-value recognition** and makes the second
   *depend* on the first (Nakamura et al., §2.4).
3. **No tempo model.** A fixed BPM means a 1% tempo drift accumulates: after 30 s at 120 BPM that's 0.3 s
   ≈ 60% of an eighth note. Every joint model since Cemgil treats log-tempo as a slowly-varying latent
   state.
4. **Position-independent penalty.** Your "coarseness penalty" penalises *fine subdivisions* but not
   *metrically implausible positions*. Musically, "beat 2.5" and "beat 2.75" cost differently, and "beat
   2.75" after "beat 2.5" is cheap while "beat 2.75" in isolation is expensive. A metrical HMM encodes
   position-conditional transition probabilities, which is the correct object.
5. **No notation-complexity term.** `{4, 3, 2, 1.5, 1, 0.75, 0.5, 0.25}` conflates "what durations exist"
   with "how they are spelled". A dotted quarter (1.5) and a quarter-tied-to-eighth are the *same duration*
   and different *notation*, and which is correct depends on where in the bar it starts (see §6).

### 2.2 The foundational joint models

**Cemgil & Kappen, "Tempo tracking and rhythm quantization by sequential Monte Carlo"**, NIPS 2001.
<https://proceedings.neurips.cc/paper/2001/file/5ec829debe54b19a5f78d9a65b900a39-Paper.pdf>
Extended: **"Monte Carlo Methods for Tempo Tracking and Rhythm Quantization"**, JAIR / arXiv
<https://arxiv.org/abs/1106.4863>. Earlier framing: Cemgil, Desain & Kappen, "Rhythm Quantization for
Transcription", AISB'99 <https://www.snn.ru.nl/v2/serve.php?doc=Cemgil_aisb99.pdf>. Thesis:
**Cemgil, "Bayesian Music Transcription", PhD 2004**
<https://repository.ubn.ru.nl/bitstream/handle/2066/59219/59219.pdf>.

Structure: a **switching state-space model**. Discrete switch variables = note locations in the score
(the quantised rhythm); continuous hidden state = **tempo** (and its rate of change). Tempo tracking is
*filtering*; transcription is *MAP state estimation*. Inference by Rao-Blackwellised particle filtering with
a Viterbi variant that marginalises the continuous tempo analytically. Also relevant:
Cemgil et al., "On tempo tracking: Tempogram representation and Kalman filtering"
<https://www.mcg.uva.nl/mcg-2023/papers/mmm-27.pdf>.

**What you gain over snapping:** tempo and rhythm are inferred *together*, so a systematically-late passage
is explained as "the tempo slowed" rather than as "every note moved to a weird subdivision". This is the
single conceptual upgrade that matters most.

**Raphael, "Automated Rhythm Transcription"**, ISMIR 2001, pp. 99–107.
<https://www.semanticscholar.org/paper/Automated-Rhythm-Transcription-Raphael/7ab6a049f86af1dfce04116aa7cc66d8e9c248a8>
Given a sequence of onset times, **simultaneously** identify the notated rhythm and the variable tempo.
Stochastic model over three coupled processes: rhythm, tempo, observations. Structurally a **network of HMMs**
as in continuous speech recognition, decoded with **level building**. Read this one if you want the
DP formulation in its cleanest form; the speech-recognition analogy is the right mental model
(phones↔note values, language model↔metrical prior, acoustic model↔timing likelihood).

### 2.3 Nakamura's metrical HMM / merged-output HMM (the workhorse)

- **Nakamura, Yoshii, Sagayama, "Rhythm Transcription of Polyphonic MIDI Performances"**, SMC 2016.
  <https://eita-nakamura.github.io/articles/Nakamura_etal_RhythmTranscriptionOfPolyphonicMIDIPerformances_SMC2016.pdf>
- **"Rhythm Transcription of Polyphonic Piano Music Based on Merged-Output HMM for Multiple Voices"**,
  IEEE/ACM TASLP 25(4):794–806, 2017. <https://arxiv.org/abs/1701.08343> /
  HTML <https://ar5iv.labs.arxiv.org/html/1701.08343>
- Publication list: <https://eita-nakamura.github.io/eita-nakamura_publications.html>

**The metrical HMM** (this is the model you should implement, adapted to monophonic):

- **State = metrical position on a grid over a unit interval (a bar).** Note values are *not* modelled
  directly — they emerge as **differences between successive metrical positions**. This automatically makes
  onsets and durations consistent (defect #2 above disappears by construction) and automatically encodes
  the meter.
- Candidate note values in their setup: "normal, dotted, and triplet note values ranging from the whole note
  to the 32nd note" — ~15 distinct values. **Triplets are in from the start.**
- **Tempo model:** a Gaussian Markov process on the **logarithm** of the (inverse) tempo:
  `u_{n+1} ~ N(u_n, σ_v²)` where `u = log(1/tempo)`. `σ_v` controls how much drift you tolerate;
  `σ_{v,ini}` is the initial-tempo uncertainty. Log-domain is the right parameterisation (tempo changes are
  multiplicative).
- Chord/cluster asynchrony handled with an exponential distribution on intra-cluster inter-onset times
  (irrelevant for monophonic — simplifies your version a lot).

Results (polyphonic piano, note-value/onset correction rates — lower is better):

| Case | metrical HMM | merged-output HMM |
|---|---|---|
| Polyrhythmic passages | ~27.9% | ~14.8% (−13.1 ± 3.1 pts) |
| Non-polyrhythmic music | ~8.1% | ~9.5% (difference insignificant, 1.3σ) |

**For monophonic input the merged-output extension buys you nothing** — it exists purely to model
loose synchrony between simultaneous voices. Use the plain metrical HMM. Baselines they beat: Melisma
Analyzer, "Connectionist Quantizer" (Desain & Honing), note HMM, 2D PCFG. (No commercial notation software
was in that comparison.)

### 2.4 Note-value recognition (durations/offsets) — the neglected half

**Nakamura, Yoshii, Dixon, "Note Value Recognition for Piano Transcription Using Markov Random Fields"**,
2017. <https://arxiv.org/abs/1703.08144> / <https://ar5iv.labs.arxiv.org/html/1703.08144>

This addresses the part you have *no* model for. Their framing: prior rhythm-transcription work estimated
onset score times well but **offsets/note values were "largely unsolved"**, blocking complete scores,
because "performed note durations can deviate largely from score-indicated values". (Massively true for
singing: a held vowel's release is arbitrary.)

MRF: `P(r | p, d, d̄, τ, v) ∝ exp[−H₁ − H₂ − H₃]` with
- **H₁ context model** — prior over note values conditioned on *pitch context* and onset times (learned via
  a context tree over the first 10 candidate values per pitch-context);
- **H₂ interdependence model** — joint probabilities of note-value pairs within an onset cluster;
- **H₃ performance model** — likelihood of the *observed* duration given the note value and local tempo.

Key structural trick, and the one to steal: **Inter-Onset Note Values (IONVs)** — "the intervals between
onset score times of succeeding onset clusters". Notes overwhelmingly end where *another note begins*, so
restrict the candidate note values to `{IONV₁, IONV₂, …, IONV₁₀}` (i.e. "ends at next onset", "ends at the
onset after that", …). This collapses the search space and directly gives you tie/rest decisions.

Results (180 performances, 60 phrases × 3 players; scores trained on 148 classical piano pieces / 3.4 M notes):

| Method | Note-value error rate | Scale error |
|---|---|---|
| **Full MRF** | **25.66%** | 1.225 |
| − performance model | ~26% | 1.240 |
| − interdependence model | ~25.7% | 1.226 |
| **Simple prior (no context)** | **~47%** | >1.50 |
| Melisma Analyzer | **~71%** | high |

≈40% relative error reduction over simple/existing methods. **The "simple prior" row at ~47% is the closest
analogue to what you do today.** Source code for the MRF + metrical HMM + Kalman tempo smoothing is stated
to be on the paper's companion page.

### 2.5 Piece-specific Bayesian priors — and the one result on *vocal melodies*

**Nakamura, Itoyama, Yoshii, "Musical Rhythm Transcription Based on Bayesian Piece-Specific Score Models
Capturing Repetitions"**, 2019. <https://arxiv.org/abs/1908.06969> /
<https://ar5iv.labs.arxiv.org/html/1908.06969>. Data: <https://bayesianscoremodel.github.io>

Idea: instead of one generic score prior, use **Dirichlet processes** to draw sparse *piece-specific*
transition distributions from a generic base measure. Music repeats itself, so the piece-specific
distribution has much lower entropy than the generic one. Models combined: note-value Markov, metrical
Markov, note-pattern Markov; plus a note-modification process (divisions / onset shifts) for approximate
repetition.

**This is the one paper in the entire corpus evaluated on vocal melodies**, which makes its numbers the best
available proxy for your task:

- Training: **401** vocal-melody pieces — RWC Popular Music (99), The Beatles (190), contemporary J-pop (142).
- Test: **30** popular-music pieces, performed by **4 musicians**.
- Error rate = fraction of notes with incorrectly estimated note value.
- Grid: **16th-note minimum resolution**, segmented into half-note units → 8 metrical positions per segment.
  The paper says extending to longer durations and **triplets** "is theoretically possible" but wasn't done,
  for computational reasons.
- **Tempo: explicitly out of scope.** "the global tempo is unknown... we only consider a constant and known
  tempo in this study." Performers were instructed to play at **105 BPM**. Anacrusis not discussed.

| Model | Error rate (real performances) |
|---|---|
| MetMM2 (non-Bayesian 2nd-order metrical Markov) | ~2.8% |
| **MetMM2B (Bayesian)** | **~2.0%** |

And a sobering note: of ~70 residual errors, **43 were judged genuine performance errors**, not model
failures. So on vocal melodies with a *known constant tempo* and a 16th grid, a good HMM is at ~2% note-value
error and effectively saturated.

> **This bounds the problem for you.** Rhythm quantisation of a monophonic melody *given the correct tempo
> and phase* is a largely solved problem at ~2% error. Therefore **your errors are overwhelmingly coming
> from tempo/phase/grid-alignment, not from the quantiser's expressiveness.** That is a strong argument for
> prioritising §4 and §5 over §2's fancier machinery.

### 2.6 Modern neural MIDI-to-score

**PM2S — Liu, Kong, Morfi, Benetos, "Performance MIDI-to-Score Conversion by Neural Beat Tracking"**,
ISMIR 2022. <https://archives.ismir.net/ismir2022/paper/000047.pdf> ,
<https://www.turing.ac.uk/news/publications/performance-midi-score-conversion-neural-beat-tracking> ,
code **MIT** <https://github.com/cheriell/PM2S>, demos <https://cheriell.github.io/research/PM2S/>.
CRNN over MIDI note sequences predicting per-note beat/on-beat, quantised times for beat *and* non-beat
notes, plus key signature, time signature, hand part. Reported to beat commercial software on MV2H.
Python 3.8 / PyTorch 1.12, pretrained checkpoints + `demo.ipynb`.

**Score Transformer — Suzuki, MMAsia '21.** <https://arxiv.org/abs/2112.00355> ,
<https://score-transformer.github.io/> , <https://github.com/suzuqn/ScoreTransformer>. Introduces
**score tokens** ↔ MusicXML tokenisation with compound tokens that quantise continuous values. Beats prior
methods on all 12 investigated musical aspects. Useful mainly as a **tokenisation reference** if you ever go
seq2seq.

**Beyer & Dai, "End-to-end Piano Performance-MIDI to Score Conversion with Transformers"**, ISMIR 2024.
<https://arxiv.org/abs/2410.00210> / HTML <https://arxiv.org/html/2410.00210v1> ,
code <https://github.com/TimFelixBeyer/MIDI2ScoreTransformer> (**license not stated — flag**).
Direct performance-MIDI → MusicXML seq2seq. Parallel token streams per attribute; **note value quantised as
1/24 fractions → 98.6% coverage with 97 tokens** (that 1/24 figure is a very concrete, stealable design
decision: 24 = lcm(8, 3) so it covers both straight 32nds-ish and triplets). Sequence length 3.5× shorter
than prior work. Predicts **ornaments** (trills, grace notes, staccato), stem direction and pitch spelling.
Data: ASAP (967 performances → 822/86/59 split) + 58,646 public-domain MuseScore MusicXML files for
unpaired pretraining. 4 layers, 8 heads, d=512, 40k steps.

**MUSTER results (lower is better)** — this is the most useful comparison table in the literature:

| Method | ε_onset | ε_offset | Avg. error |
|---|---|---|---|
| Beyer & Dai (end-to-end transformer) | 15.55 | **23.84** | **11.30** |
| HMM-Classical (Nakamian metrical HMM) | 22.58 | 29.84 | 13.95 |
| PM2S (neural beat tracking) | **68.28** | 54.11 | 28.04 |

Also compared against commercial software (**MuseScore, Finale**) per the paper's Table 3.

**Wachter & Klang(?), "Transformer-Based Rhythm Quantization of Performance MIDI Using Beat Annotations"**
(2026). <https://arxiv.org/abs/2604.22290> / HTML <https://arxiv.org/html/2604.22290v1> (CC BY 4.0;
no code link found). See also the earlier preprint
**"Beat-Based Rhythm Quantization of MIDI Performances"** <https://arxiv.org/abs/2508.19262>. *This is the
most directly transferable design in the whole survey.* Details:

- **Beats/downbeats are an INPUT, not something the model estimates.** Beat annotations are interpolated to
  **12 sub-beats per beat** (a 32nd-note-triplet grid). Continuous onsets are pre-quantised by
  `argmin_l |tick_l − o_i|`. So the "unified token representation" fuses performance timing with beat
  structure *before* tokenisation.
- **Tuplets fall out for free:** 12 ticks/beat represents "straight and triplet-based note values of a
  16th-note triplet and above" with no explicit tuplet-ratio encoding. (Compare Beyer & Dai's 1/24 — same
  idea, one octave finer.)
- Tokens: 88 pitch + 48 onset (32nd-triplets in 4/4) + 48 note-value (1..48 units) + a
  **new-measure structural token**; vocabulary **187** total.
- **Tiny model:** T5 with **2 layers, 4 heads, d_model=128, d_kv=64, d_ff=1024**; beam search width 5.
- Data: ASAP (1,067 performances / 236 pieces, ~40k measures) and **Leduc (239 jazz *guitar* performances
  with professional transcriptions)**. Instrument-specific training wins:

| Training | Onset F1 | Note-value accuracy | Note-value MSE (quarters) |
|---|---|---|---|
| Piano (ASAP only) | **97.3%** | 83.3% | 0.20 |
| **Guitar (Leduc only)** | 92.1% | **90.2%** | — |
| Combined | 97.2% | 81.1% | — |

- MUSTER on ACPAS: **ε_onset 12.30 / ε_offset 28.30** vs end-to-end PM2S 15.55/23.84 vs neural beat tracking
  68.28/54.11.
- **Time-signature generalisation:** trained on 2/4+3/4+4/4, generalises to unseen signatures (98.0% onset
  F1 on 2/4 test data). No explicit time-signature tokens needed.
- Data augmentation: transposition + note-value noise best; **transposition alone helped even though it
  doesn't change rhythm**, suggesting pitch structure informs rhythm.
- Explicit statement of the strategic point: the model "is capable of leveraging metronome information,
  which entails the possibility of completely eliminating the uncertainty of beat estimations."

**The 12.30 vs 68.28 spread is the strongest quantitative argument in this whole report.** Same task, same
metric; the difference is essentially *whether the beat grid is known*. It is a ~5.5× reduction in onset
error rate. Your product decisions should follow that gradient.

### 2.7 Grammar/tree-based quantisation — the right tool for note-value *spelling*

- **Foscarin, Jacquemard, Rigaux, Sakai, "A Parse-based Framework for Coupled Rhythm Quantization and Score
  Structuring"**, MCM 2019, LNCS 11502. DOI 10.1007/978-3-030-21392-3_20.
  <https://link.springer.com/chapter/10.1007/978-3-030-21392-3_20> ,
  HAL (open access, may be Anubis-gated) <https://inria.hal.science/hal-01988990v1> ,
  <https://www.semanticscholar.org/paper/A-Parse-Based-Framework-for-Coupled-Rhythm-and-Foscarin-Jacquemard/b33bc17a1b08805eb40eb7295aa902838e6d2e8e>
- **Tool: qparse** — <https://qparse.gitlabpages.inria.fr/> , docs
  <https://qparse.gitlabpages.inria.fr/docs/scientific/> ; author
  <https://florent-jacquemard.github.io/> , <http://repmus.ircam.fr/jacquemard/publications>.
  *(License not stated on the project pages — flag before use.)*
- Lineage: IRCAM **Kant** (Agon, Assayag, Fineberg, Rueda, ICMC 1994 — "Kant: a Critique of Pure
  Quantification"); **Rhythm Trees** in PatchWork/OpenMusic
  (<https://openmusic-project.github.io/openmusic/doc/om-manual/OMRT>, <http://repmus.ircam.fr/cao/rhythm/home>);
  Jacquemard et al., "A Structural Theory of Rhythm Notation Based on Tree Representations and Term
  Rewriting", MCM 2015 <https://link.springer.com/chapter/10.1007/978-3-319-20603-5_1>.

Mechanism, which is exactly the missing piece in your pipeline:

- Rhythm is represented as a **tree** where **branching = division of a time interval into equal parts**.
  Leaf labels: `0` = continuation (a **tie or dot**), `1` = one note, `2` = grace note + note.
  So "dotted quarter" and "quarter tied to eighth" are *different trees for the same duration* — which is the
  correct ontology, and the one your flat duration list cannot express.
- A **weighted tree automaton / weighted CFG** encodes notation *preferences*: production rules carry
  **complexity weights** (low for duple divisions, high for tuplets). Weights live in a **tropical semiring**
  (min-plus) so "cheapest parse" = "simplest notation".
- Transcription = find the parse tree minimising **notation complexity (from the grammar) + distance from the
  input performance timings**. Solved by a **DP 1-best algorithm "close to Knuth's generalisation of
  Dijkstra's shortest path"**, extended to **k-best** so a UI can offer the user alternative spellings.
- Efficiency: compact WTA with attributes in production rules; **binary-tree encoding of the bar sequence**
  so you process bars monotonically/greedily instead of enumerating bar sequences exponentially.
- Output formats include **MEI XML**.

**This is the cleanest formalisation of the "competing spellings" problem** and I'd model your notation layer
on it even if you don't use the tool. The two-term cost `fitness + complexity` is the whole idea.

### 2.8 Grosche/Müller tempogram (for tempo candidates & drift)

- **Grosche, Müller, Kurth, "Cyclic Tempogram — A Mid-Level Tempo Representation for Music Signals"**,
  ICASSP 2010. <https://resources.mpi-inf.mpg.de/MIR/tempogramtoolbox/2010_GroscheMuellerKurth_TempogramCyclic_ICASSP.pdf>
- **Grosche & Müller, "Extracting Predominant Local Pulse Information from Music Recordings"** (PLP),
  IEEE TASLP 19(6):1688–1701, 2011 — the algorithm behind `librosa.beat.plp`.
- **Tempogram Toolbox** <https://www.audiolabs-erlangen.de/resources/MIR/tempogramtoolbox/> (MATLAB).
- `librosa.feature.fourier_tempogram` / `librosa.feature.tempogram`.

Two practical facts worth internalising:
- **Fourier tempograms suppress subharmonics but show harmonics; autocorrelation tempograms show
  subharmonics but suppress harmonics.** They are complementary — combining both is the standard way to
  disambiguate the *metrical level* (the octave error that kills notation). Do both and intersect.
- **Cyclic tempogram** identifies tempi differing by powers of two — useful if you deliberately want to
  *defer* the octave decision to the user rather than guess.
- `librosa.beat.plp` `win_length=384` at sr=22050/hop=512 ≈ **8.9 s analysis window** — that's your effective
  time resolution for drift tracking.

---

## 3. Evaluation metrics for notated rhythm

You are right that onset F1 in seconds is the wrong metric. Here's the landscape.

### 3.1 MV2H (recommended primary)

**McLeod & Steedman, "Evaluating Automatic Polyphonic Music Transcription", ISMIR 2018.**
<https://zenodo.org/records/1492339> ,
<https://www.research.ed.ac.uk/en/publications/evaluating-automatic-polyphonic-music-transcription>
Follow-up for unaligned scores: **"Evaluating Non-aligned Musical Score Transcriptions with MV2H"**
<https://www.semanticscholar.org/paper/Evaluating-Non-aligned-Musical-Score-Transcriptions-Mcleod/ea35708528e98d1ed174db5f790e548e91106699>
Code (**MIT**, Java): <https://github.com/apmcleod/MV2H>

- **M**ulti-pitch, **V**oice, **M**eter, note **V**alue, **H**armony → 5 sub-scores + a combined MV2H.
  The two you care about are **Meter** and **Value**.
- **Modular** — you can use it with partial annotation (e.g. skip Harmonry/Voice for a monophonic melody).
  That's explicitly a design goal, and it fits you perfectly: report **Meter + Value only**.
- **Handles non-time-aligned transcriptions via DTW** (`-a` / `-A`; tunable insertion/deletion penalty
  `-p DOUBLE`, default 1.0, since v2.2). Crucial for you: a user's recording and your reference score have no
  common clock, and if you insert/drop a note everything downstream shifts.
- Input is a simple text format: `Note pitch on onVal offVal voice` (ms), `Tatum time`,
  `Hierarchy bpb,sbpb tpsb a=al [time]`, `Key`, `Chord`. Converters for MusicXML and MIDI included.
  Note the `a=al` **anacrusis** field in `Hierarchy` — MV2H models pickup explicitly.
- Perceptual validity: see
  [Ycart et al., "Investigating the Perceptual Validity of Evaluation Metrics for Automatic Piano Music
  Transcription", TISMIR](https://transactions.ismir.net/articles/10.5334/tismir.57).

### 3.2 MUSTER (recommended secondary; what recent papers report)

**MUsic Score Transcription Error Rate** — <https://amtevaluation.github.io/> (downloadable eval script;
references Nakamura et al. 2018 and Hiramatsu et al. 2021 for the definitions).

- **Edit-distance based, by explicit analogy to WER in ASR.** Six sub-metrics, one per musical aspect. These
  are **error rates: lower is better**.
- The two rhythm ones:
  - **ε_onset** ("rhythm correction rate") — the amount of **scale and shift** operations needed to align
    every note's onset with the ground-truth sequence. Note that *scale* is in there, which means MUSTER
    partially forgives a global tempo error — good and bad. Be aware of that when interpreting it.
  - **ε_offset** — accuracy of predicted **musical durations** (note values).
- Reported by Beyer & Dai 2024 and the 2026 beat-based quantiser (numbers in §2.6), so it gives you
  **directly comparable published baselines** — that's its main value. A `muster` Python package ships as a
  custom dependency of <https://github.com/TimFelixBeyer/MIDI2ScoreTransformer>.

### 3.3 The metrics I'd actually put on your dashboard

1. **Note-value accuracy** — fraction of notes whose notated duration (as a rational number of beats) is
   exactly right. Used by Nakamura (~2.0% error on vocal melodies) and the 2026 paper (83.3% piano /
   90.2% guitar). Interpretable, brutal, and the thing users actually see.
2. **Onset-in-beats F1** — F1 of onsets on the *metrical* grid (not in seconds). 97.3% in the 2026 paper.
3. **MV2H Meter + Value** (with `-a` DTW alignment).
4. **MUSTER ε_onset / ε_offset** for comparability with published work.
5. **Bar-alignment rate** (bespoke) — fraction of notes assigned to the correct bar *and* correct beat within
   the bar. Catches phase/anacrusis errors that a scale-tolerant metric like ε_onset forgives.
6. **"Readability" proxies** (bespoke, cheap, and highly correlated with user complaints):
   tuplet count, tie count, count of notes shorter than a 16th, count of rests shorter than an 8th,
   distinct note-value cardinality. ScoreCloud's own docs concede the failure mode: *"sometimes it
   over-complicates the result"* (<https://scorecloud.com/learn/best-music-transcription-software/>). A
   score with 40 tuplets is *wrong* even if every onset time is within tolerance. **Track this.**
7. **Beat-tracking metrics** (`mir_eval.beat`, MIT) if you add a tracker: F-measure @ ±70 ms, **CMLc/CMLt**
   (correct metrical level, continuity required / total) and **AMLc/AMLt** (allowed metrical levels — octave
   and offbeat errors forgiven), plus P-score, Cemgil, Goto. **Report CMLt, not AMLt** — the CMLt↔AMLt gap
   *is* your octave/offbeat error rate, and for notation those errors are fatal, not forgivable.

**Evidence note:** "Symbolic Music Similarity" is a broad family (edit distances on pitch/duration strings,
geometric/earth-mover measures) originating in the MIREX SMS task and the QBH literature; useful background
is Toussaint-style rhythm edit distance work
(<https://pdfs.semanticscholar.org/d03d/528d4afdc91f63a425b8d05229054ab665d6.pdf>,
"Measuring the Similarity of Rhythmic Patterns"). **I would not use these as your primary metric** — they
measure similarity, not notational correctness, and they conflate pitch and rhythm errors. Also relevant:
Cogliati & Duan, "A Metric for Music Notation Transcription Accuracy"
(<https://www.semanticscholar.org/paper/A-Metric-for-Music-Notation-Transcription-Accuracy-Cogliati-Duan/5fdb5b2f64039dd228ea0cea907b1c0d35f75d95>)
and Rochester's AIR Lab notation-transcription project
(<https://labsites.rochester.edu/air/projects/AMT.html>).

---

## 4. Metrical position, downbeat, anacrusis, and global offset calibration

### 4.1 Joint (tempo, phase) fitting — the cheap, high-value primitive

This is the thing to build first. Formally: you have onsets `o₁..o_N` (seconds), optional durations, and
optional salience weights `w_i`. Search over tempo `T` (sec/beat) and phase `φ` (seconds):

```
score(T, φ) = Σ_i  w_i · min_{g ∈ G} ρ( (o_i − φ)/T − g )   +   λ · Σ_i complexity(g*_i)   +   μ · |log(T/T_user)|
```

where `G` is the allowed grid (e.g. multiples of 1/4 beat, or 1/12 for triplets), `ρ` is a robust loss
(Huber / truncated-quadratic so one bad onset doesn't dominate), the `λ` term is your existing coarseness
penalty, and the `μ` term is a soft prior pulling toward the user's stated BPM (drop it if the user says
"I don't know"). Pick `argmin`.

- Cost: a grid search over, say, 200 tempi × 48 phases × N onsets. For N=200 that's ~2 M evaluations —
  **single-digit milliseconds**. It is essentially free. You can afford to also search over
  `G ∈ {duple grid, triplet grid}` and over meter templates.
- **This is not a novel idea** — it is Dixon's multiple-hypothesis search reduced to a brute-force grid, and
  it is the tempogram peak found by direct optimisation instead of by DFT. It's also the mechanism claimed in
  a family of "Music transcription" patents: US 7,667,125 / 7,982,119 / 8,258,391 / 8,471,135, which describe
  combining the error values of all note onset events to find a **minimum composite error** and taking the
  tempo at that minimum. (Patent citations are for prior-art awareness; I did not assess claim scope. **Get
  counsel if this becomes a core differentiator.**)
- **Phase φ solves your anacrusis problem for free.** If the user starts a beat and a half early, the fit
  will place `φ` such that the first onset lands on beat 3 of a preceding partial bar. You then only need to
  decide *how many beats of pickup* to render — which is `ceil` arithmetic, not inference.
- **Do the tempo-octave check explicitly.** Evaluate `T`, `T/2`, `T*2` (and `T*2/3`, `T*3/2`) and prefer the
  one whose winning grid positions have the **lowest complexity** (i.e. fewest 16ths). Halving the tempo
  always fits at least as well on a finer grid, so you *must* have the complexity term or the search
  degenerates to "infinitely fast tempo, everything is a whole note" / "infinitely slow, everything is a
  32nd". This is the single most likely bug in a naive implementation.

**Evidence flag: thin.** I could not find a peer-reviewed paper that isolates and ablates "post-hoc
`(BPM, φ)` fit by quantisation-error minimisation" as its own contribution — it's folklore/engineering,
embedded inside Dixon's agents, tempogram peak-picking, and the patents above. So there's no published
effect size to quote. But the mechanism is sound and it's a few hours of work, so measure it yourself.

### 4.2 Downbeat / metrical position

Layered strategy, cheapest first:

1. **User tells you** (count-in, tap-tempo with accent, or "the first note is beat 1"). Always available,
   always correct. Prefer this.
2. **Onset-histogram phase.** Fold all quantised onset positions modulo the bar length, for each of the
   `B` candidate downbeat phases. Prefer the phase that (a) puts onsets on strong beats, (b) puts
   **longer notes** on strong beats (Temperley's preference rule 2 — the single most reliable cue in
   monophonic melody), and (c) puts **phrase-initial and phrase-final** notes on strong positions.
3. **Inner Metric Analysis metric weight** (§1.5) cross-correlated against 4/4, 3/4, 6/8, 2/4 templates.
   Onset-only, no training, cheap. This is exactly what de Haas & Volk's ISMIR 2016 meter-detection paper
   does.
4. **`beat_this` downbeat head.** But calibrate expectations: 78.3 F1 on GTZAN, ~61 on solo piano, and
   §1.2 suggests **~0.6–0.68 on solo voice**. Use as a vote, not an oracle.
5. **Neural symbolic downbeat** (PM2S / T5) — on GuitarSet the T5 gets **23.02** downbeat F1. Don't.

**Anacrusis representation:** MV2H's `Hierarchy bpb,sbpb tpsb a=al` has an explicit anacrusis field, so
whatever you do, make sure your internal model can represent "the piece begins `k` tatums before the first
downbeat" as a first-class value rather than as a leading rest hack. This also matters for MusicXML export
(pickup bar = a measure whose actual duration is shorter than the time signature implies).

### 4.3 Global onset offset calibration (systematic latency)

Three independent sources of systematic offset; they add up and all point the same way (recorded onsets
appear **late**):

**(a) Device/round-trip latency.** Standard methodology is a **loopback + cross-correlation** measurement:
emit a known signal, capture it after a full round trip, cross-correlate to find the delay.
- Android's official procedure: <https://source.android.com/docs/core/audio/latency/measure> and the
  loopback CTS test <https://source.android.com/docs/compatibility/cts/audio-loopback-latency> — "determined
  by measuring the time offset between the output and input, using a normalized correlation algorithm".
- `jack_delay` on Linux achieves sub-sample accuracy by measuring **phase** difference of tones.
- DAW practice: Audacity/Ardour record a click track against itself and shift by the measured difference
  (<https://manual.ardour.org/synchronization/latency-and-latency-compensation/>,
  <https://online.berklee.edu/help/audacity/1849138-how-to-correct-latency-in-audacity>).
- Professional targets are <5 ms round-trip; **consumer phones/browsers are routinely 40–150 ms**, which at
  120 BPM is **10–30% of a beat** — i.e. easily enough to flip an onset to the wrong 16th.

**For a web/mobile app the practical recipe is:**
- **If you play a click and the user is on speakers:** the click bleeds into the mic. **Cross-correlate the
  recorded signal against the click you emitted** → you get the *exact* end-to-end offset for that specific
  take, for free, with no calibration wizard. This is the best solution and it is a strong additional
  argument for the click-track UX. (Beware browser echo cancellation — disable it via
  `getUserMedia({audio: {echoCancellation: false, noiseSuppression: false, autoGainControl: false}})`,
  which you want anyway for pitch detection.)
- **If on headphones (no bleed):** use platform-reported latency —
  `AudioContext.baseLatency + AudioContext.outputLatency` on the web, plus the input device's reported
  latency — and offer a **one-time calibration wizard** ("tap along to this click") that stores a per-device
  offset. *(The `AudioContext.outputLatency` API detail is from my own knowledge, not from a source fetched
  in this research — verify browser support.)*

**(b) Onset-detector bias.** Any onset detector has a systematic lag (it fires after enough energy
accumulates). Measure it once on synthetic material with known onsets and subtract a constant. Cheap, and
purely a win.

**(c) Perceptual attack time / P-centre.** For *sung* notes the perceptual beat location of a syllable is not
its acoustic onset — a syllable beginning with a plosive or fricative has its perceptual centre tens of ms
*after* the acoustic start, and the offset depends on the consonant. Humming and whistling have soft onsets
where energy rises over 30–80 ms. This is real and it is systematic per-vowel/consonant.
**Evidence flag: I ran out of search budget before citing this properly.** The literature to look up is
"P-centre" / "perceptual centre" (Morton, Marcus & Frankish 1976) and "perceptual attack time" (Vos &
Rasch; Gordon). Practically: consider anchoring onsets to the **f0-stabilisation point** or the point of
maximum energy *rise* rather than first detected energy — and in any case a **single global learned offset
absorbs most of it**.

**Bottom line on §4.3:** a single scalar you currently assume to be zero is plausibly costing you 10–30% of
a beat on every note, systematically, in the same direction. That is the definition of a cheap fix.

---

## 5. UX / product shortcuts that make rhythm tractable

Ordered by (impact ÷ cost). The literature genuinely supports the claim that UX beats algorithms here — see
the 12.30-vs-68.28 MUSTER spread in §2.6, and the 2026 paper's own statement that metronome information
allows "completely eliminating the uncertainty of beat estimations."

1. **Record against a click, with a count-in.** Removes tempo, phase, drift, *and* (via click bleed, §4.3)
   device latency — four unknowns for one UI affordance. The count-in additionally establishes beat 1
   unambiguously, killing the anacrusis problem. Make it the default for "I want clean notation" and offer
   free-rhythm as the alternative.
2. **Tap tempo.** Two to eight taps, then take the median IOI (median, not mean — one bad tap ruins a mean)
   and *also* keep the tap phase as the initial `φ`. Standard practice in every metronome app
   (<https://taptempo.io/>, Soundbrenner, etc.); some use a rolling average. Combine with §4.1 as the `T_user`
   prior rather than as a hard constraint.
3. **Set tempo after the fact and re-quantise, live.** This is the highest-leverage *repair* affordance:
   the user hears/sees the score change as they drag a BPM slider and stops when it looks right. It requires
   that your pipeline keep **raw onset times in seconds** alongside the quantised score, and that
   re-quantisation be fast (it is — §4.1 is milliseconds). **If you build only one thing from this section,
   build this**, because it converts an algorithmic problem into a two-second human judgement.
   Pair it with a "×2 / ÷2" button to resolve the metrical-level ambiguity in one click.
4. **Post-hoc `(BPM, φ)` auto-fit** (§4.1) to seed that slider, plus show the **top-k candidates** the fit
   found (e.g. "88 BPM (best) / 176 BPM / 132 BPM"). k-best is exactly what qparse's k-best parsing is for
   (§2.7), and it converts a hard inference problem into a pick-one UI.
5. **Quantise strength.** DAW convention, well documented: Q-Strength as a percentage of the distance to
   the grid; **70–90% is the usual sweet spot** and 100% often reads as mechanical
   (<https://midi.org/5-midi-quantization-tips>, <https://www.soundonsound.com/techniques/groove-quantise-part-1>,
   <https://support.apple.com/guide/logicpro-ipad/quantize-parameters-lpip70c8d20d/ipados>).
   **Caveat specific to you:** for *playback feel* strength <100% is right, but for *notation* you must
   quantise to 100% — a note at 87% of the way to the grid has no notatable duration. So keep two
   representations: fully-quantised score times (for notation) and partially-quantised or raw times (for
   playback). Do not let a "strength" control leak into the notation layer.
6. **"Free rhythm / no bars" mode.** An honest escape hatch when tempo inference fails or the user is
   noodling. Render unmetered/proportional (senza misura), or a single very long bar, with note values
   derived from relative durations only. Also the right default for whistled/hummed *fragments*. Reduces the
   worst failure mode (confidently wrong bars) to a benign one. *Evidence flag: I did not get to verify
   MusicXML/MuseScore support for `senza misura` — verify, but a hidden time signature with a huge bar
   length is a known workaround.*
7. **Confidence-gated presentation.** When the `(T, φ)` fit's residual is high, or beat_this's beat
   probabilities are flat, *say so* and route to (3)/(6) instead of committing. ScoreCloud's public framing is
   instructive: it markets "70–90% of the content, which you then clean up" and says explicitly that
   "recordings with a steady pulse map more reliably onto a time grid than free-tempo performances" and
   "ScoreCloud Express does not know what your foot is tapping"
   (<https://scorecloud.com/learn/best-music-transcription-software/>,
   <https://scorecloud.com/learn/how-to-transcribe-melody/>). Setting the expectation that this is an
   editable draft is itself a product decision that lowers the accuracy bar you must clear.
8. **Bias toward simple notation.** Given a choice, be *wrong and readable* rather than *right and
   unreadable*. A melody notated in clean 8ths that's rhythmically approximate is more useful to a songwriter
   than a metrically-exact transcription full of 32nd-note tuplets and ties. Encode this as a tunable
   `λ` (complexity weight) exposed as a "simplify" slider.

---

## 6. Triplets, swing, dotted notes, ties across barlines, rests

### 6.1 The right architecture: two stages

Your flat duration list conflates two decisions that must be separated:

- **Stage A — quantisation:** map onsets/offsets to *exact rational score times* (in beats). Output:
  `onset_i ∈ ℚ`, `offset_i ∈ ℚ`, plus meter and anacrusis. This is §2 (metrical HMM / DP).
- **Stage B — notation spelling:** given exact rational score times, choose *how to write them* — dotted vs
  tied, tuplet brackets, beam groups, rest subdivision, splits at barlines and beat boundaries. This is
  **deterministic and rule-based**. No inference. This is §2.7 (rhythm trees) and what MuseScore/Dorico do.

You currently have neither stage properly; you have one fused heuristic. Splitting them is most of the win,
and Stage B is pure engineering with no ML risk.

### 6.2 Triplets / tuplets

**Grid choice — the concrete, stealable design decisions:**
- **12 ticks per beat** (2026 beat-based quantiser) covers straight *and* triplet values down to the 16th
  triplet. `12 = lcm(4, 3)`.
- **24ths of a quarter** (Beyer & Dai) — "1/24th fractions... 98.6% accuracy with 97 tokens". `24 = lcm(8, 3)`.
- MuseScore's approach: **separate quantisation grids for tuplet and non-tuplet notes**, with per-tuplet
  quantisation values that "cannot be greater than the `basicQuant` value, but they can be smaller and depend
  on the tuplet value (3, 5, 7, etc.)"; the grid is **adaptive and reduces when the note length is small**,
  with a user-settable "max. quantization" ceiling.
  (<https://musescore.org/en/developers-handbook/google-summer-code/google-summer-code-2013/midi-import-improvement-project/midi->,
  <https://musescore.org/en/handbook/3/midi-import>)

**Choosing straight vs triplet — practical algorithm:**
1. Quantise the passage twice: once on the duple grid, once on the triplet grid (or once on the combined
   1/12 grid).
2. Compare `total_timing_residual + λ · notation_complexity`, where triplets carry a **substantially higher**
   complexity weight (this is exactly qparse's tropical-semiring weight, §2.7).
3. **Add hysteresis / a latch per beat or per bar.** The dominant real-world failure is *alternation* —
   isolated spurious triplets scattered through a straight passage. MuseScore's bug tracker is full of
   exactly this class of complaint
   (<https://musescore.org/en/node/22015> "Tuplet recognition confused by larger quantization settings",
   <https://musescore.org/en/node/81776> "Failure to detect non-aligned triplet",
   <https://musescore.org/en/node/295647>). Model it as a two-state HMM over beats
   (`straight` / `triplet`) with a high self-transition probability, and require a *minimum run length*
   (a triplet must fill a whole beat) before allowing one.
4. Never emit a tuplet that doesn't fill a complete beat (or complete beat group). This one rule eliminates
   most unreadable output.

### 6.3 Swing

- **Detect, don't notate literally.** If a passage is swung, the correct output is straight 8ths + a
  "swing" performance indication (or a `♪=♪³♪` legend), **not** a page of quarter-eighth triplet pairs.
  Notating swing literally is the classic amateur-transcription tell.
- **Detection:** compute the **beat-upbeat ratio (BUR)** — for onsets falling between consecutive beats,
  histogram the phase `(o − beat_k)/(beat_{k+1} − beat_k)`. Straight 8ths cluster at 0.50; swung 8ths cluster
  around 0.60–0.70; hard swing approaches 0.75 (triplet). If the histogram has a clear mode >0.55, set the
  swing flag and quantise the off-beats to 0.5 anyway.
- **Key empirical fact:** the swing ratio **varies linearly with tempo**, and at slow tempi can reach
  **3.5:1** (≈0.78) — so a fixed threshold is wrong; make it tempo-dependent.
- Literature:
  - Dittmar, Pfleiderer, Müller, "A Swingogram Representation for Tracking Micro-Rhythmic Variation in Jazz
    Performances", JNMR 2017 —
    <https://www.audiolabs-erlangen.de/resources/MIR/2017-JNMR-SwingRatio/> ,
    <https://www.tandfonline.com/doi/full/10.1080/09298215.2017.1367405>. Local swing-ratio image +
    **dynamic-programming tracking of the most plausible swing-ratio trajectory** over time. This is the
    right structure if you want time-varying swing.
  - Laurier et al., "Swing Ratio Estimation", DAFx 2015 —
    <https://hal.science/hal-01252603/file/dafx_2015_swing_v3.pdf>. Autocorrelation of the onset-energy
    function + a simple rule set to estimate "how much a track is swinging". Cheap and adequate for a
    boolean flag.
  - Dittmar et al., "Automated Estimation of Ride Cymbal Swing Ratios in Jazz Recordings", ISMIR 2015 —
    <https://www.ismir2015.uma.es/articles/143_Paper.pdf> (drum-specific; method transfers).
- **Evidence flag:** all of this is jazz/drum literature. **Nothing measures swing detection on solo
  hummed/sung melody.** With ~6 off-beat onsets in a short hum, the BUR histogram will be very noisy.
  Recommendation: make swing a **user toggle** first, add auto-detection later, and require a decent number
  of off-beat onsets before auto-firing.

### 6.4 Dotted notes and ties — the notation-software rules

**Dorico's stated rules** (<https://archive.steinberg.help/dorico/v3/en/dorico/topics/notation_reference/notation_reference_note_rest_grouping/notation_reference_note_rest_grouping_c.html>):

> "Dotted notes are often notated as a single dotted note if they start at the beginning of bars, but as a
> tie chain that shows significant beat boundaries in the bar if they start part-way through bars."

and

> "Tied notes are affected by your note and rest grouping settings, as there are different conventions for
> how notes within tie chains should be divided to indicate significant beat boundaries within bars, and in
> which contexts they can cross beat boundaries."

Dorico exposes these as **Notation Options**, and explicitly acknowledges the rules "may contradict each
other, as they belong to different genres and styles of music". Note what that tells you: **there is no
single correct answer**, so this is a *preferences* layer, not an inference layer. Ship sensible defaults +
a couple of switches.

**The operational rule set (Gould, *Behind Bars*, is the standard reference — cite from memory, verify):**
1. A duration is spelled as a **single dotted note** iff it starts on a metrically strong position at or
   above the level implied by the dot; otherwise as a **tie chain**.
2. **Split at the strongest beat boundary the duration crosses.** Recursively: given `[start, end)`, find the
   coarsest metrical division point strictly inside it, emit the two halves, recurse. This *is* the rhythm-tree
   construction of §2.7, and it's ~20 lines of code.
3. **Never let a note cross a barline** — always split and tie. (Exception: some contemporary/`senza misura`
   practice. Ignore for v1.)
4. In 4/4, avoid a single note spanning beats 2–3 (i.e. crossing the mid-bar boundary) — split and tie. This
   is the classic "half note on beat 2" prohibition. Compound meters (6/8, 9/8) have their own grouping
   (3+3, 3+3+3).
5. Double-dotted notes: allow only on strong beats, and consider suppressing entirely by default (they read
   badly in lead-sheet contexts).
6. **Rests:** the same recursive splitting, but with additional rules — merge adjacent rests into the longest
   single rest that fits the metrical position (a full-bar rest is a whole rest regardless of meter; two beats
   of rest starting on beat 1 of 4/4 is a half rest; starting on beat 2 it must be two quarter rests), and
   **never tie rests**. Your current "no rests longer than the gap" behaviour is a direct symptom of not
   having this pass.

**On rests specifically:** once Stage A gives you exact rational onsets and offsets, rests are *derived*, not
detected — every gap between `offset_i` and `onset_{i+1}` becomes rests via rule 2/6. Note also the IONV
insight from §2.4: most notes end where the next begins, so **prefer extending a note to the next onset over
inserting a short rest**. Sung legato lines especially: a detected 80 ms gap between two notes is a breath or
a consonant, not an eighth rest. A "minimum notatable rest" threshold (e.g. don't emit rests shorter than a
quarter unless the gap exceeds some fraction of the beat) will remove a large class of visual noise.

---

## 7. Ranked recommendations

Impact = expected reduction in *notation* errors / user-perceived wrongness. Cost is rough engineering effort
for a competent implementer in your codebase.

| # | Thing to implement | Impact | Cost | Notes / evidence |
|---|---|---|---|---|
| **1** | **Evaluation harness first.** ~30–60 internally-recorded sung/hummed/whistled clips with hand-notated ground-truth scores. Metrics: note-value accuracy, onset-in-beats F1, bar-alignment rate, MV2H (Meter+Value, `-a`), MUSTER ε_onset/ε_offset, plus readability proxies (tuplet/tie/short-note/short-rest counts). | **Enabling — everything below is unverifiable without it** | **M** (1–2 wk incl. annotation) | MV2H is MIT Java; MUSTER script at amtevaluation.github.io. Reuse your existing `scripts/eval` harness pattern. Stratify by: click vs no click, steady vs rubato, hum vs sing vs whistle. |
| **2** | **Joint `(BPM, phase)` post-hoc fit** by minimising `robust timing residual + λ·complexity`, with explicit ×2/÷2/×3/2 octave candidates and a soft prior on the user's BPM. Return **top-k**. | **Very high** | **S** (2–4 d) | §4.1. Fixes the "assumes beat 1, zero offset" assumption, which currently corrupts *every* note. Milliseconds of compute. **Must include the complexity term or the search degenerates.** |
| **3** | **Global onset-offset calibration.** (a) subtract measured onset-detector bias; (b) if a click is played, cross-correlate the click bleed in the recording to get exact end-to-end latency; (c) otherwise use platform-reported latency + a one-time per-device calibration. | **High** | **S** (2–4 d) | §4.3. Consumer latency of 40–150 ms is 10–30% of a beat at 120 BPM, systematic and one-directional. Cheapest real win after #2. |
| **4** | **UX: click track + count-in recording mode** (default for "clean notation"), **tap tempo**, and **"adjust tempo → live re-quantise" slider with ×2/÷2**. | **Very high** | **M** (1–2 wk across api+web) | §5. Literature-backed: MUSTER ε_onset **12.30 with known beats vs 68.28 with estimated beats** (§2.6) — ~5.5× fewer onset errors. Requires keeping raw onset times in seconds alongside the score. |
| **5** | **Stage B: a proper note-value spelling / rest pass.** Recursive metrical splitting → dotted-vs-tie decisions, split at barlines and strong beats, derive and merge rests, minimum-notatable-rest threshold, prefer extend-to-next-onset over short rests. | **High** (readability specifically) | **M** (1 wk) | §6.4, §2.7. Deterministic, no ML, no model risk. Directly kills the "no rests longer than the gap" defect and the visual-noise class of complaints. Rhythm-tree recursion is ~20 lines. |
| **6** | **Replace per-note snapping with a global metrical DP/HMM.** State = metrical position in bar; note values = differences between successive positions; log-tempo Gaussian random walk `u_{n+1}~N(u_n,σ_v²)`; salience-weighted observations; Viterbi. | **High** | **L** (2–4 wk) | §2.3. Guarantees consistency (no overlaps/holes), handles tempo drift, gives context-dependent position priors. Reference point: simple prior ~47% → contextual model ~26% note-value error (§2.4). Monophonic ⇒ skip merged-output HMM entirely. |
| **7** | **Triplet support: 12-ticks-per-beat grid + a straight/triplet latch.** Two-state HMM over beats with high self-transition; tuplets must fill a whole beat; higher complexity weight. | **Medium-high** | **M** (1 wk, on top of #6) | §6.2. `12 = lcm(4,3)` per the 2026 paper; Beyer & Dai use 1/24 with 98.6% coverage. The latch is essential — scattered spurious triplets are the #1 MuseScore MIDI-import complaint. |
| **8** | **`beat_this` (MIT, small 2 M / 8.1 MB checkpoint) as a tempo/downbeat *candidate generator*** when the user gives no BPM. Feed its beats as candidates into #2; surface its downbeat as a suggestion. Deploy via **ONNX** (beat_this_cpp path). **Never enable `--dbn`** (pulls in madmom). | **Medium** (only helps the no-BPM path) | **M** (1 wk incl. ONNX + k8s inference-service wiring) | §1.1–1.4. Solo-instrument evidence is encouraging (GuitarSet 92.0/88.1, Filosax 99.5/98.5) but **solo-voice evidence is not** (~0.78–0.81 beat / ~0.60–0.68 downbeat F1, §1.2). Present as a suggestion, not truth. Fits your existing Python-gRPC ModelBackend seam. |
| **9** | **"Free rhythm / no bars" mode** + confidence gating that routes to it (or to #4's slider) when the `(T,φ)` residual is high. | **Medium** (kills the worst failure mode) | **S–M** (3–5 d) | §5.6–5.7. Converts "confidently wrong bars" into "honestly unmetered". Verify MusicXML/`senza misura` support in your notation package. |
| **10** | **Complexity/"simplify" weight `λ` exposed as a user control**, plus readability guardrails (cap tuplets per bar, cap ties, forbid notes below a floor unless the user opts in). | **Medium** | **S** (2–3 d) | §5.8, §6.2. ScoreCloud's own docs admit "sometimes it over-complicates the result". Being wrong-and-readable beats right-and-unreadable for songwriters. |
| **11** | **Swing detection (BUR histogram) → straight 8ths + a swing indication.** Tempo-dependent threshold; require a minimum count of off-beat onsets. | **Low-medium** | **M** (4–6 d) | §6.3. **Evidence is thin for solo melody** — no published evaluation on hummed/sung input. Ship as a user toggle first; auto-detect later. |
| **12** | **Symbolic rescoring layer** — Inner Metric Analysis metric weight + Temperley preference rules (long notes on strong beats; phrase boundaries on strong beats) as a *vote* on downbeat phase and meter, on top of #2/#6/#8. | **Low-medium** | **M** (1 wk) | §1.5, §4.2. Cheap and training-free, but **do not use symbolic beat induction as the primary tracker**: T5 symbolic gets **52.4** beat F1 on GuitarSet vs **92.0** for beat_this on the audio. |
| **13** | **Seq2seq quantiser** (T5-tiny à la arXiv 2604.22290: 2 layers, 4 heads, d=128, 187-token vocab, beam 5) taking beat-aligned tokens in. | **Potentially high, but speculative for us** | **XL** (needs a training corpus of sung performances + ground-truth scores that doesn't exist) | §2.6. Best published numbers (97.3% onset F1, 83.3–90.2% note-value accuracy) but trained on piano/guitar with GT beats, and no code/license released. **Revisit only after #1–#7 and only if the eval harness shows the DP model plateauing.** |
| — | **Do NOT use:** madmom pretrained models (CC BY-NC-SA — commercial use needs JKU permission); BeatNet (unlicensed + madmom dep); Beat Transformer (needs demixing, pointless for solo voice); Essentia/aubio without a license review (AGPL/GPL — *verify*). | — | — | §1.3, §1.4. |

### Suggested sequencing

- **Sprint 1:** #1 (harness) + #2 (`(BPM,φ)` fit) + #3 (offset calibration). Small, independent, immediately
  measurable. My expectation — flagged as **an estimate, not evidence** — is that #2 and #3 together remove
  the majority of *currently perceived* rhythm wrongness, because §2.5 shows the quantiser itself is near-
  saturated (~2% note-value error) once the grid is right, and your grid is currently unverified in both
  rate and phase.
- **Sprint 2:** #4 (click/tap/re-quantise UX) + #5 (spelling & rests). These are the two things users will
  *notice*.
- **Sprint 3:** #6 (metrical DP) + #7 (triplets). Now the model can express what the UX enables.
- **Later:** #8 (beat_this), #9, #10, #11, #12. #13 only on evidence.

### Where the evidence is genuinely thin

Stated plainly, because it matters for how much you should trust the numbers above:

1. **No published evaluation of beat tracking or rhythm quantisation on hummed or whistled audio.** All
   singing-beat-tracking work uses lyric singing separated from produced tracks (i.e. performed to a click).
   Whistling has near-zero onset transients. Treat every number in §1.2 as an optimistic ceiling.
2. **No published ablation of post-hoc `(BPM, φ)` fitting** as an isolated contribution — it lives inside
   Dixon's agent search, tempogram peak-picking, and a family of patents. No effect size to quote. Measure it.
3. **No swing-detection evaluation on monophonic melody**; all of it is jazz drums/ensembles.
4. **beat_this publishes no CPU latency or real-time factor.** The ONNX C++ port publishes none either.
   Benchmark the 2 M-param `small` checkpoint yourself before committing to an architecture.
5. **qparse's license is not stated** on its project pages; **MIDI2ScoreTransformer's** is not in its README;
   the **Utrecht IMA code's** is unknown; the 2025 singing-beat adapter work released **nothing**. Verify all
   four before any use.
6. **Essentia (AGPL) and aubio (GPL)** licenses are from my own recollection, not from a page fetched during
   this research. Verify before use — AGPL in particular is dangerous for a SaaS backend.
7. **`AudioContext.outputLatency`** browser support and accuracy: from my own knowledge, unverified here.
8. **P-centre / perceptual-attack-time** effect sizes for sung syllables: real phenomenon, but I exhausted
   the search budget before citing primary sources. Look up Morton, Marcus & Frankish (1976) and the
   perceptual-attack-time literature.
9. The **MV2H Meter and Value sub-score formulas** are not in the repo README; they're in the ISMIR 2018
   paper (<https://zenodo.org/records/1492339>), which I could not text-extract. Read it before you trust
   your own MV2H numbers.
10. Nakamura's ~2.0% vocal-melody note-value error was measured on **musicians performing notated melodies at
    a fixed 105 BPM on a MIDI keyboard**, with tempo *given*. That is much easier than your input. It bounds
    the quantiser, not the product.

### Primary sources, consolidated

Beat/tempo tracking:
<https://arxiv.org/abs/2407.21658> ·
<https://github.com/CPJKU/beat_this> ·
<https://github.com/mosynthkey/beat_this_cpp> ·
<https://github.com/CPJKU/madmom> ·
<https://raw.githubusercontent.com/CPJKU/madmom/main/LICENSE> ·
<https://archives.ismir.net/ismir2021/paper/000033.pdf> ·
<https://github.com/mjhydri/BeatNet> ·
<https://archives.ismir.net/ismir2022/paper/000019.pdf> ·
<https://github.com/zhaojw1998/Beat-Transformer> ·
<https://archives.ismir.net/ismir2022/paper/000074.pdf> ·
<https://arxiv.org/html/2503.10086v1> ·
<https://ofai.at/papers/oefai-tr-2001-19.pdf> ·
<https://librosa.org/doc/main/generated/librosa.beat.plp.html> ·
<https://transactions.ismir.net/articles/10.5334/tismir.43> ·
<https://arxiv.org/abs/2401.00209> ·
<https://github.com/tempoeval/tempo_eval> ·
<https://www.audiolabs-erlangen.de/resources/MIR/tempogramtoolbox/>

Quantisation / MIDI-to-score:
<https://proceedings.neurips.cc/paper/2001/file/5ec829debe54b19a5f78d9a65b900a39-Paper.pdf> ·
<https://arxiv.org/abs/1106.4863> ·
<https://www.snn.ru.nl/v2/serve.php?doc=Cemgil_aisb99.pdf> ·
<https://repository.ubn.ru.nl/bitstream/handle/2066/59219/59219.pdf> ·
<https://www.semanticscholar.org/paper/Automated-Rhythm-Transcription-Raphael/7ab6a049f86af1dfce04116aa7cc66d8e9c248a8> ·
<https://eita-nakamura.github.io/articles/Nakamura_etal_RhythmTranscriptionOfPolyphonicMIDIPerformances_SMC2016.pdf> ·
<https://arxiv.org/abs/1701.08343> ·
<https://arxiv.org/abs/1703.08144> ·
<https://arxiv.org/abs/1908.06969> ·
<https://bayesianscoremodel.github.io> ·
<https://archives.ismir.net/ismir2022/paper/000047.pdf> ·
<https://github.com/cheriell/PM2S> ·
<https://arxiv.org/abs/2112.00355> ·
<https://github.com/suzuqn/ScoreTransformer> ·
<https://arxiv.org/abs/2410.00210> ·
<https://github.com/TimFelixBeyer/MIDI2ScoreTransformer> ·
<https://arxiv.org/abs/2604.22290> ·
<https://arxiv.org/abs/2508.19262> ·
<https://arxiv.org/html/2507.00466> ·
<https://github.com/klangio/midi-beat-tracking> ·
<https://link.springer.com/chapter/10.1007/978-3-030-21392-3_20> ·
<https://qparse.gitlabpages.inria.fr/docs/scientific/> ·
<http://repmus.ircam.fr/cao/rhythm/home>

Symbolic meter / metrical analysis:
<https://www.link.cs.cmu.edu/melisma/> ·
<https://davidtemperley.com/melisma-v2/> ·
<https://direct.mit.edu/books/monograph/2326/Music-and-Probability> ·
<https://wp.nyu.edu/ismir2016/wp-content/uploads/sites/2294/2016/07/033_Paper.pdf> ·
<https://www.projects.science.uu.nl/monochord/ima/>

Evaluation:
<https://github.com/apmcleod/MV2H> ·
<https://zenodo.org/records/1492339> ·
<https://amtevaluation.github.io/> ·
<https://transactions.ismir.net/articles/10.5334/tismir.57>

Swing / notation practice / UX:
<https://www.audiolabs-erlangen.de/resources/MIR/2017-JNMR-SwingRatio/> ·
<https://hal.science/hal-01252603/file/dafx_2015_swing_v3.pdf> ·
<https://www.ismir2015.uma.es/articles/143_Paper.pdf> ·
<https://musescore.org/en/handbook/3/midi-import> ·
<https://archive.steinberg.help/dorico/v3/en/dorico/topics/notation_reference/notation_reference_note_rest_grouping/notation_reference_note_rest_grouping_c.html> ·
<https://scorecloud.com/learn/best-music-transcription-software/> ·
<https://midi.org/5-midi-quantization-tips> ·
<https://source.android.com/docs/core/audio/latency/measure> ·
<https://manual.ardour.org/synchronization/latency-and-latency-compensation/>
