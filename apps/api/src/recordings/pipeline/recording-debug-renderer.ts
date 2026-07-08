interface NoteSegment {
  startTimeSeconds: number;
  durationSeconds: number;
  pitchMidi: number;
}

export interface DebugRenderOptions {
  rawNotes: NoteSegment[];
  deducedNotes: NoteSegment[];
  durationSec: number;
  bpm: number;
  beatsPerMeasure: number;
  /** Pixels per second along the x axis. */
  pxPerSecond?: number;
  /** Pixels per semitone along the y axis. */
  pxPerSemitone?: number;
}

const DEFAULT_PX_PER_SECOND = 80;
const DEFAULT_PX_PER_SEMITONE = 6;
const MARGIN_LEFT = 48;
const MARGIN_RIGHT = 16;
const MARGIN_TOP = 16;
const MARGIN_BOTTOM = 32;
const PITCH_PADDING = 2;
const RAW_COLOR = '#9ca3af';
const DEDUCED_COLOR = '#16a34a';
const BARLINE_COLOR = '#000';
const AXIS_COLOR = '#374151';
const NOTE_THICKNESS = 4;

export class RecordingDebugRenderer {
  render(opts: DebugRenderOptions): string {
    const pxPerSec = opts.pxPerSecond ?? DEFAULT_PX_PER_SECOND;
    const pxPerSemi = opts.pxPerSemitone ?? DEFAULT_PX_PER_SEMITONE;

    const allNotes = [...opts.rawNotes, ...opts.deducedNotes];
    const minPitch =
      (allNotes.length
        ? Math.min(...allNotes.map((n) => n.pitchMidi))
        : 60) - PITCH_PADDING;
    const maxPitch =
      (allNotes.length
        ? Math.max(...allNotes.map((n) => n.pitchMidi))
        : 72) + PITCH_PADDING;
    const pitchSpan = Math.max(1, maxPitch - minPitch);

    const innerWidth = Math.max(200, opts.durationSec * pxPerSec);
    const innerHeight = pitchSpan * pxPerSemi;
    const width = innerWidth + MARGIN_LEFT + MARGIN_RIGHT;
    const height = innerHeight + MARGIN_TOP + MARGIN_BOTTOM;

    const xFor = (t: number) => MARGIN_LEFT + t * pxPerSec;
    const yFor = (midi: number) =>
      MARGIN_TOP + (maxPitch - midi) * pxPerSemi;

    const elements: string[] = [];

    // Background
    elements.push(
      `<rect x="0" y="0" width="${width}" height="${height}" fill="#fff"/>`,
    );

    // Pitch reference lines (every C)
    for (let m = Math.ceil(minPitch / 12) * 12; m <= maxPitch; m += 12) {
      const y = yFor(m);
      elements.push(
        `<line x1="${MARGIN_LEFT}" y1="${y}" x2="${width - MARGIN_RIGHT}" y2="${y}" stroke="#e5e7eb" stroke-width="1"/>`,
        `<text x="${MARGIN_LEFT - 6}" y="${y + 3}" text-anchor="end" font-size="10" fill="${AXIS_COLOR}">C${Math.floor(m / 12) - 1}</text>`,
      );
    }

    // Measure barlines
    const secondsPerMeasure = (opts.beatsPerMeasure * 60) / opts.bpm;
    if (secondsPerMeasure > 0) {
      let m = 0;
      let t = 0;
      while (t <= opts.durationSec + 1e-6) {
        const x = xFor(t);
        elements.push(
          `<line x1="${x}" y1="${MARGIN_TOP}" x2="${x}" y2="${height - MARGIN_BOTTOM}" stroke="${BARLINE_COLOR}" stroke-width="1"/>`,
          `<text x="${x + 2}" y="${height - MARGIN_BOTTOM + 12}" font-size="10" fill="${AXIS_COLOR}">m${m + 1}</text>`,
        );
        m += 1;
        t = m * secondsPerMeasure;
      }
    }

    // Time axis ticks every second
    for (let s = 0; s <= Math.floor(opts.durationSec); s += 1) {
      const x = xFor(s);
      elements.push(
        `<line x1="${x}" y1="${height - MARGIN_BOTTOM}" x2="${x}" y2="${height - MARGIN_BOTTOM + 4}" stroke="${AXIS_COLOR}" stroke-width="1"/>`,
        `<text x="${x}" y="${height - MARGIN_BOTTOM + 24}" text-anchor="middle" font-size="10" fill="${AXIS_COLOR}">${s}s</text>`,
      );
    }

    // Frame
    elements.push(
      `<rect x="${MARGIN_LEFT}" y="${MARGIN_TOP}" width="${innerWidth}" height="${innerHeight}" fill="none" stroke="${AXIS_COLOR}" stroke-width="1"/>`,
    );

    // Raw notes (gray, slightly transparent so overlaps with deduced are visible)
    for (const n of opts.rawNotes) {
      const x1 = xFor(n.startTimeSeconds);
      const x2 = xFor(n.startTimeSeconds + n.durationSeconds);
      const y = yFor(n.pitchMidi);
      elements.push(
        `<line x1="${x1.toFixed(2)}" y1="${y.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y.toFixed(2)}" stroke="${RAW_COLOR}" stroke-width="${NOTE_THICKNESS}" stroke-opacity="0.7" stroke-linecap="round"/>`,
      );
    }

    // Deduced notes (green, on top)
    for (const n of opts.deducedNotes) {
      const x1 = xFor(n.startTimeSeconds);
      const x2 = xFor(n.startTimeSeconds + n.durationSeconds);
      const y = yFor(n.pitchMidi);
      elements.push(
        `<line x1="${x1.toFixed(2)}" y1="${y.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y.toFixed(2)}" stroke="${DEDUCED_COLOR}" stroke-width="${NOTE_THICKNESS}" stroke-linecap="round"/>`,
      );
    }

    // Legend
    const legendY = MARGIN_TOP - 4;
    elements.push(
      `<line x1="${MARGIN_LEFT}" y1="${legendY}" x2="${MARGIN_LEFT + 16}" y2="${legendY}" stroke="${RAW_COLOR}" stroke-width="${NOTE_THICKNESS}" stroke-opacity="0.7"/>`,
      `<text x="${MARGIN_LEFT + 22}" y="${legendY + 3}" font-size="10" fill="${AXIS_COLOR}">raw</text>`,
      `<line x1="${MARGIN_LEFT + 60}" y1="${legendY}" x2="${MARGIN_LEFT + 76}" y2="${legendY}" stroke="${DEDUCED_COLOR}" stroke-width="${NOTE_THICKNESS}"/>`,
      `<text x="${MARGIN_LEFT + 82}" y="${legendY + 3}" font-size="10" fill="${AXIS_COLOR}">deduced</text>`,
    );

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${elements.join('')}</svg>`;
  }
}
