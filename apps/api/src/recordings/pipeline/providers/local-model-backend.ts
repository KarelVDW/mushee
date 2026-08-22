import * as tf from '@tensorflow/tfjs';
import { existsSync } from 'fs';

import { CrepeModelLoader } from './crepe-model-loader';
import type {
  ModelBackend,
  ModelKey,
  ProviderModelDirs,
} from './model-backend';

/**
 * In-process forward pass via TF.js (WASM). This is the original behavior,
 * extracted behind the `ModelBackend` seam: each method does exactly what the
 * providers used to do inline, so dev and the eval harness keep running with no
 * external service.
 */
export class LocalModelBackend implements ModelBackend {
  private readonly crepeLoader: CrepeModelLoader | null;

  constructor(dirs: ProviderModelDirs) {
    this.crepeLoader = existsSync(dirs.crepeTiny)
      ? new CrepeModelLoader(dirs.crepeTiny)
      : null;
  }

  available(model: ModelKey): boolean {
    return model === 'crepe-tiny' && !!this.crepeLoader;
  }

  async warm(model: ModelKey): Promise<void> {
    if (model === 'crepe-tiny') await this.crepeLoader?.load();
  }

  async crepePredict(
    frames: Float32Array,
    batchCount: number,
  ): Promise<Float32Array> {
    if (!this.crepeLoader) throw new Error('crepe-tiny model not available');
    const model = await this.crepeLoader.load();
    const frameSize = frames.length / batchCount;
    return tf.tidy(() => {
      const input = tf.tensor2d(frames, [batchCount, frameSize]);
      const activation = model.predict(input) as tf.Tensor2D; // [batchCount, 360]
      return activation.dataSync().slice() as Float32Array;
    });
  }
}
