/**
 * Decompose the note-level disagreement on the real corpus into its causes, so a
 * ceiling-raising effort targets the real one. Aligns estimated notes to ground
 * truth by onset (pitch-agnostic, 0.25 s window) and reports:
 *   - exact / +-1 semitone / >=2 semitone among MATCHED pairs (pitch-estimate error)
 *   - missed GT notes (recall) and spurious est notes (precision)
 * +-1 dominating => improve per-note pitch; missed/spurious dominating => boundaries.
 *
 * Run: pnpm --filter api exec tsx scripts/eval/note-errors.ts [dataset]
 */

import { readFileSync } from 'fs';
import { join, resolve } from 'path';

import { AudioConverter } from '../../src/recordings/AudioConverter';
import { AudioDecoder } from '../../src/recordings/AudioDecoder';
import { NoteExtractor, type NoteExtractorOptions } from '../../src/recordings/NoteExtractor';
import { OnsetDetector } from '../../src/recordings/OnsetDetector';
import { ProfileResolver } from '../../src/recordings/profiles/ProfileResolver';
import { ProviderRegistry } from '../../src/recordings/providers/ProviderRegistry';
import type { PitchTranscribeOptions } from '../../src/recordings/providers/PitchProvider';
import type { EstNote } from './lib/metrics';
import { discoverRealDatasets, listRealClips } from './lib/realCorpus';
import type { GroundTruth, TruthNote } from './types';

const DETECT_SR = 16000;
const MATCH_WIN = 0.25;
const REAL_ROOT = resolve(__dirname, '../fixtures/eval-real');
const MODELS = { basicPitch: resolve(process.cwd(), 'model'), crepeTiny: resolve(process.cwd(), 'model-crepe-tiny') };

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function bpmFromOnsets(onsets: number[]): number {
  const iois: number[] = [];
  for (let i = 1; i < onsets.length; i += 1) if (onsets[i] - onsets[i - 1] > 0.05) iois.push(onsets[i] - onsets[i - 1]);
  const med = median(iois);
  return med ? Math.max(50, Math.min(200, 60 / med)) : 120;
}

interface Tally { pairs: number; exact: number; off1: number; off2plus: number; missed: number; spurious: number; refN: number; estN: number; }

function tally(ref: TruthNote[], est: EstNote[], t: Tally): void {
  const used = new Array(est.length).fill(false);
  const sorted = [...ref].sort((a, b) => a.onsetSec - b.onsetSec);
  t.refN += ref.length; t.estN += est.length;
  for (const r of sorted) {
    let best = -1; let bestDt = Infinity;
    for (let j = 0; j < est.length; j += 1) {
      if (used[j]) continue;
      const dt = Math.abs(est[j].onsetSec - r.onsetSec);
      if (dt <= MATCH_WIN && dt < bestDt) { bestDt = dt; best = j; }
    }
    if (best < 0) { t.missed += 1; continue; }
    used[best] = true; t.pairs += 1;
    const d = Math.abs(est[best].midi - r.midi);
    if (d === 0) t.exact += 1; else if (d === 1) t.off1 += 1; else t.off2plus += 1;
  }
  t.spurious += used.filter((u) => !u).length;
}

async function main(): Promise<void> {
  const registry = new ProviderRegistry({ basicPitch: MODELS.basicPitch, crepeTiny: MODELS.crepeTiny });
  await registry.initAll();
  const resolver = new ProfileResolver();
  const decoder = new AudioDecoder();
  const onsetDetector = new OnsetDetector();

  const filter = (process.argv[2] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const datasets = discoverRealDatasets(REAL_ROOT).filter((d) => !filter.length || filter.includes(d.id));

  const segMode: 'median' | 'semitone' = (process.env.SEG as 'median' | 'semitone') ?? 'semitone';
  const ext: NoteExtractorOptions = { maxGridDivisor: 4 };

  for (const ds of datasets) {
    const t: Tally = { pairs: 0, exact: 0, off1: 0, off2plus: 0, missed: 0, spurious: 0, refN: 0, estN: 0 };
    for (const clip of listRealClips(ds.dir)) {
      let truth: GroundTruth; let wav: Buffer;
      try {
        truth = JSON.parse(readFileSync(join(ds.dir, `${clip}.truth.json`), 'utf8'));
        wav = readFileSync(join(ds.dir, `${clip}__real.wav`));
      } catch { continue; }
      const det = await decoder.decode(wav, DETECT_SR, { loudnorm: false, highpassHz: 30 });
      const profile = resolver.resolve(det.samples, DETECT_SR, { instrumentId: ds.instrumentId });
      const provider = registry.get(profile.providerName);
      const decoded = await decoder.decode(wav, provider.sampleRate, { loudnorm: provider.normalizeLoudness, highpassHz: profile.highpassHz });
      const onsetTimesSec = onsetDetector.detect(decoded.samples, provider.sampleRate);
      const opts: PitchTranscribeOptions = {
        minFreqHz: profile.minFreqHz, maxFreqHz: profile.maxFreqHz,
        confidenceThreshold: profile.confidenceThreshold, segmentMode: segMode,
      };
      const raw = await provider.transcribe(decoded.samples, opts, undefined, provider.createSession());
      const bpm = bpmFromOnsets(truth.notes.map((n) => n.onsetSec));
      const deduced = new NoteExtractor(ext).extract(raw, { bpm, onsetTimesSec }).deduced;
      tally(truth.notes, deduced.map((n) => ({ onsetSec: n.startTimeSeconds, durSec: n.durationSeconds, midi: n.pitchMidi })), t);
    }
    const pct = (n: number, d: number): string => (d ? ((100 * n) / d).toFixed(0) : '0') + '%';
    console.log(`\n=== ${ds.id} (seg=${segMode}, ${t.refN} ref / ${t.estN} est notes) ===`);
    console.log(`  matched pairs: ${t.pairs}`);
    console.log(`    exact pitch : ${t.exact} (${pct(t.exact, t.pairs)} of pairs)`);
    console.log(`    +-1 semitone: ${t.off1} (${pct(t.off1, t.pairs)})`);
    console.log(`    >=2 semitone: ${t.off2plus} (${pct(t.off2plus, t.pairs)})`);
    console.log(`  missed GT     : ${t.missed} (${pct(t.missed, t.refN)} of ref)`);
    console.log(`  spurious est  : ${t.spurious} (${pct(t.spurious, t.estN)} of est)`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
