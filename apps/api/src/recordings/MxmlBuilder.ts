import type {
  MxmlMeasure,
  MxmlMeasureEntry,
  MxmlNoteType,
  MxmlPitch,
  MxmlStep,
  MxmlTie,
} from './mxml.types';

const DIVISIONS_PER_QUARTER = 12;

const STANDARD_DURATIONS: Array<{ type: MxmlNoteType; divisions: number }> = [
  { type: 'whole', divisions: 48 },
  { type: 'half', divisions: 24 },
  { type: 'quarter', divisions: 12 },
  { type: 'eighth', divisions: 6 },
  { type: '16th', divisions: 3 },
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
    let divs = Math.round(beats * DIVISIONS_PER_QUARTER);
    while (divs >= STANDARD_DURATIONS[STANDARD_DURATIONS.length - 1].divisions) {
      const fit = STANDARD_DURATIONS.find((d) => d.divisions <= divs);
      if (!fit) break;
      entries.push({
        _type: 'note',
        rest: {},
        duration: fit.divisions,
        voice: '1',
        type: fit.type,
      });
      divs -= fit.divisions;
    }
  }

  private appendNoteSegments(
    entries: MxmlMeasureEntry[],
    beats: number,
    midi: number,
  ): void {
    const pitch = this.midiToPitch(midi);
    let divs = Math.round(beats * DIVISIONS_PER_QUARTER);
    const segments: Array<{ type: MxmlNoteType; divisions: number }> = [];
    while (divs >= STANDARD_DURATIONS[STANDARD_DURATIONS.length - 1].divisions) {
      const fit = STANDARD_DURATIONS.find((d) => d.divisions <= divs);
      if (!fit) break;
      segments.push(fit);
      divs -= fit.divisions;
    }
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const tie = this.tieFor(i, segments.length);
      entries.push({
        _type: 'note',
        pitch,
        duration: seg.divisions,
        voice: '1',
        type: seg.type,
        ...(tie && { tie }),
      });
    }
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
