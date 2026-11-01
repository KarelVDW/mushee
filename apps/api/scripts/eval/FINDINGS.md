# Findings log — recording-pipeline accuracy

The durable record of every measured experiment on the transcription pipeline: what shipped (with confidence intervals), what measured null (with the mechanism, so nobody redoes it), and the open items. Newest sections at the bottom. How to run the tools that produced these numbers: [README.md](README.md); the product benchmark and its history: [benchmarks/README.md](benchmarks/README.md).

## Every number was measured on this machine, on the corpus described in the README, almost always as a paired-bootstrap comparison over clips with a 95 % CI — `*` marks an interval excluding zero.

## Findings log (2026-07 accuracy push)

Distilled from the accuracy investigation of 2026-07-24/25 (the working `PLAN.md` it condenses has
been deleted; this section is the durable record). Every number below was **measured on this
machine**, on the corpus above, almost always as a paired-bootstrap comparison over clips with a
95 % CI — `*` marks an interval excluding zero.

### State of accuracy

| what                                                                                         | value                                                                                                                                               |
| -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Real-corpus headline, clean condition (COnP@0.1, 18 datasets / 658 clips, mir-qbsh excluded) | **0.763**                                                                                                                                           |
| vocadito vs its measured human inter-annotator ceiling                                       | 0.671 / **0.760** (≈ 88 %)                                                                                                                          |
| Real monophonic instruments (URMP, 13 instruments)                                           | 0.66–0.96, note counts ≈ correct                                                                                                                    |
| Sustained vibrato-heavy singing (annotated-vocalset) — was the weak spot                     | ~0.45, ~1.7× over-segmented → **0.59** at 1.3× after the voice decode (2026-08)                                                                     |
| Voice slice (annotated-vocalset + N20EMv2 + vocadito), held-out test                         | 0.570 → **0.668** after the voice decode                                                                                                            |
| Adverse: echoey-room / distant-mic (after the adaptive gate)                                 | ~0.55 / ~0.44 (oracle ceiling: +0.14 / +0.23 above that)                                                                                            |
| External yardstick (N20EMv2 test split): us zero-shot vs their in-domain supervised model    | 0.489 @±100 ms vs **79.56 @±50 ms** — ≥31 pts. The strategic read: remaining singing headroom is a **learned note model**, not more post-processing |
| Statistical floor: per-clip σ ≈ 0.20–0.28; paired ρ ≈ 0.98–0.99 → MDE ≈ 0.01 at n≈300        | nothing under ~1 pt is a result                                                                                                                     |

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

The V0/V1 work from `research/research-voice-transcription.md` §10b–§10c. One headline result,
and — as usual — most of the individually-plausible ideas measuring as nulls.

### Shipped: a voice-only note decode (`src/recordings/pipeline/voice-note-decoder.ts`)

Reached only through a profile whose source is known to be a voice
(`ProfileResolver.applyVoice`, driven by the score's instrument family or the
client's explicit `sourceKind`). Instruments are untouched — and must stay so:
this decode costs the instrument corpora ~0.03.

Two measurements, because they answer different questions.

**Cached sweep** (`sweep-voice.ts`, segmentation only, paired bootstrap over clips):

| slice                                | before      | after       | paired Δ                       |
| ------------------------------------ | ----------- | ----------- | ------------------------------ |
| VOICE, dev (253 clips)               | 0.567       | 0.683       | **+0.145 [+0.123, +0.168]** \* |
| VOICE, **held-out test** (289 clips) | 0.570       | 0.668       | **+0.123 [+0.102, +0.144]** \* |
| annotated-vocalset (test)            | 0.46 @1.71× | 0.59 @1.29× | over-segmentation largely gone |
| N20EMv2 (test)                       | 0.54        | 0.69        |                                |
| vocadito (test)                      | 0.70        | 0.73        | at its 0.760 human ceiling     |

**Full production path** (`run-eval.ts EVAL_REAL=1 EVAL_ADAPTIVE=1`, every clip of
both split halves, A/B'd with `RECORDING_VOICE_DECODE=0/1`) — profile resolution,
routing, streaming decode, cleanup and the MusicXML round-trip included. This is
the number that corresponds to what a user hears:

| dataset                                    | baseline | voice decode | Δ                     |
| ------------------------------------------ | -------- | ------------ | --------------------- |
| annotated-vocalset (400)                   | 0.396    | **0.557**    | **+0.160**            |
| N20EMv2 (102)                              | 0.537    | **0.639**    | **+0.102**            |
| N20EMv2-test — the external yardstick (18) | 0.471    | **0.567**    | **+0.096**            |
| vocadito (40)                              | 0.668    | 0.700        | +0.032                |
| mir-qbsh (50, not pooled)                  | 0.642    | 0.554        | −0.089 — see below    |
| **all 14 instrument datasets**             | —        | —            | **+0.000, every one** |
| **repo headline (18 pooled datasets)**     | 0.760    | **0.782**    | **+0.022**            |

Two things in that table are worth more than the headline. First, the instrument
corpora are **bit-identical**, which is the strongest available evidence that a
change this large is genuinely confined to the input class it was built for.
Second, pooled over the _whole_ corpus the segmentation profile changes shape
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
   note HMM enters its `attack` state where the contour _departs_ the previous note;
   an annotator marks where the pitch _arrives_. Measured lead: −52 ms mean / −44 ms
   median. Two controls establish this is a latency of the decode and not a habit of
   the annotations: applying the same shift to the _shipping_ segmenter buys almost
   nothing (+0.028 at 40 ms, +0.008 at 60 ms — it is already calibrated at −2 ms
   bias), and all three voice corpora peak at the same 70–100 ms, including N20EMv2,
   whose onsets are expert-corrected. Structural rules that try to find arrival
   per-note measure _worse_ than the constant (`'arrival'` +0.07, `'stable'` +0.05):
   the lead is consistent, per-note estimates of it are noisy, and the noise costs
   more than the bias it removes.
2. **The decode chooses mandatory-silence by itself.** Sweeping the note-change cost,
   everything at ≥ 2.5 nats scores _identically to three decimals_ — the direct
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
   decode CREPE's _already Viterbi-smoothed_ trajectory, so trusting per-frame pitch
   that little merges real notes (t0.1 → 0.627 vs t0.7 → 0.684 on dev).
6. **Downstream cleanup shrinks to `onsetSplit` alone.** The A-B-A vibrato folder
   (−0.003) and the adaptive length floor (−0.008 as part of the full set) exist to
   undo fragmentation the decode no longer produces. `onsetSplit` stays because it is
   the pipeline's only **re-onset** channel: it lifts re-onset recall 0.124 → 0.329
   (dev) / 0.168 → 0.389 (test) at no cost to COnP.

### Held-out validation on three newly adopted corpora (2026-08-08)

The acquisition-policy pass (`research/research-voice-datasets.md` §policy) adopted three
real-singing corpora with real note truth — ESMUC (271 per-singer choral stems,
manually corrected), CSD (96 stem excerpts, hand-corrected per-section notes)
and HUST_Solfege (73 solo solfège recordings) — **after** the voice decode was
tuned and shipped. None of their 24,206 notes influenced any constant in the
decoder, which makes this the cleanest generalization test the harness has ever
run. Full production path (`run-eval.ts EVAL_REAL=1 EVAL_ADAPTIVE=1`, A/B'd
with `RECORDING_VOICE_DECODE=0/1`):

| dataset                                         | baseline | voice decode | Δ          |
| ----------------------------------------------- | -------- | ------------ | ---------- |
| csd (96, bleed, per-section truth)              | 0.520    | 0.622        | **+0.102** |
| esmuc-choir (271, bleed)                        | 0.463    | 0.603        | **+0.141** |
| hust-solfege (73, solo, amateur incl. juvenile) | 0.600    | 0.743        | **+0.143** |
| pooled (440 clips)                              | 0.528    | 0.656        | **+0.129** |

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
against the audio (one scalar per file — see `fetch/fetch-hust-solfege.ts`).

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
   ambiguous (a take 41 c flat of B _is_ 59 c sharp of B♭ — same lattice);
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
toward the singer's grid is _by construction_ a mismatch (the old "tuning
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

| dataset            | ours (split+floor) | Yong-2023 | Δ                                                        |
| ------------------ | ------------------ | --------- | -------------------------------------------------------- |
| annotated-vocalset | 0.60               | 0.444     | **−0.16**                                                |
| vocadito           | 0.73               | 0.730     | ±0.00                                                    |
| n20emv2            | 0.69               | 0.743     | +0.05                                                    |
| hust-solfege       | 0.76               | 0.843     | +0.08                                                    |
| esmuc-choir        | 0.65               | 0.727     | +0.08                                                    |
| csd                | 0.68               | 0.739     | +0.06 ⚠️ CSD was in its training data — read as inflated |
| **mean**           | **0.686**          | **0.704** | **+0.018**                                               |

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
**logits** whose absent classes sit near sigmoid ≈ 0.5, so group _sums_ measure
group size — compare each group's strongest member instead; and near-silent
prefixes are exactly what the abstain band is for. Production wiring:
`profiles/source-classifier.ts`, explicit `sourceKind` still wins, kill-switch
`RECORDING_SOURCE_CLASSIFY=0`. The web mic-source chip is removed; eval paths
pass explicit `sourceKind` per dataset so cached profiles stay corpus-pure.

### Re-onsets: the shipped operating point is optimal, and here is the proof

Re-onset recall is the one axis the voice decode made _worse_ (pooled 0.501 →
0.471) and the most user-visible one — someone singing "la-la-la" on one pitch
gets one note. The decode cannot see these by construction, so the only lever
without new DSP is `OnsetDetector`, whose thresholds were tuned for a segmenter
that fragmented heavily and therefore wanted a timid splitter.

Swept over the detector's **own 10 ms envelope** (see the resolution note below —
the first attempt at this used the trajectory's 20 ms grid and measured the frame
rate instead of the rule). Voice slice, dev, on top of the shipping decode:

| onsets                          | re-onset recall | COnP      | split/100 | missed/100 | repair    |
| ------------------------------- | --------------- | --------- | --------- | ---------- | --------- |
| **shipped** (dip 0.5, rise 1.8) | 0.329           | **0.683** | **9**     | 4          | **715 s** |
| dip 0.65, rise 1.5              | 0.400           | 0.665     | 18        | 4          | 742 s     |
| dip 0.8, rise 1.2               | 0.494           | 0.610     | 55        | 4          | 851 s     |

`missed` **does not move — 4 per 100 at every setting.** That is the whole result.
The extra sensitivity is not recovering notes the pipeline lost; it is cutting up
notes it had already found, so the re-onset recall gain is bought entirely with
spurious splits and repair time rises monotonically away from the shipped point.
On the metric denominated in what the product costs its user, the current
thresholds are a local optimum in every direction available.

The corollary is the useful one: this weakness is **not reachable by thresholding
amplitude at all**. Separating a re-articulation from a note-internal amplitude
wobble needs a channel that can see the _spectrum_ change — which is exactly what
the literature reports (Yong et al. reach 0.90 re-onset recall with a phonetic
posteriorgram; our broadband accent experiment failed for the same reason). §3.2's
selective in-note SuperFlux splitter is the remaining model-free candidate.

Sanity check that the harness is faithful: re-detecting at the shipping constants
(`dip0.5 rise1.8`) reproduces the cached shipping onsets exactly — same COnP to
three decimals, same re-onset recall.

#### Why this had to be swept on the 10 ms grid

At _identical_ thresholds, re-detecting from the cached 20 ms trajectory-grid
energy scores re-onset recall **0.218** where the same rule on the detector's own
**10 ms** envelope scores **0.329**. A re-articulation dip lasts ~30–50 ms, so
halving the frame rate leaves one or two samples of it and loses a third of them.
`TrackCache` v5 therefore stores the fine envelope and derives the shipping onsets
from that same array; `OnsetDetector` gained a `hopSec` option, without which every
duration threshold silently doubled when a harness drove `detectFromEnvelope`.

### Under heavy reverb the voice decode is neutral, and the mechanism is legible

A/B'd on the adverse tier (`echoey-room` RT60 0.9 s and `distant-mic` RT60 1.3 s),
voice datasets only. N20EMv2 has no degraded variants — `fetch/degrade-real.ts` has never
been run on it — so this rests on annotated-vocalset (800 clip/conditions) and
vocadito (80):

| dataset                  | baseline   | voice decode   | Δ      |
| ------------------------ | ---------- | -------------- | ------ |
| annotated-vocalset (800) | 0.210      | 0.218          | +0.008 |
| vocadito (80)            | 0.446      | 0.390          | −0.056 |
| dataset-mean             | 0.219      | 0.203          | −0.016 |
| repair time              | 5140 s/100 | **4939 s/100** | −4 %   |

Read this as **neutral**: the dataset-mean weights 80 clips equally with 800, and
per clip the two are within noise of each other. Both are also simply _bad_ here
(0.21–0.25), which is the pre-existing reverb problem the findings log already
documents with a +0.14/+0.23 oracle ceiling still on the table.

The interesting part is why the gain disappears. Transition recall falls much
further in the voice arm under reverb (0.475 → 0.298) than it does dry
(0.781 → 0.709), and that is exactly the predicted failure of an evidence-gated
decode: **reverberation fills the dips the evidence channels read**, so the
discount stops firing and every boundary reverts to full price. Note this is a
_different_ mechanism from the 2026-07 dead end "reverb fills the dips → tighten
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

| scenario                                    | semitone segmenter | voice decode |
| ------------------------------------------- | ------------------ | ------------ |
| voice-alto (the old continuous-vowel proxy) | 1.00               | 1.00         |
| voice-plosive ("ta-ta-ta")                  | 1.00               | 1.00         |
| voice-continuant ("la-la-la")               | 0.88               | 0.87         |
| voice-hum (closed mouth)                    | 0.93               | **0.81**     |
| voice-legato (sustained vowel)              | 0.93               | **0.68**     |
| pooled                                      | **0.946**          | 0.871        |

This does **not** overturn the real-corpus result, and the reason is the point of
having both tiers. Synthetic singing here has ±8 cents of vibrato, exact intonation
and no breath — so the failure the voice decode exists to fix (wide vibrato
shattering held notes) does not occur, and all that is left to measure is its
merging. The real corpora, which are authoritative under research-benchmarks' tier
discipline, say +0.16 / +0.10 / +0.10 / +0.03 on the same change.

What the tier _does_ establish, and nothing else could:

1. **Where the decode is weak is legato with no boundary evidence at all.**
   `voice-legato` is adversarial by construction — `dipFloor: 1`, no closure, no
   pitch dip, only a 70 ms portamento — and that is precisely where the note model
   merges (0.93 → 0.68) while a local semitone rule does not. Real singing always
   leaks _some_ cue, which is why the real corpora do not show this. Treat it as the
   boundary of the decode's competence, not as a contradiction.
2. **Li et al.'s articulation spread reproduces.** Plosive 1.00 → continuant 0.87 →
   hum 0.81 → legato 0.68 is the same ordering (and nearly the same 19-point spread)
   the NLP4MusA 2021 paper measured on a different system. The evidence-backed user
   tip — _"if notes run together, try ta-ta-ta"_ — now has in-house support.
3. **Re-onset recall is 0.000 on every legato scenario, in BOTH arms.** Neither
   decode finds a single same-pitch re-articulation when voicing never stops. That
   is the sharpest available statement of the weakest part of the voice flow, and it
   is a measurement the harness simply could not make before this tier existed.

⚠️ **A pre-existing corpus defect this exposed.** The synthetic melodies' _truth_ has
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

mir-qbsh scores **0.64 → 0.55** under the voice decode — a 9-point _drop_, and not
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

- It was scored on one global config across instruments _and_ voice. On the voice
  slice alone the same family was already competitive on the product-relevant metric
  in July: repair time 271 s/100 notes vs the shipping segmenter's 1107, with
  missed = 1 vs 6.
- Its onsets were 50 ms early and nothing reported onset bias, so a calibration
  defect read as a modelling failure.

**What this means for the general rule:** "the HMM family is a dead end" is now false
as stated. The accurate version is _"a single global segmentation config cannot serve
both instruments and voice"_ — which is what the July diagnosis actually said, and
which is why the fix was a profile flag rather than a better global config.

### Measured nulls this pass — do not redo

- **Octave prior at voicing onsets (E2).** No effect at any weight (0.677–0.684 vs
  0.679). The reason is worth keeping: with the new decode, measured octave-error
  rate is **0.001** and chromaF1 equals COnP to three decimals. There is nothing left
  to fix; the mechanism was sound, the failure it targeted no longer exists.
- **SiPTH sustained-deviation merge guard (E3).** Literally zero change on the voice
  decode at every (δ, Γ) — because a mandatory-silence decode never emits two
  _contiguous_ ±1-semitone notes, so the guard has nothing to act on. On the shipping
  segmenter it is worth +0.007. Implemented and kept (`VoiceDecodeOptions.mergeGuard`,
  `guardOnly`) since it is the right tool if a future decode reopens that failure.
- **An in-decode re-onset transition (`reonsetCost` + `accentBonus`).** The
  principled version of the same-pitch-repeat problem — Ryynänen's accent feature
  inside the attack state — and a null **with the broadband RMS envelope we have**.
  Three findings, in the order they came:
  (a) as a pure transition it never fires — re-articulating the same pitch changes
  no emission, so it is pure added cost and a Viterbi will not take it however
  cheaply it is priced;
  (b) credited as an attack-state _emission_ it fires, but the credit lands on every
  attack frame of every note, so re-onset recall rose 0.12 → 0.31 while transition
  recall fell 0.62 → 0.50 and COnP with it;
  (c) credited against the _transition_ only — the correct construction — it is a
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
  protects held notes forbids the leap. Splitting it in two works _mechanically_ —
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
   segmented, wrong semitone — and it is _not_ octave error (octErr 0.001). This is
   now the largest single bucket, and it survived a direct attack: both published
   note-pitch estimators were implemented and measured (Molina's α-trimmed mean and
   Yong et al.'s Hann-weighted median) and they are equivalent overall (0.683 vs
   0.686, inside the MDE) while disagreeing about _which corpus to help_ — Hann is
   +0.03 on N20EMv2's long notes and −0.02 on vocadito's short ones. Restricting the
   estimate to the post-glide part of the note (`pitchWindow: 'onset'`) has the same
   shape and is a net loss. Two independent estimators that cannot reduce it, and
   that trade one corpus against the other, is the signature of a modelling limit
   rather than a tuning one — the learned-note-model gap the N20EMv2 yardstick
   already identified.
   One caveat worth carrying: annotated-vocalset reads a **systematic semitone
   sharp** (+1: 18 % of notes, −1: 8 %) and does so _identically with the voice
   decode off_, so it is a property of that corpus's score-derived pitch labels, not
   of the pipeline. Do not tune against it.
2. **Re-onsets: 0.389 vs the shipping segmenter's 0.461.** The one place the new
   decode is behind. See the null above for what has been tried.
3. **Transitions: 0.650 vs 0.798.** The price of a decode that prefers silence
   between notes; the evidence discount recovers part of it, not all.

### Shipped (all with CIs on dev AND held-out test unless noted)

- Drop `pitchOutliers` + `merge` cleanup on the trajectory path: **+0.024 test** \*.
- `adaptiveFloorFraction: 0.3` on the trajectory path: **+0.018 dev / +0.014 test** \* (708-clip corpus).
- Reverberance-adaptive voicing gate: **+0.024 echoey / +0.043 distant on test** *, clean-neutral.
  Diagnosis: reverb halves CREPE's *confidence\*, barely touches pitch — the gate was the breakage.
- Metrical duration spelling in `MxmlBuilder`: boundary violations **33 % → 0 %** over 6,840 rhythms.
- Fixed: touching notes read as overlapping (float epsilon) — silently dropped notes from contiguous runs.
- Fixed: held notes emitted only in their first bar; fully-silent bars never emitted at all.
- Fixed (web): capture started only **after** the WebSocket handshake at beat 1 — 100–400 ms of every
  take never captured and every note notated early (a simulated 100 ms lag costs **−0.47**
  phase-locked notation F1). Plus, from the post-hoc review of that fix: the final ≤100 ms of every
  take was dropped on stop(), and the MIME-type hint was lost in the normal ordering — both fixed with
  regression tests.
- Benchmark fixes: `fetch/degrade-real.ts` truncated 10–13 s clips (reverb numbers were ~0.023 flattering);
  vocadito best-of-annotators (**+0.011**, not the ~6 pts predicted from the published baseline —
  gaps measured on someone else's system do not transfer); mir-qbsh exclusion (validity — Δ headline
  only +0.006).

### Dead ends — measured, do not redo

- **Raising the note-length floor** (literature says 100–127 ms): 60/80/100 ms identical — the
  4-frame smoother already removes anything shorter; 120/140 ms cost −0.013/−0.039.
- **Widening the vibrato A-B-A folder** (0.25/0.35 s): monotonically worse. But do **not** remove it:
  disabling costs −0.020 dev / −0.024 test \*.
- **Semitone-track smoother width**: 4 frames optimal; 2, 6, 8 all worse.
- **pYIN's amplitude-ratio onset splitter** (took Tony's COnPOff 0.38→0.50): at best **+0.001**
  [−0.002,+0.004] here, worse at any higher sensitivity — the shipping dip-then-rise detector already
  captures it. The literature gain does not transfer to a pipeline that already splits.
- **Dereverberation by spectral subtraction** (`lib/dereverb.ts`): every setting significantly
  negative despite a +0.14/+0.23 oracle ceiling — reverb costs _confidence_, and subtraction erodes
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
  config\*; restricted to a voice profile, and with its 50 ms onset lead corrected, the same model
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
`research/research-voice-datasets.md` §5). Two harness capabilities had to exist first:

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

| dataset              | COnP | COn  | COnRec   | split  | missed | spurious |
| -------------------- | ---- | ---- | -------- | ------ | ------ | -------- |
| avp (280 clips)      | 0.00 | 0.19 | 0.16     | 2      | **71** | 3        |
| dagstuhl-choir (102) | 0.01 | 0.13 | 0.18     | **28** | 20     | **36**   |
| jacrc-students (175) | 0.01 | 0.28 | **0.52** | 60     | **3**  | 42       |

🔴 **AVP is mis-scoped for `run-eval`, and only measuring it showed that.** It misses **71 of
every 100** onsets — not because the onset detector is weak, but because `run-eval` exercises the
_whole pitch-based pipeline_, and AVP is unpitched percussion: CREPE finds no notes, so no onsets
are ever emitted to score. The register's pitch — "a clean way to test `OnsetDetector` in
isolation" — is right about the corpus and wrong about the path. **To get value from AVP, drive
the onset detector directly (the `sweep-segmenter.ts` route), not `run-eval`.** Its `run-eval`
row should be read as a property of the harness wiring, not of the detector.

✅ **JaCRC behaves exactly as designed** and is the most informative of the three: **0.52
syllable-onset recall** with only **3 per 100 syllables missed entirely**. The high split (60) and
spurious (42) are the melisma effect predicted up front — in-melisma note onsets are correct
detections the syllable truth does not list — which is why its manifest says read recall, not F1.

⛔ **Void (2026-10-31): the dagstuhl-choir numbers in this section were measured on corrupt audio; see the correction note at the end of this log.**

⚠️ **Dagstuhl quantifies a warning that was previously only editorial.** vocadito's authors say
DCS stems are "not well suited for monophonic voice evaluation" because of bleed. Measured: COnP
0.01 with **28 splits and 36 spurious per 100 notes** — the pipeline over-segments badly on
bleed-laden legato choral audio, and the profile resolver flags every clip `NOISY` at ~0 dB SNR.
`notation-eval` accordingly gives beat-F1 **0.03** vs GuitarSet's 0.637. That number is _not_
evidence about the notation stage: transcription has already failed upstream, and the reference's
own pitch is 32 % more than 50 cents off. **Dagstuhl's worth is the beat-grid capability and the
rubato probe, not an accuracy score** — treat any headline use of it as a mistake.

(One real defect was found and fixed while checking that 0.03: the fetcher rebased excerpt _times_
to t=0 but left beat _numbers_ absolute, so a late excerpt carried beats 380–420 against an
estimate counting from 0. Phase search was hiding most of it while making `beatF1lock` measure
nothing else. Beats are now shifted by whole bars, preserving metrical phase. The corrected score
is unchanged at ~0.03, confirming the cause is the audio, not the alignment.)

### Open items

Decisions for the team:

- ~~**Model-weight provenance**: CREPE-tiny (shipping) was trained partly on NC-licensed data
  (MDB-stem-synth CC-BY-NC; RWC research licence) — same class of exposure as the rejected RMVPE.
  If ever forced, the remedy is a retrain, not a swap. Decide deliberately.~~ **Resolved
  2026-09-01 by the standing licence rule** (CORPORA.md / research-voice-datasets §0: the
  artefact's own published licence governs, at face value, and we do not hunt upstream): the
  `marl/crepe` checkpoint is published under MIT, so it is used as-is. Training-data provenance
  of a permissively licensed checkpoint is exactly the upstream archaeology the rule forbids — the
  same reading that admits CC-BY corpora without consent-form forensics. RMVPE's bar was different
  in kind (its _own_ weights carry an NC licence). No retrain is contemplated (no-training policy).
- ~~**Whistling has zero real test data**~~ — **superseded 2026-08-20.** The premise still
  holds (no note-annotated whistling corpus exists anywhere, and `research/research-whistle-corpus.md`
  now proves acquisition is exhausted), but the harness is no longer at zero: `whistle-real`
  (5 clips / 34 s at the time of writing — **117 clips / 18.3 min since the Freesound sweep the same day**, PD + CC0 + CC BY-SA) and `whistle-vintage` (6 × 30 s, public-domain art whistling)
  are fetched with draft labels, and `tinysol-*` puts 512 notes of real timbre into the
  `high`/`very-high` bands. The remaining decision is not acquisition, it is **whether to spend
  ~40 minutes recording and verifying a dogfood set** (protocol: research/research-whistle-corpus.md §6)
  and whether to get a free Freesound token for its CC0 slice.
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
4. **Whistle-specific FFT peak tracker** (whistling is near-sinusoidal). ~~Blocked on real
   whistle audio~~ — **unblocked 2026-08-20**: `whistle-real` / `whistle-vintage` exist, and
   `lib/sineTrack.ts` is already a working baseline of exactly this shape. ⚠️ Ordering
   constraint: the whistle datasets' labels were DRAFTED by that same tracker, so **verify them
   by hand before evaluating a tracker of the same family against them** or the result is
   circular by construction (research/research-whistle-corpus.md §1).
5. MV2H metre+value integration for publication-comparable notation numbers; MRSSing corpus
   (CC-BY 4.0, verify annotation granularity + a paper/card licence mismatch first).
   **Status 2026-08-13:** `verstar/MRSAudio` is now live on HuggingFace (CC-BY-4.0, ungated,
   94k files) but the uploaded parts are MRSMusic (16 _instruments_) and MRSLife — **MRSSing,
   the solo singing, is still not there.** Still a watch item.
6. **Wire AVP to the onset detector directly.** The corpus is fetched and its truth is sound
   (9.8k human-placed onsets on real amateur audio), but `run-eval`'s pitch-based path cannot
   score unpitched percussion — see the 2026-08-13 entry. A `sweep-segmenter`-style runner
   would turn an already-paid-for corpus into the isolated onset benchmark we lack.

### Real-corpus gap register (2026-08-20)

> The LIVING version of this register now lives in `CORPORA.md` (together with the
> benchmark/context tier tables) and is the one to update; this entry stays as the
> dated record of the 2026-08-20 state.

Consolidated from the 2026-08-20 provider/per-band pass, which ran into most of these as
confounds or unpowered strata. Items already tracked above are cross-referenced, not
repeated. (Corpus _acquisition_ is exhausted per research/research-voice-datasets.md §5 — most rows
below therefore mean "record and annotate our own" or "build a harness capability", not
"find another dataset".)

**Registers / sources with zero real data:**

- ~~Whistling~~ — **partly closed 2026-08-20.** Acquisition is exhausted and the evidence is in
  `research/research-whistle-corpus.md`: no whistling corpus exists, and the licensable audio that does
  is now fetched (`whistle-real`, 117 clips / 18.3 min after the Freesound sweep — the first draft of this entry said 5 clips / 34 s; `whistle-vintage`, 6 clips / 180 s). Both
  carry draft labels flagged `noteTruthDerived` until a human verifies them. What remains is
  _volume_, and it is ours to record — capture protocol in that file's §6.
- ~~piccolo and everything above ~700 Hz~~ — **partly closed 2026-08-20** by `fetch/fetch-tinysol.ts`
  (64 clips / 512 notes of real Ircam timbre, `high` 0.924 vs `very-high` 0.654). Still
  `constructedPerformance`: real tone, spliced phrasing. A real _performance_ above 700 Hz
  remains unrepresented, and piccolo specifically has no permissive corpus at all.
- Harmonica — in the synthetic matrix, no real counterpart (URMP's 13 instruments lack it, and
  the 2026-08-20 sweep found none anywhere — research/research-voice-datasets.md §6k).

**Strata too thin to power conclusions:**

- Low/high-band INSTRUMENTS: n = 6 / 5 real clips in the per-band sweep (URMP is 2–4 clips
  × 15 s per instrument). Any register-specific instrument question is unanswerable on
  real data today.
- Solo high-register voice: the high/voice stratum is almost entirely choral bleed stems
  (ESMUC/CSD sopranos) — anything tuned "for the high band" is actually tuned on bleed,
  the exact confound that manufactured the per-band false positives.
- Low/voice balance: annotated-vocalset's operatic males are ~⅔ of the stratum, so
  "low band" reads as "AV operatic vibrato". Amateur low-register solo singing would fix it.

**Conditions:**

- Genuinely RECORDED adverse takes: the adverse tier is synthetic degradation of real
  performances — honest, but no take was performed in a real echoey room / outdoors. (Partial
  2026-08-20: `whistle-vintage` is real whistling over real piano/orchestra with real 78-rpm
  surface noise — nobody synthesised it — and measured RIR/noise corpora to replace the
  modelled room and babble are researched with DOIs in research/research-voice-datasets.md §6b–6d.)
- ~~the product capture path: no annotated corpus of phone-mic webm/opus recordings~~ —
  **closed 2026-08-20** by `Condition.codec`: a codec round trip cannot move a note, so the
  existing truth applies. Four conditions (`phone-opus-96k/32k/16k`, `phone-aac-64k`),
  alignment verified at 0.00 ms lag, effect measured null (±0.03). What remains uncovered is
  the browser's _audio processing_, which the app disables by constraint.
- N20EMv2 has no degraded variants (`fetch/degrade-real.ts` never run on it) — the adverse voice
  evidence rests on annotated-vocalset + vocadito alone.
- Real out-of-tune singing with intended-note truth: the R20 intonation tier is synthetic
  by design; the one real specimen is the Frère Jacques dogfood take.

**Truth-quality limits on corpora we have** (each documented at its fetcher/log entry —
listed here so nobody tunes against them): annotated-vocalset's systematic semitone-sharp
labels; CSD's per-section truth; HUST's derived durations + per-file pitch offset;
Dagstuhl/mir-qbsh derived note events (excluded from headlines).

**Fetched but not wired:** AVP (→ direction 6); MRSSing (→ direction 5's watch item).

**A label, not a corpus:** nothing marks "this clip carries neighbour bleed" except dataset
identity. The per-band pass measured three independent +0.02-class wins on choral material
(quorum .75, 120 ms floor, long-quiet filter) that only a bleed/ensemble detector could
gate; a bleed annotation — even per-dataset-section — is the cheapest way to develop one.

---

## Findings log (2026-08 plugin-source pass)

Execution of `plan-plugin-improvements.md` (the batched proposals from
`research/research-plugin-sources.md` §17). One entry per task, nulls included, as usual.

### R11: every frame-denominated knob is now hop-independent (2026-08-19)

Praat's convention (`research/research-plugin-sources.md` §6.1, §16.10), applied to the four constants
§16.10 lists: per-frame _costs_ are now declared in nats **per 10 ms** and rescaled by
`hopSec / 0.01` at decode time; frame _counts_ are now declared in **seconds** and rounded onto
the track's own grid per decode. A hop change can no longer silently re-tune the model, and the
hand-derived "3.4×" note in `note-segmenter.ts` is gone. `minFramesPerNote` (profile/provider
seam) deliberately stays in provider frames — it is converted where the frame grid is known
(`crepe-provider.decodeVoice`, the sweeps).

**Conversion table** — read this to translate historical sweep numbers:

| knob                                   | was             | now declared                       | at the 20 ms hop             |
| -------------------------------------- | --------------- | ---------------------------------- | ---------------------------- |
| `NoteSegmenterOptions.attackFrameCost` | 0.35 nats/frame | **0.175 nats / 10 ms**             | ×2 → 0.35, unchanged         |
| `NoteSegmenterOptions.minFrames`       | 5 frames        | **`minNoteSec` 0.1 s**             | round → 5, unchanged         |
| `VoiceDecodeOptions.attackFrameCost`   | 0.35 nats/frame | **0.175 nats / 10 ms**             | ×2 → 0.35, unchanged         |
| `VoiceDecodeOptions.minFrames`         | 4 frames        | **`minNoteSec` 0.08 s**            | round → 4, unchanged         |
| basic-pitch `MIN_NOTE_LEN_FRAMES`      | 11 frames       | **`MIN_NOTE_LEN_SEC` 0.128 s**     | ÷(256/22050) → 11, unchanged |
| basic-pitch `ENERGY_TOLERANCE`         | 11 frames       | **`ENERGY_TOLERANCE_SEC` 0.128 s** | → 11, unchanged              |

Sweep-name translation: `e1c minFrames3/4/5/6` → `e1c minNote60/80/100/120ms`;
`e1c attackFrame0.15/0.35/0.7` (per frame) → `e1c attackFrame0.075/0.175/0.35` (per 10 ms).

**Verified bit-identical at the current hop** (every conversion is floating-point-exact:
`0.175 × (0.02/0.01) === 0.35` etc.): `sweep-segmenter.ts` (dev, 742 clips, all configs) and
`sweep-voice.ts` (dev, groups base+e1c+ship, 693 voice + 49 guard clips) both reproduce the
pre-change output to the last digit, including the paired-bootstrap CIs. No `CACHE_VERSION`
bump needed — the cached CREPE decode is upstream of everything touched.

### R15: joint duration × velocity note filters — null, and the mechanism is legible (2026-08-19)

WaoN's two-condition filters (`research/research-plugin-sources.md` §9.3) implemented behind options on all
three planned paths — `keepShortLoudRatio` (a short run survives the note floor when its peak
energy reaches k × the clip's median voiced energy) and `dropLongQuiet` (drop a note ≥ minSec long
whose mean energy sits below q × that median): `voice-note-decoder.ts`, `note-segmenter.ts`, and
`basic-pitch-provider.ts` (env-sweepable via `EVAL_KEEP_SHORT_LOUD` / `EVAL_LQ_QUIET` /
`EVAL_LQ_MINSEC`). `sweep-reverb.ts` gained `segment`/`vsName` config hooks (voice-decode rows,
anchored paired CIs incl. ΔP/ΔR) to measure them on the adverse tier they were built for.

**Every leg is a null.** The gate was "precision up on the adverse tier, recall unchanged":

- **Voice decode, adverse tier** (`sweep-reverb`, annotated-vocalset+vocadito dev, vs `voice OFF`):
  short-loud is _exactly_ zero everywhere (Δ 0.000 on real/echoey-room/distant-mic — at
  changeCost 2.5 the decode emits essentially no short runs for the exemption to save). Long-quiet
  is zero-to-negative: echoey-room lq.45 ΔR −0.005*, ΔP −0.002; distant-mic lq.45 ΔP −0.007*,
  ΔR −0.012\* — under reverb it removes real quiet notes, not tails.
- **Why the tail theory fails here:** a reverb tail never becomes a note on the trajectory path —
  CREPE's confidence collapses on tails, so the voicing gate has already eaten the thing the
  long-quiet filter was built to catch (same reason the 2026-07 gates/afftdn attempts were dead
  ends).
- **Clean corpus** (`sweep-voice` r15 group, 693 voice/49 guard; `sweep-segmenter`, 742 clips):
  lq ≤ 0.3 trims spurious (23→21 voice, 22→20 hmm) with recall intact — +0.002
  [+0.002,+0.003]\*, real but far under the ~1 pt bar; lq 0.45 starts eating true notes.
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
aubio median-of-6; `research/research-plugin-sources.md` §11.3/§7.2/§4.5), implemented as
`quorum?: { minFraction, windowSec }` on `PitchTrack.voicedMask` (demote-only: a frame that fails
the raw gate is never promoted) and plumbed through `voicedQuorum` options on both trajectory
consumers. **No `CACHE_VERSION` bump**, deviating from the plan's precaution deliberately: the
caches store cents/confidence/energy and the mask is derived downstream at decode time, so a
defaulted-off option cannot invalidate a cached byte.

**Null on its own target.** The claim was "spurious short notes fall on the reverb tier, clean
unchanged" (grid: minFraction 0.25/0.5/0.75 × window 60/120/200 ms, `sweep-reverb` voice rows
anchored on `voice OFF`, plus the `sweep-voice` r19 clean group):

- Mild quorums (≤0.5) are zeros everywhere; the best cell in the whole grid is echoey-room
  q.5w60 at ΔP +0.002 [+0.001,+0.004]\* — real, microscopic, far under the ~1 pt bar.
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
  d±10–30 ms are zeros-to-negative; d+50 costs GUARD −0.018\*. The historical output is the optimum.
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
before a rise counts), and no threshold _level_ on a plain RMS-rise novelty can substitute for it,
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

| estimator                   | vs SHIPPED (anchor +0.094) | pWrong/100 | chromaF1    |
| --------------------------- | -------------------------- | ---------- | ----------- |
| trimmed-mean (ships)        | +0.094                     | 17         | 0.522       |
| slew 30 ms                  | +0.094 (identical)         | 17         | 0.522       |
| one-pole τ20 ms             | +0.093                     | 17         | 0.519       |
| slew 50 / pole 40 / detrend | +0.091 / +0.088 / +0.085   | 18         | 0.516→0.508 |
| slew 100 / pole 80          | +0.076 / +0.075            | 19–20      | ≤0.493      |

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

| ±0¢   | ±20¢  | ±40¢  | ±60¢  | ±80¢  |
| ----- | ----- | ----- | ----- | ----- |
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
  all seven conditions; aubio's frames-3..9 window _hurts_ under reverb (echoey −0.006,
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

| config                    | VOICE         | splits/100 | pWrong | chromaF1 |
| ------------------------- | ------------- | ---------- | ------ | -------- |
| single-candidate anchor   | **+0.095**    | 13         | 17     | 0.520    |
| k=3 (y 0.5/1/2 identical) | +0.088        | 14–15      | 16     | 0.514    |
| k=5                       | +0.078        | 16–17      | 16     | 0.507    |
| k=5 + octave tie-break    | +0.075…+0.077 | 17         | 16     | 0.506    |

The failure is monotone in k and indifferent to `yinTrust` — it is the _availability_ of
alternatives, not their weighting: every extra candidate is another place a pitch state can sit,
and the decode spends that freedom on splits (13→17/100) while buying only pWrong 17→16. The
octave tie-break has nothing to fix (octErr was already 0.006).

**Why pYIN needs this and we do not:** our per-frame trajectory is already Viterbi-smoothed over
the full 360-bin activation — frame-level continuity is applied _before_ the note model — so the
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

| margin            | paced vs whole-buffer                                           |
| ----------------- | --------------------------------------------------------------- |
| 0.4 (ships) / 0.3 | identical rows (incl. the same pre-existing 1-note cello quirk) |
| 0.2               | first divergence (voice-continuant tune 0.815 → 0.769)          |
| 0.1               | broad divergence, 2-note deltas on the legato scenarios         |

So 300 ms is validated-equal and 200 ms — Essentia's own default — is the measured edge, because
our margin is not confirming the note-off acoustically; it is confirming that CREPE's trailing
window context can no longer change the tail decode, a stricter requirement. **Default stays
0.4** (the check is 12 clips and the prize is 100 ms of mid-recording commit latency); anyone
wanting the latency has a measured, env-gated knob and this table.

### E6 (R13): the running-mean baseline earns its place as a baseline — not as a ship (2026-08-19)

(a) Essentia's `PitchContourSegmentation`, written from §7.1's prose (AGPL — never read/ported),
now lives in `sweep-segmenter.ts` as `runningMean` configs (island building against the note's own
accumulated mean; per-segment RMS z-cut). At ±80 ¢ it beats the LEGACY shipping segmenter pooled:
**+0.011 [+0.002, +0.020]\*** over 742 dev clips — the survey's "cheapest thing that could
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

Design first per the plan (`research/design-take-key.md`): TalentedHack's two-mask correction (take-key =
interpretation, score key = spelling; the score's `keyFifths` stays absolutely authoritative and
the take-key is a FALLBACK for keyless takes only), profile as a parameter
(Krumhansl/Temperley/diatonic), abstain competing as the incumbent (libKeyFinder's all-zeros
profile). Built as `estimateTakeKeyClasses` in `voice-notation.ts` (duration-weighted pitch-class
histogram over offset-normalised floats, 24-rotation Pearson), judged on the page by
`bench-take-key.ts` (new): spelling error + accidentals/100 against INTENDED notes on the
intonation tier, fallback on vs off.

**It does not ship, and both failure modes are the estimator's, not the wiring's:**

| detune  | wrong% off→key        | keyRight    | abstain |
| ------- | --------------------- | ----------- | ------- |
| ±0¢     | 1.8 → 1.8             | 9/16        | 0/16    |
| ±20¢    | 1.8 → **2.4**         | 9/16        | 0/16    |
| ±40¢    | 31.1 → 32.2           | 7/16        | 0/16    |
| ±60/80¢ | 65.7→66.9 / 98.8→97.1 | 1/16 / 0/16 | 0/16    |

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

---

## Findings log (2026-08 plugin-source pass, Batch 4)

### R23: OpenVPI GAME — resolved at the licence gate; no benchmark run (2026-08-19)

The plan's blocking check came first, and it is decisive: the GAME repository's _code_ is MIT, but
the pretrained checkpoints (v1.0.0 release, small ~12M / medium ~50M / large ~100M) state plainly
that **"The model files apply CC BY-NC-SA 4.0 license"** — non-commercial. Per the licence
register's standing rule (the artifact's own published licence governs, at face value, in both
directions), NC weights are **barred** for this product — the same class of exposure that rejected
RMVPE. Per the plan's own blocking clause, nothing was downloaded and no benchmark was run.

**Verdict: ignore (licence-barred).** Recorded for the day that changes:

- The runner design is fully specified in the plan (bench-yong-runner.py style →
  `bench-external-notes.ts`, `EXT_DIR=<dir> EVAL_SPLIT=test`), and OpenTune's deployment lore is
  in §20.2 (chunk > 45 s at silence midpoints, 50 ms seam dedupe keeping the earlier note, never
  the CoreML EP). If OpenVPI ever relicenses — they relicensed SOME's ancestor tooling before —
  the benchmark is an afternoon.
- Training-data note from the release page, for the register: ~32 h manually-labelled singing +
  DEMAND/MUSAN/MIR-1K/MusicNet/MUSDB18-HQ + private recordings.
- The §10d question ("is a learned note model where the headroom is?") remains answered by the
  N20EMv2 yardstick alone; GAME does not change that answer's evidence either way.

Sources: github.com/openvpi/GAME (MIT LICENSE; releases page v1.0.0, licence statement quoted above).

### R24: angle-band-gated slope rotation — the fourth estimator null closes the family (2026-08-19)

OpenTune's conditional detrend (§20.5: slope from endpoint medians, normalised at 7 st/s, rotate
flat only inside the 10°–30° band) as `pitchEstimator: 'slope-gated'`. Dev VOICE slice, r17's
setup: **+0.090 vs trimmed-mean's +0.094** (pWrong 17→18, chromaF1 0.522→0.516). The gate was the
one untested twist, and it changes nothing: notes whose residual ramp falls in the band are
precisely the expressive ones the trim already handles, and rotating them re-centres toward the
ramp's midpoint — away from the sung pitch — exactly as the unconditional variants did. Four
estimators (Hann median, slew-limit, one-pole, detrend ± gate) have now reproduced-or-worsened the
trimmed mean; the family is closed. Do not add a fifth.

### R25: two-tier silence rule — exactly inert, for the reason gates always are here (2026-08-19)

OpenTune's `SilentGapDetector` rule (silent if total RMS ≤ −40 dBFS, or ≤ −30 dBFS while the
60 Hz–3 kHz band is < −40 dBFS) as `OnsetDetectorOptions.silenceRule` + a `bandEnvelope`, measured
via sweep-reverb's new `onsetFromAudio` rows (full `detect()` over freshly decoded audio;
`onset audioCtrl` — the decode-path control — reproduces the cached onsets exactly, so the new
path is verified) on vocadito × real/wind-outdoor/street-noise.

**Every row is identical to the control, +0.000 exactly**: the rule never reclassifies a single
frame. The thresholds are ABSOLUTE dBFS and this pipeline's material sits far above them — healthy
recording levels everywhere, wind bed included — so the tier the rule adds is unreachable, while
the existing relative 8 %-of-peak floor already does the job level-independently. This is the same
lesson as 2026-07's gate dead-ends and §20.6's own listing of OpenTune's −50 dBFS pre-inference
gate as a non-finding: absolute-level gates assume a DAW's level discipline that recorded input
does not have. Option and band envelope stay (they are the right shape if a calibrated-level
source ever appears); do not re-tune the thresholds toward "where they would fire" — that is gate
tuning, measured dead twice.

**Batch 4 complete.** All 19 plan tasks resolved: 6 done ([x]), 13 measured nulls ([n]), every
outcome above with its mechanism.

---

## Findings log (2026-08-20, overnight: provider consolidation + per-band gating)

Two questions, asked together: what would **dropping the basic-pitch provider** cost in
accuracy (and can a pitch-shift front end or one of the gated features pay it), and does any
gated feature want a **per-band** (`PROFILE_BANDS`) setting instead of its global one.

### Where basic-pitch actually gets traffic (`probe-provider-routing.ts`)

Every wav of both corpora resolved through the production resolver (harness hints,
full-clip scan): **331 of 3 633 routings are basic-pitch, and not one of them carries
pitched real material.**

| route                   | real corpus                                                                                | synthetic                                        |
| ----------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------ |
| `very-high` band        | 20 — all AVP vocal percussion (pitchless)                                                  | 53 (whistle/piccolo scenarios)                   |
| `default-wide` fallback | 198 — 188 annotated-vocalset echoey-room/distant-mic variants where the scan fails, 10 AVP | 60 (degraded variants with unscannable lead-ins) |

Every pitched real clip routes to crepe-tiny (mid ≈ 1 510, low ≈ 1 006, high ≈ 231). The
consolidation question therefore lives entirely on the synthetic very-high scenarios and
the scan-failure fallback.

### The very-high band on CREPE, analysed one octave down (`bench-crepe-pitchdown.ts`)

The shift is exact and artifact-free: decode at 32 kHz and let CREPE read the samples as
16 kHz — the take plays at half speed, every frequency halves with harmonic structure
intact (a tape machine, not a phase vocoder) — then rescale times ÷2 and pitches +12 st.
Effective coverage ~3.9 kHz real, above the corpus's highest note (3 729 Hz). Fixed-config
comparison at the band anchor (whistle-mid/high + piccolo × 7 conditions, COnP@±100 ms,
paired over 84 clips):

| config                         | pooled    | clean | echoey-room | distant-mic | Δ vs basic-pitch                                                                      |
| ------------------------------ | --------- | ----- | ----------- | ----------- | ------------------------------------------------------------------------------------- |
| basic-pitch (ships)            | 0.556     | 0.881 | 0.341       | 0.227       | —                                                                                     |
| crepe, no shift (naive drop)   | 0.546     | 0.843 | 0.322       | 0.200       | −0.010 [−0.046,+0.026]; whistle-high −0.114 (39 % of its notes sit above the ceiling) |
| crepe −1 oct                   | 0.578     | 0.966 | 0.244       | 0.169       | +0.022 [−0.010,+0.054]                                                                |
| **crepe −1 oct + reverb ramp** | **0.583** | 0.966 | 0.271       | 0.181       | **+0.028 [−0.003,+0.059]**                                                            |
| crepe −2 oct                   | 0.548     | 0.945 | 0.235       | 0.165       | −0.008 — no content needs the depth, 4× cost                                          |

Both hypotheses behind the question confirm in direction: the pitch-down closes the
ceiling gap (the naive drop's whistle-high −0.114 becomes −0.02), and a gated feature
recovers part of the rest — the reverberance relief ramp, which the basic-pitch band could
never use because it has no confidence gate to relax. Heavy reverb is the one remaining
deficit (−0.05…−0.07 vs basic-pitch), consistent with the 2026-07 diagnosis: reverb
collapses CREPE's confidence, and basic-pitch's CNN note head is less gate-bound there.

### Full integration, gated: `RECORDING_VERY_HIGH_CREPE=1`

`CrepePitchdownProvider` (a 32 kHz wrapper over the same crepe-tiny checkpoint — no new
model, registered whenever CREPE is), the `very-high` band-table swap (which also re-arms
`applyReverb` there), a per-provider window ceiling in the resolver (2 × 1 900 Hz), and the
voice overlay explicitly excluded (whistling is a documented voice-decode gap). Adaptive
production path over the same scenarios:

|                                      | baseline (basic-pitch band) | consolidated       | Δ paired                                |
| ------------------------------------ | --------------------------- | ------------------ | --------------------------------------- |
| pooled COnP                          | 0.589                       | **0.605**          | **+0.016 [−0.010, +0.042]**             |
| piccolo / whistle-mid / whistle-high | 0.70 / 0.53 / 0.54          | 0.73 / 0.55 / 0.54 |                                         |
| missed per 100                       | 36                          | 30                 | est. repair −16 % (5 297 → 4 445 s/100) |
| re-onset / transition recall         | 0.69 / 0.52                 | 0.80 / 0.61        |                                         |
| echoey-room / distant-mic            | 0.36 / 0.26                 | 0.33 / 0.22        | the reverb deficit                      |

### The DEFAULT_PROFILE is provider-immaterial (`bench-default-provider.ts`)

All 248 non-pitchless clips the resolver actually routes to the fallback, scored under
four defaults: basic-pitch (ships) **0.001**, crepe-tiny **0.001** (paired Δ +0.000
[+0.000, +0.000]), crepe + reverb ramp 0.003, octave-down crepe 0.001. The fallback only
fires on audio so degraded that no provider transcribes anything — so the flag's second
half swaps `DEFAULT_PROFILE` to crepe-tiny at zero measured cost, and with it basic-pitch
has **no remaining route**.

### Decision summary — what dropping basic-pitch would buy and cost

- **Accuracy**: parity-or-better on the only scenarios that route there (+0.016 pooled,
  CI spans zero; two independent measurements agree), with heavy reverb on
  whistling/piccolo the one regressing condition (−0.03…−0.04). Zero exposure on pitched
  real traffic.
- **The caveat that travels with every number**: the very-high band has no real test data
  in either direction (standing open item) — this is synthetic whistling/piccolo only,
  exactly as the shipping basic-pitch path's own validation always was.
- **Cost/ops**: removal would delete one of the two Python gRPC inference services, the
  basic-pitch TF.js path and model directory, and streaming's 36 164-sample hop-alignment
  constraint. The pitch-down costs 2× inference on the very-high band only — a band with
  ~zero production traffic.
- **What the flag deliberately does NOT do** (the actual removal, a separate decision):
  `ProviderRegistry` still constructs and requires basic-pitch and `get()` falls back to
  it; `check-inference-parity.ts` still gates the remote path; k8s still deploys the
  sidecar. Turn the flag on in production first and let real traffic vote.

### Per-band gated features: a null with a mechanism — band is a proxy for MATERIAL (`sweep-bands.ts`)

Every cached clip carries the band the resolver chose, so every gated feature was re-scored
as a paired Δ vs the production config **within band × path strata** (dev 525 clips:
low/voice 133, mid/voice 301, high/voice 42, mid/instr 38 — low/high instrument strata are
n ≤ 6 on the real corpus and cannot power a conclusion; the per-band tuning of the CORE
knobs on synthetic instruments is how `PROFILE_BANDS` was built in the first place).

**Everything that looked like band structure on dev decomposed into material or died on
test:**

- `quorum .75/60 ms` (high/voice +0.019*), `minNoteSec 120 ms` (high/voice +0.016*), and
  the R15 long-quiet filter (high/voice +0.013*) all put their entire gain inside
  **esmuc-choir, at every band** (+0.014…+0.027*), while hurting solo corpora
  (n20emv2/low −0.023*/−0.011*, csd/low −0.017*, guitarset −0.015*). Bleed effects wearing
  a band costume — the axis that separates them is one the resolver cannot observe.
- `v.trust 0.4` was the one candidate with a within-dataset register gradient
  (annotated-vocalset low +0.029* vs mid +0.010) and no observed harm in any low stratum:
  dev low/voice +0.019*. **Held-out test: +0.007 [−0.006, +0.019] — not confirmed.**
- `v.onsetShiftSec 90 ms`: dev low/voice +0.021*, test +0.002 [−0.007, +0.011] — gone; on
  dev it also split by dataset, not band (esmuc/mid +0.013* vs csd/mid −0.033\*, both choral).
- Reverb-flag strata (`BAND_STRATA=band-rev`): on `+reverb` clips the relief is already
  right — lowering the gate further costs (mid/voice/rev −0.029\* at −0.15), raising it back
  is n.s. everywhere — so the ramp's false-fires on sustained clean singing cost nothing
  measurable and `REVERB_CONFIDENCE_RELIEF` earns no per-band value.
- Uniform across strata, matching the standing global verdicts: gate offsets (lowering
  hurts everywhere), R21 fill (negative on clean in every stratum), smoother width,
  changeCost ≥ 2.5 saturation, evidenceDiscount, adaptiveFloorFraction 0.3 (both directions
  worse everywhere), onsetSplit (keep global: −0.030\* to remove on mid/instr, COnP-neutral
  on voice).

**Answered by mechanism, no sweep needed:** `silenceRule` (R25 — it never reclassifies a
single frame on any clip, so no per-band assignment can make it matter), `adaptiveThreshold`
(R3 — wrong novelty function, band-independent), `candidates`/`intervalChange`/
`silenceMemory`/`unvoicedChangeRelease` (E3/E4/E7 — band-independent structural kills),
the pitch-estimator family (R17/R24 — closed), the noise-adaptation actions + afftdn
(2026-07 — sign-wrong/neutral with a band-independent mechanism).

The register lesson mirrors the 2026-08 routing lesson: segmentation quality is a property
of the **source**, and the axis that pays is material (voice vs instrument vs bleed) — which
the profile system already routes on. `PROFILE_BANDS` supports per-band values today; the
evidence says there is nothing new to put in them. If a bleed/ensemble detector ever exists,
the esmuc trio above (+0.02-class, three independent knobs) is what it would unlock.

---

## Findings log (2026-08-20 gap-filling pass)

Executed against the **real-corpus gap register** above. Two of its rows now have real audio
behind them for the first time; the acquisition question for whistling is closed with evidence.
Research: **`research/research-whistle-corpus.md`** (whistling, in full) and
`research/research-voice-datasets.md` §6 (every other licence verdict this pass produced).

### Whistling: 0 → 11 real clips, and the acquisition question is closed

**There is no whistling corpus, and there will not be one.** `research/research-whistle-corpus.md` §2
records the sweep with the evidence attached: FSD50K has **no `Whistling` class at all**
(measured from its `vocabulary.csv`, not inferred); AudioSet has the class but no grant over
the audio; **MLEnd Hums and Whistles** — 6,000 files, 235 people, the biggest whistling
collection in existence — reports `licenseName: "Unknown"` on Kaggle's own metadata API and
states no terms anywhere, on top of eight in-copyright compositions; the Silbo Gomero corpus is
CC BY-NC-SA; AID's Zenodo field says CC-BY-4.0 while the LICENSE _inside its archive_ says
CC BY-NC-SA (→ NC, per §5e's precedent), and its whistling is 18.5 s of incidental material
anyway; both Belyk Dryad deposits are CC0 with **no timing anywhere** in the annotation chain.

What does exist is now fetched, drafted and wired in. **Freesound's CC0 slice is what makes
this a corpus rather than a smoke test** — an API key (free, instant) reaches previews under
token auth, and 537 candidates screened down to 112 usable clips:

| dataset           | clips   | notes     | audio                            | licences                                                          |
| ----------------- | ------- | --------- | -------------------------------- | ----------------------------------------------------------------- |
| `whistle-real`    | **117** | **2,777** | **18.3 min** (median clip 7.8 s) | CC0 (112 Freesound) + PD / CC BY-SA 3.0/4.0 (5 Wikimedia Commons) |
| `whistle-vintage` | 6       | 249       | 3 min                            | public domain (Alice J. Shaw, Frank Stafford — pre-1923 sides)    |

⚠️ **Assembling that by search needed two filters, and the acoustic one was not enough.**
`whistleScreen()` gates on the property that defines whistling — nearly all energy in one moving
partial (real whistling 0.61–1.00; trains, crowds, wind, a shower head ≤0.08). It kept 82 of the
first 170 candidates, and reading those 82 titles found `tin whistle.wav`, `Celtic Whistle
Melody`, `Slide-whistle.wav`, `Hoary marmot whistles`, `Retro video game sfx - Wolf Whistle` and
`synth Crystal`. **No threshold fixes that**: a tin whistle, a slide whistle, a sine synth and a
marmot are acoustically the same class of signal as a person whistling. So the metadata gate
(`FREESOUND_REQUIRE` + `FREESOUND_VETO`) requires the sound to be _described_ as whistling in
name or tags and vetoes instruments, synthesis, cartoons, animals, machines, heavy processing
and non-melodic whistles — biased to precision, since a wrong clip costs a human's verification
time and then poisons the truth. Funnel: 537 → 372 (described as whistling) → ~282 (not vetoed)
→ **112** (acoustic). Verdicts are cached per `SCREEN_VERSION`, so re-runs neither re-download
nor inherit superseded criteria. Also worth knowing: **Freesound's `next` link points at
`/apiv2/search/` with no `/text/` and does not answer**, so paging must be `page=1,2,3…` — the
first sweep silently stopped at 150 results.

New chain, four scripts: `fetch/fetch-whistle-real.ts` (acquire + verify each licence live against
the source's API + normalise) → `fetch/draft-note-labels.ts` (`lib/sineTrack.ts` drafts labels) →
_human corrects the TSVs_ → `fetch/import-note-labels.ts` (→ scoreable dataset). **Audio is cached,
labels are committed** (`scripts/eval/annotations/`, Audacity's own three-column format) —
the labels are the only artefact nobody can regenerate. Both datasets carry
`noteTruthDerived: true` until a human verifies them, which is the flag that keeps unverified
drafts out of every pooled number; §1 of the research file spells out why that matters
specifically here (ship the whistle-FFT-tracker of open direction 4 before verifying, and the
labels become a sibling of the estimator).

**Real-whistle measurement (adaptive, draft truth, n = 117 clips / ~2.8k notes — read as
diagnosis, not accuracy):**

| dataset           | COnP@100 ms | octErr   | missed | spurious/100 | onset bias       | trans recall   |
| ----------------- | ----------- | -------- | ------ | ------------ | ---------------- | -------------- |
| `whistle-real`    | 0.36        | **0.00** | 55 %   | **3**        | +31 ms (med +20) | 0.258 (n=1270) |
| `whistle-vintage` | 0.02        | 0.16     | 58 %   | **102**      | +62 ms           | 0.293 (n=41)   |

1. **No octave errors on clean real whistling — confirmed at scale.** 0.00 over ~2,800 notes.
   The failure mode a near-sinusoidal source was expected to provoke does not appear at all, so
   a whistle-specific octave prior has nothing to fix. On the accompanied vintage tier it does
   appear (0.16), which is the accompaniment.
2. **The failure is conservative, not noisy**: 55 % of drafted notes missed against only **3
   spurious per 100**. The pipeline drops whistled notes rather than inventing them. (Part of
   that missed rate is the draft's own over-segmentation — 2.5 notes/s — so read the
   missed:spurious _ratio_, which is the robust part, not the absolute.)
3. **Transitions are the loss, now with real weight**: transition recall 0.258 over **1,270**
   real transitions vs 0.344 on silence onsets. Whistling has no consonant to mark a re-onset,
   and this is the first non-synthetic measurement of what that costs.
4. ⚠️ **Correction to the earlier n=5 reading: the band ceiling is NOT the problem.** With five
   clips it looked as though the resolver's 1900 Hz `high` ceiling routinely sat under the
   material (2 of 5). Over 117 clips it is **3 of 120 analyses (2 %)**, and the overflow is
   trivial — median 26 Hz, worst 53 Hz. The routing is mostly right: 71 clips (61 %) →
   `very-high`/basic-pitch (4300 Hz ceiling, median scan 1570 Hz), 40 (34 %) → `high`/crepe-tiny
   (1900 Hz ceiling, median scan 1106 Hz — legitimately inside CREPE's range). The remaining 9
   resolved `mid`/`low` on median scans of 377/121 Hz, which almost certainly means the whistle
   is not the loudest thing in those clips; they are the first candidates for the verification
   pass to look at.
5. **On accompanied material the resolver locks onto the accompaniment.** Every vintage clip
   resolved `mid+noise` or `high+noise` with a 1900 Hz ceiling from a scan reporting
   p10/med/p90 ≈ 215–530 Hz — the _piano_, while the whistled line sits at 1.3–2.2 kHz. The
   102-spurious-per-100 rate is the same fact from the metric's side. This is a genuine
   pipeline finding, and the only reason it is visible is that nobody synthesised it.

### The `very-high` band, measured on real timbre for the first time (`fetch/fetch-tinysol.ts`)

The register's flat statement was that **zero real pitched clips reach the `very-high` band**,
so both its shipping path and the 2026-08-20 CREPE-pitchdown replacement were
synthetic-validated only. TinySOL (CC-BY-4.0, Ircam Studio On Line, 2,913 isolated notes) has
**742 notes at or above MIDI 77 and 353 at or above MIDI 86** — flute to D7, violin to E7,
accordion to C♯8 — so `fetch/fetch-tinysol.ts` splices them into 8-note clips: **64 clips / 512 notes**
across six instrument datasets, two bands (`high` 77–85 vs `very-high` 86–100), three dynamics,
and two layouts (`legato`, 0 ms gap → real pitch transitions; `detached`, 80 ms gap).

⚠️ Truth is **exact** (we placed every onset) and the performance is **not human** — no
performer timing, no shaping. That is the opposite of `noteTruthDerived`, so it got its own
manifest flag, **`constructedPerformance`** (`lib/realCorpus.ts`, honoured by `run-eval.ts`
with its own footnote): reported, never pooled. Read it as register evidence only.

| stratum                   | n clips | COnP@100 ms  |
| ------------------------- | ------- | ------------ |
| `high` (MIDI 77–85)       | 36      | **0.924**    |
| `very-high` (MIDI 86–100) | 28      | **0.654**    |
|                           |         | **Δ −0.270** |

And the interaction that says where to look:

| band        | pp        | mf    | ff    |
| ----------- | --------- | ----- | ----- |
| `high`      | 0.854     | 0.979 | 0.939 |
| `very-high` | **0.451** | 0.752 | 0.780 |

Per instrument, `high` → `very-high`: flute 1.000 → 0.656, violin 0.938 → 0.643, oboe 0.938 →
0.754, viola 0.856 → 0.625, accordion 0.896 → 0.627 (clarinet tops out at MIDI 91 so it has no
`very-high` clips; its `high` mean is 0.917). **`octErr` is 0.00 in every stratum** — the band
does not lose notes to octave confusion, it loses them outright, and the loss concentrates in
_quiet_ high notes (`very-high` pp 0.451 vs ff 0.780). Onset bias runs +26…+40 ms late on
flute/violin/viola/accordion and −16…+4 ms on clarinet/oboe, but that comparison is confounded
by the splice convention (a note is trimmed at −34 dBFS of its own peak, which places the truth
onset earlier than the perceptual attack on slow bowed/breathy attacks) — do not read it as a
calibration constant.

Also worth noting for anyone using these clips: many resolved `high+reverb` / `very-high+noise`
despite being dry Ircam recordings, because the spliced decay tails read as reverberance. That
is a property of the construction, not of the audio.

### The capture codec costs nothing measurable — a null with the alignment proven first

The register's other standing complaint was that _"no annotated corpus of phone-mic webm/opus
recordings"_ exists and `probe-realpath.ts` probes the codec path _with no truth behind it_.
That one needed no data at all: a codec round trip cannot move a note, so every clip's existing
truth still applies. `Condition.codec` (types.ts) + a two-pass branch in `lib/degrade.ts` now
re-encode a finished clip through the encoders browsers actually negotiate, and four new
opt-in conditions exercise them: `phone-opus-96k` (the common MediaRecorder default for mono
Opus), `phone-opus-32k`, `phone-opus-16k` (where Opus starts band-limiting hard — which matters
more for whistling's 1–3 kHz fundamentals than for anything else we take) and `phone-aac-64k`
(Safari's mp4/AAC path).

**Alignment was verified before any score was read**, because an onset metric on a
time-shifted clip measures the shift: best-correlation lag is **0.00 ms** for all four codecs.
The round trip did come back ~72 ms short on Opus and ~58 ms on AAC (the encoder's frame
padding, trimmed off the tail), which would have silently eaten the last note of every spliced
TinySOL clip — so the encode input is padded (`apad`, 0.25 s) and the decode trimmed back;
lengths now match within 0.6 ms with alignment still exact.

| dataset               | `real` (WAV) | opus 96k | opus 32k | opus 16k | aac 64k |
| --------------------- | ------------ | -------- | -------- | -------- | ------- |
| `tinysol-flute` (12)  | 0.828        | 0.838    | 0.841    | 0.802    | 0.852   |
| `tinysol-violin` (12) | 0.790        | 0.785    | 0.763    | 0.763    | 0.784   |
| `whistle-real` (5)    | 0.315        | 0.325    | 0.321    | 0.359    | 0.321   |

**Verdict: null, and a reassuring one.** Every delta is inside ±0.03 with no monotone trend in
bitrate — even 16 kbps Opus, which is well below anything a browser negotiates. The WAV-based
numbers in this log do transfer to the path users actually record on. Two honest limits: 29
clips is far too few for a confidence interval (this is a "no large effect" result, not a
measured zero), and it covers the **codec only** — not the browser's audio processing. That
part happens to be safe by construction here: `RecordingEngine`'s `MIC_CONSTRAINTS` set
`echoCancellation`, `noiseSuppression` and `autoGainControl` all to `false`, so on any platform
that honours them the codec IS the capture-path transform. Where a platform ignores them
(Safari/iOS is the usual suspect) this measurement says nothing.

### What this pass did NOT close

- **`whistle-real` has no performer metadata.** 117 clips is enough for a mean, but
  `lib/split.ts` groups by performer and Freesound gives us an uploader, not a whistler — so the
  split there is per-clip, and one uploader's several takes can land on both sides. Treat the
  number as a corpus mean, not as a tuning target.
- **Nothing is human-verified yet.** Both whistle datasets are flagged derived until someone
  spends the ~40 minutes the research file's §6 budgets.
- **Dogfood is the route still unexercised**: Freesound gave us 18 minutes of other people's
  whistling, but nothing captured through the product and nothing performed in a real room, and
  `WHISTLE_LOCAL_DIR=<dir>` ingests our own takes — the capture protocol (registers,
  articulations, deliberately bad intonation, ~10 takes through the product's webm/opus path,
  ~6 in a real echoey room) is written out in `research/research-whistle-corpus.md` §6.
- **Real measured acoustics** are researched but not implemented: DEMAND (CC-BY-4.0,
  `10.5281/zenodo.1227121`) for recorded noise beds and Arni/dEchorate/OK5 (all CC-BY-4.0, DOIs
  in `research/research-voice-datasets.md` §6c) for measured RIRs would turn the adverse tier's
  _modelled_ room and babble into _recorded_ ones. Both need one optional field on `Condition`
  and NEW condition ids — never a redefinition of the existing four, or every historical
  adverse number silently changes meaning. The MIT IR Survey, the obvious first choice, is
  **barred**: its own page states no terms and the CC-BY-4.0 claim comes from a third-party
  re-upload (§6d).
- **Harmonica** has no real permissive counterpart anywhere (§6k), so the synthetic
  `harmonica-mid` scenario stays the only evidence — now a documented state rather than an
  unexplored one.

---

## Findings log (2026-08-22 dogfood whistling)

The first whistling recorded through our own capture path: `context/whistled-high-register`,
6 clips × 11.5 s, high register (measured f0 958–1838 Hz), a generated melody performed to a
metronome. Two results — one about the corpus, one about the pipeline.

### The truth had to be repaired before it measured anything (`fetch/align-prescribed-truth.ts`)

Scored as recorded: **COnP 0.00**. The truth is the _prescribed melody_, and the performance is
not the score:

- **Wrong key, and not by a constant.** Median measured − written pitch +12.50 st, **0 %** of
  notes within ±0.5 st of what is written. Best-fit transposition per clip: 12.27, 12.89, 12.27,
  12.69, 12.66, 12.39 — **three of six clips were whistled thirteen semitones up, not twelve**.
  Nothing in the capture recorded which key was used.
- **Metronome onsets, not performed onsets.** The grid misses the actual attacks by a median
  90 ms, p90 190 ms; **40 % of notes are outside the ±100 ms tolerance before the pipeline
  runs**. A per-clip line fits an intercept of +19…+116 ms — not one latency to subtract —
  leaving 21–134 ms RMS of real timing variance.

This is the trap `research/research-whistle-corpus.md` §6 names explicitly ("do NOT whistle along to a
click"): it produces score-derived truth, which measures the performer. **What survived is the
performance quality** — after one transposition per clip the residual is a median 15 ¢, p90
82 ¢, so the intervals are intact and only the key is unknown.

`fetch/align-prescribed-truth.ts` therefore takes note IDENTITY from the prescribed melody, the KEY
from a per-clip fit, and TIMING from the audio, DTW-aligning the two sequences. The source
dataset is never modified; output is the sibling `whistled-high-register-aligned`, flagged
`noteTruthDerived` until verified, with label TSVs in the usual Audacity loop.

| truth                              | COnP     | pWrong /100 | exact pitch on matched pairs |
| ---------------------------------- | -------- | ----------- | ---------------------------- |
| as recorded (prescribed)           | 0.00     | 42          | 40 %                         |
| aligned, key rounded to an OCTAVE  | 0.19     | 35          | 40 %                         |
| aligned, key rounded to a SEMITONE | **0.41** | **9**       | **79 %**                     |

Two mistakes worth not repeating, both made here first: rounding the fitted key to a whole
octave (wrong for half the clips), and measuring the key inside the _metronome's_ note windows
rather than the aligned ones (the windows are 100–200 ms off, which mis-keyed three of six clips
and inflated clip-05's per-note residual to 255 ¢ against 62 ¢ two-pass). The estimator now runs
twice: rough key → align → re-measure the key in the aligned windows → re-align.

⚠️ The source dataset was also **pooling into the headline** — `context/` placement is
documentation, only the flags are mechanism — so it now carries `noteTruthDerived: true` with
the measurement above in its `note`.

### First real-audio evidence on the `very-high` provider question

The 2026-08-20 pass could only test `RECORDING_VERY_HIGH_CREPE` synthetically, because no real
clip reached the band. Five of these six do. Same clips, same aligned truth, adaptive routing:

|                               | shipping (basic-pitch) | `RECORDING_VERY_HIGH_CREPE=1` |
| ----------------------------- | ---------------------- | ----------------------------- |
| COnP@±100 ms                  | 0.41                   | **0.43**                      |
| COn (onset only)              | 0.50                   | **0.57**                      |
| COn recall                    | 0.56                   | **0.84**                      |
| onset bias / median           | 49 / 43 ms             | **22 / 2 ms**                 |
| missed /100                   | 14                     | **2**                         |
| split /100                    | 37                     | 102                           |
| spurious /100                 | 4                      | 14                            |
| **repair seconds /100 notes** | 2175                   | **639**                       |
| silence-onset recall          | 0.600                  | **0.840**                     |

CREPE-pitchdown finds almost everything (2 missed per 100 against 14) and places onsets
essentially unbiased (median **2 ms** against 43 ms), at the cost of splitting nearly every note
in two. By the harness's own user-effort metric that trade is strongly favourable —
**repair effort drops 3.4×** — because merging a split note is cheap and re-entering a missed one
is not. It also points the same way as the synthetic adaptive +0.016 from the 2026-08-20 pass,
which is worth something: two independent corpora, same direction.

**Not a gate.** Six clips of derived truth cannot decide a shipping flag; `sweep-segmenter` /
`sweep-voice` on the guard corpus is what can.

### Where whistling accuracy actually goes, and the next lever

With pitch repaired, the residual error is **segmentation, not pitch tracking**: `octErr 0.00`,
79 % exact pitch on matched pairs, but 87 estimated notes against 57 real ones and 37 splits per
100 on the shipping path (102 under CREPE-pitchdown). Whistled sustains get broken apart.

The knobs are `note-segmenter.ts`'s `changeCost` / `minNoteSec` / `attackFrameCost`, and the
right tool is `sweep-segmenter.ts` over the whole corpus with these datasets reported — not
tuned on. Note the mechanism while sweeping: whistling has no consonant, so a sustain's own
vibrato is the only thing crossing a semitone boundary, and the HMM was tuned where consonants
exist.

Also measured and rejected on the way: **per-take tuning normalisation does not help here.**
`voice-notation.ts`'s circular-mean offset (built for singing, gated on `profile.isVoice`, and
whistle takes resolve as `instrument` so they never get it) was simulated on these takes and
names the intended note 22/57 before and 22/57 after — a wash overall, negative on three of six
clips. The deviations from the nearest key are near-uniform, not clustered, so there is no
take-global offset to remove. Do not extend the voice spelling flag to whistling on the strength
of the singing result.

### The anti-splitting sweep: rejected globally, and the two whistle corpora disagree

`sweep-segmenter.ts` gained a `whistle` config group (`SWEEP_ONLY=whistle`) probing the four
knobs that could cause the splitting: `changeCost` (1.2/2/3), `minChangeSemitones` (1/1.5),
`sigmaStableSemitones` (0.3/0.5) and `minNoteSec` (0.15/0.2). Run over the whole corpus,
`EVAL_SPLIT=all`, paired bootstrap, n=1763 clips.

**Every config is worse corpus-wide** — Δ COnP −0.033 to −0.062, every CI excluding zero. None
of these can ship globally, and that is a firm answer rather than a weak one.

They do exactly what they were meant to do, though: splits fall from **28 per 100 reference
notes to 9–10**, and estimated repair effort improves 23 % (2689 → 2060 s/100). The COnP loss
comes from the other side of the same trade — merges rise 4 → 16–18. Anti-splitting works; it
just costs more than it buys on material that is not whistling.

**The interesting part is that the two whistle datasets point opposite ways:**

| config                    | `whistled-high-register-aligned` (dogfood) | `whistle-real` (Freesound) |
| ------------------------- | ------------------------------------------ | -------------------------- |
| LEGACY (shipping)         | 0.48                                       | **0.50**                   |
| whistle c1.2 / minChange1 | **0.72**                                   | 0.38                       |
| whistle sigmaStable0.5    | **0.72**                                   | 0.42                       |
| whistle minNote0.15       | **0.75**                                   | 0.34                       |

That is not noise, and the explanation is provenance. **`whistle-real`'s truth is the
`lib/sineTrack.ts` draft, which over-segments** (2.5 notes/s) — so a config that merges more
disagrees with it _by construction_, and the dataset cannot detect over-splitting because it
over-splits itself. This is gate 3 arriving exactly where the flag warned it would.
`whistled-high-register-aligned` has no such bias: its note COUNT comes from the prescribed
melody (57 notes, fixed), independent of any segmenter.

So for a question about splitting, the six-clip dogfood set is the _better_ instrument despite
being 20× smaller, and the 117-clip set is close to useless until it is verified. **Neither is
sufficient to ship a whistle-scoped segmenter setting**: 57 notes cannot carry it, and the
mechanism (profile-scoped `NoteSegmenterOptions`, which `PROFILE_BANDS` already supports) is
only worth building once there is verified truth to justify it.

The order of work is therefore fixed, and it is not more sweeping: **verify a subset by hand
first**, then re-ask this exact question. Until then the standing answer is that shipping's
segmentation is correct everywhere it has been measured on trustworthy truth.

### Open on this dataset

- **clip-03 needs an ear.** Per-note residual after the key fit is 184 ¢ (p90) against 24–64 ¢
  on the others, so either the performance wandered or the DTW mismatched notes there.
- **Nothing is verified.** The aligned truth is drafted from `lib/sineTrack.ts`;
  `fetch/import-note-labels.ts --verified-by=<name>` is what clears the flag.
- **The recording protocol should change.** For the next batch, whistle _freely_ rather than to
  a click and annotate what came out (`research/research-whistle-corpus.md` §6). A prescribed melody is
  still useful — it makes annotation far cheaper by fixing the note sequence — but it cannot be
  the truth on its own, and the key the performer chooses has to be recorded or recovered.

### The provider question, re-asked on ALL the new real audio (2026-08-22, follow-up)

The dogfood A/B above covered 6 clips; the 2026-08-20 corpora it left unmeasured are now
measured. `RECORDING_VERY_HIGH_CREPE=1` vs shipping, adaptive, `real` condition, paired
bootstrap per corpus:

| corpus                                                      | truth                            | n   | shipping → flag-on | Δ paired                                                             |
| ----------------------------------------------------------- | -------------------------------- | --- | ------------------ | -------------------------------------------------------------------- |
| tinysol `very-high` stratum (real Ircam timbre)             | **exact** (constructed phrasing) | 28  | 0.654 → **0.805**  | **+0.150 [+0.114, +0.185]\***                                        |
| tinysol `high` stratum (control — never routes basic-pitch) | exact                            | 36  | 0.924 → 0.924      | **+0.000 exactly, bit-identical**                                    |
| whistle-real (117 real whistling clips)                     | derived draft                    | 117 | 0.359 → **0.634**  | **+0.275 [+0.231, +0.323]\***                                        |
| whistled-high-register-aligned (dogfood)                    | derived, aligned                 | 6   | 0.409 → 0.433      | +0.024 [−0.052, +0.093]                                              |
| whistle-vintage (accompanied 78s)                           | derived                          | 6   | 0.02 → 0.02        | unchanged — routes mid/high; the accompaniment problem, not the band |

The whistle-real decomposition is the dogfood story without the split explosion: missed
55 → 22 per 100, precision 0.63 → 0.74, recall 0.31 → 0.60, splits only 7 → 10, octErr 0.00
both arms. On TinySOL the gain is register-wide and largest exactly where the band's weakness
was measured (pp 0.451 → 0.608, mf 0.752 → 0.906, ff 0.780 → 0.921), and dynamics no longer
gate detection.

Caveats, stated rather than waved at: whistle-real's draft labels come from `lib/sineTrack.ts`,
a trajectory tracker, so some affinity with a trajectory _provider_ is plausible — which is why
the exact-truth TinySOL +0.150 and the dogfood recall jump matter as corroboration from
independent truth chains; TinySOL's phrasing is spliced (`constructedPerformance`); nothing is
human-verified yet. Every corpus points the same way; the only counter-signal anywhere remains
synthetic heavy reverb (−0.03…−0.04, 2026-08-20 log).

**Deletion path this supports, in order of reversibility:** (1) flip the flag in production —
env-revertible routing change; (2) remove the `basic-pitch-inference` deployment and unset
`BASIC_PITCH_INFERENCE_URL` — `createModelBackend` then serves basic-pitch from the local
TF.js path, so even the registry's never-taken fallback stays functional with the sidecar
gone; (3) delete the code (`apps/inference-basic-pitch`, `BasicPitchProvider`, the registry
requirement, the parity gate, flatten the flag) — the irreversible step, gated on a
label-verification pass of the whistle corpora and a soak of (1)+(2).

---

## Findings log (2026-08-22, afternoon: basic-pitch removed)

The consolidation decision was taken: with the very-high band's replacement measured
parity-or-better on synthetic audio and decisively better on all the new real audio (the two
entries above), **basic-pitch is deleted from the repo** — provider, TF.js model, Python gRPC
service (`apps/inference-basic-pitch`), its k8s deployment/policies/CI image, the
`BASIC_PITCH_INFERENCE_URL` seam, the `@spotify/basic-pitch` dependency (its `NoteEventTime`
shape lives on as `pipeline/note-event.ts`), and the `RECORDING_VERY_HIGH_CREPE` flag, now
flattened to the only behaviour:

- the `very-high` band rides `crepe-tiny-down1` (octave-down CREPE, same checkpoint);
- `DEFAULT_PROFILE` is crepe-tiny at the trajectory ceiling (measured provider-immaterial:
  COnP ≈ 0.001 under every provider on the only clips that route there);
- the registry requires and falls back to crepe-tiny; `onsetThreshold`/`frameThreshold` and
  the R15 basic-pitch note-filter plumbing left `PipelineProfile`/`PitchTranscribeOptions`
  (the voice-decoder and note-segmenter option variants are untouched).

Consequences inside the harness: fixed-mode `EVAL_PROVIDER` now defaults to `crepe-tiny`
(with `crepe-tiny-down1` selectable); `check-inference-parity.ts` gates CREPE alone;
`bench-streaming.ts`'s microbench runs on crepe-tiny (the O(n²)→O(n) claim it documents is
provider-agnostic); `TrackCache` deliberately did NOT bump `CACHE_VERSION` — every existing
entry is a crepe low/mid/high routing for which the new resolver is byte-identical, and the
changed routes never produced entries (reasoning recorded at the constant).

One behavioural note beyond routing: the no-pitch fallback can now take the voice overlay
(it is a trajectory profile), where basic-pitch structurally could not. On the fallback's
measured traffic this is a no-op (nothing transcribes either way — the 0.001 row above); the
`sourceBelief`-vs-`isVoice` distinction it motivated stays, since the pitch-down band still
never routes voice.

What deployed infrastructure still needs (ops, outside the repo): delete the
`basic-pitch-inference` deployment/HPA from the live cluster and its images from the Artifact
Registry. The manifests, CI matrix and runbooks in-repo no longer reference them.

---

## Findings log (2026-08-22, evening: the very-high band becomes sweepable; the split lever measured)

Follow-through on the morning's two open leads (the dogfood split excess; nothing verified).

### Harness: `CrepePitchdownProvider.track()` + the cache opens to it

The very-high band was the one register no cached sweep could reach — `TrackCache` gated on
`instanceof CrepeProvider`, and the wrapper isn't one. It now exposes `track()` in the REAL
domain (cents +12 st, hop = 10 ms real; the same frames `transcribe` segments), the cache
duck-types on `track` instead, and `decodeCached.frameCount()` mirrors the wrapper's ×k
frame-count scaling so cached replays reproduce production exactly — verified: the `smooth8`
row equals SHIPPED to the last digit on all 103 very-high clips. `sweep-bands` gained
`SWEEP_INCLUDE` (opt a derived/constructed dataset back in BY NAME, for diagnosis — nothing it
names enters a pooled headline) and a `w.*` config family for this band's knobs. No
`CACHE_VERSION` bump: very-high entries are new, never stale.

### The smoother scaling (7e8de32): a wash, kept for consistency

Measured three ways (run-eval A/B against the pre-scaling build, then the cached sweep):
dogfood whistling +0.017* with splits 102 → 89/100; whistle-real −0.007 [−0.017, +0.001];
TinySOL both strata exactly 0.000; synthetic +0.002. The cached sweep brackets the optimum:
20 ms −0.005, 60 ms +0.007, **80 ms (ships) 0**, 120 ms −0.012*, 160 ms −0.023\*. A flat
60–80 ms plateau — the scaling stays because frame-count knobs should mean the same real time
on every provider, not because it buys accuracy. **It is not the split mechanism.**

### Every other semitone-path knob, on the very-high stratum (n = 103, cached)

- `pitchBinToleranceCents` 80/120: Δ exactly 0.000 — the tolerance never decides anything here.
- `vibratoMaxSec` 0.25 cleanup: −0.012\* — the A-B-A folder eats real whistled ornaments.
- `no-onsetSplit`: +0.006 n.s. — the splitter is roughly free on this band; keep it global.
- note floor: the one apparent winner, and it is a TRAP —

### The floor "+0.031\*" is draft-truth circularity, caught by the exact-truth control

Lowering the floor from 80 ms real gains +0.031* [+0.017, +0.049] on `whistle-real`'s
very-high clips — whose draft labels come from `lib/sineTrack.ts` with `minNoteSec: 0.06`:
the drafter's own floor convention. On the exact-truth TinySOL very-high stratum the same
change is **−0.002 [−0.005, +0.000]**, and raising it is null too (120 ms −0.009 n.s. there,
vs −0.082* pooled where whistle dominates). Read: the "gain" is our floor converging on the
draft's floor — the precise failure mode `noteTruthDerived` exists to keep out of tuning.
Do not touch the floor on this evidence.

### Where the split question lands

No semitone-path knob explains the dogfood 89–102 splits/100. And on THAT corpus the number
is only an upper bound: its truth is the prescribed melody DTW-aligned to the audio, so any
real re-articulation the performer added (and whistlers re-attack freely) is scored as a
split. Distinguishing "pipeline fragments sustains" from "the truth merges re-attacks" needs
human-verified labels — which is what
`annotations/whistle-real/VERIFY-WORKLIST.md` (30 stratified clips: the 4 mid/low routings,
6 possibly-processed titles, 20 random; ~40–60 min) now stages. The split investigation is
parked behind that pass, deliberately.

---

## Findings log (2026-09-01, overnight: benchmark infrastructure, the R21 correction, the profile lock)

Four things, in the order they mattered.

### The R21 reverb "fill" lead was a stale-cache artefact — closed

The 2026-08-19 R21 entry reported that filling 1–2-frame unvoiced dropouts buys +0.096*/+0.088*
(echoey-room / distant-mic) at fill 40 ms and up to +0.137*/+0.151* at 120 ms, and that a
reverberance-adaptive fill captures "most of the echoey-room oracle" — blocked from shipping only
by its −0.010…−0.016 cost on clean voice. That number was measured on `eval-cache-variant/`
entries at **version 1**, and every one of those entries stores a profile with
`confidenceThreshold: 0.5` — **no reverberance relief**. The variant cache header says why: it
asks to be built with `RECORDING_REVERB_CONF_RELIEF=0` so the relief itself can be measured, and
`CACHE_VERSION` only went to 2 at E3, _after_ R21. So R21's reverb rows scored a fill applied to a
pipeline that had already lost the relief the resolver ships: the fill was doing the relief's job.

Rebuilt tonight at v2 (the reverb variants now carry the shipped gate — median 0.25–0.35 on
echoey/distant), the same rows re-measured (`sweep-reverb.ts`, dev, annotated-vocalset +
vocadito, 209 clip pairs, vs `voice OFF`):

| row                          | real                         | echoey-room                  | distant-mic                  |
| ---------------------------- | ---------------------------- | ---------------------------- | ---------------------------- |
| fill20                       | −0.006\*                     | +0.012\* [+0.001, +0.023]    | +0.004 [−0.006, +0.014]      |
| fill40                       | −0.012\*                     | −0.009 [−0.024, +0.005]      | −0.003 [−0.014, +0.009]      |
| fill60 / 80 / 120            | −0.017* / −0.021* / −0.026\* | −0.020* / −0.019* / −0.020\* | −0.017* / −0.017* / −0.025\* |
| fillAd ×0.10 / ×0.15 / ×0.20 | −0.011* / −0.014* / −0.018\* | −0.027* / −0.031* / −0.031\* | −0.026* / −0.035* / −0.036\* |

With the relief in place there is nothing left for the fill to repair under reverb; the one
surviving cell (fill20 on echoey-room, +0.012 at the edge of significance) is not worth its clean
cost. **R21 is closed, and so is its follow-up** — "a reverberance feature that does not
false-fire on sustained clean singing" was ranked the highest accuracy-per-hour item in three
separate audits; it was a ghost. The reverb oracle gap (+0.14/+0.23) remains real and remains a
front-end problem (learned enhancement is the untested candidate; WPE and spectral subtraction are
measured dead).

Lesson for the caches, recorded where it will be read: a cache stores the RESOLVED PROFILE, so it
also stores whatever env the resolver was run under. The v1 variant cache was deliberately built
with `RECORDING_REVERB_CONF_RELIEF=0` for the 2026-07 relief study (its header asks for exactly
that) and never rebuilt; every later reverb sweep silently inherited a pre-relief pipeline as its
baseline. Both caches now record a signature of the resolver's env knobs in their metadata and
treat a mismatch as stale (`resolverEnvSignature`, `lib/trackCache.ts`), so an entry built under
an experiment flag can no longer masquerade as production.

### Energy-gated dropout fill — built, null, kept off

Hypothesis (the mechanism R21's clean cost invited): the 1–2-frame confidence holes on clean
voice are consonants and breaths, i.e. **energy dips**; a reverb puncture is a confidence collapse
over a **sustained** envelope. Gate the fill on the gap's energy and the fill should keep its
reverb repair and stop erasing legato boundary evidence. `PitchTrack.fillDropouts` gained
`energy` + `energyFloorRatio` (+ `energyContextFrames`); `VoiceDecodeOptions.fillEnergyFloor` /
`fillEnergyContextSec` plumb it.

- **Flank-referenced (context 0) is inert**: ratios 0.5 / 0.7 / 0.85 reproduce the unconditional
  fill to three decimals everywhere — the immediate flanks sit on the dip's shoulders, so the gap
  always reads "sustained" against them.
- **Context-referenced (peak within ±140 ms, the decoder's own evidence window) is a working
  gate**: on the clean VOICE slice (`sweep-voice.ts` r21e, dev, 476 clips) fill40/fill80 at ratio
  0.85 cost **−0.001** vs anchor (unconditional −0.013/−0.018); sweep-reverb's `real` rows read
  +0.000 [−0.004, +0.005].
- …and there is no reverb gain for it to protect (previous section): echoey-room −0.013…−0.032,
  distant-mic −0.002…−0.033, worse at lower ratios and longer fills.

Options stay in the code, defaulted off, with these numbers. Do not re-sweep.

### Harness defect: `pitchless` corpora were inside the VOICE slice

`sweep-voice.ts` and `sweep-segmenter.ts` excluded `noteTruthDerived`, `constructedPerformance`
and the external test half from their slices — but not `pitchless`. Since AVP and JaCRC were
adopted (2026-08-13), both sat in the VOICE mean with placeholder MIDI (COnP ≈ 0.01 each), so
every VOICE aggregate in the plugin-pass log is deflated (dev n 709 → 476 once removed; the r21e
anchor's Δ vs SHIPPED reads +0.093 with them and +0.137 without) and every paired Δ is
attenuated by roughly the same factor. **Per-dataset columns and the signs of every verdict are
unaffected**; magnitudes quoted for the VOICE mean between 2026-08-13 and 2026-09-01 are low by
~30 %. Fixed in both sweeps.

### Production: the profile lock no longer accepts a silent prefix

`RecordingPipeline.resolveProfile` locked whatever the resolver returned after 1.2 s of audio.
When those 1.2 s held no reliable pitch — breath, a late entry after the count-in, a spoken
word — that was the `default-wide` fallback: no register band, no reverberance relief, a
55–1900 Hz window that cannot see a whistle, for the whole take. The 2026-08-20 census found
this fallback on 188 real adverse clips plus every clip with an unscannable lead-in and measured
that **no provider transcribes anything through it** (COnP ≈ 0.001 under all three). Two changes:

1. The lock is **deferred while the scan is unvoiced**, up to `RECORDING_DETECT_MAX_WAIT_SEC`
   (8 s). Nothing is lost by waiting — there are no notes to emit before the first pitched
   audio — and the first voiced 1.2 s then decides the band.
2. A take that still locked the fallback (a lead-in longer than the budget) is **re-resolved on
   the final pass** over the whole audio; if a real band comes back the take is re-transcribed
   under it from the retained encoded stream and every measure is re-emitted (`rerouteFinal`).
   Cost: one extra full-take inference at stop, paid only where the alternative was an empty score.

Pinned by `test/recordings/recording-pipeline-profile-lock.test.ts`. Not measurable in
`run-eval` (which resolves over whole clips). It has since been measured with a silent lead-in
prepended (`probe-leadin.ts`): see "The profile lock, measured through the live pipeline with a
silent lead-in" below.

### Benchmark infrastructure

`benchmark.ts` + `benchmarks/` (README, committed `results/*.json`, generated `RESULTS.md`) make
the product benchmark one command with provenance and paired comparison; `lib/evalRun.ts` is the
scorer `run-eval.ts` and the benchmark now share; datasets declare a `material`
(`lib/realCorpus.ts`; mir-qbsh = humming, avp = vocal-percussion), so the benchmark reports
singing / humming / whistling / instrument separately and says plainly where no benchmark-grade
data exists (humming). `Metrics.f1Off` adds mir_eval's COnPOff (offset within max(50 ms, 20 %))
as the secondary, duration-aware, publication-comparable column.

**First recorded run** (`benchmarks/results/2026-09-01T23-32-44_2b83e00_baseline-2026-09-01.json`,
every real corpus, `real` + all adverse variants, 3,258 clip×conditions): overall COnP **0.739** /
COnPOff 0.464 over 21 benchmark-grade datasets — singing **0.586** (7 datasets, real + reverb tiers
pooled), instrument **0.815** (14); humming, whistling and vocal percussion have **no benchmark-grade
data** and are reported as such (context rows: mir-qbsh 0.39, whistle-real 0.63 on draft truth,
tinysol 0.81–0.93). Per condition: real 0.63, wind 0.65, street 0.64, echoey-room 0.30,
distant-mic 0.24. Not comparable to the log's earlier clean-only headlines (0.760/0.782 pooled
`real` over 18 datasets) — compare benchmark runs only with each other.

### The onset detector measured in isolation, on real human onsets (`bench-onset-detector.ts`)

Research direction 6 — AVP's 9,778 human-placed vocal-percussion onsets were fetched in
August and scored ~0.19 through `run-eval`, because that path only emits onsets where CREPE finds a
note and beatboxing has none. The new bench drives `OnsetDetector.detectFromEnvelope` over the
cached 10 ms envelope directly (all 280 AVP clips, all 175 JaCRC clips, COn at ±50 ms):

| corpus                                             | shipped (dip .5 / rise 1.8)                          | what the knobs do                                                                                                                                                                                                |
| -------------------------------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AVP (percussive, every truth onset is a re-attack) | **P 0.661 / R 0.644 / F1 0.651**, 34 onsets per clip | dip ratio is not binding (.35 −0.008*, .65/.8 ±0.000); rise 1.4 −0.029*, rise 2.5 +0.002 n.s.; minIoi and a 30 ms trough all ≤ −0.01. The aubio-style adaptive threshold (R3) scores **0.827 (+0.176\*)** here — |
| JaCRC (syllable onsets ⊂ note onsets; read recall) | P 0.336 / **R 0.519** / F1 0.390, 44 per clip        | — and **0.143 (−0.247\*)** here, firing 140 times per clip on sustained singing. Same structural reason R3 was killed on the pitched corpora: a plain novelty threshold has no dip requirement.                  |

Read: on genuinely percussive material the shipped detector finds about two onsets in three, and
the direction that would find more (an adaptive novelty threshold) is exactly the one that
destroys it on singing. The detector's constants remain the pitched-material optimum the
2026-08 sweeps found; this bench is now the regression guard for any future onset channel
(spectral flux, a learned onset head), and the isolated number the vocal-percussion row of the
product benchmark cannot provide — the product path finds no pitched notes there, which is the
honest product answer for beatboxing.

### The very-high ceiling, re-censused against the octave-down wrapper (~3 994 Hz)

`research/research-whistle-corpus.md` §4a retracted the "band ceiling" worry against the old
4 300 Hz basic-pitch window; the shipping wrapper hears to 2 × 1 900 = 3 994 Hz, and
`instrument-ranges.ts` still declares `whistle` to 4 300 Hz (harmless: the resolver clamps to the
provider ceiling). Over every whistle label the harness holds (129 clips, 3 083 draft notes):
**5 notes (0.16 %) sit above 3 994 Hz, all in one clip** (`freesound-849101`, top 4 699 Hz);
3 sit above 4 300 Hz. The p50 / p90 top pitch per clip is 1 865 / 2 637 Hz. `commons-glide`'s
~4.4 kHz is a glide peak, not a labelled note. The retraction stands under the new ceiling; no
`-2 oct` path is warranted (measured 2026-08-20: −0.008 vs −1 oct, no content needing the depth).

### The profile lock, measured through the live pipeline with a silent lead-in (`probe-leadin.ts`)

The change above is invisible to `run-eval` (which resolves over whole clips), so a new probe
drives the paced production `RecordingPipeline` with 3 s of mic-floor silence prepended to each
clip, `PROBE_MODE=legacy` (`RECORDING_DETECT_MAX_WAIT_SEC=0 RECORDING_FINAL_REROUTE=0`, the exact
pre-2026-09 behaviour) vs `new`. Truth is shifted by the lead-in. Two batches:

| corpus (clips)                       | legacy, no lead-in → with lead-in | new, no lead-in → with lead-in |
| ------------------------------------ | --------------------------------- | ------------------------------ |
| vocadito (6)                         | 0.584 → 0.582                     | 0.584 → 0.583                  |
| hust-solfege (6)                     | 0.616 → 0.623                     | 0.600 → 0.591                  |
| urmp-flute (4)                       | 0.763 → 0.773                     | 0.763 → 0.787                  |
| whistle-real (6, all ≤ 1.9 kHz)      | 0.471 → 0.468                     | 0.471 → 0.445                  |
| tinysol-flute (12)                   | 0.877 → 0.910                     | 0.877 → 0.914                  |
| tinysol-oboe (10)                    | 0.881 → 0.971                     | 0.881 → 0.947                  |
| **tinysol-violin (12, notes to E7)** | 0.812 → **0.784**                 | 0.812 → **0.883**              |
| TinySOL pooled (34)                  | 0.855 → 0.883                     | 0.855 → **0.913**              |

Read: (1) on mid-register singing the blind fallback was nearly harmless — `default-wide` plus the
voice-lead hint is close to the `mid` band, which is why the census never saw it as a loss there;
(2) where the fallback's 1 900 Hz ceiling bites — violin to E7, and any whistling above G6 — the
old lock lost the high notes (−0.028) and the new one gains them (+0.072, i.e. +0.099 paired
against legacy); (3) the deferral fired on every lead-in take (170 deferred passes) and the
final re-route never had to (0 — pitched audio always arrived inside the 8 s budget), and (4) the
no-lead-in rows are identical between modes, so the change is inert when a take starts on a
note. Small n, one lead-in length; the two whistle rows (−0.026 on 6 clips within the ceiling)
are inside this probe's noise, not a signal. The env kill-switches reproduce the old behaviour
without a deploy.

---

## Findings log (2026-09-02: completing the benchmark material groups — humming, whistling)

Asked for: verified whistling data and any humming data, under a looser licence bar
("defensible use — we redistribute nothing"). The standard is written up in `CORPORA.md`
("Licence standard"); the harness expresses it as `licenceRestricted` on `dataset.json`, a
flag the benchmark shows beside every number and that keeps such corpora out of the
benchmark tier for good.

### Whistling: still nothing verified exists — the human step is now targeted

Re-swept HuggingFace, Zenodo and the web, and re-checked MLEnd Hums and Whistles (6,000
hums and whistles, 235 people): still no licence stated anywhere, download behind a Kaggle
login we do not hold, and no reference melodies for its eight in-copyright songs — so even
with NC now acceptable there is no truth to align to. **No whistling corpus with verified
note labels exists**; the only route stays verifying our own 117 clips.
`fetch/triage-verify-worklist.ts` now adds a fourth section to
`annotations/whistle-real/VERIFY-WORKLIST.md`: the ten clips where the shipping pipeline and
the draft disagree most (COnP 0.00–0.38 in the baseline run) — a corrected label there moves a
number whichever side was wrong. The benchmark shows whistling as a _provisional_ row from
the draft-truth corpora until that pass happens.

### Humming: HumTrans adopted as restricted context, and its labels repaired

HumTrans (Liu et al., ICASSP 2024; `dadinghh2/HumTrans`, CC BY-NC 4.0) is the only hummed
audio in existence with note truth — 10 hummers, 500 melodies, 56 h, each segment paired with
the reference MIDI the hummer followed. Two things had kept it out: NC, and labels that are
the _reference's_ timing, not the performance's (Dynamic HumTrans, arXiv 2410.05455 §1.2;
four SOTA transcribers score F1 2.7–6.7 against them). The first is now a context-tier
`licenceRestricted` matter; the second is exactly the shape `fetch/align-prescribed-truth.ts`
was built to repair for our own dogfood whistling — identity from the score, onsets from the
audio.

`fetch/fetch-humtrans.ts` pulls the corpus's own **test split (769 segments)** out of the
14.7 GB archive by byte range (`lib/remoteZip.ts` against the signed CDN URL; ~0.9 GB
fetched), writes the reference-MIDI truth as `context/humtrans`, and the aligner produces
`context/humtrans-aligned`.

**The FFT-peak drafter is the wrong tool for a hum.** With `lib/sineTrack.ts` (built for
one-partial whistling) the alignment on the first 154 clips read transposition −1…−3 st on
half the clips and per-note residual p90 ≈ 300 ¢: the strongest spectral peak in a hum is
usually a harmonic, and the three-bin tonality gate throws most frames away. An independent
CREPE read of three clips showed the hummers at the reference key (per-note Δ median 0.0 st,
spread ±0.3–0.45 st), so the drafter, not the singers, was off. `lib/sineTrack.ts` gained
`trackYin` — a YIN cumulative-mean-normalised-difference tracker with parabolic refinement,
still nothing in common with the pipeline's CREPE decode — and the aligner a
`ALIGN_TRACKER=yin` switch plus an octave-invariant DTW cost (`ALIGN_OCTAVE_INVARIANT`).
Over the full 769 clips: transposition **0 st on 663**, ±1 on 93, ±2 on 6; key-fit
residual median −7 ¢ (p90 25 ¢); per-note residual p90 median 71 ¢ — amateur intonation,
consistent with the CREPE read; **18,903 of 19,955 notes aligned (94.7 %)**; runtime 1 s per
clip. The unaligned 5 % are notes the hummer skipped or the drafter missed; they are dropped
from the aligned truth rather than kept at reference timing.

Both datasets stay `noteTruthDerived` (prescribed identity, drafted timing) and in `context/`;
the aligned one drives the benchmark's **provisional humming row**. `mir-qbsh` is now flagged
`licenceRestricted` too (research-only terms). MTG-QBH's Zenodo record is CC-BY-4.0 and the
face-value rule makes it adoptable — but it carries no note truth, so it is recorded as an
annotatable-audio lead, not fetched.

Benchmark numbers for the new rows: see the next entry / `benchmarks/RESULTS.md`.

**Octave, not folded.** The first aligned pass folded octaves in the key fit as well as the DTW
cost (`ALIGN_OCTAVE_INVARIANT=1`, needed for the FFT drafter's harmonic hops). Scored, the
pipeline then read a **0.21 octave-error rate** on `humtrans-aligned` — which was the truth's
error, not the pipeline's: re-aligned with octave detection on, the per-hummer transpositions
are **0 st for every female hummer (F01–F05) and −12/−13 st for four of the five men** (M01,
M02, M04, M05; M03 hums at pitch). The reference melodies sit in a register the men take down
an octave, and the aligned truth now carries the octave they sang. With YIN reading the
fundamental, folding is unnecessary and wrong for humming; it stays available for the FFT
drafter. Aligned notes: 18,853 / 19,955.

### The provisional rows, measured (`benchmarks/results/2026-09-02T07-08-45_875820d_humming-whistling-provisional.json`)

Quick benchmark (`real` condition only, every corpus):

| material   | row             | COnP      | COnPOff | P / R       | repair s/100 | rests on                                                                           |
| ---------- | --------------- | --------- | ------- | ----------- | ------------ | ---------------------------------------------------------------------------------- |
| humming    | **provisional** | **0.517** | 0.172   | 0.59 / 0.48 | 286          | `humtrans-aligned` 0.49 (769 clips, 13.3k matched notes), `mir-qbsh` 0.55          |
| whistling  | **provisional** | **0.365** | 0.159   | 0.37 / 0.41 | 3572         | `whistle-real` 0.63, `whistle-vintage` 0.02, `whistled-high-register-aligned` 0.45 |
| singing    | benchmark       | 0.639     | 0.311   | 0.63 / 0.66 | 686          | 7 datasets                                                                         |
| instrument | benchmark       | 0.829     | 0.572   | 0.80 / 0.87 | 484          | 14 datasets                                                                        |

Three readings from the humming row, which did not exist yesterday:

- **The alignment is what makes the corpus usable at all.** Against the reference-MIDI timing
  (`humtrans`) the pipeline scores 0.07 — onset bias +152 ms mean / +174 ms median, i.e. the
  labels are simply in the wrong place, exactly as Dynamic HumTrans reported. Against the aligned
  truth: 0.49, octErr 0.00, onset bias +26 ms / +32 ms median, `missed` 1 per 100.
- **What is wrong on real amateur humming is pitch naming, not boundaries**: `pWrong` 13 per 100,
  `clean` 53 %, splits 6, merges 4, spurious 8; onset-class recall re-onset 0.42 / transition
  0.56 / silence-onset 0.74 (n = 16k). The pattern matches the singing corpora (pWrong is the
  largest bucket there too) with more of it — consistent with the per-note residual the aligner
  measured (p90 median 71 ¢: amateur hummers sit between semitones far more often than trained
  singers). A tuning-aware spelling layer already exists for voice takes at the notation stage;
  COnP against absolute truth cannot see it, by design.
- **This row is provisional and will stay so until a human-verified, permissively licensed hummed
  corpus exists.** HumTrans is CC BY-NC (internal evaluation only) and its onsets are drafted;
  mir-qbsh's notes are our own derivation. Treat the 0.52 as a tracking number for regressions on
  humming, not as a claim.

The whistling row (0.365) is dragged by `whistle-vintage` (accompanied 78s, 0.02 — the
accompaniment-locking failure) and would read ~0.54 on the two solo corpora alone; it stays
provisional on draft truth until the verification pass (`annotations/whistle-real/VERIFY-WORKLIST.md`).
Vocal percussion has no pitched truth and its row reads "no data" — its number is the isolated
onset-detector bench (F1 0.651).

## Findings log (2026-09-27: the realistic synthetic corpus)

A second synthetic tier, built by the standalone `synthetic-corpus/` project (its
README is the method record): every pitched app instrument (36 timbres) and eight voice
types, **rendered from real recordings** (92 sample sources in v1.1; VocalSet singers via
TD-PSOLA), performed by a performer model along the app's click, and recorded
through measured rooms, measured phone microphones, real noise and the browser's
Opus round trip. Truth is exact by construction and every clip passed an
independent-tracker label gate. Scored with `EVAL_SYNTH=1` / `benchmark.ts --synth`
(its own history: `benchmarks/results-synth/`, `RESULTS-SYNTH.md`). Its per-
instrument scores land within ~±0.1 of the real corpus's — realistic in difficulty,
not only in sound.

Baseline (v1.1, 463 clips): **studio 0.860, room 0.819, home-phone 0.798,
noisy-phone 0.717** COnP. Diagnosis tools: `inspect-synth.ts` (one clip, production
path vs truth), `stages-synth.ts` (onsets / provider raw / extractor deduced),
`analyze-synth.ts` + `synthetic-corpus/synthcorpus/census.py` (per-note census
joined with how each note was performed), `voice-exp.sh` / `inst-exp.sh` (A/B over
synthetic + real in parallel).

### The re-attack detector read vibrato in a room as re-articulation (shipped: per-family onset policy)

Mechanism, seen clip by clip with `stages-synth.ts`: the provider's raw note is ONE
correct held note; the `OnsetDetector` (dip to 0.5 × preceding peak, rise 1.8×) fires
every ~0.2 s inside it, and `splitAtOnsets` shatters it into a chain of 16ths. The
dips are physical: vibrato sweeps the partials through the room's modes, so the
reverberant sound is amplitude-modulated at the vibrato rate (−6…−9 dB). The real
corpus could not show it — URMP and most singing sets are near-anechoic — but real
annotated-vocalset already split 16/100 notes. The synthetic voices' own loudness
wobble is _below_ real singing's (2.3–3.4 dB vs 3.9–5.7 dB), so this is not a
rendering artefact.

Fix (`profile-resolver.ts` `applyOnsetPolicy`, constants in `pipeline-profile.ts`):
voice gets `onsetDipRatio` 0.35 (≈ −9 dB); sustained instruments get 0.35 on a dry
take, rising to the detector default 0.5 with the take's `estimateReverberance`;
struck/plucked instruments (`isStruckOrPluckedInstrument`: piano, guitar, bass…)
keep 0.5. Kill-switch `ONSET_POLICY=legacy`. Production path, paired over clips,
95 % CI:

| change                                                         | synthetic                                                   | real                                                                |
| -------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------- |
| voice 0.5 → 0.35                                               | **+0.068** [+0.059, +0.077]\* (dev +0.063\*, test +0.072\*) | singing **+0.009** [+0.007, +0.011]\* (dev +0.009\*, test +0.009\*) |
| voice 0.35 → 0.25                                              | +0.013\*                                                    | +0.001 (null; vocadito keeps sliding: 0.701 → 0.698 → 0.694)        |
| sustained instruments 0.5 → 0.35                               | **+0.006** [+0.003, +0.009]\*                               | URMP +0.005 [−0.001, +0.012]                                        |
| sustained instruments 0.5 → 0.35 ramped to 0.5 by reverberance | **+0.007** [+0.005, +0.009]\*                               | URMP +0.004 [−0.002, +0.011]                                        |
| plucked/struck 0.5 → 0.35                                      | −0.006\*                                                    | GuitarSet −0.008\* → excluded from the policy                       |

0.35 rather than 0.25 for voice: the synthetic voices sing vowels only, so they have
no consonant re-onsets to lose — their extra gain at 0.25 is partly a property of the
material, while real singing is flat there and vocadito (lyrics) declines.

**The reverberant guard.** The real corpus is near-anechoic, so the policy was
also run against the harness's own adverse rooms (`echoey-room` RT60 0.9 s,
`distant-mic` RT60 1.3 s wet-dominant) over every real dataset with trustworthy
note labels. Legacy (`ONSET_POLICY=legacy EXTRACTOR_COLLAPSE_COINCIDENT=0`) vs
the change, both conditions pooled:

| family                                        | n   | flat 0.35 for sustained                           | shipped (ramped)                              |
| --------------------------------------------- | --- | ------------------------------------------------- | --------------------------------------------- |
| singing (annotated-vocalset, vocadito)        | 880 | **+0.024** [+0.021, +0.027]\*                     | same (voice is not ramped)                    |
| sustained instruments (URMP)                  | 96  | −0.001 [−0.016, +0.012]                           | **+0.004** [+0.001, +0.007]\* over voice-only |
| plucked (GuitarSet; policy leaves them alone) | 100 | **+0.005** [+0.004, +0.007]\* (the collapse pass) | same                                          |

Flat 0.35 hid real damage inside that null mean. URMP horn "Für Elise" is eight
repeated E3s: in the echoey room the 0.5 detector finds 4 of the 7 re-attacks,
0.35 finds none (F1 0.86 → 0.40), and bassoon "Miserere", clarinet "Nocturne",
trombone "Slavonic" and tuba "Arioso" lost 0.08–0.14 the same way. A
tongued repeat leaves a short gap and a heavy room fills it, so the deep dip
that stops vibrato splitting starts merging real repeats. `stages-synth.ts` now
takes `STAGES_REAL=1` and degrades a real clip on the fly to show this. Ramping the
sustained ratio back towards 0.5 with the take's measured reverberance recovers
them (Elise 0.86 again, Miserere to within 0.02) while keeping part of the vibrato
gains (violin, viola, oboe; not trumpet's), and it does not cost the synthetic corpus anything (+0.001 over
flat, n.s.). On dry audio reverberance is ≈ 0, so the dry numbers are flat
0.35's. The collapse pass is neutral or positive on every one of these clips.

Voice is deliberately not ramped. Ramping it the same way costs synthetic voices
**−0.052** [−0.063, −0.041]\* and real singing in the two rooms **−0.020**
[−0.022, −0.018]\* (dev −0.023\*, test −0.018\*; vocadito +0.003, n.s.): a room
deepens sung vibrato's modulation, so the voice needs the deep dip most where the
room is worst. The same mechanism, opposite answers by material, which is what
`OnsetDetector.minTroughSec`'s doc comment predicted from the July reverb sweep.

**Product benchmark** (`benchmark.ts run --quick`, `pre-onset-policy` =
`ONSET_POLICY=legacy EXTRACTOR_COLLAPSE_COINCIDENT=0` vs `onset-policy`, both on
d77db1d, 1,098 benchmark-grade clips): **+0.007 [+0.005, +0.008]\***, singing
+0.007\*, instruments +0.000, headline 0.766 → 0.770. Significant per dataset:
annotated-vocalset +0.014, HUST +0.014, CSD +0.011, URMP cello +0.039 (n = 4);
GuitarSet **−0.004** and n20emv2 **−0.003**. The policy leaves plucked
instruments alone, so GuitarSet's loss is the collapse pass below (its fast runs
put two real notes on one slot; see the quantiser null further down, which wins
it back, +0.012). Synthetic (`benchmark.ts --synth`, v1.1 baseline → after):
studio +0.017\*, room +0.031\*, home-phone +0.034\*, noisy-phone +0.024\*,
singing +0.05…+0.10\*, instruments +0.01…+0.02\* in every condition.

### Two notes on one onset (shipped: `NoteExtractor.collapseCoincident`)

Two onset-split fragments a few tens of ms apart can snap to the same grid slot:
the deduced line then carries two notes at one instant — a chord in a single-voice
staff. A final pass keeps one note per slot (same pitch → one note spanning both;
different pitch → the longer). Synthetic voices **+0.012** [+0.010, +0.014]\*, real
singing **+0.0016** [+0.0010, +0.0023]\*, never negative per dataset.
Kill-switch `EXTRACTOR_COLLAPSE_COINCIDENT=0`.

### Two real notes on one slot (measured null, not shipped)

The other side of the collapse pass. `snapToGrid`'s preference for simple
positions pulls a slightly late sixteenth back onto the beat its predecessor
already holds. In a fast pedal-point figure (piccolo B5-D5-C6-D5-D6…, 92 bpm)
the provider's raw notes are all correct, yet D5 and C6 land on one slot and the
collapse keeps one of them. Letting the later note take the next grid slot was
tried in three forms, each A/B'd over the synthetic corpus (room + home-phone,
926 clips) and the real corpus (809 clips, URMP, GuitarSet, singing):

| variant                                         | synthetic                 | real                    |
| ----------------------------------------------- | ------------------------- | ----------------------- |
| push whenever onsets are ≥ ½ step apart         | −0.008 [−0.010, −0.006]\* | −0.001 (n.s.)           |
| … only into a slot the next note does not claim | −0.006 [−0.008, −0.004]\* | −0.001 (n.s.)           |
| … and only if the earlier note is ≥ ¾ step long | +0.001 [−0.000, +0.002]   | +0.001 [−0.000, +0.001] |

Most collisions are not two real notes. They are a held note's tail fragment
(cut off by `splitAtOnsets`) or a sung transition fragment against the next note.
Pushing the second note then shifts the rest of the run a sixteenth late
(clarinet −0.20 on one clip) or moves the real note off its beat (alto voice
G4→C5). The guarded version is a wash: 60 clips better, 84 worse. The one real
signal is GuitarSet, **+0.012 [+0.004, +0.023]\*** (dev +0.010, test +0.014\*), but
the synthetic plucked sets hardly change (2 of 60 clips), so it has no second
source. The lead is a joint quantiser (a DP over grid positions, not a greedy
snap), and GuitarSet is where to measure it.

### Findings about the material, not the pipeline

- **Free-tempo takes lose ~0.1 COnP to quantisation by themselves.** The first
  corpus version performed with phrase rubato and a random lead-in; the fixed-bpm
  16th grid anchored at t = 0 then moves notes by up to half a step. The corpus now
  plays along the click (whole-beat lead-in, jitter/drift/anticipation only). A
  free-tempo tier (`Performer.perform(tempo='free')`) is the natural test of any
  future tempo tracking.
- **Thirty-second notes cannot come back out** (the notation grid bottoms out at the
  16th); the planner excludes them.
- **Short sung notes are the voices' largest remaining error, and it is not the
  audio.** After the changes above, 9 % of synthetic sung notes come out at a
  wrong pitch, 138 of 174 of them shorter than 0.3 s (a quarter of all short
  sung notes): sixteenth runs in an air, read a semitone off. Yet the dry audio
  is on target: measured with SwiftF0 over the middle 60 % of each note, only
  1 % of synthetic short notes sit > 50 c off their label (real singing: vocadito
  12.5 %, HUST 17.6 %, n20emv2 17.8 %, CSD 29.6 %, part of that label error). So
  the voice decode misreads clean fast runs; the lead is the decode's note-change
  cost on short notes, to be measured on the real sets with fast notes (vocadito,
  n20emv2) before anything else. It is also a corpus finding: the synthetic
  voices sing fast notes too precisely (in-note spread 20 c vs 34–59 c real).
- Open: synthetic voices are vowel-only (no consonant re-onsets); no humming or
  whistling synthesis; bagpipe drones not yet mixed; euphonium rendered from tuba
  samples (no permissive euphonium recording exists).

## Correction (2026-10-31): every dagstuhl-choir number before 2026-10-30 is void

`fetch/fetch-dagstuhl.ts` sliced the Dagstuhl ChoirSet stems as 16-bit PCM, but they are 32-bit
float, so every `__real.wav` held half a window of float bytes under a PCM header (read an
octave low, unvoiced to pYIN). The fix (37f7ea02, 2026-10-30) makes `readWav` honour the fmt
chunk and convert to 16-bit; the re-fetch produced 94 clean excerpts (102 corrupt before).
**Every dagstuhl-choir number measured before 2026-10-30 was measured on that corrupt audio
and is void.** That covers the adoption measurement in the 2026-08 section above (COnP 0.01,
28 splits and 36 spurious per 100 notes, every clip resolved `NOISY` at ~0 dB SNR, beat-F1
0.03 in `notation-eval`, "a third of the reference pitches > 50 cents off") and every
dagstuhl-choir row in the benchmark results dated before 2026-10-30. The conclusions drawn
from those numbers are void with them: the over-segmentation "on bleed-laden legato choral
audio" and "the cause is the audio, not the alignment" described the decoding bug, not
the choir. The beat grids themselves were never affected (they come from the annotation
files, not the audio). Since 2026-10-31 the dataset's note truth is resynth (94/94 passed)
and it pools; measure it fresh before quoting any dagstuhl number.

## Findings log (2026-11-01: pipeline-accuracy pass — two measurement corrections, two ships)

Branch `pipeline-accuracy-2026-11`; plan, lane results and timeline in `meta/pipeline-accuracy-2026-11.md`.
Four implementation lanes (L1 whistling, L2 voice onsets, L3 reverb front end, L4 instrument cleanup) tuned their
hypotheses on the **dev** half in git worktrees, every knob built off. An integration step merged them, swapped in
the corpus corrections, re-ran every candidate on dev on the final harness, and gave each surviving candidate
**one** test look. Method throughout: `benchmark.ts run --cached` (the production decode replayed from the track
caches; model-path parity checked below), all five conditions, Δ COnP on the mean of dataset means, 95 % CI from
the paired bootstrap that resamples **performances** within each dataset (`compare`'s default since this pass, see
benchmarks/README.md "Statistics"). `*` = the interval excludes 0. Every A/B pair has equal `meta.corpus` truth
hashes unless it is a correction.

### Correction 1 (measurement, not the pipeline): the adverse tier was truncated and clipped

`lib/degrade.ts` ran `loudnorm` inside a `-filter_complex` graph, and loudnorm outputs 192 kHz. Two failures:

1. **Truncation.** Through `amix` the last ~2.5–2.9 s of the signal never reached the output (loudnorm's 3 s
   look-ahead; the noise inputs and the `-t` pin kept the file length exact, so no length check saw it). Reverb
   tails were digital silence (−55…−66 dB below the real take), wind/street tails the bare noise bed, 91 of 400
   annotated-vocalset variants entirely silent, 13–43 % of truth notes after the signal end. The 2026-07
   "degrade-real truncated 10–13 s clips" fix had pinned the length, not the content.
2. **Clipping.** `afir` convolved the 44.1 kHz IR at 192 kHz (+7–10 dB), and the s16 output hard-clipped 1.3–4.4 %
   of samples in 75–100 % of the reverb files.

**Every adverse-condition number since 2026-07 was measured on these files.** Fix `3444df59`
(`loudnorm=I=-16:TP=-3,aresample=<sampleRate>`, variant cache v4); all 1,452 adverse WAVs regenerated (604/604 dev
files byte-identical to an independently built mirror). Audits: tails within −0.6…+0.8 dB of the real take (0 files
below −15 dB), 1 of 1,452 files with > 10 clipped samples (72 samples), head lag 0; model path == cached path on
220 clip×conditions (9,387 notes). The broken originals are kept in `.cache/scratch/h0/broken-variants/`.

| scope | old (= HEAD d16420ef) | `h0-fixed` | Δ both splits | dev | test |
|---|---|---|---|---|---|
| ALL (27) | 0.638 | 0.672 | **+0.034\*** [+0.026, +0.041] | +0.032\* | +0.038\* |
| human truth (21) | 0.655 | 0.698 | **+0.043\*** [+0.034, +0.053] | +0.042\* | +0.047\* |
| singing / whistling / instrument | 0.582 / 0.601 / 0.687 | 0.589 / 0.601 / 0.746 | +0.007\* / 0 / +0.060\* | | |
| `real` condition (ALL / human) | 0.728 / 0.770 | identical | 0 of 1,561 clips differ | | |

Per condition: echoey 0.565 → 0.654 (+0.089\*), distant 0.474 → 0.524 (+0.050\*), wind 0.755 → 0.833 (+0.079\*),
street 0.751 → 0.825 (+0.073\*). Distant-mic singing barely moves (+0.005 n.s.): on the broken files the clipping
inflated `dipDepth`, which fired the reverb relief; on correct audio it does not (voice gate median under reverb
0.49/0.50, against 0.25–0.35 before).

**Prior conclusions that rest on the broken files**, with their status after this pass:

1. **The reverberance relief (`applyReverb`) and its `dipDepth` anchors** (2026-07 "+0.024 echoey / +0.043 distant"):
   void as evidence. On correct audio dipDepth does not separate rooms for voice or sustained instruments (AUC
   0.45–0.47; plucked 0.82). The relief fires on about half of all voice takes, room or not, and more under noise
   beds than in rooms. But it is **not inert**: switching it off (`RECORDING_REVERB_CONF_RELIEF=0`, per-env build)
   costs AVS −0.018\* (echoey −0.028\*, distant −0.027\*) and vocadito clean −0.009\*, because a lower gate on a
   random half of the takes still helps. Kept; removal is a follow-up.
2. **The sustained-instrument onset reverb ramp and its real-room guard** (2026-09-27): the guard is void, and on
   correct audio the ramp is inert (`SUSTAINED_ONSET_REVERB_RAMP=0`: URMP +0.001 n.s., 9 of 120 clip×conditions
   change). Its eval-synth numbers stand.
3. **R21 dropout fill and its 2026-09-01 closure**: the closure is void (it assumed a relief that fires on rooms).
   The question it called a ghost, a reverberance feature that does not false-fire, is answered below: CREPE's own
   median confidence (AUC 0.90/0.94 voice, 0.94/0.96 plucked, 0.65/0.72 sustained).
4. **The reverb oracle "+0.14 / +0.23" and the spectral-subtraction verdict** (`lib/dereverb.ts`): re-measure
   before citing them (fixed oracle: voice +0.123/+0.274, plucked +0.15/+0.21, sustained +0.08/+0.22). WPE stands;
   it was killed by mechanism tests before it reached the corpus.
5. **The 2026-08-20 fallback census** (188 `default-wide` AVS variants) and "the DEFAULT_PROFILE is
   provider-immaterial": void. 0 of 1,452 regenerated variants resolve to `default-wide`. The 2026-09-01
   profile-lock change stands; it was validated separately with `probe-leadin.ts`.
6. **The 2026-07 adverse accuracy row** (~0.55 / ~0.44): replaced by the table above.
7. **2026-07 reverb and noise dead ends**: "constant onset back-shift for reverb" stands on its clean cost. The
   noise-adapt / `afftdn` wind/street rows were diluted about 20 %; the sign plausibly holds (re-measure if
   revisited).
8. **"Under heavy reverb the voice decode is neutral"** (2026-08): re-measure on the regenerated tier.
9. **R15/R19 adverse legs**: the clean verdicts stand. R19's "reverb halves CREPE's confidence" is overstated (fixed:
   voice confMed 0.868 → 0.763/0.722).
10. **2026-08-20 per-band reverb strata** ("lowering the gate further costs"): contradicted on correct audio;
    lowering the voice gate under reverb gains (ADV-H2 below).
11. **The scripted synthetic matrix `fixtures/eval`** (run-eval, `generate.ts`) still carries the broken graph and
    was NOT regenerated. Its echoey/distant/wind/street/room-mic/noisy-phone rows, including the 2026-08-20
    very-high / basic-pitch reverb columns, are void until `generate.ts` is re-run. Production COnP on the same
    synthetic whistle clips: 0.553 broken against 0.858 re-rendered.
12. **Every recorded benchmark's adverse rows and pooled headlines** (RESULTS.md, the eval-app timeline) are low by
    the table above. A/B Δs between runs on the same broken files stay valid but are diluted 20–30 % on adverse rows.

Unaffected: the `real` condition, whistling (no variants), the capture-codec tier (single-input `-af` chain),
`fixtures/eval-synth` (pre-recorded through measured RIRs) and the intonation tier.

### Correction 2 (measurement, not the pipeline): four corpora were quantised on grids the product does not use

The product starts a take on beat 1 at the take's recording tempo. The benchmark quantised:
- GuitarSet windows that opened 0.25 s before a note, between clicks;
- Dagstuhl excerpts that opened a median 0.30 s before their first beat, at the median beat interval;
- every app take at a nominal 120 bpm, though 48 of 71 were recorded at 60–160.

Fixes: `fetch-guitarset.ts` snaps each window to a click beat; `fetch-dagstuhl.ts` cuts at the first annotated beat,
uses the mean tempo and rounds slices instead of flooring them; app-take truth carries the session tempo
(session.json, or the debug plot's barline spacing for the 42 Apr–Jun takes, which agrees on 25/25 takes that have
both; 2 takes keep 120). URMP's score MIDIs fit no constant grid (score-tempo p90 residual 503 ms; best constant
73 ms; 5/48 clips under 40 ms), so it stays at 120, flagged `nominalTempo: true`. Swapped in with L0b's
`swap-grid.sh` (backup and `--rollback` in `.cache/scratch/l0b/pre-swap/`). h0-fixed → `grid-fixed`, cached;
every other dataset Δ 0.000:

| dataset | Δ both splits | dev | test |
|---|---|---|---|
| guitarset-solo | **+0.017\*** [+0.003, +0.031] | +0.020\* | +0.014 |
| dagstuhl-choir | **+0.033\*** [+0.011, +0.054] (cut +0.008, mean tempo +0.025\*) | +0.011 | +0.040\* |
| app-takes-singing | **−0.027\*** [−0.050, −0.005] | −0.025 | −0.033\* |
| app-takes-whistling | **−0.034\*** [−0.058, −0.013] | −0.069\* | −0.018\* |
| ALL / human / whistling | −0.000 / +0.001\* / −0.011\* | | |

The app-take drop is the known seconds-COnP artefact of quantised output. The singers did follow the click (8th-grid
phase concentration R 0.54 at the session tempo against 0.15 at 120), and snapping humanly-jittered onsets to the
right but coarser grid moves them further than the wrong, finer one did. In beats the right tempo wins clearly
(notation-eval, bpm = truth: app singing beat F1 0.562 against 0.312 at 120; GuitarSet phase-locked beat F1
0.655 → 0.763). App-take capture latency against the click shows no consistent offset (median −4 / +5 ms), so
there is nothing to compensate. Hazard: `annotations/resynth/dagstuhl-choir/*` still describe the pre-cut
excerpts, so a resynth re-export of that dataset must re-apply the cut.

**The chain (same pipeline throughout):**

| scope | old HEAD | h0-fixed | **h1-final** (both corrections) | total Δ |
|---|---|---|---|---|
| ALL (27) | 0.6385 | 0.6721 | **0.6717** | +0.033\* [+0.025, +0.041] |
| human (21) | 0.6549 | 0.6981 | **0.6989** | +0.044\* [+0.034, +0.054] |
| singing | 0.5824 | 0.5895 | 0.5900 | +0.008\* |
| whistling | 0.6009 | 0.6009 | 0.5895 | −0.011\* |
| instrument | 0.6867 | 0.7464 | 0.7476 | +0.061\* |
| real only (ALL / human) | 0.7280 / 0.7700 | same | 0.7280 / 0.7713 | −0.000 |
| ALL dev / test | 0.6292 / 0.6425 | 0.6613 / 0.6802 | 0.6588 / 0.6803 | +0.030\* / +0.038\* |

`2026-11-01T14-03-50_dadfb29b_h1-final` is the baseline every pipeline Δ below is measured against. The eval-app
timeline is discontinuous at both corrections: the adverse rows of 16 datasets, and the four re-gridded datasets.

### Harness added this pass

- `compare` reports every row on the headline's arithmetic with the performance-cluster bootstrap. `--clip-ci`
  restores the old rows and `--cluster group` resamples performer groups. On the degrade correction the new
  interval is about twice as wide as the old clip × condition one.
- **Measured-RIR tier**: opt-in conditions `rir-near` (Arni, RT60 0.80 s, DRR −2.5 dB, ≈1.7 m) and `rir-far`
  (1.27 s, −10.8 dB, ≈2.9 m), never pooled, for vocadito, AVS, GuitarSet and the 13 URMP sets (1,076 variants,
  none clipped). Baseline after the swap, `2026-11-01T14-02-16_dadfb29b_grid-fixed-rir`: rir-near 0.698 against the
  modelled echoey 0.654; rir-far 0.516 against the modelled distant 0.524. OK5 is not wired (HDF5 only).
- Undeclared-source mode (`EVAL_UNDECLARED_SOURCE=1`, `EVAL_UNDECLARED_HINT=<id>|none`). Every cache build now
  awaits the YAMNet load, so no-hint runs are deterministic.

### Shipped: voice onset shift 0.05 s (SING-H1; kill-switch `VOICE_ONSET_SHIFT_SEC=0.07`)

`SHIPPING_VOICE_OPTS.onsetShiftSec` is now 0.05. The 70–100 ms calibration (2026-08) was fitted on unquantised
notes, where the ±100 ms window is hard. The product quantises to a 16th grid, which makes the window soft and
rewards centring the error; the decode is a median +20…+60 ms late. Shifts were compared only at equal phase mod
the 20 ms hop: 0.03 / 0.05 / 0.07 / 0.09 give singing +0.010 / **+0.016** / 0 / −0.045 (dev); off the 120 bpm
lattice (97 / 133 bpm) 0.05 is still +0.012.
- **Dev, final harness:** singing +0.016\* [+0.012, +0.021]. app-takes-singing at its session bpm +0.019\*; it was
  +0.035\* at 120, so the tempo correction halves it, as L2 predicted.
- **Test:** singing **+0.013\* [+0.009, +0.017]** (0.586 → 0.599), ALL +0.005\*, human +0.004\*, real-only +0.003\*.
  - Whistling and instruments exactly 0.
  - Voice by condition: echoey +0.022\*, distant +0.039\*, wind +0.030\*, street +0.036\*, real −0.005 (n.s.).
  - Human-timed sets +0.020\*. AVS real −0.044\* (its pYIN-segmented timing), with its reverb rows +0.008 /
    +0.034\*. esmuc −0.011\*. app-takes-singing +0.009 (n.s.).
- **Independent checks (dev):** realistic synthetic singing to the click +0.009 (n.s., COnPOff +0.022\*);
  jacrc-students human syllable-onset recall +0.108\*; AVP onset F1 +0.082\*; mir-qbsh +0.038\*.
- **Notation** (final harness, both splits): app-takes-singing beat F1 0.562 → 0.571, phase-locked 0.515 → 0.550,
  note values 0.451 → 0.461; dagstuhl 0.306 → 0.303, 0.134 unchanged, 0.375 → 0.366. Readability unchanged (0
  tuplets / sub-16ths / off-grid); distinct durations +0.1…+0.3 per clip on the singing sets.

### Shipped: same-pitch gap bridge for sustained instruments (INST-H4; kill-switch `EXTRACTOR_BRIDGE_GAP_SEC=0`)

`EXTRACTOR_BRIDGE_GAP_SEC` now defaults to 0.12 and `EXTRACTOR_BRIDGE_FRAGMENT_SEC` to 0.2. The bridge rejoins
consecutive same-MIDI raw notes across a gap of at most 120 ms, unless a detected onset lies within 30 ms of the
gap, and only when the shorter note is a fragment (< 0.2 s). It applies to sustained instruments on the at-pitch
provider only.
- The plan's any-length rule had the larger dev gain (+0.0098\*) but ate re-bowed repeats the detector misses
  (synthetic cello/contrabass re-onsets 39 → 35 of 85, repeats 212 → 185 of 450). The fragment limit, the shipped
  `mergeAdjacent`'s own condition, was chosen after that result, so the fresh check is the other 34 synthetic
  instruments: COnP +0.0010\*, re-onsets 95 → 96 of 312, repeats 1026 → 1022 of 2496.
- The onset veto carries the gain: without it, +0.0047 n.s. on URMP.
- **Dev, final harness:** instrument +0.0074\* [+0.0045, +0.0102]; every instrument condition positive; GuitarSet
  and singing note-identical.
- **Test:** instrument **+0.0046\* [+0.0030, +0.0062]** (0.759 → 0.764), at the ~+0.005 bar.
  - URMP +0.0050\*: bowed +0.014\*, woodwind +0.003, brass −0.001 (echoey × brass −0.007\*, 3 of 10 clip×conditions).
  - ALL +0.0026\*, human +0.0030\*. Singing and GuitarSet exactly 0.
  - URMP Yong re-onsets 124 → 123 of 190, same-pitch repeats ≤ 250 ms 403 → 399 of 510 (both n.s.).
  - At-pitch whistles pass the gate: test +0.002 (n.s.), dev +0.005\*.

### Built off after its test look

- **Confidence-relative voicing gate (ADV-H2, `RECORDING_CONF_RELATIVE_GATE=1`).**
  - Rule: gate = min(profile gate, max(0.20, 0.5 − 2·max(0, 0.85 − confMed))), where confMed is CREPE's median
    confidence over loud frames. It is skipped when the take's P95 100-ms level drop is ≥ 12 dB (a dry-take veto,
    added on dev after two dry, noisy app takes failed the clean guard). It is `min` with the shipped relief,
    never `replace`, which always cost clean takes.
  - Dev ALL +0.010\* [+0.005, +0.014]. Streaming: the 1.5 s frozen prefix keeps 89 % of it and `check-streaming`
    rows are identical; but through the real RecordingPipeline on 22 reverberant webm takes the paced gain is
    +0.005 against +0.020 instant, because the prefix-locked profile's relief already lowers many live gates.
  - **Test:** ALL **+0.0057\* [+0.005, +0.007]**, human +0.006\*, singing +0.008\*, instrument +0.005\*; voice
    echoey / distant +0.046\* / +0.063\*; every pooled `real` row ≥ −0.001 (AVS real +0.007\*).
  - **Measured-RIR tier, test:** ALL +0.012\* [+0.008, +0.016]; voice rir-near / rir-far +0.022\* / +0.071\*;
    sustained +0.007 / +0.006\*; plucked rir-far +0.016\*; **plucked rir-near −0.004 [−0.010, +0.002].**
  - The pre-registered rule required a positive sign in every condition × family cell of the measured rooms, so
    it does not ship. The failing cell is GuitarSet in the milder room and is not significant. **Owner call**:
    `envFlag('RECORDING_CONF_RELATIVE_GATE', true)` ships it; stacked on the shipped set it adds about +0.004 ALL
    on test.
  - **Hardened for the flip (review findings 3 and 4; still off).**
    - Silent and noise-only takes read as the wettest room: every frame is "loud" against its own peak, the level
      never drops, and CREPE hears noise at ~0.2, so the gate fell to 0.20. Through the real pipeline with the knob
      on, pink noise at −60 / −40 dBFS and a fan's room tone gave 1–10 junk notes (0 off; digital silence and a
      −90 dBFS muted mic gave 0 either way). `PitchTrack.reverbEvidence` now reads a take neutral when its peak is
      under −60 dBFS, under 10 % of its loud frames are pitched, or its level spans under 4 dB (dev: the quietest
      real take peaks at −50 dBFS, the least pitched has 24 %, the flattest spans 6.4 dB; noise 0–1 % and 1–3 dB).
      All five synthetic takes now give 0 notes, knob on or off. No benchmark clip × condition reads neutral, and
      the cached run is note-identical on 2,813 of 2,813, knob on and off, both splits.
    - The streaming drift check compared float gates exactly, so nearly every take the gate touched was rebuilt at
      stop. It now allows 0.02 (`_DRIFT_TOL`). Emulated on the cached dev tracks: the exact compare rebuilt 580 of
      1,372 takes, 0.02 rebuilds 501 with the same final COnP; 0.05 would rebuild 379 at −0.0003, and recording only
      the passes that committed notes 528 at −0.0003, because every rebuild also erases the streaming commit's own
      losses (see RecordingPipeline). `check-streaming` rows are identical.
- **Whistle family (WH-H1/H2/H3; `RECORDING_WHISTLE_DETECT=1 RECORDING_WHISTLE_PITCHDOWN=1 RECORDING_WHISTLE_ONSET=0.2`).**
  - Rule: a whistle hint, or YAMNet "Whistling" in the top 3 (ties count against), means the take is never voice,
    goes to the octave-down provider whatever its band, and gets a flat 0.2 re-attack dip.
  - Dev, final harness: whistling **+0.037\*** [+0.021, +0.056] (WR +0.036\*, APP +0.037\*, WHR +0.038\*).
  - **Test: −0.001 [−0.020, +0.017]** (WR −0.003: 16 clips up, 12 down, five losses ≥ 0.13; APP +0.002; 60 clips,
    MDE 0.026), so it **does not ship**.
  - Exactly 0 elsewhere on test: in the benchmark only the WR/APP note lists change, and profile identity on 2,658
    test profiles shows 0 non-family differences (one context false positive, a TinySOL viola top note).
  - Verdict recall at the production lock prefix is 0.77 on dev (target 0.8 missed; top 5 would give 0.80).
  - Product-faithful (undeclared source, test): whistling on a `voice-lead` score **+0.033\* [+0.006, +0.061]**
    (otherwise whistles take the voice decode, −0.042\* against the declared row); on a `piano` score +0.011 (n.s.).
  - The `off` dip (dev +0.047) fails the re-onset guard: room-mic repeats go 14 → 0 on exact-truth synthetic
    whistles.

### Built off at dev (no test look)

- **Instrument onset back-extension (ADV-H3, `RECORDING_INSTR_ONSET_BACKEXTEND=1`):** on top of ADV-H2, dev ALL
  +0.002\* and reverb rows +0.012; but on the re-cut GuitarSet, clean takes −0.004 [−0.011, +0.000] (2 of 25 takes,
  −0.022 / −0.077), below its ≥ −0.002 clean bar. It fires on 18 % of clean GuitarSet + URMP takes (the < 5 %
  target was missed).
- **Voice back-extension (`VOICE_ONSET_BACKEXTEND=0.15,0.15`):** singing +0.003\* on top of the 0.05 shift and
  +0.002 n.s. on top of the shift and ADV-H2. It fixes the same late onsets as the shift and stays under its
  +0.004 bar.
- **High-band pitch-down (WH-H2b, `RECORDING_HIGH_BAND_PITCHDOWN=1`):** reroutes 7 pooled dev clips; instrument
  ≈ +0.001 (TinySOL high strata +0.032\*, context). Null.
- **Whistle onset ramp (`RECORDING_WHISTLE_ONSET_RAMP=1`):** material 0.627 against 0.635 flat. Null.

### Interactions (dev, final harness)

- SING-H1 and ADV-H2 add up: the shift on top of the gate gives singing +0.015\* (alone +0.016\*); both together
  against base give ALL +0.015\* and voice echoey / distant +0.068\* / +0.095\*.
- INST-H4 on top of ADV-H2: instrument +0.0067\* (alone +0.0074\*). Its distant-mic part halves (+0.0068 against
  +0.0125), where both fill sub-gate gaps.
- ADV-H2 on top of the whistle family: +0.000 on whistling.
- INST-H4 on top of the whistle family: exactly 0, because the pitch-down family leaves the bridge's gate.

### The stacked test look and what ships

All four dev survivors at once (`int-stack-all4-test`): ALL **+0.012\*** [+0.009, +0.014], human +0.012\*
[+0.010, +0.015], singing +0.020\*, whistling −0.001, instrument +0.007\*, real only +0.005\* / human +0.004\*;
echoey +0.018\*, distant +0.031\*, wind +0.005\*, street +0.001.

**What ships (SING-H1 + INST-H4), test:** ALL **+0.008\* [+0.006, +0.010]** (0.680 → 0.688), human **+0.007\***
[+0.005, +0.009], singing +0.013\*, instrument +0.005\*, whistling +0.002 (n.s.), real only +0.005\* / human
+0.004\*. The plan expected ALL +0.012…+0.025: the shipped half lands under that range, and the full stack at its
floor.

### Model-path confirmation of what ships

- **The real model, no caches** (`benchmark.ts run --scratch`, 7 identical dataset shards per arm, all pooled
  datasets, all conditions, both splits). Before = every 2026-11 knob forced off; after = the new defaults.
  - Before is note-identical to the cached `h1-final` on 2,813 / 2,813 clip×conditions, and after to the cached
    shipped set on 2,813 / 2,813. So the model-path Δ is the cached Δ exactly.
  - Test: ALL +0.008\* [+0.006, +0.010], human +0.007\*, singing +0.013\*, instrument +0.005\*.
  - Both splits: ALL +0.009\* [+0.007, +0.011] (0.672 → 0.681), human +0.009\* (0.699 → 0.708), singing
    +0.015\*, instrument +0.006\*, whistling +0.003\*, real only +0.006\*.
- **Realistic synthetic corpus** (`--synth --scratch`, home-phone + room, exact truth, both splits, 926
  clip×conditions): ALL +0.002\* [+0.001, +0.004], singing +0.008\* [+0.001, +0.015] (home-phone +0.009, room
  +0.007; alto −0.008 n.s. is the only voice below 0), instrument +0.001\*; no dataset significantly negative.
- **`check-streaming.ts`** (the real RecordingPipeline, paced against whole-buffer): identical rows before and
  after.
- **`notation-eval.ts`**: see SING-H1 above. GuitarSet is unchanged.
- **Code checks**: tsc, eslint and `vitest run` (apps/api, 586 tests) are clean.

### Review fixes (after the ships; benchmark notes unchanged on 2,813 / 2,813)

A review of the pass found two medium issues; both are fixed. (ADV-H2's hardening is under ADV-H2 above.)

- **The bridge reached plucked takes in the app** (`12b97b36`). The gate read the score's instrument, but the web
  app sends no `sourceKind`: a guitar played into a voice-lead score was classified "instrument", got the sustained
  dip and so the bridge. Measured on that route (`EVAL_UNDECLARED_SOURCE=1`, hint voice-lead / none), bridge vs
  `GAP_SEC=0`: GuitarSet COnP +0.005 but COnPOff **−0.007\*** on dev (clean takes −0.011\*). Fix: YAMNet's analysis
  gains a `struckOrPlucked` verdict (strongest struck/plucked class vs strongest sustained-instrument class, the
  voice/instrument rule's abstain band; fixed in advance, not tuned). It applies only when nothing is declared and
  the score names no instrument; such a take then gets the struck/plucked onset family (default dip, no bridge).
  Kill-switch `RECORDING_PLUCKED_DETECT=0`. Against the kill-switch: GuitarSet COnP +0.000 / +0.002 n.s., COnPOff
  **+0.015\* / +0.017\*** (dev / test); synthetic plucked +0.006\* (COnPOff +0.015\*); false-positive cost URMP on a
  voice-lead score −0.002\* / +0.003. On a voice-lead score, gated GuitarSet now gives the declared `guitar` route's
  notes on every test clip. The verdict never overrules a score that names a sustained instrument: low brass and
  reeds are often heard as plucked (URMP tuba 11/15), so a guitar into a violin score still gets the bridge.
  Every declared profile is byte-identical (4,664 real, 2,315 synthetic). Also: `RECORDING_SOURCE_CLASSIFY` and
  `RECORDING_PLUCKED_DETECT` joined the cache signature; the bridge's onset veto is a binary search (`b113fc40`).
- **Streaming committed held notes short** (`bf471983`, pre-existing). A pass committed a note once its *written*
  end was 0.4 s behind the audio, and that end is floor-snapped and capped, so a still-sounding note was committed
  at a short length that later passes could never lengthen. Measured on 39 real dev clip×conditions through the
  real RecordingPipeline (paced webm vs whole-buffer, same profile): 37 notes committed while still sounding, 44
  shorter than whole-buffer (50.25 beats; URMP oboe held notes of 6 and 5.5 beats written as 2); COnPOff paced
  0.2221 vs whole 0.2291. Fix: commit only once the *performed* end is also 0.4 s behind. Still-sounding commits
  37 → 0, shorter-than-whole 44 → 18, COnPOff paced 0.2251. Cost: the 3.9 % of notes that are held appear later
  (median +1.0 s); no note appears earlier, the median time to screen goes 1.36 → 1.37 s. `check-streaming.ts`
  (`e0bb7de1`) now compares note lengths and has three held-note scenarios, all of which failed before the fix.

### After the pass: SING-H1's condition-masked loss, diagnosed; one ship (SDRY-1, existence floor)

**The finding.** The headline pools each dataset's conditions into one mean, and that hid two losses of the 0.05
shift. Per dataset × condition on test (SING-H1 vs `h1-final`): annotated-vocalset **real −0.044\*** (211
performances) beside its reverb rows +0.008 / +0.034\*; esmuc-choir **−0.011\***; hust −0.003; every other singing
set positive. AVS's pooled row was −0.001 (n.s.) on test and +0.0025 (n.s.) on dev. Read singing A/Bs per dataset ×
condition, not per dataset.

**Mechanism (dev; cached; sequential counterfactuals on the replayed decoder → floor → re-attack split → quantise →
collapse stages, a Python mirror validated exactly against the TypeScript on 8,760 clip × condition × shift rows).**
The 0.07 → 0.05 change splits into onset timing and one side effect:

| dev, 0.07 → 0.05 | total | timing only | existence floor (b1) | split + floor stages |
|---|---|---|---|---|
| annotated-vocalset real | −0.047\* | −0.047\* | −0.002 | +0.001 |
| annotated-vocalset echoey / distant | +0.014\* / +0.041\* | +0.021\* / +0.039\* | −0.008\* / +0.002 | ≤ 0.001 |
| esmuc-choir | −0.012\* | **+0.012\*** | **−0.026\*** | +0.002 |
| hust-solfege | −0.004 | +0.003 | −0.008\* | +0.001 |
| app-takes-singing / dagstuhl / n20emv2 | +0.019\* / +0.013 / +0.022\* | +0.031\* / +0.024\* / +0.027\* | −0.012\* / −0.010 / −0.008\* | ≤ 0.003 |
| vocadito real / echoey / distant | +0.033\* / +0.036\* / +0.044\* | +0.031\* / +0.043\* / +0.049\* | +0.002 / −0.007\* / −0.005\* | ≤ 0.001 |

- **The existence floor.** The decoder drops a run when `end − start < hop` *after* the shift. With `minNoteSec`
  0.08 (4 frames at the 20 ms hop), 0.07 dropped every 4-frame run (0.01 s left) and 0.05 keeps it (0.03 s): the
  shift silently lowered the minimum note from 100 to 80 ms. That admitted 2,784 extra raw notes on dev (all
  exactly 30 ms), 1,046 of them on esmuc (7.7 per take: +7.1 written notes for +0.16 matches). Against the other
  dev singers' parts of the same take, 35–40 % sit on a pitch only another singer is singing (22–23 % for every
  other raw note) and 5–6 % on the singer's own (59–60 %): choir bleed (the two independent counts differ by
  attribution rule: note midpoint vs overlap). **esmuc's paradox** (onsets closer, COnP lower) is
  this: its timing gained +0.012\*; the "within ±100 ms" share only counts notes with a same-pitch truth nearby,
  which the 30 ms notes mostly lack. The esmuc/hust sawtooth in the shift sweep (0.06 below 0.05 and 0.07), part of
  what the 2026-11 sweep read as a hop-lattice staircase, is the same floor: with existence fixed, both peak at 0.05.
- **AVS real is its truth's onset convention, not the pipeline.** Its fetcher keeps only the pYIN "Sound" rows of
  rows typed Rest / Sound / Transition. 86 % of AVS notes follow a Transition (median 93 ms; the Sound row starts one
  or two pYIN hops after it, 116 ms after the Transition starts), so the truth onset is where the glide has *ended*. Raw decoder onsets at 0.05 sit −52 ms against legato notes and +15 ms against
  notes after a rest (the other sets: +10…+30). Re-timing each legato truth onset to its Transition's midpoint (a
  diagnostic only) moves AVS clean's optimum from 0.09 to 0.05, like every human-annotated set (COnP 0.538 →
  0.657), and its reverb rows to 0.03, like vocadito's. Every VocalSet technique and exercise prefers 0.07–0.10 on
  the shipped truth, and neither the decoder's pitch-arrival lag nor its legato/from-silence entry separates AVS
  from the other sets. No inference-time signal sees an annotation rule, so **no onset rule was built for AVS**.

**Shipped: the existence floor decoupled from the onset shift (SDRY-1; kill-switch
`VOICE_ONSET_EXISTENCE_SHIFT_SEC=0.05`).** `SHIPPING_VOICE_OPTS.existenceShiftSec` = 0.07: existence is judged at
the old calibration, onsets are reported at 0.05. One pre-registered rule, the previous value, nothing tuned.
- Dev vs HEAD: singing **+0.0076\*** [+0.0057, +0.0094]; performer-grouped two-fold +0.0065\* / +0.0087\*; esmuc
  +0.027\*, AVS real +0.002\*; no singing cell significantly negative.
- **The one test look:** singing **+0.0079\* [+0.0067, +0.0091]** (0.599 → 0.607), ALL +0.0031\* [+0.0027, +0.0037],
  human +0.0026\* [+0.0022, +0.0031], real-only singing +0.0072\*; esmuc +0.025\*, AVS real +0.002\* (the loss vs
  `h1-final` −0.044 → −0.042), AVS echoey / distant +0.009\* / +0.007\*, app +0.015\*, hust +0.005\*; lowest cells
  vocadito distant −0.002 and clean −0.001 (n.s.). Whistling and instruments exactly 0. Every bar met.
- Knob off note-identical to HEAD on 2,813 / 2,813; the flipped default note-identical to the knob-on runs on
  2,813 / 2,813, and the kill-switch to HEAD on 2,813 / 2,813. `check-streaming` rows identical.
- Context (dev): humming (mir-qbsh) COnP +0.002; syllable onset recall (jacrc-students) −0.037\* and AVP onset F1
  −0.029\*, about a third of what SING-H1 bought there (some 80 ms runs are real, unpitched events).
- Realistic synthetic singing, exact truth, the real model (`--synth --scratch`, home-phone, 81 clips, against the
  kill-switch): singing +0.006\* [+0.002, +0.010]; bass +0.009\*, alto / mezzo +0.015 / +0.014 (n.s.); no voice
  significantly negative (soprano −0.001).
- Write-up: the pass orchestrator's scratchpad `diag/sing-h1-dry.md`.

### The written score re-phases some sung takes (found through the timeline, 2026-11-01)

The timeline scores the written score (the MusicXML round trip); the benchmark scores the extracted notes. On
vocadito SING-H1 gave +0.033\* in the benchmark but +0.004 n.s. (ρ 0.43) on the timeline: 19 of 20 clips gain, and
vocadito_11 falls 0.657 → 0.133 because its whole written take moved −0.25 s (half a beat at 120 bpm), every pitch
right. The extracted notes are correct (1.25 / 1.75 / 2.25 s); the shift is `TakeSpelling.estimateGridPhaseBeats`
(voice-notation.ts, from 0b217b4f): a sung take whose onsets mostly sit on one off-beat phase is written back on
the beat when that at least halves its notation cost. SING-H1's 20 ms moved this take across that threshold.
Replayed from the whole-take notes at 5302a5bb it fires on 10 of 382 timeline clips (VocalSet 3/40, whistle-real
3/40, app-takes-singing 1/17, vocadito 1/20, n20emv2-test 1/9), and each one scores 0.04–0.78 below the
benchmark in seconds. The estimator was built for takes sung against the app's click (a uniform 100–150 ms vocal
lag); most corpora have a nominal 120 bpm and no click, so there the shift has nothing to correct. Seconds-COnP
cannot judge it either way (the truth keeps the lag); it is a notation decision. **Owner call:** re-phase only
takes recorded with the metronome on (the pipeline does not receive that today), and/or score the timeline
phase-locked for nominal-tempo datasets. Nothing changed.

### Open after this pass

- **Owner calls:**
  - ship ADV-H2 despite its one n.s. negative RIR cell;
  - the whistle family for the undeclared voice-score case only (a new hypothesis: DETECT alone);
  - the app-take tempo correction, which lowers the reported whistling material (−0.011\*) because seconds-COnP
    punishes correct quantisation at slow tempi.
- The dipDepth relief is blind but not inert; replacing its trigger with confMed is ADV-H2 itself. Removing the
  inert sustained ramp is a clean-up.
- `fixtures/eval` (scripted synthetic) must be regenerated (`generate.ts`) before any run-eval adverse row is quoted
  again.
- OK5 / DEMAND would add room and noise diversity to the measured tier (needs an HDF5 reader).
- AVS clean stays −0.042 against `h1-final`: its truth's onset convention (pitch arrival after each Transition).
  Scoring AVS against Transition-midpoint onsets is a corpus question (a correction, not a pipeline change).
- Every reverberant singing row (AVS and vocadito echoey / distant) peaks at a 0.03 shift, the clean rows at 0.05:
  a reverb-conditional onset shift keyed on ADV-H2's confMed evidence is an untested lead.
