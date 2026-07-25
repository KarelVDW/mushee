/**
 * WHERE does accuracy go? An ablation from the model's raw pitch trajectory all
 * the way to the notated score, plus oracle upper bounds, over the real corpus.
 *
 * Every row is the SAME clip and the SAME model output, differing only in one
 * downstream stage — so the gap between two rows is that stage's exact cost. The
 * oracle rows (marked `*`) cheat by peeking at ground truth; they answer "how
 * much is even available here?" before we spend effort trying to claim it.
 *
 * Reading it:
 *   seg            what the segmenter emits, unquantized. The DETECTION ceiling.
 *   clean          + monophonic/vibrato/merge/split cleanup, still unquantized.
 *   quant@120      production today: snap to a fixed 120 BPM grid from t=0.
 *   quant@ioi      tempo from the median inter-onset interval (a cheap estimate).
 *   quant@fit *    tempo+phase that MINIMISE QUANTISATION RESIDUAL (no GT peek —
 *                  implementable; the number to beat).
 *   quant@oracle * tempo+phase that MAXIMISE F1 against GT. Ceiling for any
 *                  tempo estimator whatsoever.
 *   noquant *      cleanup with quantisation skipped entirely (free-time output).
 *
 * If `noquant` ≫ `quant@120` the loss is notation, not hearing. If `seg` is
 * already low, no amount of rhythm work will save us and the model/segmenter is
 * the bottleneck.
 *
 * Requires the track cache (built on first run; slow once, instant after).
 *
 * Run: pnpm --filter @mushee/api exec tsx scripts/eval/ablate.ts [dataset,...]
 * Env: ABLATE_LIMIT=n   cap clips per dataset (fast smoke run)
 */

import { resolve } from 'path';

import { NoteExtractor } from '../../src/recordings/pipeline/note-extractor';
import { segmentNotes } from '../../src/recordings/pipeline/providers/pitch-decoder';
import { ProviderRegistry } from '../../src/recordings/pipeline/providers/provider-registry';
import { type EstNote, scoreNotes } from './lib/metrics';
import { discoverRealDatasets, listRealClips } from './lib/realCorpus';
import { type CachedClip, TrackCache } from './lib/trackCache';
import type { TruthNote } from './types';

const REAL_ROOT = resolve(__dirname, '../fixtures/eval-real');
const CACHE_ROOT = resolve(__dirname, '../fixtures/eval-cache');
const MODELS = {
  basicPitch: resolve(process.cwd(), 'model'),
  crepeTiny: resolve(process.cwd(), 'model-crepe-tiny'),
};
const TOLS = [0.05, 0.1, 0.2];

/** Tempo search range for the fit/oracle rows. Covers plausible sung tempos. */
const BPM_LO = 40;
const BPM_HI = 240;
const BPM_STEP = 1;
/** Phase offsets tried per tempo, as a fraction of a beat. */
const PHASE_STEPS = 8;

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}
function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function toEst(notes: { startTimeSeconds: number; durationSeconds: number; pitchMidi: number }[]): EstNote[] {
  return notes.map((n) => ({
    onsetSec: n.startTimeSeconds,
    durSec: n.durationSeconds,
    midi: n.pitchMidi,
  }));
}

/** Longest common subsequence of two integer sequences. */
function lcsLen(a: number[], b: number[]): number {
  const dp: number[] = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i += 1) {
    let prev = 0;
    for (let j = 1; j <= b.length; j += 1) {
      const tmp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev + 1 : Math.max(dp[j], dp[j - 1]);
      prev = tmp;
    }
  }
  return dp[b.length];
}

/** Timing-agnostic pitch-sequence agreement — the ceiling any re-timing could reach. */
function seqF1(ref: TruthNote[], est: EstNote[]): number {
  const m = lcsLen(ref.map((n) => n.midi), est.map((n) => n.midi));
  const p = est.length ? m / est.length : 0;
  const r = ref.length ? m / ref.length : 0;
  return p + r > 0 ? (2 * p * r) / (p + r) : 0;
}

/** Median inter-onset interval → a first-guess tempo (what sweep-real.ts used). */
function bpmFromIoi(onsets: number[]): number {
  const iois: number[] = [];
  for (let i = 1; i < onsets.length; i += 1) {
    const d = onsets[i] - onsets[i - 1];
    if (d > 0.05) iois.push(d);
  }
  const med = median(iois);
  return med ? Math.max(BPM_LO, Math.min(BPM_HI, 60 / med)) : 120;
}

/**
 * Total quantisation residual of a performance under (bpm, phase): for each note
 * onset, the distance in beats to the nearest 16th-note grid position. This is
 * computable WITHOUT ground truth, so whichever (bpm, phase) minimises it is
 * something the product could actually choose at runtime. Normalised per note so
 * clips of different length are comparable.
 */
function quantResidual(onsetsSec: number[], bpm: number, phaseSec: number): number {
  if (!onsetsSec.length) return Infinity;
  const bps = bpm / 60;
  let total = 0;
  for (const t of onsetsSec) {
    const beat = (t - phaseSec) * bps;
    const grid = Math.round(beat * 4) / 4;
    total += Math.abs(beat - grid);
  }
  return total / onsetsSec.length;
}

interface Row {
  f1: Record<number, number[]>;
  seq: number[];
  estN: number[];
  refN: number[];
  extra: number[];
}
const newRow = (): Row => ({
  f1: Object.fromEntries(TOLS.map((t) => [t, []])) as Record<number, number[]>,
  seq: [],
  estN: [],
  refN: [],
  extra: [],
});

function record(row: Row, ref: TruthNote[], est: EstNote[], extra?: number): void {
  for (const t of TOLS) {
    row.f1[t].push(scoreNotes(ref, est, { onsetTolSec: t, timingTolSec: 0.3 }).f1);
  }
  row.seq.push(seqF1(ref, est));
  row.estN.push(est.length);
  row.refN.push(ref.length);
  if (extra !== undefined) row.extra.push(extra);
}

/**
 * Shift a whole performance in time. Quantisation is anchored at t=0, so the only
 * way to try a different metrical phase is to move the notes, quantise, and move
 * them back.
 */
function shifted(
  notes: { startTimeSeconds: number; durationSeconds: number; pitchMidi: number; amplitude: number }[],
  by: number,
): typeof notes {
  return notes.map((n) => ({ ...n, startTimeSeconds: n.startTimeSeconds + by }));
}

async function main(): Promise<void> {
  const registry = new ProviderRegistry(MODELS);
  await registry.initAll();
  const cache = new TrackCache(registry, CACHE_ROOT);
  const extractor = new NoteExtractor();
  const limit = Number(process.env.ABLATE_LIMIT) || Infinity;

  const filter = (process.argv[2] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const datasets = discoverRealDatasets(REAL_ROOT).filter(
    (d) => !filter.length || filter.includes(d.id),
  );

  const VARIANTS = [
    'seg',
    'clean',
    'quant@120',
    'quant@truthBpm',
    'quant@ioi',
    'quant@fit *',
    'quant@oracle *',
    'noquant *',
  ] as const;

  for (const ds of datasets) {
    const rows: Record<string, Row> = {};
    for (const v of VARIANTS) rows[v] = newRow();
    let skipped = 0;
    let used = 0;

    const clips = listRealClips(ds.dir).slice(0, limit === Infinity ? undefined : limit);
    for (const clip of clips) {
      let c: CachedClip | null;
      try {
        c = await cache.load(ds, clip);
      } catch {
        c = null;
      }
      if (!c) {
        skipped += 1;
        continue;
      }
      used += 1;
      const ref = c.truth.notes;

      // --- Stage 1: the segmenter, straight off the cached trajectory. ---
      const rawNotes = segmentNotes(c.track.cents, c.track.confidence, c.track.frames, {
        hopSize: 1, // times are computed as frame * hopSize / sampleRate …
        sampleRate: 1 / c.track.hopSec, // … so this pair reproduces hopSec exactly.
        confidenceThreshold: c.profile.confidenceThreshold ?? 0.5,
        minFreqHz: c.profile.minFreqHz,
        maxFreqHz: c.profile.maxFreqHz,
        minFramesPerNote: c.profile.minFramesPerNote ?? 4,
        pitchBinToleranceCents: 50,
        mode: 'semitone',
        smoothFrames: 4,
      });
      record(rows['seg'], ref, toEst(rawNotes));

      // --- Stage 2: cleanup (still real seconds). ---
      const opts = { bpm: 120, onsetTimesSec: c.onsetTimesSec };
      const cleaned = extractor.clean(rawNotes, opts);
      record(rows['clean'], ref, toEst(cleaned));
      record(rows['noquant *'], ref, toEst(cleaned));

      // --- Stage 3: notation, under several tempo choices. ---
      record(rows['quant@120'], ref, toEst(extractor.quantize(cleaned, 120)));
      // The dataset's OWN annotated tempo. Only meaningful where the corpus really
      // has one (GuitarSet was played to a click); the singing corpora are free-tempo
      // and carry a nominal 120, in which case this row duplicates quant@120.
      record(
        rows['quant@truthBpm'],
        ref,
        toEst(extractor.quantize(cleaned, c.truth.bpm || 120)),
        c.truth.bpm,
      );

      const ioiBpm = bpmFromIoi(cleaned.map((n) => n.startTimeSeconds));
      record(rows['quant@ioi'], ref, toEst(extractor.quantize(cleaned, ioiBpm)), ioiBpm);

      // Residual-minimising (bpm, phase) — no ground-truth peek.
      const onsets = cleaned.map((n) => n.startTimeSeconds);
      let fitBpm = 120;
      let fitPhase = 0;
      let fitBest = Infinity;
      for (let bpm = BPM_LO; bpm <= BPM_HI; bpm += BPM_STEP) {
        const beatSec = 60 / bpm;
        for (let p = 0; p < PHASE_STEPS; p += 1) {
          const phase = (p / PHASE_STEPS) * beatSec;
          const r = quantResidual(onsets, bpm, phase);
          if (r < fitBest) {
            fitBest = r;
            fitBpm = bpm;
            fitPhase = phase;
          }
        }
      }
      record(
        rows['quant@fit *'],
        ref,
        toEst(shifted(extractor.quantize(shifted(cleaned, -fitPhase), fitBpm), fitPhase)),
        fitBpm,
      );

      // Oracle (bpm, phase): the best F1 any tempo estimator could ever deliver.
      let oracleF1 = -1;
      let oracleEst: EstNote[] = [];
      let oracleBpm = 120;
      for (let bpm = BPM_LO; bpm <= BPM_HI; bpm += 2) {
        const beatSec = 60 / bpm;
        for (let p = 0; p < PHASE_STEPS; p += 1) {
          const phase = (p / PHASE_STEPS) * beatSec;
          const est = toEst(
            shifted(extractor.quantize(shifted(cleaned, -phase), bpm), phase),
          );
          const f = scoreNotes(ref, est, { onsetTolSec: 0.1, timingTolSec: 0.3 }).f1;
          if (f > oracleF1) {
            oracleF1 = f;
            oracleEst = est;
            oracleBpm = bpm;
          }
        }
      }
      record(rows['quant@oracle *'], ref, oracleEst, oracleBpm);
    }

    console.log(`\n=== ${ds.id} — ${used} clips (${skipped} skipped) ===`);
    console.log(
      'variant'.padEnd(16) +
        TOLS.map((t) => `COnP@${t}`.padEnd(10)).join('') +
        'seqF1'.padEnd(8) +
        'est/ref'.padEnd(10) +
        'bpm',
    );
    for (const v of VARIANTS) {
      const r = rows[v];
      console.log(
        v.padEnd(16) +
          TOLS.map((t) => mean(r.f1[t]).toFixed(3).padEnd(8)).join('') +
          mean(r.seq).toFixed(3).padEnd(8) +
          `${mean(r.estN).toFixed(1)}/${mean(r.refN).toFixed(1)}`.padEnd(10) +
          (r.extra.length ? median(r.extra).toFixed(0) : ''),
      );
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
