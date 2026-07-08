/** Model directories for the local (in-process) backend. */
export interface ProviderModelDirs {
  basicPitch: string;
  crepeTiny: string;
}

/** Canonical model keys understood by a `ModelBackend`. */
export type ModelKey = 'crepe-tiny' | 'basic-pitch';

/** Raw basic-pitch forward-pass output: the per-frame note + onset activation
 *  matrices ([T][88]), i.e. the full `evaluateModel` result before note decoding. */
export interface BasicPitchForwardResult {
  frames: number[][];
  onsets: number[][];
}

/**
 * The neural-net forward pass, abstracted so it can run either in-process
 * (`LocalModelBackend`, TF.js) or in a remote inference service
 * (`RemoteModelBackend`, gRPC). This is the ONLY part of transcription that
 * moves off the API: all framing, caching, segmentation, note extraction and
 * MusicXML building stay in the providers/pipeline, so the eval harness keeps
 * guarding the production path.
 */
export interface ModelBackend {
  /** Whether this backend can serve the named model. */
  available(model: ModelKey): boolean;

  /** Load/warm a model ahead of first use. No-op if unavailable. */
  warm(model: ModelKey): Promise<void>;

  /**
   * CREPE forward pass. `frames` is a flat row-major `[batchCount, frameSize]`
   * f32 batch of normalized analysis windows; returns flat `[batchCount, 360]`
   * sigmoid activations. Confidence (row max) is derived by the caller.
   */
  crepePredict(frames: Float32Array, batchCount: number): Promise<Float32Array>;

  /**
   * basic-pitch forward pass over mono 22050 Hz PCM. Returns the note (`frames`)
   * and `onsets` activation matrices; `outputToNotesPoly` is the caller's job.
   */
  basicPitchForward(samples: Float32Array): Promise<BasicPitchForwardResult>;
}
