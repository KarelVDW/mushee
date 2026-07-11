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
 *
 * Noise robustness: the spectrum is WHITENED (each bin divided by its local
 * MEDIAN, capped) before summation, so a wind/pink-noise tilt can't out-vote a
 * real fundamental; and a frame only votes if its harmonic stack stands out
 * against the frame's median candidate (`harmonicity` gate) — pure broadband
 * frames used to pass the energy-only gate and corrupt the register
 * percentiles, mis-locking the whole session's window and provider. The scan
 * also measures a harmonic-to-residual `snrDb` per take, which the resolver
 * logs/flags as telemetry (and can act on via env-enabled adaptations).
 */

import { GLOBAL_MAX_FREQ_HZ, GLOBAL_MIN_FREQ_HZ } from './pipeline-profile';

export interface PitchScan {
  /** True if enough voiced frames were found to trust the estimate. */
  voiced: boolean;
  voicedFrames: number;
  p10Hz: number;
  medianHz: number;
  p90Hz: number;
  /**
   * Harmonic-to-residual ratio in dB, the noise-adaptation signal: within each
   * voted frame, the energy in the picked fundamental's harmonic bins versus
   * everything else in the analysis band (wind, chatter, hiss, reverb wash of
   * other notes), median across voted frames. Needs no gaps, so it works on
   * wall-to-wall legato. Undefined only when nothing was voted.
   */
  snrDb?: number;
  /**
   * Fraction of all above-floor frames (≥ 2% of the loudest frame's energy)
   * that are non-tonal. Diagnostic + secondary adaptation signal.
   */
  noisiness: number;
  /**
   * Quiet-frame level relative to the loudest frame, in dB (p15 of frame
   * energies / max). Clean takes with gaps sit far below (≈ -35 dB); steady
   * backdrops (wind, chatter, HVAC) push it toward 0.
   */
  noiseFloorDb: number;
  /** Median tonality (best/median candidate score) of the voted frames. */
  harmonicityMedian: number;
}

const FFT_SIZE = 4096; // ~3.9 Hz bins at 16 kHz; ~256 ms window
const HOP = 2048;
/** Harmonics summed when scoring a candidate fundamental. */
const HARMONICS = 5;
/**
 * Half-width (bins) of the local MEDIAN used for spectral whitening. Must span
 * several harmonic spacings of the lowest supported fundamental (55 Hz ≈ 14
 * bins) so the median lands on the gaps BETWEEN a low comb's harmonics rather
 * than on the harmonics themselves — a mean (or a narrow window) flattens
 * densely-packed low-register combs and cost bassoon/tuba their clean scores.
 */
const WHITEN_HALF_WIDTH = 32; // ±32 bins ≈ ±125 Hz at 16 kHz
/**
 * Ceiling on whitened prominence. On a clean tone the gaps between partials
 * are near zero, so an uncapped ratio explodes and single high harmonics can
 * out-vote the fundamental's whole stack; capped, the summation counts the
 * CO-OCCURRENCE of harmonics (each worth at most this much), which is what
 * actually distinguishes a fundamental from its own overtones.
 */
const WHITEN_PROMINENCE_CAP = 10;
/**
 * A frame votes only if its best harmonic stack scores at least this many
 * times the MEDIAN candidate's score in the same frame — a self-normalizing
 * tonality measure, immune to the spectral tilt and window-edge effects that
 * defeat a fixed threshold on raw whitened prominence. Broadband noise lands
 * near 2.5; even a weak pitched frame under heavy noise clears 10.
 */
const HARMONICITY_GATE = Number.isFinite(Number(process.env.RECORDING_HARMONICITY_GATE))
  ? Number(process.env.RECORDING_HARMONICITY_GATE)
  : 4.0;
/** Frames below this fraction of the loudest frame's energy are ignored entirely. */
const FLOOR_ENERGY_FRACTION = 0.02;
/** Log-spaced sub-bands for the residual (noise) estimate — see scanPitch. */
const RESIDUAL_BANDS = 8;

/**
 * A/B kill-switch for eval sweeps: RECORDING_NOISE_ADAPT=0 restores the
 * legacy scan (no whitening, energy-only voicing gate). Production default: on.
 */
const NOISE_ADAPT = process.env.RECORDING_NOISE_ADAPT !== '0';

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

/**
 * Whiten a magnitude spectrum in place: divide each bin by the local MEDIAN
 * (±WHITEN_HALF_WIDTH bins). The median of a harmonic comb's neighbourhood is
 * the level of the gaps between partials, so tonal peaks keep their full
 * prominence — including densely-packed low-register combs, which a local
 * mean flattens — while the smooth tilt of wind/pink noise still divides away.
 */
function whiten(mag: Float64Array, scratch: Float64Array): void {
  const n = mag.length;
  let total = 0;
  for (let b = 0; b < n; b += 1) {
    scratch[b] = mag[b];
    total += mag[b];
  }
  const eps = (total / n) * 1e-3 + 1e-12;
  const windowBuf = new Float64Array(2 * WHITEN_HALF_WIDTH + 1);
  for (let b = 0; b < n; b += 1) {
    const lo = Math.max(0, b - WHITEN_HALF_WIDTH);
    const hi = Math.min(n - 1, b + WHITEN_HALF_WIDTH);
    const len = hi - lo + 1;
    for (let i = 0; i < len; i += 1) windowBuf[i] = scratch[lo + i];
    const view = windowBuf.subarray(0, len);
    view.sort();
    const median = view[len >> 1];
    mag[b] = Math.min(mag[b] / (median + eps), WHITEN_PROMINENCE_CAP);
  }
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

  const energies: number[] = [];
  const half = FFT_SIZE / 2;
  const mag = new Float64Array(half);
  const scratch = new Float64Array(half);
  const re = new Float64Array(FFT_SIZE);
  const im = new Float64Array(FFT_SIZE);

  const frameF0: number[] = [];
  const frameHarmonicity: number[] = [];
  const frameSnrDb: number[] = [];
  const candidateScores = new Float64Array(maxBin - minBin + 1);
  const rawMag = new Float64Array(half);
  const residualScratch = new Float64Array(half);
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
      rawMag[b] = mag[b];
    }
    if (NOISE_ADAPT) whiten(mag, scratch);
    // Sub-harmonic summation over the WHITENED spectrum: score each candidate
    // fundamental by the weighted sum of prominence at its harmonics. Robust
    // to a missing harmonic, and (post-whitening) to any broadband tilt.
    let bestBin = minBin;
    let bestScore = 0;
    let ci = 0;
    for (let b = minBin; b <= maxBin; b += 1) {
      let score = 0;
      for (let h = 1; h <= HARMONICS; h += 1) {
        const hb = b * h;
        if (hb >= half) break;
        score += mag[hb] / h;
      }
      candidateScores[ci] = score;
      ci += 1;
      if (score > bestScore) {
        bestScore = score;
        bestBin = b;
      }
    }
    frameF0.push((bestBin * sampleRate) / FFT_SIZE);
    // Tonality: the winning stack vs the run-of-the-mill candidate in the SAME
    // frame. Self-normalizing — spectral tilt lifts both numerator and
    // denominator, so wind can't fake a harmonic stack.
    const sortedScores = candidateScores.slice(0, ci).sort();
    frameHarmonicity.push(bestScore / (sortedScores[ci >> 1] + 1e-12));
    // Harmonic-to-residual: energy near the picked f0's harmonics vs the rest
    // of the analysis band, on the RAW spectrum (rawMag was saved before
    // whitening). This is the per-frame noise measurement — the backdrop is
    // visible between the harmonics even while a note sounds over it. The
    // fundamental's FRACTIONAL bin is refined by parabolic interpolation so
    // the mask stays centred on high harmonics (integer-bin error times h
    // walks the mask off the partials and fakes a residual).
    let fracBin = bestBin;
    if (bestBin > 0 && bestBin < half - 1) {
      const alpha = Math.log(rawMag[bestBin - 1] + 1e-12);
      const beta = Math.log(rawMag[bestBin] + 1e-12);
      const gamma = Math.log(rawMag[bestBin + 1] + 1e-12);
      const denom = alpha - 2 * beta + gamma;
      if (denom < 0) fracBin = bestBin + Math.max(-0.5, Math.min(0.5, (0.5 * (alpha - gamma)) / denom));
    }
    let harmonicE = 0;
    const residualMaxBin = Math.min(half - 1, maxBin * HARMONICS);
    for (let h = 1; h * fracBin <= residualMaxBin; h += 1) {
      const hb = Math.round(h * fracBin);
      const lo = Math.max(minBin, hb - 3);
      const hi = Math.min(residualMaxBin, hb + 3);
      for (let b = lo; b <= hi; b += 1) harmonicE += rawMag[b] * rawMag[b];
    }
    // Residual = Σ over log-spaced sub-bands of (median bin energy × band
    // size). Medians are immune to the harmonics and their window-skirt
    // leakage (a plain sum counts skirts as phantom noise), while the
    // per-sub-band split still catches noise CONCENTRATED in one region —
    // wind lives almost entirely below ~300 Hz, invisible to one global
    // median over the whole band.
    let residualE = 0;
    for (let seg = 0; seg < RESIDUAL_BANDS; seg += 1) {
      const lo = Math.max(minBin, Math.round(minBin * Math.pow(residualMaxBin / minBin, seg / RESIDUAL_BANDS)));
      const hi = Math.min(
        residualMaxBin,
        Math.round(minBin * Math.pow(residualMaxBin / minBin, (seg + 1) / RESIDUAL_BANDS)) - 1,
      );
      if (hi < lo) continue;
      let ri = 0;
      for (let b = lo; b <= hi; b += 1) {
        residualScratch[ri] = rawMag[b] * rawMag[b];
        ri += 1;
      }
      const sorted = residualScratch.subarray(0, ri).sort();
      residualE += sorted[ri >> 1] * ri;
    }
    frameSnrDb.push(10 * Math.log10((harmonicE + 1e-12) / (residualE + 1e-12)));
    energies.push(energy);
  }

  if (!energies.length) {
    return {
      voiced: false,
      voicedFrames: 0,
      p10Hz: 0,
      medianHz: 0,
      p90Hz: 0,
      noisiness: 0,
      noiseFloorDb: 0,
      harmonicityMedian: 0,
    };
  }

  // Energy gate as before (15% of the loudest frame), PLUS the harmonicity
  // gate: an energetic frame only votes for the register if its spectrum
  // actually looks pitched.
  const maxEnergy = Math.max(...energies);
  const gate = maxEnergy * 0.15;
  const f0s: number[] = [];
  const votedHarmonicity: number[] = [];
  const votedSnrs: number[] = [];
  let counted = 0;
  let nonTonal = 0;
  for (let i = 0; i < frameF0.length; i += 1) {
    if (energies[i] < maxEnergy * FLOOR_ENERGY_FRACTION) continue;
    counted += 1;
    const tonal = !NOISE_ADAPT || frameHarmonicity[i] >= HARMONICITY_GATE;
    if (!tonal) nonTonal += 1;
    if (energies[i] < gate) continue;
    if (tonal) {
      f0s.push(frameF0[i]);
      votedHarmonicity.push(frameHarmonicity[i]);
      votedSnrs.push(frameSnrDb[i]);
    }
  }

  const sortedEnergies = [...energies].sort((a, b) => a - b);
  const floor = percentile(sortedEnergies, 0.15);
  const noiseFloorDb = 10 * Math.log10((floor + 1e-12) / (maxEnergy + 1e-12));
  const noisiness = counted ? nonTonal / counted : 0;

  // The clip's noise picture: upper-quartile harmonic-to-residual SNR of the
  // frames that actually carried notes — real singing's breathy/consonant
  // frames drag a median down, while the sustained vowels show what the
  // backdrop actually is under the clearest signal.
  let snrDb: number | undefined;
  if (votedSnrs.length >= 3) {
    votedSnrs.sort((a, b) => a - b);
    snrDb = percentile(votedSnrs, 0.75);
  }

  if (f0s.length < 3) {
    return {
      voiced: false,
      voicedFrames: f0s.length,
      p10Hz: 0,
      medianHz: 0,
      p90Hz: 0,
      snrDb,
      noisiness,
      noiseFloorDb,
      harmonicityMedian: 0,
    };
  }
  votedHarmonicity.sort((a, b) => a - b);
  f0s.sort((a, b) => a - b);
  return {
    voiced: true,
    voicedFrames: f0s.length,
    p10Hz: percentile(f0s, 0.1),
    medianHz: percentile(f0s, 0.5),
    p90Hz: percentile(f0s, 0.9),
    snrDb,
    noisiness,
    noiseFloorDb,
    harmonicityMedian: percentile(votedHarmonicity, 0.5),
  };
}
