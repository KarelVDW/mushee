import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { Readable } from 'stream';
import { DataSource } from 'typeorm';

import { RecordingCreditsService } from '../recordings/recording-credits.service';
import { ScoresService } from '../scores/scores.service';
import { StorageService } from '../storage/storage.service';

export interface AdminStats {
  totals: {
    users: number;
    scores: number;
    recordings: number;
    recordingSeconds: number;
    waitlistPending: number;
    packSecondsOutstanding: number;
    activeUsers7d: number;
    newUsers7d: number;
  };
  tiers: Array<{ id: string; name: string; users: number }>;
  /** Last 30 days, oldest first, missing days zero-filled. */
  timeseries: Array<{
    day: string;
    signups: number;
    scores: number;
    recordingSeconds: number;
  }>;
}

export interface AdminUserRow {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  createdAt: Date;
  role: string;
  betaStatus: string | null;
  tierId: string;
  tierName: string;
  scoreCount: number;
  lastActiveAt: Date | null;
  deletionRequested: boolean;
}

export interface AdminUserList {
  users: AdminUserRow[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AdminCreditState {
  tierId: string;
  tierName: string;
  dailyLimit: number | null;
  usedToday: number;
  remainingToday: number | null;
  packSeconds: number;
}

/** Either a bucket URL the browser can fetch directly, or the bytes to relay. */
export type RecordingAudio =
  | { url: string }
  | { stream: Readable; contentType: string };

/** By archive extension — the write-side mapping lives in RecordingArchiver. */
const AUDIO_CONTENT_TYPES: Record<string, string> = {
  '.webm': 'audio/webm',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
};

const SIGNED_URL_TTL_SECONDS = 15 * 60;

/**
 * Read(-mostly) queries behind the admin console. The `user`, `session` and
 * `account` tables are owned by better-auth, so — like BetaService — this
 * queries them with raw SQL instead of TypeORM entities. Everything else is
 * plain aggregation over the app's own tables.
 */
@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly scoresService: ScoresService,
    private readonly recordingCredits: RecordingCreditsService,
    private readonly storage: StorageService,
  ) {}

  async stats(): Promise<AdminStats> {
    const [totals]: Array<AdminStats['totals']> = await this.dataSource.query(
      `SELECT
         (SELECT count(*)::int FROM "user") AS "users",
         (SELECT count(*)::int FROM scores) AS "scores",
         (SELECT count(*)::int FROM recordings) AS "recordings",
         (SELECT COALESCE(sum("creditsUsed"), 0)::int FROM recording_usage) AS "recordingSeconds",
         (SELECT count(*)::int FROM "user" WHERE "betaStatus" = 'pending') AS "waitlistPending",
         (SELECT COALESCE(sum(seconds), 0)::int FROM credit_balances) AS "packSecondsOutstanding",
         (SELECT count(DISTINCT "userId")::int FROM session
           WHERE "updatedAt" >= now() - interval '7 days') AS "activeUsers7d",
         (SELECT count(*)::int FROM "user"
           WHERE "createdAt" >= now() - interval '7 days') AS "newUsers7d"`,
    );

    const tiers: AdminStats['tiers'] = await this.dataSource.query(
      `SELECT t.id, t.name, count(u.id)::int AS "users"
       FROM "user" u
       LEFT JOIN user_subscriptions s ON s."userId" = u.id
       JOIN subscription_tiers t ON t.id = COALESCE(s."tierId", 'free')
       GROUP BY t.id, t.name, t."sortOrder"
       ORDER BY t."sortOrder"`,
    );

    const timeseries: AdminStats['timeseries'] = await this.dataSource.query(
      `SELECT to_char(d.day, 'YYYY-MM-DD') AS "day",
              COALESCE(u.count, 0)::int AS "signups",
              COALESCE(s.count, 0)::int AS "scores",
              COALESCE(r.seconds, 0)::int AS "recordingSeconds"
       FROM generate_series(current_date - 29, current_date, interval '1 day') AS d(day)
       LEFT JOIN (SELECT "createdAt"::date AS day, count(*) FROM "user"
                  WHERE "createdAt" >= current_date - 29 GROUP BY 1) u ON u.day = d.day::date
       LEFT JOIN (SELECT "createdAt"::date AS day, count(*) FROM scores
                  WHERE "createdAt" >= current_date - 29 GROUP BY 1) s ON s.day = d.day::date
       LEFT JOIN (SELECT day, sum("creditsUsed") AS seconds FROM recording_usage
                  WHERE day >= current_date - 29 GROUP BY 1) r ON r.day = d.day::date
       ORDER BY d.day`,
    );

    return { totals, tiers, timeseries };
  }

  async listUsers(opts: {
    search?: string;
    page?: number;
    pageSize?: number;
  }): Promise<AdminUserList> {
    const page = clamp(Math.trunc(opts.page ?? 1), 1, 1_000_000);
    const pageSize = clamp(Math.trunc(opts.pageSize ?? 25), 1, 100);
    const search = (opts.search ?? '').trim();
    // Escape LIKE wildcards so a search for "100%" matches literally.
    const pattern = `%${search.replace(/[\\%_]/g, '\\$&')}%`;

    const users: AdminUserRow[] = await this.dataSource.query(
      `SELECT u.id, u.name, u.email, u."emailVerified", u."createdAt", u.role, u."betaStatus",
              COALESCE(s."tierId", 'free') AS "tierId",
              COALESCE(t.name, s."tierId", 'Free') AS "tierName",
              COALESCE(sc.count, 0)::int AS "scoreCount",
              se."lastActiveAt",
              (ad."userId" IS NOT NULL) AS "deletionRequested"
       FROM "user" u
       LEFT JOIN user_subscriptions s ON s."userId" = u.id
       LEFT JOIN subscription_tiers t ON t.id = COALESCE(s."tierId", 'free')
       LEFT JOIN (SELECT "userId", count(*) FROM scores GROUP BY 1) sc ON sc."userId" = u.id
       LEFT JOIN (SELECT "userId", max("updatedAt") AS "lastActiveAt" FROM session GROUP BY 1) se
              ON se."userId" = u.id
       LEFT JOIN account_deletions ad ON ad."userId" = u.id
       WHERE ($1 = '' OR u.email ILIKE $2 OR u.name ILIKE $2)
       ORDER BY u."createdAt" DESC
       LIMIT $3 OFFSET $4`,
      [search, pattern, pageSize, (page - 1) * pageSize],
    );

    const [{ total }]: Array<{ total: number }> = await this.dataSource.query(
      `SELECT count(*)::int AS total FROM "user" u
       WHERE ($1 = '' OR u.email ILIKE $2 OR u.name ILIKE $2)`,
      [search, pattern],
    );

    return { users, total, page, pageSize };
  }

  async getUser(userId: string): Promise<Record<string, unknown>> {
    const [user]: Array<Record<string, unknown>> = await this.dataSource.query(
      `SELECT id, name, email, "emailVerified", image, "createdAt", "updatedAt", role, "betaStatus"
       FROM "user" WHERE id = $1`,
      [userId],
    );
    if (!user) throw new NotFoundException('User not found');

    const [subscription]: Array<Record<string, unknown>> =
      await this.dataSource.query(
        `SELECT s."tierId", t.name AS "tierName", s.status, s."currentPeriodEnd",
                s."cancelAtPeriodEnd", s."polarCustomerId", s."polarSubscriptionId",
                s."createdAt", s."updatedAt"
         FROM user_subscriptions s
         LEFT JOIN subscription_tiers t ON t.id = s."tierId"
         WHERE s."userId" = $1`,
        [userId],
      );

    const [counts]: Array<{
      scoreCount: number;
      recordingCount: number;
      recordingSeconds: number;
    }> = await this.dataSource.query(
      `SELECT
         (SELECT count(*)::int FROM scores WHERE "userId" = $1) AS "scoreCount",
         (SELECT count(*)::int FROM recordings WHERE "userId" = $1) AS "recordingCount",
         (SELECT COALESCE(sum("creditsUsed"), 0)::int FROM recording_usage
           WHERE "userId" = $1) AS "recordingSeconds"`,
      [userId],
    );

    const sessions: Array<Record<string, unknown>> = await this.dataSource.query(
      `SELECT id, "createdAt", "updatedAt", "expiresAt", "ipAddress", "userAgent"
       FROM session WHERE "userId" = $1
       ORDER BY "updatedAt" DESC LIMIT 10`,
      [userId],
    );

    const recordings: Array<Record<string, unknown>> = await this.dataSource.query(
      `SELECT r.id, r."scoreId", sc.title AS "scoreTitle", r."creditsSpent",
              r."createdAt", r."endedAt"
       FROM recordings r
       LEFT JOIN scores sc ON sc.id = r."scoreId"
       WHERE r."userId" = $1
       ORDER BY r."createdAt" DESC LIMIT 10`,
      [userId],
    );

    const [onboarding]: Array<Record<string, unknown>> =
      await this.dataSource.query(
        `SELECT background, goal, instruments, source, "sourceDetail", "completedAt"
         FROM user_onboarding WHERE "userId" = $1`,
        [userId],
      );

    const [deletion]: Array<Record<string, unknown>> = await this.dataSource.query(
      `SELECT "requestedAt", "purgeAfter" FROM account_deletions WHERE "userId" = $1`,
      [userId],
    );

    return {
      user,
      subscription: subscription ?? null,
      credits: await this.creditState(userId),
      counts,
      sessions,
      recordings,
      onboarding: onboarding ?? null,
      deletion: deletion ?? null,
    };
  }

  async listUserScores(userId: string): Promise<Array<Record<string, unknown>>> {
    await this.requireUser(userId);
    return this.dataSource.query(
      `SELECT s.id, s.title, s."createdAt", s."updatedAt",
              (c."scoreId" IS NOT NULL) AS "hotEdits"
       FROM scores s
       LEFT JOIN cached_scores c ON c."scoreId" = s.id
       WHERE s."userId" = $1
       ORDER BY s."updatedAt" DESC`,
      [userId],
    );
  }

  /** Score metadata + the full document JSON, read through the same
   *  cache-then-storage path the editor uses. Read-only. */
  async getScore(scoreId: string): Promise<Record<string, unknown>> {
    const score = await this.scoresService.findOneInternal(scoreId);
    if (!score) throw new NotFoundException('Score not found');

    const [owner]: Array<Record<string, unknown>> = await this.dataSource.query(
      `SELECT id, name, email FROM "user" WHERE id = $1`,
      [score.userId],
    );

    let document: Record<string, unknown> | null = null;
    let documentError: string | null = null;
    try {
      document = await this.scoresService.load(score.userId, score.id);
    } catch (err) {
      // Surface broken storage instead of failing the whole page — the
      // console is exactly where you want to see this.
      documentError = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Admin load of score ${scoreId} failed: ${documentError}`);
    }

    const recordings: Array<Record<string, unknown>> = await this.dataSource.query(
      `SELECT id, "creditsSpent", "createdAt", "endedAt",
              ("storagePath" IS NOT NULL) AS "hasAudio"
       FROM recordings
       WHERE "scoreId" = $1
       ORDER BY "createdAt" DESC`,
      [scoreId],
    );

    return {
      id: score.id,
      title: score.title,
      userId: score.userId,
      owner: owner ?? null,
      storageKey: score.storageKey,
      createdAt: score.createdAt,
      updatedAt: score.updatedAt,
      document,
      documentError,
      recordings,
    };
  }

  /**
   * The archived audio of a recording, for replay in the console. Prefers a
   * time-limited URL straight to the bucket (the browser fetches it without
   * the audio ever passing through the API); backends without URLs — and
   * signing failures — fall back to streaming the object.
   */
  async recordingAudio(recordingId: string): Promise<RecordingAudio> {
    const [recording]: Array<{ storagePath: string | null }> =
      await this.dataSource.query(
        `SELECT "storagePath" FROM recordings WHERE id = $1`,
        [recordingId],
      );
    if (!recording) throw new NotFoundException('Recording not found');
    if (!recording.storagePath) {
      throw new NotFoundException('No audio was archived for this recording');
    }

    // storagePath is the recording's base "directory"; the audio object's
    // extension depends on what container the client sent (see
    // RecordingArchiver.sniffContainer).
    const keys = await this.storage.list(recording.storagePath);
    const audioKey = keys.find((key) => key.split('/').pop()?.startsWith('audio.'));
    if (!audioKey) {
      throw new NotFoundException('The archived audio is missing from storage');
    }
    const extension = audioKey.slice(audioKey.lastIndexOf('.'));
    const contentType = AUDIO_CONTENT_TYPES[extension] ?? 'application/octet-stream';

    try {
      const url = await this.storage.signedUrl(audioKey, SIGNED_URL_TTL_SECONDS);
      if (url) return { url };
    } catch (err) {
      this.logger.warn(
        `Signing audio URL for ${audioKey} failed, streaming instead: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return { stream: this.storage.createReadStream(audioKey), contentType };
  }

  async listTiers(): Promise<Array<Record<string, unknown>>> {
    return this.dataSource.query(
      `SELECT t.id, t.name, t."dailyRecordingCredits", t."maxScores", t."sortOrder", t.sellable,
              COALESCE(u.count, 0)::int AS "userCount"
       FROM subscription_tiers t
       LEFT JOIN (SELECT COALESCE(s."tierId", 'free') AS tier, count(*) AS count
                  FROM "user" usr
                  LEFT JOIN user_subscriptions s ON s."userId" = usr.id
                  GROUP BY 1) u ON u.tier = t.id
       ORDER BY t."sortOrder"`,
    );
  }

  /**
   * Support action: grant (positive) or claw back (negative) purchased-pack
   * seconds. Rides the same balance the Polar order webhooks feed, so the
   * recording meter picks it up immediately.
   */
  async adjustCredits(userId: string, seconds: number): Promise<AdminCreditState> {
    if (!Number.isInteger(seconds) || seconds === 0) {
      throw new BadRequestException('seconds must be a non-zero integer');
    }
    await this.requireUser(userId);
    if (seconds > 0) {
      await this.recordingCredits.grantPackSeconds(userId, seconds);
    } else {
      await this.recordingCredits.revokePackSeconds(userId, -seconds);
    }
    this.logger.log(`Admin adjusted pack seconds for ${userId} by ${seconds}`);
    return this.creditState(userId);
  }

  /** Support action: sign the user out everywhere by dropping their sessions. */
  async revokeSessions(userId: string): Promise<{ revoked: number }> {
    await this.requireUser(userId);
    const [rows]: [Array<{ id: string }>, number] = await this.dataSource.query(
      `DELETE FROM session WHERE "userId" = $1 RETURNING id`,
      [userId],
    );
    this.logger.log(`Admin revoked ${rows.length} session(s) for ${userId}`);
    return { revoked: rows.length };
  }

  private async creditState(userId: string): Promise<AdminCreditState> {
    const balance = await this.recordingCredits.balance(userId);
    return {
      tierId: balance.tier.id,
      tierName: balance.tier.name,
      dailyLimit: balance.tier.dailyRecordingCredits,
      usedToday: balance.used,
      remainingToday: balance.remaining,
      packSeconds: balance.packSeconds,
    };
  }

  private async requireUser(userId: string): Promise<void> {
    const rows: Array<{ id: string }> = await this.dataSource.query(
      `SELECT id FROM "user" WHERE id = $1`,
      [userId],
    );
    if (rows.length === 0) throw new NotFoundException('User not found');
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}
