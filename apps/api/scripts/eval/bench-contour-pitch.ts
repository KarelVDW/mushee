/**
 * E2 (R1): is basic-pitch's contour posteriorgram worth the wire?
 *
 * `ModelBackend.basicPitchForward` returns only `{frames, onsets}` — the
 * contour head is computed and dropped at the seam, so instrument takes on the
 * basic-pitch path get integer MIDI and the notation layer's tuning machinery
 * has nothing to work with. Before paying the wire cost (one more matrix per
 * pass through `inference.proto`), this bench answers the plan's three
 * questions OFFLINE, on the very-high band the provider actually serves,
 * using the library's own `addPitchBendsToNoteEvents` (@spotify/basic-pitch,
 * Apache-2.0 — the same Gaussian-argmax NeuralNote's `_addPitchBends` ports;
 * per-frame bends in 1/3-semitone contour bins, ±25-bin tolerance):
 *
 *  Q1  Does per-take tuning-offset estimation work from contour pitch?
 *      Measured against a KNOWN global detune: each clean clip is rate-shifted
 *      by −35 ¢ (truth times rescaled to match), and the recovered
 *      `estimateTuningOffsetCents` plus offset-corrected rounding are scored.
 *  Q2  Does the duration-weighted pitch-class histogram (R2's input) get
 *      closer to the truth's histogram with fractional, offset-normalised
 *      pitch than with integer MIDI? (cosine similarity, detuned clips)
 *  Q3  Does note pitch read from the contour (median of the note's bends —
 *      full span, and aubio's frames 3..9) beat the integer pitch on COnP /
 *      chroma? (R5 falls out of the same run)
 *
 * Run: pnpm --filter @mushee/api exec tsx scripts/eval/bench-contour-pitch.ts
 * Env: BENCH_CONDITIONS=clean,echoey-room,...  (default: all acoustic)
 */

import { execFileSync } from 'child_process';
import ffmpegPath from 'ffmpeg-static';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'fs';
import { join, resolve } from 'path';

import {
  addPitchBendsToNoteEvents,
  BasicPitch,
  noteFramesToTime,
  outputToNotesPoly,
} from '@spotify/basic-pitch';

/** `NoteEvent` is not re-exported by the package index; the shape we read. */
interface NoteEvent {
  startFrame: number;
  durationFrames: number;
  pitchMidi: number;
  amplitude: number;
  pitchBends?: number[];
}

import { AudioDecoder } from '../../src/recordings/pipeline/audio-decoder';
import { BasicPitchModelLoader } from '../../src/recordings/pipeline/providers/basic-pitch-model-loader';
import { estimateTuningOffsetCents } from '../../src/recordings/pipeline/voice-notation';
import { type EstNote, scoreNotesBest } from './lib/metrics';
import { CONDITIONS, SCENARIOS } from './scenarios';
import type { GroundTruth } from './types';

const EVAL_ROOT = resolve(__dirname, '../fixtures/eval');
const TMP = resolve(__dirname, '.tmp-contour');
/** The very-high band's resolved profile (pipeline-profile.ts). */
const BAND = { minFreq: 500, maxFreq: 4500, highpassHz: 300 };
const DETUNE_CENTS = -35;

interface Clip {
  scenario: string;
  melody: string;
  condition: string;
  truth: GroundTruth;
  wav: string;
  /** Time scale applied to truth (detuned clips only). */
  timeScale: number;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[s.length >> 1];
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

/** Note float pitch from its contour bends (1/3-semitone bins). */
function floatPitch(n: NoteEvent, window?: [number, number]): number {
  if (!n.pitchBends?.length) return n.pitchMidi;
  const bends = window ? n.pitchBends.slice(window[0], window[1]) : n.pitchBends;
  if (!bends.length) return n.pitchMidi + median(n.pitchBends) / 3;
  return n.pitchMidi + median(bends) / 3;
}

const N_FREQ_BINS_CONTOURS = 264;
const BINS_TOLERANCE = 25;
/** exp Gaussian window matching the library's (σ = 5 bins over ±25). */
const GAUSS = Array.from({ length: BINS_TOLERANCE * 2 + 1 }, (_, i) =>
  Math.exp(-0.5 * ((i - BINS_TOLERANCE) / 5) ** 2),
);

/**
 * SUB-BIN per-frame deviations for a note, in semitones: the library's
 * Gaussian-weighted argmax plus a parabolic refinement over the argmax's
 * neighbours (the §13.3 coarse-to-fine trick). The integer bends quantize to
 * 1/3 semitone, which the Q1 measurement showed is too coarse for tuning-offset
 * estimation — this is the cheap fix the wire decision should be judged on.
 */
function subBinDevs(contours: number[][], n: NoteEvent): number[] {
  const freqIdx = Math.floor(Math.round(3 * (n.pitchMidi - 21)));
  const start = Math.max(freqIdx - BINS_TOLERANCE, 0);
  const end = Math.min(N_FREQ_BINS_CONTOURS, freqIdx + BINS_TOLERANCE + 1);
  const gaussOffset = Math.max(0, BINS_TOLERANCE - freqIdx);
  const pbShift = BINS_TOLERANCE - gaussOffset;
  const devs: number[] = [];
  for (let f = n.startFrame; f < n.startFrame + n.durationFrames; f += 1) {
    const row = contours[f];
    if (!row) break;
    let best = -Infinity;
    let k = 0;
    const w: number[] = [];
    for (let i = start; i < end; i += 1) {
      const v = row[i] * GAUSS[gaussOffset + (i - start)];
      w.push(v);
      if (v > best) {
        best = v;
        k = i - start;
      }
    }
    let delta = 0;
    if (k > 0 && k < w.length - 1) {
      const denom = w[k - 1] - 2 * w[k] + w[k + 1];
      if (Math.abs(denom) > 1e-12) {
        delta = Math.max(-0.5, Math.min(0.5, (0.5 * (w[k - 1] - w[k + 1])) / denom));
      }
    }
    devs.push((k + delta - pbShift) / 3);
  }
  return devs;
}

/** Float pitch from sub-bin deviations (median over the span or a frame window). */
function subBinFloat(contours: number[][], n: NoteEvent, window?: [number, number]): number {
  const devs = subBinDevs(contours, n);
  if (!devs.length) return n.pitchMidi;
  const sel = window ? devs.slice(window[0], window[1]) : devs;
  return n.pitchMidi + median(sel.length ? sel : devs);
}

function toEst(
  notes: { startTimeSeconds: number; durationSeconds: number }[],
  midis: number[],
): EstNote[] {
  return notes.map((n, i) => ({
    onsetSec: n.startTimeSeconds,
    durSec: n.durationSeconds,
    midi: midis[i],
  }));
}

/** Duration-weighted pitch-class histogram (12 bins). */
function pcHistogram(notes: { midi: number; durSec: number }[]): number[] {
  const h = new Array(12).fill(0);
  for (const n of notes) h[((n.midi % 12) + 12) % 12] += n.durSec;
  const total = h.reduce((a, b) => a + b, 0);
  return total > 0 ? h.map((x) => x / total) : h;
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na > 0 && nb > 0 ? dot / Math.sqrt(na * nb) : 0;
}

async function main(): Promise<void> {
  const conditionFilter = (process.env.BENCH_CONDITIONS ?? '')
    .split(',').map((s) => s.trim()).filter(Boolean);
  const acoustic = CONDITIONS.filter(
    (c) => c.detuneCents === undefined &&
      (!conditionFilter.length || conditionFilter.includes(c.id)),
  );
  const scenarios = SCENARIOS.filter((s) =>
    ['whistle-mid', 'whistle-high', 'piccolo-veryhigh'].includes(s.id),
  );
  mkdirSync(TMP, { recursive: true });

  const clips: Clip[] = [];
  for (const s of scenarios) {
    const dir = join(EVAL_ROOT, s.id);
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.truth.json')) continue;
      const melody = f.replace('.truth.json', '');
      const truth = JSON.parse(readFileSync(join(dir, f), 'utf8')) as GroundTruth;
      for (const c of acoustic) {
        const wav = join(dir, `${melody}__${c.id}.wav`);
        if (!existsSync(wav)) continue;
        clips.push({ scenario: s.id, melody, condition: c.id, truth, wav, timeScale: 1 });
      }
      // Q1: a known global detune of the clean take. asetrate shifts pitch AND
      // tempo by the same factor, so the truth's time axis is rescaled to match.
      const clean = join(dir, `${melody}__clean.wav`);
      if (existsSync(clean)) {
        const factor = Math.pow(2, DETUNE_CENTS / 1200);
        const out = join(TMP, `${s.id}__${melody}__det.wav`);
        execFileSync(ffmpegPath as unknown as string, [
          '-y', '-loglevel', 'error', '-i', clean,
          '-af', `asetrate=44100*${factor},aresample=44100`,
          out,
        ]);
        clips.push({
          scenario: s.id, melody, condition: `detuned${DETUNE_CENTS}c`, truth,
          wav: out, timeScale: 1 / factor,
        });
      }
    }
  }
  console.log(`${clips.length} clips (${scenarios.length} scenarios × ${acoustic.length}+1 conditions)`);

  const decoder = new AudioDecoder();
  const loader = new BasicPitchModelLoader(resolve(process.cwd(), 'model'));

  interface Row {
    condition: string;
    f1Int: number; f1Full: number; f1Sub: number; f1SubF39: number;
    chromaInt: number; chromaSub: number;
    meanDevCents: number;
    /** detuned clips only */
    recoveredOffset?: number; recoveredOffsetIntBins?: number; f1Corrected?: number;
    cosInt?: number; cosFloat?: number;
  }
  const rows: Row[] = [];

  for (const clip of clips) {
    const buf = readFileSync(clip.wav);
    const decoded = await decoder.decode(buf, 22050, {
      loudnorm: true,
      highpassHz: BAND.highpassHz,
    });
    const model = await loader.load();
    const bp = new BasicPitch(Promise.resolve(model));
    const frames: number[][] = [];
    const onsets: number[][] = [];
    const contours: number[][] = [];
    await bp.evaluateModel(
      decoded.samples,
      (f, o, c) => {
        frames.push(...f);
        onsets.push(...o);
        contours.push(...c);
      },
      () => {},
    );
    const raw = outputToNotesPoly(
      frames, onsets, 0.5, 0.3, 11, true, BAND.maxFreq, BAND.minFreq, false, 11,
    );
    const withBends = addPitchBendsToNoteEvents(contours, raw, 25);
    const timed = noteFramesToTime(withBends);

    const truthNotes = clip.truth.notes.map((n) => ({
      ...n,
      onsetSec: n.onsetSec * clip.timeScale,
      durSec: n.durSec * clip.timeScale,
    }));
    const truth = { ...clip.truth, notes: truthNotes };

    const floatsFull = withBends.map((n) => floatPitch(n as NoteEvent));
    const floatsSub = withBends.map((n) => subBinFloat(contours, n as NoteEvent));
    const floatsSubF39 = withBends.map((n) => subBinFloat(contours, n as NoteEvent, [2, 9]));
    const opts = { onsetTolSec: 0.1, timingTolSec: 0.3 };
    const mInt = scoreNotesBest(truth, toEst(timed, timed.map((n) => n.pitchMidi)), opts);
    const mFull = scoreNotesBest(truth, toEst(timed, floatsFull.map(Math.round)), opts);
    const mSub = scoreNotesBest(truth, toEst(timed, floatsSub.map(Math.round)), opts);
    const mSubF39 = scoreNotesBest(truth, toEst(timed, floatsSubF39.map(Math.round)), opts);

    const row: Row = {
      condition: clip.condition,
      f1Int: mInt.f1, f1Full: mFull.f1, f1Sub: mSub.f1, f1SubF39: mSubF39.f1,
      chromaInt: mInt.chromaF1, chromaSub: mSub.chromaF1,
      // Mean sub-bin deviation from the note's own integer pitch, in cents —
      // on CLEAN in-tune audio this is the contour grid's constant offset
      // against `midiPitchToContourBin` (if any), which any consumer of these
      // deviations must calibrate out.
      meanDevCents: mean(floatsSub.map((p, i) => (p - timed[i].pitchMidi) * 100)),
    };

    if (clip.condition.startsWith('detuned')) {
      const off = estimateTuningOffsetCents(timed.map((n, i) => ({
        pitchMidiFloat: floatsSub[i],
        durationSeconds: n.durationSeconds,
      })));
      row.recoveredOffset = off;
      row.recoveredOffsetIntBins = estimateTuningOffsetCents(timed.map((n, i) => ({
        pitchMidiFloat: floatsFull[i],
        durationSeconds: n.durationSeconds,
      })));
      const corrected = floatsSub.map((p) => Math.round(p - off / 100));
      row.f1Corrected = scoreNotesBest(truth, toEst(timed, corrected), opts).f1;
      // Q2: histogram agreement with the truth (which is the UNDETUNED score).
      const truthHist = pcHistogram(truthNotes.map((n) => ({ midi: n.midi, durSec: n.durSec })));
      row.cosInt = cosine(truthHist, pcHistogram(
        timed.map((n) => ({ midi: n.pitchMidi, durSec: n.durationSeconds })),
      ));
      row.cosFloat = cosine(truthHist, pcHistogram(
        timed.map((n, i) => ({ midi: Math.round(floatsSub[i] - off / 100), durSec: n.durationSeconds })),
      ));
    }
    rows.push(row);
  }

  const byCondition = new Map<string, Row[]>();
  for (const r of rows) {
    if (!byCondition.has(r.condition)) byCondition.set(r.condition, []);
    byCondition.get(r.condition)?.push(r);
  }
  console.log('\ncondition           f1(int)  f1(bin)  f1(sub)  f1(subF3-9)  chroma(int)  chroma(sub)  n');
  for (const [cond, rs] of byCondition) {
    console.log(
      cond.padEnd(20) +
        mean(rs.map((r) => r.f1Int)).toFixed(3).padEnd(9) +
        mean(rs.map((r) => r.f1Full)).toFixed(3).padEnd(9) +
        mean(rs.map((r) => r.f1Sub)).toFixed(3).padEnd(9) +
        mean(rs.map((r) => r.f1SubF39)).toFixed(3).padEnd(13) +
        mean(rs.map((r) => r.chromaInt)).toFixed(3).padEnd(13) +
        mean(rs.map((r) => r.chromaSub)).toFixed(3).padEnd(13) +
        `${mean(rs.map((r) => r.meanDevCents)).toFixed(1)}¢`.padEnd(8) +
        rs.length,
    );
  }
  const det = rows.filter((r) => r.recoveredOffset !== undefined);
  if (det.length) {
    console.log(`\nQ1 — known detune ${DETUNE_CENTS}¢:`);
    console.log(
      `  recovered offset (sub-bin): mean ${mean(det.map((r) => r.recoveredOffset ?? 0)).toFixed(1)}¢ ` +
        `(per clip: ${det.map((r) => (r.recoveredOffset ?? 0).toFixed(0)).join(' ')})`,
    );
    console.log(
      `  recovered offset (integer bins): mean ${mean(det.map((r) => r.recoveredOffsetIntBins ?? 0)).toFixed(1)}¢`,
    );
    console.log(
      `  COnP: integer ${mean(det.map((r) => r.f1Int)).toFixed(3)} → ` +
        `sub-bin float ${mean(det.map((r) => r.f1Sub)).toFixed(3)} → ` +
        `offset-corrected ${mean(det.map((r) => r.f1Corrected ?? 0)).toFixed(3)}`,
    );
    console.log(
      `Q2 — histogram cosine vs truth: integer ${mean(det.map((r) => r.cosInt ?? 0)).toFixed(3)} ` +
        `→ sub-bin float+offset ${mean(det.map((r) => r.cosFloat ?? 0)).toFixed(3)}`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
