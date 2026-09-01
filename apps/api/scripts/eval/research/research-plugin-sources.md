# Open-source plugin sources, mined for transferable ideas

Research notes, 2026-08-19. **Fourteen** open-source projects whose source was read directly, looking
for pre/post-processing that could improve our pipeline. Read in three rounds: §1–§4 audio plugins,
§5–§9 the reference implementations behind algorithms we already claim to follow, §10–§14 autotune
software (which must analyse pitch before it can correct it). §15 lists two more that were read and
yielded nothing. §20 is a **round-4 addendum** (same day, post-validation): OpenTune — the first
surveyed project that decides note boundaries automatically — and PytoTune, dismissed.

**Validated 2026-08-19.** Every [P] citation was re-verified against fresh clones of all sixteen
repos, and every claim about our own pipeline against current source. The externals held up clean
(including both TalentedHack bugs and every licence); the pipeline-side corrections from that pass
are applied inline, marked *(validation)*.

**How this differs from the sibling files.** `research-daw-products.md` covers *commercial* products
through docs, patents and press — necessarily second-hand about the algorithms.
`research-pitch-models.md` covers the *literature*. This file covers **source code we can read**, so
every claim below is **[P] primary, with a `file:line`**, and several of them come with a working
reference implementation.

**How the candidates were chosen.** Starting point was MXTune (asked about directly). Its own
`pitch_detector_aubio.cpp` pointed at aubio; the natowi audio-to-MIDI survey
(https://gist.github.com/natowi/d26c7e97443ec97e8032fb7e7596f0b0) lists exactly one *plugin* doing
audio→MIDI (NeuralNote); fat1.lv2 was added as the best-engineered open-source pitch tracker in the
autotune family. Formats differ (VST3/AU, LV2, Vamp) — noted per project, since none of it is a
drop-in for a Node service anyway.

Round 2 (§5–§9) drops the plugin constraint deliberately, because round 1 surfaced a better selection
rule: **read the source of the things our own doc comments cite.** `note-segmenter.ts` and
`voice-note-decoder.ts` both say they follow pYIN/Tony; `research-pitch-models.md` cites Praat and
Essentia throughout; R2 needed a real key detector to copy. None of that source had ever been opened.
It turned out to be where the findings were: §5 and §6 between them explain, with high confidence, why
our pYIN reimplementation lost to the naive segmenter it was meant to replace.

Round 3 (§10–§14) covers autotune proper, on the premise that correcting a vocal requires first
deciding **which note the singer was aiming at** — the same decision our segmenter makes. The premise
holds. Five projects, spanning a 2001 patent reconstruction (§13), the Autotalent lineage (§10, §12),
a WORLD-based harmoniser (§11) and an ICASSP-2020 neural corrector (§14) — deliberately chosen to
avoid five forks of the same algorithm.

It paid off three ways: §12.1 + §13.2 (an octave tie-break, now with three independent derivations),
§12.3 (two scale masks, which corrects R2's design), and §14.3 (a de-tuning augmentation that becomes
an eval tier we lack). It also produced the most useful *negative* result in the document: **not one of
the five decides note boundaries or targets by itself** — including the neural one, which reads them
from pYIN's note track (§14.1). Segmentation is not a solved problem we are failing at; it is the open
problem, and it is the one thing a notation tool cannot outsource.

---

## 0. What to actually take (ranked)

### Round 1 — the plugins (§1–§4)

| # | Idea | Source | Where it lands | Expected value |
|---|---|---|---|---|
| **R1** | **Sub-semitone pitch on the basic-pitch path**, from the contour posteriorgram we currently throw away | NeuralNote `Notes.cpp::_addPitchBends` | `providers/model-backend.ts` + `basic-pitch-provider.ts` | **High** — unlocks tuning-offset estimation, key spelling and R2/R5 for *instrument* takes, which have none today |
| **R2** | **Key estimation from the take itself**, as a fallback when the score's key signature is uninformative | MXTune `check_key` + `KeyDetectGui` | `mxml-builder.ts` (next to `estimateTuningOffsetCents`) | **Medium-high** — spelling-only, so low risk; fixes "sang in E♭ into a C-major score" |
| **R3** | **Adaptive onset threshold** (`value − movingMedian − k·movingMean`) instead of fixed dip/rise ratios | aubio `peakpicker.c` | `onset-detector.ts` | **Medium-high** — directly targets the documented "the right setting is a property of the material" finding |
| **R4** | **Note-boundary-respecting causal pitch smoothing** (one-pole within a note, hard reset at a boundary) | fat1 `Retuner::finderror` | `voice-note-decoder.ts` pitch estimator | **Medium** — streaming-friendly, unlike our whole-span trimmed mean |
| **R5** | **Median-delayed note pitch that skips the attack** | aubio `notes.c` (`median = 6`) | `note-extractor.ts` (basic-pitch path) | **Medium** — cheap stand-in for pYIN attack states where we have no attack model |
| **R6** | **Two-stage voicing decay**: release note-continuity *before* releasing the note | fat1 `Retuner::process` | `voice-note-decoder.ts` (`unvoicedPitchCost` neighbourhood) | **Medium-low** — a refinement, not a new capability |
| **R7** | **Sub-frame onset position by quadratic interpolation** | aubio `fvec_quadratic_peak_pos` | `onset-detector.ts` | **Low-medium** — sharpens timing; will NOT fix our systematic −44 ms bias |
| **R8** | UX: one **split↔merge** slider and a **note-range** control rather than raw thresholds | NeuralNote parameter naming | apps/web (already parked as D4 in `research-voice-transcription.md` §10a) | **Medium** (product, not accuracy) |

### Round 2 — the reference implementations (§5–§9)

| # | Idea | Source | Where it lands | Expected value |
|---|---|---|---|---|
| **R9** | ⭐ **Feed the note decoder a multi-candidate pitch distribution per frame**, not a single argmax. This is the "p" in pYIN and we do not have it | pYIN `calculateObsProb`; Praat (15 candidates/frame) | `crepe-provider.ts` → `pitch-track.ts` → `voice-note-decoder.ts` | **Highest ceiling in the document** — the activation matrix already exists; without it our pYIN port is not a test of pYIN |
| **R10** | ⭐ **Make note-change cost proportional to the interval**, and give silence a memory of the pitch it came from | pYIN `sigma2Note`/per-pitch silence; Praat `octaveJumpCost × \|log2(f1/f2)\|` | `voice-note-decoder.ts` transitions | **High** — two independent references agree; our flat `changeCost` is the knob our own findings say cannot serve both corpora |
| **R11** | **Hop-normalise every per-frame cost** to a 10 ms reference | Praat `timeStepCorrection` | `NoteSegmenterOptions`, `VoiceDecoderOptions` constructors | **High / trivial** — makes all historical sweep numbers hop-comparable and kills a silent mis-tuning class |
| **R12** | **Asymmetric onset/offset confirmation** (75 ms vs 200 ms) + **subtract the confirmation delay from the timestamp** | Essentia `Pitch2Midi`; aubio `delay` | `recording-pipeline.ts` (`STABLE_MARGIN_SEC`), `onset-detector.ts` | **Medium-high** — third independent appearance; our −44/−52 ms bias is this omission |
| **R13** | **Segment against the note's own running mean in cents (±60), on a tuning-corrected grid** — and move the tuning estimate *upstream* of segmentation | Essentia `PitchContourSegmentation` | new segmenter variant; `estimateTuningOffsetCents` moves earlier | **Medium-high** — the ordering half is a correctness point, not a knob |
| **R14** | **Key detection with an explicit abstain**, profile type as a parameter (not hardcoded Krumhansl) | libKeyFinder `SILENCE` profile; Essentia `useMajMin`, `bgate` | folds into **R2** | **Medium** — removes R2's only real risk in four lines |
| **R15** | **Joint duration × velocity note filter**, plus a long-and-quiet filter we lack entirely | WaoN `notes.c:232`, `:319` | `note-segmenter.ts` `minFrames`, `voice-note-decoder.ts` `absorbShortRuns` | **Medium / cheapest in the file** — inputs already exist; targets a measured reverb failure |

### Round 3 — autotune (§10–§14)

| # | Idea | Source | Where it lands | Expected value |
|---|---|---|---|---|
| **R16** | ⭐ **Octave tie-break for multi-candidate selection**: when two candidates are ~an octave apart and the lower is not clearly stronger, take the **higher** fundamental (MPM's "earliest peak above k×tallest") | TalentedHack `get_pitch_period` | inside **R9**'s candidate reduction | **Medium-high, but only with R9** — R9 creates the choice; this is the rule for making it |
| **R17** | **Slew-rate limiter with momentum** as a streaming pitch estimator — unlike a one-pole it *arrives* at the target and holds | TalentedHack `SmoothPitch` | `voice-note-decoder.ts` `pitchEstimator` sweep | **Medium** — the best of the three smoother variants on paper; try before R4 |
| **R18** | ⭐ **Separate the interpretation key from the spelling key.** The take's key decides *which note was meant*; the score's key signature decides *how we write it*. They may legitimately disagree | TalentedHack `iNotes` vs `oNotes` | redesigns **R2**, no extra cost | **Design correction** — changes R2's shape, not its priority |
| **R19** | **Voiced-fraction quorum** over a window before reporting any pitch (outotune: unvoiced unless >¼ of fragments voiced) | outotune `aggregateF0Fragments`; Essentia `minOccurrenceRate`; aubio median-6 | `pitch-track.ts` `voicedMask` or the decoder's voicing term | **Medium** — fourth independent instance; targets spurious short notes in the reverb tier |
| **R20** | ⭐ **A per-note intonation degradation tier for the eval harness**: take an in-tune corpus, apply *known* per-note detunings of 20-60 cents, check the pipeline recovers the intended notes | Deep Autotuner's de-tune augmentation (`rnn.py:180-196`) | `scripts/eval/scenarios.ts` + `lib/synth.ts` | **High** — our tiers cover the room, not the *performer*; it is the only way to put ground truth under R1/R2/R13 and the spelling code |
| **R21** | **Fill single-frame voicing dropouts on the pitch track** (both neighbours voiced → interpolate) | Deep Autotuner `interpolate_pyin.py` | `pitch-track.ts` pre-pass | **Medium / three lines** — removes the easiest third of the work `unvoicedPitchCost` is doing, making that sweep cleaner |
| **R22** | Implementation note, not a task: if a licence-clean DSP f0 path is ever built, use the patent's **recursive running-sum ASDF** (O(1) per lag per sample) with coarse-to-fine refinement | Auto_Tune `AutoTune.py`; WORLD (§11.4) | — | **Deferred** — recorded so §11.4's option has a known-good shape |

### Round 4 — the addendum (§20)

| # | Idea | Source | Where it lands | Expected value |
|---|---|---|---|---|
| **R23** | ⭐ **GAME (OpenVPI), a pretrained neural note transcriber, as external benchmark/challenger** to our note decode — with OpenTune's deployment lore (45 s chunk cap, silence-midpoint chunking, 50 ms seam dedup, CPU-only) | OpenTune `GameNoteGenerator` | `bench-external-notes.ts` (the §10d "should we acquire a learned model" gate) | **High** — the Findings log's own conclusion ("remaining singing headroom is a learned note model, not more post-processing") now has a concrete, no-training-compliant candidate. **Check the GAME checkpoints' licence first** |
| **R24** | **Angle-band-gated slope rotation**: per-note detrend applied only when the slope angle ∈ 10°–30° (normalised at 7 st/s) — straightens scoops, leaves flat notes and deliberate glides alone | OpenTune `PitchCurve` | `pitchEstimator` sweep | **Low-medium** — the three unconditional variants all measured null (plan task 7); the gate is the only untested twist |
| **R25** | **Two-tier silence rule**: silent if total RMS ≤ −40 dBFS, *or* ≤ −30 dBFS while the 60 Hz–3 kHz band is < −40 dBFS | OpenTune `SilentGapDetector` | `onset-detector.ts` silence floor | **Low-medium** — classifies low-frequency rumble as silence above the strict gate |
| **R26** | Implementation note, not a task: RMVPE's shipped checkpoint labels its unvoiced-probability output "uv" — enabling the mask as documented zeroes every voiced frame | OpenTune `RMVPEExtractor.h:116-136` | — | **Deferred** — recorded so an RMVPE evaluation doesn't rediscover it |

### Combined top five, across all three rounds

**R11 → R15 → R9 (+R16) → R20 → R10.** R11 (hop-normalise the costs) and R15 (duration × velocity
filter) are near-free and should go first. R9 has by far the highest ceiling and is the one worth a real
experiment; R16 is part of doing R9 properly, not a separate item. **R20 rose into the top five on round
3**: a per-note intonation tier is the only proposal here that creates *new ground truth*, and without it
R1, R2, R13 and every spelling change are unmeasurable — which is already true today and is why
`voice-notation.ts` calls spelling toward the singer's grid "a product question the eval structurally
cannot reward" *(validation: corrected quote)*. R2 stays worth doing but
is a *spelling* fix: judge it on the page, not on F1, and build it in R18's two-mask shape.

**One theme runs through all three rounds:** every reference implementation parameterises in *seconds
and intervals* and adapts its thresholds to the material; we parameterise in *frames* with *fixed*
thresholds. R11, R3, R15 and R19 are all instances of closing that gap, and none of them is expensive.

---

**Non-findings worth recording.** Ideas that looked transferable and are not:
- MXTune's contour→note segmentation is *precisely* the semitone-run approach `note-segmenter.ts`
  documents as over-segmenting (18 notes for 7 sung). Independent confirmation, nothing to adopt.
- aubio's *adaptive whitening* (per-bin temporal peak decay) is weaker than what `pitch-scan.ts`
  already does (per-frame local-median whitening across frequency). See §4.3.
- NeuralNote's note creation is a faithful port of the same `note_creation.py` we already call via
  `outputToNotesPoly`. We are not behind on it; we differ on two thresholds, deliberately (§2.2).
- **The via-silence topology is not a gap** — `voice-note-decoder.ts` already offers
  `transitionMode: 'via-silence'`, and a sweep already chose it. What is missing is *per-pitch*
  silence (§5.2), which is a different and much smaller change.
- **Praat's `octaveCost` is not a gap either** — we have the same slot filled with a *measured*
  register prior rather than a fixed bias toward the band ceiling (§6.5). We are ahead there.
- WaoN's instrument-template peeling (§9.1) only pays for polyphony, which is out of scope.
- **PyAutoTune adds nothing analytically** over what §1 already covered — it wraps the *unmodified*
  original Autotalent, and everything MXTune dropped from it is synthesis (§10).
- outotune's `allowed_range` estimator-level continuity constraint (§11.2) is already covered by
  CREPE's internal Viterbi.
- Averaging pitch in the log domain (§11.3): we already carry cents everywhere.
- Applying a note's target pitch only to its **voiced** frames (§15, PyVocalSync): `noteCents` already
  estimates from voiced frames only.
- DTW alignment to a reference (§15): the Dagstuhl corpus already ships per-take score alignments
  (DCS's own DTW of a CPDL MIDI against the room mic — see §15); our harness only ingests them.
- opentune (§15) contains nothing not already covered more competently in §1, §3 or §12.

---

## 1. MXTune — VST3/LV2, **GPL-3** (+ JUCE GPL-3-or-commercial)

https://github.com/liuanlin-mx/MXTune · read at `ea73804` (last commit 2024-06-02 — the project is dormant)

### 1.0 What it is, and what it is not

A real-time **pitch-correction** plugin, not a transcriber. Its core is Tom Baran's Autotalent
(`pitch_detector_talent.cpp`, `pitch_shifter_talent.cpp`, `auto_tune.cpp`, per the README's own
attribution) plus pieces of TalentedHack.

MIDI travels the **wrong way** for us: `midi_msg.cpp` is a 76-line note-on/off value holder, and its
only consumer is `mx_tune::record_midi_to_note` (`mx_tune.cpp:374`), which converts *incoming* MIDI
into correction targets so you can play the intended melody on a keyboard while singing. There is no
note writing to file and no notation output — though *(validation)* `output_midi_from_note`
(`mx_tune.cpp:462`) does emit live note-on/off derived from tune nodes into the plugin's MIDI output
buffer. **[P]**

So the overlap with us is exactly one stage — contour → discrete notes — plus one feature we lack.

### 1.1 ⭐ Key estimation from the take (the one thing worth taking)

Two-pass, and the second pass is a *user confirmation*:

1. `manual_tune::check_key` (`manual_tune.cpp:524`) segments the contour against a **fully chromatic**
   grid, counts only runs longer than `time_min_len`, and normalises the counts into a 12-element
   pitch-class weight vector. **[P]**
2. `KeyDetectGui` (`KeyDetectGui.cpp:290-310`) keeps the **top 7** classes, then tests all 12
   rotations of the major mask `{1,-1,1,-1,1,1,-1,1,-1,1,-1,1}` for an **exact** match
   (`_update_key`, `KeyDetectGui.cpp:511`); no match ⇒ label `----` (custom). **[P]**
3. `PluginGui.cpp:1026` shows the per-class **percentages**, lets the user toggle individual classes,
   and only writes `PARAMETER_ID_KEY` on OK. **[P]**

**Why this matters to us.** `keyFifths` reaches us *only* from the client's score metadata —
`recordings.gateway.ts:390` → `recording-pipeline.ts:168` → `keyPitchClasses` in
`mxml-builder.ts:123`. When someone records into a default C-major score but sings in E♭,
`keyClasses` is `null`-equivalent for their material, and `chooseNamingOffset` / `spellMidi`
(`voice-notation.ts`) spell key-blind — *(validation)* still tuning-normalised when `pitchMidiFloat`
is present (plain absolute only when the float is missing or the offset estimate has low confidence),
but with no key to steer accidental choice, which reads badly on the page either way.

**What to build, and how it differs from theirs.** A duration-weighted pitch-class histogram over the
take's own decoded notes, used only as a **fallback**:
- Weight by **duration**, not run count (they count runs, so a whole note and a quaver vote equally).
- Correlate against all **24** major/minor templates rather than requiring an exact 7-class mask
  match — Krumhansl–Schmuckler is no harder to write and degrades gracefully instead of returning
  "custom" whenever one accidental is present.
- Natural home is `MxmlBuilder.buildMeasure`, which already computes `estimateTuningOffsetCents(allNotes)`:
  same "one constant per take, estimated over everything seen so far" shape, so it costs one extra
  pass over `allNotes` and nothing structural.
- Keep their confirm-before-apply instinct. This is a guess; it should be visible and overridable.
- **Spelling-only.** It must never move a pitch, which is what makes it safe to try.

### 1.2 In-scale snapping as an over-segmentation defence

`_snap_pitch` (`manual_tune.cpp:804`) snaps to the nearest **in-scale** pitch, not the nearest
semitone: out-of-scale classes are deleted from the grid, so vibrato crossing into a non-diatonic
neighbour produces **no boundary at all**. **[P]**

Same instinct as our `minChangeSemitones`, and cheaper than a change cost — but it hard-forces
diatonic output, which is wrong for chromatic material. **Not adoptable**; recorded because it is the
third independent appearance of "make note changes expensive" in this file (see §16.2).

### 1.3 Per-note linear detrend

`_linear_fit_from_inpitch` (`manual_tune.cpp:734`) least-squares-fits the contour across a note's
span; `_tune2pitch` applies correction relative to that **trend** rather than a flat target, ramped
in/out by a sine over `attack`/`release`. **[P]**

We estimate a note's pitch as a trimmed mean or Hann-weighted median over its span
(`voice-note-decoder.ts:936`). For notes with monotonic drift — a scoop that never settles, a
portamento tail — a **linear-detrend-then-centre** estimator is pulled less by the ramp than a median
is. That is a third `pitchEstimator` variant and one more row in the existing sweep. Long shot, near
zero cost to test. (Superseded in priority by R4, which is the same idea done causally.)

### 1.4 The Autotalent detector — one detail, already covered

`pitch_detector_talent.cpp` is FFT autocorrelation at 4× overlap (`_noverlap = 4`), 70–800 Hz default
window, −60 dB gate, `_vthresh` 0.7, peak refined by 3-bin centre-of-mass. The one tidy trick: it
precomputes the autocorrelation **of the analysis window itself** and inverts it into `_acwinv`
(constructor, `pitch_detector_talent.cpp:73-111`), then reports confidence as
`peak × _acwinv[peak_idx]` — the **biased** peak locates the period, the **bias-corrected** height
scores it. **[P]**

Buys us nothing: CREPE hands us a calibrated per-frame confidence. Noted only because the identical
correction reappears in fat1 (§3.1), which makes it the standard fix rather than a quirk.

### 1.5 Deliberately not taken

- **Timeline design**: a flat 1 ms-per-slot array over a fixed 10-minute maximum
  (`_time2idx` = `round(time*1000)`, `max_len = 10*60*1000`), preallocated, `shared_ptr` per slot.
  That is an audio-thread no-allocation constraint, not our problem.
- **Undo**: a full snapshot list of `tune_node`s (`undo_redo.h`). Same snapshot strategy as
  `ManipulationHistoryManager` — mild independent confirmation of that call, no action.

---

## 2. NeuralNote — VST3/AU/standalone (JUCE), **Apache-2.0**

https://github.com/DamRsn/NeuralNote · read at `f979e51` (2025-01-16) · `Lib/Model/`, `Lib/MidiPostProcessing/`

The only open-source *plugin* in the survey that actually does audio→MIDI. It wraps **the same model
we use** — basic-pitch — with a hand-written C++ port of `note_creation.py` (RTNeural + ONNX for the
forward pass). **Apache-2.0 means this code is reusable by us**, unlike everything else in this file.

### 2.1 ⭐ The contour posteriorgram → sub-semitone pitch (R1)

`Notes::_addPitchBends` (`Notes.cpp`, bottom) reads the **contours** posteriorgram — 3 bins per
semitone (`CONTOURS_BINS_PER_SEMITONE`) — and per frame takes a **Gaussian-weighted argmax** over
±25 bins around the note's nominal bin (`inNumBinsTolerance = 25`, `std = 5.0f`), emitting a
deviation in **1/3-semitone units**. `dropOverlappingPitchBends` clears bends wherever notes overlap,
since a single MIDI channel cannot carry two. **[P]**

**This is the highest-value item in the file, because of what we currently discard.**
`ModelBackend.basicPitchForward` returns only `{frames, onsets}` (`model-backend.ts:43`) — the contour
head's output never crosses the gRPC boundary, and *(validation)* the local backend computes the
contour head in-process and drops it at the same seam, so the offline measurement in §17b needs no
service change at all. Consequently `pitchMidiFloat` is set only in `voice-note-decoder.ts` (:446,
plus the merge guard at :1014), i.e. only on the CREPE/voice path. **Instrument takes get integer
MIDI**, so `estimateTuningOffsetCents`, `chooseNamingOffset` and `spellMidi` (`voice-notation.ts`)
have nothing to work with off the voice path — and neither would R2's histogram or R4's smoother.

Concrete change: return `contours` from `basicPitchForward` (a real cost — one more matrix over the
wire per pass; `inference.proto` and both backends change), port the Gaussian argmax, populate
`pitchMidiFloat` in `note-extractor.ts`. **Measure before committing to the wire cost**: the
question is whether instrument takes have enough tuning error for offset estimation to pay, which
`scripts/eval` can answer from the contour matrix offline without touching the service.

### 2.2 Note creation — where we differ, and why that's fine

`Notes::ConvertParams` defaults (`Notes.h`) vs ours (`basic-pitch-provider.ts`):

| Param | NeuralNote | Ours | Note |
|---|---|---|---|
| `onsetThreshold` | 0.3 | **0.5** | We follow Spotify's *Python CLI*, not the TS-port defaults |
| `frameThreshold` | 0.5 | **0.3** | Ditto — note the two are **swapped**, not merely different |
| `minNoteLength` | 11 frames | 11 | ≈127 ms at 22050/256 |
| `energyThreshold` | 11 | 11 (`ENERGY_TOLERANCE`) | frames of sub-threshold energy tolerated *inside* a note |
| `inferOnsets` | true | true | |
| `melodiaTrick` | **true** | **false** | ours off deliberately: "invents extra notes from sustained harmonics" |
| `min/maxFrequency` | user (keyboard widget) | profile-driven | ours is automatic, theirs manual |

Two things worth flagging:
- The **swapped thresholds** are a real fork in behaviour, not a rounding difference. Their pairing is
  tuned for a plugin whose user can drag a slider; ours for a one-shot server pass. No action, but
  worth knowing the eval corpus has never been swept over their pairing.
- `energyThreshold = 11` is the same knob our HMM spells `unvoicedPitchCost` — a note rides through
  ~127 ms of dropout. Two independent codebases landing on 11 frames is a useful prior for that sweep.

### 2.3 The "melodia trick" — and a convergence worth noting

After the onset-driven pass, `Notes::convert` sorts every **remaining** note-posteriorgram cell by
energy descending, and greedily grows a note forward and backward from the strongest remaining cell,
**zeroing the ±1-semitone neighbours** as it goes (`inhibit` lambda), until energy drops below
`frameThreshold`. **[P]**

That is *iterative greedy peeling with harmonic/neighbour inhibition* — structurally the same move as
the Melodyne patent's "find highest prominence → trace contour → subtract that note's energy →
repeat" (`research-daw-products.md` §1.1). Two very different systems, same algorithm shape, which
raises confidence that peeling is the right family for polyphonic recovery.

We keep it **off**, and the reason in `basic-pitch-provider.ts:18` is sound for monophonic input.
Worth revisiting only if polyphony ever enters scope.

### 2.4 Inferred onsets — we already have this on, but read the mechanism

`_inferredOnsets` (`Notes.h`) augments the onset posteriorgram with the **positive temporal
difference of the note posteriorgram** at offsets 1 and 2 frames, takes the per-cell minimum across
offsets, rescales it to the onset head's range, and takes the element-wise max with the real onsets.
**[P]**

We pass `INFER_ONSETS = true`, so we get this. It is worth understanding because it is *the same
problem* `onset-detector.ts` exists to solve on the CREPE path — a re-articulation at the same pitch —
solved from the model's own note activations rather than the amplitude envelope. If R1 lands (contours
over the wire), the note-activation difference becomes available to the CREPE path too, as a
second, envelope-independent re-onset channel. That is a genuinely new option for the split/merge
problem, and unlike the envelope it does not care about the room.

### 2.5 Key snapping — direction from the bend sign

`NoteOptions::process` offers two modes over 13 scales: **Remove** out-of-key notes, or **Adjust**
them — and the snap direction comes from the **sign of the accumulated pitch bends**
(`std::accumulate(bends) >= 0 ? up : down`), not from nearest-integer. **[P]**

Our `spellMidi` already works off the fractional pitch, so the mechanism is covered. What is *not*
covered is the Remove-vs-Adjust choice as a user-visible decision — relevant to R2's UI.

### 2.6 Parameter naming (R8)

`onsetThreshold` is labelled **"Split-Merge Notes"** and `frameThreshold` **"More-Less notes"**
(`Notes.h` comments). Thresholds hidden behind musical intent. Given the measured asymmetry in
`research-daw-products.md` §0 item 2 (Join 3.2 s vs Split 5.6 s vs Create 145 s of user time), a single
split↔merge slider is the correct shape for our correction surface too.

---

## 3. fat1.lv2 / zita-at1 — LV2, **GPL-2+** (Fons Adriaensen, ported by Robin Gareus)

https://github.com/x42/fat1.lv2 · read at `a980204` (2026-04-20) · `src/retuner.{h,cc}` — 502 lines, and the best-engineered pitch
tracker in this file.

### 3.1 `findcycle` — four defences against octave errors (`retuner.cc:371`)

1. **Spectral tilt before the ACF.** The power spectrum is divided by `(1 + m²)` where
   `m = i · fsamp / (fftlen · 3e3)` — a 1/f² roll-off with a ~3 kHz corner — *before* the inverse
   transform. High harmonics, the usual cause of octave-too-high errors, are attenuated at source. **[P]**
2. **Window-ACF normalisation** by `_fftWcorr` — the same bias correction as Autotalent's `_acwinv`
   (§1.4). Two independent implementations ⇒ standard practice.
3. **Skip the main lobe.** `for (i = 4; i < _ifmax; i += 4)` walks past the zero-lag descent in
   4-sample strides before peak picking, so the trivial lag-0 peak can never win. **[P]**
4. **A hard periodicity floor**: a candidate must be a local maximum *and* satisfy `y > 0.8f`.
   Below that, `findcycle` returns 0 = "no pitch here" rather than a bad answer. **[P]**

Then **parabolic interpolation** on the raw ACF for sub-sample cycle precision
(`cycle = j + 0.5(x−z)/(z−2y+x)`), guarded against a near-zero denominator.

Applicability: our detectors are neural, so (1)–(2) are moot. But `pitch-scan.ts` *is* a hand-written
DSP scan, and it already has the equivalent of (4) (the `harmonicity` gate) and something stronger
than (1) (local-median whitening across frequency, §4.3). **No action** — recorded because it means
`pitch-scan.ts` independently arrived at the same defences as a widely-deployed tracker.

### 3.2 ⭐ Note-assignment hysteresis and within-note smoothing (R4, R6)

`Retuner::finderror` (`retuner.cc:453`) picks which of the 12 enabled scale notes the pitch belongs
to by distance — but subtracts `_notebias` from the **previous** note's distance:

```
if (i == _lastnote) a -= _notebias;      // staying is cheaper than switching
```

with `_notebias = v / 13.0f` (`retuner.h:46`). Then:

```
if (_lastnote == im) _error += _corrfilt * (dm - _error);   // one-pole smooth WITHIN a note
else               { _error  = dm; _lastnote = im; }        // HARD RESET at a boundary
```

**[P]** Two ideas in five lines:

- **Hysteresis** is our `changeCost` in O(1) and causal — a local bias rather than a global Viterbi
  term. Not a replacement (our HMM's whole advantage is being duration-weighted over the take), but
  the *right shape for the streaming pass*, which must emit notes before the take is over.
- **Smoothing that respects boundaries** is the interesting half. We estimate a note's pitch from its
  whole span once the boundaries are known (`noteCents`, trimmed mean / Hann median,
  `voice-note-decoder.ts:936`). AT1 smooths **causally, and never across a boundary**. For our
  incremental passes — which emit a note as soon as it settles past `STABLE_MARGIN_SEC` — a causal
  within-note estimator would give a stable pitch *earlier*, and would agree with the final
  whole-span estimate rather than drifting from it. Worth a sweep row alongside §1.3's detrend.
  `_corrfilt = 4·frsize/(v·fsamp)` gives the time-constant parameterisation for free.

### 3.3 Two-stage voicing decay (R6)

`Retuner::process` (`retuner.cc:288-307`) estimates pitch every 4th fragment, and on failure:

| Consecutive failures | Action |
|---|---|
| 1 | keep the current ratio; nothing released |
| **2** | `_lastnote = -1` — **release the note-continuity bias**, keep the note |
| >5 | `_voiced = false`, `_error = 0` — release the note |

**[P]** The continuity bonus is dropped *before* the note is. Our `unvoicedPitchCost` is a single
scalar doing both jobs: it decides both "does this note survive the dropout" and "does the pitch
identity survive it". Splitting them is a genuine refinement — a breath should cost a note its
*resistance to changing pitch* before it costs the note its life. Cheap to express as a second
transition cost in the Viterbi.

(There is also an RMS gate at −45 dBFS before detection is even attempted, in the `MOD` build.)

---

## 4. aubio (+ vamp-aubio-plugins) — library & Vamp/LV2 plugins, **GPL-3**

https://github.com/aubio/aubio · read at `ad5cf97` (2026-04-10) · the detector MXTune itself offers as an alternative
(`pitch_detector_aubio.cpp`), which is how it entered this survey.

### 4.1 ⭐ Adaptive onset threshold (R3) — `onset/peakpicker.c`

The onset novelty function is thresholded as:

```
thresholded = value − movingMedian(window) − threshold × movingMean(window)
```

after zero-phase `filtfilt` biquad smoothing, then peak-picked over 3 samples. **[P]**

Our `onset-detector.ts` uses **fixed** ratios (`dipRatio`, `riseRatio`, `minTroughSec`). The findings
recorded in that file's own doc comment are unambiguous: every fixed tightening helps sustained
singing and *costs* on guitarset/vocadito, and the conclusion drawn there is that
"whether to split on amplitude is a property of the MATERIAL, not of the room". A
median+mean adaptive threshold is precisely the standard answer to that: it self-calibrates to local
dynamics instead of asking us to pick one global ratio for both corpora. **This is the cheapest of
the high-value items** — it is confined to one file, the eval harness already sweeps it
(`sweep-reverb.ts`), and the measured baselines to beat are already written down.

### 4.2 Sub-frame onset position (R7)

`fvec_quadratic_peak_pos` fits a parabola to the 3-sample neighbourhood of the picked peak. aubio
also carries an explicit `delay` (`onset.c:42`) subtracted from every reported onset — an admission
that the ODF has a systematic latency.

Relevant to the documented −52 ms mean / −44 ms median onset error at `onsetAt: 'attack'`
(`voice-note-decoder.ts:192`). Quadratic interpolation improves *precision*, not *bias* — but aubio's
`delay` parameter is the honest fix for the bias, and we do not have one. Calibrating a constant
offset per profile is a one-line change with a measurable target.

### 4.3 Adaptive whitening — a non-finding, recorded

`spectral/awhitening.c` keeps a per-bin decaying peak envelope
(`peak = max(fftgrain[i], max(r_decay·peak, floor))`) and divides each bin by it, so the ODF becomes
insensitive to spectral colouration. **[P]**

`pitch-scan.ts` already whitens — by dividing each bin by its **local median across frequency**
(`WHITEN_HALF_WIDTH = 32`), capped, with the half-width deliberately chosen to land in the gaps
between a 55 Hz comb's harmonics. That is the stronger technique for a single frame.

The two are **orthogonal**: ours adapts across frequency *within* a frame, aubio's adapts *over
time* per bin. aubio's would matter only if we ever build a spectral-flux ODF for onsets (we are
energy-envelope only today), in which case whiten first. Recorded so this is not mistaken for a gap.

### 4.4 Notes = onsets ∧ pitch, with a relative release (R5)

`notes/notes.c::aubio_notes_do` runs an onset detector and a pitch detector **independently** and
combines them:

- an onset event closes the current note and opens a new one;
- **between** onsets, a note closes when the level drops `release_drop` dB (default **10**) below the
  level measured **at that note's own onset** (`last_onset_level`) — a *per-note anchored* release
  threshold, not a global gate; **[P]**
- defaults: silence −70 dB, min inter-onset interval 30 ms, and a `curnote > 45` plausibility floor.

The anchored release is subtly better than our `dipRatio` (relative to the *preceding peak*) for
takes with wide dynamic range, and costs nothing to try.

### 4.5 ⭐ Median-delayed note-on: skip the attack (R5)

With `median` mode on (`median = 6` by default), aubio does **not** emit the note at the onset. It
buffers the next 6 pitch estimates and emits the **median** of them
(`aubio_notes_get_latest_note` → `fvec_median`). **[P]**

This is the crude version of pYIN's attack states — the insight `note-segmenter.ts` calls "the single
most important reason pYIN survives expressive singing" — implemented as *ignore the first N frames,
then take a median*. Our HMM has attack states; the **basic-pitch path has no attack model at all**,
and a real take was measured starting 55 cents flat and arriving only ~150 ms later. If R1 lands and
basic-pitch notes gain a fractional pitch, "median of frames 3..9, not 0..6" is the obvious first
estimator to try, and 6 frames is a published starting value.

### 4.6 The ODF menu, for reference

`spectral/specdesc.c` exposes: `energy`, `hfc`, `complex`, `complexdomain`, `phase`, `wphase`,
`specdiff`, `kl`, `mkl`, `specflux`, plus shape descriptors (`centroid`, `spread`, `skewness`,
`kurtosis`, `slope`, `decrease`, `rolloff`). We use energy only. `specflux` and `complexdomain` are
the two the literature favours for pitched non-percussive onsets — the natural pair to try if R3's
adaptive threshold turns out not to be enough on its own.

---

## 5. pYIN (Vamp plugin, **GPL-2+**) — the reference implementation of *our own* note model

https://github.com/c4dm/pyin · read at `1d68cac` (last commit 2020-02-06) · `MonoNote*.{h,cpp}`, ~700 lines

`note-segmenter.ts` and `voice-note-decoder.ts` are both described in their own doc comments as
following pYIN/Tony (Mauch et al., TENOR 2015). **We had never read the source.** `note-segmenter.ts`
records that *every* configuration of it scored worse than the semitone-run baseline it replaced
(−0.06 to −0.16 F1, all 22 configs, every CI excluding zero). Reading `MonoNoteHMM::build` and
`MonoNoteParameters` turns up four structural differences, any of which could account for that.

### 5.1 The published parameters, side by side

`MonoNoteParameters.cpp` in full, against our defaults:

| pYIN | Value | Ours | Match? |
|---|---|---|---|
| `nPPS` (pitches per semitone) | 3 | `stepsPerSemitone` 3 | ✅ |
| `nSPP` (states **per pitch**) | **3** | **2** (attack, stable) | ❌ §5.2 |
| `pAttackSelftrans` | 0.9 | cited in our docs | ✅ |
| `pStableSelftrans` | 0.99 | cited in our docs | ✅ |
| `pStable2Silent` | 0.01 | — | ❌ §5.2 |
| `pSilentSelftrans` | **0.9999** | — | ❌ §5.2 |
| `sigma2Note` (σ of the jump distribution) | **0.7 st** | flat `changeCost` | ❌ §5.3 |
| `maxJump` | **13 st** | uncapped | ❌ §5.3 |
| `minSemitoneDistance` | **0.5 st** | `minChangeSemitones`, doc cites 2/3 | ⚠️ §5.4 |
| `sigmaYinPitchAttack` | 5 | `sigmaAttackSemitones` ≈5 | ✅ |
| `sigmaYinPitchStable` | 0.8 | `sigmaStableSemitones` ≈0.9 | ~ |
| `yinTrust` | 0.1 | `trust`, doc cites 0.1 | ✅ |
| `priorPitchedProb` / `priorWeight` | 0.7 / **0.5** | hard voiced mask | ❌ §5.5 |

Everything our docs quote from the *paper* is right. Everything the paper doesn't state is different.

### 5.2 ⭐ The third state is a **per-pitch** silence, and it is the only way between notes

`MonoNoteHMM::build`'s own comment gives the layout: for each of the 3×69 pitches, states are
`{attack, stable, silent}`. The transition list contains **no direct pitch→pitch edge at all**:

```
attack(p) → attack(p)   0.9        stable(p) → stable(p)  0.99
attack(p) → stable(p)   0.1        stable(p) → silent(p)  0.01
silent(p) → silent(p)   0.9999
silent(p) → attack(q)   (1 − 0.9999) × N(|p−q| ; 0, 0.7) / Z     for q with |p−q| ∈ {0} ∪ (0.5, 13)
```

**[P]** So changing note costs `−ln(0.01) + −ln(10⁻⁴)` ≈ 4.6 + 9.2 ≈ **13.8 nats**, structurally, and
`|p−q| == 0` is permitted — which is how pYIN represents a **re-articulation of the same pitch**.

**What we already have.** `voice-note-decoder.ts` has a `transitionMode: 'via-silence'` that removes
the direct pitch→pitch edge, and the sweep behind it found the mandatory-silence structure the right
one (doc comment, lines 34-36). So the *topology* is not the gap.

**What is the gap.** Our state layout is `0 = silence, 1..n = attack(p), n+1..2n = stable(p)` — **one
global silence state** (`voice-note-decoder.ts:610`). pYIN has one silence state **per pitch**.
Consequence: pYIN's silence *remembers the pitch you left*, so the interval-weighted jump
distribution still applies across a rest. With a single silence state, all pitch memory is destroyed
the moment a note ends — a step and a minor tenth cost exactly the same after any gap, and there is
no mechanism at all preferring a return to the pitch just left. Cost: the state space grows from
`2n+1` to `3n`, which is nothing.

### 5.3 ⭐ There is no flat change cost anywhere in pYIN

Note changes are weighted by a Gaussian over the **interval**: `N(semitoneDistance; 0, sigma2Note=0.7)`,
normalised over the reachable set, hard-capped at `maxJump = 13` semitones. **[P]** Ours is a single
scalar `changeCost` for every interval — *(validation)* almost: the decoder carries a shelved two-tier
interval cost, `wideChangeCost`/`wideIntervalSemitones` (:137-139), defaulted off, whose docstring
records that two tiers were chosen over a smooth cost-of-interval for O(states) reasons. R10(a)
therefore starts from that knob and its recorded rationale, not from zero.

This matters more than it looks, because our own findings say the corpora want *opposite* flat values
("sustained vibrato-heavy singing needs a high cost, fast humming a low one — a single global setting
provably cannot serve both", `note-segmenter.ts`). An interval-weighted cost is not a compromise
between those two, it is a different axis: vibrato flutter is a ±1-step excursion and a melodic move
is usually larger, so weighting by interval separates exactly the two cases a flat cost conflates.
Praat reaches the same conclusion independently (§6.2), which is the strongest single signal in this
document.

### 5.4 A doc/paper discrepancy worth fixing

`note-segmenter.ts` documents `minChangeSemitones` as "pYIN allows only the same, or at least 2/3 of a
semitone different". The source says **0.5** (`minSemitoneDistance`). Whichever the paper says, the
shipped reference implementation uses 0.5 — worth a comment correction and one sweep row.

### 5.5 Voicing is blended, never authoritative

`MonoNoteHMM::calculateObsProb`: the frame's summed candidate probability is mixed 50/50 with a fixed
0.7 prior —

```
pIsPitched = Σ candidateProb × (1 − 0.5) + 0.7 × 0.5
```

— then pitch-state emissions are scaled by `pIsPitched` and silent-state emissions by `1 − pIsPitched`.
**[P]** Our `voicedMask` (`pitch-track.ts`) is a hard boolean: confidence ≥ threshold AND inside the
register window. Praat does the same blending in a different form (§6.3). A soft voicing term is a
small change to `emit()` and removes a threshold we currently have to tune per profile.

### 5.6 ⭐ The deepest difference: pYIN's note model sees **many pitch candidates per frame**

`calculateObsProb` takes `vector<pair<double,double>>` — a **list of (pitch, probability) pairs** per
frame — and for each state uses the *nearest* candidate, weighting by `candidateProb^yinTrust`. **[P]**
That distribution is the entire point of the "p" in pYIN: YIN's threshold parameter is swept and each
resulting f0 candidate keeps a probability, so the note HMM can select a **non-argmax** candidate when
the note-level context favours it. Octave errors and transient glitches are recoverable at the note
layer precisely because the alternative is still on the table.

`PitchTrack` carries `cents: Float32Array` and `confidence: Float32Array` — **one hypothesis per
frame** (`pitch-track.ts`). `CrepeProvider` collapses CREPE's 360-bin activation to a local weighted
mean — *(validation)* centred on its internal Viterbi path bin, not the raw argmax — before anything
downstream sees it (`crepe-provider.ts:280-305`). Frame-level continuity already steers the collapse;
the *note-level* choice among candidates is what is missing. So our decoder
is structurally unable to do the thing that makes pYIN work, and no amount of tuning `changeCost`
recovers it.

**The activation matrix already exists** — `crepePredict` returns all 360 bins per frame. Extracting
the top-k local maxima (k=3-5) per frame and widening `PitchTrack` to carry them is contained, needs
no new inference, and the eval harness caches tracks per clip so the experiment is cheap. **This is
the highest-ceiling item in this document**, and it is the one that would make our pYIN
reimplementation a fair test of pYIN rather than of a single-candidate approximation to it.

---

## 6. Praat (**GPL-3**) — the canonical formulation of the cost structure we use

https://github.com/praat/praat · read at `4073a56` · `fon/Sound_to_Pitch.cpp`, `fon/Pitch.cpp::Pitch_pathFinder`

Not a plugin — a research application, and the most-cited pitch tracker in existence (Boersma 1993).
Included because `Pitch_pathFinder` is the reference formulation of a Viterbi over pitch candidates
with explicit, *named, published-default* costs, and because it independently confirms §5.3 and §5.6.

Defaults, from the UI declarations (`fon/praat_Sound.cpp:1633-1638`): `silenceThreshold` **0.03**,
`voicingThreshold` **0.45**, `octaveCost` **0.01**, `octaveJumpCost` **0.35**, `voicedUnvoicedCost`
**0.14**, floor 75 Hz, ceiling 600 Hz, **max 15 candidates per frame**. **[P]**

### 6.1 ⭐ Costs are declared per 10 ms and rescaled to the actual hop

```
const double timeStepCorrection = 0.01 / my dx;
octaveJumpCost      *= timeStepCorrection;
voicedUnvoicedCost  *= timeStepCorrection;
```

**[P]** (`Pitch.cpp:543-545`, dated in-source `20011015` — they hit this bug in 2001.)

`note-segmenter.ts` reasons about exactly this by hand: "pYIN gets this for nothing from its attack
self-transition probability of 0.9 … at its ~6 ms hop. Our hop is 20 ms, so an equivalent time-domain
decay needs roughly 3.4× that per frame." Praat institutionalises the correction so no parameter is
ever hop-dependent. **We should do the same**: declare every per-frame cost in `NoteSegmenterOptions`
and `VoiceDecoderOptions` per 10 ms and scale by `hopSec / 0.01` at construction. It is a few lines,
it makes every historical sweep number comparable across hops, and it removes a whole class of silent
mis-tuning — including the 10 ms-vs-20 ms grid caveat already recorded in the Findings log.

### 6.2 ⭐ The jump cost is proportional to the interval

```
transitionCost = octaveJumpCost * fabs (NUMlog2 (f1 / f2));   // both voiced
```

**[P]** (`Pitch.cpp:606`) — linear in log-frequency, i.e. **per octave of leap**. Same conclusion as
pYIN's Gaussian-over-interval (§5.3) reached by a completely different route. Two of the most-used
pitch trackers in the field make note/pitch changes cost *in proportion to the interval*; we charge a
constant. This is R10.

### 6.3 Voicing is a smooth, intensity-scaled competitor — not a gate

```
unvoicedStrength = voicingThreshold + max (0, 2 − intensity / (silenceThreshold / (1 + voicingThreshold)))
```

**[P]** (`Pitch.cpp:553-555`) The unvoiced *hypothesis* simply gets a strength, which grows as the
frame gets quieter, and competes in the same Viterbi as the pitch candidates. There is no gate and
nothing is discarded. Combined with §5.5, that is two references agreeing that voicing belongs in the
objective rather than in a pre-filter.

### 6.4 A pitch jump across a rest is not free

Under `Melder_debug == 30`, when moving unvoiced→voiced Praat walks **back through the Viterbi
back-pointers** across the voiceless stretch to find the last voiced frame, and charges
`octaveJumpCost × |log2(f1/f2)| / (iframe − jframe)` — the interval cost, amortised by the length of
the gap. **[P]** (`Pitch.cpp:596-603`)

This is the *exact* repair for the §5.2 gap: it recovers pitch memory across silence without needing
per-pitch silence states. Two independent implementations of the same insight — pYIN structurally,
Praat by path lookback — and we currently have neither. Note it is debug-gated in Praat, i.e.
experimental there too; treat it as the cheaper of the two options to try, not the safer one.

### 6.5 `octaveCost` — a deliberate bias toward the ceiling

`delta = candidateStrength − octaveCost × log2(ceiling / f)` (`Pitch.cpp:560`) penalises low
candidates, counteracting autocorrelation's structural preference for sub-harmonics. **[P]**

We have an `octaveCost` array too (`voice-note-decoder.ts:635-641`) but it is a **register prior**:
distance from the session's measured register centre, from the pitch scan. Same slot in the objective,
better anchor — ours is measured per take rather than fixed to the band edge. *(validation)* Two
caveats: the prior ships **off** (`octavePriorWeight` defaults to 0 — the file's own note reads
"octave-error rate is now 0.001 — nothing to fix"), and nothing in production supplies
`registerCents`; the only caller is `sweep-voice.ts`, substituting the clip's median voiced pitch.
**No action**; recorded because the naming collision would otherwise cause confusion, and because the
*design* is ahead of the reference even though the shipped wiring is dormant.

---

## 7. Essentia (**AGPL-3**) — three algorithms that are literally our stages

https://github.com/MTG/essentia · read at `b9fa6cb` · `src/algorithms/tonal/`

A library, not a plugin, and **AGPL-3** — the most restrictive licence here. Included because it ships
`PitchContourSegmentation`, `Pitch2Midi` and `Key`, which map one-to-one onto our contour→notes,
note-toggle and key-estimation problems, all short enough to read in full.

### 7.1 ⭐ `PitchContourSegmentation` — segment against the note's own running mean

178 lines, three stages (`pitchcontoursegmentation.cpp:100-178`). **[P]**

1. **Pitch-distance "island building".** Convert the contour to cents *relative to a tuning
   frequency* (*(validation)* a declared parameter, default 440 — the estimate arrives from the
   caller), seed a running mean over the first `minDuration` frames, then walk forward:
   while `|contour[j] − runningMean| < pitchDistanceThreshold` (**60 cents**), extend the note **and
   update the mean**; otherwise cut, skip `minDuration` frames, and re-seed the mean.
2. **RMS z-score.** Within each surviving segment, compute mean and σ of RMS **over that segment
   only**, and cut wherever `z < −2`.
3. Re-segment between stages; final pitch = mean of the contour over the segment, rounded.

Three transferable ideas, in descending order:

- **The reference is the note's own accumulated mean, not a fixed grid.** A note that drifts slowly is
  never cut, because the mean follows it; a genuine step out is. That is the same job our sub-semitone
  states + attack σ do, in 20 lines and with no Viterbi — and it handles *unbounded* drift, which a
  fixed state grid cannot. Worth having as a baseline in the sweep if nothing else: it is the cheapest
  thing in this file that could plausibly beat the semitone-run segmenter.
- **The threshold is 60 cents**, not a semitone and not 2/3 of one (cf. §5.4). Three different values
  now in play for the same decision.
- **RMS normalised per note candidate**, not globally and not over a sliding window. Strictly more
  adaptive than aubio's moving median (§4.1) and than our global `dipRatio`. Cheapest variant of R3.

**And an ordering difference worth its own line.** Essentia expresses the contour in cents **relative
to a tuning frequency before segmenting** — supplied as a parameter, but supplied *before*
segmentation. We estimate a tuning offset
(`estimateTuningOffsetCents`) but consume it only at spelling time, in `MxmlBuilder.buildMeasure`. So
every threshold in our segmentation is applied on an A440 grid even when the take is 40 cents flat —
which shifts every note the same way and therefore eats the same fraction of every tolerance. Moving
the tuning estimate *upstream* of segmentation is a genuine correctness point, not a tuning knob.

### 7.2 ⭐ `Pitch2Midi` — asymmetric confirmation, and compensate the delay

Parameters (`pitch2midi.h`), all defaults **[P]**:

| Parameter | Default | What it means |
|---|---|---|
| `midiBufferDuration` | 0.015 s | voting buffer for the note-toggle decision |
| `minOccurrenceRate` | 0.5 | a note must win **≥50%** of that buffer to be accepted |
| `minNoteChangePeriod` | 0.030 s | minimum wait before a note *change* is accepted |
| `minOnsetCheckPeriod` | **0.075 s** | minimum wait before an *onset* is confirmed |
| `minOffsetCheckPeriod` | **0.200 s** | minimum wait before an *offset* is confirmed |
| `applyTimeCompensation` | true | **subtract the confirmation delay back out of the timestamp** |

- **Onsets and offsets get different confirmation windows** — 75 ms vs 200 ms, a 2.7× asymmetry.
  Offsets are allowed to be far lazier. This is the correct shape for us: the editing-cost asymmetry
  in `research-daw-products.md` §0 item 2 says a slightly-long note is cheap to fix and a spurious
  split is expensive, so the *offset* is where laziness is affordable. We use a single
  `STABLE_MARGIN_SEC = 0.4` (`recording-pipeline.ts`) for everything, and it is more conservative than
  either of Essentia's.
- **Majority voting over a short buffer** rather than a threshold on a single frame.
- **`applyTimeCompensation` is the third independent appearance** of "a confirmation delay must be
  subtracted back out" (aubio's `delay`, §4.2; and our own measured −52 ms mean / −44 ms median at
  `onsetAt: 'attack'`). At this point it is not an idea, it is an omission on our side.

### 7.3 `Key` — the state of the art is not Krumhansl

`key.h` exposes **14** profile types — `{diatonic, krumhansl, temperley, weichai, tonictriad,
temperley2005, thpcp, shaath, gomez, noland, edmm, edma, bgate, braw}` — and defaults to **`bgate`**,
not Krumhansl. It also offers `usePolyphony` (adds triad and harmonic contributions to the profile),
`numHarmonics` 4, and `useMajMin`: **a third "ambiguous" class** for tracks that are neither cleanly
major nor minor. **[P]**

This directly refines **R2**, which I had specified as "Krumhansl–Schmuckler over 24 templates": make
the profile a parameter rather than a constant, and provide an **abstain** outcome. See §8 for the
second, independent vote for abstaining.

---

## 8. libKeyFinder (**GPL-3**) — key classification, done properly

https://github.com/mixxxdj/libkeyfinder · read at `941e517` · `src/keyclassifier.cpp`, `src/toneprofiles.cpp` — the key
detector inside Mixxx, i.e. the most-run key detector in the DJ world.

Two design decisions worth copying into R2 **[P]**:

### 8.1 A 72-band chroma, not a 12-band one

`BANDS = 72` = `OCTAVES (6) × SEMITONES (12)`. `ToneProfile::cosineSimilarity` accumulates the
intersection and both norms **across all six octaves separately** (`toneprofiles.cpp:70-100`), with a
circular doubly-linked list of `Binode`s used to rotate the profile by `offset` semitones. Octave
placement is *not* folded away.

Why it matters for us: a melody's tonic is usually reinforced in a particular register, and folding to
12 bins throws that away. Our notes carry octave already — so a 72-band histogram is free, where for a
spectral system it costs a 6× wider transform.

### 8.2 ⭐ An explicit **abstain**, implemented as a competing profile

```
silence = new ToneProfile(std::vector<double>(BANDS, 0.0));
...
bestScore = silence->cosineSimilarity(chromaVector, 0);   // the bar to beat
key_t bestMatch = SILENCE;                                 // the default
for (i = 0; i < 24; i++) if (scores[i] > bestScore) { ... }
```

**[P]** (`keyclassifier.cpp::classify`) The all-zeros profile is scored *as one of the candidates* and
seeded as the incumbent, so a key is returned **only if it beats "no key at all"**. No confidence
threshold to tune, no separate abstain rule — the abstain option simply competes.

That is the cleanest possible answer to R2's biggest risk (confidently mis-spelling a chromatic or
modal take), and it is four lines. Together with Essentia's `useMajMin` (§7.3) and MXTune's `----`
custom fallback (§1.1), **all three key detectors in this survey can decline to answer.** R2 must too.

---

## 9. WaoN (**GPL-2**) — pure-DSP audio→MIDI, and one filter we don't have

https://github.com/kichiki/WaoN · read at `55153b8` · `analyse.c`, `notes.c` — the classic wave-to-notes converter,
no ML anywhere.

### 9.1 Iterative peeling, with an instrument template

`note_intensity` (`analyse.c`) loops: find the strongest spectral peak above the cutoff → map to a
MIDI note → **subtract it** → repeat until no peak clears the cutoff. Subtraction has two modes:
zero the peak and walk down both slopes to the local minimum, or (with a patch file)
`p[i] -= max × patch_power(f/freq)` across the whole band — i.e. subtract a **measured harmonic
template of the instrument**, scaled to the peak. **[P]**

Fourth appearance of greedy peeling (Melodyne §2.3, melodia trick §2.3, and now WaoN), and the only
one that peels with an *instrument-specific* template. We resolve an instrument hint per session
already (`profiles/profile-resolver.ts`), so a per-instrument harmonic template is not far-fetched —
but this is only worth anything for polyphony, which is out of scope. **Recorded, not proposed.**

### 9.2 The cutoff is relative to the frame's own mean power

`max = av × pow(10, rel_cut_ratio)` where `av` is the mean power over the analysis band, with
`abs_flg` switching to an absolute `pow(10, cut_ratio)` instead. **[P]** Fifth independent appearance
of adaptive-not-fixed thresholding (§16.5).

### 9.3 ⭐ A joint duration × velocity note filter

`notes.c:232-270` removes a note only if **`duration <= min_duration` AND `vel <= min_vel`**; a second
pass (`notes.c:319-353`) removes notes with **`duration >= max_duration` AND `vel <= min_vel`**. **[P]**

Both of our short-note filters are duration-only — `minFrames` (`note-segmenter.ts`),
`MIN_NOTE_LEN_FRAMES = 11` (`basic-pitch-provider.ts`), `absorbShortRuns`
(`voice-note-decoder.ts:867`). WaoN's reading is better and obviously so once stated: a short note
that is also **loud** is a real staccato note; a short note that is **quiet** is a glitch. And the
second pass catches what we have no filter for at all — a **long, quiet** note, which is exactly the
shape of a reverb tail or a bleed-through, and which our reverb findings say we suffer from.

basic-pitch already gives us `amplitude` per note event (it is averaged over the note's span in
`Notes.cpp`, and `outputToNotesPoly` computes the same), and we have `energy` on the pitch track. So
the input exists; only the filter is missing. Cheapest item in this whole document: two conditions,
one sweep, and it targets a failure mode we have measured.

---

## 10. PyAutoTune / the original Autotalent (**GPL-2+**) — an honest non-finding

https://github.com/ederwander/PyAutoTune · read at `5438fe2` (2020-10-15) · `autotalent.c` (1491 lines)

PyAutoTune is a Python C-extension wrapper (`PyAutoTuner.c`, `setup.py`) around **Tom Baran's original
`autotalent.c`**, unmodified. Worth reading because §1 covered Autotalent only through MXTune's
*fork*, so the question "did MXTune drop anything analytically useful?" was still open.

**Answer: no.** The detector is line-for-line the same algorithm — `conf = tf2 * acwinv[ti4]`
(`autotalent.c:1074`), `vthresh = 0.7` (`:537`), the same window-autocorrelation bias inversion, the
same 3-bin centre-of-mass refinement. What MXTune dropped is all **synthesis**: a vibrato LFO
(`lfophase`, `:1175`) and an LPC-based formant corrector (`ford = 7`, "somewhat experimental" in the
original's own comment, `:973`). Neither touches analysis.

**The one thing worth recording** is not an algorithm but a datum: the original ships
`vthresh = 0.7` as the voiced-confidence threshold, and *every* descendant in this survey keeps it —
MXTune (`_vthresh(0.7)`), TalentedHack (`p_vthresh`), pYIN's own `MonoNote` uses 0.7 as
`priorPitchedProb` (§5.1). Four codebases, same number, different algorithms. Our
`confidenceThreshold` is profile-resolved and swept, which is better — but 0.7 is the field's default
prior and is a sensible centre for that sweep.

For completeness: PyAutoTune's actual contribution is the *harness* — driving a real-time block-based
C DSP core from a scripting language over file input (`Examples/TuneAndPlayFromFile.py`). We already
have that shape via gRPC to the inference services. Nothing to take.

---

## 11. outotune (**GPL-3**; wrapping WORLD, **modified BSD**) — the two-stage estimator, and a strategic admission

https://github.com/RichardHladik/outotune · read at `47810b4` (2024-04-25) ·
`plugins/outotune/World.cpp`, `Scale.hpp`

A DISTRHO (DPF) LV2/VST plugin built on **WORLD** (mmorise), the speech analysis/synthesis system.

### 11.1 ⭐ The strategic finding, from the README

> "Originally, Outotune was meant to be an opensource Autotune/Melodyne implementation, but it evolved
> into a **harmoniser**." — `README.md`

It is now MIDI-controlled: you sing, you play the chord, it resynthesises your voice at the pitches
you played. The automatic-pitch-target problem was not solved, it was **removed from scope**.

Put that beside the other two autotune projects in this survey: MXTune's key detection ends in a
**confirmation dialog** the user must approve (§1.1); TalentedHack's `MixMidiIn` lets an incoming MIDI
note **override** the detected one outright (§12.4). Three independent open-source autotune efforts,
three different ways of declining to decide which note the singer meant — the same conclusion
`research-daw-products.md` §0 item 1 draws from the commercial side, now from three more sources.

**And it points at an asset we have and they do not: the score.** A user recording into a Solkey score
has given us a key signature, a time signature, a tempo, an instrument — and, when re-recording a
passage, *the notes that are already there*. That is exactly TalentedHack's MIDI input, arriving for
free. §14 keeps this as a note rather than a task because a score is a weak prior for new material and
a strong one for a re-take, and telling those apart is its own problem — but it reframes R2: we are not
short of evidence about intent, we are short of *using* it.

### 11.2 Two-stage f0: coarse estimate, then refine

```
Dio(buffIn, bufferSize, rate, &f0option, time, f0aux);              // candidates
StoneMask(buffIn, bufferSize, rate, time, f0aux, f0length, f0);     // refinement
```

**[P]** (`World.cpp::estimate`) WORLD separates candidate generation (DIO) from refinement
(StoneMask, which re-estimates each f0 from the spectrum around the coarse value). `f0option.allowed_range
= 0.2` additionally bounds frame-to-frame f0 change **inside the estimator**, before any decoding.

We have a coarse/fine split of a different kind — `pitch-scan.ts` picks the register and window, the
provider then estimates within it. So the pattern is present. The genuinely different idea is
`allowed_range`: a continuity constraint applied at the *estimator*, not only in the note decoder.
Low priority for us (CREPE's Viterbi already does this internally) but worth knowing it is a
three-layer defence upstream, not two.

### 11.3 Averaging in the log domain, with a voiced quorum

```
for each fragment: if (f[i] == 0) continue; mean += Scale::freq_to_semitones(f[i]); total++;
return total <= cnt / 4 ? 0 : Scale::semitones_to_freq(mean / total);
```

**[P]** (`World.cpp::aggregateF0Fragments`) Two things:

- **Average in semitones, never in Hz.** We carry `cents` throughout (`pitch-track.ts` documents
  exactly this reasoning), so ✅ already right.
- ⭐ **A voiced-fraction quorum**: unless **more than a quarter** of the fragments in the block are
  voiced, report *unvoiced* for the whole block — a few stray voiced frames cannot manufacture a pitch.
  This is now the **fourth** quorum-over-a-window design in the survey (Essentia's
  `minOccurrenceRate = 0.5` over 15 ms, §7.2; aubio's median-of-6, §4.5; and this). Our `voicedMask` is
  strictly per-frame with no block-level quorum anywhere — the nearest thing is `minFrames` *after*
  segmentation, which is a different guard. Cheap to add and it targets exactly the spurious short
  notes our reverb tier suffers from (R19).

### 11.4 A licence note that matters

outotune is GPL-3, but **WORLD itself is modified-BSD** — so DIO, StoneMask, Harvest and CheapTrick are
*reusable*, unlike almost everything else in this document. If a DSP f0 fallback is ever wanted (a path
with no model server, e.g. for the eval harness or a degraded mode), WORLD is the licence-clean option,
and Harvest in particular is competitive with neural estimators on clean singing. Recorded as an option,
not proposed — `research-pitch-models.md` §1 is the place that adjudicates estimators.

---

## 12. TalentedHack (**GPL-3**) — the Autotalent fork MXTune credits, and the best ideas of the three

https://github.com/jeremysalwen/TalentedHack · read at `1b4c2e9` (2022-02-13) · `pitch_detector.c`,
`pitch_smoother.c`, `quantizer.c`

Its README states the delta over Autotalent, and two items on that list are analysis, not synthesis:
"Slightly more accurate pitch detection (Uses **MPM** method instead of straight autocorrelation)" and
"It **separates the pull to semitone and snap to scale** functionality". Both are worth having.

### 12.1 ⭐ MPM: pick the *earliest* peak that is good enough, not the highest

`get_pitch_period` (`pitch_detector.c:68`), credited to McLeod & Wyvill's Tartini:

```
while (**bestpeakindex < *pdetector->p_ppickthresh * peak) bestpeakindex++;
```

**[P]** Peaks are collected in lag order; `peak` tracks the tallest seen; the chosen peak is the
**first** one clearing `p_ppickthresh × tallest`. It also skips to the **second zero crossing** before
it starts looking, then parabolically interpolates, then applies the same `acwinv` bias correction as
Autotalent.

Why this is the important line in the file: an ACF has a peak of *almost the same height* at twice the
true lag, so "take the tallest peak" picks the octave-too-low answer whenever noise tips the balance —
which is the single most common failure of autocorrelation pitch detection. "Take the **earliest**
peak above a fraction of the tallest" prefers the *shorter* period, i.e. the higher fundamental,
breaking the tie in the direction that is right.

**How it applies to us.** Our estimators are neural, so MPM as such does not port. But R9 (§5.6) puts
us in the business of *choosing among candidates*, and the moment we have k candidates per frame we
need a tie-break for the octave case. MPM supplies it as a rule: **when two candidates are ~an octave
apart and the lower one is not clearly stronger (within `ppickthresh`), take the higher fundamental.**
That is one comparison inside R9's candidate reduction, and it is the same conclusion Praat reaches
with `octaveCost` (§6.5) and AT1 with its 1/f² tilt (§3.1) — see §16.11.

### 12.2 ⭐ A slew-rate limiter with momentum — a smoother that actually arrives

`SmoothPitch` (`pitch_smoother.c`), in full **[P]**:

- Differences below `maxdiff = 0.04` semitones (**4 cents**) bypass smoothing entirely.
- Otherwise the step is `toadd = diff / (pitchsmooth × periods_per_second)` — a **rate limit**, and one
  normalised by the analysis rate (see §16.10).
- Then a three-way momentum rule: accelerate if `|momentum| < |toadd|`; **snap straight to the target**
  if `|momentum| > |diff|` (the remaining distance is smaller than the current step); otherwise coast.

Compare fat1's one-pole (§3.2): a one-pole *asymptotically approaches* and never arrives, so a note's
reported pitch keeps creeping for its whole duration. This arrives, and it arrives without overshoot
because the momentum rule detects the crossing. For a **streaming** pitch estimate — ours must emit a
note before the take is over — "arrives, then holds" is the behaviour we want, and "creeps forever" is
a bug we would have to compensate.

Concretely: a third variant for the `pitchEstimator` sweep, alongside R4's one-pole and §1.3's linear
detrend. Of the three this is the one I would try first, because it is the only one whose steady-state
value is the target.

### 12.3 ⭐ Two scale masks: what the singer *meant* vs what we *write*

```
Notes inotes; // The notes to be detected, should be the set of notes that the singer is attempting to sing
Notes onotes; // The set of notes to be output, i.e. the scale you want the output to be in.
```

**[P]** (`quantizer.h`) `pperiod_to_midi` quantises the detected pitch against `iNotes`; the output is
snapped against `oNotes`. Two independent 12-element masks for two genuinely different jobs.

**This is a real conceptual correction to R2/R14, which I had specified as one key.** In our pipeline
those two jobs also exist and are also different:

| Job | Governed by | Today |
|---|---|---|
| **Interpretation** — which note did the singer intend? | the key they are actually singing in | nothing; the decoder is key-blind |
| **Spelling** — how do we write it on the page? | the score's key signature | `keyFifths` → `keyPitchClasses` → `spellMidi` |

So the take-derived key from R2 belongs on the **interpretation** side, and the score's key signature
stays authoritative for **spelling**. They can legitimately disagree — a singer improvising in D
Dorian over a score written in C major is not an error to be reconciled, and forcing one mask onto both
jobs would make it one. This changes R2's design rather than its priority: estimate the take's key,
use it to *decode*, and keep spelling where it is.

### 12.4 MIDI as an override, and MIDI note+bend as the output representation

`MixMidiIn` returns the incoming MIDI note in preference to the detected one whenever
`p_accept_midi > 0` (`quantizer.c`). And `semitones_to_midi` emits an integer note plus
`pitchbend = diff/6` (±6 semitones), with a comment noting MIDI's bend asymmetry (+8191 / −8192).

The override is §11.1's theme. The representation is the **third** appearance of "integer note carries
the identity, a continuous deviation carries the truth" — NeuralNote's per-frame bends (§2.1), this,
and our `pitchMidiFloat`. Convergent, and it validates R1's shape.

### 12.5 ⚠️ Two real bugs — do not copy these functions verbatim

Flagged because §15 says TalentedHack is GPL and therefore reference-only, and because both are the
kind of thing a careful reimplementation would silently inherit:

- `SnapToKey` (`quantizer.c`): `while (notes[positive_mod(higher, 1)] < 0) higher++;` — **`1` should be
  `12`**. `x mod 1` is always 0, so the loop tests `notes[0]` forever: an infinite loop whenever pitch
  class A is disabled. **[P]**
- `get_pitch_period` (`pitch_detector.c`): `int denominator = 2*bestpeak[0] - bestpeak[1] - bestpeak[-1];`
  and the matching `int numerator` — `bestpeak` is `const float*`, so both are **truncated to int**.
  On normalised autocorrelation values these truncate to 0, `denominator != 0` fails, and the parabolic
  interpolation silently degrades to the integer lag. **[P]** The interpolation the README advertises
  is effectively dead code.

Neither affects the *ideas* in §12.1–§12.3, which are what we are taking.

---

## 13. Auto_Tune (**no licence — all rights reserved**) — the Auto-Tune patent, implemented

https://github.com/Eric-D-Stevens/Auto_Tune · read at `f42bd80` (2021-08-07) · `AutoTune.py` (179 lines)

Self-described as "a basic Python implementation of the **Auto-Tune patent**". `research-daw-products.md`
§1.1 works through the *Melodyne* patent; this is the complement, and unlike the Autotalent family
(§1, §10, §12) it is not a fork of anything — it is a from-the-patent reconstruction.

### 13.1 ⭐ An O(1)-per-lag recursive squared-difference detector

The patent's detector is the **ASDF** (average squared difference function) computed with **running
sums**, so no window is ever re-summed and there is no FFT at all **[P]**:

```
E[i,L] = E[i-1,L] + x[i]²      − x[i-2L]²                    # energy over a 2L window
H[i,L] = H[i-1,L] + x[i]x[i-L] − x[i-L]x[i-2L]               # lag-L correlation
ASDF   = E[i,L] − 2·H[i,L]
```

Each of the ~111 candidate lags is maintained incrementally per sample, at **two multiplies and two
adds each**. Compare every other detector in this document, all of which recompute an FFT or a full
autocorrelation per frame. If we ever want a cheap licence-clean DSP f0 path (§11.4), this is the
shape it should have — and it is the only *sample-rate-incremental* detector here, which matters for a
streaming pipeline in a way frame-based ones do not.

### 13.2 ⭐ "First lag good enough", a third time

```
if subTable[i,L] < sensitivity * Ei_Table[i,L] and L > min_L and L < max_L:
    ... break
```

**[P]** L is scanned from `min_L` upward and the search **breaks at the first lag** whose normalised
ASDF falls below `sensitivity = 0.02` — i.e. the **shortest period that fits**, never the best-fitting
one. That is the same octave defence as MPM's earliest-peak rule (§12.1) and, in the ASDF's inverted
sense, as pYIN's and Praat's candidate biases (§16.11).

**Three independent derivations — a patent, Tartini/MPM, and an ACF tilt — of "prefer the higher
fundamental unless the lower one is clearly better."** That elevates R16 from "a sensible tie-break"
to "the standard answer", and it is the rule to reach for first when R9's candidate list exists.

### 13.3 Coarse-to-fine with sub-sample interpolation

Detection runs on an **8× decimated** signal (`decimate(wav, q=8)`); only the winning lag is then
refined at full rate, over a ±9-sample window around `8·L`, and that 19-point curve is **cubic-spline
interpolated onto 100 points** before taking the argmin (`get_real_freq`). **[P]**

Third appearance of coarse→refine (WORLD's DIO→StoneMask, §11.2; our own `pitch-scan.ts` → provider),
and the most explicit about cost: the expensive full-rate work happens **once per frame at one lag**,
not across the search. Also note the refinement resolution — 100 points across 19 samples — is far
finer than the parabolic 3-point interpolation everything else in this file uses (§1.4, §3.1, §4.2,
§12.1). If sub-frame precision ever becomes the binding constraint, cubic-over-a-window is the upgrade.

### 13.4 On failure, hold the last value — with the alternative exposed

`preserve_orig_on_fail` switches between *hold the previous frequency* and *leave the sample
untouched*. **[P]** Fourth appearance of hold-last-value (Autotalent's `_pitch` retention §1.4, AT1's
5-fragment hold §3.3, aubio's release logic §4.4). Worth noting only because it is offered as a
**parameter** rather than baked in — the honest treatment, since which is right depends on whether a
dropout is a consonant or a phrase end.

---

## 14. Deep Autotuner / data_driven_pitch_corrector (**no licence — all rights reserved**) — the learned approach, and what it refuses to do

https://github.com/sannawag/data_driven_pitch_corrector · read at `a5b6382` (2021-06-26) ·
`rnn.py`, `utils.py`, `interpolate_pyin.py`, `globals.py`

Wager, Tzanetakis, Wang & Kim, *Deep Autotuner: a Pitch Correcting Network for Singing Performances*,
ICASSP 2020 (arXiv 2002.05511). A CNN+GRU that predicts **one constant pitch shift per note** (up to
±100 cents) from the CQTs of the vocal and the backing track. Renamed from "autotuner" by the authors
to avoid the Antares trademark.

**Policy note.** We do not train models (`feedback_no_model_training`). Nothing below proposes
training; §14.3 is an *eval-harness* idea and §14.2 is DSP. The architecture is recorded for
orientation only.

### 14.1 ⭐ It does not segment. Nobody does.

`rnn.py:159` → `utils.parse_note_csv`: note boundaries are **read from pYIN's note-track CSV**. The
network never decides where notes are; it is handed the boundaries and predicts a shift per note. **[P]**

That is the **sixth** project in this survey to take note boundaries or note targets from outside
itself — outotune from MIDI (§11.1), TalentedHack from MIDI (§12.4), MXTune from a user-confirmed key
(§1.1), PyVocalSync from a MIDI note list (§15), Deep Autotuner from pYIN's note track, and Melodyne
from a human editing blobs (`research-daw-products.md` §0 item 1). **Including the state-of-the-art
learned system, nothing in the autotune world decides note boundaries automatically.**

For us the reading is bracing rather than discouraging: segmentation is not a solved problem we are
failing at, it is *the* open problem, and it is the thing our product cannot outsource — a notation
tool has to emit note boundaries or it has no output. It also means §5's finding (that our pYIN port
was never a fair test of pYIN) is worth more effort than a marginal-tuning framing would suggest,
because there is no shortcut waiting behind it.

### 14.2 ⭐ Single-frame dropout interpolation on the pitch track

`interpolate_pyin.py` rasterises pYIN's unevenly-spaced Vamp output onto a fixed hop grid (zeros where
unvoiced), then:

```python
for i in range(1, len(freq_frames) - 1):
    if freq_frames[i-1] > 0 and freq_frames[i+1] > 0:
        freq_frames[i] = (freq_frames[i-1] + freq_frames[i+1]) / 2.0
```

**[P]** A one-frame gap-filler, applied only when **both** neighbours are voiced. *(validation)* Note
the reference never checks that frame `i` is itself unvoiced, so it also smooths voiced frames; ours
should fill unvoiced gaps only — the §17a spec is the corrected form.

We solve the same problem — a consonant or breath punching a hole mid-note — at the decoder, via
`unvoicedPitchCost` (`voice-note-decoder.ts`), which is a Viterbi cost that has to be swept and traded
off against everything else. Doing the trivial case at the **track** level instead is three lines,
independent of the decoder, and removes the easiest third of the work that cost is currently doing.
Worth trying as a `PitchTrack` pre-pass with a max-gap of 1-2 frames: if it works, the sweep for
`unvoicedPitchCost` gets easier because it is no longer covering two jobs.

### 14.3 ⭐ Synthetic de-tuning: the eval tier we do not have

The training data is built by taking **in-tune** singing and de-tuning it (`rnn.py:180-196`) **[P]**:

- random per-note shifts, `pitch_shift_versions = 7` versions per performance, `max_semitone = 1`;
- applied to the pitch track as `pyin × 2^(max_semitone · frame_shifts / 12)`;
- and to the audio feature by **`np.roll`-ing the CQT along frequency within each note's frame range**,
  quantised to `bins_per_note = 16` bins per semitone (**6.25-cent** steps), with the CQT cropped by one
  note-width at both edges afterwards so the roll cannot wrap.

Strip the learning and this is a **degradation tier for `scripts/eval`**: take a corpus with clean
intonation, apply *known* per-note detunings, and check that the pipeline still recovers the notes the
singer intended. Our degradation tiers cover the room and the microphone — reverb, wind, babble
(`scenarios.ts`) — but **not the performer's intonation**, which is the one thing a notation product is
guaranteed to meet. It would give ground-truth-backed tests for exactly the things we currently cannot
measure: `estimateTuningOffsetCents`, `spellMidi`, R2's key histogram, R13's tuning-first ordering, and
the `sigmaStableSemitones` / `minChangeSemitones` family.

Two design notes carried over: shift **per note, not per take** (a take-global offset is a different
and easier problem, and we already handle it), and shift by **less than a semitone** — `max_semitone = 1`
is the outer bound, and the interesting range is the 20-60 cents where spelling decisions actually flip.

### 14.4 The framing worth stealing, even without the model

From the paper: the system is trained on "both incorrect intonation for which it learns a correction,
**and intentional pitch variation which it learns to preserve**", and it "treats pitch as a continuous
value rather than relying on a set of discretized notes found in musical scores."

That is our vibrato/portamento/scoop problem stated as a *product* requirement rather than a nuisance:
the task is not to remove deviation, it is to tell **error** from **expression**. `note-segmenter.ts`
already fights this (attack states absorb scoops; `changeCost` absorbs vibrato) but frames it as
robustness. Framing it as a distinction to be *made* is more useful, and it is the argument for keeping
`pitchMidiFloat` end-to-end (R1) rather than rounding early: a continuous pitch preserves the
expression while the integer carries the identity (§16.12).

### 14.5 Two implementation details worth remembering

- **Silence is dropped and an index map kept.** `original_boundaries = np.arange(frames)` is filtered
  by the voiced mask, so the model works on a compacted voiced-only timeline and maps note indices back
  to original frames afterwards (`rnn.py:157, 169, 178`). **[P]** A clean pattern if any future pass
  wants to reason over voiced frames only without losing absolute time.
- **`framesPerSec = 86`** — hop 256 at 22050 Hz, i.e. **the same grid basic-pitch uses**. Their CQT is
  `bins_per_note = 16` (6.25 cents) against pYIN's 3 states/semitone and our `stepsPerSemitone = 3`.
  A third value for the same quantity; see §18's note on quoted numbers.

---

## 15. Also examined, and set aside

Two further autotune projects were read and did not earn a section. Recorded so the search is
reproducible and so nobody re-reads them expecting more.

**PyVocalSync** (https://github.com/hamiltonbarber/PyVocalSync, `e372847`, **MIT**) — Flask app doing
vocal alignment plus correction. `src/pitch_correction.py` is WORLD-based (`harvest` → `cheaptrick` →
`d4c` → `synthesize`) and takes its targets from a **MIDI note list**, so it is §11.1's pattern again.
Its one worthwhile line is a comment-backed decision: corrections are applied only to
`indices[modified_f0[indices] > 0]` — *within* a note's time span, only the **voiced** frames are
touched, "if the original was unvoiced (0), it should stay unvoiced (breath/consonants)". Voicing is
treated as ground truth to preserve rather than a gate to pass. We already estimate a note's pitch from
its voiced frames (`noteCents`), so this is confirmation rather than a finding. `src/alignment.py` is
MFCC + `librosa.sequence.dtw` followed by magnitude-only spectrogram warping and Griffin-Lim —
*(validation)* the Dagstuhl corpus already ships per-take score alignments (DCS's own DTW of a CPDL
MIDI against the room mic, 70 ms onset MAE; `fetch/fetch-dagstuhl.ts` ingests them, quarantined as
`noteTruthDerived`), so there is no alignment gap for us to fill — and the Griffin-Lim resynthesis is
a quality regression we would not copy.

**opentune** (https://github.com/bemtorres/opentune, `4b352bb`, **MIT**) — JUCE plugin. Its
`detectPitchAutocorrelation()` is a plain autocorrelation with no bias correction, no octave defence and
no interpolation; smoothing is a fixed `0.3·prev + 0.7·raw` blend; `snapToScale()` is a hard nearest-in-
scale snap over hardcoded major/minor patterns. Every one of those is a weaker version of something
already covered in §1, §3 or §12. MIT-licensed and therefore reusable, which is worth nothing here
because there is nothing in it we would want.

---

## 16. Convergences across the fourteen codebases

These are worth more than any single citation, because independent authors arriving at the same
mechanism is evidence the mechanism is load-bearing.

### 16.1 Greedy peeling for polyphonic recovery
Melodyne's patent (`research-daw-products.md` §1.1) and basic-pitch's melodia trick (§2.3) are the
same algorithm shape: rank residual energy, grow the strongest, subtract/inhibit, repeat.

### 16.2 Making note changes expensive, four ways
Our `changeCost` (global, Viterbi, duration-weighted) · AT1's `_notebias` (local, causal, O(1)) ·
MXTune's "gap > `time_max_interval` or jump > 2 semitones" (hard rule) · MXTune's in-scale grid
(remove the states you don't want to visit). Every pitch tracker that produces notes has one of
these. Ours is the most principled; AT1's is the only one that works incrementally.

### 16.3 Window-autocorrelation bias correction
Autotalent's `_acwinv` (§1.4) and AT1's `_fftWcorr` (§3.1) — identical correction, independently
implemented. Standard practice for ACF confidence, superseded for us by neural confidence.

### 16.5 ⭐ Adaptive thresholds, five times, never a fixed one
aubio: novelty − movingMedian − k·movingMean (§4.1). Essentia: RMS z-score normalised **per note
candidate** (§7.1). WaoN: cutoff = frame's own mean power × 10^ratio (§9.2). Praat: unvoiced strength
scales with frame intensity (§6.3). pYIN: emissions normalised across states per frame (§5.5).
Five independent codebases, zero fixed thresholds. `onset-detector.ts` uses fixed `dipRatio` /
`riseRatio` / `minTroughSec`, and its own doc comment concludes no fixed value can serve both corpora.
The literature has already answered this; we just have not applied the answer.

### 16.6 ⭐ A confirmation delay must be subtracted back out
aubio ships a `delay` parameter (§4.2). Essentia ships `applyTimeCompensation`, default **true**
(§7.2). We measure −52 ms mean / −44 ms median onset error and have no such parameter. Two
implementations plus our own measurement make this an omission rather than an idea.

### 16.7 ⭐ Note changes cost in proportion to the interval
pYIN: Gaussian over semitone distance, σ 0.7, capped at 13 st (§5.3). Praat:
`octaveJumpCost × |log2(f1/f2)|` (§6.2). Both also cap or amortise jumps across silence (§5.2, §6.4).
We charge a constant (modulo the shelved two-tier `wideChangeCost`, §5.3). This is the single
strongest cross-reference agreement in the document.

### 16.8 Multi-candidate pitch per frame is the norm, not an optimisation
pYIN: a `(pitch, probability)` list per frame, `yinTrust` 0.1 (§5.6). Praat: 15 candidates per frame
by default (§6). Both then resolve them with a *note-* or *path-*level model. We collapse to one
value in the provider (§5.6). Two of the field's most-used trackers structure it the same way.

### 16.9 Every key detector can decline to answer
libKeyFinder scores an all-zeros profile as a competing candidate and seeds it as the incumbent
(§8.2). Essentia offers a third `majmin` class for ambiguous material (§7.3). MXTune returns `----`
when no exact mask matches (§1.1). Three for three. R2 must be able to abstain.

### 16.10 ⭐ Nobody parameterises in frames
Praat rescales every cost to a 10 ms reference (§6.1). TalentedHack divides its slew rate by
`periods_per_second` (§12.2). aubio exposes `minioi_ms` / `minioi_s` and a silence threshold in dB
(§4.4). Essentia declares every period in **seconds** (§7.2). WORLD sets `frame_period` in ms (§11.2).
Five for five in seconds-or-normalised; **our knobs are in frames** — `minFrames`,
`MIN_NOTE_LEN_FRAMES = 11`, `ENERGY_TOLERANCE = 11`, `attackFrameCost`. Every one of those silently
changes meaning if a hop changes, and `note-segmenter.ts` already contains a hand-derived 3.4× fudge
for exactly that reason. This is R11 and it is the cheapest structural improvement in the document.

### 16.11 ⭐ Octave errors are fixed at candidate-selection time, four different ways
MPM picks the **earliest** peak clearing k×tallest, preferring the shorter period (§12.1). The Auto-Tune
patent breaks at the **first** lag whose normalised ASDF clears a threshold — same rule, inverted metric
(§13.2). AT1 applies a 1/f² spectral tilt *before* the ACF (§3.1). Praat subtracts
`octaveCost × log2(ceiling/f)` from each candidate's strength (§6.5). basic-pitch (as we configure it)
clamps a min/max frequency window (`basic-pitch-provider.ts`). Five mechanisms, all acting **where the
candidate is chosen**, none of them a post-hoc octave repair — and three of them are independent
derivations of the identical rule, *prefer the higher fundamental unless the lower is clearly better*. `research-pitch-models.md` §3 catalogues published remedies; the structural
point these four share is *when* they act, and R9+R16 is the only one of them we are missing.

### 16.12 Integer note + continuous deviation is the universal representation
NeuralNote emits per-frame bends in 1/3-semitone units (§2.1). TalentedHack emits MIDI note plus
`pitchbend = diff/6` (§12.4). Essentia segments in cents relative to an estimated tuning frequency
(§7.1). We have `pitchMidiFloat` — but only on the voice path (§2.1). Convergent, and it is the
strongest argument for R1.

### 16.13 ⭐ Nothing decides note boundaries by itself — including the neural system
outotune takes targets from MIDI (§11.1). TalentedHack lets MIDI override detection (§12.4). MXTune
requires the user to approve its key (§1.1). PyVocalSync takes a MIDI note list (§15). **Deep Autotuner
reads note boundaries from pYIN's note-track CSV** (§14.1). Melodyne hands a human editable blobs
(`research-daw-products.md` §0 item 1).

Six for six, across a 2001 patent, three DSP plugins, an ICASSP-2020 network and the commercial
state of the art. The corollary matters more than the observation: **we cannot follow any of them.** A
notation product must emit note boundaries or it has no output, so segmentation is not a stage we can
delegate to a control input, a user gesture, or an upstream tool. That is the argument for spending real
effort on §5's finding rather than treating it as marginal tuning — there is no shortcut waiting behind
it, and the one asset we hold that they do not is the score itself (§11.1).

**Round-4 amendment (§20).** OpenTune is the first surveyed source that *does* decide note boundaries
automatically — by outsourcing to a **pretrained neural transcriber** (OpenVPI GAME, a discrete-diffusion
segmenter), with a 50-cent running-mean heuristic as fallback and the user's piano roll as final
authority. The finding survives in sharpened form: nothing in the autotune world decides boundaries with
DSP alone beyond trivial running-mean splits; the one project that does it well bought a model — exactly
the pattern our own pipeline follows, and consistent with the no-training / pretrained-checkpoints rule.
That makes GAME a benchmark candidate (R23), not a counterexample.

### 16.4 Nobody ships detection alone
MXTune: a full note editor with zoom, drag-to-add, right-click-delete, undo/redo.
NeuralNote: piano roll, audio-region overlay, drag-out-to-DAW, per-scale snapping.
aubio: a `delay` knob because its own ODF is late. Praat: a whole editor around `Pitch` objects with
manual candidate selection. Tony (pYIN's sibling application) exists purely to hand-correct pYIN.
And the three autotune projects go further than shipping an editor — they decline to decide the target
note at all: outotune became a MIDI-driven harmoniser (§11.1), MXTune requires the user to approve its
detected key (§1.1), TalentedHack lets MIDI override the detected note (§12.4).
This is the same conclusion as `research-daw-products.md` §0 item 1, now confirmed in source — with the
corollary that **we hold a card none of them do: the score being recorded into** (§11.1).

---

## 17. Proposed work, in house format

House rules from `research-benchmarks.md` apply: tune on `EVAL_SPLIT=dev`, confirm on `test` once,
paired-bootstrap CI must exclude 0, <1 pt is not a result, decoder changes bump `CACHE_VERSION` in
both caches, and every outcome — including nulls — goes in the Findings log in `scripts/eval/README.md`.

### 17a. Start now — self-contained, no decision needed

| Task | Where | Size | Done when |
|---|---|---|---|
| **R3** adaptive onset threshold: add `adaptiveThreshold?: {windowSec, k}` to `OnsetDetectorOptions`; novelty − movingMedian − k·movingMean | `onset-detector.ts`, swept via `sweep-reverb.ts` | S | beats the fixed-ratio baselines on *both* the sustained-singing and guitarset/vocadito slices — the thing no fixed setting managed |
| **R2** take-key fallback: duration-weighted PC histogram + 24-template correlation; used only when the score's `keyFifths` is absent/unhelpful; spelling-only | `mxml-builder.ts` next to `estimateTuningOffsetCents`; new pure fn in `voice-notation.ts` | S | accidental-spelling error drops on takes whose sung key ≠ score key; zero pitch changes in the diff |
| **R7** per-profile constant onset offset (aubio's `delay`) | `pipeline-profile.ts` + `onset-detector.ts` | XS | the −44/−52 ms median bias goes to ~0 without hurting F1 |
| **R4/§1.3** two more `pitchEstimator` variants: causal one-pole with hard reset at boundaries; linear-detrend-then-centre | `voice-note-decoder.ts` `noteCents`, existing sweep | S | either beats `trimmed-mean` on the voice slice, or both are logged as nulls |
| **R11** hop-normalise every per-frame cost: declare in `NoteSegmenterOptions` / `VoiceDecoderOptions` per **10 ms**, scale by `hopSec / 0.01` at construction. Convert `minFrames`, `attackFrameCost`, `ENERGY_TOLERANCE`, `MIN_NOTE_LEN_FRAMES` to seconds | both option constructors; delete the hand-derived 3.4× note in `note-segmenter.ts` | XS | identical results at the current hop; a hop change no longer silently re-tunes the model. Record the conversion in the Findings log so old sweep numbers stay interpretable |
| **R15** joint duration × velocity filter: drop a note only if short **AND** quiet; add the missing long **AND** quiet filter | `note-segmenter.ts` `minFrames`, `voice-note-decoder.ts` `absorbShortRuns`; amplitude already on basic-pitch events, `energy` already on the track | XS | precision rises on the reverb/adverse tier with recall unchanged — the failure shape §9.3 predicts |
| **R19** voiced-fraction quorum over a window before any pitch is reported | `pitch-track.ts` `voicedMask` (new opt) or the decoder's voicing term | XS | spurious sub-100 ms notes fall on the reverb tier; no change on clean |
| **R17** slew-rate-plus-momentum `pitchEstimator` variant (try before R4's one-pole) | `voice-note-decoder.ts` `noteCents`, existing sweep | S | beats `trimmed-mean`, or is logged as a null with R4 and §1.3 |
| **R14/R18** fold into R2 before building it: an **abstain** outcome, profile type as a parameter, and two masks — take-key for interpretation, score key for spelling | `voice-notation.ts`, `mxml-builder.ts` | — | R2's design doc reflects both before code is written |
| **R21** fill single-frame voicing dropouts on `PitchTrack` (both neighbours voiced → interpolate; max gap 1-2 frames, behind an option) | `pitch-track.ts` pre-pass; bump `CACHE_VERSION` in both caches | XS | no regression anywhere, and `unvoicedPitchCost` re-sweeps to a flatter optimum — the sign it was doing two jobs |

### 17b. Needs a measurement first

| # | Question | How to answer without shipping anything |
|---|---|---|
| **R1** | Is the contour posteriorgram worth putting on the wire? | Run the contour head offline in `scripts/eval` only. Compute `pitchMidiFloat` per NeuralNote's Gaussian argmax, then ask: (a) how much tuning offset do instrument takes actually have; (b) does R2's histogram improve with fractional pitch; (c) does R5's median-of-frames-3..9 beat the integer pitch. Only if ≥2 of 3 pay does `inference.proto` change. *(validation)* Scope note: basic-pitch serves only the `very-high` band (piccolo/whistling), the pre-detection default profile, and the above-ceiling fallback — normal-register instruments ride the CREPE trajectory path, where fractional pitch already exists in-process (`PitchTrack.cents`) and could be attached to instrument notes with **no wire change at all**. That cheaper sibling experiment should run first; R1's wire question then covers only the very-high/default takes |
| **R5** | Does skipping the attack help where we have no attack model? | Falls out of the same offline run |
| **R6** | Should `unvoicedPitchCost` split into "hold the note" and "hold the pitch identity"? | Add the second cost behind a flag; sweep on the articulated synthetic tier where dropouts are ground-truthed |
| **R9 + R16** | Does a multi-candidate pitch track fix our pYIN port? **The headline experiment of this document.** | Extract top-k (k=3-5) local maxima per frame from the CREPE activation `crepePredict` already returns; widen `PitchTrack` to carry them behind a flag; give the decoder pYIN's `minDistProb^yinTrust` emission and R16's octave tie-break. No new inference; `TrackCache` caches per clip, so bump `CACHE_VERSION`. Kill if the single-candidate baseline is not beaten on the voice slice at k=3 **and** k=5 |
| **R10** | Interval-proportional change cost + pitch memory across silence | Two independent sub-experiments, in this order: (a) interval-proportional cost — start from the shelved two-tier `wideChangeCost` (§5.3) and its recorded rationale, then try pYIN's Gaussian (σ 0.7, cap 13 st) and Praat's linear-in-log form; (b) give silence pitch memory — per-pitch silence states (pYIN, §5.2) *or* Praat's cheaper path-lookback (§6.4). Run (a) first: it is one line and it is the half both references agree on |
| **R12** | Split `STABLE_MARGIN_SEC` into asymmetric onset/offset confirmation, and compensate the delay | Sweep the two independently on the articulated synthetic tier + Dagstuhl beat grids; Essentia's 75/200 ms is the starting point. Pairs naturally with R7 |
| **R13** | Is running-mean island building competitive, and does tuning-first help? | Two separable questions. (a) Add Essentia's ±60-cent running-mean segmenter as a **baseline** in `sweep-segmenter.ts` — it is ~20 lines and the honest comparison our HMM has never had. (b) Move `estimateTuningOffsetCents` upstream of segmentation and re-run unchanged: a pure ordering change, so any delta is real |
| **R20** | **Build this before R1/R2/R13, not after.** Per-note intonation degradation tier | Extend `scenarios.ts` with an `intonation` tier: per-note offsets drawn from a distribution (the interesting band is 20-60 cents; ±100 is the outer bound), applied per note rather than per take, ground truth = the *undetuned* notes. Generation, *(validation)*: for the **synthetic** voice tier this is nearly free — `synthesizeArticulated` already applies per-note detune natively (`pitchScatterCents`, 19 ¢ Gaussian per note, plus drift/scoop), so the tier mostly sweeps an existing render parameter. But `synth.ts` cannot pitch-shift *existing* audio, so detuning the **real-recording** corpora (what Deep Autotuner actually did) needs new per-note shifting machinery — decide synthetic-only (cheap, weaker) vs real-audio (the full claimed value) before building. **Gate:** the tier must show the current pipeline losing accuracy as detuning grows (a monotone curve). If it does not, the tier is not measuring what it claims and nothing built on it is trustworthy |

### 17c. Explicitly not proposed

- Porting any segmentation from MXTune (§1.2), or its in-scale grid.
- Enabling `melodiaTrick` (§2.3) while input is monophonic.
- aubio's adaptive whitening (§4.3) — already bettered in `pitch-scan.ts`.
- WaoN's instrument-template harmonic peeling (§9.1) — polyphony only.
- Swapping in a DSP f0 estimator (WORLD/Harvest, §11.4). Licence-clean and recorded as an option, but
  estimator selection is `research-pitch-models.md`'s call, not this file's.
- Using the score's existing notes as a pitch prior (§11.1). Real asset, real risk — a score is a
  strong prior for a re-take and a bad one for new material, and distinguishing them is its own
  problem. Parked deliberately, not overlooked.
- **Deep Autotuner's actual method** (§14) — a note-wise shift regressor. It requires training weights,
  which is a standing no-go; and it needs a *backing track* as its second input, which a solo take into
  a score does not have. Only its data-generation trick (R20) and its gap-filler (R21) are proposed.
- Anything requiring trained weights. Every item above is DSP, a histogram, a Viterbi cost, a template
  correlation, or test-data generation; none of it trains anything.

---

## 18. Licence register

**None of this code can enter Solkey except NeuralNote's.** Ideas are not copyrightable; these
implementations are.

| Project | Licence | Reusable by us? |
|---|---|---|
| **NeuralNote** | **Apache-2.0** | **Yes** — with attribution + NOTICE. The `_addPitchBends` port (R1) can be adapted directly rather than reimplemented |
| **WORLD** (mmorise), reached via outotune | **modified BSD** | **Yes** — DIO / StoneMask / Harvest / CheapTrick are licence-clean. Recorded as an option (§11.4), not proposed |
| MXTune | GPL-3, JUCE GPL-3-or-commercial, Autotalent's own terms on top | No. Ideas only (§1.1 is ~30 lines of our own code anyway) |
| fat1.lv2 / zita-at1 | GPL-2-or-later | No. Ideas only |
| aubio | GPL-3 | No. Ideas only. (MXTune links it optionally, which is fine for a GPL-3 host and not for us) |
| pYIN | GPL-2-or-later | No. Ideas only — but the *parameter table* in §5.1 is published fact, and facts are free |
| Praat | GPL-3 | No. Ideas only |
| Essentia | **AGPL-3** | **No, emphatically** — AGPL reaches server-side use, which is exactly what we do. Read for ideas; never vendor, never link, not even in the eval harness |
| libKeyFinder | GPL-3 | No. Ideas only (§8.2 is four lines of our own code) |
| WaoN | GPL-2 | No. Ideas only |
| PyAutoTune / Autotalent | GPL-2-or-later | No. Nothing to take anyway (§10) |
| outotune | GPL-3 (its WORLD submodule is BSD — see above) | No for the plugin; yes for WORLD |
| TalentedHack | GPL-3 | No. Ideas only — and see §12.5 for two bugs not to inherit |
| **Auto_Tune** (Eric-D-Stevens) | **none — all rights reserved** | **No, and more strictly than GPL.** No licence grant at all, so nothing may be copied or adapted. The *patent* it reconstructs is public and expired-or-expiring; the algorithm in §13.1 is describable from the patent, and that is the route to take if it is ever wanted |
| **Deep Autotuner** (`data_driven_pitch_corrector`) | **none — all rights reserved** | **No, same as above.** Only the *published paper* (arXiv 2002.05511) and the ideas in §14 are usable. R20 and R21 are both things we write ourselves from the description |
| PyVocalSync | MIT | Yes, but nothing worth taking (§15) |
| opentune | MIT | Yes, but nothing worth taking (§15) |
| **OpenTune** (YuFeng926 — unrelated to the above) | **AGPL-3** | **No, emphatically** — same standing as Essentia: read for ideas, never vendor, link or port, not even in the harness. Its GAME *checkpoints* are OpenVPI's and their licence is **unverified** — check before any R23 adoption |
| PytoTune | MIT | Yes, but nothing worth taking (§20) |

**Three cautions.** (0) **Two projects carry no licence at all** (§13, §14). Absent a grant, default
copyright applies and they are *more* restricted than the GPL items, not less — the GPL at least grants
use under conditions. Both are read-for-ideas only, and in both cases the ideas have a public source
(a patent; a paper) that is the proper citation. (1) **Essentia is AGPL-3.** Everything else here is GPL, which we would only breach by
distributing; AGPL is triggered by *network use of a modified work*, which describes our API. It is the
one project in this file that must stay strictly read-only. (2) The GPL items contribute §1.1, §3.2,
§3.3, §4.1, §4.2, §4.4, §4.5, §5.2, §5.3, §5.6, §6.1, §6.2, §6.4, §8.2, §9.3, §12.1, §12.2 and §12.3 —
§13.1, §13.2, §14.2 and §14.3 — all short, all fully described in prose above, all things we would write
from the description regardless.

Where a number is quoted anywhere in this document — 10 dB release drop, `median = 6`, 30 ms min-IOI,
`_notebias = v/13`, ±25 bins / σ=5, σ 0.7 / cap 13 st, `octaveJumpCost` 0.35, ±60 cents, z < −2,
75/200 ms, `vthresh` 0.7, `maxdiff` 4 cents, `sensitivity` 0.02, `max_semitone` 1 — treat it as a
**starting point for a sweep**, never a value to copy on authority. Several disagree with each other
about the same decision: the minimum note change is 0.5 st (pYIN's code), 2/3 st (its paper), or 60
cents (Essentia) — §5.4; and the pitch grid is 3 states/semitone (pYIN, us), 16 bins/semitone (Deep
Autotuner's CQT), or continuous (Praat, MPM) — §14.5. That spread is the clearest possible evidence the
values are corpus-dependent and the *structure* is what transfers.

---

## 19. Reproducing this

```bash
# round 1 — plugins
git clone --depth 1 https://github.com/liuanlin-mx/MXTune.git          # ea73804
git clone --depth 1 https://github.com/DamRsn/NeuralNote.git           # f979e51
git clone --depth 1 https://github.com/x42/fat1.lv2.git                # a980204
git clone --depth 1 https://github.com/aubio/aubio.git                 # ad5cf97

# round 2 — reference implementations
git clone --depth 1 https://github.com/c4dm/pyin.git                   # 1d68cac
git clone --depth 1 https://github.com/mixxxdj/libkeyfinder.git        # 941e517
git clone --depth 1 https://github.com/kichiki/WaoN.git                # 55153b8
# the two big ones are worth a sparse checkout:
git clone --depth 1 --filter=blob:none --sparse https://github.com/praat/praat.git      # 4073a56
cd praat    && git sparse-checkout set fon melder            && cd ..
git clone --depth 1 --filter=blob:none --sparse https://github.com/MTG/essentia.git     # b9fa6cb
cd essentia && git sparse-checkout set src/algorithms/tonal  && cd ..

# round 3 — autotune
git clone --depth 1 https://github.com/ederwander/PyAutoTune.git       # 5438fe2
git clone --depth 1 https://github.com/RichardHladik/outotune.git      # 47810b4
git clone --depth 1 https://github.com/jeremysalwen/TalentedHack.git   # 1b4c2e9
git clone --depth 1 https://github.com/Eric-D-Stevens/Auto_Tune.git    # f42bd80
git clone --depth 1 https://github.com/sannawag/data_driven_pitch_corrector.git   # a5b6382

# read and set aside (§15)
git clone --depth 1 https://github.com/hamiltonbarber/PyVocalSync.git  # e372847
git clone --depth 1 https://github.com/bemtorres/opentune.git          # 4b352bb

# round 4 — addendum (§20)
git clone --depth 1 https://github.com/YuFeng926/OpenTune.git          # 72432aa
git clone --depth 1 https://github.com/brokkoli71/PytoTune.git         # 81bcdb1
```

The files that carry the whole content of this note:

| File | Lines | Why |
|---|---|---|
| `MXTune/manual_tune.cpp` | 391 (`snap_key`), 524 (`check_key`), 734 (fit), 804 (`_snap_pitch`) | contour→notes + key histogram |
| `MXTune/JUCE/Source/KeyDetectGui.cpp` | 290-310, 511 | top-7 + major-mask matching |
| `NeuralNote/Lib/Model/Notes.{h,cpp}` | whole file (~380) | basic-pitch note creation, inferred onsets, melodia trick, pitch bends |
| `NeuralNote/Lib/MidiPostProcessing/NoteOptions.cpp` | whole file | scale snapping, direction from bend sign |
| `fat1.lv2/src/retuner.cc` | 371 (`findcycle`), 453 (`finderror`), 288-307 (voicing decay) | the whole tracker |
| `aubio/src/onset/peakpicker.c` | `aubio_peakpicker_do` | adaptive threshold |
| `aubio/src/notes/notes.c` | whole file (~230) | onsets ∧ pitch, anchored release, median note-on |
| `aubio/src/spectral/awhitening.c` | `aubio_spectral_whitening_do` | temporal whitening (non-finding) |
| `pyin/MonoNoteParameters.cpp` | whole file (~40) | **the published parameter set our segmenter reimplements** |
| `pyin/MonoNoteHMM.cpp` | `build`, `calculateObsProb` | per-pitch silence topology; multi-candidate emissions |
| `praat/fon/Pitch.cpp` | 524-620 (`Pitch_pathFinder`) | hop normalisation, interval-proportional jump cost, cross-gap lookback |
| `praat/fon/praat_Sound.cpp` | 1633-1638 | the published default costs |
| `essentia/src/algorithms/tonal/pitchcontoursegmentation.cpp` | 100-178 | running-mean island building + per-segment RMS z-score |
| `essentia/src/algorithms/tonal/pitch2midi.h` | `declareParameters` | asymmetric onset/offset confirmation + time compensation |
| `essentia/src/algorithms/tonal/key.h` | `declareParameters` | 14 tone profiles, `bgate` default, the `majmin` abstain |
| `libkeyfinder/src/keyclassifier.cpp` | `classify` | 24 keys by cosine similarity, with an abstain that competes |
| `WaoN/analyse.c` | `note_intensity` | peeling with an instrument template; frame-relative cutoff |
| `WaoN/notes.c` | 232-270, 319-353 | the duration × velocity filters |
| `PyAutoTune/autotalent.c` | 1049-1099 | the original detector (confirms §1.4; nothing new) |
| `outotune/plugins/outotune/World.cpp` | `estimate`, `aggregateF0Fragments` | DIO→StoneMask two-stage; log-domain average + voiced quorum |
| `TalentedHack/pitch_detector.c` | 68-172 (`get_pitch_period`) | **MPM: earliest peak above k×tallest** — the octave tie-break |
| `TalentedHack/pitch_smoother.c` | whole file (~30) | slew-rate limiter with momentum |
| `TalentedHack/quantizer.h` | `Quantizer` struct | `iNotes` vs `oNotes` — interpretation key vs spelling key |
| `Auto_Tune/AutoTune.py` | `__init__` (running-sum ASDF), `get_real_freq` | the Auto-Tune patent's O(1) detector; first-lag-under-threshold; coarse→fine with cubic interpolation |
| `data_driven_pitch_corrector/interpolate_pyin.py` | whole file (~68) | single-frame dropout interpolation |
| `data_driven_pitch_corrector/rnn.py` | 157-196 | **the de-tuning augmentation (R20)**; silence-dropping with an index map |
| `data_driven_pitch_corrector/utils.py` | `parse_note_csv` | proof that note boundaries are an *input* (§14.1) |
| `data_driven_pitch_corrector/globals.py` | whole file (~56) | grid + CQT parameters; `max_semitone`, `bins_per_note` |
| `OpenTune/Source/Inference/GameNoteGenerator.{h,cpp}` | whole files | **the neural note transcriber wrapper (R23)** — chunking, seam dedup, defaults |
| `OpenTune/Source/Inference/RMVPEExtractor.{h,cpp}` | 116-136 (uv trap), 160-242 (octave repair, gap fill) | RMVPE integration + the R26 trap |
| `OpenTune/Source/Utils/LegacyNoteGenerator.cpp` | 118-127, 229-245 | 50-cent running-mean split — §7.1's fourth appearance |
| `OpenTune/Source/Utils/PitchCurve.cpp` | 223-294, 515-523 | angle-band-gated slope rotation (R24) |
| `OpenTune/Source/Utils/SilentGapDetector.{h,cpp}` | h:99-114, cpp:186-200 | the two-tier silence rule (R25) |
| `PytoTune/src/algorithms/yin_pitch_detector.cpp` | whole file | textbook YIN; nothing new (§20.6) |

---

## 20. Round-4 addendum (2026-08-19, post-validation): OpenTune and PytoTune

Two more repos, read after the validation pass and after the §17 plan had largely been executed
(most of §17a/§17b measured, mostly null — see the plan file and the Findings log). That context
matters: with the post-processing avenue now measured out, §20.1 is the live item here.

### 20.1 OpenTune (YuFeng926) — **AGPL-3**, and not the §15 opentune

https://github.com/YuFeng926/OpenTune · read at `72432aa` (last commit **2026-08-19** — the day of
this survey; actively developed, bilingual zh/en). Unrelated to bemtorres/opentune (§15).

A Melodyne-class desktop app + VST3/ARA2 plugin, ~80k lines of C++/JUCE: RMVPE (pretrained ONNX)
extracts F0 → notes are generated (neural or heuristic, §20.2) → the user edits in a full piano
roll → the corrected curve is re-synthesised by a **PC-NSF-HiFiGAN neural vocoder** rather than
DSP-shifted. The only project in this survey whose architecture matches ours: pretrained neural
estimators, no training, explicit note layer.

### 20.2 ⭐ The first automatic note-boundary decision in the survey (R23)

`GameNoteGenerator` wraps **OpenVPI GAME** ("Generative Adaptive MIDI Extractor") — a pretrained
4-model ONNX pipeline: `encoder → segmenter → bd2dur → estimator`, where the segmenter is a **D3PM
discrete-diffusion model run 8 refinement passes** over a boundary bitmask (`ts = d3pmT0·(1−i/steps)`,
`d3pmT0 = 0.95`; defaults `segThreshold 0.2, segRadius 2, estThreshold 0.2`,
`GameNoteGenerator.h:99-104`). The estimator emits per-segment presence plus **continuous MIDI**;
notes keep the integer as `pitch` and the float as `originalPitch` (`cpp:219-226`) — §16.12's
representation again. **[P]**

This amends §16.13 (see the amendment there): the finding survives sharpened — the one project that
decides boundaries automatically bought a pretrained model, which is our own pattern and our rule.
GAME is the successor family to ROSVOT (already a candidate in `research-voice-transcription.md`),
and the harness already has the gate for it: **`bench-external-notes.ts`**, the §10d
"should we acquire a learned model" gate. That is R23.

**Deployment lore worth keeping** (hard-won in OpenTune's wrapper, free for us) **[P]**: clips
> 45 s must be chunked (O(T²) attention), chunk at **silence midpoints**, dedupe chunk seams with a
50 ms tolerance keeping the *earlier* chunk's note ("its onset is more reliable",
`GameNoteGenerator.h:110-117`); CPU-only, because ORT's CoreML EP **silently** swallows kernel
errors on GAME's graph (`cpp:52-54`). **Blocker before adoption: the GAME checkpoints are OpenVPI's
and their licence is unverified** — OpenTune's repo ships only `rmvpe.onnx`.

### 20.3 The heuristic fallback — §7.1's fourth appearance

`LegacyNoteGenerator` (still live) splits when a frame deviates **≥ 50 cents from the running mean
of the current segment** (`|1200·log2(f0/avg)| ≥ 50`, `LegacyNoteGenerator.cpp:229-245`; defaults
`gapBridgeMs 10, minDurationMs 20`). **[P]** That is Essentia's running-mean island building (§7.1,
60 cents) independently reinvented at 50 — a fourth vote for the mechanism and a third value for the
threshold (cf. §18's note on quoted numbers). Scale snap is deliberately a separate post-generation
step (`NoteGeneratorTypes.h:10-15`), matching R18's two-mask separation.

### 20.4 Pitch layer: RMVPE, an octave repair, a gap fill — and a trap (R26)

RMVPE at 10 ms hop, 50–1100 Hz, preceded by a 50 Hz Butterworth high-pass and a −50 dBFS gate
(`RMVPEExtractor.cpp:302-322`). Post-hoc: a one-directional octave-drop repair
(`ratio ∈ (0.45, 0.55) → ×2`, `cpp:160-177`) and **log-domain gap fill up to 8 frames / 80 ms**
(`cpp:179-242`) — a data point that R21's max-gap (swept at 1–2 frames, measured null) had a far
larger published sibling. **The R26 trap [P]:** the shipped checkpoint's "uv" output is the
*unvoiced* probability; the code carries a long warning that enabling the mask as documented zeroes
every voiced frame (`RMVPEExtractor.h:116-136`). Recorded so an RMVPE evaluation doesn't rediscover
it.

### 20.5 Correction machinery worth noting (R24, R25)

- ⭐ **Angle-band-gated slope rotation** (`PitchCurve.cpp:223-294, 515-523`): per note, estimate the
  slope from medians of the first/last `max(3, n/5)` voiced frames, convert to an angle normalised
  at 7 st/s, and **only if 10° ≤ |angle| ≤ 30°** rotate the contour flat around the note's centre.
  **[P]** A *conditional* version of §1.3's linear detrend: scoops get straightened, flat notes and
  deliberate glides are untouched. The unconditional estimator variants all measured null (plan
  task 7); the gate is the one untested twist (R24).
- **Two-tier silence rule** (`SilentGapDetector.h:99-114`): silent if total (60 Hz-HP'd) RMS
  ≤ −40 dBFS, **or** total ≤ −30 dBFS *while* the 60 Hz–3 kHz band is < −40 dBFS; min gap 100 ms.
  **[P]** Rumble-dominated frames classify as silence above the strict gate (R25).
- **Drift/vibrato separation** by a per-note zero-phase ~500 ms moving average (≈2 Hz cutoff),
  scaling only the drift component and preserving modulation (`PitchCurve.cpp:71-114, 532-557`).
  Correction-side, but a clean formulation of the error-vs-expression distinction §14.4 frames.

### 20.6 Non-findings in both repos

From OpenTune: Krumhansl–Schmuckler key detection with best-minus-second-best confidence (§16.9
covers abstention; we take key from the score), scale-snap grids, the "PIP" energy-weighted note
pitch estimator (comparable to, not better than, our trimmed mean / Hann median), the −50 dBFS
pre-inference gate (gates measured as dead ends here), and everything synthesis-side (vocoder,
retune-speed mixing, synthetic vibrato, the patent-style real-time shifter).

**PytoTune** (https://github.com/brokkoli71/PytoTune, `81bcdb1`, **MIT**) — a 2,700-line C++20
university *algorithm engineering* project (SIMD/OpenMP is the point; "audio quality was not the
sole optimization target" per its own README): textbook YIN (CMND threshold 0.05, parabolic
interpolation, median-5 smoothing, one-directional octave repair) with **zero note-boundary logic**
— targets come from a MIDI track (highest active note wins, `midi_file.cpp:290-317`) or a per-frame
nearest-in-scale snap. A clean seventh confirmation of §16.13's original form; every mechanism is
already in the catalogue. Its two novelties (anti-aliased 4× decimation before YIN; a generalised
non-octave `Scale{baseNote, repeatFactor, ratios}` type) are irrelevant to neural estimators and to
score-based spelling. Nothing to take.
