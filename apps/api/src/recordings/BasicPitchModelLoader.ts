import { GraphModel, io, loadGraphModel } from '@tensorflow/tfjs';
import { readFile } from 'fs/promises';
import { join } from 'path';

export class BasicPitchModelLoader {
  private modelPromise: Promise<GraphModel> | null = null;

  constructor(private readonly modelDir: string) {}

  load(): Promise<GraphModel> {
    if (!this.modelPromise) {
      this.modelPromise = this.loadFromDisk();
    }
    return this.modelPromise;
  }

  private async loadFromDisk(): Promise<GraphModel> {
    const modelJsonBuffer = await readFile(join(this.modelDir, 'model.json'));
    const modelJson = JSON.parse(modelJsonBuffer.toString()) as io.ModelJSON;
    const weightsRel = modelJson.weightsManifest[0].paths[0];
    const weightsBuffer = await readFile(join(this.modelDir, weightsRel));
    return loadGraphModel(
      io.fromMemory(
        modelJson.modelTopology,
        modelJson.weightsManifest[0].weights,
        weightsBuffer.buffer,
      ),
    );
  }
}
