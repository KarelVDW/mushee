import { Logger } from '@nestjs/common';
import { Repository } from 'typeorm';

import { Recording } from './entities/recording.entity';
import type { RecordingCreditBalance } from './recording-credits.service';
import { RecordingCreditsService } from './recording-credits.service';
import type { RecordingLock } from './recording-locks.service';
import type { RecordingPipeline, ScoreUpdate } from './RecordingPipeline';

export interface RecordingSessionEvents {
  onUpdate(update: ScoreUpdate): void;
  /** Fired once when the user's daily credit budget runs out mid-recording. */
  onLimitReached(balance: RecordingCreditBalance): void;
}

/** Spend cadence: 1 credit per second of recording. */
const METER_INTERVAL_MS = 1000;

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

  constructor(
    readonly userId: string,
    readonly scoreId: string,
    private readonly pipeline: RecordingPipeline,
    private readonly credits: RecordingCreditsService,
    private readonly recordings: Repository<Recording>,
    private readonly events: RecordingSessionEvents,
    /** Cross-instance per-user slot; released exactly once when the session closes. */
    private readonly lock: RecordingLock,
  ) {
    this.pipeline.setOnUpdate((update) => this.events.onUpdate(update));
  }

  async open(): Promise<void> {
    const recording = await this.recordings.save(
      this.recordings.create({ userId: this.userId, scoreId: this.scoreId }),
    );
    this.recordingId = recording.id;
  }

  setMeta(meta: Parameters<RecordingPipeline['setMeta']>[0]): void {
    this.pipeline.setMeta(meta);
  }

  appendChunk(buffer: Buffer): void {
    if (this.limitReached || this.closed) return;
    if (!this.meterTimer) this.startMeter();
    this.pipeline.appendChunk(buffer);
  }

  finalize(): void {
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
    let balance: RecordingCreditBalance;
    try {
      balance = await this.credits.spend(this.userId, 1);
    } catch (err) {
      // Don't kill a take over a transient DB hiccup; the next tick retries.
      this.logger.warn(`Credit spend failed: ${describeError(err)}`);
      return;
    }
    this.creditsSpent += 1;
    if (!balance.exhausted || this.limitReached || this.closed) return;

    this.limitReached = true;
    this.stopMeter();
    this.logger.log(
      `Daily recording limit reached (user ${this.userId}, ${balance.used} credits used)`,
    );
    this.events.onLimitReached(balance);
    this.finalize();
  }
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
