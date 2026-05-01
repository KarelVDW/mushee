import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { resolve } from 'path';

import { AudioConverter } from './AudioConverter';
import { BasicPitchProvider } from './providers/BasicPitchProvider';
import { CrepeProvider } from './providers/CrepeProvider';
import { PestoProvider } from './providers/PestoProvider';
import type { PitchProvider } from './providers/PitchProvider';
import { RecordingPipeline } from './RecordingPipeline';

const DEFAULT_MODEL_DIR = resolve(process.cwd(), 'model');
const DEFAULT_CREPE_FULL_DIR = resolve(process.cwd(), 'model-crepe-full');
const DEFAULT_CREPE_TINY_DIR = resolve(process.cwd(), 'model-crepe-tiny');
const DEFAULT_PESTO_DIR = resolve(process.cwd(), 'model-pesto');

@Injectable()
export class RecordingsService implements OnModuleInit {
  private readonly logger = new Logger(RecordingsService.name);
  private readonly provider: PitchProvider;

  constructor() {
    const modelDir = process.env.BASIC_PITCH_MODEL_DIR ?? DEFAULT_MODEL_DIR;
    // ============================================================
    //  PITCH PROVIDER — set PITCH_PROVIDER env var to swap, or change
    //  the default below. All implement `PitchProvider`.
    //   - basic-pitch: polyphonic Spotify ML model, ~1.5s/pass
    //   - crepe-full:  CREPE n=32 (~85 MB), best accuracy, slow on WASM
    //   - crepe-tiny:  CREPE n=4  (~2 MB),  ~30× faster, lower accuracy
    //   - crepe:       alias for crepe-full
    //   - pesto:       PESTO mir-1k_g7 ONNX, ~30k params, self-supervised
    // ============================================================
    const crepeFullDir =
      process.env.CREPE_FULL_MODEL_DIR ?? DEFAULT_CREPE_FULL_DIR;
    const crepeTinyDir =
      process.env.CREPE_TINY_MODEL_DIR ?? DEFAULT_CREPE_TINY_DIR;
    const pestoDir = process.env.PESTO_MODEL_DIR ?? DEFAULT_PESTO_DIR;
    const choice = (process.env.PITCH_PROVIDER ?? 'basic-pitch').toLowerCase();
    this.provider = this.buildProvider(
      choice,
      modelDir,
      crepeFullDir,
      crepeTinyDir,
      pestoDir,
    );
    this.logger.log(`Pitch provider: ${this.provider.name}`);
  }

  private buildProvider(
    choice: string,
    basicPitchDir: string,
    crepeFullDir: string,
    crepeTinyDir: string,
    pestoDir: string,
  ): PitchProvider {
    switch (choice) {
      case 'crepe':
      case 'crepe-full':
        return new CrepeProvider(crepeFullDir, 'crepe-full');
      case 'crepe-tiny':
        return new CrepeProvider(crepeTinyDir, 'crepe-tiny');
        case 'basic-pitch':
          return new BasicPitchProvider(basicPitchDir);
          default:
        case 'pesto':
          return new PestoProvider(pestoDir);
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
