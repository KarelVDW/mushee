import { Logger } from '@nestjs/common';
import * as tf from '@tensorflow/tfjs';
import { GraphModel, io, loadGraphModel } from '@tensorflow/tfjs';
import { setWasmPaths } from '@tensorflow/tfjs-backend-wasm';
import { readFile } from 'fs/promises';
import { dirname, join, sep } from 'path';

export class BasicPitchModelLoader {
  private static readonly logger = new Logger(BasicPitchModelLoader.name);
  private static backendReady: Promise<void> | null = null;

  private modelPromise: Promise<GraphModel> | null = null;

  constructor(private readonly modelDir: string) {}

  load(): Promise<GraphModel> {
    if (!this.modelPromise) {
      this.modelPromise = this.loadFromDisk();
    }
    return this.modelPromise;
  }

  private async loadFromDisk(): Promise<GraphModel> {
    await BasicPitchModelLoader.ensureBackend();
    const modelJsonBuffer = await readFile(join(this.modelDir, 'model.json'));
    const modelJson = JSON.parse(modelJsonBuffer.toString()) as io.ModelJSON;
    const weightsRel = modelJson.weightsManifest[0].paths[0];
    const weightsBuffer = await readFile(join(this.modelDir, weightsRel));
    return loadGraphModel(
      io.fromMemory({
        modelTopology: modelJson.modelTopology,
        weightSpecs: modelJson.weightsManifest[0].weights,
        weightData: weightsBuffer.buffer.slice(
          weightsBuffer.byteOffset,
          weightsBuffer.byteOffset + weightsBuffer.byteLength,
        ),
      }),
    );
  }

  private static ensureBackend(): Promise<void> {
    if (!this.backendReady) {
      this.backendReady = this.initBackend();
    }
    return this.backendReady;
  }

  private static async initBackend(): Promise<void> {
    const wasmDir =
      dirname(require.resolve('@tensorflow/tfjs-backend-wasm')) + sep;
    setWasmPaths(wasmDir);
    await tf.setBackend('wasm');
    await tf.ready();
    this.logger.log(`TF backend active: ${tf.getBackend()}`);
  }
}
