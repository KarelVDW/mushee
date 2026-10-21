import type { Readable } from 'node:stream'

import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'

import { StorageService } from '../storage/storage.service'
import { Recording } from './entities/recording.entity'
import { describeError } from './pipeline/describe-error'
import { audioContentTypeFor } from './recording-archiver'
import { RecordingCreditsService } from './recording-credits.service'
import { RecordingLocksService } from './recording-locks.service'

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

/**
 * A user's takes after the fact: list them, replay their archived audio,
 * delete one, and purge them all with the account. Live recording is
 * RecordingSessionsService's.
 */
@Injectable()
export class RecordingsService {
    private readonly logger = new Logger(RecordingsService.name)

    constructor(
        @InjectRepository(Recording)
        private readonly recordingRepo: Repository<Recording>,
        private readonly credits: RecordingCreditsService,
        private readonly locks: RecordingLocksService,
        private readonly storage: StorageService,
    ) {}

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
    private async findOwned(userId: string, id: string): Promise<Recording> {
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
        const audioKey = recording.audioKey ?? (await this.discoverAudioKey(recording.storagePath))
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
     * Rows archived before `audioKey` existed carry only the folder. The audio
     * object's extension depends on the container the client sent
     * (RecordingArchiver.sniffContainer), so look it up under the take's folder.
     */
    private async discoverAudioKey(storagePath: string): Promise<string | undefined> {
        const keys = await this.storage.list(storagePath)
        return keys.find((key) => key.split('/').pop()?.startsWith('audio.'))
    }

    /**
     * Delete one take: its archived audio first, then the row. Storage goes first
     * for the same reason as in the account purge — a row without its audio is
     * recoverable, orphaned audio is not.
     */
    async remove(userId: string, id: string): Promise<void> {
        const recording = await this.findOwned(userId, id)
        if (recording.storagePath) await this.storage.deletePrefix(recording.storagePath)
        await this.recordingRepo.delete({ id: recording.id })
    }

    /**
     * Delete all recording data for a user (account purge): archived audio,
     * sessions, usage, lock. Storage goes first — if it fails the purge must
     * report failure instead of dropping the rows that locate the audio.
     */
    async deleteAllForUser(userId: string): Promise<void> {
        await this.storage.deletePrefix(`recordings/${userId}`)
        await this.recordingRepo.delete({ userId })
        await this.credits.deleteAllForUser(userId)
        await this.locks.deleteAllForUser(userId)
    }
}
