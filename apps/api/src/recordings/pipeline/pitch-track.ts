/**
 * A frame-level pitch trajectory: what a trajectory provider (CREPE) actually
 * measures, before anything decides where notes begin and end.
 *
 * Exposing this as its own type splits the two very different jobs the
 * providers used to fuse into `transcribe`:
 *
 *   1. estimate f0 + voicing per frame   (a model forward pass — expensive)
 *   2. decide where the notes are        (segmentation — cheap, and where most
 *                                         of the accuracy is won or lost)
 *
 * Keeping them separate lets segmentation be swapped and swept without re-running
 * inference, and gives the eval harness something small and deterministic to
 * cache per clip.
 *
 * Pitch is carried in **absolute MIDI cents** (A4 = 6900) rather than Hz so that
 * every operation that matters musically — semitone rounding, vibrato width,
 * transition slope, tuning offset — is a plain linear arithmetic on this array.
 */
export class PitchTrack {
  constructor(
    /** Per-frame pitch in absolute MIDI cents (A4 = 6900). */
    readonly cents: Float32Array,
    /** Per-frame salience/voicing in [0, 1] — the model's peak activation. */
    readonly confidence: Float32Array,
    /** Frames actually populated (`cents`/`confidence` may be over-allocated). */
    readonly frames: number,
    /** Seconds between consecutive frame starts. */
    readonly hopSec: number,
  ) {}

  /** Pitch in Hz. */
  hzAt(frame: number): number {
    return 440 * Math.pow(2, (this.cents[frame] - 6900) / 1200);
  }

  /**
   * A copy of this track with short unvoiced gaps filled (R21, Deep Autotuner's
   * `interpolate_pyin.py` — corrected): an unvoiced run of at most
   * `maxGapFrames` whose BOTH flanks pass the gate gets linearly interpolated
   * pitch and the quieter flank's confidence, so a consonant or breath punching
   * a 1–2 frame hole mid-note no longer needs the decoder's `unvoicedPitchCost`
   * to ride across it. Voiced frames are never touched — the reference smooths
   * them too, which is a bug for us (its §14.2 validation note).
   */
  fillDropouts(opts: {
    confidenceThreshold: number;
    minFreqHz: number;
    maxFreqHz: number;
    maxGapFrames: number;
  }): PitchTrack {
    const voiced = this.voicedMask(opts);
    const cents = this.cents.slice();
    const confidence = this.confidence.slice();
    let i = 0;
    while (i < this.frames) {
      if (voiced[i]) {
        i += 1;
        continue;
      }
      let end = i;
      while (end < this.frames && !voiced[end]) end += 1;
      const len = end - i;
      if (i > 0 && end < this.frames && len <= opts.maxGapFrames) {
        const c0 = this.cents[i - 1];
        const c1 = this.cents[end];
        const conf = Math.min(this.confidence[i - 1], this.confidence[end]);
        for (let j = i; j < end; j += 1) {
          const t = (j - (i - 1)) / (len + 1);
          cents[j] = c0 + (c1 - c0) * t;
          confidence[j] = conf;
        }
      }
      i = end;
    }
    return new PitchTrack(cents, confidence, this.frames, this.hopSec);
  }

  /**
   * Per-frame voicing mask: confident enough AND inside the register window.
   * Broken out because every segmenter needs exactly this gate, and because the
   * frequency window is the pipeline's single most important adaptive knob — a
   * frame whose f0 falls outside the resolved band is not evidence of a note.
   *
   * `quorum` adds the survey's fourth-time-independent block-level rule
   * (outotune: >¼ of the block voiced, Essentia Pitch2Midi: ≥50 % over 15 ms,
   * aubio: median-of-6): a frame only *stays* voiced when at least
   * `minFraction` of the raw mask within a centred `windowSec` window is
   * voiced — a few stray voiced frames cannot manufacture a pitch. It only
   * ever demotes frames; nothing unvoiced is promoted (gap-filling is a
   * different mechanism). Omit for the historical per-frame gate.
   */
  voicedMask(opts: {
    confidenceThreshold: number;
    minFreqHz: number;
    maxFreqHz: number;
    quorum?: { minFraction?: number; windowSec?: number };
  }): Uint8Array {
    const mask = new Uint8Array(this.frames);
    for (let i = 0; i < this.frames; i += 1) {
      const hz = this.hzAt(i);
      mask[i] =
        this.confidence[i] >= opts.confidenceThreshold &&
        hz >= opts.minFreqHz &&
        hz <= opts.maxFreqHz
          ? 1
          : 0;
    }
    if (!opts.quorum) return mask;

    const minFraction = opts.quorum.minFraction ?? 0.5;
    const half = Math.max(
      1,
      Math.round((opts.quorum.windowSec ?? 0.12) / this.hopSec / 2),
    );
    const out = new Uint8Array(this.frames);
    // Prefix sums so the window vote is O(1) per frame; edges use the frames
    // that actually exist rather than padding, so a note against the clip edge
    // is not penalised for the silence beyond it.
    const prefix = new Int32Array(this.frames + 1);
    for (let i = 0; i < this.frames; i += 1) prefix[i + 1] = prefix[i] + mask[i];
    for (let i = 0; i < this.frames; i += 1) {
      if (!mask[i]) continue;
      const lo = Math.max(0, i - half);
      const hi = Math.min(this.frames - 1, i + half);
      const voted = prefix[hi + 1] - prefix[lo];
      if (voted >= minFraction * (hi - lo + 1)) out[i] = 1;
    }
    return out;
  }
}
