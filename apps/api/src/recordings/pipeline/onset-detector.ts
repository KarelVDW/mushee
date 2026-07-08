/**
 * Re-attack detector. The monophonic pitch-trajectory providers (CREPE)
 * segment only on pitch stability, so two repeated same-pitch notes read as one
 * sustained note — a recall loss. This finds note re-articulations from the
 * audio amplitude envelope so `NoteExtractor` can split a sustained run back
 * into the notes that were actually played.
 *
 * It is deliberately conservative: an onset requires the energy to genuinely
 * DIP (to a fraction of the preceding peak — a real inter-note gap) and then
 * rise back. Vibrato/tremolo ripple and noise never dip that far, so a held
 * note is not shattered (which would wreck the pipeline's high precision).
 */
/** Tunable re-attack sensitivity; defaults reproduce the historical behavior. */
export interface OnsetDetectorOptions {
  /** Minimum spacing between detected onsets, in seconds. */
  minIoiSec?: number;
  /** Energy must fall below this fraction of the preceding peak to count as a gap. */
  dipRatio?: number;
  /** ...then rise back to this multiple of the trough to count as a re-attack. */
  riseRatio?: number;
}

export class OnsetDetector {
  /** Frame hop for the envelope, in seconds (~10 ms). */
  private readonly hopSec = 0.01;
  private readonly minIoiSec: number;
  private readonly dipRatio: number;
  private readonly riseRatio: number;

  constructor(opts: OnsetDetectorOptions = {}) {
    this.minIoiSec = opts.minIoiSec ?? 0.09;
    this.dipRatio = opts.dipRatio ?? 0.5;
    this.riseRatio = opts.riseRatio ?? 1.8;
  }

  /** Returns onset times in seconds (ascending), excluding the very first attack. */
  detect(samples: Float32Array, sampleRate: number): number[] {
    const hop = Math.max(1, Math.round(this.hopSec * sampleRate));
    const win = hop * 2;
    if (samples.length < win * 2) return [];

    const nFrames = Math.floor((samples.length - win) / hop) + 1;
    const rms = new Float32Array(nFrames);
    for (let f = 0; f < nFrames; f += 1) {
      const start = f * hop;
      let sum = 0;
      for (let i = 0; i < win; i += 1) {
        const s = samples[start + i];
        sum += s * s;
      }
      rms[f] = Math.sqrt(sum / win);
    }
    // 3-tap smoothing.
    const env = new Float32Array(nFrames);
    for (let f = 0; f < nFrames; f += 1) {
      env[f] =
        (rms[Math.max(0, f - 1)] + rms[f] + rms[Math.min(nFrames - 1, f + 1)]) / 3;
    }

    // Ignore frames quieter than a small fraction of the global peak (silence).
    let globalPeak = 0;
    for (let f = 0; f < nFrames; f += 1) globalPeak = Math.max(globalPeak, env[f]);
    const floor = globalPeak * 0.08;

    const minGapFrames = Math.max(1, Math.round(this.minIoiSec / this.hopSec));
    const onsets: number[] = [];
    let peak = 0; // running peak since last onset/note start
    let trough = Infinity; // min since the last peak
    let troughFrame = -1;
    let lastOnsetFrame = -minGapFrames;

    for (let f = 0; f < nFrames; f += 1) {
      const e = env[f];
      if (e > peak) {
        peak = e;
        trough = e; // reset trough tracking after a new peak
        troughFrame = f;
      } else if (e < trough) {
        trough = e;
        troughFrame = f;
      }
      // A re-attack: we dipped well below the peak, then rose back up.
      if (
        peak > floor &&
        trough < this.dipRatio * peak &&
        e > this.riseRatio * trough &&
        troughFrame - lastOnsetFrame >= minGapFrames
      ) {
        onsets.push((troughFrame * hop) / sampleRate);
        lastOnsetFrame = troughFrame;
        peak = e; // start a fresh note
        trough = e;
        troughFrame = f;
      }
    }
    return onsets;
  }
}
