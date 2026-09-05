import { Logger } from '@nestjs/common'
import type { Writable } from 'stream'
import { finished } from 'stream/promises'

import type { StorageService } from '../storage/storage.service'
import { describeError } from './pipeline/describe-error'

/**
 * Archives one recording session to blob storage under
 * `recordings/<userId>/<scoreId>/<recordingId>/`:
 *
 * - `audio.<ext>` — the encoded stream, uploaded chunk-by-chunk as it arrives
 *   so memory stays flat regardless of take length.
 * - the debug bundle (`plot.svg`, `score.json`, `session.json`) written once
 *   at finalize.
 *
 * Archiving is best-effort by design: a storage outage must degrade to a lost
 * archive, never to a failed recording — every failure lands in the log and
 * the session carries on.
 */
export class RecordingArchiver {
    private readonly logger = new Logger(RecordingArchiver.name)

    private audioStream: Writable | null = null
    private audioKey: string | null = null
    private audioFailed = false
    private audioArchived = false
    private audioBytes = 0

    constructor(
        private readonly storage: StorageService,
        readonly basePath: string,
    ) {}

    /**
     * The object key of the fully uploaded audio, known after `finalize()`.
     * Null until then, and when no audio arrived or the upload failed.
     */
    get archivedAudioKey(): string | null {
        return this.audioArchived ? this.audioKey : null
    }

    /**
     * Stream one encoded chunk to storage. The first chunk opens the upload,
     * sniffing the container format for the object's extension/content type.
     */
    appendAudio(chunk: Buffer): void {
        if (this.audioFailed) return
        if (!this.audioStream) {
            const { extension, contentType } = sniffContainer(chunk)
            this.audioKey = `${this.basePath}/audio${extension}`
            try {
                this.audioStream = this.storage.createWriteStream(this.audioKey, {
                    contentType,
                })
            } catch (err) {
                this.failAudio(err)
                return
            }
            this.audioStream.on('error', (err) => this.failAudio(err))
        }
        this.audioBytes += chunk.byteLength
        // Ignore backpressure: audio arrives at ~real-time bitrate, far below what
        // any backend absorbs, and the alternative (buffering) defeats streaming.
        this.audioStream.write(chunk)
    }

    /**
     * Close the audio upload and write the debug artifacts. Call exactly once,
     * after the last chunk.
     */
    async finalize(bundle: { plotSvg?: string; scoreJson?: string; sessionMeta?: object }): Promise<void> {
        if (this.audioStream && !this.audioFailed) {
            try {
                this.audioStream.end()
                await finished(this.audioStream)
                this.audioArchived = true
                this.logger.log(`Archived ${this.audioKey} (${this.audioBytes} bytes)`)
            } catch (err) {
                this.failAudio(err)
            }
        }

        const writes: Array<[string, string]> = []
        if (bundle.plotSvg) writes.push(['plot.svg', bundle.plotSvg])
        if (bundle.scoreJson) writes.push(['score.json', bundle.scoreJson])
        if (bundle.sessionMeta) {
            writes.push(['session.json', JSON.stringify(bundle.sessionMeta, null, 2)])
        }
        await Promise.all(
            writes.map(async ([name, content]) => {
                try {
                    await this.storage.write(`${this.basePath}/${name}`, content)
                } catch (err) {
                    this.logger.warn(`Failed to archive ${this.basePath}/${name}: ${describeError(err)}`)
                }
            }),
        )
    }

    private failAudio(err: unknown): void {
        if (this.audioFailed) return
        this.audioFailed = true
        this.logger.warn(`Audio archive failed for ${this.audioKey}: ${describeError(err)}`)
        this.audioStream?.destroy()
    }
}

/** Container sniffing from the stream's first bytes (magic numbers). */
/**
 * The containers browsers' MediaRecorder produces, by magic bytes: the same table
 * names the object's extension when the audio is written and its content type
 * when it is replayed, so the two can never disagree.
 */
const CONTAINERS: ReadonlyArray<{ extension: string; contentType: string; matches(buffer: Buffer): boolean }> = [
    { extension: '.webm', contentType: 'audio/webm', matches: (b) => b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3 },
    {
        extension: '.mp3',
        contentType: 'audio/mpeg',
        matches: (b) => (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0),
    },
    { extension: '.ogg', contentType: 'audio/ogg', matches: (b) => b[0] === 0x4f && b[1] === 0x67 && b[2] === 0x67 && b[3] === 0x53 },
    { extension: '.wav', contentType: 'audio/wav', matches: (b) => b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 },
    { extension: '.flac', contentType: 'audio/flac', matches: (b) => b[0] === 0x66 && b[1] === 0x4c && b[2] === 0x61 && b[3] === 0x43 },
    // MP4/M4A (Safari's MediaRecorder): 'ftyp' at offset 4.
    {
        extension: '.mp4',
        contentType: 'audio/mp4',
        matches: (b) => b.length >= 8 && b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70,
    },
]
const UNKNOWN_CONTAINER = { extension: '.bin', contentType: 'application/octet-stream' }

export function sniffContainer(buffer: Buffer): { extension: string; contentType: string } {
    if (buffer.length < 4) return UNKNOWN_CONTAINER
    const match = CONTAINERS.find((container) => container.matches(buffer))
    return match ? { extension: match.extension, contentType: match.contentType } : UNKNOWN_CONTAINER
}

/** Content type of an archived audio object by its extension — the replay side of `sniffContainer`. */
export function audioContentTypeFor(key: string): string {
    const extension = key.slice(key.lastIndexOf('.'))
    return CONTAINERS.find((container) => container.extension === extension)?.contentType ?? UNKNOWN_CONTAINER.contentType
}
