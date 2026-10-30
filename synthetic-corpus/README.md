# synthetic-corpus — realistic synthetic evaluation audio

A standalone project (Python 3.11, `uv`) that builds **realistic synthetic
recordings with exact note truth** for every instrument the app offers and for
eight voice types, then exports them into the API's eval harness
(`apps/api/scripts/fixtures/eval-synth/`, scored with `EVAL_SYNTH=1`).

It replaces nothing: the old toy corpus (`scripts/eval/generate.ts`,
fluidsynth + FluidR3 GM soundfont, additive voice synthesis, four fixed melodies)
is untouched and still available. This corpus shares no code or method with it.

```
cd synthetic-corpus
uv sync                                                          # deps (torch only for the realism check)
PYTHONPATH=. uv run python -m synthcorpus.build --target 9       # all instruments, ~9 clips per timbre
PYTHONPATH=. uv run python -m synthcorpus.build --voices all --per-voice 8
PYTHONPATH=. uv run python -m synthcorpus.record                 # studio / room / home-phone / noisy-phone takes
PYTHONPATH=. uv run python -m synthcorpus.realism                # perceptual-proxy check vs real recordings
PYTHONPATH=. uv run python -m synthcorpus.export                 # → apps/api/scripts/fixtures/eval-synth (hard links)
cd ../apps/api && EVAL_SYNTH=1 EVAL_ADAPTIVE=1 pnpm exec tsx scripts/eval/run-eval.ts
```

Assets (`assets/`, ~10 GB), renders (`out/`) and scratch (`work/`) are gitignored;
every asset has a fetcher under `synthcorpus/fetch/` (or `assets/apple/packs.txt`).

## Why it sounds real: the method

**No oscillators.** Every sounding grain is a real recording of the named
instrument or a real singer; what we synthesise is the _performance_ and the
_recording_, the two things a sample player or a toy synth gets wrong.

1. **Real melodies** (`melody.py`) — 21k phrases cut from public-domain scores in
   the music21 corpus (Ryan's Mammoth 1883, O'Neill's 1850, Aird's airs, Bach
   chorales, Palestrina, Monteverdi, Haydn/Mozart/Beethoven quartet parts,
   Corelli, Handel…), with their slurs, staccatos, accents, fermatas and metre.
   Each timbre draws the styles and score parts idiomatic to it (bass lines for
   tuba/cello/bass voices, fiddle tunes for whistle/violin, chorale soprano lines
   for sopranos…), transposed into its comfortable range, at a playable tempo.
   Excluded on licence grounds: Essen (non-commercial), The Session (LLM ban).
2. **A performer** (`performance.py`) — phrase-arch rubato and a final ritardando,
   correlated timing drift plus jitter (three skill levels), articulation from
   the score (slurs → legato, staccato floor 100 ms, detached gaps), phrase-arch
   and metrical dynamics with pitch-height correlation, intonation error for
   non-fixed-pitch instruments (capped ±35 cents so the intended note stays
   unambiguous), slides for erhu/shakuhachi/trombone (≤ ¼ of the note),
   breathing for winds/brass/voice (at rests, or stolen from a note when a
   phrase outlasts the breath).
3. **An expressive sampler** (`sampler.py`) over real sample libraries —
   legato joins enter the next sample past its attack and equal-power crossfade
   (≤ 20 % of the shorter note); detached notes use real attacks (staccato takes
   where the library has them; slow-speaking samples are entered part-way in
   fast passages); round-robin, and a neighbouring-semitone take when a library
   has none, so repeats never replay identical audio; dynamics pick the velocity
   layer, continued by gain + brightness tilt and within-note swells; held notes
   wander ±~1 dB; vibrato added only to explicitly non-vibrato takes; sustains
   extended by period-aligned crossfade loops; a monophonic choke stops the old
   note when the next starts; real inhales (cut from VocalSet) before wind phrases.
   Every zone's pitch is **measured** (SwiftF0) and unstable zones are dropped —
   library metadata was wrong surprisingly often (octave-shifted SFZ maps, an EXS
   bansuri 11 semitones off, flat shakuhachi takes).
4. **Real singers** (`voice.py`) — VocalSet (CC-BY-4.0): 20 professional singers'
   scales, arpeggios and long tones on five vowels, cut into ~28k note units with
   pitch marks. TD-PSOLA re-places their glottal periods along a designed f0
   contour: Saitou-style preparation/overshoot transitions, that singer's own
   measured vibrato rate/extent (straight / light / operatic styles), onset
   scoops, release falls, drift and jitter, re-articulation dips on repeated
   notes, real breaths between phrases. Formants stay the singer's; a small
   vocal-tract scaling separates soprano/alto and bass/baritone registers, and
   produces the (flagged, derived) child voice.
5. **A recording** (`acoustics.py`, `record.py`) — measured room impulse
   responses (Aachen AIR, dEchorate, Motus, …), measured smartphone microphone
   responses (POLIPHONE: iPhone 12 mini/13/XS Max, Moto, Xiaomi…), real
   ambient noise beds at drawn SNRs, mic self-noise (never digital silence),
   capture level, occasional AGC pumping, and the browser's MediaRecorder
   WebM/Opus round trip. Conditions: `studio`, `room`, `home-phone`,
   `noisy-phone` (+ the `dry` render as reference).

## Quality perimeter

A clip enters the corpus only if it passes all gates (`qa.py`, applied in `build.py`):

| gate             | rule                                                                                                                                                                 |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| provenance       | every note rendered from a real recording of that instrument/voice (by construction)                                                                                 |
| label fidelity   | an independent tracker (SwiftF0, with pYIN as second opinion — neither is the app's CREPE) confirms ≥ 95 % of verifiable notes within ±50 cents, **0** octave errors |
| no phantom notes | < 0.5 s of confident pitched sound outside the labelled notes (a release tail at the previous note's pitch is allowed)                                               |
| verifiability    | ≤ 10 % of notes shorter than 100 ms that the tracker cannot judge                                                                                                    |
| artefacts        | no clipping (clicks and DC are logged)                                                                                                                               |

Rejected clips are logged in `out/rejects.jsonl` (audio in `out/_rejects/`) and
replaced by a different phrase. Perceptual realism, which no gate can prove
without listeners, is **measured** against real recordings — see _Results_.

## Sources

| source                                             | licence                                                                              | used for                                                                                                   |
| -------------------------------------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| Apple GarageBand content packs                     | licensed on this Mac; royalty-free use in created audio; samples never redistributed | erhu, dizi/bansuri, shakuhachi, tin whistle, pan flute, recorder, orchestral winds/brass, Steinway, basses |
| University of Iowa MIS                             | free for any use                                                                     | strings, winds, brass, guitar (anechoic)                                                                   |
| VSCO-2 CE, VCSL, Karoryfer, sfzinstruments         | CC0 (MTG SoloSax CC-BY-4.0)                                                          | orchestra, recorders, harmonica, ocarina, saxes, bass guitar, cello, bagpipe, erhu                         |
| Philharmonia Orchestra samples                     | free; not for resale as samples                                                      | orchestra incl. contrabassoon, bass clarinet, cor anglais                                                  |
| Sonatina Symphonic Orchestra                       | CC Sampling+ 1.0                                                                     | brass/clarinet sections, alto flute, piccolo                                                               |
| FreePats                                           | CC0                                                                                  | bagpipe (chanter; drones not mixed), ocarina, recorder, classical guitar                                   |
| Salamander Grand Piano                             | CC-BY-3.0                                                                            | piano                                                                                                      |
| VocalSet                                           | CC-BY-4.0                                                                            | all voices, breaths                                                                                        |
| music21 corpus (PD works)                          | PD / as distributed                                                                  | melodies                                                                                                   |
| POLIPHONE, Aachen AIR, dEchorate, Motus, DEMAND, … | CC-BY-4.0 / MIT                                                                      | rooms, devices, noise                                                                                      |

Nothing here is redistributed or ships in the product; everything is internal evaluation data.

## Results

### Corpus (v1.1, 2026-09-27)

**463 clips** — 382 instrument clips over 36 timbres (8–12 clips each, 1–5 real
sample sources per timbre, 92 in all), which cover 47 of the app's 48 instrument
ids (the one left out, woodblock, is unpitched), + 81 sung clips over 8 voice
types (soprano, mezzo, alto, tenor, baritone, bass, countertenor, child*) from 20
real singers; each clip = a `dry` render +
`studio`, `room`, `home-phone`, `noisy-phone` recordings (2 315 WAVs, 48 kHz),
6–26 s long, 8–85 notes. *child = formant-scaled female singers (flagged
`derived_timbre`). Every clip passed the quality gate; rejects are logged.

### Realism (perceptual proxies, measured — no listeners overnight)

`synthcorpus/realism.py`: PANNs Cnn14 (AudioSet, CC-BY-4.0) on 4-s windows, the
new corpus's `room` takes vs REAL recordings of the same instrument (URMP,
TinySOL, GuitarSet; vocadito/N20EMv2/CSD/HUST for voice) vs the OLD toy corpus
(`room-mic`). _P(class)_ = the tagger's probability for the instrument's own
AudioSet class; _KAD_ = kernel distance to the real set (lower = closer;
real↔real split = the noise floor). Measured on corpus v1.1.

#### new `room` vs old `room-mic`

| timbre      | P(class) real | P(class) new | P(class) old | KAD new   | KAD old | real↔real floor | windows real/new/old |
| ----------- | ------------- | ------------ | ------------ | --------- | ------- | --------------- | -------------------- |
| violin      | 0.70          | **0.79**     | 0.86         | **16.69** | 29.03   | -1.28           | 36/67/6              |
| viola       | 0.60          | **0.58**     | —            | **13.01** | —       | -0.67           | 36/51/0              |
| cello       | 0.61          | **0.28**     | 0.61         | **74.45** | 55.53   | 8.38            | 24/69/6              |
| contrabass  | 0.63          | **0.49**     | —            | **64.44** | —       | 9.74            | 18/53/0              |
| flute       | 0.60          | **0.72**     | 0.35         | **9.61**  | 27.17   | -0.78           | 36/61/6              |
| oboe        | 0.18          | **0.25**     | 0.10         | **14.55** | 30.98   | 2.05            | 34/68/6              |
| clarinet    | 0.67          | **0.78**     | 0.03         | **7.34**  | 76.31   | -2.46           | 30/47/5              |
| alto-sax    | 0.25          | **0.17**     | —            | **19.70** | —       | 1.09            | 23/63/0              |
| tenor-sax   | 0.25          | **0.35**     | —            | **16.02** | —       | 1.09            | 23/80/0              |
| bassoon     | 0.32          | **0.19**     | 0.20         | **36.80** | 23.48   | 3.59            | 11/89/6              |
| trumpet     | 0.79          | **0.58**     | 0.90         | **46.98** | 48.86   | 0.84            | 24/72/6              |
| french-horn | 0.70          | **0.36**     | —            | **50.31** | —       | -1.14           | 24/69/0              |
| trombone    | 0.62          | **0.12**     | 0.55         | **36.45** | 41.56   | 1.41            | 24/81/6              |
| tuba        | 0.32          | **0.70**     | 0.61         | **39.34** | 15.18   | -1.82           | 18/80/6              |
| guitar      | 0.85          | **0.53**     | —            | **65.48** | —       | -0.36           | 180/57/0             |
| voice       | 0.19          | **0.21**     | 0.01         | **31.31** | 59.27   | -0.26           | 315/186/30           |

Reading it honestly:

- **Clearly better than the old corpus and on par with real recordings** for the
  woodwinds (flute, oboe, clarinet — clarinet KAD 8 vs 76), violin/viola, and the
  **voice** (tagged "singing" exactly as often as real singing corpora, 0.19 vs 0.19;
  the old additive voice: 0.01; KAD halved).
- **Weaker for low strings and brass**: cello, trombone, horn, bassoon score
  below the (only 4-clip, ensemble-part) URMP references. Ablations (legato,
  staccato use, dynamics, register, release) did not move this; the room was the
  one lever that mattered (clarinet 0.29 dry → 0.69 in a room), so every eval
  condition includes a room.
- 1-NN real-vs-synthetic separability is ~1.0 for BOTH the old and new corpora,
  even noise-matched: the embedding separates any two recording chains, so it is
  reported but not used as a gate.
- Listen: `out/_showcase/` (20 clips, AAC) — the realism bar is ultimately yours.

### How the app scores on it (baseline, before any app change)

`benchmark.ts run --synth` (production path, adaptive), COnP @ ±100 ms, the mean
over datasets (as in `RESULTS-SYNTH.md`):

| condition   | COnP  | COnPOff |
| ----------- | ----- | ------- |
| studio      | 0.860 | 0.589   |
| room        | 0.819 | 0.526   |
| home-phone  | 0.798 | 0.500   |
| noisy-phone | 0.717 | 0.428   |

Weakest datasets: alto flute and piccolo (0.65–0.66), the voices (0.68–0.77, and
they drop hardest from studio to room), bagpipe, brass section, violin.

**Error-profile realism** — the same pipeline on the synthetic `room` takes vs on
the matching REAL corpus (from the committed real benchmark): scores land within
~±0.1 of real for almost every instrument, i.e. the corpus is realistic in
_difficulty_, not only in sound. The outlier is splitting on vibrato instruments
(violin 27.5 vs 7.8 splits/100 notes, flute 20.5 vs 5.4): URMP is a near-anechoic
studio recording, and the corpus found why that matters (next section).

| instrument  | real COnP | real split / merged per 100 | synthetic v1.1 `room` COnP | synthetic split / merged |
| ----------- | --------- | --------------------------- | -------------------------- | ------------------------ |
| violin      | 0.88      | 7.8 / 3.2                   | 0.78                       | 27.5 / 3.0               |
| viola       | 0.81      | 7.6 / 0.0                   | 0.72                       | 11.0 / 9.2               |
| cello       | 0.56      | 24.5 / 0.0                  | 0.78                       | 11.5 / 8.6               |
| contrabass  | 0.70      | 25.5 / 0.0                  | 0.80                       | 5.5 / 7.2                |
| flute       | 0.78      | 5.4 / 3.0                   | 0.73                       | 20.5 / 3.6               |
| oboe        | 0.85      | 4.8 / 0.0                   | 0.80                       | 12.0 / 7.3               |
| clarinet    | 0.88      | 2.7 / 0.0                   | 0.84                       | 4.7 / 8.7                |
| alto sax    | 0.85      | 2.9 / 0.7                   | 0.91                       | 6.2 / 5.2                |
| bassoon     | 0.86      | 3.1 / 0.0                   | 0.84                       | 12.7 / 7.6               |
| trumpet     | 0.93      | 2.8 / 0.0                   | 0.86                       | 6.2 / 5.9                |
| french horn | 0.95      | 1.2 / 0.0                   | 0.88                       | 7.8 / 7.4                |
| trombone    | 0.90      | 1.7 / 0.9                   | 0.82                       | 17.7 / 6.6               |
| tuba        | 0.83      | 5.6 / 1.4                   | 0.93                       | 4.7 / 6.0                |
| guitar      | 0.82      | 1.7 / 6.3                   | 0.93                       | 1.6 / 2.1                |

### What the corpus changed in the app

Each change was found here and diagnosed clip by clip (`stages-synth.ts`). It was
then accepted only if the REAL corpus agreed: paired bootstrap over clips, dev and
test apart, including the harness's reverberant real conditions. Full record:
`apps/api/scripts/eval/FINDINGS.md` ("Findings log (2026-09-27…)").

1. **Vibrato in a room is not a re-attack.** The onset detector split held sung and
   sustained-instrument notes on the vibrato's room-induced amplitude modulation.
   Deeper dip for voice (0.35), and for sustained instruments 0.35 ramped back to
   0.5 by the take's reverberance, because a heavy room fills tongued repeats.
2. **One note per grid slot.** Split fragments snapping onto one slot became chords;
   they are now folded (`collapseCoincident`).

Measured null, not shipped: **giving the second of two colliding notes its own
slot.** The quantiser's coarse-grid prior pulls a late sixteenth back onto the beat its
predecessor holds, so the collapse above keeps only one of two correctly heard
notes (pedal-point figures: B5-D5-C6-D5…). Pushing the later note to the next slot
was tried in three forms; none helped the synthetic corpus and the real corpus was
flat, except GuitarSet (+0.012\*, no second source). Most collisions turned out to
be a held note's tail fragment, not two real notes. The lead left is a joint (DP)
quantiser; see FINDINGS.md, "Two real notes on one slot (measured null, not
shipped)".

Result on this corpus, `benchmark.ts compare` v1.1 baseline → after (COnP,
paired over the 463 clips, all CIs exclude zero; dev and test agree, room dev
+0.028*, test +0.035*). The cells are means over clips, not over datasets as in
the baseline table above and in `RESULTS-SYNTH.md`, which is why the noisy-phone
baseline reads 0.720 here and 0.717 there:

| condition   | all                        | singing                | instruments            |
| ----------- | -------------------------- | ---------------------- | ---------------------- |
| studio      | 0.860 → **0.877** (+0.017) | 0.813 → 0.860 (+0.046) | 0.870 → 0.881 (+0.011) |
| room        | 0.820 → **0.852** (+0.031) | 0.721 → 0.820 (+0.099) | 0.841 → 0.858 (+0.017) |
| home-phone  | 0.799 → **0.834** (+0.034) | 0.690 → 0.787 (+0.097) | 0.822 → 0.843 (+0.021) |
| noisy-phone | 0.720 → **0.743** (+0.024) | 0.663 → 0.738 (+0.075) | 0.732 → 0.745 (+0.013) |

Of the 180 dataset × condition cells, one declines significantly (harmonica on
home-phone, −0.010, n = 10), about what chance produces. Per-note census on the
`room` takes: notes right went from 74 % to 80 % (instruments) and 65 % to 76 %
(voices). Right-but-split notes fell from 10 % to 5 % and from 18 % to 6 %.
Merged repeats rose slightly, 4.7 % → 6.0 % for instruments, which is the
trade-off. Wrong pitch (9 % of sung notes) is now the voices' largest error.

On the REAL corpus (`benchmark.ts run --quick`, before → after, 1,098
benchmark-grade clips, paired): **+0.007 [+0.005, +0.008]\***, singing +0.007\*
(annotated-vocalset +0.014\*, HUST +0.014\*, CSD +0.011\*), instruments +0.000.
URMP is near-anechoic, so the room effect this corpus found barely shows there.
The reverberant real guard is in FINDINGS.md. Two small significant regressions:
GuitarSet −0.004\* (the collapse pass drops one of two real notes in fast runs)
and n20emv2 −0.003\*.

Known realism gap (v1.2 work, deferred; see _Status_ below): the synthetic voices
sing fast notes too precisely. Only 1 % of their notes under 0.25 s sit more than
50 cents off the label, against 12–30 % in real annotated singing (vocadito, HUST, n20emv2, CSD),
and their in-note pitch spread is 20 c against 34–59 c.

Caveat for reading per-timbre numbers: piccolo, one of the two weakest, renders
from a single sample source (Apple) whose recorded vibrato is deep. Its amplitude
modulation has a median of 7.3 dB, against 3.8–5.2 dB for the Philharmonia and Iowa
flutes and 3.7 dB on real URMP flute notes. So even the dry render splits mid-note
on that player's vibrato. With no real piccolo recording to check against, the app
is not tuned for it.

The other weak one, alto flute, keeps a source the v1.1 audit scored as unstable.
That audit (`work/sustain-audit.txt`, gitignored) scored the sustain stability of
all 88 sustained sample sources; higher is less stable (the v1.1 commit describes
SSO piccolo's 10.3 as "intrinsic 10 % dips"). v1.1 dropped SSO English horn (13.2,
the worst) and SSO piccolo (10.3) but kept SSO alto flute (12.6, the second worst),
next to Iowa alto flute (9.0). The keep was not recorded at the time. The
2026-10-30 close-out confirmed it: v1.1 is final (see _Status_), and dropping the
source would change the corpus under every committed v1.1 result and leave
alto flute on a single source. So read alto-flute numbers with that source in
mind. After the onset-policy change it is the weakest synthetic dataset on
noisy-phone (COnP 0.468 vs piccolo 0.473; at baseline 0.456 vs 0.450).

### Findings that changed the corpus (worth knowing when reading eval numbers)

- **Library metadata is unreliable** — every zone's pitch is measured; the
  fetchers fixed ~200 octave/semitone mislabels (VSCO file names an octave low,
  Karoryfer bass mapped an octave high, Philharmonia trombone f/ff an octave low,
  an Iowa viola batch with a wrong sample-rate header = 13.5 semitones flat, an
  EXS bansuri 11 semitones off). Three whole sources were dropped by the gate
  (Philharmonia alto sax: trill-like neighbour notes; SSO trumpet section: 150 c
  flat; Apple tuba: unvoiced low zones).
- **Speaking time**: breathy/bowed samples start with air/bow noise; a note is
  started early by its sample's speaking time so the TONE lands on the labelled
  onset (Philharmonia was otherwise +64 ms late, p90 +112 ms).
- **Timing model**: the app records from the count-in downbeat and quantises to
  the score tempo, so v1 performs **along the click** (whole-beat lead-in,
  steady tempo, human jitter/drift, ~12 ms anticipation). v0's free rubato put
  notes off the grid by up to half a sixteenth and cost ~0.1 COnP by itself —
  that is a product property (free-tempo takes), not a transcription error;
  `Performer.perform(tempo='free')` keeps the rubato mode for a future tier.
- **Voice envelope**: stretching a VocalSet unit slowed the singer's own
  amplitude contour into ~3 Hz pulsing that the app's onset detector read as
  re-articulations; v1 normalises grain loudness per period and adds irregular
  shimmer + vibrato-coupled AM instead.

## Status (2026-10-30)

**v1.1 is the final corpus of this effort.** It is what `fixtures/eval-synth`
holds (each `dataset.json` now records `"corpusVersion": "v1.1"`) and what the
results at the top of `benchmarks/results-synth/` were scored on (its `v0-corpus/`
and `v1-corpus/` folders hold the older corpora's runs). No re-export is planned.

Deferred (the v1.2 realism leads, none started):

- **Fast sung notes are too precise**: 1 % of synthetic notes under 0.25 s sit
  more than 50 cents off, against 12–30 % in real singing.
- **Voices are vowel-only**: no consonant re-onsets, so they cannot test those
  (FINDINGS: their extra gain at a 0.25 voice dip ratio is partly this).
- **No humming or whistling synthesis**: those materials have no synthetic tier.
- **Euphonium is rendered from tuba samples**: no permissive euphonium recording
  exists.
- **No free-tempo tier**: `Performer.perform(tempo='free')` exists, but no
  corpus has been built with it.
- **Bagpipe drones are not mixed in**: the chanter is rendered alone.

Open for Karel: the listening check of `out/_showcase/` (20 clips). Nothing
records that it happened, so the realism claims above rest on the measured
proxies alone (PANNs tagging, and the error profile against the real corpus).

Next: [`RESYNTH.md`](RESYNTH.md) describes `synthcorpus.resynth`, a new tool in
this package. It reuses this package's singer (`voice.py`) and sampler to give
**real** recordings note truth: it renders a synthetic copy of each one, iterates
until the copy matches, and reads the notes from the copy.
