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

_(filled in by the overnight run — see below)_
