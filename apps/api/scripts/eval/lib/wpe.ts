/**
 * WPE dereverberation (Weighted Prediction Error) — ⛔ MEASURED DEAD END for
 * singing. Kept off every shipping path, for the same reason
 * `note-segmenter.ts` is kept: the diagnosis is the valuable part.
 *
 * ## What this was supposed to be
 *
 * The reverb-oracle gap (+0.14/+0.23 COnP) is the largest open headroom in the
 * harness, and the measured failure mechanism is that reverb halves CREPE's
 * *confidence* while barely touching pitch. Spectral-subtraction dereverb was
 * already measured significantly negative (it erodes the harmonic magnitudes
 * confidence is computed from), so WPE — LINEAR per-bin prediction of the late
 * tail from frames ≥ `delay` back (Yoshioka & Nakatani, IEEE TASLP 2012;
 * nara_wpe) — was the structurally-opposite candidate: no spectral zeroing, no
 * nonlinear artifacts.
 *
 * ## ⛔ Why it is fundamentally wrong for singing (2026-08-08, mechanism tests)
 *
 * WPE's objective cancels whatever is linearly predictable from the signal's
 * own past. For SPEECH that is the reverb tail — syllabic articulation makes
 * the direct signal unpredictable — and this implementation behaves exactly as
 * published there (measured: −4.6 dB reverb tail on a speech-like burst train,
 * direct signal kept within ~2 dB). For SINGING the roles are inverted: a
 * sustained sung note is quasi-periodic and therefore the MOST predictable
 * component in the mixture, more predictable than the noise-like tail.
 * Measured on synthetic harmonic tones: WPE cancels the note itself —
 * passthrough error ≈ 0 dB rel (i.e. near-total destruction) at 0, ±20 and
 * ±50 cents of vibrato, and still −0.8 dB at an extreme ±100 cents. No
 * parameter (taps/delay/loading) fixes an objective that minimizes predictable
 * energy when the signal IS the predictable part.
 *
 * This kills predictability-based dereverb for this product's input class
 * generally, not just this implementation — and it explains the literature
 * blank the research doc noted: there is no published with/without-dereverb
 * transcription benchmark for singing. The remaining adverse-front-end
 * candidate is learned enhancement (DeepFilterNet-class with
 * observation-adding), whose objective is not self-prediction — though its
 * speech-centric training is a domain-shift risk a corpus eval must judge.
 *
 * Never wired into production; retained for the record and in case a
 * speech-input use ever appears. See the findings log entry of the same date.
 */

/** STFT frame length (32 ms at 16 kHz). */
const FFT_SIZE = 512;
/** Hop (8 ms) — 75 % overlap, sqrt-Hann analysis+synthesis. */
const HOP = 128;
/** Prediction taps per bin. */
const TAPS = 10;
/** Prediction delay in frames — protects direct sound + early reflections. */
const DELAY = 2;
/** Reweighting iterations (nara_wpe default is 3). */
const ITERATIONS = 3;

interface Stft {
  /** Per bin: re[t], im[t] as contiguous Float32Array(frames). */
  re: Float32Array[];
  im: Float32Array[];
  frames: number;
}

/** In-place iterative radix-2 FFT. */
function fft(re: Float32Array, im: Float32Array): void {
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
    const wRe = Math.cos(ang);
    const wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curRe = 1;
      let curIm = 0;
      for (let k = 0; k < len / 2; k += 1) {
        const a = i + k;
        const b = i + k + len / 2;
        const vRe = re[b] * curRe - im[b] * curIm;
        const vIm = re[b] * curIm + im[b] * curRe;
        re[b] = re[a] - vRe;
        im[b] = im[a] - vIm;
        re[a] += vRe;
        im[a] += vIm;
        const nextRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nextRe;
      }
    }
  }
}

/** Inverse FFT via conjugate trick. */
function ifft(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  for (let i = 0; i < n; i += 1) im[i] = -im[i];
  fft(re, im);
  for (let i = 0; i < n; i += 1) {
    re[i] /= n;
    im[i] = -im[i] / n;
  }
}

const WINDOW = new Float32Array(FFT_SIZE).map((_, i) =>
  Math.sqrt(0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1))),
);

function stft(samples: Float32Array): Stft {
  const frames = Math.max(0, Math.floor((samples.length - FFT_SIZE) / HOP) + 1);
  const bins = FFT_SIZE / 2 + 1;
  const re: Float32Array[] = Array.from({ length: bins }, () => new Float32Array(frames));
  const im: Float32Array[] = Array.from({ length: bins }, () => new Float32Array(frames));
  const fr = new Float32Array(FFT_SIZE);
  const fi = new Float32Array(FFT_SIZE);
  for (let t = 0; t < frames; t += 1) {
    const off = t * HOP;
    for (let i = 0; i < FFT_SIZE; i += 1) {
      fr[i] = samples[off + i] * WINDOW[i];
      fi[i] = 0;
    }
    fft(fr, fi);
    for (let k = 0; k < bins; k += 1) {
      re[k][t] = fr[k];
      im[k][t] = fi[k];
    }
  }
  return { re, im, frames };
}

function istft(x: Stft, length: number): Float32Array {
  const bins = FFT_SIZE / 2 + 1;
  const out = new Float32Array(length);
  const norm = new Float32Array(length);
  const fr = new Float32Array(FFT_SIZE);
  const fi = new Float32Array(FFT_SIZE);
  for (let t = 0; t < x.frames; t += 1) {
    for (let k = 0; k < bins; k += 1) {
      fr[k] = x.re[k][t];
      fi[k] = x.im[k][t];
      if (k > 0 && k < FFT_SIZE / 2) {
        fr[FFT_SIZE - k] = x.re[k][t];
        fi[FFT_SIZE - k] = -x.im[k][t];
      }
    }
    ifft(fr, fi);
    const off = t * HOP;
    for (let i = 0; i < FFT_SIZE && off + i < length; i += 1) {
      out[off + i] += fr[i] * WINDOW[i];
      norm[off + i] += WINDOW[i] * WINDOW[i];
    }
  }
  for (let i = 0; i < length; i += 1) {
    if (norm[i] > 1e-8) out[i] /= norm[i];
  }
  return out;
}

/**
 * Solve the K×K complex system A c = b in place (Gaussian elimination with
 * partial pivoting). A is Hermitian positive-definite here (plus diagonal
 * loading), so this is comfortably stable at K = 10.
 */
function solveComplex(
  aRe: Float64Array,
  aIm: Float64Array,
  bRe: Float64Array,
  bIm: Float64Array,
  k: number,
): void {
  for (let col = 0; col < k; col += 1) {
    let pivot = col;
    let best = aRe[col * k + col] ** 2 + aIm[col * k + col] ** 2;
    for (let row = col + 1; row < k; row += 1) {
      const mag = aRe[row * k + col] ** 2 + aIm[row * k + col] ** 2;
      if (mag > best) {
        best = mag;
        pivot = row;
      }
    }
    if (pivot !== col) {
      for (let j = 0; j < k; j += 1) {
        const i1 = col * k + j;
        const i2 = pivot * k + j;
        [aRe[i1], aRe[i2]] = [aRe[i2], aRe[i1]];
        [aIm[i1], aIm[i2]] = [aIm[i2], aIm[i1]];
      }
      [bRe[col], bRe[pivot]] = [bRe[pivot], bRe[col]];
      [bIm[col], bIm[pivot]] = [bIm[pivot], bIm[col]];
    }
    const dRe = aRe[col * k + col];
    const dIm = aIm[col * k + col];
    const dMag = dRe * dRe + dIm * dIm;
    if (dMag < 1e-30) continue;
    for (let row = col + 1; row < k; row += 1) {
      const nRe = aRe[row * k + col];
      const nIm = aIm[row * k + col];
      // factor = n / d
      const fRe = (nRe * dRe + nIm * dIm) / dMag;
      const fIm = (nIm * dRe - nRe * dIm) / dMag;
      if (fRe === 0 && fIm === 0) continue;
      for (let j = col; j < k; j += 1) {
        const src = col * k + j;
        const dst = row * k + j;
        aRe[dst] -= fRe * aRe[src] - fIm * aIm[src];
        aIm[dst] -= fRe * aIm[src] + fIm * aRe[src];
      }
      bRe[row] -= fRe * bRe[col] - fIm * bIm[col];
      bIm[row] -= fRe * bIm[col] + fIm * bRe[col];
    }
  }
  for (let row = k - 1; row >= 0; row -= 1) {
    let sRe = bRe[row];
    let sIm = bIm[row];
    for (let j = row + 1; j < k; j += 1) {
      sRe -= aRe[row * k + j] * bRe[j] - aIm[row * k + j] * bIm[j];
      sIm -= aRe[row * k + j] * bIm[j] + aIm[row * k + j] * bRe[j];
    }
    const dRe = aRe[row * k + row];
    const dIm = aIm[row * k + row];
    const dMag = dRe * dRe + dIm * dIm;
    if (dMag < 1e-30) {
      bRe[row] = 0;
      bIm[row] = 0;
      continue;
    }
    bRe[row] = (sRe * dRe + sIm * dIm) / dMag;
    bIm[row] = (sIm * dRe - sRe * dIm) / dMag;
  }
}

/**
 * Dereverberate `samples` (mono) with offline single-channel WPE.
 *
 * Returns a new buffer of the same length; the input is not modified. Cost is
 * roughly 0.05–0.1× real time in-process — run it once per take (final pass),
 * not per streaming pass.
 */
export function dereverbWpe(samples: Float32Array): Float32Array {
  if (samples.length < FFT_SIZE * (TAPS + DELAY + 2)) return samples;
  const x = stft(samples);
  const bins = x.re.length;
  const T = x.frames;
  const start = TAPS + DELAY - 1;

  const aRe = new Float64Array(TAPS * TAPS);
  const aIm = new Float64Array(TAPS * TAPS);
  const bRe = new Float64Array(TAPS);
  const bIm = new Float64Array(TAPS);
  const lambda = new Float64Array(T);

  for (let k = 0; k < bins; k += 1) {
    const xr = x.re[k];
    const xi = x.im[k];
    // d starts as the observation; each iteration re-estimates the per-frame
    // variance from the current dereverbed signal and re-solves the filter.
    const dr = Float32Array.from(xr);
    const di = Float32Array.from(xi);

    // Variance floor: a fraction of the bin's mean power, so silent frames
    // cannot blow up the weights.
    let meanPow = 0;
    for (let t = 0; t < T; t += 1) meanPow += xr[t] * xr[t] + xi[t] * xi[t];
    meanPow /= Math.max(1, T);
    const floor = Math.max(1e-10, meanPow * 1e-3);

    for (let iter = 0; iter < ITERATIONS; iter += 1) {
      for (let t = 0; t < T; t += 1) {
        lambda[t] = Math.max(floor, dr[t] * dr[t] + di[t] * di[t]);
      }
      aRe.fill(0);
      aIm.fill(0);
      bRe.fill(0);
      bIm.fill(0);
      // Normal equations for min Σ_t |X[t] − Σ_j c_j · X[t−DELAY−j]|² / λ[t]:
      // A = Σ w · conj(y) yᵀ (Hermitian), b = Σ w · conj(y) X[t].
      for (let t = start; t < T; t += 1) {
        const w = 1 / lambda[t];
        for (let i = 0; i < TAPS; i += 1) {
          const ti = t - DELAY - i;
          const yiRe = xr[ti];
          const yiIm = -xi[ti]; // conj
          bRe[i] += w * (yiRe * xr[t] - yiIm * xi[t]);
          bIm[i] += w * (yiRe * xi[t] + yiIm * xr[t]);
          for (let j = i; j < TAPS; j += 1) {
            const tj = t - DELAY - j;
            const re = w * (yiRe * xr[tj] - yiIm * xi[tj]);
            const im = w * (yiRe * xi[tj] + yiIm * xr[tj]);
            aRe[i * TAPS + j] += re;
            aIm[i * TAPS + j] += im;
          }
        }
      }
      // Mirror the upper triangle (A is Hermitian) + diagonal loading.
      let trace = 0;
      for (let i = 0; i < TAPS; i += 1) trace += aRe[i * TAPS + i];
      const load = Math.max(1e-10, (trace / TAPS) * 1e-6);
      for (let i = 0; i < TAPS; i += 1) {
        aRe[i * TAPS + i] += load;
        for (let j = 0; j < i; j += 1) {
          aRe[i * TAPS + j] = aRe[j * TAPS + i];
          aIm[i * TAPS + j] = -aIm[j * TAPS + i];
        }
      }
      solveComplex(aRe, aIm, bRe, bIm, TAPS);
      // d[t] = X[t] − Σ_j c_j X[t−DELAY−j]
      for (let t = 0; t < T; t += 1) {
        if (t < start) {
          dr[t] = xr[t];
          di[t] = xi[t];
          continue;
        }
        let pRe = 0;
        let pIm = 0;
        for (let j = 0; j < TAPS; j += 1) {
          const tj = t - DELAY - j;
          pRe += bRe[j] * xr[tj] - bIm[j] * xi[tj];
          pIm += bRe[j] * xi[tj] + bIm[j] * xr[tj];
        }
        dr[t] = xr[t] - pRe;
        di[t] = xi[t] - pIm;
      }
    }
    x.re[k] = dr;
    x.im[k] = di;
  }
  return istft(x, samples.length);
}
