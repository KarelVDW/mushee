import type { Readable } from 'node:stream'

import { ForbiddenException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common'
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
import { audioContentTypeFor, RecordingArchiver } from './recording-archiver'
import { RecordingCreditsService } from './recording-credits.service'
import { RecordingLocksService } from './recording-locks.service'
import { RecordingSession, RecordingSessionEvents } from './recording-session'

const DEFAULT_CREPE_TINY_DIR = resolve(process.cwd(), 'model-crepe-tiny')

/** A take as the owner sees it in the editor's takes list. */
export interface RecordingSummary {
    id: string
    scoreId: string
    startedAt: string
    endedAt: string | null
    /** Seconds recorded (1 credit = 1 s). */
    seconds: number
    /** Whether audio was archived for it (rows from before archiving have none). */
    hasAudio: boolean
}

/** The archived audio: a time-limited URL straight to the bucket when the backend signs, else a stream. */
export type RecordingAudio = { url: string } | { stream: Readable; contentType: string }

const SIGNED_URL_TTL_SECONDS = 15 * 60

@Injectable()
export class RecordingsService implements OnModuleInit {
    private readonly logger = new Logger(RecordingsService.name)
    // The pipeline no longer uses a single fixed provider: it auto-detects each
    // recording's register and picks a provider + frequency window per session.
    // The registry holds every available model (loaded once); the resolver maps
    // a coarse pitch scan to a PipelineProfile.
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

    createPipeline(): RecordingPipeline {
        return new RecordingPipeline(this.registry, this.resolver)
    }

    /**
     * Create a recording session for a user, or return `null` when the user
     * already has one in flight — enforced across API instances via a
     * Postgres lock. The returned session releases its slot when closed.
     */
    async createSession(userId: string, scoreId: string, events: RecordingSessionEvents): Promise<RecordingSession | null> {
        const lock = await this.locks.acquire(userId)
        if (!lock) {
            this.logger.warn(`Rejected concurrent recording for user ${userId}`)
            return null
        }
        return new RecordingSession(
            userId,
            scoreId,
            this.createPipeline(),
            this.credits,
            this.recordingRepo,
            events,
            lock,
            (recordingId) => new RecordingArchiver(this.storage, `recordings/${userId}/${scoreId}/${recordingId}`),
        )
    }

    /** The user's takes, newest first — all of them, or those recorded into one score. */
    async listForUser(userId: string, scoreId?: string): Promise<RecordingSummary[]> {
        const rows = await this.recordingRepo.find({
            where: scoreId ? { userId, scoreId } : { userId },
            order: { createdAt: 'DESC' },
        })
        return rows.map((row) => ({
            id: row.id,
            scoreId: row.scoreId,
            startedAt: row.createdAt.toISOString(),
            endedAt: row.endedAt?.toISOString() ?? null,
            seconds: row.creditsSpent,
            hasAudio: row.storagePath !== null,
        }))
    }

    /** One take, only for its owner. */
    async findOwned(userId: string, id: string): Promise<Recording> {
        const recording = await this.recordingRepo.findOneBy({ id })
        if (!recording) throw new NotFoundException('Recording not found')
        if (recording.userId !== userId) throw new ForbiddenException()
        return recording
    }

    /**
     * The archived audio of a take, for the owner to replay. Prefers a signed URL
     * (the browser fetches straight from the bucket); backends without URLs — and
     * signing failures — fall back to streaming the object through the API.
     */
    async audioFor(userId: string, id: string): Promise<RecordingAudio> {
        const recording = await this.findOwned(userId, id)
        if (!recording.storagePath) throw new NotFoundException('No audio was archived for this recording')
        // The audio object's extension depends on the container the client sent
        // (RecordingArchiver.sniffContainer), so look it up under the take's folder.
        const keys = await this.storage.list(recording.storagePath)
        const audioKey = keys.find((key) => key.split('/').pop()?.startsWith('audio.'))
        if (!audioKey) throw new NotFoundException('The archived audio is missing from storage')
        try {
            const url = await this.storage.signedUrl(audioKey, SIGNED_URL_TTL_SECONDS)
            if (url) return { url }
        } catch (err) {
            this.logger.warn(`Signing audio URL for ${audioKey} failed, streaming instead: ${describeError(err)}`)
        }
        return { stream: this.storage.createReadStream(audioKey), contentType: audioContentTypeFor(audioKey) }
    }

    /**
     * Delete one take: its archived audio first, then the row. Storage goes first
     * for the same reason as in the account purge — a row without its audio is
     * recoverable, orphaned audio is not.
     */
    async remove(userId: string, id: string): Promise<void> {
        const recording = await this.findOwned(userId, id)
        if (recording.storagePath) await this.storage.deletePrefix(`${recording.storagePath}/`)
        await this.recordingRepo.delete({ id: recording.id })
    }

    /**
     * Delete all recording data for a user (account purge): archived audio,
     * sessions, usage, lock. Storage goes first — if it fails the purge must
     * report failure instead of dropping the rows that locate the audio.
     */
    async deleteAllForUser(userId: string): Promise<void> {
        await this.storage.deletePrefix(`recordings/${userId}/`)
        await this.recordingRepo.delete({ userId })
        await this.credits.deleteAllForUser(userId)
        await this.locks.deleteAllForUser(userId)
    }
}

function describeError(err: unknown): string {
    return err instanceof Error ? err.message : String(err)
}
