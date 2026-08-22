/**
 * Repair a "performed to a prescribed melody" dataset into truth that describes
 * the PERFORMANCE instead of the score.
 *
 * The problem this exists for. `context/whistled-high-register` is our own
 * dogfood whistling: a generated melody, performed to a metronome, with the
 * generated melody kept as the ground truth. That truth is *score-derived*, and
 * measuring against it measures the performer, not the pipeline —
 * research-whistle-corpus.md §6 warns against exactly this ("do NOT whistle
 * along to a click"). Measured on the six clips:
 *
 *   - **The whistling is in a different key from the score.** Median measured −
 *     written pitch = +12.50 semitones, and **0 %** of notes are within ±0.5 st
 *     of what is written. Per clip the best-fit transposition is 12.27–12.89
 *     semitones: three of the six clips were whistled THIRTEEN semitones up, not
 *     twelve. Nothing in the capture recorded which key was used. What the
 *     performer got right is the melody — residual after one transposition is a
 *     median 15 ¢ — so the key is recoverable and the notes were never in doubt.
 *   - **The onsets are the metronome's, not the player's.** Against drafted
 *     onsets the prescribed grid is off by a median 90 ms, p90 190 ms, with
 *     **40 % of notes beyond the ±100 ms scoring tolerance** before the pipeline
 *     does anything. A per-clip line fits an intercept of +19…+116 ms (so not one
 *     constant latency that could simply be subtracted) and leaves 21–134 ms RMS
 *     of genuine human timing variance behind.
 *
 * What this script does about it. The prescribed melody is still the best thing
 * about the corpus — it says exactly WHICH notes were intended and in what
 * order, which is the hard half of annotation. So: take pitch IDENTITY from the
 * score (transposed by the octave the performer actually used, detected per
 * clip), take TIMING from the audio, and align the two sequences with DTW. The
 * result is performance-accurate in time and score-accurate in note identity.
 *
 * 🔴 The result is still derived truth. Onsets come from `lib/sineTrack.ts`, so
 * the output dataset is written `noteTruthDerived: true` and stays out of every
 * pooled number until a human verifies it — same rule as `whistle-real`, same
 * reason (research-voice-datasets.md §0 gate 3). Label TSVs are written to
 * `annotations/<dataset>/` so verification uses the existing Audacity loop, and
 * `import-note-labels.ts --verified-by=<name>` is what finally clears the flag.
 *
 * The source dataset is never modified: output goes to a sibling dataset dir
 * with the audio copied across, so the original recording and its prescribed
 * melody stay exactly as recorded.
 *
 * Run: pnpm --filter api exec tsx scripts/eval/align-prescribed-truth.ts \
 *        --dataset=context/whistled-high-register
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { basename, join, resolve } from 'path';

import { type DraftNote,draftNotes, trackSinusoid } from './lib/sineTrack';
import { wavToFloat } from './lib/wav';
import type { GroundTruth, TruthNote } from './types';

const REAL_ROOT = resolve(__dirname, '../fixtures/eval-real');
const ANNOTATIONS = resolve(__dirname, 'annotations');

/** Whistling lives here; the tracker is given room either side of the profile band. */
const TRACK = { fftSize: 2048, hopSec: 0.01, minHz: 300, maxHz: 5000, minTonality: 0.3, minLevel: 0.05 };
/**
 * Note floor for the drafted sequence. Higher than the whistle-real default
 * (60 ms) because a metronome performance has no notes that short, and the
 * looser floor only invites the aligner to match vibrato wobble as a note.
 */
const SEGMENT = { minNoteSec: 0.1, maxDropoutSec: 0.06, medianFrames: 5 };

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const noteName = (midi: number): string =>
  `${NOTE_NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;

/**
 * In which KEY did the performer actually whistle it?
 *
 * ⚠️ This started out rounding the fit to a whole octave, on the assumption that
 * a whistler takes a mid-register melody up an octave and nothing else. Measured
 * on the six dogfood clips, that assumption is wrong: the best-fit transposition
 * is 12.27, 12.89, 12.27, 12.69, 12.66 and 12.39 semitones — three of the six
 * were whistled **thirteen** semitones up, not twelve. Forcing 12 left those
 * clips a near-semitone sharp of their own truth, and named 39 % of notes
 * correctly; rounding the fit to the nearest SEMITONE names 74 %.
 *
 * The residual after the fit is what says whether the melody survived at all:
 * pooled median 15 ¢, p90 82 ¢, 86 % of notes within 50 ¢ — so these are
 * accurate performances in a key of the performer's choosing, and the key is
 * recoverable while the individual pitches were never in doubt. A clip whose
 * residual is large is a different animal (clip-03: median 82 ¢, max 305 ¢) and
 * is reported so a human looks at it rather than trusting the fit.
 */
function detectTransposition(
  frames: ReturnType<typeof trackSinusoid>,
  notes: TruthNote[],
): { semitones: number; residualCents: number; residualP90Cents: number; samples: number } {
  const voiced = frames.filter((f) => f.hz);
  const midiOf = (hz: number) => 69 + 12 * Math.log2(hz / 440);
  const diffs: number[] = [];
  for (const n of notes) {
    const a = n.onsetSec + n.durSec * 0.25;
    const b = n.onsetSec + n.durSec * 0.75;
    const w = voiced
      .filter((f) => f.timeSec >= a && f.timeSec <= b)
      .map((f) => midiOf(f.hz as number));
    if (w.length < 3) continue;
    w.sort((x, y) => x - y);
    diffs.push(w[Math.floor(w.length / 2)] - n.midi);
  }
  if (!diffs.length) {
    return { semitones: 0, residualCents: 0, residualP90Cents: 0, samples: 0 };
  }
  // Mean, not median: every note carries equal evidence about one shared key,
  // and the median throws away most of it on a nine-note clip.
  const mean = diffs.reduce((s, d) => s + d, 0) / diffs.length;
  const semitones = Math.round(mean);
  const resid = diffs.map((d) => Math.abs(d - mean) * 100).sort((a, b) => a - b);
  return {
    semitones,
    residualCents: Math.round((mean - semitones) * 100),
    residualP90Cents: Math.round(resid[Math.floor(resid.length * 0.9)]),
    samples: diffs.length,
  };
}

/**
 * Align the drafted note sequence to the prescribed one.
 *
 * Plain DTW over the two sequences with a pitch-distance cost. The drafter
 * over-segments (a whistled sustain with vibrato becomes two or three runs), so
 * MANY drafted notes may map to ONE prescribed note; the reverse — one drafted
 * note covering several prescribed ones — happens when the performer slurred
 * through a pitch change. Both are allowed, and the emitted onset for a
 * prescribed note is the onset of the FIRST drafted note assigned to it, which
 * is the moment the performer started the note.
 */
function alignSequences(drafted: DraftNote[], prescribed: TruthNote[]): (DraftNote[] | null)[] {
  const n = drafted.length;
  const m = prescribed.length;
  if (!n || !m) return prescribed.map(() => null);

  const cost = (i: number, j: number): number => Math.min(6, Math.abs(drafted[i].midi - prescribed[j].midi));
  const INF = Number.POSITIVE_INFINITY;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(INF));
  const from: string[][] = Array.from({ length: n + 1 }, () => new Array<string>(m + 1).fill(''));
  dp[0][0] = 0;

  for (let i = 1; i <= n; i += 1) {
    for (let j = 1; j <= m; j += 1) {
      const c = cost(i - 1, j - 1);
      // diag = this drafted note IS this prescribed note;
      // up   = an extra drafted note folded into the same prescribed note;
      // left = a prescribed note with no drafted note of its own (missed).
      const diag = dp[i - 1][j - 1] + c;
      const up = dp[i - 1][j] + c;
      const left = dp[i][j - 1] + 3;
      const best = Math.min(diag, up, left);
      dp[i][j] = best;
      from[i][j] = best === diag ? 'diag' : best === up ? 'up' : 'left';
    }
  }

  const assigned: DraftNote[][] = Array.from({ length: m }, () => []);
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    const move = from[i][j];
    if (move === 'left') {
      j -= 1;
    } else {
      assigned[j - 1].push(drafted[i - 1]);
      if (move === 'diag') j -= 1;
      i -= 1;
    }
  }
  return assigned.map((a) => (a.length ? a.reverse() : null));
}

interface ClipReport {
  clip: string;
  octaveShift: number;
  residualCents: number;
  matched: number;
  total: number;
  medianShiftMs: number;
}

function processDataset(datasetPath: string, outId: string): void {
  const srcDir = join(REAL_ROOT, datasetPath);
  if (!existsSync(srcDir)) throw new Error(`no dataset at ${srcDir}`);
  const tier = datasetPath.includes('/') ? datasetPath.split('/')[0] : 'context';
  const outDir = join(REAL_ROOT, tier, outId);
  const annDir = join(ANNOTATIONS, outId);
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  mkdirSync(annDir, { recursive: true });

  const srcManifest = existsSync(join(srcDir, 'dataset.json'))
    ? (JSON.parse(readFileSync(join(srcDir, 'dataset.json'), 'utf8')) as Record<string, unknown>)
    : {};

  const clips = readdirSync(srcDir)
    .filter((f) => f.endsWith('.truth.json'))
    .map((f) => f.replace('.truth.json', ''))
    .sort();

  const reports: ClipReport[] = [];
  let totalNotes = 0;

  for (const clip of clips) {
    const wav = join(srcDir, `${clip}__real.wav`);
    if (!existsSync(wav)) {
      console.warn(`  ! ${clip}: no audio, skipped`);
      continue;
    }
    const prescribed = JSON.parse(
      readFileSync(join(srcDir, `${clip}.truth.json`), 'utf8'),
    ) as GroundTruth;
    const { samples, sampleRate } = wavToFloat(readFileSync(wav));
    const frames = trackSinusoid(samples, sampleRate, TRACK);
    const drafted = draftNotes(frames, TRACK.hopSec, SEGMENT);

    // Two passes, because the two unknowns are entangled: the transposition is
    // measured inside each note's time window, and the prescribed windows are in
    // the WRONG PLACE by 100–200 ms (that is the other half of the problem). A
    // first estimate from the score's own windows is good enough to align on;
    // re-measuring inside the ALIGNED windows is what makes it right. Measured
    // difference on these clips: the one-pass estimate mis-keys three of six
    // (and inflates the per-note residual p90 to 255 ¢ on clip-05, where the
    // two-pass estimate reports 62 ¢).
    let transposition = detectTransposition(frames, prescribed.notes);
    let shifted = prescribed.notes.map((n) => ({ ...n, midi: n.midi + transposition.semitones }));
    let assignment = alignSequences(drafted, shifted);

    const collect = (
      assign: (DraftNote[] | null)[],
      target: TruthNote[],
    ): { notes: TruthNote[]; shifts: number[] } => {
      const out: TruthNote[] = [];
      const sh: number[] = [];
      for (let k = 0; k < target.length; k += 1) {
        const group = assign[k];
        if (!group) continue;
        const onsetSec = group[0].onsetSec;
        const last = group[group.length - 1];
        out.push({ onsetSec, durSec: last.onsetSec + last.durSec - onsetSec, midi: target[k].midi });
        sh.push(onsetSec - target[k].onsetSec);
      }
      return { notes: out, shifts: sh };
    };

    const firstPass = collect(assignment, shifted);
    if (firstPass.notes.length >= 3) {
      // Re-measure the key inside the windows the alignment just found, then
      // re-align with it. `detectTransposition` reports the shift relative to
      // the notes it is given, so feeding it the already-shifted notes yields a
      // CORRECTION to apply on top.
      const refined = detectTransposition(frames, firstPass.notes);
      if (refined.semitones !== 0) {
        transposition = {
          ...refined,
          semitones: transposition.semitones + refined.semitones,
        };
        shifted = prescribed.notes.map((n) => ({ ...n, midi: n.midi + transposition.semitones }));
        assignment = alignSequences(drafted, shifted);
      } else {
        transposition = { ...transposition, residualCents: refined.residualCents, residualP90Cents: refined.residualP90Cents };
      }
    }

    const { notes, shifts } = collect(assignment, shifted);
    notes.sort((a, b) => a.onsetSec - b.onsetSec);
    shifts.sort((a, b) => a - b);
    const octave = transposition;

    const truth: GroundTruth = { bpm: prescribed.bpm, notes };
    writeFileSync(join(outDir, `${clip}.truth.json`), `${JSON.stringify(truth, null, 2)}\n`);
    copyFileSync(wav, join(outDir, `${clip}__real.wav`));

    writeFileSync(
      join(annDir, `${clip}.labels.tsv`),
      notes
        .map((n) => `${n.onsetSec.toFixed(6)}\t${(n.onsetSec + n.durSec).toFixed(6)}\t${noteName(n.midi)}`)
        .join('\n') + (notes.length ? '\n' : ''),
    );
    writeFileSync(
      join(annDir, `${clip}.meta.json`),
      `${JSON.stringify(
        {
          clip,
          dataset: outId,
          verifiedBy: null,
          verifiedAt: null,
          draftedBy: 'align-prescribed-truth.ts (score identity + audio timing, DTW-aligned)',
          transpositionSemitones: octave.semitones,
          fitResidualCents: octave.residualCents,
          perNoteResidualP90Cents: octave.residualP90Cents,
          notesAligned: notes.length,
          notesPrescribed: prescribed.notes.length,
          audio: { sampleRate, durationSec: samples.length / sampleRate },
          source: `${datasetPath}/${clip}`,
        },
        null,
        2,
      )}\n`,
    );

    totalNotes += notes.length;
    reports.push({
      clip,
      octaveShift: octave.semitones,
      residualCents: octave.residualCents,
      matched: notes.length,
      total: prescribed.notes.length,
      medianShiftMs: shifts.length ? Math.round(1000 * shifts[Math.floor(shifts.length / 2)]) : 0,
    });
    console.log(
      `  ${clip}: transposed ${octave.semitones >= 0 ? '+' : ''}${octave.semitones} st ` +
        `(fit residual ${octave.residualCents >= 0 ? '+' : ''}${octave.residualCents} ¢, ` +
        `per-note p90 ${octave.residualP90Cents} ¢${octave.residualP90Cents > 50 ? ' ⚠ CHECK BY EAR' : ''}), ` +
        `aligned ${notes.length}/${prescribed.notes.length}, ` +
        `onsets moved ${reports[reports.length - 1].medianShiftMs >= 0 ? '+' : ''}` +
        `${reports[reports.length - 1].medianShiftMs} ms (median)`,
    );
  }

  writeFileSync(
    join(outDir, 'dataset.json'),
    `${JSON.stringify(
      {
        ...srcManifest,
        id: outId,
        label: `${typeof srcManifest.label === 'string' ? srcManifest.label : outId} — performance-aligned`,
        // Onsets come from our own tracker: derived until a human signs off.
        noteTruthDerived: true,
        annotator: 'align-prescribed-truth.ts — pitch identity from the prescribed melody (octave detected per clip), timing from the audio',
        derivedFrom: datasetPath,
        clips: reports.length,
        totalNotes,
        transpositions: reports.map((r) => ({ clip: r.clip, semitones: r.octaveShift, residualCents: r.residualCents })),
        note: 'The source dataset scores the performer against a metronome, not the pipeline (see align-prescribed-truth.ts). This copy keeps the prescribed note identities and takes every onset from the audio. Still derived — verify with import-note-labels.ts --verified-by before letting it gate anything.',
      },
      null,
      2,
    )}\n`,
  );

  console.log(`\n  → ${reports.length} clips / ${totalNotes} notes in ${outDir}`);
  console.log(`  → label TSVs for verification in ${annDir}`);
}

function main(): void {
  const arg = process.argv.slice(2).find((a) => a.startsWith('--dataset='));
  const datasetPath = arg ? arg.slice('--dataset='.length) : 'context/whistled-high-register';
  const outId = `${basename(datasetPath)}-aligned`;
  processDataset(datasetPath, outId);
}

main();
