import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { resolve } from 'path';
import { Repository } from 'typeorm';

import { StorageService } from '../storage/storage.service';
import { Recording } from './entities/recording.entity';
import { usedProviderNames } from './pipeline/profiles/pipeline-profile';
import { ProfileResolver } from './pipeline/profiles/profile-resolver';
import { createModelBackend } from './pipeline/providers/create-model-backend';
import { ProviderRegistry } from './pipeline/providers/provider-registry';
import { RecordingPipeline } from './pipeline/recording-pipeline';
import { RecordingArchiver } from './recording-archiver';
import { RecordingCreditsService } from './recording-credits.service';
import { RecordingLocksService } from './recording-locks.service';
import {
  RecordingSession,
  RecordingSessionEvents,
} from './recording-session';

const DEFAULT_MODEL_DIR = resolve(process.cwd(), 'model');
const DEFAULT_CREPE_TINY_DIR = resolve(process.cwd(), 'model-crepe-tiny');

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
    private readonly storage: StorageService,
  ) {
    const dirs = {
      basicPitch: process.env.BASIC_PITCH_MODEL_DIR ?? DEFAULT_MODEL_DIR,
      crepeTiny: process.env.CREPE_TINY_MODEL_DIR ?? DEFAULT_CREPE_TINY_DIR,
    };
    // Forward pass runs locally (TF.js) or against per-model remote inference
    // services, selected by env (CREPE_INFERENCE_URL / BASIC_PITCH_INFERENCE_URL).
    this.registry = new ProviderRegistry(dirs, createModelBackend(dirs));
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
      (recordingId) =>
        new RecordingArchiver(
          this.storage,
          `recordings/${userId}/${scoreId}/${recordingId}`,
        ),
    );
  }

  /**
   * Delete all recording data for a user (account purge): archived audio,
   * sessions, usage, lock. Storage goes first — if it fails the purge must
   * report failure instead of dropping the rows that locate the audio.
   */
  async deleteAllForUser(userId: string): Promise<void> {
    await this.storage.deletePrefix(`recordings/${userId}/`);
    await this.recordingRepo.delete({ userId });
    await this.credits.deleteAllForUser(userId);
    await this.locks.deleteAllForUser(userId);
  }
}
