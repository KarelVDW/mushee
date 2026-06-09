import { NoteEventTime } from '@spotify/basic-pitch';

/**
 * Common note lengths in beats, matching the front-end Duration table.
 * Order doesn't matter for snapping; we pick whichever is closest.
 */
const STANDARD_DURATION_BEATS = [4, 3, 2, 1.5, 1, 0.75, 0.5, 0.25];

/** Below this length the note is treated as noise. In beats. */
const MIN_DURATION_BEATS = 0.25;

/**
 * When two notes overlap, the new one only displaces the active one if it's
 * this much louder. Smaller overlaps just get dropped, so a quiet ghost note
 * doesn't carve a real one in two.
 */
const AMPLITUDE_OVERRIDE_RATIO = 1.5;

/**
 * Per-granularity penalty added to the snap distance, biasing the snap
 * toward coarser positions when fits are similar. Units: beats.
 */
const GRID_PENALTIES = [
  { divisor: 1, penalty: 0 }, // integer beats
  { divisor: 2, penalty: 0.05 }, // half beats
  { divisor: 4, penalty: 0.1 }, // quarter beats
  { divisor: 8, penalty: 0.15 }, // eighth beats
  { divisor: 16, penalty: 0.2 }, // sixteenth beats
];

/** Max time gap between two notes that are candidates for merging. In beats. */
const MERGE_MAX_GAP_BEATS = 0.25;

/** Max slight overlap the two notes may already have. In beats. */
const MERGE_MAX_OVERLAP_BEATS = 0.1;

/** Merge is allowed across this much pitch drift. */
const MERGE_MAX_PITCH_DIFF = 1;

/**
 * A note flanked by neighbors at least this many semitones away on both sides
 * (and both in the same direction) is treated as a basic-pitch octave/range
 * error and dropped. Seven = a perfect fifth — legitimate melody rarely spikes
 * that far and back in one step.
 */
const OUTLIER_PITCH_DIFF_SEMITONES = 7;

/**
 * Pitch-trajectory providers release a note early — confidence decays before
 * the next attack — so a legato note's measured length floor-snaps roughly a
 * grid step short of the next onset, leaving a spurious rest. When the gap from
 * a note's sounding end to the next onset is at most this, we treat it as that
 * release artifact and extend the note to fill the seam. Larger gaps are real
 * silence the player left and stay rests. In beats.
 */
const SEAM_FILL_BEATS = 0.3;

export interface ExtractOptions {
  bpm: number;
  /**
   * Audio onset times (seconds) from `OnsetDetector`. When supplied, a single
   * sustained note that spans more than one onset is split back into the
   * separate notes that were re-articulated — recovering repeated same-pitch
   * notes the trajectory providers can't see. Omit to disable splitting.
   */
  onsetTimesSec?: number[];
}

export interface ExtractedNotes {
  /** Notes straight from the upstream provider — noisy, possibly overlapping. */
  raw: NoteEventTime[];
  /** Monophonic, beat-aligned, snapped to common note lengths. */
  deduced: NoteEventTime[];
}

/**
 * Provider-agnostic post-processor. Takes the raw note events emitted by a
 * `PitchProvider` and produces a monophonic stream whose starts and lengths
 * fit the front-end's score model:
 *   - one note at a time (overlap resolved by amplitude)
 *   - starts biased to integer beats, falling through halves/quarters/etc.
 *   - lengths snapped to {whole, dotted half, half, dotted quarter, quarter,
 *     dotted eighth, eighth, sixteenth}
 */
export class NoteExtractor {
  extract(raw: NoteEventTime[], options: ExtractOptions): ExtractedNotes {
    const monophonic = this.selectMonophonic(raw, options.bpm);
    const cleaned = this.filterPitchOutliers(monophonic);
    const merged = this.mergeAdjacent(cleaned, options.bpm);
    const split = this.splitAtOnsets(merged, options.onsetTimesSec);
    const deduced = this.alignAndQuantize(split, options.bpm);
    return { raw, deduced };
  }

  /**
   * Split a note wherever an audio onset lands clearly inside it (a re-attack
   * the pitch-trajectory providers smeared into one sustained note). Runs after
   * merging so genuine fragments are first rejoined, then only truly
   * re-articulated runs are separated. Each split keeps the parent's pitch and
   * amplitude; the inter-onset margin avoids spurious slivers.
   */
  private splitAtOnsets(
    notes: NoteEventTime[],
    onsetTimesSec: number[] | undefined,
  ): NoteEventTime[] {
    if (!onsetTimesSec || onsetTimesSec.length === 0) return notes;
    const MIN_SEGMENT_SEC = 0.06;
    const result: NoteEventTime[] = [];
    for (const note of notes) {
      const end = note.startTimeSeconds + note.durationSeconds;
      const interior = onsetTimesSec.filter(
        (t) =>
          t > note.startTimeSeconds + MIN_SEGMENT_SEC &&
          t < end - MIN_SEGMENT_SEC,
      );
      if (interior.length === 0) {
        result.push({ ...note });
        continue;
      }
      const boundaries = [note.startTimeSeconds, ...interior, end];
      for (let i = 0; i < boundaries.length - 1; i += 1) {
        result.push({
          ...note,
          startTimeSeconds: boundaries[i],
          durationSeconds: boundaries[i + 1] - boundaries[i],
        });
      }
    }
    return result;
  }

  /**
   * Greedy left-to-right selection: a new note displaces the previous one only
   * if it starts after the previous ended OR is meaningfully louder. Otherwise
   * it's discarded. Very short notes are dropped as noise.
   */
  private selectMonophonic(
    notes: NoteEventTime[],
    bpm: number,
  ): NoteEventTime[] {
    const beatsPerSecond = bpm / 60;
    const sorted = [...notes].sort(
      (a, b) =>
        a.startTimeSeconds - b.startTimeSeconds ||
        b.amplitude - a.amplitude ||
        a.pitchMidi - b.pitchMidi,
    );

    const result: NoteEventTime[] = [];
    for (const note of sorted) {
      if (note.durationSeconds * beatsPerSecond < MIN_DURATION_BEATS / 2) {
        continue;
      }
      if (result.length === 0) {
        result.push({ ...note });
        continue;
      }
      const prev = result[result.length - 1];
      const prevEnd = prev.startTimeSeconds + prev.durationSeconds;
      if (note.startTimeSeconds >= prevEnd) {
        result.push({ ...note });
        continue;
      }
      // Overlap. Accept only when meaningfully louder.
      if (note.amplitude > prev.amplitude * AMPLITUDE_OVERRIDE_RATIO) {
        prev.durationSeconds = Math.max(
          0,
          note.startTimeSeconds - prev.startTimeSeconds,
        );
        if (prev.durationSeconds <= 0) result.pop();
        result.push({ ...note });
      }
    }
    return result;
  }

  /**
   * Drop notes that spike far from both neighbors in the same direction —
   * classic symptom of basic-pitch mis-labeling the octave. We score every
   * note against its *original* neighbors first, then remove in one pass, so
   * consecutive outliers don't shield each other.
   */
  private filterPitchOutliers(notes: NoteEventTime[]): NoteEventTime[] {
    if (notes.length < 3) return notes;
    const outlierIndices = new Set<number>();
    for (let i = 1; i < notes.length - 1; i++) {
      const diffPrev = notes[i].pitchMidi - notes[i - 1].pitchMidi;
      const diffNext = notes[i].pitchMidi - notes[i + 1].pitchMidi;
      if (
        Math.sign(diffPrev) === Math.sign(diffNext) &&
        Math.abs(diffPrev) >= OUTLIER_PITCH_DIFF_SEMITONES &&
        Math.abs(diffNext) >= OUTLIER_PITCH_DIFF_SEMITONES
      ) {
        outlierIndices.add(i);
      }
    }
    return notes.filter((_, i) => !outlierIndices.has(i));
  }

  /**
   * Merge adjacent notes with same-or-near pitch (within a semitone) and a
   * small time gap iff merging gives us a cleaner bias fit than keeping them
   * separate. Catches basic-pitch splitting a held note into near-duplicates.
   */
  private mergeAdjacent(
    notes: NoteEventTime[],
    bpm: number,
  ): NoteEventTime[] {
    const beatsPerSecond = bpm / 60;
    const result: NoteEventTime[] = [];
    for (const note of notes) {
      const prev = result[result.length - 1];
      if (!prev) {
        result.push({ ...note });
        continue;
      }
      const prevEnd = prev.startTimeSeconds + prev.durationSeconds;
      const gapBeats = (note.startTimeSeconds - prevEnd) * beatsPerSecond;
      const pitchDiff = Math.abs(note.pitchMidi - prev.pitchMidi);
      // Merge exists to rejoin a provider that split ONE held note into
      // near-duplicate fragments — so only fire when at least one side is a
      // genuine short fragment. Merging two full-length notes would eat real
      // repeated notes / adjacent half-steps (the dominant recall loss).
      const shortestBeats =
        Math.min(prev.durationSeconds, note.durationSeconds) * beatsPerSecond;
      if (
        gapBeats < -MERGE_MAX_OVERLAP_BEATS ||
        gapBeats > MERGE_MAX_GAP_BEATS ||
        pitchDiff > MERGE_MAX_PITCH_DIFF ||
        shortestBeats >= MIN_DURATION_BEATS
      ) {
        result.push({ ...note });
        continue;
      }

      const mergedEnd = Math.max(
        prevEnd,
        note.startTimeSeconds + note.durationSeconds,
      );
      const louderIsNote = note.amplitude > prev.amplitude;
      const merged: NoteEventTime = {
        ...prev,
        pitchMidi: louderIsNote ? note.pitchMidi : prev.pitchMidi,
        amplitude: Math.max(prev.amplitude, note.amplitude),
        durationSeconds: mergedEnd - prev.startTimeSeconds,
      };

      const pairDeviation =
        this.biasDeviation(prev, beatsPerSecond) +
        this.biasDeviation(note, beatsPerSecond);
      const mergedDeviation = this.biasDeviation(merged, beatsPerSecond);
      if (mergedDeviation <= pairDeviation) {
        result[result.length - 1] = merged;
      } else {
        result.push({ ...note });
      }
    }
    return result;
  }

  /**
   * Distance in beats between a note and the nearest bias-fitting anchor
   * (start on the grid + length from the standard set + end on the grid).
   * Used to decide whether merging two notes improves the fit.
   */
  private biasDeviation(
    note: NoteEventTime,
    beatsPerSecond: number,
  ): number {
    const startBeat = note.startTimeSeconds * beatsPerSecond;
    const durationBeats = note.durationSeconds * beatsPerSecond;
    const endBeat = startBeat + durationBeats;
    const startDev = Math.abs(startBeat - this.snapToGrid(startBeat));
    const endDev = Math.abs(endBeat - this.snapToGrid(endBeat));
    const durDev = Math.abs(
      durationBeats - this.nearestStandardDuration(durationBeats),
    );
    return startDev + endDev + durDev;
  }

  private nearestStandardDuration(beats: number): number {
    let best = STANDARD_DURATION_BEATS[0];
    let bestDist = Math.abs(beats - best);
    for (const candidate of STANDARD_DURATION_BEATS) {
      const dist = Math.abs(beats - candidate);
      if (dist < bestDist) {
        bestDist = dist;
        best = candidate;
      }
    }
    return best;
  }

  /**
   * Snap each note's start to the beat grid (with a coarseness bias) and its
   * length to one of the standard durations. A legato note whose sounding end
   * falls just short of (or just past) the next onset is extended to meet it,
   * since that small gap is the provider's early release rather than a rest;
   * otherwise the length is floor-snapped and trimmed so it can't collide with
   * the next note's snapped start.
   */
  private alignAndQuantize(
    notes: NoteEventTime[],
    bpm: number,
  ): NoteEventTime[] {
    const beatsPerSecond = bpm / 60;
    const result: NoteEventTime[] = [];

    for (let i = 0; i < notes.length; i++) {
      const note = notes[i];
      const startBeat = note.startTimeSeconds * beatsPerSecond;
      const endBeat =
        (note.startTimeSeconds + note.durationSeconds) * beatsPerSecond;

      const snapStart = this.snapToGrid(startBeat);
      const soundingBeats = Math.max(MIN_DURATION_BEATS, endBeat - snapStart);

      let maxAvailable = Number.POSITIVE_INFINITY;
      const next = notes[i + 1];
      if (next) {
        const nextStartBeat = next.startTimeSeconds * beatsPerSecond;
        maxAvailable = Math.max(0, this.snapToGrid(nextStartBeat) - snapStart);
      }

      // Legato seam-fill: when the note sounds up to within SEAM_FILL_BEATS of
      // the next onset (or overruns it), end it exactly there — the gap is the
      // provider's early release, not a rest. maxAvailable is a grid distance,
      // so the filled length stays grid-aligned. Genuine rests (larger gaps)
      // fall through to the floor-snap, preserving existing behavior.
      let durationBeats: number;
      if (
        Number.isFinite(maxAvailable) &&
        maxAvailable >= MIN_DURATION_BEATS &&
        maxAvailable - soundingBeats <= SEAM_FILL_BEATS
      ) {
        durationBeats = maxAvailable;
      } else {
        durationBeats = this.snapToStandardDuration(
          Math.min(soundingBeats, maxAvailable),
        );
      }
      if (durationBeats < MIN_DURATION_BEATS) continue;

      result.push({
        ...note,
        startTimeSeconds: snapStart / beatsPerSecond,
        durationSeconds: durationBeats / beatsPerSecond,
      });
    }
    return result;
  }

  private snapToGrid(beats: number): number {
    let bestPos = Math.round(beats);
    let bestScore = Math.abs(beats - bestPos);
    for (const { divisor, penalty } of GRID_PENALTIES) {
      const pos = Math.round(beats * divisor) / divisor;
      const score = Math.abs(beats - pos) + penalty;
      if (score < bestScore) {
        bestScore = score;
        bestPos = pos;
      }
    }
    return bestPos;
  }

  private snapToStandardDuration(beats: number): number {
    let best = STANDARD_DURATION_BEATS[STANDARD_DURATION_BEATS.length - 1];
    let bestDist = Math.abs(beats - best);
    for (const candidate of STANDARD_DURATION_BEATS) {
      if (candidate > beats + 1e-6) continue;
      const dist = Math.abs(beats - candidate);
      if (dist < bestDist) {
        bestDist = dist;
        best = candidate;
      }
    }
    return best;
  }
}
