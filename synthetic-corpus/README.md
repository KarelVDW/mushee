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

Assets (`assets/`, ~12 GB), renders (`out/`) and scratch (`work/`) are gitignored;
every asset has a fetcher under `synthcorpus/fetch/` (or `assets/apple/packs.txt`).

## Why it sounds real: the method

**No oscillators.** Every sounding grain is a real recording of the named
instrument or a real singer; what we synthesise is the *performance* and the
*recording*, the two things a sample player or a toy synth gets wrong.

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

| gate | rule |
| --- | --- |
| provenance | every note rendered from a real recording of that instrument/voice (by construction) |
| label fidelity | an independent tracker (SwiftF0, with pYIN as second opinion — neither is the app's CREPE) confirms ≥ 95 % of verifiable notes within ±50 cents, **0** octave errors |
| no phantom notes | < 0.5 s of confident pitched sound outside the labelled notes (a release tail at the previous note's pitch is allowed) |
| verifiability | ≤ 10 % of notes shorter than 100 ms that the tracker cannot judge |
| artefacts | no clipping (clicks and DC are logged) |

Rejected clips are logged in `out/rejects.jsonl` (audio in `out/_rejects/`) and
replaced by a different phrase. Perceptual realism, which no gate can prove
without listeners, is **measured** against real recordings — see *Results*.

## Sources

| source | licence | used for |
| --- | --- | --- |
| Apple GarageBand content packs | licensed on this Mac; royalty-free use in created audio; samples never redistributed | erhu, dizi/bansuri, shakuhachi, tin whistle, pan flute, recorder, orchestral winds/brass, Steinway, basses |
| University of Iowa MIS | free for any use | strings, winds, brass, guitar (anechoic) |
| VSCO-2 CE, VCSL, Karoryfer, sfzinstruments | CC0 (MTG SoloSax CC-BY-4.0) | orchestra, recorders, harmonica, ocarina, saxes, bass guitar, cello, bagpipe, erhu |
| Philharmonia Orchestra samples | free; not for resale as samples | orchestra incl. contrabassoon, bass clarinet, cor anglais |
| Sonatina Symphonic Orchestra | CC Sampling+ 1.0 | brass/clarinet sections, alto flute, piccolo |
| FreePats | CC0 | bagpipe (with drones), ocarina, recorder, classical guitar |
| Salamander Grand Piano | CC-BY-3.0 | piano |
| VocalSet | CC-BY-4.0 | all voices, breaths |
| music21 corpus (PD works) | PD / as distributed | melodies |
| POLIPHONE, Aachen AIR, dEchorate, Motus, DEMAND, … | CC-BY-4.0 / MIT | rooms, devices, noise |

Nothing here is redistributed or ships in the product; everything is internal evaluation data.

## Results

### Corpus (v1, 2026-09-27)

**463 clips** — 382 instrument clips over the 37 timbres that cover every app
instrument id (8–12 clips each, 1–5 real sample sources per timbre, 90 sources in
all) + 81 sung clips over 8 voice types (soprano, mezzo, alto, tenor, baritone,
bass, countertenor, child*) from 20 real singers; each clip = a `dry` render +
`studio`, `room`, `home-phone`, `noisy-phone` recordings (2 315 WAVs, 48 kHz),
6–26 s long, 8–85 notes. *child = formant-scaled female singers (flagged
`derived_timbre`). Every clip passed the quality gate; rejects are logged.

### Realism (perceptual proxies, measured — no listeners overnight)

`synthcorpus/realism.py`: PANNs Cnn14 (AudioSet, CC-BY-4.0) on 4-s windows, the
new corpus's `room` takes vs REAL recordings of the same instrument (URMP,
TinySOL, GuitarSet; vocadito/N20EMv2/CSD/HUST for voice) vs the OLD toy corpus
(`room-mic`). *P(class)* = the tagger's probability for the instrument's own
AudioSet class; *KAD* = kernel distance to the real set (lower = closer;
real↔real split = the noise floor). Measured on corpus v1.1.

#### new `room` vs old `room-mic`

| timbre | P(class) real | P(class) new | P(class) old | KAD new | KAD old | real↔real floor | windows real/new/old |
| --- | --- | --- | --- | --- | --- | --- | --- |
| violin | 0.70 | **0.79** | 0.86 | **16.69** | 29.03 | -1.28 | 36/67/6 |
| viola | 0.60 | **0.58** | — | **13.01** | — | -0.67 | 36/51/0 |
| cello | 0.61 | **0.28** | 0.61 | **74.45** | 55.53 | 8.38 | 24/69/6 |
| contrabass | 0.63 | **0.49** | — | **64.44** | — | 9.74 | 18/53/0 |
| flute | 0.60 | **0.72** | 0.35 | **9.61** | 27.17 | -0.78 | 36/61/6 |
| oboe | 0.18 | **0.25** | 0.10 | **14.55** | 30.98 | 2.05 | 34/68/6 |
| clarinet | 0.67 | **0.78** | 0.03 | **7.34** | 76.31 | -2.46 | 30/47/5 |
| alto-sax | 0.25 | **0.17** | — | **19.70** | — | 1.09 | 23/63/0 |
| tenor-sax | 0.25 | **0.35** | — | **16.02** | — | 1.09 | 23/80/0 |
| bassoon | 0.32 | **0.19** | 0.20 | **36.80** | 23.48 | 3.59 | 11/89/6 |
| trumpet | 0.79 | **0.58** | 0.90 | **46.98** | 48.86 | 0.84 | 24/72/6 |
| french-horn | 0.70 | **0.36** | — | **50.31** | — | -1.14 | 24/69/0 |
| trombone | 0.62 | **0.12** | 0.55 | **36.45** | 41.56 | 1.41 | 24/81/6 |
| tuba | 0.32 | **0.70** | 0.61 | **39.34** | 15.18 | -1.82 | 18/80/6 |
| guitar | 0.85 | **0.53** | — | **65.48** | — | -0.36 | 180/57/0 |
| voice | 0.19 | **0.21** | 0.01 | **31.31** | 59.27 | -0.26 | 315/186/30 |

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
