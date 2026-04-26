import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { resolve } from 'path';

import { AudioConverter } from './AudioConverter';
import { BasicPitchProvider } from './providers/BasicPitchProvider';
import { CrepeProvider } from './providers/CrepeProvider';
import type { PitchProvider } from './providers/PitchProvider';
import { RecordingPipeline } from './RecordingPipeline';

const DEFAULT_MODEL_DIR = resolve(process.cwd(), 'model');
const DEFAULT_CREPE_MODEL_DIR = resolve(process.cwd(), 'model-crepe');

@Injectable()
export class RecordingsService implements OnModuleInit {
  private readonly logger = new Logger(RecordingsService.name);
  private readonly provider: PitchProvider;

  constructor() {
    const modelDir = process.env.BASIC_PITCH_MODEL_DIR ?? DEFAULT_MODEL_DIR;
    // ============================================================
    //  PITCH PROVIDER — set PITCH_PROVIDER env var to swap, or change
    //  the default below. Both implement `PitchProvider`.
    //   - basic-pitch: polyphonic Spotify ML model, ~1.5s/pass
    //   - yin:         pure-JS YIN, monophonic-by-design, instant init
    // ============================================================
    const crepeDir =
      process.env.CREPE_MODEL_DIR ?? DEFAULT_CREPE_MODEL_DIR;
    const choice = (process.env.PITCH_PROVIDER ?? 'basic-pitch').toLowerCase();
    this.provider = this.buildProvider(choice, modelDir, crepeDir);
    this.logger.log(`Pitch provider: ${this.provider.name}`);
  }

  private buildProvider(
    choice: string,
    basicPitchDir: string,
    crepeDir: string,
  ): PitchProvider {
    switch (choice) {
      case 'crepe':
        return new CrepeProvider(crepeDir);
      case 'basic-pitch':
      default:
        return new BasicPitchProvider(basicPitchDir);
    }
  }

  onModuleInit(): void {
    void this.provider.init().catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Failed to initialize pitch provider "${this.provider.name}": ${message}`,
      );
    });
  }

  createPipeline(): RecordingPipeline {
    return new RecordingPipeline(new AudioConverter(this.provider));
  }
}
