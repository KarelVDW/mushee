import { BasicPitch } from '@spotify/basic-pitch';
import * as tf from '@tensorflow/tfjs';
import { existsSync } from 'fs';

import { BasicPitchModelLoader } from './basic-pitch-model-loader';
import { CrepeModelLoader } from './crepe-model-loader';
import type {
  BasicPitchForwardResult,
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
  private readonly basicPitchLoader: BasicPitchModelLoader | null;

  constructor(dirs: ProviderModelDirs) {
    this.crepeLoader = existsSync(dirs.crepeTiny)
      ? new CrepeModelLoader(dirs.crepeTiny)
      : null;
    this.basicPitchLoader = existsSync(dirs.basicPitch)
      ? new BasicPitchModelLoader(dirs.basicPitch)
      : null;
  }

  available(model: ModelKey): boolean {
    return model === 'crepe-tiny' ? !!this.crepeLoader : !!this.basicPitchLoader;
  }

  async warm(model: ModelKey): Promise<void> {
    if (model === 'crepe-tiny') await this.crepeLoader?.load();
    else await this.basicPitchLoader?.load();
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

  async basicPitchForward(
    samples: Float32Array,
  ): Promise<BasicPitchForwardResult> {
    if (!this.basicPitchLoader) throw new Error('basic-pitch model not available');
    const model = await this.basicPitchLoader.load();
    const basicPitch = new BasicPitch(Promise.resolve(model));
    const frames: number[][] = [];
    const onsets: number[][] = [];
    await basicPitch.evaluateModel(
      samples,
      (f, o) => {
        frames.push(...f);
        onsets.push(...o);
      },
      () => {},
    );
    return { frames, onsets };
  }
}
