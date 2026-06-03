/**
 * Coarse, provider-independent pitch scan used to choose a PipelineProfile.
 *
 * We don't need note-accurate pitch here — only a robust estimate of the
 * register the input occupies, so we can pick a provider and a frequency
 * window. Per frame we take the FFT magnitude and score every candidate
 * fundamental by SUMMING the magnitude at its first few harmonics (sub-harmonic
 * summation). Additive scoring — unlike multiplicative HPS — tolerates a missing
 * harmonic, so it doesn't latch onto 3× the fundamental for instruments with
 * weak even harmonics (clarinet) while still pinning a near-pure whistle at its
 * actual (high) frequency and a harmonic-rich voice at its true low fundamental.
 * Voiced frames feed a percentile summary.
 */

import { GLOBAL_MAX_FREQ_HZ, GLOBAL_MIN_FREQ_HZ } from './PipelineProfile';

export interface PitchScan {
  /** True if enough voiced frames were found to trust the estimate. */
  voiced: boolean;
  voicedFrames: number;
  p10Hz: number;
  medianHz: number;
  p90Hz: number;
}

const FFT_SIZE = 4096; // ~3.9 Hz bins at 16 kHz; ~256 ms window
const HOP = 2048;
/** Harmonics summed when scoring a candidate fundamental. */
const HARMONICS = 5;
/** Per-harmonic weight decay (h-th harmonic weighted 1/h). */

/** In-place iterative radix-2 Cooley–Tukey FFT on interleaved re/im. */
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wlenRe = Math.cos(ang);
    const wlenIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let wRe = 1;
      let wIm = 0;
      for (let k = 0; k < len / 2; k += 1) {
        const uRe = re[i + k];
        const uIm = im[i + k];
        const vRe = re[i + k + len / 2] * wRe - im[i + k + len / 2] * wIm;
        const vIm = re[i + k + len / 2] * wIm + im[i + k + len / 2] * wRe;
        re[i + k] = uRe + vRe;
        im[i + k] = uIm + vIm;
        re[i + k + len / 2] = uRe - vRe;
        im[i + k + len / 2] = uIm - vIm;
        const nwRe = wRe * wlenRe - wIm * wlenIm;
        wIm = wRe * wlenIm + wIm * wlenRe;
        wRe = nwRe;
      }
    }
  }
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))));
  return sorted[idx];
}

export function scanPitch(samples: Float32Array, sampleRate: number): PitchScan {
  const minBin = Math.max(1, Math.floor((GLOBAL_MIN_FREQ_HZ * FFT_SIZE) / sampleRate));
  const maxBin = Math.min(
    FFT_SIZE / 2 - 1,
    Math.ceil((GLOBAL_MAX_FREQ_HZ * FFT_SIZE) / sampleRate),
  );

  // Hann window, precomputed.
  const win = new Float64Array(FFT_SIZE);
  for (let i = 0; i < FFT_SIZE; i += 1) {
    win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1));
  }

  const f0s: number[] = [];
  const energies: number[] = [];
  const half = FFT_SIZE / 2;
  const mag = new Float64Array(half);
  const re = new Float64Array(FFT_SIZE);
  const im = new Float64Array(FFT_SIZE);

  const frameF0: number[] = [];
  for (let start = 0; start + FFT_SIZE <= samples.length; start += HOP) {
    let energy = 0;
    for (let i = 0; i < FFT_SIZE; i += 1) {
      const s = samples[start + i];
      re[i] = s * win[i];
      im[i] = 0;
      energy += s * s;
    }
    fft(re, im);
    for (let b = 0; b < half; b += 1) {
      mag[b] = Math.hypot(re[b], im[b]);
    }
    // Sub-harmonic summation: score each candidate fundamental by the weighted
    // sum of magnitude at its harmonics. Robust to a missing harmonic.
    let bestBin = minBin;
    let bestScore = 0;
    for (let b = minBin; b <= maxBin; b += 1) {
      let score = 0;
      for (let h = 1; h <= HARMONICS; h += 1) {
        const hb = b * h;
        if (hb >= half) break;
        score += mag[hb] / h;
      }
      if (score > bestScore) {
        bestScore = score;
        bestBin = b;
      }
    }
    frameF0.push((bestBin * sampleRate) / FFT_SIZE);
    energies.push(energy);
  }

  if (!energies.length) {
    return { voiced: false, voicedFrames: 0, p10Hz: 0, medianHz: 0, p90Hz: 0 };
  }

  // Voicing gate: keep frames with energy above 15% of the loudest frame.
  const maxEnergy = Math.max(...energies);
  const gate = maxEnergy * 0.15;
  for (let i = 0; i < frameF0.length; i += 1) {
    if (energies[i] >= gate) f0s.push(frameF0[i]);
  }

  if (f0s.length < 3) {
    return { voiced: false, voicedFrames: f0s.length, p10Hz: 0, medianHz: 0, p90Hz: 0 };
  }
  f0s.sort((a, b) => a - b);
  return {
    voiced: true,
    voicedFrames: f0s.length,
    p10Hz: percentile(f0s, 0.1),
    medianHz: percentile(f0s, 0.5),
    p90Hz: percentile(f0s, 0.9),
  };
}
