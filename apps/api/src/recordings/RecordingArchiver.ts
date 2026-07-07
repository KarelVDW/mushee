import { Logger } from '@nestjs/common';
import { finished } from 'stream/promises';
import type { Writable } from 'stream';

import type { StorageService } from '../storage/storage.service';

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
  private readonly logger = new Logger(RecordingArchiver.name);

  private audioStream: Writable | null = null;
  private audioKey: string | null = null;
  private audioFailed = false;
  private audioBytes = 0;

  constructor(
    private readonly storage: StorageService,
    readonly basePath: string,
  ) {}

  /**
   * Stream one encoded chunk to storage. The first chunk opens the upload,
   * sniffing the container format for the object's extension/content type.
   */
  appendAudio(chunk: Buffer): void {
    if (this.audioFailed) return;
    if (!this.audioStream) {
      const { extension, contentType } = sniffContainer(chunk);
      this.audioKey = `${this.basePath}/audio${extension}`;
      try {
        this.audioStream = this.storage.createWriteStream(this.audioKey, {
          contentType,
        });
      } catch (err) {
        this.failAudio(err);
        return;
      }
      this.audioStream.on('error', (err) => this.failAudio(err));
    }
    this.audioBytes += chunk.byteLength;
    // Ignore backpressure: audio arrives at ~real-time bitrate, far below what
    // any backend absorbs, and the alternative (buffering) defeats streaming.
    this.audioStream.write(chunk);
  }

  /**
   * Close the audio upload and write the debug artifacts. Call exactly once,
   * after the last chunk.
   */
  async finalize(bundle: {
    plotSvg?: string;
    scoreJson?: string;
    sessionMeta?: object;
  }): Promise<void> {
    if (this.audioStream && !this.audioFailed) {
      try {
        this.audioStream.end();
        await finished(this.audioStream);
        this.logger.log(
          `Archived ${this.audioKey} (${this.audioBytes} bytes)`,
        );
      } catch (err) {
        this.failAudio(err);
      }
    }

    const writes: Array<[string, string]> = [];
    if (bundle.plotSvg) writes.push(['plot.svg', bundle.plotSvg]);
    if (bundle.scoreJson) writes.push(['score.json', bundle.scoreJson]);
    if (bundle.sessionMeta) {
      writes.push(['session.json', JSON.stringify(bundle.sessionMeta, null, 2)]);
    }
    await Promise.all(
      writes.map(async ([name, content]) => {
        try {
          await this.storage.write(`${this.basePath}/${name}`, content);
        } catch (err) {
          this.logger.warn(
            `Failed to archive ${this.basePath}/${name}: ${describeError(err)}`,
          );
        }
      }),
    );
  }

  private failAudio(err: unknown): void {
    if (this.audioFailed) return;
    this.audioFailed = true;
    this.logger.warn(
      `Audio archive failed for ${this.audioKey}: ${describeError(err)}`,
    );
    this.audioStream?.destroy();
  }
}

/** Container sniffing from the stream's first bytes (magic numbers). */
export function sniffContainer(buffer: Buffer): {
  extension: string;
  contentType: string;
} {
  if (buffer.length >= 4) {
    if (
      buffer[0] === 0x1a &&
      buffer[1] === 0x45 &&
      buffer[2] === 0xdf &&
      buffer[3] === 0xa3
    ) {
      return { extension: '.webm', contentType: 'audio/webm' };
    }
    if (buffer[0] === 0x49 && buffer[1] === 0x44 && buffer[2] === 0x33) {
      return { extension: '.mp3', contentType: 'audio/mpeg' };
    }
    if (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0) {
      return { extension: '.mp3', contentType: 'audio/mpeg' };
    }
    if (
      buffer[0] === 0x4f &&
      buffer[1] === 0x67 &&
      buffer[2] === 0x67 &&
      buffer[3] === 0x53
    ) {
      return { extension: '.ogg', contentType: 'audio/ogg' };
    }
    if (
      buffer[0] === 0x52 &&
      buffer[1] === 0x49 &&
      buffer[2] === 0x46 &&
      buffer[3] === 0x46
    ) {
      return { extension: '.wav', contentType: 'audio/wav' };
    }
    if (
      buffer[0] === 0x66 &&
      buffer[1] === 0x4c &&
      buffer[2] === 0x61 &&
      buffer[3] === 0x43
    ) {
      return { extension: '.flac', contentType: 'audio/flac' };
    }
    // MP4/M4A (Safari's MediaRecorder): 'ftyp' at offset 4.
    if (
      buffer.length >= 8 &&
      buffer[4] === 0x66 &&
      buffer[5] === 0x74 &&
      buffer[6] === 0x79 &&
      buffer[7] === 0x70
    ) {
      return { extension: '.mp4', contentType: 'audio/mp4' };
    }
  }
  return { extension: '.bin', contentType: 'application/octet-stream' };
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
