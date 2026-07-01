import type {
  BasicPitchForwardResult,
  ModelBackend,
  ModelKey,
} from './ModelBackend';

/**
 * Routes each model's forward pass to its own backend, so one model can run
 * remotely while the other stays in-process (e.g. CREPE on the inference service
 * while basic-pitch is still local). Built by `createModelBackend` from env.
 */
export class CompositeModelBackend implements ModelBackend {
  constructor(
    private readonly byModel: Record<ModelKey, ModelBackend>,
  ) {}

  available(model: ModelKey): boolean {
    return this.byModel[model].available(model);
  }

  warm(model: ModelKey): Promise<void> {
    return this.byModel[model].warm(model);
  }

  crepePredict(frames: Float32Array, batchCount: number): Promise<Float32Array> {
    return this.byModel['crepe-tiny'].crepePredict(frames, batchCount);
  }

  basicPitchForward(samples: Float32Array): Promise<BasicPitchForwardResult> {
    return this.byModel['basic-pitch'].basicPitchForward(samples);
  }
}
