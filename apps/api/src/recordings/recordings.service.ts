import type { Readable } from 'node:stream'

import { Injectable, Logger, NotFoundException } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'

import { StorageService } from '../storage/storage.service'
import { Recording } from './entities/recording.entity'
import { describeError } from './pipeline/describe-error'
import { audioContentTypeFor, RecordingArchiver } from './recording-archiver'

/** The archived audio: a time-limited URL straight to the bucket when the backend signs, else a stream. */
export type RecordingAudio = { url: string } | { stream: Readable; contentType: string }

const SIGNED_URL_TTL_SECONDS = 15 * 60

/**
 * Takes after the fact, for the operator only: the admin console's replay of
 * archived audio, and the account purge's audio sweep. Users never read or
 * delete takes through the API — storage reads and egress would scale with
 * every replay — so there is deliberately no owner-facing surface here. Live
 * recording is RecordingSessionsService's.
 */
@Injectable()
export class RecordingsService {
    private readonly logger = new Logger(RecordingsService.name)

    constructor(
        @InjectRepository(Recording)
        private readonly recordingRepo: Repository<Recording>,
        private readonly storage: StorageService,
    ) {}

    /**
     * The admin console's ownerless replay: any take by id, for support. The
     * route is behind AdminSecretGuard, not a user session, so there is no
     * owner to check against.
     */
    async audioForSupport(recordingId: string): Promise<RecordingAudio> {
        const recording = await this.recordingRepo.findOneBy({ id: recordingId })
        if (!recording) throw new NotFoundException('Recording not found')
        return this.archivedAudio(recording)
    }

    /**
     * Prefers a signed URL (the browser fetches straight from the bucket);
     * backends without URLs — and signing failures — fall back to streaming the
     * object through the API.
     */
    private async archivedAudio(recording: Recording): Promise<RecordingAudio> {
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
     * Delete a user's archived audio (account purge) — the only recording data
     * with a footprint outside Postgres. The rows (takes, usage, pack balance,
     * the recording slot) all go with the user row (ON DELETE CASCADE). The
     * user-level folder locates the audio, not the rows: by now the purge has
     * deleted the user's scores, and their take rows with them. It runs before
     * the user row goes, so a storage failure fails the purge with nothing dropped.
     */
    async deleteAudioForUser(userId: string): Promise<void> {
        await this.storage.deleteFolder(RecordingArchiver.folderForUser(userId))
    }
}
