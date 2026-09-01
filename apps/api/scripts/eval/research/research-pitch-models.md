# Monophonic melody / singing / humming / whistling transcription — state of the art, July 2026

> **Status of every proposal in this document — shipped, built-off, discarded, not pursued — is tracked in [`../RESEARCH-STATUS.md`](../RESEARCH-STATUS.md), which also lists where this text is now stale.** This file is kept as the record of the reasoning, not edited to match the code.

Research brief for Mushee/Solkey. Current stack for reference: ffmpeg decode → basic-pitch (22.05 kHz, 2 s hop-aligned windows) **or** CREPE-tiny (16 kHz frame-wise) → Viterbi over the salience map (`providers/pitch-decoder.ts`, Gaussian+uniform mixture transition with `jumpLogFloor`) → run segmentation → RMS-dip re-attack detector (`onset-detector.ts`) → beat-grid quantization. Two Python gRPC TF sidecars behind `ModelBackend`.

Everything below is sourced. Where a number could not be found in a primary source it says **no evidence found** rather than guessing.

---

## 0. Executive summary (the five things that matter)

1. **The frame-level f0 problem is largely solved; note-level segmentation on *our* input is not.** On the one benchmark that actually tests hummed melodies (HumTrans, corrected annotations), the best published system reaches **0.651 octave-aware note+onset F1** and every off-the-shelf system — including **basic-pitch, which we ship, at 0.268** — is at or below 0.36. Meanwhile frame-level RPA on singing is 95–97 % for half a dozen models. **Our headroom is in segmentation, octave discipline and domain-matched training, not in a better f0 tracker.** See §1f.
2. **Octave errors are the dominant, quantified failure mode on humming.** Requiring the correct octave halves the note-level F1 of every generic system: basic-pitch 0.729→0.432, MIR-ST500 0.813→0.488, JDC-STP 0.783→0.450, VOCANO 0.726→0.444. The one system trained *on humming* loses almost nothing (0.850→0.817). §1f, §3.
3. **CREPE is no longer competitive on cost, and only marginally competitive on accuracy.** CREPE-full costs ~1.43 s of CPU per second of audio; RMVPE ~0.29 s/s; SwiftF0 ~0.016 s/s — an ~88× spread on the same rig. ([pitch-benchmark](https://github.com/lars76/pitch-benchmark))
4. **SwiftF0 (Aug 2025) is the deployability winner** for the f0 stage: 95,842 params, **398 KB ONNX**, MIT, 16.2 ms CPU per second of audio, best overall across 8 datasets, best voicing F1 (0.885), most stable voicing threshold, **and the lowest octave-error rate of anything measured (1.2 % vs CREPE 2.5 %)**. Main caveat: its range tops out at 2093.75 Hz, which is a problem for whistling.
5. **For noisy singing specifically, RMVPE is the measured winner** (best on both vocal datasets: Vocadito 96.4 %, MIR-1K 96.0 % harmonic-mean; 0 dB "pub noise" 86.3 % RPA vs CREPE's 61.2 %). But it is 90.4 M params, 362 MB ONNX, ~0.29 RTF on CPU, contains a BiGRU (non-causal), collapses on non-vocal timbres (NSynth 68.2 vs SwiftF0 89.3), and its *shipped weights* have a CC-BY-NC training-data provenance problem.

**Two things that should change the roadmap, not just the model choice:**

- **Stop optimising offsets past ~0.65 COnPOff.** Two expert human annotators on solo vocals agree with each other at only **F = 0.64** (vocadito, [arXiv:2110.05580](https://arxiv.org/abs/2110.05580) Tbl 2). Published SOTA on MIR-ST500 is 0.61–0.625. We are chasing a metric whose ceiling is inter-annotator noise. **Optimise COnP (onset + pitch) and treat offsets as a rhythm-quantization problem.**
- **The remaining accuracy is in rhythm, not pitch.** T3MS reaches COnP 0.771 but its **note-value (duration) F1 is only 0.400**. And Klangio — the only profitable company in our exact market — has published *four* recent papers on beat/downbeat tracking and rhythm quantization and **zero** on note detection. Our beat-grid quantization stage is probably where the user-visible quality lives.

**Licensing landmines found (all verified):** madmom's *pretrained onset/beat models* are **CC-BY-NC-SA 4.0** (its code is BSD) — we cannot ship them. The HumTrans humming dataset is **CC-BY-NC-4.0**. Praat/Parselmouth are **GPL-3**. RMVPE's shipped checkpoint was trained partly on **M4Singer (CC-BY-NC-SA)**. FCPE's repo is MIT (only its *paper* is NC). PESTO is **LGPL-3.0** (workable server-side). Clean and shippable: SwiftF0, HarmoF0, SPICE, torchcrepe/CREPE, penn, basic-pitch, librosa, pysptk, pyworld.

---

## 1. Frame-level f0 / pitch estimators

### 1a. Master comparison table

Ratings are pulled from the cited primary source; **read the footnotes — several published numbers are in-domain (train/test on the same corpus with a random split) and are not comparable to cross-dataset numbers.**

| Model | Year | Params | Input / SR / hop | MIR-1K RPA | MDB-stem-synth RPA | PTDB RPA | Noise robustness | CPU cost | License (code / weights) | ONNX / TFLite | Source |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **RMVPE** | 2023 | **90.42 M** (per FCPE paper) | log-mel 256 bins, 16 kHz, hop 320 (20 ms), 360 bins @20 c | **97.27** (in-domain, clean vocals) / 95.42 (polyphonic MIR-1K) | 97.11 (in-domain) | no evidence found | **best measured**: 0 dB avg RPA 93.60 across white/pink/brown/pub; pub noise 0 dB 86.26 vs CREPE 61.22 | **293 ms / s of audio** | code Apache-2.0 (Dream-High); shipped weights via HF `lj1995/VoiceConversionWebUI` card = MIT — **but see §5 provenance risk** | **yes, `rmvpe.onnx` published** | [arXiv 2306.15412](https://arxiv.org/abs/2306.15412), [github](https://github.com/Dream-High/RMVPE) |
| **SwiftF0** | 2025 | **95,842** | STFT mag, 1024/256, 16 kHz (16 ms hop), 132 bins sliced (46.9–2093.75 Hz) → 200 log bins @33.1 c | 95.0 (HM) | 92.0 (HM) | 90.4 (HM) | clean→10 dB SNR CHiME-Home: HM 94.07→**91.80** (−2.27 pt). CREPE 80.70→78.97; PENN 89.23→**59.87** | **16.2 ms / s** (42× faster than CREPE) | **MIT** (code + weights) | **yes**, onnxruntime is the reference path | [arXiv 2508.18440](https://arxiv.org/abs/2508.18440), [github](https://github.com/lars76/swift-f0) |
| **PESTO** | 2023/2025 | **130 k** | VQT (γ=7), SR-agnostic, configurable hop (10 ms typical) | **97.7** (trained on MIR-1K); 94.6–95.6 cross-dataset | 97.0 (in-domain), 96.3 (trained PTDB) | 89.7 (in-domain), 88.3 (trained MDB) | clean 97.2 → 20 dB 93.7 → 10 dB 81.6 → 0 dB **46.8** (no aug). With background-music augmentation: 98.3 / 98.0 / 95.9 / 79.2–82.5 | RTF **0.0354** CPU (i9-12900H), 0.0032 GPU; <10 ms model latency | **LGPL-3.0** — usable server-side (see §5) | **yes**, `python -m realtime.export_onnx`; ">2× faster than TorchScript", "~0.7 ± 0.03 ms" stateless inference | [TISMIR 10.5334/tismir.251](https://transactions.ismir.net/articles/10.5334/tismir.251), [arXiv 2508.01488](https://arxiv.org/abs/2508.01488), [github](https://github.com/SonyCSLParis/pesto) |
| **CREPE (full)** | 2018 | 22.2 M | raw 1024-sample frames, 16 kHz, 360 bins @20 c | 97.5 (Sony eval) / 96.41 (HarmoF0 eval) / 95.66 (RMVPE eval, retrained) | 97.3 / 96.34 | 87.1 | musical accompaniment 0 dB: 84.22 RPA (HarmoF0 eval). Pub noise 0 dB: 61.22 | **1425.9 ms / s** | MIT (code + weights) | community ONNX/TFLite exist; official repo is TF/Keras | [arXiv 1802.06182](https://arxiv.org/abs/1802.06182), [github](https://github.com/marl/crepe) |
| **CREPE-tiny** (what we ship) | 2018 | param count: **no evidence found** in the README (only `--model-capacity {tiny\|small\|medium\|large\|full}`, documented as *"slightly lower accuracy"*, no figure) | as above | **no evidence found** — no published RPA for the tiny capacity on any benchmark | — | — | — | not separately benchmarked in any source found | MIT | — | [crepe README](https://github.com/marl/crepe#model-capacity) |
| **torchcrepe** | 2020 | 22.2 M | raw, 16 kHz | **71.4 (HM)** / RPA .9103 (penn eval) | 85.1 (HM) | 78.3 (HM) | HM 61.2 on PTDBNoisy | 722 ms / s | MIT | — | [github](https://github.com/maxrmorrison/torchcrepe) |
| **PENN / FCNF0++** | 2023 | 8.9 M (6.6 M in SWIPE-kernels paper's count) | raw, 8 kHz, 1440 bins @5 c | 90.6 (trained MDB+PTDB) | **99.6** (in-domain) | **95.1** (in-domain) | **fragile**: 10 dB HM 59.87 (from 89.23 clean); MIR-1K bg-music 0 dB **20.9 RPA** | RTF .0861 CPU (paper) / 126.6 ms/s (pitch-benchmark) | **MIT** | no official ONNX (paper explicitly says no ONNX export was used) | [arXiv 2301.12258](https://arxiv.org/abs/2301.12258), [github](https://github.com/interactiveaudiolab/penn) |
| **HarmoF0** | 2022 | **0.377 M** | log-spectrogram 352 bins @25 c, 27.5–4371 Hz, 16 kHz, hop 320 | **98.34** (5-fold CV, in-domain) | **98.40** (in-domain) | **93.56** (in-domain) | MIR-1K + accompaniment: clean 98.34 → 20 dB 97.82 → 10 dB 95.56 → 0 dB **85.11**. RPA≈RCA gap small ⇒ few octave errors | not benchmarked by pitch-benchmark; **no CPU latency published** | **MIT** (code + pretrained weights) | no official ONNX; PyTorch | [arXiv 2205.01019](https://arxiv.org/abs/2205.01019), [github](https://github.com/WX-Wei/HarmoF0) |
| **DeepF0 / DeepF0++** | 2021 / 2023 | 5 M (DeepF0); DeepF0++ 2023 | dilated 1-D conv on raw audio | 97.82 | 98.38 | 93.14 | 0 dB accompaniment: 79.52 | DeepF0++ RTF **1.2078 CPU** (slowest neural in penn's table) | DeepF0 original: **no public reference implementation found** (penn re-implements it under MIT) | no | [HarmoF0 Table 2](https://arxiv.org/abs/2205.01019), [penn Table I](https://arxiv.org/abs/2301.12258) |
| **FCPE** | 2025 | **10.64 M** | mel → Lynx-Net (depthwise-separable conv) | **96.79** | no evidence found | no evidence found | claimed "robust noise tolerance"; **no SNR table found in the abstract**, full-text tables not retrieved | RTF 0.0062 on RTX 4090; **5.3× faster than RMVPE, 77× faster than CREPE**; 1.06 GFLOPS vs RMVPE 4.91. **No CPU RTF published** | **repo LICENSE = MIT** (the arXiv *paper* is CC-BY-NC-SA 4.0 — that covers the PDF, not the code) | no official ONNX found; `pip install torchfcpe`, bundled weights | [arXiv 2509.15140](https://arxiv.org/abs/2509.15140), [github](https://github.com/CNChTu/FCPE) |
| **SPICE** | 2020 | param count: **no evidence found** | CQT, self-supervised | 92.7 (HM) / 91.4 RPA clean (own paper) | 89.4 (HM) | 77.8 (HM) | MIR-1K bg-music: clean 91.4 → 10 dB 90.0 → 0 dB **81.6** — flat, very robust, but low ceiling | 27.5 ms / s | Apache-2.0 (TF Hub / Google) | **TFLite published on TF Hub / Kaggle Models** | [pitch-benchmark](https://github.com/lars76/pitch-benchmark), [PESTO Table 5](https://transactions.ismir.net/articles/10.5334/tismir.251) |
| **SWIPE′** (classical, mel-sampled) | 2007 | 0 | spectral sawtooth-template matching; needs 327 ms window at 27.5 Hz floor | **96.2** | **96.1** | — | white noise: 96.2 → 0 dB 91.2 → −10 dB 75.2. Accompaniment 0 dB: 39.44 (HarmoF0 eval, SPTK impl) | 36.7 ms / s (pysptk); the mel-sampled research impl is heavier | pysptk = **BSD-3**; SWIPE itself unencumbered | n/a (pure DSP) | **[arXiv 2507.11233](https://arxiv.org/abs/2507.11233)** — the important one, see §1c |
| **pYIN** | 2014 | 0 | autocorr + HMM over pitch-candidate distributions | 95.4 (SWIPE-kernels eval) / 91.2 (HM) / 74.71 (RMVPE eval, retrained set) | 90.3 (HM) | 72.1 (HM) | white noise: **95.1 at 0 dB** (very robust). Accompaniment 0 dB: **14.70** (collapses) | 274.6 ms / s (librosa) | librosa **ISC**; original pYIN Vamp plugin **GPL** — use librosa | n/a | [librosa.pyin](https://librosa.org/doc/main/generated/librosa.pyin.html) |
| **Praat (AC)** | — | 0 | autocorrelation + path finding with explicit octave-jump cost | 92.6 (HM) | 90.7 (HM) | 86.2 (HM) | 10 dB HM 76.10 (from 90.13) | **2.8 ms / s** — fastest measured | Praat **GPL-3**; Parselmouth **GPL-3** — ⛔ do not link into a SaaS binary | n/a | [pitch-benchmark](https://github.com/lars76/pitch-benchmark) |
| **RAPT / SWIPE / YAAPT / DIO / Harvest** | — | 0 | — | 82.4 / 77.1 / 82.0 / — HM | — | — | all ≤ 52 HM on PTDBNoisy | 3.3 / 36.7 / 33.4 / — ms/s | pysptk BSD-3; pyworld MIT | n/a | [pitch-benchmark](https://github.com/lars76/pitch-benchmark) |
| **basic-pitch** (what we ship) | 2022 | 16.8 k | CQT-like harmonic stacking, 22.05 kHz | **36.5 (HM)**, RPA .307 | 12.4 (HM) | 23.1 (HM) | catastrophic | 23.3 ms / s | Apache-2.0 | ONNX + TFLite + CoreML all published | [pitch-benchmark](https://github.com/lars76/pitch-benchmark) |

**Critical caveat on basic-pitch:** the pitch-benchmark numbers (RPA .307, HM 33.1 % avg) are the *frame-f0 read-out* from a polyphonic multipitch model, which the SwiftF0 author acknowledges is out of basic-pitch's design envelope ("it was developed for polyphonic music transcription and not monophonic pitch estimation"). They are **not** a fair measure of basic-pitch's note-level transcription quality. They *are* however a fair warning that using basic-pitch's frame activations as a monophonic f0 contour is a bad idea.

### 1a-bis. ⚠️ The frequency-ceiling problem — checked against our own `instrument-ranges.ts`

This constraint is not discussed in any of the papers and it turns out to dominate provider selection for us. Every model's usable range is fixed by its output binning:

| Model | Native output range | Top note |
|---|---|---|
| CREPE / CREPE-tiny | 32.7 Hz – **1975.5 Hz** (360 bins @20 c from C1) | B6 |
| RMVPE | 32.7 Hz – **1975.5 Hz** (paper: "C1 (32.7 Hz) to B6 (1975.5 Hz) with 20 cents of intervals") | B6 |
| SwiftF0 | 46.875 Hz – **2093.75 Hz** (200 log bins @33.1 c) | C7 |
| PESTO | 27.5 Hz – 8055 Hz in the SWIPE-kernels reproduction; the released model's VQT range is configurable | — |
| **HarmoF0** | **27.5 Hz – 4371.3 Hz** (352 bins @25 c) | **C#8** |
| basic-pitch | 88 piano keys, A0 27.5 – **C8 4186 Hz** | C8 |

Now compare with what `apps/api/src/recordings/pipeline/profiles/instrument-ranges.ts` already declares: **piccolo 500–4200 Hz, violin 190–2800, recorder 350–2400, ocarina 400–2200, flute 240–2200, harmonica 200–1800.** And note there is **no `whistle` entry and no `humming` entry at all** — the closest is `voice-lead` at 75–1100 Hz.

Conclusions:

1. **Our CREPE path already cannot represent 6 of the instruments we advertise.** CREPE tops out at 1975.5 Hz; piccolo, violin, recorder, ocarina and flute all go higher. Presumably that is exactly why `profile-resolver.ts` routes high registers to basic-pitch. This is worth confirming in the code as a deliberate design choice rather than an accident.
2. **RMVPE has the same 1975.5 Hz ceiling as CREPE**, so adopting RMVPE does *not* fix the high-register problem — it inherits it. Combined with RMVPE's NSynth score of 68.2 (instrument timbres), RMVPE should be scoped to the *voice* profiles only.
3. **SwiftF0's 2093.75 Hz ceiling is only marginally better** (C7 vs B6). Skilled whistling routinely exceeds C7.
4. **HarmoF0 is the only high-accuracy f0 model found whose native range (27.5–4371 Hz) covers our entire declared instrument set *and* whistling** — while also being 0.377 M params, MIT-licensed with released weights, and architecturally designed to suppress octave errors. Its downsides are the non-causality claim (penn's authors: *"requires access to the full audio file […] prohibits use for low-latency or streaming-based inference"*) and the absence of an ONNX export or any published CPU latency figure.

**Our code already encodes this constraint**, which confirms the analysis: `profiles/pipeline-profile.ts` declares `TRAJECTORY_MODEL_CEILING_HZ = 1900` (conservatively under CREPE's 1975.5 Hz) versus `GLOBAL_MAX_FREQ_HZ = 4500` for basic-pitch, and `profile-resolver.ts:175` picks between them with `const ceiling = isTrajectory ? TRAJECTORY_MODEL_CEILING_HZ : GLOBAL_MAX_FREQ_HZ`. So the two-provider split is deliberate and it exists *because of the trajectory model's frequency ceiling*.

This reframes the model choice: it is **not** "pick the best f0 model", it is **"pick a per-profile pair"** — and note that:

- Swapping CREPE → **SwiftF0** raises `TRAJECTORY_MODEL_CEILING_HZ` only from 1900 to ~2050. Cheap win, doesn't change the architecture.
- Swapping CREPE → **RMVPE** raises it **not at all** (same 1975.5 Hz).
- Swapping CREPE → **HarmoF0** raises it to ~4300, which would let a single trajectory provider cover the *entire* declared instrument set plus whistling — potentially **collapsing the two-provider split and retiring the basic-pitch path**, along with its poor monophonic behaviour (§1f: 0.268 octave-aware note+onset F1 on humming) and one of our two Python sidecars. That is a much larger architectural prize than a few points of RPA, and it is the reason HarmoF0 deserves more attention than its 2022 date suggests.

### 1b. The independent benchmark that matters most

[`lars76/pitch-benchmark`](https://github.com/lars76/pitch-benchmark) (MIT) is, as of 2026, the only third-party head-to-head that puts RMVPE, CREPE, torchcrepe, PENN, SPICE, basic-pitch, Praat, pYIN, RAPT, SWIPE, YAAPT, DIO and Harvest on the same 8 datasets with the same voicing-threshold sweep. Its aggregate metric is a harmonic mean of {RPA, cents accuracy, voicing precision, voicing recall, octave accuracy, gross-error accuracy} — deliberately designed so that a model cannot win by being lenient about octave errors (RCA's blind spot).

Two tables from it are directly decision-relevant for us:

**Pitch accuracy + error types (averaged over all 8 datasets):**

| Algorithm | RPA ↑ | RCA ↑ | Cents err ↓ | RMSE Hz ↓ | **Octave err ↓** | Gross err ↓ |
|---|---|---|---|---|---|---|
| CREPE | **0.928** | **0.939** | 51.4 | 32.6 | 0.025 | 0.032 |
| RMVPE | 0.921 | 0.932 | 40.9 | 30.1 | 0.020 | 0.022 |
| Praat | 0.907 | 0.928 | 54.1 | 40.2 | 0.029 | 0.036 |
| **SwiftF0** | 0.905 | 0.911 | **35.4** | **25.1** | **0.012** | **0.017** |
| PENN | 0.895 | 0.912 | 48.7 | 28.7 | 0.024 | 0.032 |
| pYIN | 0.878 | 0.893 | 62.9 | 41.2 | 0.032 | 0.041 |
| SPICE | 0.862 | 0.875 | 60.4 | 35.6 | 0.028 | 0.039 |
| SWIPE | 0.799 | 0.846 | 140.0 | 75.4 | 0.087 | 0.102 |
| torchcrepe | 0.783 | 0.791 | 55.1 | 26.5 | 0.018 | 0.030 |
| RAPT | 0.774 | 0.793 | 114.5 | 63.8 | 0.059 | 0.085 |
| YAAPT | 0.692 | 0.753 | 280.4 | 113.8 | 0.119 | 0.145 |
| basic-pitch | 0.307 | 0.321 | 264.5 | 63.7 | 0.095 | 0.426 |

**Voicing detection (precision / recall / F1, averaged):** SwiftF0 0.903/0.871/**0.885**; YAAPT 0.838/**0.912**/0.868; Praat **0.937**/0.794/0.857; RAPT 0.844/0.897/0.857; RMVPE 0.902/0.793/0.837; PENN 0.937/0.751/0.827; CREPE 0.897/0.772/0.826; SPICE 0.823/0.804/0.808; torchcrepe 0.919/0.670/0.761; pYIN 0.913/0.633/0.731; basic-pitch 0.686/0.432/0.523.

**CPU cost per 1 s of audio:** Praat 2.8 ms · RAPT 3.3 · **SwiftF0 16.2** · basic-pitch 23.3 · SPICE 27.5 · YAAPT 33.4 · SWIPE 36.7 · PENN 126.6 · pYIN 274.6 · **RMVPE 293.3** · torchcrepe 722.0 · **CREPE 1425.9**.

**Threshold stability** (how sensitive the voicing threshold is across datasets — matters a lot for a product with heterogeneous mic inputs): SwiftF0 threshold CV **0.037**, CREPE 0.056, SPICE 0.080, RMVPE 0.114, Praat 0.125, PENN 0.239, torchcrepe 0.351. Performance CV: SwiftF0 **0.073**, PENN 0.121, Praat 0.120, torchcrepe 0.126, RMVPE 0.129, SPICE 0.157, CREPE 0.159.

**Per-dataset harmonic mean** (the singing-relevant columns bolded):

| Algorithm | Bach10Synth | MDBStemSynth | **MIR1K** | NSynth | PTDB | PTDBNoisy | SpeechSynth | **Vocadito** | Avg |
|---|---|---|---|---|---|---|---|---|---|
| SwiftF0 | 97.5 | 92.0 | 95.0 | **89.3** | 90.4 | 74.0 | **90.7** | 92.6 | **90.2** |
| RMVPE | 98.1 | 90.6 | **96.0** | 68.2 | 88.9 | 68.5 | 90.6 | **96.4** | 87.2 |
| CREPE | **98.5** | 90.5 | 95.7 | 80.2 | 79.7 | 53.8 | 88.3 | 95.6 | 85.3 |
| PENN | 97.3 | **94.0** | 89.0 | 63.3 | **91.0** | **76.4** | 84.8 | 82.4 | 84.8 |
| Praat | 96.0 | 90.7 | 92.6 | 70.7 | 86.2 | 65.3 | 88.2 | 88.2 | 84.7 |
| SPICE | 95.0 | 89.4 | 92.7 | 68.8 | 77.8 | 55.9 | 87.9 | 92.3 | 82.5 |
| torchcrepe | 96.7 | 85.1 | 71.4 | 83.8 | 78.3 | 61.2 | 79.7 | 89.0 | 80.6 |
| pYIN | 97.5 | 90.3 | 91.2 | 74.3 | 72.1 | 43.2 | 81.4 | 79.5 | 78.7 |
| basic-pitch | 23.7 | 12.4 | 36.5 | 77.7 | 23.1 | 12.6 | 61.2 | 17.8 | 33.1 |

The maintainer's own TL;DR: *"Best Human singing: RMVPE (87.2 % accuracy, best on Vocadito and MIR-1K)."* Note the **NSynth column** — RMVPE 68.2 vs SwiftF0 89.3. NSynth is instrument single-notes; RMVPE is trained on vocals and degrades badly on non-vocal timbres. If Mushee ever accepts *played* instrument input (the brief says "played"), that gap is a real product risk for an RMVPE-only pipeline.

### 1c. Two results that should change how you think about the problem

**(i) SWIPE has been massively under-reported as a baseline.** "Improving Neural Pitch Estimation with SWIPE Kernels" ([arXiv 2507.11233](https://arxiv.org/abs/2507.11233), ISMIR 2025) shows the SWIPE numbers cited across the SSL pitch literature (86.6 % MIR-1K, 90.7 % MDB) are artifacts of bad configuration. Their own implementation, with mel-scale spectrum sampling and a 27.5–8055 Hz search range, gets **96.2 % MIR-1K / 96.1 % MDB** — beating every published self-supervised neural estimator including PESTO. SPTK's SWIPE gets 96.5 % / 94.1 % if you cap the search at 2 kHz, but **collapses to 68.2 % / 61.4 % at an 8 kHz ceiling** — a directly actionable warning for us, because whistling forces a high ceiling.

Their pYIN baseline is also far better than the literature suggests: 95.4 % on MIR-1K, and remarkably noise-robust to *additive white noise* (95.1 % at 0 dB SNR).

They further show a **647-parameter** learned Toeplitz reweighting on top of SWIPE scores ("SWIPE-tiny") gets 96.6 % on MIR-1K and is *more* noise-robust than raw SWIPE (96.0 % at 5 dB, 95.3 % at 0 dB, 88.5 % at −10 dB vs SWIPE's 75.2 %). Latency/accuracy tradeoff (Table 4, 44.1 kHz): 372 ms window → 96.4 %, 186 ms → 96.4 %, 93 ms → 96.2 %, **46 ms → 85.0 %** (cliff).

⚠️ **No public code or weights found for the SWIPE-kernels models** — this is a paper-only result. Reproducing it is real work.

**(ii) The pYIN-vs-accompaniment contradiction is a measurement artifact, not a disagreement.** HarmoF0 reports pYIN at 14.70 % RPA at 0 dB; the SWIPE-kernels paper reports 95.1 % at 0 dB. Both are correct: HarmoF0's "noise" is *mixed-in musical accompaniment* (harmonic, pitched, competing), the SWIPE paper's is *additive white noise*. **For our product the relevant interferer is room noise + occasional backing track, i.e. somewhere between.** Any noise-robustness claim you read must be checked for which kind of noise it used. The RMVPE paper's "pub noise" (a real crowded-pub recording from the Audio Degradation Toolbox) is the closest published analogue to a user recording in a real room, and that is exactly the condition where RMVPE's lead is largest (86.26 vs CREPE 61.22 vs GIO 68.60 vs HarmoF0 61.62 vs pYIN 40.80).

### 1d. RMVPE detail (paper-verified)

Architecture: deep U-Net (5 residual encoder blocks → 4 intermediate conv blocks + 5 skip-hidden-feature filters → 5 residual decoder blocks) → Conv2D → **BiGRU (256 units)** → FC+sigmoid over 360 bins (C1 32.7 Hz – B6 1975.5 Hz, 20 cents/bin, f_ref = 10 Hz). Input: log-mel, 256 mel bins, 16 kHz, Hann 2048, **hop 320 = 20 ms**, band-limited 30–8000 Hz, trained on 2.56 s segments. Pitch read-out = local weighted average over ±4 bins around the argmax (same as CREPE); voicing confidence = row max, default threshold 0.5. Weighted BCE with ω = 5.

Polyphonic results (RPA/RCA/OA, %):

| | MIR-1K (mix) | MIR-ST500 | Cmedia |
|---|---|---|---|
| pYIN (+Spleeter) | 77.29 / 77.86 / 71.79 | 63.85 / 65.01 / 65.27 | 59.69 / 60.92 / 60.25 |
| CREPE (+Spleeter) | 91.05 / 92.16 / 88.71 | 81.61 / 82.36 / 76.59 | 74.61 / 75.05 / 75.19 |
| HarmoF0 (+Spleeter) | 88.63 / 88.97 / 87.64 | 83.00 / 83.35 / 81.80 | 79.08 / 79.64 / 81.83 |
| CRN-Raw | 82.75 / 91.92 / 85.53 | 76.64 / 82.48 / 80.81 | 75.88 / 79.86 / 78.85 |
| JDC | 82.28 / 82.98 / 78.61 | 80.09 / 80.38 / 82.86 | 79.00 / 79.25 / 82.64 |
| **RMVPE_Poly** | **95.42 / 95.84 / 91.86** | **89.32 / 89.84 / 84.54** | **83.57 / 84.04 / 85.09** |

0 dB noise (MIR-1K clean vocals + ADT noise), RPA / RCA:

| | white | pink | brown | pub | Avg |
|---|---|---|---|---|---|
| pYIN | 33.94/34.21 | 57.83/58.30 | 79.36/79.80 | 40.80/48.64 | 52.98/55.24 |
| CREPE | 92.15/95.61 | 89.01/90.07 | 91.47/93.75 | 61.22/71.24 | 81.16/87.67 |
| HarmoF0 | 74.61/75.18 | 74.85/76.41 | 97.18/97.24 | 61.62/65.05 | 77.07/78.48 |
| JDC | 70.65/72.01 | 71.32/82.24 | 85.25/85.45 | 72.44/73.14 | 74.92/77.96 |
| GIO | 94.20/94.90 | 89.10/91.40 | 97.10/97.50 | 68.60/74.70 | 87.25/89.63 |
| **RMVPE_Poly** | **96.47/96.96** | **93.87/95.13** | **97.78/97.95** | **86.26/87.44** | **93.60/94.37** |
| RMVPE_Vocal | 96.09/96.33 | 93.55/95.02 | 98.25/98.30 | 82.13/84.39 | 92.51/93.51 |

Degradation from 10 dB → 0 dB: CREPE −3.96 (white), −15.34 (pink), −4.48 (brown), **−29.67 (pub)**; RMVPE_Poly −1.08, −3.48, −0.08, **−10.07**.

Clean-vocals / monophonic (in-domain, 80/20 song-level split, baselines retrained):

| | MDB-stem-synth RPA/RCA/OA | MIR-1K vocals RPA/RCA/OA |
|---|---|---|
| pYIN | 65.83 / 67.01 / 77.57 | 74.71 / 74.99 / 79.07 |
| CREPE | 97.50 / 97.97 / 98.41 | 95.66 / 96.52 / 95.56 |
| HarmoF0 | **97.94 / 98.02 / 98.47** | 96.07 / 96.58 / 96.31 |
| JDC | 62.61 / 62.81 / 68.03 | 68.96 / 69.54 / 66.85 |
| RMVPE_Vocal | 97.11 / 97.12 / 97.68 | **97.27 / 97.28 / 96.70** |

**Read this honestly:** on *clean* monophonic audio RMVPE is a wash with CREPE and HarmoF0 (±1 pt). RMVPE's entire value proposition is **robustness** — accompaniment and real environmental noise. That is precisely our production condition (phone/laptop mic in a room), so the value is real, but do not expect a clean-studio-recording accuracy jump.

### 1e. Follow-ons to RMVPE worth knowing

- **DJCM** ([arXiv 2401.03856](https://arxiv.org/abs/2401.03856), [github Dream-High/DJCM](https://github.com/Dream-High/DJCM)) — same first author. Joint cascade of singing-voice separation + vocal pitch estimation, reports **+2.86 % OA over the previous SOTA (i.e. over RMVPE)** for vocal pitch estimation and +0.45 SDR for separation. Relevant only if we ever accept audio with a backing track. **Model size, license, CPU cost, and whether weights are released: not verified — could not confirm from the sources fetched.**
- **MAJL** ([arXiv 2501.03689](https://arxiv.org/abs/2501.03689)) — model-agnostic joint-learning framework, +2.71 % RPA. Framework, not a shippable model.
- **FCPE** ([arXiv 2509.15140](https://arxiv.org/abs/2509.15140)) — 96.79 % MIR-1K RPA at 10.64 M params, 5.3× faster than RMVPE, MIT repo, `pip install torchfcpe`, has a bundled `extact_midi()` (their spelling) that quantizes f0 non-neurally. **The README states the author has stopped maintaining it.** No CPU RTF published; no ONNX.
- **MF-PAM** ([arXiv 2306.09640](https://arxiv.org/abs/2306.09640)) — periodicity analysis + BiFPN, claims 99.20 % on a clean musical dataset, fewer params, targets noisy *and reverberant* environments. **No code/weights found.**
- **2026 papers, all code-less so far:** "Voting-based Pitch Estimation with Temporal and Frequential Alignment" ([2602.01727](https://arxiv.org/abs/2602.01727)) — ensemble of estimators with pre-voting temporal/frequency de-biasing + greedy decorrelated-subset selection, evaluated on speech + **singing** + music, outperforms individual SOTA in clean and stays robust for V/UV in noise. This is a cheap-to-implement idea for us: we already run two estimators. "Instantaneous Pitch Estimation via Wave-U-Net-Based Fundamental Waveform Enhancement" ([2606.14324](https://arxiv.org/abs/2606.14324)) — extracts the fundamental *waveform* as a denoising task then takes instantaneous frequency; explicitly evaluated on singing voice and degraded speech; targets steep pitch variation (portamento/vibrato).
- **"Whisper-style" f0**: **no evidence found** of a Whisper-architecture (encoder–decoder ASR-style) model that is competitive for *frame-level f0*. The Whisper-flavoured work in this space is all at the *note/symbolic* level (see §2) — sensible, since f0 needs per-frame resolution and Whisper's 20 ms-per-token encoder + autoregressive decoder is the wrong shape for it. Nearest relatives: OMAR-RQ ([2507.03482](https://arxiv.org/abs/2507.03482)) and other SSL music representation models, which are used as *features*, not f0 heads.

---

## 1f. ⭐ The one benchmark that is actually *our* task: HumTrans

This is the most product-relevant evidence in the entire report, and it is not part of the standard pitch-estimation literature.

**HumTrans** ([arXiv 2309.09623](https://arxiv.org/abs/2309.09623), Tencent ARC Lab, ICASSP-style 2023) is the largest public humming dataset: 500 compositions × 2 segments × 10 music-student subjects (5M/5F, combined range C2–C6), **14,614 files / 56.22 hours**, 44.1 kHz, hummed as "Da-Da-Da" *while listening to the melody on headphones*, so the recordings are **self-labelled against reference MIDI** — no manual annotation. BPM 52–156. Durations 4.9–29.9 s (mean 13.9 s). Prior humming datasets for comparison: MIR-QBSH 9.85 h (has scores), MLEnd Hums and Whistles 29.77 h (**contains whistling**, but *no* score annotations), AudioSet Humming 1.20 h, MTG-QBH 0.88 h.

The dataset paper's own baseline table reports F1 of **2.7–6.7 %** for VOCANO, Sheet Sage, MIR-ST500 and JDC-STP — i.e. total failure. **Do not cite those numbers.** The follow-up paper, **Dynamic HumTrans** ([arXiv 2410.05455](https://arxiv.org/abs/2410.05455), Mila / Laval / Concordia, Oct 2024), diagnosed two harness bugs: (a) HumTrans's ground-truth onsets/offsets are **misaligned** (subjects were told to follow the played melody, so their articulation lags the reference MIDI), and (b) the dataset paper used a **±1 cent** pitch tolerance instead of mir_eval's default ±50 cents. Dynamic HumTrans published corrected annotations and re-ran everything at 50 ms onset tolerance, offsets disregarded:

**Octave-INVARIANT** (a wrong octave counts as correct):

| Method | Note+Onset P | R | **F1** | Notes-only P | R | **F1** |
|---|---|---|---|---|---|---|
| **Dynamic HumTrans** | 0.670 | 0.675 | **0.673** | 0.848 | 0.854 | **0.850** |
| MIR-ST500 baseline | 0.601 | 0.608 | 0.604 | 0.808 | 0.820 | 0.813 |
| VOCANO | 0.568 | 0.561 | 0.564 | 0.729 | 0.723 | 0.726 |
| JDC-STP | 0.502 | 0.487 | 0.490 | 0.795 | 0.784 | 0.783 |
| **basic-pitch** (what we ship) | 0.392 | 0.497 | 0.434 | 0.653 | 0.847 | 0.729 |
| Sheet Sage | 0.171 | 0.170 | 0.170 | 0.446 | 0.442 | 0.444 |

**Octave-AWARE** (the correct octave is required — i.e. what a user actually sees on the staff):

| Method | Note+Onset P | R | **F1** | Notes-only P | R | **F1** |
|---|---|---|---|---|---|---|
| **Dynamic HumTrans** | 0.649 | 0.653 | **0.651** | 0.814 | 0.820 | **0.817** |
| MIR-ST500 baseline | 0.360 | 0.363 | 0.361 | 0.486 | 0.491 | 0.488 |
| VOCANO | 0.344 | 0.340 | 0.341 | 0.446 | 0.443 | 0.444 |
| JDC-STP | 0.297 | 0.279 | 0.286 | 0.463 | 0.442 | 0.450 |
| **basic-pitch** | 0.243 | 0.304 | 0.268 | 0.388 | 0.498 | 0.432 |
| Sheet Sage | 0.161 | 0.160 | 0.161 | 0.434 | 0.430 | 0.444 |

### What these two tables tell us — read this twice

1. **Octave errors are the single dominant failure mode of every off-the-shelf system on hummed input.** Compare the notes-only columns across the two tables: basic-pitch **0.729 → 0.432** (−41 % relative), MIR-ST500 **0.813 → 0.488** (−40 %), JDC-STP **0.783 → 0.450** (−43 %), VOCANO **0.726 → 0.444** (−39 %). Requiring the correct octave *cuts the score roughly in half* for all of them. This is the on-domain, quantified answer to research question 3, and it is far more alarming than the 1–3 % *frame-level* octave-error rates in §3b — because a systematic octave offset over a whole phrase is a single frame-level error pattern that ruins every note.
2. **Dynamic HumTrans loses almost nothing** (0.850 → 0.817, −4 % relative). Its authors: *"our method performs similarly well in the octave invariant and the octave aware setting, indicating that our architecture is able to learn very robust note representations."* The difference is that it was **trained on humming**. This is the strongest evidence in the report that *domain-matched training data beats a better generic pitch model* for our product.
3. **basic-pitch — which we currently ship — is the second-worst system tested on humming**, at 0.268 octave-aware note+onset F1. Note its precision/recall asymmetry (P 0.243 / R 0.304, and notes-only P 0.388 / R 0.498): it *over-generates* notes. That is consistent with a polyphonic model being asked to do a monophonic job.
4. **Sheet Sage is unusable for humming** (0.161). Given it is Chris Donahue's Whisper/Jukebox-lineage system, this is also the practical answer to "does a big pretrained-representation approach help?" — on bare humming, no.

### How Dynamic HumTrans works (and why it is directly copyable)

- Architecture: *"a minimal version of Spotify's BasicPitch model"* — harmonic-stacked CQT input → small CNN → per-frame softmax over 88 notes **plus a 89th "dummy" class meaning silence/inter-note gap**. Trained with plain cross-entropy, Adam @1e-3, batch 16, random 5–10-note excerpts.
- **No onset head at all.** *"Unlike other works in this field that first predict onsets and offsets and then condition note prediction on them […] our method infers onsets and offsets directly from the predicted notes."*
- The decode is the clever part — a **dynamic program over the frame×note affinity matrix with a hard structural constraint**: a path may go note *n* → *n* or note *n* → dummy(89), and from dummy(89) → any note. **It is illegal to move directly from one note to a different note.** Every note transition must pass through at least one silence frame. Then minimum-note-length cleanup. Onsets/offsets are read off the resulting path. This is a Viterbi-family decode like ours, but the state space includes an explicit *silence* state and the transition matrix is structurally sparse rather than Gaussian-in-pitch.
- Fully convolutional ⇒ *"convolution networks generalize well beyond the training length examples they are trained on […] we can perform inference on the entire sample"*. Good for streaming.

**Why this constraint works for humming and is a warning for singing:** "Da-Da-Da" articulation guarantees an amplitude gap between notes. The paper says so explicitly: *"which is a realistic constraint as in all humming samples, the space between two hummed notes is very noticeable."* For **legato singing and whistling there is no such gap**, so the mandatory-silence transition would merge notes. If we adopt this decode we need a mode switch: mandatory-silence for the hum profile, pitch-change-permitted for the legato/whistle profiles.

### ⛔ Licensing blockers on this line of work

| Asset | License | Verdict |
|---|---|---|
| HumTrans dataset (HF `dadinghh2/HumTrans`) | **CC-BY-NC-4.0** | ⛔ **Non-commercial.** We cannot train shipped production weights on it. Using it for internal benchmarking to inform engineering decisions is a legal judgement call — get sign-off; don't assume. |
| `shubham-gupta-30/humming_transcription` (Dynamic HumTrans) | **no LICENSE file** → all rights reserved | ⛔ Cannot vendor the code. The *ideas* (dummy-note DP decode, envelope-based onset correction heuristic) are described in the paper and reimplementable. |
| Dynamic HumTrans weights | **not released** — repo contains corrected annotation zips, training code, and `cqt_1d.pt` (a 354 KB CQT kernel, not a model) | Must retrain regardless. |
| MLEnd Hums and Whistles (29.77 h, **includes whistling**) | **not verified** — Kaggle page not machine-readable; HumTrans Table 1 records it as having **no score annotations** | Useless for note-level supervision; potentially useful as raw whistle audio. Verify terms before use. |

**Net conclusion:** the technique we most want is published, the data we would need is CC-BY-NC, and the weights don't exist. The commercially-clean version of this is: **reimplement the architecture + DP decode ourselves, and train it on humming/whistling data we collect or license.** That is a project, not an integration — but it is the only path found in the entire literature to a system that does not halve its accuracy on octave-aware humming.

---

## 2. Note-level singing / melody transcription (f0 contour → discrete notes)

### 2a. Metric hazards — read before comparing any two numbers

- **COn** = onset within 50 ms. **COnP** = onset + pitch (±50 c). **COnPOff** = onset + pitch + offset.
- **Onset tolerance differs**: 50 ms (MIR-ST500 convention) vs **100 ms** (MIREX Cmedia). YourMT3 gains ~10 F1 points purely from relaxing 50 → 100 ms.
- **Offset rule differs**: mir_eval default (within 20 % of note duration) vs a fixed 50 ms. basic-pitch uses the 20 % rule; MIR-ST500 papers usually use 50 ms. T3MS drops from 0.610 → 0.514 COnPOff across datasets *purely from offset-labelling convention*.
- **MIR-ST500's test set drifts**: the dataset ships as YouTube URLs, so songs disappear. Mel-RoFormer reports on **98 of 100** test songs. Cross-paper MIR-ST500 comparisons are approximate.
- ⭐ **The human ceiling.** On vocadito, two expert annotators *using Tony* agreed with each other at only **F = 0.64, F_no = 0.74, Acc = 0.83** (mean over 40 tracks; worst track F = 0.34) — [arXiv:2110.05580](https://arxiv.org/abs/2110.05580) Table 2. **Any COnPOff above ~0.65 on solo vocals is at or past inter-annotator noise.** This is the most important single number in this section: it tells us where to stop optimising offsets.

Also note: "**EFN**" in this literature means **EfficientNet**, not "Efficient Notation" — it is the EfficientNet-b0 CQT baseline shipped with the MIR-ST500 paper, and it requires Spleeter separation as pre-processing.

### 2b. MIR-ST500 leaderboard (F1 %, 50 ms onset tolerance)

| System | COn | COnP | COnPOff | Params | Available? |
|---|---|---|---|---|---|
| MT3 (zero-shot) | — | **3.62** | — | 60–94 M | Apache-2.0 — but **no singing class at all** |
| EFN / EfficientNet-b0 (MIR-ST500 baseline, ICASSP'21) | 75.44 | 66.63 | 45.78 | not stated | ⛔ **no license** |
| ROSVOT (zero-shot / OOD) | 72.1 | 65.9 | 47.4 | **12 M** | MIT code; ⛔ NC weights |
| JDCnote L+U (Kum et al. ICASSP'22) | 76.18 | 69.74 | 42.23 | not stated | ⛔ no license |
| YourMT3 YPTF.MoE+Multi (raw mix, no SVS) | — | 71.07 | — | not stated | ⛔ **GPL-3.0** |
| MusicYOLO-I | 78.2 | 71.4 | 58.6 | not stated | Apache-2.0, Baidu-only weights |
| A-VST / AE-SVT (Gu et al. 2023) | 78.1–78.3 | 70.0–70.7 | 52.4–52.8 | not stated | — |
| CE+CTC (Wang & Jang, TASLP 2022) | 79.6 | 74.4 | 57.4 | not stated | ⛔ no license (**shame — supports `device=cpu` and needs no source separation**) |
| Note-level Transformer (Park et al. 2023) | 78.7 | 75.7 | 59.1 | not stated | — |
| MERT (SSL frontend) | 77.5 | 75.1 | 53.0 | 324 M | — |
| SpecTNT | 80.1 | 77.8 | 55.0 | 8.4 M | ⛔ no code/weights (ByteDance) |
| Perceiver TF (ICASSP'23) | — | **78.5** | — | not stated | ⛔ no code/weights (ByteDance) |
| **T3MS** (Kim et al., TASLP 2025) | 80.6 | 77.1 | **61.0** | not stated | ⛔ no code |
| **Mel-RoFormer-large** | **81.9** | **79.8** | **62.5** | 64.6 M | ⛔ no code/weights |

**SOTA COnPOff on MIR-ST500 is ≈0.61–0.625 — and nothing at that level is downloadable.** Every system above 0.59 is industry (ByteDance/TikTok) with no release. The best *downloadable* MIR-ST500-trained artifacts are EFN (0.458) and CE+CTC (0.574), both **unlicensed**.

### 2c. ISMIR2014 / "Molina" (38 monophonic solo-vocal clips) — closest to our input

| System | COn F1 | COnP | COnPOff |
|---|---|---|---|
| Tony (pYIN + HMM) | 73 | 68 | 50 |
| Omnizart (HCN) | 79.0 | 61.7 | 49.9–59.4 |
| EFN | 79.16 | 63.63 | 49.55 |
| **basic-pitch** (what we ship) | — | **0.523** (F_no) | **0.346** (F) |
| VOCANO | 84.04 | 80.58 | 68.38 |
| A-VST v2 | **93.02** | 75.91 | 62.42 |
| **Yong et al. 2023 (phoneme-informed)** | **0.9305** | **0.8975** | **0.7728** |

Spotify's own paper: on Molina vocals, basic-pitch F_no **0.523** / F **0.346** vs VOCANO's **0.642 / 0.513**. **basic-pitch loses ~12 pts F_no and ~17 pts F to a 2021 system on singing.** It is instrument-agnostic and absurdly cheap, not accurate.

Other sets, for orientation: **SSVD v2.0** (clean sight-singing) Tony 0.731/0.679, Omnizart 0.605/0.515, Yong et al. **0.856/0.830**. **TONAS** (flamenco) — everything collapses; best COnPOff 0.30 (ROSVOT). **Cmedia** best COnPOff 0.402 (JDCnote L+U). **vocadito** VOCANO Acc 0.56 / F 0.50 / F_no 0.64 versus human agreement 0.83 / 0.64 / 0.74 — and vocadito's paper explicitly demonstrates that **quantizing f0 in frequency does not produce a reasonable note estimate**, which is the formal statement of why our current approach has a ceiling.

### 2d. ⭐ The central result: the decoder matters more than the model

Two independent lines of evidence say the same thing.

**(i) Same network, better decode → +0.38 F1.** Dynamic HumTrans (§1f) is *"a minimal version of Spotify's BasicPitch model"* plus a dynamic-programming path decode. On HumTrans, octave-aware note+onset F1: **0.651 vs basic-pitch's 0.268.** Same architecture family, ~4× the score, and the difference is (a) trained on humming and (b) DP decode with an explicit silence state instead of greedy peak-picking.

**What basic-pitch actually does for note creation** (verbatim from [arXiv:2203.09893](https://arxiv.org/abs/2203.09893) §3): *"A set of onset candidates … populated by peak picking Yo across time, and discarding peaks with likelihood < 0.5. Note events are created for each i in descending order of t0ᵢ, by tracking forward in time through Yn until the likelihood falls below a threshold τn for longer than an allowed tolerance (11 frames) … When notes are created, the likelihood of all corresponding frames of Yn are updated to 0. After all onsets have been used, additional note events are created by iterating through bins of Yn that have likelihood > τn in descending order … Finally, note events which are shorter than ≈120 ms are removed."* — **greedy peak-picking + forward tracking. No Viterbi, no HMM, no learned offset head, no monophonic constraint.** For monophonic input this is leaving a lot on the table.

**(ii) Learned boundary heads beat heuristics — but only when trained on singing.** ROSVOT's boundary head beats MusicYOLO's box detection by ~19 COnPOff pts and Tony's HMM by ~34 pts on the same test set. Whereas MT3, trained without a singing class, scores **3.62** COnP on MIR-ST500. Domain match is the whole game.

**(iii) A counter-intuitive ablation worth copying.** ROSVOT swept its note-boundary decoder's temporal resolution: 10.7 ms → COnPOff 70.7; 42.7 ms → 76.8; **85.3 ms → 77.4**; 170.7 ms → 77.2. **Coarser boundary resolution, matched to the ~80 ms soft-label uncertainty, beat finer resolution by 6.7 points.** Our `OnsetDetector` runs a 10 ms hop; this suggests we are resolving finer than the label noise justifies.

### 2e. System-by-system notes

**ROSVOT** ([arXiv:2405.09940](https://arxiv.org/abs/2405.09940), ACL 2024, [code MIT](https://github.com/RickyL-2000/ROSVOT)) — the best-engineered open system. U-Net backbone (K=4, 16× downsampling → 85.3 ms Conformer step), 2-layer Conformer bottleneck, three encoders (mel / word-boundary / **F0 embedding**), two decoders: a **note-boundary decoder** with soft ~80 ms labels + an **attention-based pitch decoder** that weight-averages frames inside each detected note. **12 M params.** MUSAN noise augmentation (SNR 6–20 dB, p=0.8) is what makes it noise-robust. In-domain (clean / noisy): COn 94.0/93.8, COnPOff **77.4/77.0**, pitch accuracy 97.0/97.1 — i.e. **essentially no degradation under noise**, versus TONY 43.9/28.4 and MusicYOLO 58.9/51.5. ⛔ **Blocker: the released checkpoints are trained on M4Singer only, which is CC-BY-NC-SA 4.0.** The paper itself says *"We use all the datasets under license CC BY-NC-SA 4.0."* MIT code, non-commercial weights. Note it also bundles RMVPE for pitch — the same provenance issue as §5a. No CPU benchmark published.

**VOCANO** ([ISMIR 2021](https://archives.ismir.net/ismir2021/paper/000036.pdf), [code MIT](https://github.com/B05901022/VOCANO)) — 3-stage: Demucs separation → Patch-CNN frame F0 → **note segmentation network** on a 9-channel input (spectrum + generalized cepstrum + GCoS at 3 window sizes, 174 log-freq bins 80 Hz–1 kHz, 19-frame context). Segmentation net is **PyramidNet-110 + ShakeDrop, 28.49 M params**, trained with a 4-way multi-task BCE over {silence/activation/transition, activation, onset, offset}, semi-supervised via Virtual Adversarial Training. Strong on ISMIR2014 (COnPOff 68.38) but **F1 3.35 % on humming** and Acc 0.56 on vocadito. Dormant since 2021 (CUDA 10.1 + apex). License-clean but a heavy 3-stage pipeline that needs Demucs.

**Omnizart** ([code MIT](https://github.com/Music-and-Culture-Technology-Lab/omnizart), 1.9k★, actively maintained to 2026-05) — its `vocal` app is the HCN architecture, VOCANO's predecessor. ISMIR2014 COn 0.795 / COnP 0.617 / COnPOff 0.499; SSVD COnP 0.605 / COnPOff 0.515. **The most license-clean maintained off-the-shelf vocal note transcriber.** Known incompatible with ARM macOS. No published CPU cost.

**MusicYOLO** ([code Apache-2.0](https://github.com/itec-hust/MusicYOLO)) — genuinely different idea: draw notes as **bounding boxes on the CQT** and detect them with YOLOX, then assign pitch by spectrogram peak search. Published 94.16 % onset F1 / 91.35 % offset F1 on ISMIR2014. ⚠️ Weights on Baidu Netdisk only; dormant since 2022; needs Spleeter + 35 s chunking for MIR-ST500.

**Tony / pYIN note transcription** ([code GPL-2.0-or-later](https://github.com/sonic-visualiser/tony)) — ⛔ **GPL, excluded.** Also worth understanding conceptually: it is a *human-in-the-loop annotation tool*, and its own paper measures human annotation efficiency, not autonomous F1. As an automatic baseline it is weak (ISMIR2014 COnPOff 50; ROSVOT's benchmark 43.9 clean / 28.4 noisy). **Tony produced vocadito's ground truth**, so Tony's conventions are baked into that benchmark.

**Nakamura/Nishikimi HMM note segmentation** ([ISMIR 2016](https://zenodo.org/records/1418023), ISMIR 2017 semi-tatum-synchronous HSMM) — **these papers do not report COnPOff/COnP/COn at all.** Their metric is frame-level "concordance rate" on 100 RWC-POP songs: majority vote 56.9, frame-based HMM 56.1, **BS-HMM 67.0, SBS-HMM 66.3**. Notably, **onset-deviation modelling did not help**. No code release found. **No COnPOff numbers exist for this line — no evidence found.**

**Sheet Sage** ([arXiv:2212.01884](https://arxiv.org/abs/2212.01884), [code](https://github.com/chrisdonahue/sheetsage)) — ⛔ **repo code MIT but the transcription models are CC-BY-NC-SA 3.0 → non-commercial**, plus Melisma and madmom encumbrances. Method: Jukebox (5 B-param generative LM) features → Transformer predicting melody per **sixteenth-note grid cell**, which requires beat/downbeat detection first (madmom) and is *"brittle to downbeat misdetection"*. HookTheory melody F1 0.744 all / 0.786 vocal. Cost: ~10 GB download, ≥12 GB GPU, *"several minutes"* per clip. **On humming it is the worst system tested (0.161).** Excluded on license and cost regardless.

**Klangio** ([research page](https://klang.io/about-us/research/)) — the closest commercial comparable (Sing2Notes, Melody Scanner). Their only singing-relevant publication is *"Dual Task Monophonic Singing Transcription"* in the JAES — **not on arXiv, not open access, no year/DOI given; I could not obtain it. No accuracy figures for singing exist publicly — no evidence found.** ⭐ **But their publication record is itself the signal**: they have *four* recent papers on **beat/downbeat tracking and rhythm quantization** ([2507.00466](https://arxiv.org/abs/2507.00466), [2508.19262](https://arxiv.org/abs/2508.19262), [2604.22290](https://arxiv.org/abs/2604.22290), [2506.22237](https://arxiv.org/abs/2506.22237)) and none on note detection. The only profitable player in our exact market has concluded the hard part is **rhythm, not pitch**. They also ship a manual **Edit Mode** because "AI may sometimes misinterpret musical nuances" — a product answer, not a model answer.

### 2f. Polyphonic/general AMT: do their onset heads help us?

| System | License | Weights | Size | Singing usable? |
|---|---|---|---|---|
| Onsets & Frames | Apache-2.0 | yes | ~18–26 M | ❌ piano only |
| Kong et al. high-res piano | README says Apache-2.0, **no LICENSE file**; repo **archived 2025-12** | pip | not stated | ❌ piano only |
| **hFT-Transformer** | **MIT** | yes (MAESTRO-v3) | **5.5 M** | ❌ piano only — **but its hierarchical two-level offset architecture gives Note-w/-Offset F1 90.53, the best published offset modelling anywhere.** Worth reading for the idea. |
| MT3 | Apache-2.0 | yes | 60–94 M | ❌ **no singing class; MIR-ST500 COnP 3.62** |
| MR-MT3 | MIT | HF | not stated | ❌ trained on Slakh/ComMU/NSynth, **vocals excluded** |
| **YourMT3 / YMT3+** | ⛔ **GPL-3.0** | HF Spaces | not stated | ✅ has explicit `Singing voice (melody)` + `(chorus)` tokens and works on raw mixes without separation; MIR-ST500 COnP 71.07 raw / 82.08 @100 ms tol; ~36× real-time **on a T4 GPU**. Excluded on license. |
| Timbre-Trap | MIT | — | not stated | ❌ outputs pitch salience, not note events |

**Verdict:** no general-purpose AMT system is usable for us. The piano systems are piano-only; MT3/MR-MT3 have no singing capability; the one that does (YourMT3) is GPL-3.0. **But hFT-Transformer's two-level offset head and MT3's failure mode are both instructive**: offsets need dedicated modelling, and a model without singing in its training distribution transfers at ~4 % F1.

### 2g. 2025–2026 papers

- **T3MS** ([arXiv:2502.12438](https://arxiv.org/abs/2502.12438), IEEE TASLP 2025) — **best reproducible MIR-ST500 COnPOff 0.610, end-to-end with no vocal separation.** Crucially it *also predicts note value* (quantized duration) → a time-aligned score. Note-value F1 **0.400** vs grid quantization 0.380 vs MuseScore 0.249; note-error-rate 64.4 vs 65.3 vs 94.7 vs AnthemScore 129.4. **⛔ No code.** But: even with onset+pitch F1 at 0.771, note-value F1 is only 0.400 — **quantitative confirmation that rhythm is the bottleneck, not pitch.**
- **STARS** ([arXiv:2507.06670](https://arxiv.org/abs/2507.06670), [code MIT](https://github.com/gwx314/STARS)) — unified transcription + alignment + style annotation, built on ROSVOT. COnPOff **71.0** vs ROSVOT 70.2. ⚠️ **requires phonemes/words as input → useless for wordless humming**, and its HF weights declare no license while descending from M4Singer.
- **VocalParse** ([arXiv:2605.04613](https://arxiv.org/abs/2605.04613), May 2026, [code Apache-2.0](https://github.com/pymaster17/VocalParse), **[weights Apache-2.0 on HF](https://huggingface.co/pymaster/VocalParse)**) — **the only 2026 singing-transcription paper.** 1.7 B params, Qwen3-ASR backbone + ~400 added pitch/note-value/BPM tokens, emits interleaved word+note sequences with chain-of-thought (lyrics first, then notes). Trained on 2000 h of self-crawled Mandarin pseudo-labelled by SOFA+ROSVOT. ⚠️ Reports **MAE metrics, not COnPOff** (Opencpop MAE_pitch 0.35 / MAE_note 0.43 / MAE_dur 0.33 vs ROSVOT 0.38/0.45/0.40); **no MIR-ST500 evaluation**; Mandarin-centric; 1.7 B params ⇒ GPU-only. Most permissive modern license, but the web-crawled training data is an upstream copyright question.
- **"Snapping Matters: Context-Aware Onset Refinement for AMT"** ([arXiv:2606.11903](https://arxiv.org/abs/2606.11903), June 2026, AudioLabs Erlangen) — DTW-based **onset-label refinement**; large F1 gains (ChoraleBricks 77.5 → 89.3). Not singing, but **directly relevant if we curate our own note labels** (see P0.3).
- **"Elucidate Gender Fairness in Singing Voice Transcription"** ([arXiv:2308.02898](https://arxiv.org/abs/2308.02898), ACM MM) — female singers score consistently **higher** COnPOff/COnP than male across MIR-ST500 / N20EMv2 / ISMIR2014 and across four SSL backbones. Relevant to our QA matrix and to per-user expectation setting.
- **Negative result worth knowing:** a sweep of the full ISMIR 2025 program (111 papers) found **no note-level singing/melody transcription paper at all**; arXiv sweeps return exactly one 2026 one (VocalParse). The field has migrated from "beat COnPOff on MIR-ST500" toward "annotate data for singing-voice synthesis", which is why recent work assumes lyrics/phonemes are available — an assumption that does not hold for humming or whistling.

### 2h. Note-level licensing decision table

| System | Code | Weights | Verdict for us |
|---|---|---|---|
| **basic-pitch** | Apache-2.0 | Apache-2.0 in-repo | ✅ clean; weakest singing accuracy |
| **omnizart** (`vocal`) | MIT | via CLI, no separate terms | ✅ **cleanest maintained option**, ~COnPOff 0.50 |
| **MusicYOLO** | Apache-2.0 | Apache-2.0, Baidu-only | ✅ license-clean, ⚠️ operationally awkward, dormant |
| **VOCANO** | MIT | MIT, links vague | ✅ license-clean, ⚠️ 2021 stack, 3 stages, 28.5 M + Patch-CNN + Demucs |
| **VocalParse** | Apache-2.0 | Apache-2.0 | ✅ most permissive modern model; 1.7 B params, Mandarin-centric |
| **ROSVOT** | MIT | ⛔ M4Singer CC-BY-NC-SA | ⚠️ **code yes, weights no** — retrain to use |
| **STARS** | MIT | ⛔ no license declared, NC lineage | ⚠️ same, plus needs lyrics |
| **YourMT3** | ⛔ GPL-3.0 | — | ❌ |
| **Sheet Sage** | MIT code / ⛔ CC-BY-NC-SA 3.0 models | — | ❌ |
| **Tony / pYIN plugin** | ⛔ GPL-2.0+ | — | ❌ (use `librosa.pyin`, ISC, instead) |
| **EFN, CE+CTC, Kum et al., HumTrans, Dynamic HumTrans** | ⛔ **no license at all** | — | ❌ all-rights-reserved; reimplement ideas only |
| **MT3 / MR-MT3 / hFT-Transformer / Timbre-Trap** | Apache-2.0 / MIT | yes | ✅ clean, ❌ no singing capability |
| **Perceiver TF / SpecTNT / Mel-RoFormer / T3MS / Klangio** | — | ⛔ unreleased | ❌ unavailable at any price |

---

## 3. Octave errors: mechanism and published remedies

### 3a. Why estimators halve and double

Five distinct mechanisms, each with a different fix:

1. **Subharmonic ambiguity in template/salience matching.** Every harmonic of a true f0 is *also* a harmonic of f0/2, f0/3, … So a harmonic-summation or sawtooth-template score at f0/2 receives contributions from all of f0's partials and can exceed the score at f0. This is the single dominant cause of *octave-down* errors, and it is structural, not noise-driven. The classical fix is baked into **SWIPE′**: *"a common variant of the SWIPE algorithm removes the non-prime harmonics (except for the first one) of all kernels to reduce the problem of octave errors."* SWIPE′ is what SPTK ships and what everyone means when they say SWIPE ([arXiv 2507.11233 §2.1.2](https://arxiv.org/abs/2507.11233)).
2. **Autocorrelation peak-picking.** ACF has peaks at every integer multiple of the period, so picking the wrong lag gives an exact octave-down. YIN's cumulative mean-normalized difference function plus an absolute threshold is the classical mitigation; pYIN replaces the single threshold with a *distribution* of thresholds and then does HMM decoding over the resulting candidate distribution.
   The formal version, from Camacho's SWIPE thesis §2.2: if the spectrum has a **single** component at *f*, then *f*/2, *f*/3 … *f*/n all receive an **identical** subharmonic-summation score, so they are *"equally valid to be recognized as the pitch"*. Hermes' SHS breaks the tie with a **geometric harmonic decay `r^(k−1)`, r = 0.84**, fitted empirically on speech. That constant is the entire reason SHS works.

2b. **Which direction? Mostly down.** Camacho's Table 4-2 gives the proportion of gross errors that are *over*estimations, averaged over 3 speech databases: CC 0.0, SHS 0.1, RAPT 0.2, SWIPE′/SWIPE 0.4, YIN 0.5, TEMPO 0.6, ESRPD 0.7. **Most algorithms halve far more often than they double.** On his music database SWIPE′ shows 1.00 % underestimates vs 0.10 % overestimates — a 10:1 ratio.

2c. **Register dependence is severe, and it works against us.** Camacho's music gross-error rate by octave for SWIPE′: 1.20 % @46 Hz, 1.00 % @92 Hz, 2.30 % @185 Hz, **0.13 % @740 Hz**. Averaged across all algorithms: **8.10 % @46 Hz → 1.80 % @92 Hz**. And for singing specifically, Babacan et al. ([arXiv:1912.12609](https://arxiv.org/abs/1912.12609) §4.2) measured GPE on 524 annotated singing recordings with **EGG ground truth** across 6 trackers (Praat, RAPT, SRH, SSH, STRAIGHT, YIN): GPE drops **by a factor of 2–4 going baritone → soprano, for every single tracker**, and FPE improves 2–7 cents. ⇒ **Low male voices and low humming are structurally the hardest case**, which is precisely our `low` profile.

3. **Missing / weak fundamental.** Humming with a closed mouth, low male voices, and phone mics with low-frequency rolloff all produce a spectrum where H2 is stronger than H1. Camacho's worked example is exactly our failure case: vowel /u/ at F0 = 190 Hz, bandpassed to **300–3400 Hz** (telephone simulation) — the fundamental is *gone*, and there is *"an intense second harmonic at 380 Hz, caused probably by the first formant"*. **HPS (multiplicative harmonic product) cannot recover the pitch at all**; SHS (additive) can, because a missing harmonic contributes 0 rather than zeroing the product. Practical rule: **never use multiplicative harmonic product on hummed or phone-mic input.**

   Also relevant to our adverse-reverb tier: at T60 = 100 ms YIN's GPE rises from 0.91 % to ~7 %, and all methods rise 3–6 percentage points as T60 goes 100 → 500 ms, while **FPE only rises 3–5 cents**. ⇒ **Reverb converts into gross/octave errors, not fine errors.** STRAIGHT was most robust. ([arXiv:1912.12609](https://arxiv.org/abs/1912.12609) §4.4)

4. **Whistling — and a correction to the common assumption.** ⚠️ The usual "whistling is 1–3 kHz" claim is wrong at the low end. The one directly-on-point published study — Dias, Ventura & Gaspar, *Automatic Transcription of Musical-Whistling: Comparing Pitch Detection Methods*, JETC 2008 ([PDF](https://web.tecnico.ulisboa.pt/~ist13495/publications/08-JETC-BDias-transcription.pdf)) — characterises the human whistle as *"a close flue pipe instrument … classified as a 'sopranino'"* with a **typical compass of C5–C8 = 523–4186 Hz**, three octaves. Their tracker band-limits to exactly that.

   Their empirical findings are directly usable:
   - **Harmonic-product/summation methods octave-fail on whistling.** Without a 99th-order FIR bandpass pre-filter, *"the estimated pitch would be oscillating between a base range of values and the same range translated **one octave upwards**"*, and they note *"this was expected as HPS is known to require signals with significant harmonic components … which do not happen in whistle sounds."*
   - **Time-domain ACF/AMDF is the right family for whistling**, and counter-intuitively *"the existence of weak F0 multiples (overtones) have the positive effect of reducing octave errors"* for spectral-location estimators. Best result: time-domain ACF at a 512-sample window, **0 % insertion / deletion / substitution errors** on a whistled *Happy Birthday*, at 15 % of real time. HPS was worst at 12 % total error. ⚠️ Caveat: tiny evaluation (~25 notes) — treat as directional, not definitive.
   - ⚠️ **Both octave directions occur on whistling**: the *observed* HPS failure was octave-**up** (a spurious 2f₀ peak from lip/turbulence noise taken as the fundamental), while the *theoretical* SHS single-component failure is octave-**down**. Do not assume one direction.

   Separately, the SWIPE-kernels paper quantifies the search-range trap: SPTK's SWIPE at a 2 kHz ceiling scores 96.5 % on MIR-1K, but at an **8 kHz ceiling collapses to 68.2 %** ([Table 1](https://arxiv.org/abs/2507.11233)). Raising the ceiling for whistles *directly buys octave errors* unless the implementation is range-robust; their mel-sampled version held 96.2 % over 27.5–8055 Hz, so it is fixable but not free.

   **Beyond Dias et al. 2008, essentially nothing exists.** An exhaustive sweep (WebSearch, DuckDuckGo, OpenAlex, arXiv API) found no other primary work on whistling f0 or whistling onset detection with quantified results. The adjacent hits do not transfer: Irish *tin whistle* transcription (a harmonic, tongued flute), dolphin/bird "whistle extraction" (contour extraction from spectrograms), and an inaccessible 2018 ICSPIS paper on whistled-melody extraction with 2 citations. **Whistling is a genuine literature gap — we will have to solve it ourselves.**
5. **Model bin-range and training-distribution edges.** PENN's cross-domain figures are the cleanest demonstration: trained on MDB-stem-synth only, it scores **63.2 %** RPA on PTDB, and trained on PTDB only, **51.6 %** on MDB — because the training pitch histogram doesn't cover the test range, so the model piles probability into the wrong octave. penn's conclusion: *"it is desirable for the training data distribution of a neural pitch estimator to at least cover the distribution used during inference"* ([arXiv 2301.12258](https://arxiv.org/abs/2301.12258)). For us this means: whatever model we pick, verify its trained pitch range covers whistle range (up to ~3–4 kHz) and low hum (down to ~65 Hz).

### 3b. How to *measure* octave errors

- **The RPA − RCA gap is the standard proxy.** penn: *"RCA does not penalize octave shifts. Therefore, the gap between RPA and RCA is an indicator of half- and double-frequency errors."* HarmoF0 makes the same argument for its own results. FCNF0++'s gap is 0.27 pt (.9825 → .9852).
- **RCA is actively misleading as a headline metric.** SwiftF0's paper makes this point sharply: Praat gets the *highest* RCA on clean audio (90.27) *because* RCA credits its octave errors as hits. If we build an internal eval, RCA must not be the target.
- **A better direct metric** (from pitch-benchmark, MIT, reusable): **Octave Accuracy** = `exp(−10 · fraction_of_frames_with_octave_error / N)`, where an octave error is a relative error > 40 % or an absolute deviation of 1100–1300 cents; plus **Gross Error Accuracy** = `exp(−5 · fraction |Δ| ≥ 200 cents)`. Measured octave-error *fractions* across 8 datasets: **SwiftF0 0.012, torchcrepe 0.018, RMVPE 0.020, PENN 0.024, CREPE 0.025, SPICE 0.028, Praat 0.029, pYIN 0.032, RAPT 0.059, SWIPE 0.087, basic-pitch 0.095, YAAPT 0.119.** So on real data, octave errors are a 1–3 % frame-level phenomenon for good estimators and 6–12 % for the classical ones — which, at the *note* level after majority voting over ~20–100 frames, mostly disappears for the good ones and mostly does not for the bad ones.

- **Noise turns octave errors on.** Inverting SwiftF0's published OA (`n/N = −ln(OA)/10`) on held-out Vocadito + Bach10-mf0-synth + SpeechSynth gives the per-frame octave-error rate directly, clean vs 10 dB SNR CHiME-Home noise:

  | Algorithm | clean | **@10 dB SNR** |
  |---|---|---|
  | SwiftF0 | 0.33 % | **0.67 %** |
  | CREPE | 0.77 % | 0.87 % |
  | Praat | 1.70 % | **5.70 %** |
  | PENN | 1.43 % | **8.93 %** |
  | pYIN | 2.50 % | 4.03 % |
  | RAPT | 2.80 % | 5.00 % |
  | SWIPE | 4.50 % | 7.40 % |
  | YAAPT | 5.13 % | 10.07 % |
  | **basic-pitch** | **10.10 %** | **11.53 %** |

  Two things jump out: **basic-pitch is octave-wrong on ~10 % of frames even on clean audio** (consistent with its 0.268 octave-aware humming F1 in §1f), and **PENN goes from 1.4 % to 8.9 % under mild noise** — a 6× degradation that makes it unusable for consumer mic input despite its excellent in-domain RPA.

- **The RPA − RCA gap, tabulated** (50-cent threshold; gap ≈ fraction of voiced frames that are chroma-correct but wrong-octave):

  | Model | Dataset | RPA | RCA | Gap |
  |---|---|---|---|---|
  | CREPE | MDB-stem-synth | 96.7 | 97.0 | 0.3 pp |
  | pYIN | MDB-stem-synth | 91.9 | 93.6 | 1.7 pp |
  | PESTO | MIR-1K | 97.7 | 98.0 | 0.3 pp |
  | CREPE | MIR-1K (clean vocals) | 97.5 | 98.0 | 0.5 pp |
  | CREPE | **PTDB-TUG (speech)** | 87.1 | 89.9 | **2.8 pp** |
  | PENN/FCNF0++ | MIR-1K | 90.6 | 92.4 | 1.8 pp |
  | CREPE | MIR-1K + accompaniment | 91.05 | 92.16 | 1.1 pp |
  | **CRN-Raw** | MIR-1K + accompaniment | 82.75 | 91.92 | **9.2 pp** |
  | RMVPE-Poly | MIR-1K + accompaniment | 95.42 | 95.84 | 0.4 pp |
  | **CREPE** | MIR-1K + **pub noise @0 dB** | 61.22 | 71.24 | **10.0 pp** |
  | CREPE | MIR-1K + white noise @0 dB | 92.15 | 95.61 | 3.5 pp |

  Note the last two rows: under *white* noise CREPE's octave discipline holds (3.5 pp) but under **realistic room/babble noise it loses 10 pp to octave errors alone**. That is the condition our users record in.

- ⚠️ **No paper reports "X % of all pitch errors are octave errors" as a headline figure on MIR-1K / MDB / PTDB.** The field reports it as the RPA/RCA gap or (recently) via SwiftF0's OA. **No evidence found** for a single canonical fraction — don't expect to cite one.

### 3b-bis. ⭐ What the reference implementations actually do — and a discrepancy in ours

This is the most directly actionable part of the octave-error research, because it is checkable against our own code.

**CREPE and torchcrepe** (`crepe/core.py::to_viterbi_cents`, `torchcrepe/decode.py`, both MIT) use this transition matrix:

```python
xx, yy = np.meshgrid(range(360), range(360))
transition = np.maximum(12 - abs(xx - yy), 0)
transition = transition / transition.sum(axis=1, keepdims=True)
```

That is a **triangular kernel with a hard cutoff at ±12 bins**. At 20 cents/bin this is **±240 cents = ±2 semitones**, and it assigns **exactly zero** probability to any larger frame-to-frame jump. So in reference CREPE an octave jump between adjacent frames is *structurally impossible*. (Note: the widely-repeated claim that CREPE's Viterbi "caps jumps at one octave" is wrong — the cap is 240 cents.) torchcrepe's README states the purpose plainly: *"The argmax operation can cause double/half frequency errors, which can be removed by penalizing large pitch jumps via Viterbi decoding."*

**librosa.pyin** (ISC) does the same thing with different numbers: `max_transition_rate=35.92` oct/s at sr 22050 / hop 512 → `35.92*12*512/22050 ≈ 10` semitones → a **±5-semitone (±500 cents) triangular window, zero beyond**, on a doubled (voiced/unvoiced) state space with `switch_prob = 0.01`.

**Praat** uses named path-finder costs — verified defaults: **octave cost 0.01/octave, octave-jump cost 0.35, voiced/unvoiced cost 0.14**, silence threshold 0.03, voicing threshold 0.45, ≤15 candidates, floor 75 / ceiling 600 Hz. (The manual lists the defaults but **not** the cost equations — *no evidence found* for the exact formula on that page.)

**Melodia** (Salamon & Gómez, TASLP 2012) works at the *contour* level instead: it detects **"octave duplicates"** as contour pairs whose trajectories are near-identical but separated by **1200 ± 50 cents**, deletes the wrong-octave member, re-estimates the melody's pitch mean, then discards contours more than an octave from it. Their MIREX 2010→2011 improvement (mean overall accuracy 0.70 → **0.75**, best of 8 systems) is explicitly attributed in part to *"less octave errors (smaller difference between pitch and chroma accuracies)"*. Interesting error analysis: their largest RPA/RCA gaps were on **solo piano**, not vocals — the octave-selection heuristic *"works well for vocal music"*. ⛔ **The MELODIA Vamp plugin is licensed for non-commercial use only** — not usable for us, but the *contour-duplicate* idea is free to reimplement and maps well onto our note-level post-processing.

#### ⚠️ Discrepancy found in `providers/crepe-provider.ts`

Our decoder's comment says:

```ts
/** σ in bins for the Viterbi transition kernel. 12 bins ≈ 240 cents at CREPE's
 *  ~20 cents/bin spacing — matches marl/crepe's `to_viterbi_cents`. */
const VITERBI_SIGMA_BINS = 12;
const VITERBI_BAND_BINS = VITERBI_SIGMA_BINS * 4;   // = 48
```

**It does not match marl/crepe.** In marl/crepe the 12 is the **hard half-width of a triangular kernel**; in ours it is the **σ of a Gaussian**, truncated at ±48 bins. Consequences:

- Our effective transition spread is substantially wider than CREPE's. A jump of 48 bins (**960 cents**, nearly an octave) costs only `−(48²)/(2·12²) = −8` nats in our kernel; in CREPE it is *impossible*.
- ✅ **Good news:** because `bandBins = 48 < 60`, a true octave jump (1200 cents = 60 bins) *is* outside our band and therefore already excluded. So our decoder does not permit mid-phrase octave flips either.
- ⇒ **Diagnostic conclusion, and it narrows the search a lot:** any octave errors we currently produce cannot be introduced *within* a continuously-voiced run. They must be established at **voicing onsets** — the first frame of a phrase or the first frame after an unvoiced gap, where the Viterbi prior is uniform (`logProb[b] = log(activations[b])` for frame 0, per `pitch-decoder.ts`). That is where an octave-consistency prior belongs, and it is a small, well-scoped change.
- Worth testing whether narrowing to CREPE's actual triangular ±12 bins improves things, or whether our wider Gaussian is (as suspected) a deliberate accommodation of vibrato and portamento. Either way the **comment should be corrected** so the next person doesn't inherit the wrong mental model.

### 3c. Published remedies, ranked by evidence

| Remedy | Where published | Evidence of effect |
|---|---|---|
| **Prime-harmonic-only kernels (SWIPE′)** | Camacho 2007; restated [2507.11233 §2.1.2](https://arxiv.org/abs/2507.11233) | Standard practice; qualitative in sources found. The *quantified* result nearby: raw SWIPE octave-error fraction is 0.087 (worst neural-era method benchmarked), so the kernel trick helps but doesn't solve it. |
| **Subharmonic summation (SHS)** | Hermes 1988, *Measurement of pitch by subharmonic summation*, JASA 83(1):257 | The canonical harmonic-summation formulation. **No modern head-to-head numbers found** placing SHS against CREPE/RMVPE — treat as historical baseline. |
| **Harmonic-structure-aware receptive fields** | **HarmoF0** ([arXiv 2205.01019](https://arxiv.org/abs/2205.01019)) | The most convincing *architectural* remedy found. MRDC-Conv sets dilation rates in the log-frequency axis equal to the spacing of adjacent harmonics (d_i from Q = 48 bins/octave, N_har = 12), so one kernel sees the whole harmonic series. Result: *"The RPA and RCA are closer in HarmoF0 results, indicating fewer octave errors."* Ablation at 0 dB: full model 85.11 % RPA vs 80.96 % for the best ablated variant (−4.15 pt) — the harmonic dilation is what buys the noise robustness. 0.377 M params, MIT. |
| **Viterbi/HMM decoding over the salience map** | pYIN (Mauch & Dixon 2014); CREPE's `to_viterbi_cents`; torchcrepe `decode.viterbi`; Melodia (Salamon & Gómez 2012) | Universally adopted. **But**: SwiftF0's authors report *"alternative decoding methods like the Viterbi algorithm did not yield improvements over the local expected value in our experiments"* — because their training objective (CE + L1 in log-f freq) already optimizes the local-expected-value read-out. And the SWIPE-kernels paper deliberately runs *without* Viterbi. **Implication for us: Viterbi is a patch for a poorly-calibrated salience map, not an unconditional win.** We already have it with a jump floor; a better model may make it redundant. |
| **Explicit octave-transition penalty in the path cost** | Praat's [`Sound: To Pitch (ac)`](https://www.fon.hum.uva.nl/praat/manual/Sound__To_Pitch__ac____.html) — verified defaults: **octave cost 0.01 /octave, octave-jump cost 0.35, voiced/unvoiced cost 0.14**, silence threshold 0.03, voicing threshold 0.45 | Praat is the only widely-used estimator with a *named* octave-jump cost, and it still has an octave-error fraction of 0.029 — worse than four neural models. Suggests a hand-tuned jump cost is not where the remaining headroom is. **No paper found that ablates an explicit octave-transition penalty and reports the accuracy delta**; there is no "penalise octave jumps by X, get Y pt RPA" result in anything retrieved. Our `jumpLogFloor` is functionally the same family of idea. |
| **Continuity constraint inside Viterbi over aggregated subharmonic likelihoods** | [arXiv 2509.16480](https://arxiv.org/abs/2509.16480), *Harmonic Summation-Based Robust Pitch Estimation in Noisy and Reverberant Environments* (Sep 2025) | Directly on point for our reverb eval tier. NAMDF → likelihood → aggregate likelihood **across integer multiples of the pitch period** and across neighbouring frames → Viterbi with a continuity constraint. Reports consistently lower GPE and VDE than existing methods across SNRs in **both noisy and reverberant** conditions. Abstract-level only; **specific GPE/VDE numbers and any code were not retrieved.** |
| ⭐ **Statistical/musical f0 post-processing (Bozkurt 2008) — the best-quantified octave fix found** | Bozkurt, *JNMR* 37(1):1–13 (2008), applied and measured by [arXiv:1912.12609](https://arxiv.org/abs/1912.12609) Table 1 on **524 annotated singing recordings with EGG ground truth** | **The single most useful number in this whole section.** GPE (1-semitone threshold) before → after post-processing: **YIN 2.44 % → 0.91 % (−63 %)**, RAPT 1.01 % → 0.65 % (−36 %), SSH 2.40 % → 1.91 % (−20 %), SRH 1.72 % → 1.61 % (−6 %), PRAAT 1.41 % → 1.41 % (~0), STRAIGHT 1.26 % → 1.25 % (~0). **FPE and VDE essentially unchanged** — i.e. it removes gross/octave errors *without* costing fine pitch accuracy or voicing quality. Note the pattern: the post-process helps most where the tracker is weakest and does nothing for trackers that already have good path-finding (Praat, STRAIGHT). |
| ⭐ **Median across multiple estimators (with theory)** | Koguchi & Koriyama, [arXiv:2602.01727](https://arxiv.org/abs/2602.01727) (Feb 2026) | Error variance reduces as `(1+(n−1)ρ̄)/(4n·h̄²)`, and — the key property — *"when outliers such as octave errors occur, the median is insensitive to a few large errors as long as the majority of estimators return values near the true value."* They also median-filter each estimator's **cent-domain bias** (`f_align = median(Δ¢)`) before voting, because *"the median suppresses sharp spikes and local double or half pitch errors."* Measured on speech + MIR-1K + MDB-stem-synth: V/UV recall **94.21 %** (voting) vs best single 91.68 % (REAPER) / 87.98 % (CREPE). RPA₅₀ 76.78 % vs SWIPE′ 80.91 % / CREPE 75.84 % — so it wins on voicing, not on RPA. |
| **Median filtering the contour in log-f0 space / voicing-aware smoothing** | Standard practice; explicitly *called out as unnecessary* by SwiftF0; `torchcrepe` ships `threshold.At()`, `threshold.Hysteresis` (*"fine-grained control for removing spurious voiced regions"*) and `threshold.Silence()`, all MIT | SwiftF0: *"SwiftF0 also produces smooth pitch trajectories without requiring median filtering or other special techniques. The only post-processing step is a lightweight local expected value computation."* pitch-benchmark quantifies contour smoothness (coefficient of variation of consecutive pitch changes): RMVPE 1.297, CREPE 1.380, SwiftF0 1.704, SPICE 1.766, Praat 1.827, PENN 1.902, **pYIN 3.348, RAPT 3.568, SWIPE 3.659, YAAPT 5.302**. So median filtering is worth it for the classical estimators and largely wasted on RMVPE/SwiftF0/CREPE. |
| **Ensemble voting across estimators, with de-biasing** | [arXiv 2602.01727](https://arxiv.org/abs/2602.01727) (Feb 2026) | Provides the theory (error-variance reduction; Condorcet's jury theorem for the V/UV decision) plus two practical additions: (a) temporal + frequency alignment to remove per-estimator bias before voting, (b) greedy selection of a decorrelated estimator subset. Beats individual SOTA in clean, robust V/UV in noise, evaluated on speech + singing + music. **Cheapest high-leverage idea in this whole report for us**, because we already run two estimators and could add a free DSP one. No code found. |

### 3d. Practical rule for our product

Octave errors in a *melody transcription* product are more damaging than the frame-level rates suggest, because a whole-note octave error is immediately visible on the staff, whereas a 40-cent error is invisible after quantization. The right architecture is therefore:

- pick the estimator with the lowest **octave-error fraction**, not the highest RPA (SwiftF0 0.012 / RMVPE 0.020 / CREPE 0.025);
- keep a **per-note** octave sanity pass after segmentation, using the note's median log-f0 against the *session's* estimated register (we already have `profiles/instrument-ranges.ts` + `pitch-scan.ts`, which is the right place);
- reject octave outliers relative to the running melodic contour, not to an absolute range — a hummed melody rarely jumps an octave and back within two notes.

---

## 4. Voicing / onset / note-boundary detection

### 4a. ⛔ madmom's license, stated exactly — the decisive fact

madmom is **dual-licensed and the split is what matters**:
- **Source code** (`.py`/`.pyx`/`.c`): **BSD 2-Clause** — commercial use fine.
- **Model & data files** (`.npy`/`.npz`/`.h5`/`.pkl`/`.mat`): **CC BY-NC-SA 4.0** — *"You must not use the material for commercial purposes."* Plus, verbatim: *"If you want to include any of these files (or a variation or modification thereof) **or technology which utilises them** in a commercial product, please contact Gerhard Widmer at gerhard.widmer@jku.at. Please note that pickled Processors (i.e. saved models) fall into this category."*

The madmom ISMIR paper says the same: *"The code is released under BSD license and pre-trained models are released under the CC BY-NC-SA 4.0 license."* ([LICENSE](https://github.com/CPJKU/madmom/blob/main/LICENSE), [paper PDF](https://bpb-us-e1.wpmucdn.com/wp.nyu.edu/dist/2/2294/files/2016/08/b%C3%A9ck-madmom.pdf?bid=2294))

**Consequence:** `CNNOnsetProcessor`, `RNNOnsetProcessor` and `OnsetDetectorLL` all load pickled models ⇒ **non-commercially encumbered; would need a JKU license deal.** ✅ **`SpectralOnsetProcessor(onset_method='superflux'|'complex_flux'|…)` loads no model file** ⇒ pure DSP, BSD only, commercially usable. If we ever want a stronger onset detector than our RMS-dip heuristic, **SuperFlux is the only strong option with no NC model attached.**

Other licenses in this space, verified: **aubio = GPL-3.0-or-later** ⛔ · **Essentia = AGPL-3.0** ⛔ · **librosa = ISC** ✅ (no pretrained models, so no NC issue) · **MELODIA Vamp plugin = non-commercial only** ⛔ · **Praat = GPL-3** ⛔ · **Silero VAD = MIT** ✅.

### 4b. Published onset F-measures (Böck dataset: 102 min, 25,927 onsets, ±25 ms, 8-fold CV)

| System | P | R | **F** | Mode | Model size | Speed | License |
|---|---|---|---|---|---|---|---|
| **CNN + dropout + fuzziness + ReLU** (Schlüter & Böck, ICASSP 2014) | 0.917 | 0.889 | **0.903** | offline (±70 ms ctx) | 1.16 MB | no evidence found | code BSD / ⛔ **model CC-BY-NC-SA** |
| CNN (initial; madmom's `CNNOnsetProcessor`) | 0.905 | 0.866 | 0.885 | offline | 1.16 MB | — | same |
| RNN / OnsetDetector (BLSTM) | 0.892 | 0.855 | 0.873 | offline | 723 KB | ~20 s per 60 s audio (2.26 GHz Core 2 Duo) | same |
| **SuperFlux** (Böck & Widmer, DAFx-13) | 0.883 | 0.793 | **0.836** | offline | **none** | **2 s per 60 s = 30× real-time** | ✅ **BSD** |
| SuperFlux | 0.855 | 0.787 | 0.820 | **online/causal** | none | 30× RT | ✅ BSD |
| OnsetDetectorLL (unidirectional RNN) | 0.870 | 0.772 | 0.818 | **online** | 299 KB | ~14 s per 60 s | code BSD / ⛔ model NC |
| LogFiltSpecFlux | 0.877 | 0.756 | 0.812 | offline | none | 1.7 s per 60 s | ✅ BSD |
| LogFiltSpecFlux | 0.854 | 0.753 | 0.801 | online | none | 1.7 s per 60 s | ✅ BSD |
| aubio hfc (params tuned on test set) | 0.750 | 0.733 | 0.742 | — | none | — | ⛔ GPL-3 |
| aubio specdiff | 0.653 | 0.650 | 0.652 | — | none | — | ⛔ GPL-3 |

**SuperFlux's actual configuration**, in case we implement it: **200 fps** (5 ms onset resolution), N = 2048 Hann, **µ = 2** (difference to frame n−2), **138 quarter-tone triangular filters over 27.5 Hz–16 kHz**, and the key trick — a **maximum filter over ±1 frequency bin (= ±a quarter-tone)** on the log-filtered spectrogram before differencing. Peak-picking: pre_max 30 ms, post_max 30 ms, pre_avg 100 ms, post_avg 70 ms, combination_width 30 ms (post_* = 0 online). That max-filter is specifically a **vibrato false-positive suppressor**, and it works: **−36 %** FPs on the strings subset (online), **−61 %/−58 %** on the Wang violin set, **−58 %/−55 %** on the Opera set (opera FP count 1198 → 498). Reachable from librosa without madmom via `onset_strength_multi(..., max_size=…)` — see the [librosa SuperFlux example](https://librosa.org/doc/main/auto_examples/plot_superflux.html).

**2023–2026 neural onset detection is thin.** The most recent primary work found is Bhattacharjee et al., [arXiv:2507.04858](https://arxiv.org/abs/2507.04858) (Jul 2025) — TCN transfer-learned from a beat tracker, F1 up to 0.998 intra-dataset but on *monotimbral percussion*, so it does not transfer. Useful 2024 survey of novelty functions: Müller et al., [TISMIR tutorial](https://transactions.ismir.net/articles/202/files/66ec2062992e8.pdf). ⚠️ **No evidence found** for any 2023–2026 general-purpose onset detector that beats the **2014** CNN's F = 0.903 on the standard set.

### 4c. ⭐ The number that should settle our architecture: onset detection fails on singing

| Benchmark | Best F1 on the singing-voice class |
|---|---|
| MIREX 2012 audio onset detection, solo singing | **55.9 %** |
| MIREX 2018 audio onset detection, singing voice | **61.94 %** — *"lower than the best results of other instrument classes by at least 10 %"* |
| Percussive material, same era | **> 0.95** |
| SuperFlux on the **Opera** subset (10 min, 1448 onsets of solo operatic voice) | **0.653** (vs 0.836 on mixed material) |
| OnsetDetector.2012 on the same Opera subset | 0.662 |
| LogFiltSpecFlux on the same Opera subset | 0.546 |

Sources: [arXiv:1603.06065](https://arxiv.org/abs/1603.06065) §1, [Fu & Su ISMIR 2019](https://archives.ismir.net/ismir2019/paper/000111.pdf) §2 citing [MIREX 2018 per-class results](https://nema.lis.illinois.edu/nema_out/mirex2018/results/aod/resultsperclass.html), [SuperFlux DAFx-13](https://www.dafx.de/paper-archive/2013/papers/09.dafx2013_submission_12.pdf) Table 4.

**Every state-of-the-art onset detector collapses from ~0.87–0.90 to ~0.65 on solo sustained singing.** For hummed and whistled input with no lyrics, there is even less transient to find. **Onset detection cannot be the primary note-boundary signal for this product.**

### 4d. How published systems find legato boundaries — four families

1. **Pairwise onset+offset via higher-order statistics.** Heo & Lee, [arXiv:1603.06065](https://arxiv.org/abs/1603.06065) — correntropy on an ERB filterbank + a kernel-fitness peak-picker that finds each onset *paired with* its offset. Singing onset **F = 80.6 %** (male 80.3 / female 91.4; 1567 onsets, ±50 ms). On a second annotation set: onset F 83.5 % but **offset F only 67.5 %** for singing, vs 95.0/95.0 for clarinet. ⇒ **offsets are structurally much harder than onsets on voice** — which corroborates §2a's advice to optimise COnP and not COnPOff.
2. **Hierarchical state classification.** Fu & Su, [ISMIR 2019](https://archives.ismir.net/ismir2019/paper/000111.pdf) — ResNet-18 over `[S+, S−, Z]` features predicting **silence / activation / transition** states, from which onsets and offsets are read. Onset F1 **0.786**, offset F1 **0.759**, note transcription F **0.594** (vs Tony 0.520, SiPTH 0.415, Ryynänen 0.308). Explicitly motivated by *"soft onset/offset, portamento, and vibrato"*.
3. ⭐ **The paper that isolates the legato case — and the most useful conceptual result in this section.** Yong, Choi & Nam, [arXiv:2304.05917](https://arxiv.org/abs/2304.05917) split onsets into two kinds: **"transition"** (pitch changes, ≤20 ms after the previous offset — i.e. legato) and **"re-onset"** (pitch *unchanged*, new syllable/energy — i.e. a repeated note). Their finding: *"models with mel-spectrogram tend to detect more **transitions**, indicating it is more sensitive to pitch change. Models with PPG [phonetic posteriorgrams] tend to detect more **re-onsets**, showing it captures phonetic changes well."* Both channels together give balanced recall. Results: ISMIR2014 onset F **0.9305** (vs MusicYOLO 0.9176, Omnizart 0.7951, Tony 0.6645), COnP 0.8975, COnPOff 0.7728. Their pitch stage is just pYIN + a Hann-weighted median over each segment.
   **⇒ The direct implication for us:** for wordless input (humming, whistling, "la la la") there are **no phonetic re-onsets to detect** — pitch change is the *only* available boundary evidence for transitions, and **energy is the only available evidence for repeated same-pitch notes**. That is exactly the division of labour our `OnsetDetector` (RMS dip-and-rise) already implements alongside pitch-run segmentation. **Our architecture is right; the literature says so.** What we lack is the third channel.
4. **Learned boundary-indicator sequences (SOTA).** ROSVOT ([arXiv:2405.09940](https://arxiv.org/abs/2405.09940)) drops onset/offset tuples entirely in favour of a single **boundary indicator sequence** (positive:negative ≈ 1:500) predicted by a multi-scale U-Net + Conformer, optionally conditioned on **word boundaries** (*"the presence of a word boundary at t implies the existence of a note boundary at t"*, worth ±3 pp COnPOff). It names our exact problem: *"if a word starts with a voiceless consonant, the pitch onset may be slightly delayed … appoggiatura further complicate boundary localization."* Clean/noisy COn 94.0/93.8, COnPOff 77.4/77.0 — and the **noise augmentation (MUSAN, SNR 6–20 dB, p=0.8) is what buys it**: without it COn drops 93.8 → 90.9 noisy.

**Vibrato caveat for either approach:** vibrato in operatic singing exceeds **±1 semitone (up to a whole tone) at ~6 Hz**, which makes naive spectral flux *and* naive pitch-change thresholds both fire spuriously. SuperFlux's ±quarter-tone max-filter over µ=2 frames at 200 fps is the published DSP answer and it is BSD/model-free.

### 4e. Voicing detection / VAD

| Method | Metric | Number | Size | CPU cost | License |
|---|---|---|---|---|---|
| **FCNF0++ / penn** | V/UV F1 (PTDB+MDB) | **.9816** (entropy) / .9813 (max) | 8.9 M | RTF **0.086** | ✅ MIT |
| CREPE++ (retrained w/ unvoiced strategy) | V/UV F1 | .9801 / .9799 | 22.2 M | RTF 0.363 | ✅ MIT (method) |
| CREPE (confidence as voicing) | V/UV F1 | .9626 / .9509 | 22.2 M | RTF 0.357 | ✅ MIT |
| torchcrepe (argmax) | V/UV F1 | .9293 / .9305 | 22.2 M | RTF 0.644 | ✅ MIT |
| pYIN (peak-density periodicity) | V/UV F1 | .9199 | — | RTF 0.064 | ✅ ISC (librosa) |
| **SwiftF0** | voicing F1 | **93.20 clean / 89.53 @10 dB** | 95.8 k | 132.6 ms per 5 s | ✅ MIT |
| **Silero VAD v6** | ROC-AUC **0.97**; acc 0.92 on 17 h multi-domain val (31.25 ms segments); ESC-50 noise acc 0.87 | JIT ≈ **2 MB** | **< 1 ms per 30 ms chunk, 1 CPU thread**; 8/16 kHz | ✅ **MIT** |
| WebRTC VAD | ROC-AUC **0.73**; acc 0.74; **noise-only acc 0.0–0.15** | tiny | "extremely fast" | BSD (wrapper LICENSE not machine-verified) |
| Median-voting ensemble (2026) | V/UV recall **94.21 %** / FA 19.29 % | vs REAPER 91.68/8.72, CREPE 87.98/20.50, pYIN 67.86/**16.13** | n× cost | see [arXiv:2602.01727](https://arxiv.org/abs/2602.01727) |
| Praat / RAPT on singing | **VDE** (524 singing recs, EGG GT) | **Praat 0.81 %**, RAPT 1.05 % | — | Praat 7.0 ms per 5 s | ⛔ GPL |

⭐ **The most important tuning insight in this section**, stated explicitly by the 2026 voting paper: *"**High recall is desirable when f0 is used for speech synthesis, while a small false alarm rate is desirable when it is used for melody estimation.**"* We are melody estimation. **We should be tuning `confidenceThreshold` for low voicing false-alarm rate, not high recall** — a spurious voiced frame becomes a spurious note on the staff, which is far more visible than a missing one. Our `low` profile comment notes 0.6 "cost recall on the real corpus" and was dropped to 0.5; that trade may be pointing the wrong way and is worth re-measuring against a false-alarm-weighted objective.

Also: **Silero VAD (MIT, 2 MB, <1 ms/chunk, ROC-AUC 0.97 vs WebRTC's 0.73)** is a cheap, license-clean way to gate silence before the f0 stage — useful for trimming cost and for suppressing the "spurious notes in silence" failure mode that CREPE is prone to (SwiftF0's qualitative analysis notes *"CREPE reports pitch during unvoiced or silent portions, introducing false detections"*).

⚠️ **No evidence found** for exact Melodia VR/VFA numbers (its paper presents them as figures, not tables) or for JDC's MIR-1K VR/VFA (MDPI 403).

### 4f. Whistling onset detection

⚠️ **No evidence found** — no published work on onset detection for human whistling with quantified F-measures, after an exhaustive sweep (WebSearch, DuckDuckGo, OpenAlex, arXiv API).

The only usable primary source, Dias et al. 2008, is **evidence against onset detection as the primary signal**: their whistling transcription system groups **runs of equal quantised pitch** into notes and states that *"an energy based onset detector is **not directly applied**, but is used to fix some notes fragmentation at the non-linear filtering block"* — i.e. HFC onset strength appears only as an auxiliary de-fragmentation cue. Minimum note duration 100 ms, with non-linear median-style outlier repair.

### 4g. Direct answer: onset detection or pitch-change segmentation as primary?

**Pitch-change / boundary segmentation as primary, with energy-onset evidence strictly secondary.** The evidence, strongest first:

1. Onset detection is measurably unreliable on this exact material: MIREX solo-singing onset F1 **55.9 % (2012)** / **61.94 % (2018)**, ≥10 pp below every other instrument class, against > 0.95 for percussive onsets.
2. Even the best onset detectors degrade to ~0.65 F on solo sustained singing (SuperFlux 0.653, OnsetDetector 0.662 on the Opera set) vs 0.836/0.873 on mixed material.
3. Pitch change is the feature that actually fires on note transitions in legato, per Yong et al.'s transition-vs-re-onset decomposition — and for wordless humming/whistling there are no phonetic re-onsets available at all.
4. Modern SOTA has abandoned onset-function peak-picking entirely for learned boundary sequences over the whole signal (ROSVOT COn 94.0 clean / 93.8 noisy vs Tony's pitch-HMM 67.5/49.2).
5. The one whistling-specific published system does exactly this (runs of constant quantised pitch; energy only for de-fragmentation).
6. **But pitch-change alone cannot find repeated same-pitch notes** — that is the "re-onset" class, and it is why the good systems add a third channel (Fu & Su's explicit *transition* state; ROSVOT's word-boundary conditioning). **For our product the click track is the obvious cheap third channel for re-onsets** when the user records to a click; and `OnsetDetector`'s RMS dip-and-rise is the right fallback when they do not.

---

## 5. Deployability, licensing, and cost

### 5a. License verdicts (verified via GitHub API `license.spdx_id` + repo LICENSE files, July 2026)

| Project | SPDX | Verdict for a commercial SaaS |
|---|---|---|
| `lars76/swift-f0` (SwiftF0) | **MIT** | ✅ clean. Code + ONNX weights. |
| `lars76/pitch-benchmark` | **MIT** | ✅ clean — we can vendor the benchmark harness and its metric definitions into our eval suite. |
| `WX-Wei/HarmoF0` | **MIT** | ✅ clean, pretrained weights included. |
| `CNChTu/FCPE` | **MIT** (repo LICENSE, "Copyright (c) 2023 CN_ChiTu") | ✅ code clean. ⚠️ The arXiv *paper* is CC-BY-NC-SA 4.0 — that governs the PDF, not the software. ⚠️ Unmaintained per README. |
| `Dream-High/RMVPE` | **Apache-2.0** | ✅ code clean. ⚠️ **No checkpoint published in the official repo** (verified). |
| `yxlllc/RMVPE` (the fork everyone actually uses) | **no license file at all** → all rights reserved | ⛔ Do not vendor this fork's code. |
| RMVPE weights as shipped: HF `lj1995/VoiceConversionWebUI` (`rmvpe.pt` 181 MB, `rmvpe.onnx` 362 MB) | model card `license: mit` | ⚠️ **Provenance risk — flag to legal, do not self-clear.** The card says MIT and RVC itself is MIT. But the fork that supplies RVC's ONNX export path, `yxlllc/RMVPE`, (a) **has no LICENSE file at all**, and (b) states its training data verbatim in its README: 「数据集是我处理过的 mir1k 和 ptdb 混合数据集, 外加 **m4singer** 声码器合成数据」 — *"the dataset is my processed mir1k and ptdb mixed dataset, plus **m4singer** vocoder-synthesized data"*. **M4Singer is CC-BY-NC-SA-4.0** (verified: HF `ztla/M4singer` carries `license:cc-by-nc-sa-4.0`; note a second mirror mislabels it MIT). MIR-1K has no license field on Zenodo and PTDB-TUG carries research terms. A third party asserting MIT over a checkpoint trained on NC + research-only data does not reliably launder those terms. I could **not** verify whether the specific `rmvpe.pt` in the RVC HF repo is yxlllc's checkpoint or the original authors' — **that ambiguity is itself the risk**. Commercially clean path: **retrain from Dream-High's Apache-2.0 code on licensable data** — a project, not an integration. |
| `SonyCSLParis/pesto` | **LGPL-3.0** | 🟡 Workable but needs care. LGPL obligations trigger on *conveying* the software. A server-side SaaS does not distribute the binary to users, so §4/§5 relinking obligations are not triggered by SaaS use (AGPL, which *would* trigger, is not the license here). Running it in a separate gRPC sidecar (our existing pattern) makes the boundary unambiguous. Get a one-line legal sign-off; do not statically bundle it into a shipped client. |
| `spotify/basic-pitch` | Apache-2.0 | ✅ what we already ship. |
| `marl/crepe`, `maxrmorrison/torchcrepe`, `interactiveaudiolab/penn` | MIT | ✅ clean. |
| SPICE (TF Hub / Kaggle Models, Google) | Apache-2.0 | ✅ clean; TFLite published. |
| **Praat / Parselmouth** | **GPL-3.0** | ⛔ Despite being the fastest and 4th-most-accurate option, GPL-3 makes it unusable for us in-process. A subprocess boundary is the usual argument but it is contested for GPL; not worth the risk when SwiftF0 is MIT and better. |
| **pYIN**: original Vamp plugin | GPL | ⛔ use `librosa.pyin` (**ISC**) instead ✅ |
| `pysptk` (RAPT, SWIPE) | BSD-3 | ✅ clean |
| `pyworld` (DIO, Harvest) | MIT | ✅ clean |
| **Silero VAD** | **MIT** | ✅ clean. 2 MB JIT, <1 ms per 30 ms chunk, ROC-AUC 0.97 (vs WebRTC 0.73). Best license-clean silence gate. |
| WebRTC VAD / `py-webrtcvad` | BSD (wrapper LICENSE not machine-verified) | ✅ probably clean, but ROC-AUC 0.73 and **noise-only accuracy 0.0–0.15** — not worth it over Silero |
| **aubio** | ⛔ **GPL-3.0-or-later** | ⛔ excluded |
| **Essentia** | ⛔ **AGPL-3.0** (verified `COPYING.txt`) | ⛔ excluded — AGPL is worse than GPL for SaaS: network use counts as conveying |
| **MELODIA Vamp plugin** | ⛔ **non-commercial only** ("free download for non-commercial use only, i.e. for research and education") | ⛔ excluded. The *octave-duplicate contour* idea in the paper is free to reimplement. |
| `librosa` | ISC | ✅ clean, and it ships **no pretrained models** so there is no NC exposure. SuperFlux is reachable via `onset_strength_multi(max_size=…)`. |
| **SuperFlux reference impl** ([CPJKU/SuperFlux](https://github.com/CPJKU/SuperFlux)) | BSD per the paper's own §4 statement (repo LICENSE file did not resolve when checked) | ✅ probably clean — **verify the LICENSE file before use**. Model-free, so no madmom NC exposure either way. |
| `CPJKU/madmom` | **Split license — verified from the LICENSE file.** *Source code* (`.py`/`.pyx`/`.pxd`/`.c`): 3-clause-BSD-style, permissive ✅. *Data and model files* (`.npy`/`.npz`/`.h5`/`.hdf5`/`.pkl`/`.mat`): **Creative Commons Attribution-NonCommercial-ShareAlike 4.0** ⛔ | ⛔ **This is the single most important license finding in the report.** madmom's pretrained neural onset detectors (`CNNOnsetProcessor`, `RNNOnsetProcessor`, `OnsetDetectorLL`, and every beat/downbeat model) *are* those model files. The LICENSE says verbatim: *"If you want to include any of these files (or a variation or modification thereof) or technology which utilises them in a commercial product, please contact Gerhard Widmer at gerhard.widmer@jku.at. Please note that pickled Processors (i.e. saved models) fall into this category."* → **we cannot ship madmom's neural onset detectors without a commercial license from JKU.** ✅ What we *can* use: the pure-DSP processors that load no model file — **SuperFlux** (`SpectralOnsetProcessor(onset_method='superflux')`), spectral flux, complex flux — those are code-only, BSD. |

### 5b. Cost per second of audio (CPU, single core, from pitch-benchmark's `speed_benchmark.py --signal-length 1.0`)

| Model | ms CPU per 1 s audio | RTF | Fits our ~1 s streaming pass? |
|---|---|---|---|
| SwiftF0 | **16.2** | 0.016 | ✅ trivially, ~60× headroom |
| basic-pitch | 23.3 | 0.023 | ✅ (what we run) |
| SPICE | 27.5 | 0.028 | ✅ |
| PESTO | ~35 (paper RTF 0.0354, i9-12900H) | 0.035 | ✅, and it has a real streaming API with cached-convolution VQT |
| PENN / FCNF0++ | 126.6 | 0.13 | ✅ |
| RMVPE | **293.3** | 0.29 | 🟡 yes, but it eats ~30 % of a core continuously per concurrent recording. At our current "one recording per user" limit that's fine; it does not scale to many concurrent sessions on a small node pool the way SwiftF0 does. |
| torchcrepe | 722.0 | 0.72 | ⛔ |
| CREPE full | 1425.9 | 1.43 | ⛔ slower than real time |

We currently ship **CREPE-tiny**, not CREPE-full, so our real cost is lower than the 1426 ms figure — but **no published RPA or latency for CREPE-tiny specifically was found**, which is itself a finding: *we are running the one variant nobody benchmarks.* Measuring CREPE-tiny on our own eval tier against SwiftF0 is a prerequisite for any decision.

### 5c. Streaming / incremental suitability

| Model | Streaming story |
|---|---|
| **SwiftF0** | Fully convolutional over STFT frames with 5×5 same-padded kernels → 21×21 receptive field ⇒ ~21 frames × 16 ms ≈ **336 ms of context**, and it is non-causal (centred), so it needs ~168 ms of lookahead. Trivially chunkable with overlap; no state. |
| **PESTO** | Best-in-class explicitly: `streaming=True`, cached-convolution VQT, and a *published* study of the accuracy cost of truncating future context ("buffer refilling"): RPA 97.7 → **97.4** at maximum refill m = 0.5, vs 95.4 for naive zero-filling. Model latency < 10 ms. |
| **RMVPE** | ⚠️ Contains a **BiGRU** — bidirectional, so a strictly causal streaming version does not exist without retraining. It was trained on 2.56 s segments; the practical pattern is overlapping windows with discarded edges. This is a real integration cost given our ~1 s incremental passes. |
| **HarmoF0** | penn's authors state flatly: *"HarmoF0 is non-causal, requiring access to the full audio file. This prohibits use for low-latency or streaming-based inference."* Worth re-checking (it's an FCN with frequency-axis-only dilation, so it looks chunkable) but treat the claim as the published position. |
| **PENN / FCNF0++** | Frame-by-frame by design (128 ms window), explicitly built for low-latency streaming. Extremely fragile in noise though. |
| **CREPE / torchcrepe** | Frame-by-frame; fine, just slow. |

### 5c-bis. Actual artifact sizes (measured from the published repos/registries)

| Artifact | Size |
|---|---|
| `swift_f0/model.onnx` (in `lars76/swift-f0`, MIT) | **398 KB** |
| `rmvpe.pt` (HF `lj1995/VoiceConversionWebUI`) | **181.2 MB** (≈90.4 M params at fp16) |
| `rmvpe.onnx` (same HF repo) | **361.7 MB** (fp32) |

That 900× size difference matters for container image size, cold-start time, and k8s memory requests on our node pool. A 398 KB ONNX can be baked into the API image and run in-process via `onnxruntime-node`; a 362 MB ONNX wants an init-container/volume and a warm sidecar.

### 5c-ter. Dataset licensing — what we may train on vs only benchmark against

Verified against Zenodo/HuggingFace API metadata, July 2026. This matters because *training* weights on NC data taints the weights; *benchmarking* is a softer (but not zero) question.

| Dataset | Content | License | Train shipped weights? |
|---|---|---|---|
| **vocadito** ([Zenodo 5578807](https://zenodo.org/records/5578807)) | **40 excerpts of solo monophonic singing, 7 languages, varying training levels. Frame-level f0 + note-level annotations from TWO independent annotators + lyrics.** | **CC-BY-4.0** | ✅ **yes** — the single best licensed resource found for our exact task. Small, but the double note annotation also gives us an inter-annotator ceiling to compare our system against. |
| MDB-stem-synth ([Zenodo 1481172](https://zenodo.org/records/1481172)) | 230 resynthesized solo stems, perfect f0 | **CC-BY-NC-4.0** | ⛔ benchmark only |
| Bach10-mf0-synth ([Zenodo 1481156](https://zenodo.org/records/1481156)) | synthesized Bach, perfect f0 | **CC-BY-NC-4.0** | ⛔ benchmark only |
| **HumTrans** (HF `dadinghh2/HumTrans`) | **56.22 h of hummed melodies + reference MIDI** | **CC-BY-NC-4.0** | ⛔ benchmark only — the most painful restriction in this report |
| MIR-1K ([Zenodo 3532216](https://zenodo.org/records/3532216)) | 1000 karaoke clips, vocal/accompaniment split channels, manual pitch labels | **no license field set** → assume research-only | ⛔ |
| PTDB-TUG | 4720 English speech + laryngograph | research terms (TU Graz) | ⛔ speech anyway |
| NSynth | instrument single notes | CC-BY-4.0 | ✅ (Magenta) — useful for the *played-instrument* profile |
| MLEnd Hums and Whistles | 29.77 h, **includes whistling**, no note annotations | **not verified** | ⚠️ verify; no note labels anyway |

**Consequence:** for a commercially-clean domain-matched model we have essentially **vocadito (40 excerpts) + NSynth + whatever we collect ourselves**. Collecting our own hum/whistle corpus using the HumTrans self-labelling protocol (sing along to a played melody on headphones, derive labels from the reference MIDI, fix the lag with the Dynamic-HumTrans envelope heuristic) is therefore not optional if we want to go down the domain-training path — it is the critical path.

### 5d. What is actually shippable today, no retraining

Only three options combine "pretrained weights exist", "permissive license", and "runs fast on CPU": **SwiftF0 (MIT, ONNX)**, **HarmoF0 (MIT, PyTorch, needs an ONNX export)** and **SPICE (Apache-2.0, TFLite)**. PESTO joins them if legal is comfortable with LGPL-in-a-sidecar. RMVPE joins them only if legal is comfortable with the M4Singer provenance question.

---

## 6. Prioritized recommendations

### P0 — Build the measurement before changing the model (≈2–3 days)

No *frame-level* benchmark in this report contains whistling or humming; Vocadito (solo vocals, real) is the closest, and RMVPE/CREPE/SwiftF0 sit within 4 pt of each other on it. So published f0 numbers cannot rank candidates on our input distribution.

Three concrete things:
1. **Vendor pitch-benchmark's metric definitions (MIT)** into `scripts/eval`: **Octave Accuracy** (`exp(−10·octave_err_frac)`) and **Gross Error Accuracy** (`exp(−5·frac|Δ|≥200c)`) alongside RPA. Do **not** use RCA as a headline — it credits octave errors as hits.
2. **Report octave-aware AND octave-invariant note-level F1 separately**, exactly as Dynamic HumTrans does. The gap between them *is* our octave-error budget, expressed in the units users care about. Given §1f, expect our current basic-pitch path to show a large gap, and that number is the single best justification for any of the work below.
3. **Pin down the metric conventions and write them into the harness**, because the literature is inconsistent (§2a): onset tolerance 50 ms vs 100 ms (worth ~10 F1 points), offset rule 50 ms vs 20 %-of-duration (worth ~10 points). Pick one, document it, and never compare across conventions again.
4. **Anchor targets to the human ceiling, not to 1.0.** Two experts agree at COnPOff **F = 0.64** on solo vocals. Set the roadmap target on **COnP**, and add **note-value/duration F1** + note-error-rate so the quantization stage is measurable (T3MS: 0.400 note-value F1 is *state of the art*).
5. **Add `vocadito` (CC-BY-4.0, 40 solo-vocal excerpts, f0 + note annotations from two annotators + lyrics)** as a licensed eval set. The double annotation gives us the inter-annotator ceiling for free on the same data we score against.
6. **Collect a held-out set of our own hums / whistles / legato sung phrases**, with reference MIDI captured the HumTrans way (subject hums along to a played melody on headphones → self-labelled), then fix the systematic lag with Dynamic HumTrans's published envelope heuristic — and consider the DTW-based onset-label refinement from ["Snapping Matters"](https://arxiv.org/abs/2606.11903) (ChoraleBricks 77.5 → 89.3 F1 from better labels alone). This sidesteps HumTrans's CC-BY-NC restriction and gives us data we can legally train on later.

Without this, every number below is a guess about *our* audio.

**Expected gain:** 0 accuracy, but it is the gate on everything else. **Cost:** low; the harness exists.

### P1 — Swap CREPE-tiny → SwiftF0 as the default trajectory provider (≈3–5 days)

**Why first:** MIT, ONNX already published, 95.8 k params, **16.2 ms/s CPU** (vs our TF CREPE sidecar), lowest octave-error rate measured anywhere (0.012), best voicing F1 measured anywhere (0.885), most stable voicing threshold (CV 0.037 — matters because our users' mic levels vary wildly), best average across 8 datasets (90.2 %), and it degrades only 2.3 pt from clean to 10 dB SNR CHiME-Home domestic noise — the closest published proxy to "someone humming in their kitchen".

**What it does NOT fix:** its range is 46.875–2093.75 Hz, so `TRAJECTORY_MODEL_CEILING_HZ` goes from 1900 to only ~2050 — the two-provider split and the basic-pitch high-register path both survive, and whistling above C7 stays out of reach (§1a-bis). It also *raises* the floor from 55 Hz to 46.875 Hz-ish, which is fine for our `GLOBAL_MIN_FREQ_HZ = 55`. Because SwiftF0 is 95 k params and MIT, retraining it with more top bins is genuinely feasible later — but do not scope that into P1.

**Integration cost:** low. It drops into `PitchProvider` exactly like `crepe-provider.ts`: 16 kHz mono in, per-frame 200-bin distribution out at 16 ms hop, local-expected-value read-out over ±9 bins, confidence = summed probability mass in that window (**default threshold 0.9** — note the high value; our CREPE threshold plumbing assumes ~0.5-scale confidences and `PitchTranscribeOptions.confidenceThreshold` will need remapping per provider). The ONNX is **398 KB**, so this can run **in-process via `onnxruntime-node`, deleting a Python TF sidecar** — a meaningful ops simplification given we maintain two TF venvs (`.venv-crepe`, `.venv-basicpitch`) and a gRPC hop today.

Note that SwiftF0's *own* `segment_notes(split_semitone_threshold=0.8, min_note_duration=0.05, unvoiced_grace_period=0.02)` is the same heuristic family as our `note-extractor.ts` — pitch-change threshold + minimum duration + gap grace. **Do not expect its note segmentation to be an upgrade on ours**; take the f0 + confidence and keep our segmentation.

**Expected gain:** the honest answer is *unknown on singing* — SwiftF0 is 95.0 vs CREPE 95.7 on MIR-1K and 92.6 vs 95.6 on Vocadito (i.e. **slightly worse on clean vocals**), but 74.0 vs 53.8 on noisy speech, and 2× fewer octave errors. **The gain is in robustness, latency, cost and ops, not in clean accuracy.** If our eval shows a clean-audio regression we should ship it as a second profile rather than a replacement.

### P2 — Add RMVPE as the "noisy / hard input" provider behind the profile resolver (≈1–2 weeks + legal)

**Why:** it is the measured best on human singing (Vocadito 96.4, MIR-1K 96.0) and its noise lead is enormous where it matters — 0 dB pub noise 86.26 RPA vs CREPE 61.22, and only −10.07 pt from 10 dB→0 dB vs CREPE's −29.67. `rmvpe.onnx` exists.

**Blockers, in order:**
1. **Legal**: the M4Singer (CC-BY-NC-SA) provenance question on the shipped checkpoint (§5a). Get a decision *before* engineering time goes in — this can kill the whole item.
2. **BiGRU / non-causal**: needs overlap-and-discard, not our incremental frame cache. `cachesAcrossPasses` would be `false` and `windowAlignSamples` would need to reflect the 2.56 s training segment length.
3. **Cost and size**: 293 ms/s CPU (0.29 RTF), 362 MB ONNX / 181 MB fp16 checkpoint. Needs a warm sidecar and a memory request; not bakeable into the API image.
4. **Timbre generalization**: RMVPE scores **68.2** on NSynth (instrument notes) vs SwiftF0's 89.3. Do not route *played instrument* input to RMVPE.
5. **No range benefit**: RMVPE's ceiling is the same 1975.5 Hz as CREPE's, so it does nothing for the high-register/whistle problem (§1a-bis).

**Expected gain:** on noisy vocal input, potentially large (tens of points of RPA at low SNR translating into far fewer spurious/wrong notes). On clean input, ~0.

### P3 — Cheap, high-leverage classical additions (≈2–4 days each, no new model)

Ranked by expected-gain-per-hour. Items 1 and 2 are the best value in the whole report.

1. ⭐ **A Bozkurt-style statistical/musical f0 post-process.** The best-quantified octave fix in the literature: on 524 annotated singing recordings with EGG ground truth it cut **YIN's GPE from 2.44 % → 0.91 % (−63 %)** and RAPT's 1.01 % → 0.65 %, **with FPE and VDE essentially unchanged** ([arXiv 1912.12609](https://arxiv.org/abs/1912.12609) Table 1) — i.e. it removes gross/octave errors without costing fine accuracy or voicing. Note the pattern in that table: it helps most where the tracker's own path-finding is weakest and does ~nothing for Praat/STRAIGHT, so measure whether our Viterbi already captures the benefit before assuming a gain.
2. ⭐ **Tune voicing for low FALSE-ALARM rate, not high recall.** Per [arXiv 2602.01727](https://arxiv.org/abs/2602.01727), verbatim: *"High recall is desirable when f0 is used for speech synthesis, while a small false alarm rate is desirable when it is used for melody estimation."* We are melody estimation, and a spurious voiced frame becomes a spurious note on the staff — far more visible to a user than a missing one. Our `low` profile dropped `confidenceThreshold` 0.6 → 0.5 because 0.6 "cost recall on the real corpus"; that trade may be pointing the wrong way. Re-measure against a **false-alarm-weighted** objective. Pure config change, and the eval harness already sweeps it.
3. **Ensemble voting with de-biasing** ([arXiv 2602.01727](https://arxiv.org/abs/2602.01727)). We already run two estimators; adding SWIPE′ gives three. Directly implementable: (a) correct each estimator's systematic temporal and cent-domain bias (`f_align = median(Δ¢)`) *before* voting, (b) greedily select a decorrelated subset. The measured effect is on **voicing** (V/UV recall 94.21 % vs best single 91.68 %) more than on RPA — which is exactly where our false-note problem lives. Condorcet's jury theorem covers the V/UV case; median-of-n covers octave outliers (*"the median is insensitive to a few large errors as long as the majority of estimators return values near the true value"*).
4. **A properly-configured SWIPE′ as that third vote.** pysptk is BSD-3, ~37 ms/s. Per [arXiv 2507.11233](https://arxiv.org/abs/2507.11233) a correctly-configured SWIPE′ is a **96.2 % MIR-1K** estimator — better than every published self-supervised neural model. Two documented traps: use **mel** (not ERB) spectrum sampling, and **do not raise the search ceiling to 8 kHz on the SPTK implementation** (96.5 → 68.2 collapse). Use it on the voice/hum profiles where the ceiling can stay low.
5. **Put the octave prior at voicing ONSETS specifically** — see §3b-bis. Our Viterbi already makes mid-phrase octave flips impossible (`bandBins = 48 < 60 bins`), so an octave error can only be born at frame 0 of a voiced run, where the prior is uniform. Seed that prior from the session register estimate (`pitch-scan.ts` / `instrument-ranges.ts`) instead of leaving it uniform. Small change, precisely targeted.
6. **Melodia-style octave-duplicate rejection at the note level** (the idea, not the non-commercial plugin): find note pairs whose contours are near-identical but separated by **1200 ± 50 cents**, drop the wrong-octave member, re-estimate the phrase's pitch mean, discard outliers more than an octave from it. Salamon & Gómez credit this for part of a 0.70 → 0.75 mean-overall-accuracy jump at MIREX.
7. **Silero VAD (MIT, 2 MB, < 1 ms per 30 ms chunk) as a pre-f0 silence gate.** ROC-AUC 0.97 vs WebRTC's 0.73. Cuts compute on silence and suppresses the "notes in silence" mode that SwiftF0's qualitative analysis attributes specifically to CREPE (*"CREPE reports pitch during unvoiced or silent portions, introducing false detections"*).
8. **Register-relative octave sanity pass** on segmented notes (§3d), using the existing `pitch-scan.ts` / `instrument-ranges.ts` machinery — reject octave outliers relative to the *running melodic contour*, not an absolute range.

### P3.4 — Whistling: change the algorithm family, don't just widen the band (≈3–5 days)

Whistling is a literature gap (§3a.4, §4f), but the one published study gives clear direction — and it contradicts what a harmonic-model pipeline would naturally do:

- **Band-limit to C5–C8 = 523–4186 Hz** (the published whistle compass) — not "1–3 kHz", and certainly not `voice-lead`'s 75–1100 Hz. Note we currently have **no `whistle` entry in `instrument-ranges.ts` at all**; that is a concrete gap.
- **Use time-domain ACF/AMDF, not harmonic product/summation.** Dias et al. observed HPS *"oscillating between a base range of values and the same range translated one octave upwards"* without an aggressive bandpass, while time-domain ACF at a 512-sample window gave **0 % insertion/deletion/substitution errors**. ⚠️ ~25-note evaluation — directional only.
- **Never use multiplicative harmonic product on hummed input either**: Camacho's telephone-band /u/ example shows HPS cannot recover a missing fundamental at all, whereas additive SHS can.
- **Segment whistling by pitch runs with energy onsets only for de-fragmentation** — which is what the published system does and what our pipeline already does.

### P3.5 — Adopt the Dynamic-HumTrans decode idea in our existing Viterbi (≈3–5 days, no new model)

This is a *decoder* change, not a model change, so it needs no weights and no license from anyone — only the published idea. Extend `providers/pitch-decoder.ts`'s state space with an **explicit silence/rest state** and make the transition structure sparse: `note n → n`, `note n → silence`, `silence → any note`, and — **profile-dependent** — either forbid `note n → note m (n≠m)` outright (hum profile, where "Da-Da-Da" articulation guarantees a gap) or allow it with our current `jumpLogFloor` cost (legato voice / whistle profiles, where there is no gap).

Today we run Viterbi over pitch bins only and then infer note boundaries downstream from run segmentation + the RMS-dip `OnsetDetector`. Folding voicing into the *same* decode means onsets and offsets fall out of a single globally-optimal path instead of two independently-thresholded heuristics, which is exactly the property Dynamic HumTrans credits for its result. **Expected gain:** on humming, this is the mechanism behind the 0.268 → 0.651 octave-aware gap; realistically we would capture some fraction of it without their domain-trained model. **Cost:** moderate; contained entirely inside `pitch-decoder.ts` + a profile flag, and our eval harness can measure it directly.

### P3.6 — Coarsen the note-boundary resolution to match label noise (≈1 day, pure tuning)

ROSVOT's Table 2 ablation: COnPOff 70.7 at 10.7 ms boundary resolution → **77.4 at 85.3 ms** → 77.2 at 170.7 ms. **+6.7 points from being *less* precise about note boundaries**, because ~80 ms is the actual uncertainty of the labels (and of human articulation). Our `OnsetDetector` runs a 10 ms hop and `minIoiSec = 0.09`. Worth a sweep: we may be resolving finer than the signal supports, which manifests as spurious note splits. Cheap experiment, purely in `onset-detector.ts` + `note-extractor.ts` parameters, measurable in the existing harness.

### P3.7 — Re-scope the roadmap toward rhythm (planning item, no code)

Two independent signals say pitch is no longer the bottleneck:
- **T3MS**: onset+pitch F1 0.771, but **note-value (duration) F1 only 0.400** — and 0.400 still beats naive grid quantization (0.380), MuseScore (0.249) and AnthemScore (note-error-rate 129.4 vs T3MS's 64.4). So *everyone* is bad at duration, and it is measurable.
- **Klangio** publishes four recent papers on beat/downbeat tracking and rhythm quantization ([2507.00466](https://arxiv.org/abs/2507.00466), [2508.19262](https://arxiv.org/abs/2508.19262), [2604.22290](https://arxiv.org/abs/2604.22290), [2506.22237](https://arxiv.org/abs/2506.22237)) and none on note detection. They also ship a manual **Edit Mode**, i.e. they concluded the last mile is a UX problem.

Suggestion: add **note-value / duration F1 and a note-error-rate** to the eval harness alongside COnP, so the quantization stage stops being invisible. Also worth noting for expectation-setting: [arXiv:2308.02898](https://arxiv.org/abs/2308.02898) finds singing transcription is systematically **more accurate for female than male singers** across datasets and backbones — we should check whether our own eval shows that skew.

### P3.8 — Benchmark omnizart's `vocal` model as an external reference point (≈1 day)

Not a recommendation to ship it — a recommendation to **measure against it**. [omnizart](https://github.com/Music-and-Culture-Technology-Lab/omnizart) is MIT, actively maintained (last push 2026-05), ships checkpoints via `omnizart download-checkpoints`, and scores ISMIR2014 COnP 0.617 / COnPOff 0.499 and SSVD COnP 0.605 / COnPOff 0.515. It is the **most license-clean maintained note-level vocal transcriber that exists.** If our pipeline cannot beat it on our own eval set, that is important information; if it can, that is a defensible quality claim. Cost is one afternoon (caveat: no ARM-macOS support, so run it in Docker/CI).

### P4 — Re-audit our Viterbi decoder — including a bug in its comment (≈1–2 days)

Three separate reasons to look at `providers/pitch-decoder.ts` + `crepe-provider.ts`:

1. ⚠️ **The comment is wrong.** `VITERBI_SIGMA_BINS = 12` is documented as *"matches marl/crepe's `to_viterbi_cents`"*, but marl/crepe's 12 is the **hard half-width of a triangular kernel** (`max(12 - |Δ|, 0)`, zero beyond ±240 cents), whereas ours is the **σ of a Gaussian** truncated at ±48 bins (±960 cents). Our effective transition spread is materially wider than CREPE's. Fix the comment either way, and test whether narrowing to CREPE's actual triangular ±12 bins helps — or whether the wider Gaussian is (as I suspect) a deliberate accommodation of vibrato and portamento, in which case say so.
2. **Viterbi may be dead weight after a model swap.** SwiftF0's authors found Viterbi gave *no improvement* over local-expected-value, because their training objective already optimises that read-out; the SWIPE-kernels paper runs without Viterbi entirely. Ours was tuned against CREPE's salience map under reverb, and `jumpLogFloor` is already documented in-code as measuring neutral-to-negative. **When the estimator changes, re-ablate the whole decoder** — it is O(numBins·band) per frame, so removing it is also a speedup.
3. **Median smoothing may also be dead weight.** RMVPE/SwiftF0/CREPE already produce smooth contours (relative-smoothness 1.30 / 1.70 / 1.38) where pYIN/SWIPE do not (3.35 / 3.66). SwiftF0's paper says outright it needs no median filtering. If we swap the model, re-measure the smoother.

### P5 — Things to watch, not build (2026)

- **DJCM** (+2.86 % OA over RMVPE) if we ever accept audio with a backing track. Verify weights/license first.
- **Voting-based estimation** ([2602.01727](https://arxiv.org/abs/2602.01727)) — no code yet; the ideas are implementable now (see P3.2).
- **Wave-U-Net fundamental-waveform enhancement** ([2606.14324](https://arxiv.org/abs/2606.14324)) — explicitly targets steep pitch variation on singing; if code lands it is interesting for portamento/vibrato.
- **Harmonic-summation + Viterbi continuity for reverb** ([2509.16480](https://arxiv.org/abs/2509.16480)) — directly relevant to our adverse-reverb eval tier.
- **HarmoF0 — promote this to P2 if the range analysis in §1a-bis holds up in practice.** 0.377 M params, MIT with released weights, best-in-class in-domain numbers (MIR-1K 98.34 / MDB 98.40 / PTDB 93.56), an architecture explicitly designed to suppress octave errors (harmonic-spaced dilation; ablation shows it is what buys the noise robustness: 85.11 vs 80.96 RPA at 0 dB), **and the only 27.5–4371 Hz range among the good models** — i.e. the only candidate that could unify our two-provider split and let us retire the basic-pitch path entirely. Open questions to resolve before investing: (a) is the non-causality claim actually binding, or is a frequency-axis-dilated FCN chunkable with overlap? (b) can we export it to ONNX cleanly? (c) what is its CPU RTF (nobody has published one)? All three are a day or two of measurement each.

### Explicit gaps in the evidence

- **No published *frame-level f0* benchmark covers whistling or humming.** Not one of the 8 datasets in pitch-benchmark, nor MIR-1K/MDB/PTDB/vocadito/Bach10, contains either. Note-level humming *is* covered by HumTrans (§1f). For whistling, the only dataset found is MLEnd Hums and Whistles (29.77 h) and it has **no note-level annotations**; and an arXiv sweep for whistling pitch/onset work returned nothing relevant. **Whistling is genuinely unaddressed in the literature.**
- **No RPA/latency numbers exist for CREPE-tiny** specifically, which is what we ship.
- **Which PESTO checkpoint the `pesto-pitch` pip package actually ships is unverified** (MIR-1K-trained? MDB? the multi-dataset "all"? the background-music-augmented variant?). This matters a lot: PESTO's RPA on MIR-1K ranges from 94.6 (trained on MDB) to 97.7 (trained on MIR-1K) to 98.3 (background-augmented), and its 0 dB robustness ranges from **46.8 to 82.5** depending on the variant. Do not quote a PESTO number without knowing which weights you have. (GitHub API rate-limited before I could enumerate the repo's checkpoint files.)
- **FCPE's noise-robustness table and CPU RTF** were not retrievable from the sources fetched.
- **DJCM's model size, license, weights availability and CPU cost** could not be verified.
- **No paper found that ablates an explicit octave-jump transition penalty** and reports the accuracy delta. Praat documents the *defaults* (octave cost 0.01, octave-jump cost 0.35) but not the cost equations.
- **No canonical "X % of pitch errors are octave errors" figure exists** for MIR-1K / MDB / PTDB. The field reports the RPA−RCA gap or SwiftF0's Octave Accuracy instead.
- **No published CPU cost** for: ROSVOT, VOCANO, MusicYOLO, omnizart, EFN, CE+CTC, T3MS, STARS, VocalParse, Mel-RoFormer, Perceiver TF, hFT-Transformer, MT3, Kong-piano, HarmoF0, FCPE, or madmom's CNN/RNN onset detectors. The **only** published CPU figure in note-level transcription is basic-pitch's "<20 MB peak memory, faster than real time on most modern computers"; YourMT3's 36× real-time is on a **T4 GPU**.
- **No published model size** for: EFN, JDCnote, MusicYOLO, T3MS, Note-level Transformer, Perceiver TF, YourMT3, MR-MT3, Timbre-Trap, omnizart, Kong-piano.
- **No 2023–2026 onset detector found that beats the 2014 CNN's F = 0.903** on the standard Böck set.
- **Hermes' original SHS error tables** could not be retrieved (JASA paywall/403), nor **PEFAC's GPE-vs-SNR table** (all four mirrors 403/404), nor the **pYIN ICASSP 2014 PDF** (QMUL mirrors dead). The librosa/libf0 implementations are the verifiable substitutes for pYIN's transition model.
- **Melodia's exact VR/VFA numbers** (presented as figures, not tables) and **JDC's MIR-1K VR/VFA** (MDPI 403).
- **Klangio's "Dual Task Monophonic Singing Transcription"** (JAES) — no accessible copy, no year, no DOI, no metrics, no model size. Nothing published about Sing2Notes accuracy.
- **MIR-ST500's own ICASSP 2021 baseline table** (paywalled) — the numbers quoted here are as re-run by later papers.
- **No ISMIR 2025 note-level singing transcription paper exists** — verified absent from the full 111-paper program. Only one 2026 singing-transcription paper exists on arXiv (VocalParse).
- **Whistling onset detection**: nothing, after sweeping WebSearch, DuckDuckGo, OpenAlex and the arXiv API. The adjacent hits (Irish tin whistle, dolphin/bird whistle contours) do not transfer.
- **No study measuring octave errors on humming specifically** (as distinct from sung vowels) — the HumTrans octave-aware/invariant gap in §1f is the closest proxy and it is note-level, not frame-level.
- **SuperFlux reference repo's LICENSE file** did not resolve when checked; the paper asserts BSD. Verify before use (it is model-free either way, so no madmom NC exposure).

---

## 7. Where the raw material is

Extracted paper text and PDFs used for this report are in this scratchpad directory: `rmvpe.txt`, `swiftf0.txt`, `swipek.txt`, `penn.txt`, `pesto2.txt`, `harmof0.txt`, `h2309.09623.txt` (HumTrans), `h2410.05455.txt` (Dynamic HumTrans), `pitchbench.md`, `pitchreport.md`, plus the sub-agents' `rosvot.txt`, `melodia.txt`, `cnnonset.txt`, `onsetll.txt`, `whistle_jetc.txt`, `swipe_thesis.txt`, `voting.txt`, `vocadito.txt`, `tony.txt`, `nakamura.txt`, `ismir2014.txt` and the `pdfs/` + `papers/` folders.

**No files in the repository were modified.**
