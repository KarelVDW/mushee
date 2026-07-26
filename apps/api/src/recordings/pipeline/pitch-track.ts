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
   * Per-frame voicing mask: confident enough AND inside the register window.
   * Broken out because every segmenter needs exactly this gate, and because the
   * frequency window is the pipeline's single most important adaptive knob — a
   * frame whose f0 falls outside the resolved band is not evidence of a note.
   */
  voicedMask(opts: {
    confidenceThreshold: number;
    minFreqHz: number;
    maxFreqHz: number;
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
    return mask;
  }
}
