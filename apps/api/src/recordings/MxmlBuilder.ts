import type {
  MxmlMeasure,
  MxmlMeasureEntry,
  MxmlNoteType,
  MxmlPitch,
  MxmlStep,
  MxmlTie,
} from './mxml.types';

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
}

export interface PendingNote {
  startTimeSeconds: number;
  durationSeconds: number;
  pitchMidi: number;
}

export class MxmlBuilder {
  constructor(private readonly options: BuilderOptions) {}

  measureIndexFor(timeSeconds: number): number {
    const beats = (timeSeconds * this.options.bpm) / 60;
    return Math.floor(beats / this.options.beats);
  }

  buildMeasure(index: number, allNotes: PendingNote[]): MxmlMeasure {
    const measureStartBeat = index * this.options.beats;
    const measureEndBeat = measureStartBeat + this.options.beats;

    const segments: Array<{
      startBeat: number;
      endBeat: number;
      pitchMidi: number;
    }> = [];
    for (const n of allNotes) {
      const startBeat = (n.startTimeSeconds * this.options.bpm) / 60;
      const endBeat = startBeat + (n.durationSeconds * this.options.bpm) / 60;
      if (endBeat <= measureStartBeat || startBeat >= measureEndBeat) continue;
      segments.push({
        startBeat: Math.max(startBeat, measureStartBeat),
        endBeat: Math.min(endBeat, measureEndBeat),
        pitchMidi: n.pitchMidi,
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
        this.appendRests(entries, seg.startBeat - cursorBeat);
        cursorBeat = seg.startBeat;
      }
      if (seg.endBeat <= cursorBeat) continue;
      const span = seg.endBeat - cursorBeat;
      this.appendNoteSegments(entries, span, seg.pitchMidi);
      cursorBeat += span;
    }
    if (cursorBeat < measureEndBeat) {
      this.appendRests(entries, measureEndBeat - cursorBeat);
    }

    return { number: String(index + 1), entries };
  }

  private appendRests(entries: MxmlMeasureEntry[], beats: number): void {
    for (const seg of this.splitIntoStandardDurations(beats)) {
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
    beats: number,
    midi: number,
  ): void {
    const pitch = this.midiToPitch(midi);
    const segments = this.splitIntoStandardDurations(beats);
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

  private splitIntoStandardDurations(beats: number): StandardDuration[] {
    const minDivs = STANDARD_DURATIONS[STANDARD_DURATIONS.length - 1].divisions;
    const result: StandardDuration[] = [];
    let divs = Math.round(beats * DIVISIONS_PER_QUARTER);
    while (divs >= minDivs) {
      const fit = STANDARD_DURATIONS.find((d) => d.divisions <= divs);
      if (!fit) break;
      result.push(fit);
      divs -= fit.divisions;
    }
    return result;
  }

  private tieFor(index: number, total: number): MxmlTie[] | undefined {
    if (total <= 1) return undefined;
    if (index === 0) return [{ type: 'start' }];
    if (index === total - 1) return [{ type: 'stop' }];
    return [{ type: 'stop' }, { type: 'start' }];
  }

  private midiToPitch(midi: number): MxmlPitch {
    const octave = Math.floor(midi / 12) - 1;
    const semi = ((midi % 12) + 12) % 12;
    const { step, alter } = STEP_TABLE[semi];
    return { step, octave, ...(alter !== 0 && { alter }) };
  }
}
