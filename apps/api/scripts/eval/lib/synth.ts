/**
 * Direct additive synthesis of voice / whistle clips from ground-truth notes.
 *
 * These are deliberately simple proxies — they are NOT meant to sound like a
 * real human, only to reproduce the *pitch characteristics* that break the
 * pipeline: whistles are near-pure high-frequency tones; sung voice is a
 * harmonic-rich tone whose fundamental can sit very low (bass) or fairly high
 * (soprano), with vibrato and a little breath noise.
 */

import type { GroundTruth } from '../types';
import { midiToHz } from './groundTruth';

export interface SynthOptions {
  sampleRate: number;
  kind: 'voice' | 'whistle';
  /** 0..1 master gain before degradation. */
  gain?: number;
  /** Deterministic noise seed so corpus generation is reproducible. */
  seed?: number;
}

/** Tiny deterministic PRNG (mulberry32) so generated audio is reproducible. */
function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Simple formant gain for a harmonic at frequency f (very rough vowel "ah"). */
function formantGain(f: number): number {
  const formants = [
    { freq: 700, bw: 130 },
    { freq: 1220, bw: 70 },
    { freq: 2600, bw: 160 },
  ];
  // Baseline keeps the fundamental and low harmonics audible (real sung voice
  // is not formant-only); formants add a moderate ~3× boost, not 13×.
  let g = 0.4;
  for (const fmt of formants) {
    const d = (f - fmt.freq) / fmt.bw;
    g += 0.7 * Math.exp(-0.5 * d * d);
  }
  return g;
}

export function synthesize(truth: GroundTruth, opts: SynthOptions): Float32Array {
  const sr = opts.sampleRate;
  const gain = opts.gain ?? 0.6;
  const rng = makeRng(opts.seed ?? 1);

  const last = truth.notes[truth.notes.length - 1];
  const totalSec = (last ? last.onsetSec + last.durSec : 0) + 0.2;
  const out = new Float32Array(Math.ceil(totalSec * sr));

  const vibRateHz = opts.kind === 'whistle' ? 5.0 : 5.5;
  const vibDepth = opts.kind === 'whistle' ? 0.004 : 0.008; // fractional f0
  const attack = 0.02;
  const release = opts.kind === 'whistle' ? 0.05 : 0.06;
  // Detach successive notes slightly so onsets are distinguishable.
  const gapSec = 0.04;

  for (const note of truth.notes) {
    const f0 = midiToHz(note.midi);
    const startSample = Math.floor(note.onsetSec * sr);
    const soundDur = Math.max(0.08, note.durSec - gapSec);
    const nSamples = Math.floor(soundDur * sr);

    // Number of harmonics to render (voice = rich, whistle = near-pure).
    const maxHarm = opts.kind === 'whistle' ? 2 : 24;

    let phase = 0;
    for (let i = 0; i < nSamples; i += 1) {
      const t = i / sr;
      const vib = 1 + vibDepth * Math.sin(2 * Math.PI * vibRateHz * t);
      const fInst = f0 * vib;
      phase += (2 * Math.PI * fInst) / sr;

      let sample = 0;
      for (let h = 1; h <= maxHarm; h += 1) {
        const fh = fInst * h;
        if (fh > sr / 2 - 500) break;
        let amp = 1 / h; // sawtooth-ish rolloff
        if (opts.kind === 'whistle') {
          amp = h === 1 ? 1 : 0.06; // almost pure
        } else {
          amp *= formantGain(fh);
        }
        sample += amp * Math.sin(h * phase);
      }

      // Envelope.
      const tEnd = soundDur - t;
      let env = 1;
      if (t < attack) env = t / attack;
      else if (tEnd < release) env = Math.max(0, tEnd / release);

      // Breath / mic noise floor.
      const noise =
        (rng() * 2 - 1) * (opts.kind === 'whistle' ? 0.012 : 0.02);

      const idx = startSample + i;
      if (idx < out.length) out[idx] += env * (sample * 0.3 + noise);
    }
  }

  // Normalize to target peak.
  let peak = 0;
  for (let i = 0; i < out.length; i += 1) peak = Math.max(peak, Math.abs(out[i]));
  if (peak > 0) {
    const scale = gain / peak;
    for (let i = 0; i < out.length; i += 1) out[i] *= scale;
  }
  return out;
}
