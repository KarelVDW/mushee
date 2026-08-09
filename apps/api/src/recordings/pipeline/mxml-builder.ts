import type {
  MxmlMeasure,
  MxmlMeasureEntry,
  MxmlNoteType,
  MxmlPitch,
  MxmlStep,
  MxmlTie,
} from './mxml.types';
import {
  chooseNamingOffset,
  estimateGridPhaseBeats,
  estimateTuningOffsetCents,
  keyPitchClasses,
  spellMidi,
} from './voice-notation';

const DIVISIONS_PER_QUARTER = 12;

interface StandardDuration {
  type: MxmlNoteType;
  divisions: number;
  dots: number;
}

/** Sorted descending so greedy "largest fit" picks the coarsest match first. */
const STANDARD_DURATIONS: StandardDuration[] = [
  { type: 'whole', divisions: 48, dots: 0 },
  { type: 'half', divisions: 36, dots: 1 },
  { type: 'half', divisions: 24, dots: 0 },
  { type: 'quarter', divisions: 18, dots: 1 },
  { type: 'quarter', divisions: 12, dots: 0 },
  { type: 'eighth', divisions: 9, dots: 1 },
  { type: 'eighth', divisions: 6, dots: 0 },
  { type: '16th', divisions: 3, dots: 0 },
];

const STEP_TABLE: Array<{ step: MxmlStep; alter: number }> = [
  { step: 'C', alter: 0 },
  { step: 'C', alter: 1 },
  { step: 'D', alter: 0 },
  { step: 'D', alter: 1 },
  { step: 'E', alter: 0 },
  { step: 'F', alter: 0 },
  { step: 'F', alter: 1 },
  { step: 'G', alter: 0 },
  { step: 'G', alter: 1 },
  { step: 'A', alter: 0 },
  { step: 'A', alter: 1 },
  { step: 'B', alter: 0 },
];

export interface BuilderOptions {
  bpm: number;
  beats: number;
  beatType: number;
  /** Sounding − written, in semitones. The mic captures sounding pitch; we subtract this to land in written-pitch space. Default 0 (concert pitch). */
  chromaticTranspose?: number;
  /**
   * The score's key signature at the recording start (positive = sharps),
   * from the client's meta frame. Only consulted for sung takes, and only for
   * notes still ambiguous after tuning normalization — see voice-notation.ts.
   */
  keyFifths?: number | null;
}

export interface PendingNote {
  startTimeSeconds: number;
  durationSeconds: number;
  pitchMidi: number;
  /** Unrounded pitch from the voice decoder; absent for instrument takes. */
  pitchMidiFloat?: number;
}

export class MxmlBuilder {
  /**
   * Spell pitches on the take's own tuning grid (+ key-aware snapping) instead
   * of the absolute keyboard. Enabled by the pipeline once the profile locks
   * as voice; a mid-take estimate can differ from the final one, but the
   * finalize pass rebuilds every measure, so the shipped score is spelled
   * consistently from the whole take.
   */
  private voiceSpelling = false;

  constructor(private readonly options: BuilderOptions) {}

  setVoiceSpelling(on: boolean): void {
    this.voiceSpelling = on;
  }

  measureIndexFor(timeSeconds: number): number {
    const beats = (timeSeconds * this.options.bpm) / 60;
    return Math.floor(beats / this.options.beats);
  }

  /**
   * Inclusive range of measures a note occupies — not just the one it starts in.
   *
   * A note is written into every bar it sounds through (tied across each barline),
   * so every one of those bars changes when the note is added. Callers that derive
   * their update set from `measureIndexFor(start)` alone silently truncate held
   * notes: a note held for five bars would only ever rebuild the first.
   *
   * The end is nudged back by a hair so a note finishing exactly on a barline does
   * not claim the empty bar that follows it.
   */
  measureRangeFor(startTimeSeconds: number, durationSeconds: number): [number, number] {
    const first = this.measureIndexFor(startTimeSeconds);
    const last = this.measureIndexFor(
      Math.max(startTimeSeconds, startTimeSeconds + durationSeconds - 1e-6),
    );
    return [first, Math.max(first, last)];
  }

  buildMeasure(index: number, allNotes: PendingNote[]): MxmlMeasure {
    const measureStartBeat = index * this.options.beats;
    const measureEndBeat = measureStartBeat + this.options.beats;

    // Sung takes are spelled on the take's own tuning grid: the offset must be
    // estimated over ALL notes (one constant per take, never per note), which
    // is why this happens here — the one place that always sees the whole
    // performance so far — and not per emitted measure fragment.
    const keyClasses =
      this.voiceSpelling && this.options.keyFifths != null
        ? keyPitchClasses(this.options.keyFifths)
        : null;
    const offsetCents = this.voiceSpelling
      ? chooseNamingOffset(allNotes, estimateTuningOffsetCents(allNotes), keyClasses)
      : 0;
    // The rhythm twin of the tuning offset: a take dragged uniformly behind
    // the click is written back on the beat. Vote-gated (see the estimator);
    // clamped so the first note cannot shift before zero.
    const phaseShift = this.voiceSpelling
      ? Math.min(
          estimateGridPhaseBeats(allNotes, this.options.bpm),
          allNotes.length ? (allNotes[0].startTimeSeconds * this.options.bpm) / 60 : 0,
        )
      : 0;

    const segments: Array<{
      startBeat: number;
      endBeat: number;
      pitchMidi: number;
    }> = [];
    for (const n of allNotes) {
      const startBeat = (n.startTimeSeconds * this.options.bpm) / 60 - phaseShift;
      const endBeat = startBeat + (n.durationSeconds * this.options.bpm) / 60;
      if (endBeat <= measureStartBeat || startBeat >= measureEndBeat) continue;
      segments.push({
        startBeat: Math.max(startBeat, measureStartBeat),
        endBeat: Math.min(endBeat, measureEndBeat),
        pitchMidi: this.voiceSpelling
          ? spellMidi(n, offsetCents, keyClasses)
          : n.pitchMidi,
      });
    }
    segments.sort((a, b) => a.startBeat - b.startBeat);

    const entries: MxmlMeasureEntry[] = [];
    if (index === 0) {
      entries.push({
        _type: 'attributes',
        divisions: DIVISIONS_PER_QUARTER,
        time: [
          {
            beats: String(this.options.beats),
            beatType: String(this.options.beatType),
          },
        ],
      });
    }

    let cursorBeat = measureStartBeat;
    for (const seg of segments) {
      if (seg.startBeat > cursorBeat) {
        this.appendRests(entries, cursorBeat - measureStartBeat, seg.startBeat - cursorBeat);
        cursorBeat = seg.startBeat;
      }
      if (seg.endBeat <= cursorBeat) continue;
      const span = seg.endBeat - cursorBeat;
      this.appendNoteSegments(
        entries,
        cursorBeat - measureStartBeat,
        span,
        seg.pitchMidi,
      );
      cursorBeat += span;
    }
    if (cursorBeat < measureEndBeat) {
      this.appendRests(
        entries,
        cursorBeat - measureStartBeat,
        measureEndBeat - cursorBeat,
      );
    }

    return { number: String(index + 1), entries };
  }

  private appendRests(
    entries: MxmlMeasureEntry[],
    startBeatInMeasure: number,
    beats: number,
  ): void {
    for (const seg of this.spellDuration(startBeatInMeasure, beats)) {
      entries.push({
        _type: 'note',
        rest: {},
        duration: seg.divisions,
        voice: '1',
        type: seg.type,
        ...(seg.dots > 0 && { dot: seg.dots }),
      });
    }
  }

  private appendNoteSegments(
    entries: MxmlMeasureEntry[],
    startBeatInMeasure: number,
    beats: number,
    midi: number,
  ): void {
    const pitch = this.midiToPitch(midi);
    const segments = this.spellDuration(startBeatInMeasure, beats);
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const tie = this.tieFor(i, segments.length);
      entries.push({
        _type: 'note',
        pitch,
        duration: seg.divisions,
        voice: '1',
        type: seg.type,
        ...(seg.dots > 0 && { dot: seg.dots }),
        ...(tie && { tie }),
      });
    }
  }

  /**
   * Spell a span as written note values, honouring **where in the bar it starts**.
   *
   * The previous rule was greedy largest-fit, which ignores metrical position and so
   * produces spellings a musician would not write: three beats from beat 2 of 4/4
   * came out as a dotted half that straddles the middle of the bar, and a two-beat
   * span from beat 2 as a half note hiding the mid-bar division. Engraving
   * convention (and every notation program) instead **splits at the strongest
   * metrical boundary the span crosses**, tying across the split, so the beat
   * structure of the bar stays legible.
   *
   * A span is emitted as ONE symbol only when it both matches a writable value and
   * begins on a position at least as strong as that value's own alignment — which is
   * what allows a dotted half at the start of a bar while forbidding one from beat 2.
   */
  private spellDuration(
    startBeatInMeasure: number,
    beats: number,
  ): StandardDuration[] {
    const divs = Math.round(beats * DIVISIONS_PER_QUARTER);
    const start = Math.round(startBeatInMeasure * DIVISIONS_PER_QUARTER);
    return this.spellSpan(start, divs);
  }

  /** Metrical boundary sizes in divisions, coarsest first. */
  private boundaryLevels(): number[] {
    const beatDivs = (DIVISIONS_PER_QUARTER * 4) / this.options.beatType;
    const measureDivs = beatDivs * this.options.beats;
    return (
      [measureDivs, measureDivs / 2, beatDivs, beatDivs / 2, beatDivs / 4]
        // Only whole-division levels: in metres where beatDivs/4 is fractional
        // (6/8 → 1.5), a fractional boundary could split a span into pieces no
        // standard duration can spell, which spellSpan would then silently drop.
        // Unreachable while onsets sit on the 16th grid (the exact-match check
        // fires first), but the speller must not rely on its caller's grid.
        .filter((d) => d >= 1 && Number.isInteger(d))
    );
  }

  private spellSpan(start: number, divs: number): StandardDuration[] {
    if (divs <= 0) return [];
    const exact = STANDARD_DURATIONS.find((d) => d.divisions === divs);
    if (exact && this.alignsWith(start, exact)) return [exact];

    // Split at the coarsest metrical boundary strictly inside the span.
    for (const level of this.boundaryLevels()) {
      const next = Math.ceil((start + 1) / level) * level;
      if (next > start && next < start + divs) {
        return [
          ...this.spellSpan(start, next - start),
          ...this.spellSpan(next, start + divs - next),
        ];
      }
    }
    // No interior boundary: the span sits inside one grid cell, so the best we can
    // do is the largest writable value that fits, then whatever remains.
    const fit = STANDARD_DURATIONS.find((d) => d.divisions <= divs);
    if (!fit) return [];
    return [fit, ...this.spellSpan(start + fit.divisions, divs - fit.divisions)];
  }

  /**
   * Whether a value may be written as a single symbol at `start`. An undotted value
   * needs a position that is a multiple of its own length; a dotted value is
   * governed by its *undotted* base (a dotted half is legal wherever a half is), and
   * anything is legal at the start of a bar.
   */
  private alignsWith(start: number, value: StandardDuration): boolean {
    if (start === 0) return true;
    const base = value.dots > 0 ? (value.divisions * 2) / 3 : value.divisions;
    return base > 0 && start % base === 0;
  }

  private tieFor(index: number, total: number): MxmlTie[] | undefined {
    if (total <= 1) return undefined;
    if (index === 0) return [{ type: 'start' }];
    if (index === total - 1) return [{ type: 'stop' }];
    return [{ type: 'stop' }, { type: 'start' }];
  }

  private midiToPitch(midi: number): MxmlPitch {
    // basic-pitch reports the sounding MIDI captured by the mic; the score
    // stores written pitch (MusicXML semantics), so subtract the part's
    // chromatic transpose before mapping to step/alter/octave.
    const written = midi - (this.options.chromaticTranspose ?? 0);
    const octave = Math.floor(written / 12) - 1;
    const semi = ((written % 12) + 12) % 12;
    const { step, alter } = STEP_TABLE[semi];
    return { step, octave, ...(alter !== 0 && { alter }) };
  }
}
