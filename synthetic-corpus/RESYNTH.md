# resynth — note truth for real recordings by iterative resynthesis

`synthcorpus.resynth` produces **note-level ground truth for real recordings that have none**
(whistling, humming, choir parts, jingju, in-app takes). It drafts a note list for the
original, renders a synthetic copy from exactly those notes, and measures where the copy
and the original differ. Agents revise the notes until an independent judge agent passes
the copy. The truth is then read **deterministically from the synthetic copy's note spec**:
the copy was rendered from those notes, so for the copy they are exact by construction.
Because the copy matches the original, they are also the original's notes.

Status: built 2026-10-30 on branch `test-data-2026-10`; plan and log in
`meta/test-data-2026-10.md`.

```
cd synthetic-corpus
PY=".venv/bin/python"                 # never `uv sync` (it would drop installed extras)
PYTHONPATH=. $PY -m synthcorpus.resynth status                     # progress per dataset
PYTHONPATH=. $PY -m synthcorpus.resynth list --dataset whistle-real [--status needs-work] [--json]
PYTHONPATH=. $PY -m synthcorpus.resynth init whistle-real --all    # analyse + draft + autofix + first render (--clips a,b | <ds>/<clip>; --force; --blind)
PYTHONPATH=. $PY -m synthcorpus.resynth show whistle-real/commons-donna       # notes + last judge feedback + latest report
PYTHONPATH=. $PY -m synthcorpus.resynth edit whistle-real/commons-donna --ops '[{"op":"set","id":"n12","midi":88}]'
PYTHONPATH=. $PY -m synthcorpus.resynth edit whistle-real/commons-donna --apply D2,D5   # the report's suggested ops
PYTHONPATH=. $PY -m synthcorpus.resynth autofix whistle-real/commons-donna [--pitch --onsets --gaps --phantoms --offsets]
PYTHONPATH=. $PY -m synthcorpus.resynth iterate whistle-real/commons-donna   # render (if stale) + compare + panels
PYTHONPATH=. $PY -m synthcorpus.resynth submit whistle-real/commons-donna    # generator done → awaiting-judge
PYTHONPATH=. $PY -m synthcorpus.resynth judge-view whistle-real/commons-donna
PYTHONPATH=. $PY -m synthcorpus.resynth verdict whistle-real/commons-donna --file verdict.json
PYTHONPATH=. $PY -m synthcorpus.resynth export --dataset whistle-real [--dry-run]   # or export <ds>/<clip>
PYTHONPATH=. $PY -m pytest tests -q                                  # unit + synthetic round trips (~8 s)
```

`render` and `compare` exist separately as well; `selftest` is a placeholder for the
perturbation self-test (phase 2), whose unit-level version is `tests/test_resynth.py`.

## Why this is trustworthy (and its limits)

- Nothing in the loop is the app's own pipeline: the original is analysed with SwiftF0, pYIN
  and (for whistling) a sinusoidal peak tracker, plus spectral-flux onsets. No CREPE and no
  `apps/api` code are involved, so the truth is not biased towards the system under test.
- The judge only sees the measured differences between two audio files, the plots and the
  note boxes. It never sees the generator's reasoning.
- **Calibration**: the same loop is run blind (no prior notes) on clips that have human
  truth (vocadito, which has two annotators, plus N20EMv2 and others). The agreement between
  resynth truth and human truth is compared with the human inter-annotator ceiling (vocadito
  A1 vs A2 = 0.760 COnP). See the "Calibration" section of `meta/test-data-2026-10.md`.
- Agents cannot listen. "Sounds alike" is operationalised as: the same pitch at the same time
  (frame-wise f0), the same onsets (articulation), the same voiced and silent spans, at
  matching loudness. These are the properties note truth encodes. Timbre is matched as well
  as the engine allows, but it is not part of the truth.
- **What the copy borrows from the original** is limited to what the truth does not encode
  (fast in-note pitch movement such as vibrato, the attack scoop, per-note level), so a wrong
  note structure cannot be hidden by the copy: a wrong `midi`, a held pitch step inside a
  note, a missing re-articulation or a misplaced onset all stay visible (see Rendering).
- Known blind spots: both trackers can agree on the wrong octave (seen on a URMP flute clip),
  and one tracker alone never counts as evidence; the judge has the spectrogram for both.

## Truth conventions (what a note is)

The harness truth schema is `{onsetSec, durSec, midi}` per note: monophonic, integer MIDI,
sounding pitch.

1. **A note** is one articulated event with one stable pitch target.
2. **Pitch**: the nearest semitone (A4 = 440 Hz) to the note's median pitch over its stable
   part, ignoring scoops, falls and vibrato. A note whose median sits within ±15 c of a
   semitone boundary gets the flag `uncertain-pitch`.
3. **Onset, attack from silence or a re-articulation**: the start of the audible attack
   (energy rise; for consonants, the start of voicing).
   **Onset, legato pitch change**: where the pitch *arrives* in the new note's ±50-cent band.
   This is the annotator convention measured in `apps/api/scripts/eval/FINDINGS.md`
   (annotators mark arrival; a decoder that marks departure is ~50 ms early).
4. **Offset**: the end of audible sound for detached notes; the next onset for legato.
5. **Not separate notes**: vibrato, scoops/falls shorter than ~120 ms, drift within a held
   note, breath noise, consonants, clicks, accompaniment and bleed from other singers.
6. **Separate notes**: a re-articulated repeat of the same pitch (energy dip, consonant or
   breath), and every distinct pitch that holds for at least ~50 ms (grace notes, turns,
   trill notes). Each tone of a trill that the trackers resolve is its own note; an
   unresolvable trill region keeps its notes and gets the flag `uncertain-split`.
7. **Glissando** between two held notes: two notes, with the second onset at arrival.
8. **Uncertainty** never blocks a decision: decide, then flag the note
   (`uncertain-pitch`, `uncertain-onset`, `uncertain-split`, `uncertain-exists`).

## Data and files

### Spec (the generator's working object): `work/resynth/<dataset>/<clip>/spec.json`

```jsonc
{
  "schema": "resynth-spec/1",
  "dataset": "whistle-real", "clip": "commons-donna",
  "version": 3,                         // bumped by every edit/autofix (one bump per command)
  "timbre": {"kind": "whistle"}         // or {"kind":"voice","singer":"female2","vowel":"u","lowpassHz":2500}
                                        // or {"kind":"instrument","timbre":"flute","source":"iowa-flute"}
  "render": {"seed": 1234, "contour": "copy-detrended", "levelMatch": true},   // contour "flat" = no borrowed pitch movement
  "nextId": 34,                         // the next new note is n34; ids are never reused
  "prior": {"source": "truth", "path": "apps/api/…/commons-donna.truth.json", "notes": 33},
  "notes": [
    {"id": "n1", "on": 0.480, "off": 0.550, "midi": 88,
     "cents": 16.0,     // intonation offset, auto-set from the original, clamped to ±50
     "vel": 96,         // level: 100 = the clip's reference level (90th pct of voiced frames), 2 vel = 1 dB
     "legato": false,   // joined to the previous note (no new attack)
     "flags": []}
  ]
}
```

Note ids are stable. New notes get fresh ids from `nextId` and ids are never reused, so
feedback can refer to `n12` across versions (ids are therefore not in time order after edits).

**Edit ops** (`edit --ops '[…]'` or `--ops-file f.json`; a list is applied atomically — all or
nothing — then normalised: sorted, a legato note's predecessor ends at its onset, overlaps are
trimmed the same way, and a note left shorter than 20 ms rejects the whole edit):

| op | fields |
|---|---|
| `set` | `id` + any of `on`, `off`, `midi`, `cents`, `vel`, `legato`, `flags` |
| `add` | `on`, `off`, `midi` (+ optional `cents`, `vel`, `legato`, `flags`) → new id |
| `delete` | `id` or `ids` |
| `split` | `id`, `at`, optional `midi` for the second part; the second part is legato iff its pitch differs (override with `legato`) |
| `merge` | `ids` (adjacent notes) → the first id spans them; `midi` defaults to the longest one's |
| `shift` | `ids` (or `"all"`), `dt` seconds |
| `transpose` | `ids` (or `"all"`), `semitones` |
| `flag` | `id`/`ids`, `add`: […], `remove`: […] (flags listed under Truth conventions) |

After an edit, `cents` and `vel` are re-derived from the original for every note whose `on`,
`off` or `midi` changed (an explicit `cents` in the same op sticks).
`edit --apply D2,D5` applies the ops the latest report suggests for those diffs (the report
must be for the current spec version). Closed clips (passed, unresolved, exported) need
`--reopen`, which returns them to needs-work.

### Per-clip work directory (gitignored): `synthetic-corpus/work/resynth/<dataset>/<clip>/`

| file | what |
|---|---|
| `state.json` | `{status, round, specVersion, judgedVersion, renderedVersion, history[], exportedAt?}`; status ∈ `drafted`, `awaiting-judge`, `needs-work`, `passed`, `unresolved`, `exported` |
| `orig.npz` | cached analysis of the original (both trackers, consensus, RMS, onset envelope, onset events); recomputed if the analyser config changes |
| `synth.npz` | the same analysis of the latest copy (tagged with its spec version) |
| `spec.json` | current spec; `history/spec.v<n>.json` keeps every version |
| `report.json` | latest compare report (`history/report.v<n>.json`) |
| `judge.json` | latest verdict (`history/judge.r<round>.json`) |
| `panels/p<k>.png` | latest comparison panels (≤ 8 s each, 1600×1000, 256-colour PNG, ~100–250 kB) |
| `synth.flac` | latest synthetic copy (24 kHz 16-bit FLAC; only the latest is kept) |
| `log.jsonl` | append-only event log (init, edit, autofix, render, compare, submit, verdict, export, timing) |

A 30 s clip's work directory is about 1.5 MB.

### Outputs (`export`)

- **Committed truth artifact** (tracked, the durable record):
  `apps/api/scripts/eval/annotations/resynth/<dataset>/<clip>.resynth.json`, with
  `{schema:"resynth/1", dataset, clip, role, audio:{file, sha256, sampleRate, durationSec},
  truth:{bpm, beatGrid?, notes:[{onsetSec,durSec,midi}]}, spec, verdict:{status, rounds,
  summary, metrics, judged[]}, prior, tool:{name, version, analyzer, timbre, seed}, createdAt}`.
  Written for passed AND unresolved clips (`verdict.status` says which).
- **Harness truth**: passed clips get `<clip>.truth.json` in the dataset's
  `apps/api/scripts/fixtures/eval-real/<tier>/<dataset>/` directory, with the bpm (and
  `beatGrid`, dagstuhl) of the previous truth. The previous truth is moved aside ONCE to
  `<clip>.truth-derived.json` (not matched by `*.truth.json`) and never overwritten.
  Unresolved clips get no `.truth.json` (an existing one is moved aside or removed), so the
  harness skips them; their notes go to `<clip>.truth-unresolved.json`.
- **Synthetic copy**: `<clip>__resynth.flac` beside the original (a hard link to the work
  copy; work files are always replaced by rename, never rewritten in place).
- **Contours for the app**: `<clip>.f0.json` beside the original:
  `{hop: 0.02, orig:[midi|null…], synth:[…]}`, the consensus f0 (MIDI, 2 decimals).
- **`dataset.json`** gains `resynth: {name, version, passed, unresolved, pending, exportedAt}`
  once anything is exported. Only when **every** clip of the dataset is exported (passed or
  unresolved) does it switch to `truthSource: "resynth"` and `noteTruthDerived: false`, and
  receive the dataset's export policy (`pooled: false` for whistle-vintage) and a recounted
  `totalNotes`; until then the unprocessed clips still carry their old derived truth.
  Licence-restricted datasets (mir-qbsh, humtrans) keep `licenceRestricted` and keep
  `noteTruthDerived` as it was, so a resynth export can never pool them.
- **jacrc** exports into a NEW dataset dir `benchmark/jacrc-notes/`: each `<clip>__real.wav` is
  a hard link to `benchmark/jacrc-students/`, its `dataset.json` documents that
  (`audioFrom`, `truthSource: "resynth"`, `noteTruthDerived: false`; no `derivedFrom`, which
  would mark jacrc-students superseded), and its artifacts go to `annotations/resynth/jacrc-notes/`.
  `jacrc-students` itself is never written.
- **Calibration datasets** export only the artifact, to
  `annotations/resynth-calibration/<dataset>/<clip>.resynth.json`; their eval-real truth is
  never touched.
- The `-aligned` duplicates (whistled-high-register-aligned, humtrans-aligned) are left alone.
- **Idempotent**: a rerun rewrites nothing whose content is unchanged (timestamps included);
  `--dry-run` prints the plan (`would …`) and writes nothing.
- Every output is regenerable from the committed artifact plus the original audio: the
  render is deterministic given the spec and its seed.

## Datasets (`datasets.py`)

| dataset | role | prior for the draft | copy timbre |
|---|---|---|---|
| whistled-high-register | target | `whistled-high-register-aligned` truth (identical audio) | whistle |
| whistle-real, whistle-vintage | target | own truth (sineTrack drafts) | whistle |
| mir-qbsh | target | own truth (pv-derived) | voice `u`, low-pass 2.5 kHz, band-limited like the 8 kHz original |
| humtrans | target | `humtrans-aligned` truth | voice `u`, low-pass 2.5 kHz |
| dagstuhl-choir | target | own truth (DTW); beatGrid kept | voice `a`, singer sex + f0 range from the part (`_S1_`, `_A2_`, …) |
| jacrc-students → jacrc-notes | target | blind f0 segmentation, split at the human syllable onsets | voice `a` |
| vocadito, n20emv2, hust-solfege | calibration | none (blind) | voice `a` |
| urmp-flute / -violin / -trumpet | calibration | none (blind) | iowa-flute / philharmonia-violin / iowa-trumpet (MonoSampler) |

`init --blind` drafts any target blind. A prior is read from `<clip>.truth-derived.json` when
an export has already moved the truth aside. A new dataset (the in-app takes) is one
`DatasetConfig(id, tier, material, prior='segment')` line: f0 range, analysis family and timbre
follow from the material (`whistling`, `humming`, `singing`; `instrument` needs an explicit
`f0_range` and `timbre`). webm/ogg/mp3 originals are decoded with ffmpeg-static.

**dagstuhl-choir was re-fetched 2026-10-30.** `fetch-dagstuhl.ts` assumed 16-bit PCM, but DCS
ships 32-bit float WAVs, so every earlier `__real.wav` held float bytes under a PCM_16 header
(noise an octave low). Fixed in 37f7ea02; the dataset is now 94 clean excerpts (was 102).

## Analysis (deterministic, `analysis.py`)

- **Original**: decode (soundfile; ffmpeg-static from `node_modules` for webm/opus), mono.
  Frames are centred on a 10 ms grid.
  - Voice / instruments: SwiftF0 (16 kHz, confidence ≥ 0.7, 16 ms frames interpolated onto
    the grid) + pYIN (16 kHz, 20-cent bins), with an f0 range per dataset.
  - Whistle: a sinusoidal FFT-peak tracker at the native rate (~43 ms Hann window at any rate,
    log-parabolic interpolation, tonality ≥ 0.35 and level gates: the method of
    `apps/api/scripts/eval/lib/sineTrack.ts`) + pYIN at 24 kHz up to 5 kHz. SwiftF0 tops out
    at 2.1 kHz and is not confident on a near-pure tone.
  - A level gate drops frames more than 38 dB (whistle 32, instruments 40) below the clip's
    loud frames: bleed, room tails and noise are not the performance.
  - **Consensus f0**: where the two trackers agree within 50 c, the frame is confident (2);
    where only one is voiced or they disagree, it is uncertain (1, plotted grey) and keeps the
    primary tracker's value.
  - RMS (32 ms) in dBFS; a superflux onset envelope (librosa, lag 2, max-size 3, normalised
    by its 98th percentile); onset events by adaptive peak picking, backtracked ≤ 50 ms to the
    energy minimum (the start of the attack), each with its sustained `rise` (median level
    20–120 ms after vs the minimum) and its re-articulation `dip` (how far the level fell
    below the held level both before and after). A click has neither.
  - Pitch-change events: legato boundaries of the blind segmentation (below) between two
    segments the trackers agree on for ≥ 30 % of their frames.
- **Synthetic copy**: the same analysis with the same settings, so the two files are
  measured identically.
- **Blind segmentation** (`segment.py`; drafts, gap filling, pitch events): per voiced phrase
  (gaps ≤ 30 ms bridged), a smoothed contour (voices: 100 ms mean; whistle: 50 ms median) is
  quantised to semitones with hysteresis (the note changes beyond ±0.75 st); runs shorter than
  the minimum note (50 ms whistle, 60 ms otherwise) go to the neighbour nearest in pitch; a
  short run whose pitch travels ≥ 50 c is a transit (phrase-initial scoop → next note, fall →
  previous, mid-phrase glide → previous, by the arrival rule), as is (voices) a run < 200 ms
  that never holds within 60 c; alternating ±1 st runs < 200 ms are vibrato (voices); legato
  boundaries move to the arrival frame; held pitches split at re-articulations (dip ≥ 4 dB) and
  at anchor onsets. Measured on the first calibration clips before any agent work (COnP vs
  human truth): urmp-trumpet 0.96, urmp-violin 0.93, vocadito_1 0.66 (A2 vs A1 there: 0.86),
  urmp-flute 0.66 (octave errors), hust 0.44, n20emv2 0.40.

## Rendering (`render.py`)

- **Contour** (`copy-detrended`): the rendered pitch is `midi + cents/100 + d(t)`, where `d(t)`
  is the original's in-note deviation minus its slow trend (a 250 ms moving median), clamped to
  ±60 c. A note that starts from silence also copies its first 100 ms relative to the note's
  median, clamped to ±200 c (the attack scoop). So vibrato and scoops are copied, but a held
  step inside a note and the note's centre are not: a wrong `midi` shows up as ≥ 50 c of
  mismatch, and a slow scoop into a legato note shows as a `pitch … (note centre ok)` diff.
  Between notes the pitch holds (tails never glide to the next note); joins are smoothed over
  30 ms. `cents` is the original's median offset from `midi`, clamped to ±50 c.
- **Level**: per-note `vel` (2 vel = 1 dB) applied after rendering, then the copy's reference
  level (90th percentile over its notes) is matched to the original's (`levelMatch`).
- **whistle**: a phase-continuous sine on the contour, a 2nd harmonic at −30 dB, breath noise
  band-passed around the clip's median f0 at −28 dB; 15 ms attack, 30 ms release; a legato note
  has no attack; a re-articulated note (touching, not legato) is preceded by ≥ 40 ms of silence.
- **voice**: `voice.PsolaSinger` (VocalSet units, TD-PSOLA) following the contour through its
  `contour()` hook. The singer is the one whose measured range covers the notes best (part sex
  for dagstuhl), fixed in the spec at init. Breaths off; PSOLA's in-note level wobble (shimmer,
  vibrato AM) is divided out so the level follows the notes only; a re-articulated note gets a
  level dip ending at its onset; each phrase fades out over 40 ms after its last offset.
  Humming: vowel `u` + low-pass 2.5 kHz. Originals below 16 kHz (mir-qbsh, 8 kHz) are band-limited
  the same way in the copy.
- **instrument**: `sampler.MonoSampler` with the timbre's source (nonvib takes when vibrato is
  0), through the sampler's optional per-note contour hook (`PerformedNote.contour`, absent =
  unchanged behaviour); each note follows only its own contour; releases are shortened to
  30–50 ms tau so the copy's sound ends at its note-offs. `work/root-cache.json` is never
  rewritten by a copy.
- Output: 24 kHz mono, written as FLAC. The seed is `sha256(dataset/clip)`, so the render is
  reproducible: same spec + seed → identical samples (verified across processes).

## Compare report (`compare.py`)

`iterate`, `compare`, `show` and `judge-view` print a compact report (≤ ~35 lines; the diff
list is capped at 25 with a `+N more` line; everything is in `report.json`):

```
whistle-real/commons-donna  8.9 s  33 notes  spec v1  round 1  [awaiting-judge]
GLOBAL pitch 93.8% (co-voiced frames ≤50c) · voicing recall 98% / precision 88% ·
       onset F1 0.84 (orig events vs copy, ±50 ms) · explained voiced time 98%
DIFFS 9 (most severe first): 6 timing, 1 unsupported, 1 pitch, 1 extra-sound
 D1  n26     7.08–7.17   timing           note 7.17, orig attack 7.08 (-90 ms)  → on 7.08?
 D2  n23     6.37–6.45   timing           note 6.45, orig energy 6.37 (-80 ms)  → on 6.37?
 D3  n30     8.01–8.09   timing           note 8.09, orig energy 8.01 (-80 ms)  → on 8.01?
 D4  n24     6.60–6.60   unsupported      no orig onset/pitch change near 6.60  → merge with n23?
 D5  n32     8.37–8.44   timing           note 8.44, orig energy 8.37 (-70 ms)  → on 8.37?
 D6  n5      1.55–1.61   pitch            orig 89.5 vs note 89 (+53 c)  → midi 90?
 D7  n4      1.21–1.27   timing           note 1.27, orig energy 1.21 (-60 ms)  → on 1.21?
 D8  n12     3.45–3.51   extra-sound      note sounds, orig voiced over 17% of it  → delete n12?
 D9  n3      1.17–1.21   timing           note 1.17, orig attack 1.21 (+40 ms)  → on 1.21?
panels: /…/work/resynth/whistle-real/commons-donna/panels/p1.png (0.0–8.0 s), p2.png (7.5–8.9 s)
```

Other lines look like `D3  n15  7.21–7.21  extra-onset  orig re-articulation inside n15 (dip 6 dB)  → split at 7.21?`,
`orig pitch change C6→D6 inside n3  → split at 3.90?`, `missing-sound  orig voiced ~C#6 (84.6), copy silent  → add C#6?`
or `uncertain-region  only pyin hears pitch (C#6 85.0)  → judge by eye`.

- **Global metrics**: pitch = co-voiced frames (original confident, copy voiced) within 50 c;
  voicing recall / precision; onset F1 = the original's events (energy onsets with ≥ 3 dB
  sustained rise ∪ pitch arrivals) vs the copy's, ±50 ms; explained = the original's confident
  frames inside a note (±20 ms).
- **Diff types** (spec vs the original's evidence, `evidence.py`; each with a suggested op):
  `missing-sound` (≥ 60 ms of confident sound no note covers), `extra-sound` (a note the
  original is voiced over < 35 % of), `pitch` (the original's median over the note's middle
  is > 50 c from `midi`; or `copy vs orig … (note centre ok)`: the copy misses the original's
  in-note contour by > 50 c for ≥ 100 ms — a contour/render limit, not a note error),
  `extra-onset` (a re-articulation — dip ≥ 3 dB and rise ≥ 3 dB — or a pitch change inside a
  note), `unsupported` (no evidence of the note's kind of onset within ±150 ms: attack /
  energy / pitch change after silence; pitch arrival or energy for a legato change; energy dip
  for a repeat; jacrc syllable onsets count for all), `timing` (onset > 40 ms from the nearest
  such evidence), `offset` (end > 80 ms from where the original's sound ends, for notes
  followed by ≥ 100 ms of silence), `uncertain-region` (≥ 150 ms where the trackers disagree
  or only one hears pitch; the judge decides by looking).
- **Panels** (one PNG per window of ≤ 8 s, 0.5 s overlap; y axis in note names with Hz,
  zoomed to the window's pitch range):
  1. the original's log-frequency spectrogram with its consensus f0 (white; uncertain frames
     grey), the copy's f0 (thin green), the note boxes (labelled `n12 G4`, dashed when
     flagged) and the diff markers (`D3`: shaded span, dashed line for a point, top bracket
     for a whole note);
  2. the copy's spectrogram with its f0 and the same boxes;
  3. the onset envelopes of the original (blue, ▼ events) and the copy (orange, ▲ events),
     note onsets (teal) and, for jacrc, the human syllable onsets (purple).
- **autofix** (run by `init`; conservative, each change printed and logged): `phantoms`
  (delete a note the original is voiced over < 15 % of), `pitch` (re-pitch a note whose
  original pitch is confident, steady and ≥ 60 c away, never within 15 c of a semitone
  boundary), `gaps` (cover ≥ 100 ms of confident uncovered sound: extend a touching note of
  that pitch or add blind-segmentation notes), `offsets` (before ≥ 150 ms of silence, move an
  end > 80 ms off to where the sound ends), `onsets` (move an onset 40–120 ms to a unique
  nearest evidence of its kind; never a detached note into its predecessor).

## Agent protocol (run by the workflow; see `meta/test-data-2026-10.md`)

```
init (deterministic draft + autofix + render + compare)                → drafted, round 1
round r = 1..5:
  generator agent : show → (autofix) → edit → iterate … until it would pass → submit   [reads the round r-1 feedback in show]
  judge agent     : judge-view (sets awaiting-judge) → PASS, or FAIL with numbered, time-anchored feedback → verdict
  PASS → passed (exported in bulk later); FAIL → needs-work, round r+1; FAIL at round 5 → unresolved
```

- **Verdict file**: `{"verdict": "pass"|"fail", "summary": "…", "feedback": [{"t": 3.42,
  "note": "n12", "text": "…"}, …]}`; a fail needs feedback (strings are accepted too).
- An edit while awaiting-judge returns the clip to drafted / needs-work.
- **Resumability**: every step persists to the work directory before returning. An
  interrupted clip resumes from `state.json`:
  - status `awaiting-judge` skips the generator;
  - status `passed` / `unresolved` / `exported` skips the clip.
- **Priors**: see Datasets. Calibration clips always start blind.
- **Speed** (this Mac, 30 s clip): `init` 5–9 s, `iterate` 4 s (spec unchanged) to 7.5 s
  (re-render), of which ~1.5 s is imports and pYIN's numba warm-up; `init --all` pays the
  warm-up once.
