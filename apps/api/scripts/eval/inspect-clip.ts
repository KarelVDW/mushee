/**
 * Dump one cached clip in full: the ground truth, the pitch trajectory as a
 * coarse ASCII plot, and what each segmentation stage makes of it.
 *
 * Sweeps tell you which config scores better; only this tells you WHY. Most of
 * the pipeline's remaining error turns out to be one of a handful of concrete
 * shapes (vibrato crossing a semitone line, a glide dwelling on passing tones, a
 * breath splitting a held note, an annotation that disagrees with what is audibly
 * sung) and those are recognisable on sight and invisible in an average.
 *
 * Run: pnpm --filter @mushee/api exec tsx scripts/eval/inspect-clip.ts <dataset> [clip]
 *      (omit clip to list the dataset's clips with their note counts)
 */

import { resolve } from 'path';

import { NoteExtractor } from '../../src/recordings/pipeline/note-extractor';
import { NoteSegmenter } from '../../src/recordings/pipeline/note-segmenter';
import { segmentNotes } from '../../src/recordings/pipeline/providers/pitch-decoder';
import { ProviderRegistry } from '../../src/recordings/pipeline/providers/provider-registry';
import { discoverRealDatasets, listRealClips } from './lib/realCorpus';
import { splitOf } from './lib/split';
import { type CachedClip, TrackCache } from './lib/trackCache';

const REAL_ROOT = resolve(__dirname, '../fixtures/eval-real');
const CACHE_ROOT = resolve(__dirname, '../fixtures/eval-cache');
const MODELS = {
  basicPitch: resolve(process.cwd(), 'model'),
  crepeTiny: resolve(process.cwd(), 'model-crepe-tiny'),
};

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
function noteName(midi: number): string {
  return `${NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
}

function dump(
  label: string,
  notes: { startTimeSeconds: number; durationSeconds: number; pitchMidi: number }[],
): void {
  console.log(`\n  ${label} (${notes.length} notes)`);
  for (const n of notes) {
    const end = n.startTimeSeconds + n.durationSeconds;
    console.log(
      `    ${n.startTimeSeconds.toFixed(2).padStart(6)} → ${end.toFixed(2).padStart(6)}  ` +
        `(${n.durationSeconds.toFixed(2)}s)  ${String(n.pitchMidi).padStart(3)} ${noteName(n.pitchMidi)}`,
    );
  }
}

/**
 * One text row per 100 ms: the median cents in that slice as a semitone offset
 * from the clip's lowest sung note, so vibrato swing and glides are visible as
 * horizontal wobble. `·` marks an unvoiced/low-confidence frame.
 */
function plot(c: CachedClip): void {
  const track = c.track;
  const conf = c.profile.confidenceThreshold ?? 0.5;
  const perRow = Math.max(1, Math.round(0.1 / track.hopSec));
  let lo = Infinity;
  for (let i = 0; i < track.frames; i += 1) {
    if (track.confidence[i] >= conf) lo = Math.min(lo, track.cents[i]);
  }
  if (!Number.isFinite(lo)) {
    console.log('  (no voiced frames)');
    return;
  }
  const base = Math.floor(lo / 100) * 100;
  console.log(
    `\n  pitch contour — one row per 100 ms, column = 20 cents above ${noteName(base / 100)}\n` +
      '  (| = semitone lines, · = unvoiced)',
  );
  for (let r = 0; r * perRow < track.frames; r += 1) {
    const start = r * perRow;
    const end = Math.min(track.frames, start + perRow);
    const vals: number[] = [];
    let voicedCount = 0;
    for (let i = start; i < end; i += 1) {
      if (track.confidence[i] >= conf) {
        vals.push(track.cents[i]);
        voicedCount += 1;
      }
    }
    const t = (start * track.hopSec).toFixed(1).padStart(5);
    if (!vals.length) {
      console.log(`  ${t}s ·`);
      continue;
    }
    vals.sort((a, b) => a - b);
    const med = vals[vals.length >> 1];
    const col = Math.round((med - base) / 20);
    const spread = vals[vals.length - 1] - vals[0];
    const row: string[] = [];
    for (let k = 0; k <= Math.max(col, 0); k += 1) {
      row.push(k % 5 === 0 ? '|' : ' ');
    }
    row[Math.max(col, 0)] = spread > 90 ? '#' : spread > 45 ? '=' : '*';
    console.log(
      `  ${t}s ${row.join('')}  ${(med / 100).toFixed(2)} ${noteName(Math.round(med / 100))}` +
        `  spread=${spread.toFixed(0)}c conf=${(voicedCount / (end - start)).toFixed(2)}`,
    );
  }
}

async function main(): Promise<void> {
  const [dsId, clipArg] = process.argv.slice(2);
  const registry = new ProviderRegistry(MODELS);
  await registry.initAll();
  const cache = new TrackCache(registry, CACHE_ROOT);
  const ds = discoverRealDatasets(REAL_ROOT).find((d) => d.id === dsId);
  if (!ds) {
    console.error(`unknown dataset '${dsId}'`);
    process.exit(1);
  }

  if (!clipArg) {
    for (const clip of listRealClips(ds.dir)) {
      const c = await cache.load(ds, clip);
      if (!c) continue;
      console.log(
        `${clip.padEnd(42)} ${String(c.truth.notes.length).padStart(3)} notes  ` +
          `${c.durationSec.toFixed(1)}s  ${splitOf(ds.id, clip)}`,
      );
    }
    return;
  }

  const c = await cache.load(ds, clipArg);
  if (!c) {
    console.error(`clip '${clipArg}' not cached`);
    process.exit(1);
  }

  console.log(
    `\n=== ${ds.id}/${c.clip} ===\n` +
      `  duration ${c.durationSec.toFixed(2)}s  profile=${c.profile.id} ` +
      `provider=${c.providerName} window=${c.profile.minFreqHz.toFixed(0)}-${c.profile.maxFreqHz.toFixed(0)}Hz ` +
      `conf=${c.profile.confidenceThreshold ?? 0.5}\n` +
      `  onsets(${c.onsetTimesSec.length}): ${c.onsetTimesSec.map((t) => t.toFixed(2)).join(' ')}`,
  );

  dump('TRUTH', c.truth.notes.map((n) => ({
    startTimeSeconds: n.onsetSec,
    durationSeconds: n.durSec,
    pitchMidi: n.midi,
  })));

  const legacy = segmentNotes(c.track.cents, c.track.confidence, c.track.frames, {
    hopSize: 1,
    sampleRate: 1 / c.track.hopSec,
    confidenceThreshold: c.profile.confidenceThreshold ?? 0.5,
    minFreqHz: c.profile.minFreqHz,
    maxFreqHz: c.profile.maxFreqHz,
    minFramesPerNote: c.profile.minFramesPerNote ?? 4,
    pitchBinToleranceCents: 50,
    mode: 'semitone',
    smoothFrames: 4,
  });
  dump('LEGACY segmenter', legacy);

  const hmm = new NoteSegmenter({
    confidenceThreshold: c.profile.confidenceThreshold ?? 0.5,
    minFreqHz: c.profile.minFreqHz,
    maxFreqHz: c.profile.maxFreqHz,
  }).segment(c.track, c.energy);
  dump('HMM segmenter', hmm);

  const extractor = new NoteExtractor();
  dump('LEGACY + clean', extractor.clean(legacy, { bpm: 120, onsetTimesSec: c.onsetTimesSec }));
  dump(
    'LEGACY + clean + quantize@120',
    extractor.extract(legacy, { bpm: 120, onsetTimesSec: c.onsetTimesSec }).deduced,
  );

  plot(c);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
