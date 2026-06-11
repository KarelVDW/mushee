import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { Repository } from 'typeorm';

import { ActiveRecording } from './entities/active-recording.entity';

/** How often a held lock refreshes its heartbeat. */
const HEARTBEAT_INTERVAL_MS = 5000;
/** A lock whose heartbeat is older than this is presumed orphaned (holder
 *  crashed or lost connectivity) and may be taken over. */
const STALE_AFTER_SECONDS = 20;

/**
 * Postgres-backed "one recording per user" lock. The API runs multiple
 * instances (WebSocket fan-out), so the hard rule is enforced where all of
 * them can see it: a single `active_recordings` row per user, acquired
 * atomically and kept alive by a heartbeat.
 */
@Injectable()
export class RecordingLocksService {
  constructor(
    @InjectRepository(ActiveRecording)
    private readonly repo: Repository<ActiveRecording>,
  ) {}

  /**
   * Try to acquire the user's recording slot. Returns `null` when another
   * live session holds it; a stale row is taken over.
   */
  async acquire(userId: string): Promise<RecordingLock | null> {
    const token = randomUUID();
    const rows: Array<{ token: string }> = await this.repo.query(
      `INSERT INTO active_recordings ("userId", token, "startedAt", "heartbeatAt")
       VALUES ($1, $2, now(), now())
       ON CONFLICT ("userId") DO UPDATE
         SET token = EXCLUDED.token, "startedAt" = now(), "heartbeatAt" = now()
         WHERE active_recordings."heartbeatAt" < now() - interval '${STALE_AFTER_SECONDS} seconds'
       RETURNING token`,
      [userId, token],
    );
    if (!rows.length) return null;
    return new RecordingLock(userId, token, this.repo);
  }

  /** Drop the user's slot row regardless of holder (account purge). */
  async deleteAllForUser(userId: string): Promise<void> {
    await this.repo.delete({ userId });
  }
}

/**
 * A held recording slot. Heartbeats itself every few seconds so peers can
 * tell a live session from an orphaned row; `release()` stops the heartbeat
 * and frees the slot (token-guarded, so a takeover is never deleted by the
 * previous holder).
 */
export class RecordingLock {
  private readonly logger = new Logger(RecordingLock.name);
  private heartbeatTimer: NodeJS.Timeout | null;
  private released = false;

  constructor(
    readonly userId: string,
    private readonly token: string,
    private readonly repo: Repository<ActiveRecording>,
  ) {
    this.heartbeatTimer = setInterval(
      () => void this.heartbeat(),
      HEARTBEAT_INTERVAL_MS,
    );
  }

  async release(): Promise<void> {
    if (this.released) return;
    this.released = true;
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    try {
      await this.repo.delete({ userId: this.userId, token: this.token });
    } catch (err) {
      // The row goes stale and gets taken over after the TTL; just log.
      this.logger.warn(`Failed to release recording lock: ${describe(err)}`);
    }
  }

  private async heartbeat(): Promise<void> {
    if (this.released) return;
    try {
      await this.repo.update(
        { userId: this.userId, token: this.token },
        { heartbeatAt: new Date() },
      );
    } catch (err) {
      this.logger.warn(`Recording lock heartbeat failed: ${describe(err)}`);
    }
  }
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
