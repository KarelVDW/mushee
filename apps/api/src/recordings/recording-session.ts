import { Logger } from '@nestjs/common';
import { Repository } from 'typeorm';

import { Recording } from './entities/recording.entity';
import type { RecordingPipeline, ScoreUpdate } from './pipeline/recording-pipeline';
import type { RecordingArchiver } from './recording-archiver';
import type { RecordingCreditBalance } from './recording-credits.service';
import { RecordingCreditsService } from './recording-credits.service';
import type { RecordingLock } from './recording-locks.service';

export interface RecordingSessionEvents {
  onUpdate(update: ScoreUpdate): void;
  /** Fired once when the user's daily credit budget runs out mid-recording. */
  onLimitReached(balance: RecordingCreditBalance): void;
  /** Fired once when a hard session cap (duration/bytes) stops the take. */
  onSessionCap?(reason: SessionCapReason): void;
}

export type SessionCapReason = 'max-duration' | 'max-bytes';

/** Spend cadence: 1 credit per second of recording. */
const METER_INTERVAL_MS = 1000;

/** Hard per-session caps — defense in depth on top of credits, protecting the
 *  process from unbounded memory on unlimited tiers (PCM grows ~320 MB/hour).
 *  Env-tunable for load tests; the defaults comfortably exceed any real take. */
const MAX_SESSION_SECONDS = Number(process.env.RECORDING_MAX_SECONDS) || 3600;
const MAX_SESSION_ENCODED_BYTES =
  Number(process.env.RECORDING_MAX_ENCODED_BYTES) || 128 * 1024 * 1024;

/**
 * One recording session: ties a pipeline to the user and score it records
 * into, meters daily credits while audio streams in (1 credit per second),
 * and persists the session as a `Recording` row.
 *
 * The meter starts at the first audio chunk and bills the first second up
 * front; when the budget runs out the session stops accepting audio,
 * finalizes the pipeline, and notifies the client exactly once.
 */
export class RecordingSession {
  private readonly logger = new Logger(RecordingSession.name);

  private recordingId: string | null = null;
  private creditsSpent = 0;
  private meterTimer: NodeJS.Timeout | null = null;
  private limitReached = false;
  private closed = false;
  private bytesReceived = 0;
  private meterStartedAt = 0;

  constructor(
    readonly userId: string,
    readonly scoreId: string,
    private readonly pipeline: RecordingPipeline,
    private readonly credits: RecordingCreditsService,
    private readonly recordings: Repository<Recording>,
    private readonly events: RecordingSessionEvents,
    /** Cross-instance per-user slot; released exactly once when the session closes. */
    private readonly lock: RecordingLock,
    /** Builds the storage archiver once the recording row (and thus its id) exists. */
    private readonly createArchiver: (recordingId: string) => RecordingArchiver,
  ) {
    this.pipeline.setOnUpdate((update) => this.events.onUpdate(update));
  }

  async open(): Promise<void> {
    const recording = await this.recordings.save(
      this.recordings.create({ userId: this.userId, scoreId: this.scoreId }),
    );
    this.recordingId = recording.id;
    // Attach the archiver before any audio flows (the gateway holds frames
    // until open() resolves), so the very first chunk is archived too.
    const archiver = this.createArchiver(recording.id);
    this.pipeline.setArchiver(archiver);
    await this.recordings.update(recording.id, {
      storagePath: archiver.basePath,
    });
  }

  setMeta(meta: Parameters<RecordingPipeline['setMeta']>[0]): void {
    this.pipeline.setMeta(meta);
  }

  appendChunk(buffer: Buffer): void {
    if (this.limitReached || this.closed) return;
    this.bytesReceived += buffer.byteLength;
    if (this.bytesReceived > MAX_SESSION_ENCODED_BYTES) {
      this.cap('max-bytes');
      return;
    }
    if (!this.meterTimer) this.startMeter();
    this.pipeline.appendChunk(buffer);
  }

  private finalize(): void {
    this.stopMeter();
    void this.pipeline.finalize().catch((err: unknown) => {
      this.logger.warn(`Pipeline finalize failed: ${describeError(err)}`);
    });
  }

  /** Tear down the session and persist its outcome. Safe to call twice. */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.stopMeter();
    // Free the slot first so the user can start their next take while the
    // final pipeline pass and bookkeeping below run out.
    await this.lock.release();
    try {
      await this.pipeline.finalize();
    } catch (err) {
      this.logger.warn(
        `Pipeline finalize on close failed: ${describeError(err)}`,
      );
    }
    if (this.recordingId) {
      try {
        await this.recordings.update(this.recordingId, {
          creditsSpent: this.creditsSpent,
          endedAt: new Date(),
        });
      } catch (err) {
        this.logger.warn(
          `Failed to persist recording outcome: ${describeError(err)}`,
        );
      }
    }
  }

  private startMeter(): void {
    this.meterStartedAt = Date.now();
    // Bill the first second immediately so sub-second recordings still cost 1.
    void this.spendTick();
    this.meterTimer = setInterval(() => void this.spendTick(), METER_INTERVAL_MS);
  }

  private stopMeter(): void {
    if (this.meterTimer) {
      clearInterval(this.meterTimer);
      this.meterTimer = null;
    }
  }

  private async spendTick(): Promise<void> {
    if (this.limitReached || this.closed) return;

    // Bill whichever is further along: wall-clock seconds or seconds of audio
    // actually decoded. Wall-clock alone lets a scripted client stream audio
    // faster than real time and pay a fraction of it; audio alone would make
    // a stalled decode free. The max of both is server-authoritative.
    const wallSec = Math.ceil((Date.now() - this.meterStartedAt) / 1000) || 1;
    const audioSec = Math.ceil(this.pipeline.audioDurationSec);
    const targetSpend = Math.max(wallSec, audioSec, this.creditsSpent + 1);
    if (Math.max(wallSec, audioSec) > MAX_SESSION_SECONDS) {
      this.cap('max-duration');
      return;
    }

    const toSpend = targetSpend - this.creditsSpent;
    let balance: RecordingCreditBalance;
    try {
      balance = await this.credits.spend(this.userId, toSpend);
    } catch (err) {
      // Don't kill a take over a transient DB hiccup; the next tick retries.
      this.logger.warn(`Credit spend failed: ${describeError(err)}`);
      return;
    }
    this.creditsSpent += toSpend;
    if (!balance.exhausted || this.limitReached || this.closed) return;

    this.limitReached = true;
    this.stopMeter();
    this.logger.log(
      `Daily recording limit reached (user ${this.userId}, ${balance.used} credits used)`,
    );
    this.events.onLimitReached(balance);
    this.finalize();
  }

  /** Stop the take at a hard cap: no more audio accepted, pipeline finalized
   *  so the user keeps everything transcribed up to the cap. */
  private cap(reason: SessionCapReason): void {
    if (this.limitReached || this.closed) return;
    this.limitReached = true;
    this.stopMeter();
    this.logger.warn(
      `Recording capped (${reason}) after ${this.creditsSpent}s / ${this.bytesReceived} bytes (user ${this.userId})`,
    );
    this.events.onSessionCap?.(reason);
    this.finalize();
  }
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
