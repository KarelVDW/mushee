# Design: take-key fallback for spelling (E8 — R2 + R14/R18)

Per `plan-plugin-improvements.md` E8, written before the code. Sources:
`research-plugin-sources.md` §12.3 (TalentedHack's two masks), §7.3 (Essentia `Key`: profile as a
parameter, abstain as a class), §8.2 (libKeyFinder: abstain competes as a candidate), §1.1
(MXTune: key estimation from the take).

## The two masks (§12.3) — and which one this feature is

TalentedHack's correction to the original R2 spec: _interpretation_ (which note did the singer
intend? governed by the key they are singing in) and _spelling_ (how is it written? governed by
the score's key signature) are different jobs with different masks, and they may legitimately
disagree — D-dorian improvisation over a C-major score is not an error to reconcile.

- The **interpretation mask** (take-key steering the _decode_) is the score-as-pitch-prior family,
  **parked deliberately** (§17c). Nothing here touches the decoder. Zero pitch changes in the diff.
- The **spelling mask** is what this feature supplies — and only as a **fallback**: when the score
  carries a key signature, `keyFifths` stays absolutely authoritative, exactly as today. The
  take-key is consulted **only when `keyFifths` is absent** (no score key at recording start).
  It never overrides a present score key, however confident it is.

## The estimator

`estimateTakeKeyClasses(notes, offsetCents, profile)` in `voice-notation.ts`:

1. **Duration-weighted pitch-class histogram** over the offset-normalised fractional pitch
   (`pitchMidiFloat − offset/100`, rounded) — the same inputs `chooseNamingOffset` already reads,
   so the estimate lives on the take's own tuning grid.
2. **24-template correlation** (12 major + 12 minor rotations), Pearson (zero-mean both sides).
   The **profile is a parameter** (§7.3): `'krumhansl'` (Krumhansl–Kessler), `'temperley'`,
   `'diatonic'` (binary). Default `'krumhansl'`; the point is the parameter, not the winner.
3. **Abstain competes as a candidate** (§8.2): the all-zeros profile — Pearson score 0 — is seeded
   as the incumbent, so a key is returned **only if some rotation correlates positively**. No
   confidence threshold to tune; a chromatic or modal take simply fails to beat "no key at all"
   and the pipeline behaves exactly as today (offset-normalised rounding, no snapping).
4. A minor winner contributes its **relative major's pitch-class set** — the set is what a key
   signature denotes, and `spellMidi`/`chooseNamingOffset` consume only the set.

## Wiring

`MxmlBuilder.buildMeasure`: where `keyClasses` is currently `null` for a voice take without
`keyFifths`, it becomes the estimator's result (or stays `null` on abstain). Everything downstream
(`chooseNamingOffset`'s naming vote, `spellMidi`'s ambiguity-band snap, `KEY_SNAP_MIN_DEV`) is
unchanged. Instrument takes without `pitchMidiFloat` are untouched as before; with E1's floats
they participate identically.

## Judged on the page, not on F1

`bench-take-key.ts` on the Batch 2 intonation tier (per-note detune, truth = intended notes):
onset-matched **spelling error** (written midi ≠ intended midi) and **accidentals written per 100
notes** (the readability counter — the melodies are diatonic, so every accidental is spurious),
take-key fallback ON vs OFF, per detune dose. The target slice — sung key ≠ score key — is the
fallback case itself: these takes carry **no** score key, which is exactly when the estimator is
consulted. Seconds-based F1 is not consulted (metric conventions: it cannot evaluate the notation
stage).
