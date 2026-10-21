import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { resolve } from 'path'
import { Repository } from 'typeorm'

import { StorageService } from '../storage/storage.service'
import { Recording } from './entities/recording.entity'
import { usedProviderNames } from './pipeline/profiles/pipeline-profile'
import { ProfileResolver } from './pipeline/profiles/profile-resolver'
import { createModelBackend } from './pipeline/providers/create-model-backend'
import { ProviderRegistry } from './pipeline/providers/provider-registry'
import { RecordingPipeline } from './pipeline/recording-pipeline'
import { RecordingArchiver } from './recording-archiver'
import type { RecordingCreditBalance } from './recording-credits.service'
import { RecordingCreditsService } from './recording-credits.service'
import { RecordingLocksService } from './recording-locks.service'
import { RecordingSession, RecordingSessionEvents } from './recording-session'

const DEFAULT_CREPE_TINY_DIR = resolve(process.cwd(), 'model-crepe-tiny')

/** What opening a live take came to: a running session, or why none was started. */
export type RecordingOpenResult =
    | { session: RecordingSession }
    | { rejected: 'concurrent-recording' }
    | { rejected: 'limit-reached'; balance: RecordingCreditBalance }

/**
 * The live-recording engine: owns the pitch models and opens one metered
 * session per take. The takes a user already has (list, replay, delete) are
 * RecordingsService's.
 */
@Injectable()
export class RecordingSessionsService implements OnModuleInit {
    private readonly logger = new Logger(RecordingSessionsService.name)
    // Every model the profile table can select, loaded once; the resolver picks
    // a provider and frequency window per take from a coarse pitch scan.
    private readonly registry: ProviderRegistry
    private readonly resolver = new ProfileResolver()

    constructor(
        @InjectRepository(Recording)
        private readonly recordingRepo: Repository<Recording>,
        private readonly credits: RecordingCreditsService,
        private readonly locks: RecordingLocksService,
        private readonly storage: StorageService,
    ) {
        const dirs = {
            crepeTiny: process.env.CREPE_TINY_MODEL_DIR ?? DEFAULT_CREPE_TINY_DIR,
        }
        // Forward pass runs locally (TF.js) or against the remote inference
        // service, selected by env (CREPE_INFERENCE_URL).
        this.registry = new ProviderRegistry(dirs, createModelBackend(dirs))
    }

    onModuleInit(): void {
        // Warm only the providers the profile table can select.
        void this.registry.initAll(usedProviderNames())
    }

    /**
     * Open a live take for a user: claim their one recording slot (enforced
     * across API instances via a Postgres lock), check there are credits left,
     * and start the session. A rejection leaves nothing running; a throw has
     * already closed the session it built. The returned session releases its
     * slot when closed.
     */
    async open(userId: string, scoreId: string, events: RecordingSessionEvents): Promise<RecordingOpenResult> {
        const lock = await this.locks.acquire(userId)
        if (!lock) {
            this.logger.warn(`Rejected concurrent recording for user ${userId}`)
            return { rejected: 'concurrent-recording' }
        }
        const session = new RecordingSession(
            userId,
            scoreId,
            new RecordingPipeline(this.registry, this.resolver),
            this.credits,
            this.recordingRepo,
            events,
            lock,
            (recordingId) => new RecordingArchiver(this.storage, RecordingArchiver.folderFor(userId, scoreId, recordingId)),
        )

        // From here on the session (and its one-per-user lock) is live — every
        // failure path must close it, or the user is locked out of recording
        // until the heartbeat goes stale.
        try {
            // No credits left today — the caller tells the client why before it streams anything.
            const balance = await this.credits.balance(userId)
            if (balance.exhausted) {
                this.logger.log(`Rejected recording with exhausted budget (user ${userId})`)
                await session.close()
                return { rejected: 'limit-reached', balance }
            }
            await session.open()
        } catch (err: unknown) {
            await session.close().catch(() => undefined)
            throw err
        }
        return { session }
    }
}
