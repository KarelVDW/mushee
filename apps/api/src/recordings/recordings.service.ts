import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { resolve } from 'path';
import { Repository } from 'typeorm';

import { Recording } from './entities/recording.entity';
import { usedProviderNames } from './profiles/PipelineProfile';
import { ProfileResolver } from './profiles/ProfileResolver';
import { ProviderRegistry } from './providers/ProviderRegistry';
import { RecordingCreditsService } from './recording-credits.service';
import { RecordingLocksService } from './recording-locks.service';
import { RecordingPipeline } from './RecordingPipeline';
import {
  RecordingSession,
  RecordingSessionEvents,
} from './RecordingSession';

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

  constructor(
    @InjectRepository(Recording)
    private readonly recordingRepo: Repository<Recording>,
    private readonly credits: RecordingCreditsService,
    private readonly locks: RecordingLocksService,
  ) {
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

  /**
   * Create a recording session for a user, or return `null` when the user
   * already has one in flight — enforced across API instances via a
   * Postgres lock. The returned session releases its slot when closed.
   */
  async createSession(
    userId: string,
    scoreId: string,
    events: RecordingSessionEvents,
  ): Promise<RecordingSession | null> {
    const lock = await this.locks.acquire(userId);
    if (!lock) {
      this.logger.warn(`Rejected concurrent recording for user ${userId}`);
      return null;
    }
    return new RecordingSession(
      userId,
      scoreId,
      this.createPipeline(),
      this.credits,
      this.recordingRepo,
      events,
      lock,
    );
  }

  /** Delete all recording data for a user (account purge): sessions, usage, lock. */
  async deleteAllForUser(userId: string): Promise<void> {
    await this.recordingRepo.delete({ userId });
    await this.credits.deleteAllForUser(userId);
    await this.locks.deleteAllForUser(userId);
  }
}
