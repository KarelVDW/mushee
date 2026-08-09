/**
 * Notation-layer pitch SPELLING for sung takes.
 *
 * ## The problem this solves (and where it must NOT be solved)
 *
 * A singer with no pitch reference lands between piano keys: a real take of
 * Frère Jacques measured its scale degrees at MIDI 46.45 / 48.65 / 50.65 —
 * intervals near-perfect, but every degree ~65 cents off the A440 grid.
 * Naming each note by nearest absolute key then scatters one diatonic melody
 * across chromatic neighbours (D vs D♯ flips note-by-note), which is the
 * chromatic soup the user sees.
 *
 * The fix is a SPELLING policy, so it lives at the notation layer
 * (`MxmlBuilder`), deliberately NOT in the decoder or extractor: the eval
 * harness scores decoder output against absolute measured-pitch truth, where
 * "correcting" toward the singer's own grid is measurably wrong
 * (research-voice-transcription.md §5 — per-note scatter, not drift, dominates,
 * and tuning correction hurts against A440 truth). Writing the melody the
 * singer meant is a product question the eval structurally cannot reward; §5
 * routes exactly these two levers to the product track:
 *
 *  1. **Per-take tuning normalization** — estimate the take's deviation from
 *     the keyboard grid (Dressler & Streich's circular mean, ISMIR 2007) and
 *     shift before naming. One constant per take: per-note correction was
 *     measured as noise-adding, a global constant was not.
 *  2. **Key-aware snapping** — for the notes still sitting in the ambiguous
 *     band between two keys after normalization, prefer the neighbour that is
 *     in the score's key signature. Only inside the ambiguity band: a
 *     confidently-sung accidental must survive (users do sing chromatic
 *     lines on purpose).
 *
 * Both act on the FRACTIONAL pitch (`pitchMidiFloat`) the voice decoder
 * attaches to its notes; notes without it (instruments, basic-pitch) pass
 * through untouched, so nothing here can move an instrument take.
 */

/** Carried alongside `pitchMidi` by the voice decoder; survives the extractor
 *  because every note-rewriting step spread-copies (`{ ...note }`). */
export interface FractionalPitch {
  /** Unrounded MIDI (α-trimmed contour mean / 100 cents). */
  pitchMidiFloat?: number;
}

/**
 * Deviation-from-nearest-key a note must exceed before key snapping may move
 * it to the other neighbour. 0.35 semitones keeps confident notes untouchable:
 * after tuning normalization a deliberately-sung accidental sits near the
 * grid (|dev| ≈ 0), far outside the band.
 */
const KEY_SNAP_MIN_DEV = 0.35;

/** Minimum resultant length of the circular mean before the offset is trusted.
 *  A take whose deviations point every which way (|z̄| below this) gets offset
 *  0 — i.e. plain absolute spelling, today's behaviour. */
const MIN_OFFSET_CONFIDENCE = 0.5;
const MIN_NOTES_FOR_OFFSET = 4;

/**
 * The take's tuning offset from the keyboard grid, in cents (−50 … +50).
 *
 * Dressler & Streich's circular mean: each note's deviation-mod-semitone
 * becomes a unit vector on the circle (one semitone = one full turn), vectors
 * are summed weighted by duration (long notes are sung with intent; grace
 * fragments are not), and the mean angle is the offset. Circular because a
 * take straddling the ±50-cent seam must not average to nonsense.
 */
export function estimateTuningOffsetCents(
  notes: ReadonlyArray<FractionalPitch & { durationSeconds: number }>,
): number {
  let re = 0;
  let im = 0;
  let weight = 0;
  let counted = 0;
  for (const n of notes) {
    if (n.pitchMidiFloat === undefined) continue;
    const angle = 2 * Math.PI * (n.pitchMidiFloat - Math.round(n.pitchMidiFloat));
    const w = Math.max(0.05, n.durationSeconds);
    re += w * Math.cos(angle);
    im += w * Math.sin(angle);
    weight += w;
    counted += 1;
  }
  if (counted < MIN_NOTES_FOR_OFFSET || weight <= 0) return 0;
  const resultant = Math.hypot(re, im) / weight;
  if (resultant < MIN_OFFSET_CONFIDENCE) return 0;
  return (Math.atan2(im, re) / (2 * Math.PI)) * 100;
}

/** Pitch classes of the major key with `fifths` sharps (negative = flats) —
 *  the pitch-class set is what a key signature denotes, so minors share it. */
export function keyPitchClasses(fifths: number): Set<number> {
  const tonic = (((fifths * 7) % 12) + 12) % 12;
  return new Set([0, 2, 4, 5, 7, 9, 11].map((d) => (tonic + d) % 12));
}

/**
 * Break the ±1-semitone NAMING ambiguity of a reference-free take.
 *
 * The tuning grid mod one semitone is unique, but its name is not: a take sung
 * 41 cents flat of B fits the B-grid exactly as well as the B♭-grid (they are
 * the same lattice, one semitone apart in name). `estimateTuningOffsetCents`
 * returns the minimal shift; when that shift is large enough that the other
 * name is nearly as close (|offset| > 30 cents) and a key signature is known,
 * let the key choose: the naming under which more of the take (duration-
 * weighted) is diatonic wins. Ties keep the minimal shift.
 */
export function chooseNamingOffset(
  notes: ReadonlyArray<FractionalPitch & { durationSeconds: number }>,
  offsetCents: number,
  keyClasses: Set<number> | null,
): number {
  if (!keyClasses || Math.abs(offsetCents) <= 30) return offsetCents;
  const other = offsetCents - 100 * Math.sign(offsetCents);
  const inKeyWeight = (off: number): number => {
    let w = 0;
    for (const n of notes) {
      if (n.pitchMidiFloat === undefined) continue;
      const midi = Math.round(n.pitchMidiFloat - off / 100);
      if (keyClasses.has(((midi % 12) + 12) % 12)) w += Math.max(0.05, n.durationSeconds);
    }
    return w;
  };
  return inKeyWeight(other) > inKeyWeight(offsetCents) ? other : offsetCents;
}

/**
 * The take's uniform GRID PHASE, in beats (0, 0.25, 0.5 or 0.75) — the rhythm
 * twin of the tuning offset.
 *
 * A singer tracking a click lands a consistent ~100–150 ms behind it (vocal
 * onset lag), which at 120 BPM snaps every onset to the off-beat 16th: each
 * quarter then straddles a beat boundary and is WRITTEN as a tied
 * 16th+8th+16th chain behind a leading 16th rest — rhythm soup for a take
 * whose timing was perfectly consistent. Detected the same way the pitch
 * problem was: not per note, but as one take-level constant.
 *
 * Chosen by NOTATION COST, the same principle the metrical duration speller
 * runs on: an on-beat onset writes cleanly (cost 0), a half-beat offset costs
 * a little (1), a 16th offset costs the most (2 — it forces leading rests and
 * tie chains). The shift that at least HALVES the take's total cost wins;
 * anything less keeps the performance as sung. Genuinely syncopated music has
 * mixed phases, so no single shift can halve its cost — it is structurally
 * protected, not threshold-protected. (A supermajority vote was tried first
 * and failed on the real take: singers re-synchronize at phrase starts, so a
 * handful of on-beat phrase heads dilute any per-class majority.)
 */
export function estimateGridPhaseBeats(
  notes: ReadonlyArray<{ startTimeSeconds: number; durationSeconds: number }>,
  bpm: number,
): number {
  if (notes.length < 4) return 0;
  // Syncopation cost by phase class (16ths within one beat): 0, ¼, ½, ¾.
  const COST = [0, 2, 1, 2];
  const weight = [0, 0, 0, 0];
  for (const n of notes) {
    const beat = (n.startTimeSeconds * bpm) / 60;
    const phase = Math.round(((beat % 1) + 1) * 4) % 4;
    weight[phase] += Math.max(0.05, n.durationSeconds);
  }
  const costAt = (shift: number): number =>
    weight.reduce((sum, w, phase) => sum + w * COST[(phase - shift + 4) % 4], 0);
  const asSung = costAt(0);
  let best = 0;
  let bestCost = asSung;
  for (const shift of [1, 2, 3]) {
    const c = costAt(shift);
    if (c < bestCost) {
      bestCost = c;
      best = shift;
    }
  }
  return best !== 0 && bestCost <= 0.5 * asSung ? best / 4 : 0;
}

/**
 * The written MIDI for one note: normalize by the take offset, round, and let
 * the key vote only inside the ambiguity band.
 */
export function spellMidi(
  note: FractionalPitch & { pitchMidi: number },
  offsetCents: number,
  keyClasses: Set<number> | null,
): number {
  if (note.pitchMidiFloat === undefined) return note.pitchMidi;
  const x = note.pitchMidiFloat - offsetCents / 100;
  let midi = Math.round(x);
  const dev = x - midi;
  if (keyClasses && Math.abs(dev) >= KEY_SNAP_MIN_DEV) {
    const alt = midi + Math.sign(dev);
    const midiInKey = keyClasses.has(((midi % 12) + 12) % 12);
    const altInKey = keyClasses.has(((alt % 12) + 12) % 12);
    if (!midiInKey && altInKey) midi = alt;
  }
  return midi;
}
