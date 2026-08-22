import type { ModelBackend, ModelKey } from './model-backend';

/**
 * Routes each model's forward pass to its own backend. With one model left in
 * the fleet (crepe-tiny — basic-pitch was removed 2026-08-22, see the eval
 * README's provider-consolidation logs) this is a thin indirection, kept
 * because it is the seam a second model would come back through — a learned
 * voice note model is an open research direction. Built by `createModelBackend`
 * from env.
 */
export class CompositeModelBackend implements ModelBackend {
  constructor(private readonly byModel: Record<ModelKey, ModelBackend>) {}

  available(model: ModelKey): boolean {
    return this.byModel[model].available(model);
  }

  warm(model: ModelKey): Promise<void> {
    return this.byModel[model].warm(model);
  }

  crepePredict(frames: Float32Array, batchCount: number): Promise<Float32Array> {
    return this.byModel['crepe-tiny'].crepePredict(frames, batchCount);
  }
}
