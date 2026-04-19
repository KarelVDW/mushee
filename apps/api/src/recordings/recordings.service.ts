import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { resolve } from 'path';

import { BasicPitchModelLoader } from './BasicPitchModelLoader';
import { RecordingPipeline } from './RecordingPipeline';

const DEFAULT_MODEL_DIR = resolve(process.cwd(), 'model');

@Injectable()
export class RecordingsService implements OnModuleInit {
  private readonly logger = new Logger(RecordingsService.name);
  private readonly modelLoader: BasicPitchModelLoader;

  constructor() {
    const modelDir = process.env.BASIC_PITCH_MODEL_DIR ?? DEFAULT_MODEL_DIR;
    this.modelLoader = new BasicPitchModelLoader(modelDir);
    this.logger.log(`Basic-pitch model dir: ${modelDir}`);
  }

  onModuleInit(): void {
    void this.modelLoader.load().catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to preload basic-pitch model: ${message}`);
    });
  }

  createPipeline(): RecordingPipeline {
    return new RecordingPipeline(this.modelLoader.load());
  }
}
