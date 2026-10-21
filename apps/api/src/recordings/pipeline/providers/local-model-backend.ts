import * as tf from '@tensorflow/tfjs'
import { existsSync } from 'fs'

import type { ModelBackend, ModelKey, ProviderModelDirs } from './model-backend'
import { ensureWasmBackend, readModelArtifacts } from './tf-backend'

/**
 * In-process forward pass via TF.js (WASM). This is the original behavior,
 * extracted behind the `ModelBackend` seam: each method does exactly what the
 * providers used to do inline, so dev and the eval harness keep running with no
 * external service.
 */
export class LocalModelBackend implements ModelBackend {
    private readonly crepeDir: string | null
    private crepeModel: Promise<tf.LayersModel> | null = null

    constructor(dirs: ProviderModelDirs) {
        this.crepeDir = existsSync(dirs.crepeTiny) ? dirs.crepeTiny : null
    }

    available(model: ModelKey): boolean {
        return model === 'crepe-tiny' && !!this.crepeDir
    }

    async warm(model: ModelKey): Promise<void> {
        if (model === 'crepe-tiny' && this.crepeDir) await this.model(this.crepeDir)
    }

    async crepePredict(frames: Float32Array, batchCount: number): Promise<Float32Array> {
        if (!this.crepeDir) throw new Error('crepe-tiny model not available')
        const model = await this.model(this.crepeDir)
        const frameSize = frames.length / batchCount
        return tf.tidy(() => {
            const input = tf.tensor2d(frames, [batchCount, frameSize])
            const activation = model.predict(input) as tf.Tensor2D // [batchCount, 360]
            return activation.dataSync().slice() as Float32Array
        })
    }

    /**
     * The CREPE model, loaded once per backend. It ships in Keras Layers format
     * (28 layers, ~2 MB), hence `loadLayersModel` rather than a graph loader.
     */
    private model(dir: string): Promise<tf.LayersModel> {
        this.crepeModel ??= (async () => {
            await ensureWasmBackend()
            return tf.loadLayersModel(tf.io.fromMemory(await readModelArtifacts(dir)))
        })()
        return this.crepeModel
    }
}
