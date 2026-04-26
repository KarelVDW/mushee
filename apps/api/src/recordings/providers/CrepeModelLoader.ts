import { io, LayersModel, loadLayersModel } from '@tensorflow/tfjs';
import { readFile } from 'fs/promises';
import { join } from 'path';

interface WeightsManifestEntry {
  paths: string[];
  weights: io.WeightsManifestEntry[];
}

import { ensureWasmBackend } from './tfBackend';

/**
 * Loads the CREPE TF.js model from a local directory containing `model.json`
 * and the weight shard files referenced by its `weightsManifest`. Reuses the
 * shared WASM backend init.
 *
 * The CREPE model is shipped in Keras Layers format (28 layers, ~2 MB), so
 * we use `loadLayersModel`, in contrast to basic-pitch's GraphModel.
 */
export class CrepeModelLoader {
  private modelPromise: Promise<LayersModel> | null = null;

  constructor(private readonly modelDir: string) {}

  load(): Promise<LayersModel> {
    if (!this.modelPromise) {
      this.modelPromise = this.loadFromDisk();
    }
    return this.modelPromise;
  }

  private async loadFromDisk(): Promise<LayersModel> {
    await ensureWasmBackend();
    const modelJsonBuffer = await readFile(join(this.modelDir, 'model.json'));
    const modelJson = JSON.parse(modelJsonBuffer.toString()) as {
      modelTopology: unknown;
      weightsManifest: WeightsManifestEntry[];
    };

    // Read every shard in manifest order and concat.
    const shardBuffers: ArrayBuffer[] = [];
    const weightSpecs = [];
    for (const entry of modelJson.weightsManifest) {
      weightSpecs.push(...entry.weights);
      for (const path of entry.paths) {
        const buf = await readFile(join(this.modelDir, path));
        shardBuffers.push(
          buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
        );
      }
    }
    const weightData = concatArrayBuffers(shardBuffers);

    return loadLayersModel(
      io.fromMemory({
        modelTopology: modelJson.modelTopology,
        weightSpecs,
        weightData,
      }),
    );
  }
}

function concatArrayBuffers(buffers: ArrayBuffer[]): ArrayBuffer {
  const total = buffers.reduce((sum, b) => sum + b.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const buf of buffers) {
    out.set(new Uint8Array(buf), offset);
    offset += buf.byteLength;
  }
  return out.buffer;
}
