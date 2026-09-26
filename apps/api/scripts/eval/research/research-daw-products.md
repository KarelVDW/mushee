# Commercial audio→MIDI/notation transcription: how the products actually do it

> **Status of every proposal in this document — shipped, built-off, discarded, not pursued — is tracked in [`../RESEARCH-STATUS.md`](../RESEARCH-STATUS.md), which also lists where this text is now stale.** This file is kept as the record of the reasoning, not edited to match the code.

Research notes, 2026-07-24. Focus: pre/post-processing and UX affordances (the models are commodity;
the pre/post-processing and the correction surface are not).

Evidence tiers used below:

- **[P]** primary source (vendor docs, paper PDF, source code) — quoted
- **[S]** secondary (review/press) — attributed
- **[T]** thin / search-summary only — flagged
- **[X]** claim checked and NOT supported

---

## 0. Executive summary of the transferable core

1. **Nobody solves detection. Everybody ships a correction surface.** Melodyne's own manual says
   detection "cannot, for reasons that have to do with immutable principles, always deliver perfect
   results." Every product's real product is the editable-blob UI.
2. **Merges are cheap, splits are expensive** (measured, Tony/TENOR 2015: Join = 3.2 s of user time,
   Split = 5.6 s, Create = 145 s). ⇒ tune for **high onset recall, accept lower precision**.
3. **Beats first, then quantize.** Every modern quantization result (Liu ISMIR 2022; Wachter/Murgul
   2025+2026) conditions note-value estimation on an explicit beat/downbeat grid. Metronome/beat
   ground truth "entails the possibility of completely eliminating the uncertainty of beat estimations."
4. **A metrical state space beats a note-value state space** for grammaticality (Nakamura SMC 2016:
   note-HMM produced "triplets that appear in single or two notes without completing a unit of beat";
   metrical HMM did not).
5. **Scope restriction is a feature.** Monophonic-only is the default/best path in every DAW tool;
   Klangio ships _per-instrument_ models; StaffPad ships piano-only.
6. **Amplitude-ratio onset gap insertion** is the documented trick for legato/same-pitch syllable
   splitting (pYIN post-processing, below). It is ~15 lines of code and moved COnPOff F from 0.38 → 0.50.

---

## 1. Celemony Melodyne

### 1.1 What is published / patented

- **DNA Direct Note Access** is patented. The core filing is **EP2099024A1**, P. Neubäcker,
  _"Method for acoustic object-oriented analysis and note object-oriented processing of polyphonic
  sound recordings"_ (pub. Sept 2009). https://patents.google.com/patent/EP2099024A1/en **[P]**
- Method per the patent **[P]**:
    - FFT on uniformly overlapping windowed frames → complex array → a 3-D **"energy landscape"
      F(t, f, E)** with frequency in **cents**.
    - Per bin: instantaneous frequency **plus a "tonality value"** measuring periodicity. High tonality ⇒
      note object; low tonality ⇒ (percussive) event object. _This is the mechanism behind the
      Melodic/Percussive auto-choice._
    - A **"relevance landscape"**: at each (t,f) point, sum the energy at that point **and at all integer
      frequency multiples** — i.e. a harmonic product/sum surface. Prevents overtones being read as notes.
    - **Iterative greedy peeling**: find the highest-prominence point in the relevance landscape → trace
      its pitch contour forward and backward in time → **subtract that note's spectral energy** →
      repeat until residual < threshold.
    - Then re-assign spectral bins proportionally to identified notes using **spectral fraction functions
      based on instrument harmonic models**, so each note can be manipulated "without noticeable loss of
      sound or noticeable distortion."
- Takeaway: Melodyne is **not** a deep net. It is a carefully engineered iterative harmonic-peeling
  tracker over a cents-resolution spectrogram, plus a resynthesis model. Its accuracy reputation comes
  from (a) cents-resolution continuous pitch, (b) contour tracing rather than framewise classification,
  (c) an unusually good correction UI.

### 1.2 The algorithm choices

https://helpcenter.celemony.com/M5/doc/melodyneStudio5/en/M5tour_AudioAlgorithms **[P]**
| Algorithm | Intended material | Notes |
|---|---|---|
| **Melodic** | "only one note is ever sounding at any given instant"; vocals "invariably monophonic" | includes **sibilant detection** and sibilant preservation under pitch shift |
| **Percussive** | "material in which Melodyne cannot detect any clear pitch"; all blobs shown at one pitch | |
| **Percussive Pitched** | "instruments that are in fact percussive yet still somehow also melodic" (808 kick, tabla) | |
| **Polyphonic (Decay / Sustain)** | piano, guitar; DNA | "DNA is intended for polyphonic instruments recorded _singly_" — separates by **pitch, not instrument** |
| **Universal** | "complex signals containing both percussive and tonal elements" | fast, cheap; for stretch/transpose only, not note editing |

- Melodyne **auto-selects** the algorithm from the detection pass; user can override in the Algorithm
  Inspector. Material with "too few tonal components" is silently downgraded to Percussive. **[P]**
- Explicit accuracy disclaimer, in the vendor's own manual: detection "in particular in the case of
  polyphonic audio material – cannot, for reasons that have to do with immutable principles, always
  deliver perfect results." **[P]**

### 1.3 Note segmentation UX — the actual gold-standard bit (relevant to (a))

https://helpcenter.celemony.com/M5/doc/melodyneStudio5/en/M5tour_NA_Mode_Tools **[P]**

Note Assignment Mode is a **separate mode whose tools do not change the sound at all**: "their object,
rather, is to bring the detected and displayed notes as closely as possible into line with the actual
music." Tools:

- **Note Separation tool** — double-click to add/remove a separation; drag it in time.
- **Hard vs soft separations**, and _"Convert Selection to Connected Sequence"_ — turns adjacent notes
  into a connected sequence with **soft separations even when pitches differ**. ⇒ Melodyne has a
  first-class representation for _legato-connected_ notes, distinct from re-attacked notes.
- **"Separate Notes as Trill"** — slices a note "into smaller segments determined by the instantaneous
  pitch of each note" by inserting separations into the **vibrato curve**; needs "fairly pronounced
  fluctuations in the Pitch Curve"; **Melodic algorithm only**. ⇒ the explicit vibrato-vs-real-notes
  disambiguation is _punted to the user as a one-click command_, not auto-decided.
- **Activation tool** — notes exist as "silhouettes" (inactive candidates) vs "solid blobs" (active).
  Deactivating redistributes its spectral energy "between the remaining (active) notes sounding at that
  time." ⇒ **a visible confidence/candidate layer**: Melodyne shows you the notes it _considered_.
- **Starting Point tool** + _"Reseparate Notes at Starting Point Lines"_ — a second, independent
  onset layer that the user can edit and then re-drive segmentation from.
- **Energy Share tool** (polyphonic only) — drag to re-allocate overtone energy between simultaneous notes.
- **Sibilant Range tool** — hatched regions marking consonants/breath, user-resizable.

### 1.4 Pitch correction / key-scale snapping (relevant to (c))

Correct Pitch macro: https://helpcenter.celemony.com/M5/doc/melodyneStudio5/en/M5tour_MacroPitch **[P]**

- **Two sliders**, 0–100 %:
    - upper = **pitch-centre correction**: "0% (no influence) to 100% (full power) to the pitch center of
      the notes selected". Default target = nearest semitone; **"Snap to Chord Scale"** switches the target
      to scale degrees / chord tones.
    - lower = **pitch-drift reduction**: drift is "slow wavering in pitch that is symptomatic of poor
      technique"; crucially "More rapid fluctuations in pitch, such as pitch modulation or vibrato, remain
      unaffected." ⇒ **drift and vibrato are separated by rate**, and only drift is corrected.
- Non-uniform strength: "At lower settings it affects only those notes that are wildly out of tune,
  leaving untouched those that are already quite close to the intended pitch."
- **Manual edits are sticky**: "notes that have been tuned manually are not affected by the macro"
  unless the user opts in. ⇒ a correction system that never clobbers human decisions.
- Sibilants move visually but "acoustically they remain unaltered."
- Melodyne 5 marketing mentions "improved pitch centre calculation" as a v5 change. **[P, thin detail]**

### 1.5 Tempo / grid (relevant to (b) and (d))

- Melodyne detects "not only the notes but also the prevailing tempos and time signatures within a
  recording," producing "a tempo map with a time signature, an appropriately spaced grid and a tempo
  curve tracing any fluctuations in tempo it contains." **[P]**
  https://helpcenter.celemony.com/M5/doc/melodyneStudio5/en/M5tour_TempoDetectionIntro_2
- **Two distinct tempo modes** — this is the important design idea. **[P]**
  https://helpcenter.celemony.com/M5/doc/melodyneStudio5/en/M5tour_TempoEditorDefinition
    - **Edit Tempo Mode** — change the tempo, notes conform (audio is altered).
    - **Assign Tempo Mode** — "you are adjusting the metronome click to fit the music – not the other way
      around." The user corrects the _grid_, not the audio.
- Failure modes and escapes documented by Celemony itself:
    - the classic **offbeat/phase error**: "some of the beats coincide with the offbeat, with the result
      that the metronome click, too, sounds on the offbeat" — fixed with a quantized-move tool.
    - drift: a **Wave tool** "Reshapes the wave within a given selection of beats," for when "the tempo
      as detected gets ahead of, or lags behind, the actual tempo."
    - **"Free Tempo Assignment"** — declare a passage's tempo as _free_, replacing detection with a
      constant tempo line the user adjusts.
    - **re-detect from a subset**: "Edit > Tempo > Detect Tempo of Selection and Merge with Current Tempo"
      — select only the rhythmically reliable notes/tracks and re-run. ⇒ **detection restricted to a
      user-chosen reliable subset** is a shipped affordance.
    - recommended workflow: "listen to the whole piece once through with the metronome running… check that
      the time signature is correct and that the '1' really does coincide with the start of the bar."
    - Celemony advises **excluding "solo instruments played very freely"** from batch import because they
      "might confuse the tempo detection."

### 1.6 ARA / ARA2 — why whole-file access is the enabling condition

- ARA is "an extension for established plug-in standard APIs such as VST3, Audio Units, AAX or CLAP to
  allow for a much-improved DAW integration of plug-ins" that are "conceptually closer to a sample
  editor than to a conventional realtime audio processor." https://github.com/Celemony/ARA_SDK **[P]**
- Celemony's Stefan Gretscher: "Harnessing the full power of Melodyne's industry-leading pitch & time
  editing and analysis technologies is just impossible when being limited to the popular
  realtime-focussed plug-in APIs." https://www.celemony.com/en/10-years-of-ara **[P]**
- Three things ARA adds: (1) **random access to whole audio files** at will; (2) a bi-directional
  **"musical information channel"** exchanging "information about things like the notes, tempos and
  chords being used"; (3) a **non-realtime, non-causal** processing model.
- ARA2 (2018) added multi-track editing, chord-track transfer, undo-state sync;
  **broke ARA1 compatibility**. https://en.wikipedia.org/wiki/Audio_Random_Access **[S]**
- **Relevance to us**: ARA is the industry's explicit admission that this class of algorithm needs the
  entire recording plus declared musical context, and cannot be done well in a streaming/causal setting.

### 1.7 Reputation and complaints

- Tony's authors (academics) on Melodyne: "offers a very sleek interface, but frequency estimation
  procedures are not public (proprietary code), notes cannot be sonified, and clear-text export of note
  and pitch track data is not provided." **[P]**
- Only 3 of 31 MIR-researcher survey respondents named Melodyne as a pitch-annotation tool (vs Sonic
  Visualiser 12, Praat 11). Its gold-standard status is with _producers_, not annotators. **[P]**
- Bundled **Melodyne Essential** cannot do polyphonic editing at all — polyphonic audio yields "a very
  sad-looking display of greyed-out blobs." https://www.soundonsound.com/techniques/studio-one-melodyne-essential **[S]**
- Studio One users report the **ARA build mis-selects the algorithm**: "detecting melodic material as
  polyphonic." **[T — search summary, forum 403]**

---

## 2. Cubase VariAudio (Steinberg)

- **No patent or published algorithm found** for VariAudio. **[X / thin]**
- Steinberg's own limitation statement: "The pitch-detection algorithm may not have enough information
  when processing weak audio signals or sections with little clear pitch information, such as plosives,
  sibilant or strongly sounded consonants"; VariAudio is "optimized for monophonic recordings of vocals."
  https://archive.steinberg.help/cubase_pro/v10/en/cubase_nuendo/topics/sample_editor_variaudio/sample_editor_variaudio_c.html **[P]**
- **Segments** = graphic note blocks over the waveform + a fine pitch curve. Each segment carries ~4
  handles: bottom = quantize/snap, top = **"Straighten Pitch"** (flatten vibrato/drift inside the
  segment), left/right = time warp independent of pitch. Scissors tool to re-segment. **[S/P]**
- **Pitch Snap Mode** Absolute vs Relative. SoS caveat: "it won't always be the most musical-sounding
  result — you must let your ears be the judge." **[S]**
- **Cubase 12 Scale Assistant** — colour-codes segments by scale/chord and snaps to the
  **user-declared** key/scale rather than nearest semitone. ⇒ direct evidence for (c): the shipped
  solution is _user declares key, tool snaps to it_. **[S]**
  https://www.musicradar.com/how-to/how-to-get-your-head-around-cubase-10s-variaudio-3
- **Extract MIDI** pre-conditions, per SoS: "Performances featuring single notes (no chords), and
  recorded as mono rather than stereo, are essential"; dry/clean signal; user should manually align
  segment starts with attacks and fix over-segmentation **before** extracting. Three pitch-bend export
  modes (none / static / continuous). **No velocity detection** — everything exports at 100. Unusable
  for drums. https://www.soundonsound.com/techniques/variaudio-extracting-midi-audio-files **[S]**
- Early-version accuracy was bad enough to be a known problem: "the accuracy of the pitch-detection
  algorithm could be troublesome." https://www.soundonsound.com/techniques/vari-ability **[S]**
- **Complaints (concrete):**
    - "Poor pitch detection in VariAudio" — user fed 440 Hz and 442 Hz **pure sine tones**; both read as
      "A3+4%", i.e. failed to resolve ~8 cents on the simplest possible input.
      https://forums.steinberg.net/t/poor-pitch-detection-in-variaudio/136427 **[P — forum]**
    - "Cubase VariAudio is a con…" — claims corrected notes revert on render and "the same flawed
      algorithms have remained unchanged across 15 years." Contested in-thread: other users null-tested
      and got silence, suggesting the **numeric readout** is wrong rather than the audio.
      https://forums.steinberg.net/t/cubase-variaudio-is-a-con-it-doesnt-render-correctly-never-has-and-steinberg-know-it/940832 **[P — forum, disputed]**
    - Recurring pattern: segmentation "gets distracted by harmonics" on aggressive/overtone-rich vocals;
      weak at low pitches; widely considered inferior to Melodyne outside clean solo vocal. **[T]**

---

## 3. Logic Pro Flex Pitch / Convert to MIDI (Apple)

- Flex Pitch is an extension of the existing **Flex Time** engine. No published algorithm.
  Apple's "Flex Pitch algorithm and parameters" page exists but its body was not retrievable. **[thin]**
  https://support.apple.com/guide/logicpro/flex-pitch-algorithm-and-parameters-lgcpba8e3301/mac
- **Per-note hotspots** (6–7 params on every detected note): Pitch (drag body), **Fine Pitch** (cents),
  **Pitch Drift start**, **Pitch Drift end**, **Vibrato**, **Gain**, **Formant Shift**.
  https://www.soundonsound.com/techniques/flex-appeal **[S]**
  ⇒ same drift/vibrato decomposition as Melodyne, exposed as direct-manipulation handles.
- **"Set All to Perfect Pitch"** — Cmd-A then one menu item snaps every note to the nearest semitone.
  The blunt one-click sidestep; tutorials then tell you to restore drift/vibrato to de-robotise. **[S]**
- Documented limitation (Apple wording, via multiple secondary sources): "Creating MIDI regions from an
  audio recording works best with monophonic material; chords or polyphonic material may lead to errors
  in interpretation." **[S]**
- **Apple-acknowledged bug**: on Logic 10.7.5/10.7.6 + macOS Ventura, Flex Pitch could misassign
  analysed notes to **C0**. https://support.apple.com/en-us/101946 **[P]**
- Complaints: broad consensus that Flex Pitch is fine for light correction and materially worse than
  Melodyne beyond clean close-mic'd monophonic vocal. **[T — Gearspace/Apple Community threads 403'd]**

---

## 4. Ableton Live "Convert Melody / Harmony / Drums to New MIDI Track"

- **The Zynaptiq / Jean-Baptiste Rolland attribution appears to be FALSE. [X]**
    - Rolland is **Steinberg** — "Technical Lead AI & DSP at Steinberg Media Technologies" since 2014.
      His publications are chord detection, mixing-style transfer, MIDI-GPT, and a 2018 patent "Method for
      projected regularization of audio data" — all Cubase-adjacent. No Ableton link found.
    - No Ableton doc, release note, press item or patent credits Zynaptiq for Convert Melody/Harmony/Drums.
      Zynaptiq appears only as a maker of unrelated third-party plugins (Pitchmap).
    - Notable: Ableton _does_ publicly credit Cytomic for the Glue Compressor, so the absence of any
      credit here is meaningful. Also checked Klapuri and zplane — no documented link.
    - ⇒ **Ableton does not publicly document this algorithm's authorship at all.**
- What Ableton **does** document — https://www.ableton.com/en/manual/converting-audio-to-midi/ **[P]**
    - **Convert Melody** "identifies the pitches in monophonic audio"; works on "singing, whistling, or
      playing a solo instrument such as a guitar."
    - **Segmentation is transient-based, not pitch-contour-based**: all three converters use "transient
      markers in the original audio clip to determine the divisions between notes."
    - The resulting failure mode is stated outright: "notes that fade in or 'swell' may not be detected
      by the conversion process" — recommends "music that has clear attacks."
      ⇒ **This is exactly the legato/soft-onset failure we must not replicate.**
    - **Convert Harmony** = polyphonic version. **Convert Drums** = transient-only, exactly three classes
      (kick/snare/hihat), a note placed at _every_ transient marker.
    - Pre-processing advice: uncompressed WAV/AIFF; SoS adds pre-EQ/filtering to isolate the range and
      manual deletion of spurious transient markers afterwards. **[P/S]**
- Complaints: "Bass is typically easy to convert… however 'Harmony' … is harder for software to
  decipher"; exported MIDI reported "out of sync." **[T — forum 403]**

---

## 5. Studio One + Melodyne (ARA)

- Insert Melodyne on an audio track as an ARA plugin; Track Mode and Clip Mode.
  https://helpcenter.celemony.com/M5/doc/melodyneStudio5/en/M5tour_WorkingWithARA?env=studioOne **[P]**
- Deep hook: "Studio One and Celemony developers worked together… to make Melodyne's **tempo and chord
  detection** available directly to the respective **Tempo and Chord Tracks**." ⇒ analysis results
  become first-class _project-level_ metadata, not just plugin-internal state. **[P]**
- Audio→notation path is indirect: analyse in Melodyne → **drag note events onto an instrument track**
  to materialise real MIDI → then to notation (Score view / Notion). Studio One's Score view renders
  MIDI; Melodyne does not feed it directly. **[S]**
- ARA is a _transport_, not a capability: bundled Melodyne Essential is monophonic-only; DNA requires
  the paid full Melodyne. **[S]**

---

## 6. ScoreCloud / DoReMIR (Sven Ahlbäck)

### 6.1 The academic root

- Sven Ahlbäck, **"Melody Beyond Notes: A Study of Melody Cognition"**, PhD thesis, Göteborg University
  2004 (full text: https://www.diva-portal.org/smash/get/diva2:1366565/FULLTEXT01.pdf). Music-theoretic
  /cognitive account of **melodic segmentation** — segmentation indicated by _sequences_, by
  _discontinuity/change_, and by **melodic parallelism**; plus tonal-centre inference. **[P]**
- Related published work: Ahlbäck, "Melodic similarity as a determinant of melody structure,"
  _Musicae Scientiae_ 2007; "Musical Parallelism and Melodic Segmentation." **[P]**
- DoReMIR founded 2008 by Ahlbäck. ScoreCloud's own line: "The way in which ScoreCloud Express listens
  to and understands musical structure is based on research performed at KTH into how people interpret
  music." https://scorecloud.com/about/ **[P]**
- **No patents found.** Google Patents returns 0 results for inventor "Sven Ahlback" and nothing
  relevant for assignee/keyword "Doremir". ⇒ **their moat is research + product, not IP.** **[P — negative result]**
- ⇒ The distinctive DoReMIR bet: **rhythm/metre/key are inferred by cognitive-style structural rules
  (parallelism, grouping, similarity), not by DSP beat-tracking.** This is why it tolerates rubato.

### 6.2 What it does in practice

- **No tempo, key, time signature or click required up front.** SoS review: "There's no need to set
  anything up or hit a Record button: you simply start playing… and notes appear in the Listener."
  https://www.soundonsound.com/reviews/doremir-scorecloud **[S]**
- Explicitly a **record-then-correct** product, and explicitly anti-click: "there's really no need to
  employ the forced, mechanical strict-tempo playing you'd need to get acceptable results from other
  notation packages." **[S]**
- Support docs: it "attempts to analyze the musical structure like someone who never heard the song or
  musical style before." Key signature, time signature, tempo, pickup measures and clef are all
  **post-hoc, user-adjustable**. There is an **"Edit Rhythm"** mode with a **"Drag Barlines"** tool
  (i.e. the same "move the grid, not the music" idea as Melodyne's Assign Tempo). A **"Tap Beat"**
  feature exists — **MIDI input only**. Click track available for **MIDI recording only, not audio**.
  https://scorecloud.com/support/ **[P]**
- Reported failure modes **[S]**: mis-identified pickup notes; "reluctant to employ compound time
  signatures, so it would choose to represent what I thought of as 6/8 as 2/4 with lots of triplets."
- Also uses **velocity** (MIDI) as a cue affecting rhythmic notation. **[P]**

---

## 7. AnthemScore (Lunaverus)

- Developer's own technical page: https://www.lunaverus.com/cnn **[P]**
    - CNN over a spectrogram that is **not a plain FFT** — "something closer to the constant Q transform,
      a constant frequency to bandwidth ratio with **4 frequency bins per note**", plus a **"dynamic Q"**
      trick raising Q near detected harmonics to reduce harmonic interference. ⇒ hand-engineered
      front-end, not off-the-shelf mel.
    - Convolutions "long and skinny, alternating between time and frequency dimensions: an Mx1 followed
      by a 1xN," with ResNet-style forward skips.
    - **88 independent output nodes**, no softmax.
    - Training: "2.5 million training examples from 3,000 MIDI files spanning several different genres,"
      avg 3 notes/example, single 980 Ti, TensorFlow. Synthesised-from-MIDI; **no MAPS mention**.
    - Self-reported accuracy, with the developer's own honesty about it: 99.2 % at output-node level but
      96.6 % is the always-say-no baseline; **60.3 %** for "all 88 outputs correct"; end-to-end
      **F ≈ 0.8** for piano.
- Workflow: transcription first (accuracy setting 1–10), **then** beats/tempo/key.
  "AnthemScore needs to know where the beats and downbeats are located in order to create sheet music."
  User **taps along** to playback to mark downbeats, or drags beat markers. Tempo export as per-beat
  map / user-annotated map / flat 120 BPM. Grid: "The grid size is adjusted by changing the smallest
  allowed note in the drop down box," with values greyed out when inconsistent with the time signature.
  **Key signature is manual only — no auto key detection documented.** No confidence display.
  Vocals and chord symbols unsupported. Requires A440. https://www.lunaverus.com/documentation **[P]**
- Complaints (Slashdot, 1/5): "the transcription is horrible and all over the place"; "Notes are
  rhythmically all over the place"; "Lots of extra notes."
  https://slashdot.org/software/p/AnthemScore/ **[P]**
- Notable user workaround: **warp/quantize the audio in a DAW first**, then feed AnthemScore — users
  are manually pre-conditioning timing to compensate for weak rhythm modelling. **[T]**

---

## 8. Sibelius AudioScore / Neuratron

- Marketing: "Convert up to 16 instruments or notes at a time into multiple staves, with up to four
  voices per staff" — but that's for **audio-file** input. **Microphone input is monophonic-only**
  ("sing or play into your computer using a microphone… monophonic performances only").
  http://www.sibelius.com/products/audioscore/ultimate.html **[P]**
- Mic workflow: real-time visual pitch feedback — "instant graphical feedback about the pitch of your
  performance over time, so you can see mistakes and make adjustments while performing" — built-in
  metronome, and **tempo + time signature must be set before recording**; the UI shows the minimum
  notatable note value at the chosen tempo. ⇒ full click-track discipline. **[P]**
- **No Neuratron-assigned patent confirmed.** **[X / thin]**
- Reputation is poor: forum thread literally titled "Is AudioScore Ultimate a rip-off?"; complaints that
  "the technology is not advanced enough yet to capture polyphonic sound and parse it into anything
  meaningful," and that it is "essentially just a help for transcription that has to be done mainly by
  hand or ear." **[T — 403, search-summary only]**

## 9. Dorico — does NOT do audio transcription **[confirmed negative]**

- No audio-to-notation feature, no roadmap statement. Has "smart MIDI import" with automatic voice
  separation. A forum thread requesting audio→orchestral score got **no official reply**; a user
  called it "the equivalent of separating the eggs from the omelette."
- Its MIDI **Quantize Options** dialog is nonetheless the best-documented quantization UX found
  anywhere: **Quantization Unit** (smallest note value), **Detect Tuplets** on/off + separate **Tuplet
  Quantization Unit**, **Fill Gaps**.
  https://archive.steinberg.help/dorico_pro/v3.5/en/dorico/topics/project_file_handling/project_file_handling_midi_quantize_options_dialog_r.html **[P]**

## 10. MuseScore — no native audio transcription **[confirmed negative]**

- Muse Group instead distributes **Klangio's "Music Transcription Studio"** as a third-party paid app
  through **Muse Hub** (upload audio/YouTube or record, per-instrument models, export
  MIDI/MusicXML/PDF/GuitarPro). Not native MuseScore code.
  https://www.musehub.com/app/music-transcription-studio **[P]**
  https://www.scoringnotes.com/news/muse-hub-transforms-into-a-platform-for-playback-options-and-audio-tools/ **[S]**

## 11. StaffPad "Piano Capture"

https://staffpad.zendesk.com/hc/en-us/articles/16640272408594-Piano-Capture **[P]**

- Built-in mic + **on-device ML**, "modeled on an acoustic piano" — degraded on electric pianos;
  external mics/interfaces "may not work as well."
- **Tempo set before recording**, optional metronome with count-in bars. No key/time-signature config.
- **Live, self-revising output**: "notes pop on to the staff" and durations "refine as you continue to
  record, and may continue to adjust themselves after playing." ⇒ closest shipped analogue to a
  streaming transcription UX.
- Co-founder David William Hearn: extending beyond piano would require collecting new per-instrument
  training data. https://www.scoringnotes.com/news/staffpad-captures-the-imagination/ **[S]**
- No published accuracy numbers. Comment-section scepticism: nobody has "made a real effort at
  capturing free playing and making even slightly legible music notation." **[S]**

---

## 12. Klangio — the most directly comparable company, and they publish

Klangio (Karlsruhe; Sebastian Murgul, KIT) publishes its research. Listed at
https://klang.io/about-us/research/ **[P]**, cross-checked on arXiv **[P]**:

| Paper                                                                                          | Venue / ID                                   | Why it matters to us                                                                 |
| ---------------------------------------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------ |
| **Dual Task Monophonic Singing Transcription**                                                 | _J. Audio Eng. Soc._                         | note-level sung transcription via dual-task learning — their Sing2Notes core         |
| **Estimation of Music Recording Quality to Predict Automatic Music Transcription Performance** | ICSM 2022                                    | **predicting AMT performance from recording quality** — a gating/warning model       |
| A Multimodal Approach to Acoustic Guitar Strumming Action Transcription                        | ISMIR 2022                                   |                                                                                      |
| **Beat and Downbeat Tracking in Performance MIDI Using an End-to-End Transformer**             | SMC 2025, arXiv 2507.00466                   | beat grid from _symbolic_ note events; beats A-MAPS/ASAP/GuitarSet/Leduc; beats HMMs |
| **Beat-Based Rhythm Quantization of MIDI Performances**                                        | arXiv 2508.19262 (Wachter, Murgul, Heizmann) | see below                                                                            |
| **Transformer-Based Rhythm Quantization … Using Beat Annotations**                             | arXiv 2604.22290 (2026-04)                   | see below                                                                            |
| Fine-Tuning MIDI-to-Audio Alignment (piano roll + CQT)                                         | arXiv 2506.22237                             | CRNN alignment "up to 20% higher alignment accuracy than … DTW"                      |
| Fretting-Transformer (MIDI→tab)                                                                | ICMC 2025, arXiv 2506.14223                  | "surpasses … A\* and commercial applications like Guitar Pro"                        |
| Exploring Procedural Data Generation for … Fingerpicking Transcription                         | arXiv 2508.07987                             | **procedurally synthesised training data + small real fine-tune**                    |
| Joint Transcription of Acoustic Guitar Strumming Directions and Chords                         | arXiv 2508.07973                             | "hybrid … synthetic and real-world data achieving the highest accuracy"              |

**Their rhythm-quantization results (arXiv 2508.19262 / 2604.22290)** **[P]**:

- T5 transformer with **beat-aware tokenization**; "a flexible preprocessing pipeline that uses beat
  estimations or ground truth beats."
- **The money quote for (d):** the method is "capable of leveraging metronome information, which entails
  the possibility of **completely eliminating the uncertainty of beat estimations**"; and "explicit beat
  information can yield significant improvements in onset quantization performance."
- Numbers: **onset F1 97.3 %**, **note-value accuracy 83.3 %** on ASAP. MUSTER onset error
  **12.30 %** vs 15.55–68.28 % for competitors; offset error 28.30 %. Beats Nakamura's HMM
  (22.58–25.02 % onset error). End-to-End PM2S still better on offsets (23.84 %).
- Honest caveat: "if metronome information is not available the performance is however highly dependent
  on beat estimation quality." No error-source breakdown given.
- Augmentation used: pitch transposition + **duration noise injection**.

**Architectural read-out**: Klangio's pipeline is almost certainly
**audio → per-instrument note-event model → symbolic beat/downbeat transformer → beat-conditioned
rhythm-quantization transformer → notation**, with per-instrument specialisation and heavy synthetic
data. That is a directly copyable blueprint from a company whose economics resemble ours.

**Melody Scanner / Klangio product UX** **[P]** (https://klang.io/melodyscanner/, /piano2notes/):

- "Record, upload, or paste a YouTube link" → transcribe → edit in browser/app; views = sheet music,
  piano roll, guitar tabs. **No pre-recording tempo/key setup, no click track, no scale-snap, no
  confidence display** documented.
- Solo instruments only (piano, guitar, flute, violin, sax, bass, voice); **explicitly not** bands /
  orchestras / full mixes. Deliberate scope restriction.
- Positioning rationale, in their own words: "An AI model trained exclusively on piano music will
  theoretically outperform a generic, one-size-fits-all model when transcribing a piano piece."
- Pricing: free tier (YouTube import, 1-min recordings, ~40-bar/2-min sheet cap, PDF only);
  paid ≈ $4.99/mo or $39.99/yr (5-min recordings, upload, full sheets, MIDI/MusicXML).
- Complaints: billing ("paid for premium but not receiving it… felt it was a scam"); accuracy —
  "guitar transcription on full-band mixes tend[s] to come back messy, especially for bass" — i.e.
  users ignore the stated scope and are disappointed. **[T — review aggregators]**

---

## 13. Tony / pYIN — the single most useful published source for us

Mauch, Cannam, Bittner, Fazekas, Salamon, Dai, Bello, Dixon,
**"Computer-aided Melody Note Transcription Using the Tony Software: Accuracy and Efficiency"**,
TENOR 2015. PDF: https://www.tenor-conference.org/proceedings/2015/04-Mauch-Tony.pdf **[P — read in full]**
Code: https://github.com/sonic-visualiser/tony ; https://www.sonicvisualiser.org/tony/

### 13.1 Framing

44.1 kHz, frames of **2048 samples (~46 ms), hop 256 (~6 ms)**.
Stage 1 = pYIN pitch track (ICASSP 2014): YIN's single threshold replaced by a **distribution over
threshold settings** → multiple candidates with probabilities → HMM Viterbi for a smooth track.

### 13.2 The note HMM (relevant to (a)) — verbatim design

- **Not quantised to semitones.** "Unlike other similar models, ours does not quantise the pitches to
  semitones, but instead allows a more fine-grained analysis."
- State space: MIDI 35 (B1, ≈61 Hz) → 85 (C♯6, ≈1109 Hz) at **3 steps per semitone ⇒ n = 207 pitches**.
- Per pitch, **3 states: Attack, Stable, Silent** (after Ryynänen), left-to-right.
- Emission: Gaussian at the note pitch, raised to a **trust exponent τ = 0.1** ("controls how much the
  pitch estimate is trusted"); voiced prior **v = 0.5**; unvoiced mass spread as (1−v)/n.
- **σ differs by state: attack σ = 5 semitones, stable σ = 0.9 semitones.** "This models that the
  beginnings of notes and note transitions tend to vary more in pitch than the main, stable parts."
  ⇒ **this is how you tolerate scoops/portamento/vibrato without fragmenting notes.**
- Self-transition probabilities **0.9 (attack), 0.99 (stable), 0.9999 (silent)**.
- Transition heuristic between notes, three rules only:
    1. next note pitch is **either the same as the previous, or ≥ 2/3 semitone different**;
    2. small pitch changes more likely than large;
    3. **max 13 semitones** between consecutive notes.

### 13.3 Note post-processing — the legato/same-pitch fix (THE trick)

Two steps, both trivial:

1. **Amplitude-based onset segmentation.** Compute frame RMS aᵢ. Take the ratio across the frame,
   **r = a₍ᵢ₊₁₎ / a₍ᵢ₋₁₎**. With sensitivity s, any rise with **1/r < s** counts as an onset, and
   **frame i−2 is set to unvoiced — "thus creating a gap within any existing note."**
   Crucially: "If no note is present, nothing changes, i.e. **no additional notes are introduced** in
   this onset detection step." ⇒ It is a _splitter_, never a creator. This is exactly what separates
   consecutive same-pitch syllables in legato singing.
2. **Minimum-duration pruning** — discard notes shorter than a threshold, "usually chosen around 100 ms."

### 13.4 Measured accuracy (38 solo vocal recordings: 11 adult F, 13 adult M, 14 children)

| System                             | Overall Acc | Raw Pitch Acc | Voicing FA | Voicing Recall | F COnPOff | F COnP   | F COn    |
| ---------------------------------- | ----------- | ------------- | ---------- | -------------- | --------- | -------- | -------- |
| melotranscript                     | 0.80        | 0.87          | 0.37       | 0.97           | 0.45      | 0.57     | 0.63     |
| ryynanen                           | 0.72        | 0.76          | 0.37       | 0.94           | 0.30      | 0.47     | 0.64     |
| smstools                           | 0.80        | 0.88          | 0.41       | 0.99           | 0.39      | 0.55     | 0.66     |
| **pYIN s=0, prn=0** (no post-proc) | 0.83        | **0.91**      | 0.37       | 0.98           | 0.38      | 0.56     | 0.61     |
| **pYIN s=0.7, prn=0.10**           | 0.85        | 0.90          | 0.29       | 0.96           | 0.47      | 0.64     | 0.69     |
| **pYIN s=0.8, prn=0.10**           | 0.85        | 0.89          | 0.24       | 0.94           | **0.49**  | **0.68** | **0.73** |
| **pYIN s=0.8, prn=0.15**           | 0.85        | 0.87          | 0.22       | 0.91           | **0.50**  | 0.67     | 0.71     |

- **Post-processing alone lifted COnPOff F from 0.38 → 0.50** (+31 % relative) with **no model change**.
  "minimum duration pruning alone does not lead to substantial improvements. However, a combination of
  onset detection and minimum duration pruning leads to COnPOff F values of up to 0.50."
- Explicit tradeoff: "better raw pitch accuracy is achieved with low values of s, and lower false alarm
  rates with higher values of s."
- Metric definitions (Molina et al. ISMIR 2014 framework): COnPOff = correct onset **(±5 ms as printed
  in the paper — note this is almost certainly a typo for ±50 ms, Molina's standard tolerance; flagging)**,
  pitch **±0.5 semitone**, offset **±20 % of ground-truth duration**. COnP = onset+pitch; COn = onset only.
- Caveat from the authors: "the accuracy of automatic transcription heavily depends on the material…
  some instruments are more difficult to pitch-track"; the test set is "predominantly voiced, so the
  voicing false alarm outcomes may change on different data."

### 13.5 The human-correction economics (THE most actionable result in this whole report)

96 recordings, 32 amateur singers × 3 tunes from _The Sound of Music_, expert annotator, timing edits only.

| Edit op               | Mean count / recording | Marginal time cost (regression) | p     |
| --------------------- | ---------------------- | ------------------------------- | ----- |
| **Delete**            | **8.82**               | 3.51 s                          | 0.06  |
| **Join (merge)**      | **8.64**               | 3.18 s                          | 0.18  |
| **Split**             | 4.73                   | **5.58 s**                      | 0.06  |
| Move boundary         | 0.28                   | 45.51 s                         | 0.25  |
| **Create**            | 0.17                   | **145.08 s**                    | <0.01 |
| Familiarity (per day) | —                      | **−2.31 s**                     | 0.01  |
| Intercept (baseline)  | —                      | **437 s**                       | <0.01 |

- Mean piece duration 179 s; baseline annotation time 437 s ⇒ **~2.4× realtime even before edits**.
- Author conclusion, quoted: "the fact that **Merges are much cheaper than Splits** suggests that
  **high onset recall is more important than high onset precision**"; and "transcription systems should
  focus on **voicing recall and note onset/offset accuracy**."
- ⇒ Design rule for us: **over-segment slightly and make merging one keystroke.** Never require Create.

### 13.6 Tony's UX affordances worth stealing

- **No pre-analysis configuration.** "As soon as the user opens an audio file, melodic representations of
  pitch track and notes are calculated… This contrasts with general tools like Praat, Sonic Visualiser or
  AudioSculpt, which offer a range of processing options the user has to select from." Params are
  re-runnable from a menu afterwards.
- **Note layer is structurally non-overlapping** — "This averts possible annotation errors from
  overlapping pitches." Monophony is enforced by the data model, not hoped for.
- **Two-layer editing model**: note edits change **only time** (placement/duration); "their pitch is
  calculated on the fly as the **median of the underlying pitch track**" and updated in real time.
  All pitch corrections happen on the pitch-track layer. ⇒ **pitch is derived, never independently
  edited** — eliminates a whole class of inconsistency.
- **Octave-error correction as first-class UX**: pYIN's stage 2 is re-decoded **13 times** with the
  candidate probabilities re-weighted by a Gaussian centred at cⱼ = 48 + 3j, j = 1…13, σ*r = 8, giving
  13 alternative pitch tracks over a user-selected interval; near-duplicates (≥80 % pitch coincidence)
  are dropped and the user picks. ⇒ \*\*present \_alternative interpretations*, not a single answer.\*\*
- **Last-resort manual escape**: user draws a **time-pitch rectangle** and a YIN-independent **harmonic
  product spectrum** method returns the per-frame max inside it (or nothing if the max sits on the
  boundary). ⇒ always have a "just do what I mean in this box" tool.
- **Sonification of both layers**, independently toggleable — pitch track as additive synthesis of the
  first 3 partials; notes as a wave-table electric piano "especially synthesised for its neutral
  timbre," **not constrained to integer MIDI pitches**. Error-spotting by ear is often faster than by eye.
- Simple bulk actions: "choose higher/lower pitch (by octave) in the selected area; remove pitches in
  the selected area."

---

## 14. Rhythm / grid: the published state of the art (relevant to (b) and (d))

### 14.1 Nakamura, Yoshii, Sagayama — merged-output HMM, SMC 2016

https://eita-nakamura.github.io/articles/Nakamura_etal_RhythmTranscriptionOfPolyphonicMIDIPerformances_SMC2016.pdf **[P — read in full]**

- Two established families, and the distinction matters enormously for us:
    - **Note HMMs** — score = Markov chain over **note values**; a latent Markov **tempo** variable;
      observed duration = note value × tempo + onset noise.
    - **Metrical HMMs** — score = Markov process on a **grid of beat positions within a bar**; note values
      are _differences between successive beat positions_. "Incorporation of the metre structure is an
      advantage of metrical HMMs."
- Generative model, with the authors' measured parameter values — these are useful priors:
    - note values: categorical Markov chain, learned from a score corpus;
    - tempo: **Gaussian random walk on log tempo**, ln vₙ | ln vₙ₋₁ ~ N(ln vₙ₋₁, σ_v²), **σ_v = 1.08**;
      discretised to **50 log-spaced values from 0.3–1.5 s per quarter note (200–40 BPM)**;
    - onset time given note value: tₙ ~ N(tₙ₋₁ + rₙ₋₁ vₙ₋₁, σ_t²), **σ_t = 0.02 s**;
    - chord (simultaneous) notes: IOI ~ Exp(λ), **λ = 0.0101 s**, chords as self-transitions.
    - pitch modelled explicitly as a Markov chain per voice (needed to separate voices).
- Metric: **rhythm correction ratio R = (min # edit operations to fix) / (# notes)** — note-wise shift
  plus a **scaling operation over subsequences**, because "there is arbitrariness in choosing the unit of
  note values: … a quarter note played in a tempo of 60 BPM has the same duration as a half note played
  in a tempo of 120 BPM." Computed by Levenshtein-style DP.
- Results (**lower is better**):
  | Data | Proposed merged-output | Note HMM | Metrical HMM |
  |---|---|---|---|
  | Polyrhythmic | **16.0 ± 3.6 %** | 28.9 ± 4.9 % | 34.1 ± 5.0 % |
  | Standard polyphony | 7.9 ± 1.3 % | **7.0 ± 1.3 %** | 7.9 ± 1.4 % |
- **The failure mode that should drive our design choice**, quoted: "For the note HMM and the proposed
  model, there were **grammatically wrong sequences of note values, for example, triplets that appear in
  single or two notes without completing a unit of beat**… On the other hand, these grammatical errors
  were **not observed in the transcriptions by the metrical HMM** owing to the explicitly included
  metrical structure."
  ⇒ **For a notation product, a metrical/beat-position state space is worth more than raw accuracy**,
  because ungrammatical rhythm is visually catastrophic in a score even when it's numerically close.
- Also: even at the state of the art, **~7–8 % of notes in ordinary polyphony need a manual rhythm fix.**
  Set expectations accordingly.

### 14.2 Liu, Kong, Morfi, Benetos — PM2S by neural beat tracking, ISMIR 2022

https://www.turing.ac.uk/sites/default/files/2022-09/midi_quantisation_paper_ismir_2022_0.pdf
code: https://github.com/cheriell/PM2S **[P — read in full]**

- Core reframing: "**Considering rhythm quantisation as a fine-grained tracking of beats and beat
  subdivisions**", predict musical onset as **moₙ = sₙ / S** (subdivision index within a beat).
- Two-part beat handling, which is a neat practical idea:
    - **in-note beats** (coincident with ≥1 onset) predicted by a CRNN as **binary classification per note**,
      with **dynamic thresholding** (threshold derived from the max probability in a fixed-length segment);
    - **out-of-note beats** (no note there) **inferred by dynamic programming**: candidate insertions of
      K ∈ {0,1,2,3} evenly spaced beats per gap, minimising
      **O = Σ |log((b₍ₙ₊₂₎−b₍ₙ₊₁₎)/(b₍ₙ₊₁₎−bₙ))| + λ·N_out** — i.e. minimise log-tempo change, penalise
      inserting too many beats, subject to a tempo-range constraint.
- **Multi-task CRNN** (3 conv + 2 BiGRU per branch) predicting, per note, all of:
  musical onset (24 classes), note value (96), **time-signature numerator (5: {0,2,3,4,6}) and
  denominator (4: {0,2,4,8})**, **key signature (12)**, hand part (binary), beat, downbeat, tempo (200).
  Branches are cross-linked so subtasks inform each other.
- **Input encoding ablation — directly reusable finding**: best combination is
  **MIDI pitch one-hot + one-hot _onset-shift_ (Δ from previous onset, 10 ms bins, capped 4 s) + raw
  duration in seconds**. Note-level beat F rose from 79.9 (absolute raw onset) to **91.3** (one-hot
  onset shift). Onset representation is by far the most important input; "**onset shift leads to better
  results than absolute onset across all encoding combinations**."
- **Feature ablation**: omitting onset drops F 91.3 → 76.4; pitch → 90.6; duration → 90.1; velocity → 90.6.
- **Augmentation ablation** (all four help; total F 92.2): pitch shift ±12; **tempo change ratio
  0.8–1.2 (most beneficial)**; note removal from concurrent groups; extra concurrent notes at ±12.
- Beat matching tolerance **±50 ms**; beat-level F-measure tolerance **±70 ms**.
- Beat-level results: baseline (SOTA audio beat tracker retrained on pianoroll) F_beat 66.9 / F_downbeat
  57.6 → proposed 85.7 / 63.3 → **86.2 / 69.8 when tempo is added as a joint output** (joint learning helps).
- **MV2H vs commercial software** — the headline table:
  | | F_pitch | F_voice | **F_metre** | F_noteval | F_harmony | **F avg** |
  |---|---|---|---|---|---|---|
  | Finale v27 | 82.2 | 54.6 | **9.9** | 92.2 | 86.2 | 65.0 |
  | MuseScore v3 | 10.0 | 65.0 | **15.3** | 95.0 | 84.5 | 54.0 |
  | Proposed | 99.8 | 87.0 | **61.7** | 99.9 | 91.1 | **87.9** |
- **Diagnosis of why the commercial tools fail** — quote: MuseScore's low scores are "caused by time
  shifts introduced when **quantising notes according to a constant tempo estimated over the whole music
  piece**. Constant tempo estimation also caused its low performance reported on F_me. A similar
  limitation can be found in output scores from Finale."
  ⇒ **A single global tempo is the #1 cause of bad commercial notation output.** Track a tempo curve.
- Honest limitation: "the rhythm quantisation performance (F_me) is far from satisfactory. Some typical
  errors include **double/half tempo error** and errors introduced by **missing/extra beat predictions**."

### 14.3 Wachter, Murgul, Heizmann (Klangio) — transformer rhythm quantization, 2025/2026

arXiv **2508.19262**, **2604.22290** **[P]** — see §12. Key transferable points:

- T5 with **beat-aware tokenization**; pipeline accepts "beat estimations **or ground truth beats**."
- "capable of leveraging **metronome information**, which entails the possibility of **completely
  eliminating the uncertainty of beat estimations**."
- **Onset F1 97.3 %, note-value accuracy 83.3 %** (ASAP); MUSTER ε_onset **12.30 %** vs 15.55–68.28 %;
  ε_offset 28.30 %. Beats Nakamura HMM (22.58–25.02 % onset error).
- Note the gap between onset F1 (97 %) and note-value accuracy (83 %): **durations/offsets are the hard
  part**, consistently, across every system in this report.

### 14.4 Related pointers not read in depth

- Foscarin et al., "A Parse-Based Framework for Coupled Rhythm Quantization and Score Structuring"
  (MCM 2019) — https://link.springer.com/chapter/10.1007/978-3-030-21392-3_20 — quantization jointly with
  the notational tree (beaming/tuplet nesting). Relevant if we care about engraving quality. **[not read]**
- Nishikimi/Nakamura/Goto/Yoshii, "Audio-to-score singing transcription based on a **CRNN-HSMM hybrid
  model**", APSIPA Trans. — https://www.cambridge.org/core/journals/apsipa-transactions-on-signal-and-information-processing/article/audiotoscore-singing-transcription-based-on-a-crnnhsmm-hybrid-model/0AE8AEECB24DC3D9B689459E11DDA03F
  — the closest published _audio-to-score singing_ system; semi-Markov duration modelling. **[not read — highest-value next read]**
- Nakamura, Benetos, Yoshii, Dixon, "Towards Complete Polyphonic Music Transcription: Integrating
  Multi-Pitch Detection and Rhythm Quantization", ICASSP 2018. **[not read]**
- Cogliati, Temperley, Duan, "Transcribing Human Piano Performance into Music Notation", ISMIR 2016 —
  first full formulation of the task; HMM over Temperley's tactus-root model for metre + harmony + stream.

---

## 15. NeuralNote + Spotify basic-pitch — the open-source reference post-processing stack

### 15.1 basic-pitch (Bittner et al., ICASSP 2022, arXiv:2203.09893)

Source verified in `spotify/basic-pitch@main`, `note_creation.py`, `inference.py`. **[P — source read]**

- Defaults: `DEFAULT_ONSET_THRESHOLD = 0.5`, `DEFAULT_FRAME_THRESHOLD = 0.3`,
  `DEFAULT_MINIMUM_NOTE_LENGTH_MS = 127.7`.
- `output_to_notes_polyphonic`: onset peaks via `scipy.signal.argrelmax` above `onset_thresh`, then walk
  forward consuming `remaining_energy` for that bin **and its ±1 neighbours** until frame activation stays
  below `frame_thresh` for `energy_tol = 11` consecutive frames; drop if shorter than `min_note_len`.
- **`melodia_trick`** (default on) — the legato rescue: after normal onset-driven extraction, repeatedly
  `np.argmax` the whole residual `remaining_energy` matrix and, **with no onset activation required**,
  grow a note **both forward and backward** from that peak until it drops below `frame_thresh`, zeroing
  consumed energy as it goes; loop until nothing exceeds `frame_thresh`.
  ⇒ **recovers sustained notes whose onset was missed entirely.**
- **`get_infered_onsets`** (default on) — augments predicted onsets with onsets inferred from **frame
  activation derivatives**: forward differences at 1 and 2 frame offsets, negatives clipped to 0,
  rescaled to onset magnitude, element-wise max with the real onset head.
  ⇒ a second, cheap onset detector derived from the multipitch head.
- **Pitch-bend inference** (`get_pitch_bends`): per note, take a **±25 contour-bin** window
  (`n_bins_tolerance=25`) around the nominal pitch in the 3-bins-per-semitone contour posteriorgram,
  weight by a Gaussian (`std=5`), per-frame `argmax` → bend offset in 1/3-semitone units;
  MIDI export scales by `PITCH_BEND_SCALE=4096` over ±2 semitones, clipped. `multiple_pitch_bends=False`
  by default (overlapping notes lose bends unless split across channels).
- Paper claim: frame-level accuracy "only marginally below" specialised single-instrument SOTA;
  note-level "substantially better than a comparable baseline".

### 15.2 NeuralNote (DamRsn/NeuralNote) — the parameter design is the lesson

Source verified: `Lib/Model/BasicPitch.cpp`, `Lib/Model/Notes.h`, `Lib/MidiPostProcessing/NoteOptions.*`,
`NeuralNote/Source/ParameterHelpers.h`, `TimeQuantizeOptions.h`, `TranscriptionManager.cpp`. **[P — source read]**

```cpp
mParams.frameThreshold = 1.0f - inNoteSensitivity;   // UI "Note Sensitivity" 0.05–0.95, default 0.70
mParams.onsetThreshold = 1.0f - inSplitSensitivity;  // UI "Split Sensitivity" 0.05–0.95, default 0.50
mParams.minNoteLength  = round(inMinNoteDurationMs/1000 / (FFT_HOP/BASIC_PITCH_SAMPLE_RATE));
mParams.pitchBend      = MultiPitchBend;   // always
mParams.melodiaTrick   = true;             // always
mParams.inferOnsets    = true;             // always
```

- The two raw thresholds are surfaced as **inverted, musically-named sensitivities**, with the source
  comments spelling out the user-facing semantics: `/* Confidence threshold (0.05 to 0.95, More-Less
notes) */` and `/* Note segmentation (0.05 - 0.95, Split-Merge Notes) */`.
  ⇒ **Ship "more/fewer notes" and "split/merge" sliders, not "onset_threshold".**
- **Minimum Note Duration**: 35–580 ms, **default 125 ms** (matches basic-pitch's 127.7 ms and Tony's ~100 ms).
- **Min/Max MIDI note** (21–108) as a pure post-filter — a cheap, effective range prior.
- **Key/scale snap** (`NoteOptions.cpp`): given root + scale, either `SnapMode::Remove` (drop out-of-key
  notes) or snap to nearest in-key semitone, **direction chosen by the sign of the note's accumulated
  pitch bend** (`adjust_up = sum(bends) >= 0`). ⇒ neat: use the detected bend as the tie-breaker.
- **Time quantization is soft**: a continuous **Quantization Force 0.0–1.0** blending raw time toward the
  grid, plus a `TimeDivision` choice. Inside a DAW it reads host tempo/time-signature from
  `AudioPlayHead::PositionInfo`. ⇒ **"how hard to quantize" as a user slider**, not a binary.
- Pipeline order: basic-pitch → key/scale snap + min/max filter → time quantize → drop overlapping
  pitch bends → merge overlapping same-pitch notes → synth/MIDI export.
- **Why it can't be real-time**, from the README (a direct constraint on any streaming design we attempt):
  "Basic Pitch uses the Constant-Q transform (CQT) as input feature. The CQT requires really long audio
  chunks (>1s)… The basic pitch CNN has an additional latency of approximately 120ms. The note events
  creation algorithm processes the posteriorgrams **backward (from future to past)** and is hence
  **non-causal**."
- User sentiment: "really good, and free… far from perfect with things like guitars, but much closer than
  other things I've tried." https://www.kvraudio.com/forum/viewtopic.php?t=611044 **[P — forum]**

### 15.3 ByteDance high-resolution piano transcription (Kong et al., arXiv:2010.01815, TASLP 2021)

**[P — ar5iv full text]**

- Replace framewise binary onset/offset classification with a **continuous regression target: how far each
  frame is from its nearest onset/offset**. Binary labels cap timing resolution at the hop size (~32 ms).
- **The quantified argument**: with labels randomly shifted ±50 ms (simulating annotation misalignment),
  classification F1 collapses **93.92 % → 76.52 %**, while regression holds at **96.39 %**.
  ⇒ regression targets are dramatically more robust to noisy onset labels — directly relevant if we ever
  train on human-annotated or weakly-aligned data.
- Inference: find local maxima of the regression curve; from the three neighbouring frame values around
  the peak, **analytically solve for the sub-frame time** at which the curve would be symmetric.
  ⇒ sub-hop timing precision without a smaller hop.
- MAESTRO: onset F1 **96.72 %** (vs 94.80 % Onsets-and-Frames), note-with-offset **82.47 %** (vs 79.67 %),
  +velocity **80.92 %** (vs 76.04 %), **pedal onset F1 91.86 %**. Pedal head = same formulation, T×1.
  https://github.com/bytedance/piano_transcription

---

## 16. Query-by-humming and consumer apps — the contour-normalisation and known-reference tricks

### 16.1 SoundHound / Midomi — retrieval, not transcription

- Patents e.g. **US9396257B2**, **US8116746B2** ("Query by humming for ringtone search and download").
  Pipeline: pitch tracking + note segmentation via "**energy contour segmentation and pitch variation
  segmentation**", then each note reduced to a **triplet: (contour direction up/down relative to previous
  note, interval magnitude, duration)**. **[P — patent text]**
- ⇒ The representation is **relative/contour-based, not absolute pitch or absolute tempo.** That is the
  whole reason an off-key, off-tempo hum still matches. Transferable to _our_ fuzzy matching / "did the
  user mean this melody" features, and to key/tempo-invariant similarity checks.
- "Sound2Sound" as a SoundHound product name: **not found — do not repeat.** **[X]**
- Broader QBH literature agrees: extract melodic contour → normalise tempo and key → compare against a
  contour DB (e.g. arXiv:2302.04577).

### 16.2 Consumer pitch apps — they all avoid transcription entirely

- Simply Piano, Yousician, Sing Sharp, Smule all score against a **known reference melody**, never open
  transcription. Simply Piano: "real-time note detection that **validates pressed notes against what the
  learner is meant to play**." Yousician "quantif[ies] both pitch and timing **against lesson targets**."
  **[S — third-party comparisons, not vendor engineering blogs]**
- Yousician/Simply Piano documented (secondhand) as **FFT-based** mic pitch analysis; "struggles with
  background noise and fast polyphonic passages." **[T]**
- Sing Sharp's "See Your Pitch™" real-time curve is noted as "**less sensitive than a typical chromatic
  tuner**" — i.e. **deliberately widened tolerance bands** so vibrato and natural wobble aren't penalised.
  ⇒ a UX answer to a DSP problem. **[T]**
- Smule lineage traces to the classic Auto-Tune patent **US5973252A** (autocorrelation pitch detection +
  resampling) and **US10930256B2** ("social music system with continuous real-time pitch correction"). **[P — patents]**
- Real-time consumer apps favour **autocorrelation/YIN over CREPE/basic-pitch** for latency reasons,
  with EMA smoothing "to reduce perceptual jitter without introducing perceptible latency." Consistent
  with NeuralNote's non-causality explanation above. **[T]**

### 16.3 Samplab

- Positioned as a Melodyne-style **note-level polyphonic audio editor** ("edit polyphonic audio as if it
  were MIDI, while preserving the original timbre"), not a notation tool. **No published paper or model
  description — treat any architecture claim as unverifiable.** **[X / thin]**
- Pricing via aggregators (samplab.net 403'd): free (10 s, mono), ~$7.99/mo (100 s, stereo), ~$9.99/mo.
- Complaints: drag-and-drop into Logic/Mixcraft; "vocal pitch fidelity below Melodyne's". **[T]**

### 16.4 iZotope RX Music Rebalance

- Source separation for de-mixing, not transcription. UX: four sliders (Vocals/Bass/Drums/Other) +
  a global Quality setting.
- **No public documentation of the model/architecture.** Do not assert a method. **[X / thin]**
- No published SDR numbers. Qualitative RX 11 reviews are positive vs earlier versions; too-high
  sensitivity → artifacts, too low → residual bleed.
- Relevance to us: **optional vocals-from-mix preprocessing** if we ever accept full mixes. Given every
  competitor explicitly scopes to solo sources, this is a later-stage concern.

### 16.5 "Waves Hummingbird" / "Waves Sonic apps" for hum-to-score

**No evidence these exist. [X]** Waves has no such plugin; the only "Hummingbird" on the market is
Prominy's acoustic-guitar sample library. Waves' relevant products are Waves Tune (vocal pitch
correction) and OVox (vocal-to-synth) — neither is hum-to-notation.

---

## 17. Cross-product synthesis: the three universal sidesteps

Every product surveyed does the same three things:

1. **Restrict scope.** Monophonic-only is the default and best-supported path everywhere (VariAudio,
   Flex Pitch, Ableton Convert Melody, Melodyne Melodic, Klangio's whole product line, StaffPad's
   piano-only, AudioScore's mic mode). Polyphony is a separate, degraded, or paid path.
2. **Push context-gathering onto the user, before or after analysis.** Declare key/scale (Cubase Scale
   Assistant, Melodyne "Snap to Chord Scale", NeuralNote key snap); declare tempo/time-signature before
   recording (AudioScore, StaffPad); tap the beats afterwards (AnthemScore, ScoreCloud Tap Beat);
   record clean/dry/mono with clear attacks (Ableton and Steinberg docs both say this explicitly).
3. **Make the correction surface the product, not the detection.** Editable segments/blobs/notes with
   direct manipulation, a "snap everything" bulk action, and an explicit mode for correcting the
   _analysis_ separately from the _audio_ (Melodyne Note Assignment Mode + Assign Tempo Mode;
   Tony's note vs pitch-track layers; ScoreCloud's Edit Rhythm / Drag Barlines).

Nobody claims automatic accuracy. Melodyne says so in its own manual.

---

## 18. Transferable techniques, ranked by expected value for us

**Tier 1 — do these; high value, low cost, directly evidenced**

1. **Optimise for merge-not-split; over-segment deliberately.** Tony measured Split at 5.6 s and Create
   at 145 s of user time vs Join 3.2 s / Delete 3.5 s, and concluded "high onset recall is more important
   than high onset precision." Tune thresholds toward recall, then make Join/Delete one keystroke each.
   _(§13.5)_
2. **Add pYIN's amplitude-ratio onset splitter + minimum-duration pruning.** ~15 lines: r = a₍ᵢ₊₁₎/a₍ᵢ₋₁₎,
   if 1/r < s mark frame i−2 unvoiced (splits, never creates); then prune < ~100–125 ms. Measured
   COnPOff F 0.38 → 0.50 with no model change. Sweep s ∈ [0.6, 0.8]. _(§13.3–13.4)_
3. **Derive note pitch as the median of the underlying pitch contour, and never let it be edited
   independently.** Tony's two-layer model (notes carry only time; pitch is computed) eliminates an
   entire class of inconsistency and makes note edits cheap. _(§13.6)_
4. **Estimate a tempo _curve_, never a single global tempo.** Measured: this is the single biggest cause
   of MuseScore's and Finale's bad output (F*metre 15.3 and 9.9 vs 61.7). *(§14.2)\_
5. **Condition rhythm quantization on an explicit beat/downbeat grid**, and make that grid a first-class,
   user-editable object (Melodyne's Assign Tempo Mode / ScoreCloud's Drag Barlines / AnthemScore's beat
   markers). Do not let quantization and beat inference be one opaque step. _(§14.2, §14.3)_
6. **Ship "more/fewer notes" and "split/merge" sliders**, implemented as inverted frame/onset thresholds,
   plus a minimum-note-duration control (default ~125 ms). Copy NeuralNote's naming; it's the same two
   thresholds every system has, just made musical. _(§15.2)_
7. **Use a metrical (beat-position) state space, not a note-value chain**, for the notation step.
   Nakamura measured that note-value models emit ungrammatical rhythms ("triplets that appear in single
   or two notes without completing a unit of beat") while metrical models don't. Ungrammatical rhythm is
   catastrophic _visually_ even when numerically close. _(§14.1)_
8. **Encode onsets as one-hot Δ-from-previous-onset, not absolute time**, wherever a model consumes note
   sequences. Measured beat-tracking F 79.9 → 91.3. Onset is by far the most informative feature. _(§14.2)_

**Tier 2 — high value, more work**

9. **Offer a reference click / user-declared tempo as an explicit "easy mode", and exploit it hard.**
   Klangio: metronome information "entails the possibility of completely eliminating the uncertainty of
   beat estimations." AudioScore and StaffPad both simply require tempo up front. Concretely: a count-in
    - click recording path that skips beat inference entirely, alongside a free-tempo path.
10. **Separate pitch _drift_ from _vibrato_ by rate, and only correct drift.** Melodyne: drift is "slow
    wavering… symptomatic of poor technique" while "More rapid fluctuations… such as pitch modulation or
    vibrato, remain unaffected." Same decomposition in Flex Pitch's per-note drift-start/drift-end/vibrato
    handles. This is what makes correction sound musical rather than robotic. _(§1.4, §3)_
11. **Attack-vs-stable variance in the note model.** pYIN uses σ = 5 semitones for attack states and
    σ = 0.9 for stable states. This single asymmetry is how you tolerate scoops and portamento without
    fragmenting the note. Cheap to replicate in any HMM/CRF post-processing layer. _(§13.2)_
12. **Key/scale snapping with user-declared key.** Nobody auto-detects key reliably enough to snap
    silently; every shipped implementation snaps to a **declared** scale (Cubase Scale Assistant, Melodyne
    "Snap to Chord Scale", NeuralNote root+scale). Offer detected-key-as-default-suggestion, snap only on
    confirmation, and use the note's pitch-bend direction as the tie-breaker for which neighbour to snap
    to (NeuralNote's trick). _(§1.4, §2, §15.2)_
13. **Soft quantization strength as a slider (0–100 %), not a binary snap.** NeuralNote's Quantization
    Force and Melodyne's Correct Pitch percentage both blend rather than snap; Melodyne additionally
    applies correction non-uniformly ("At lower settings it affects only those notes that are wildly out
    of tune"). _(§1.4, §15.2)_
14. **Never clobber manual edits.** Melodyne: "notes that have been tuned manually are not affected by the
    macro" unless opted in. Any re-run of detection or quantization must preserve user decisions. _(§1.4)_
15. **Present alternative interpretations instead of a single answer.** Tony re-decodes 13 Gaussian-
    reweighted pitch tracks over a user-selected interval, dedupes at 80 % overlap, and lets the user
    pick — an octave-error fix that costs one click. Analogue for us: alternate time signatures
    (the 6/8-vs-2/4-with-triplets failure ScoreCloud exhibits), alternate half/double tempo (a named
    failure mode in Liu et al.), alternate enharmonic keys. _(§13.6, §6.2, §14.2)_
16. **Sonify both the raw pitch contour and the quantized notes, independently toggleable.** Tony's
    authors built this because ear-based error-spotting is faster than eye-based; synthesis is not
    constrained to integer MIDI. We already have playback — the missing piece is A/B'ing _interpretation_
    against _performance_.

**Tier 3 — worth knowing, situational**

17. **Melodia trick / backward-growing note recovery** for sustained notes with missed onsets — already
    in basic-pitch and always-on in NeuralNote. If we use basic-pitch, confirm it's enabled; if we roll
    our own, replicate it. _(§15.1)_
18. **Onset inference from frame-activation derivatives** as a free second onset detector
    (`get_infered_onsets`). _(§15.1)_
19. **Regression-of-time-to-onset targets** instead of framewise binary classification, if we train
    anything ourselves — measured 96.39 % vs 76.52 % F1 under ±50 ms label noise, and gives sub-hop
    timing via a 3-point analytic peak solve. Highly relevant if our training labels are weakly aligned.
    _(§15.3)_
20. **A recording-quality → expected-accuracy model as a UX gate.** Klangio published exactly this
    (ICSM 2022, "Estimation of Music Recording Quality to Predict Automatic Music Transcription
    Performance"). Warn before transcribing, or route to a different pipeline. Cheap, differentiating,
    and reduces support load and refund requests. _(§12)_
21. **Per-instrument models over one generic model.** Klangio's stated rationale: "An AI model trained
    exclusively on piano music will theoretically outperform a generic, one-size-fits-all model."
    They also publish procedural/synthetic data generation + small real fine-tune as the way to afford it.
    _(§12)_
22. **Restrict detection to a user-selected reliable subset when re-running analysis.** Melodyne ships
    "Detect Tempo of Selection and Merge with Current Tempo" — the user picks the rhythmically solid
    passage and the grid is re-derived from it. Very cheap to implement, disproportionately useful on
    rubato intros. _(§1.5)_
23. **A "free tempo" escape hatch** for passages that genuinely have no pulse — Melodyne's Free Tempo
    Assignment replaces detection with a constant line. Better than fighting a bad grid. _(§1.5)_
24. **Contour-relative (direction, interval, duration) triplet representation** for any fuzzy melody
    matching we do — SoundHound's patented QBH normalisation, key- and tempo-invariant by construction.
    _(§16.1)_
25. **A user-drawn "just do what I mean in this box" tool** — Tony's time-pitch rectangle with a harmonic
    product spectrum fallback. The last-resort escape that prevents rage-quitting. _(§13.6)_
26. **If any part of the product can assume a known target melody** (sing-along, practice, "transcribe
    this melody I'm teaching you"), the problem collapses from open transcription to reference matching
    with a widened tolerance band — which is what _every_ consumer pitch app does. Enormously easier.
    _(§16.2)_

**Explicit anti-patterns, evidenced**

- **Do not segment notes from transients alone.** Ableton does, and documents the consequence: "notes
  that fade in or 'swell' may not be detected by the conversion process." Fatal for legato singing.
- **Do not quantize to a single global tempo.** Finale/MuseScore F_metre 9.9/15.3.
- **Do not require the user to Create notes.** 145 s each, measured.
- **Do not overstate accuracy.** AnthemScore's own page shows how an impressive-looking 99.2 % is really
  60.3 % under a strict measure and F ≈ 0.8 end-to-end; its 1-star reviews are all expectation gaps.
  Klangio's complaints are users applying a solo-instrument product to full-band mixes.
- **Do not promise real-time with a CQT/CNN front-end.** NeuralNote's README explains why it's
  impossible: >1 s CQT chunks, ~120 ms CNN latency, and non-causal backward posteriorgram decoding.

---

## 19. Open questions / where evidence is genuinely thin

- **VariAudio, Flex Pitch, Ableton Convert Melody, Samplab, iZotope Music Rebalance**: no published
  algorithm or patent found for any of them. Everything above about their internals is inferred from
  documented behaviour and limitations, not from primary algorithmic sources.
- **The Ableton ← Zynaptiq/Rolland attribution is unsupported** and probably false (Rolland is Steinberg).
  Ableton credits Cytomic for the Glue Compressor but credits nobody here.
- **Neuratron/AudioScore**: no confirmed patent; the strongest complaints are search-summarised only
  (forum 403s).
- **ScoreCloud/DoReMIR**: no patents (checked, zero results), and no paper describing the _product_
  algorithm — only Ahlbäck's cognition research as the acknowledged basis. The most interesting
  competitor is also the least documented.
- **Melodyne's monophonic (Melodic) algorithm specifically**: EP2099024 covers the _polyphonic_ DNA
  method. I did not locate a separate patent for the monophonic pitch tracker, which predates it (1997+).
- **Tony's stated ±5 ms COnPOff onset tolerance** is almost certainly a typo for Molina et al.'s standard
  ±50 ms. Do not benchmark against ±5 ms on the basis of that paper alone.
- **Not yet read, highest-value next reads**: Nishikimi et al., audio-to-score singing transcription with
  a **CRNN-HSMM hybrid** (APSIPA) — the closest published system to our exact problem; and Foscarin et
  al.'s parse-based coupled quantization + score structuring (MCM 2019) for engraving-quality output.
