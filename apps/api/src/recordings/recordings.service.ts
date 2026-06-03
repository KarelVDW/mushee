import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { resolve } from 'path';

import { usedProviderNames } from './profiles/PipelineProfile';
import { ProfileResolver } from './profiles/ProfileResolver';
import { ProviderRegistry } from './providers/ProviderRegistry';
import { RecordingPipeline } from './RecordingPipeline';

const DEFAULT_MODEL_DIR = resolve(process.cwd(), 'model');
const DEFAULT_CREPE_FULL_DIR = resolve(process.cwd(), 'model-crepe-full');
const DEFAULT_CREPE_TINY_DIR = resolve(process.cwd(), 'model-crepe-tiny');
const DEFAULT_PESTO_DIR = resolve(process.cwd(), 'model-pesto');

@Injectable()
export class RecordingsService implements OnModuleInit {
  private readonly logger = new Logger(RecordingsService.name);
  // The pipeline no longer uses a single fixed provider: it auto-detects each
  // recording's register and picks a provider + frequency window per session.
  // The registry holds every available model (loaded once); the resolver maps
  // a coarse pitch scan to a PipelineProfile.
  private readonly registry: ProviderRegistry;
  private readonly resolver = new ProfileResolver();

  constructor() {
    this.registry = new ProviderRegistry({
      basicPitch: process.env.BASIC_PITCH_MODEL_DIR ?? DEFAULT_MODEL_DIR,
      crepeFull: process.env.CREPE_FULL_MODEL_DIR ?? DEFAULT_CREPE_FULL_DIR,
      crepeTiny: process.env.CREPE_TINY_MODEL_DIR ?? DEFAULT_CREPE_TINY_DIR,
      pesto: process.env.PESTO_MODEL_DIR ?? DEFAULT_PESTO_DIR,
    });
  }

  onModuleInit(): void {
    // Warm only the providers the profile table can select.
    void this.registry.initAll(usedProviderNames());
  }

  createPipeline(): RecordingPipeline {
    return new RecordingPipeline(this.registry, this.resolver);
  }
}
