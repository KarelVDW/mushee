import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The application schema, in its final form. Runs after BetterAuthSchema so
 * every table can reference `user(id)` directly.
 *
 * Design rules the schema follows:
 * - Every per-user table has a foreign key to `user(id)` and every per-score
 *   table one to `scores(id)`, all ON DELETE CASCADE — orphans are impossible
 *   by construction. The purge cron still deletes explicitly because it also
 *   owns the non-database cleanup (stored MusicXML files, the Polar customer).
 * - Ids are real types: `scoreId` columns are uuid, `userId` columns are text
 *   (matching better-auth's `user.id`).
 * - Every timestamp is timestamptz.
 * - The hot query paths are indexed: score listing per user (ordered by
 *   updatedAt), recordings per user/score, the stale-cache flush scan, the
 *   purge-due scan, and the beta admin list (partial — only signup rows).
 *
 * Also extends better-auth's `user` table with the app's columns:
 * - `role`: 'user' | 'admin' — gates the admin endpoints (beta approvals).
 * - `betaStatus`: null | 'pending' | 'approved' — set at signup while
 *   BETA_MODE=true; pending users cannot use the app until approved.
 */
export class InitialSchema1783296000000 implements MigrationInterface {
  name = 'InitialSchema1783296000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    // --- App columns on better-auth's user table ---
    await queryRunner.query(
      `ALTER TABLE "user" ADD COLUMN "role" text NOT NULL DEFAULT 'user'`,
    );
    await queryRunner.query(`ALTER TABLE "user" ADD COLUMN "betaStatus" text`);
    await queryRunner.query(
      `CREATE INDEX "IDX_user_betaStatus" ON "user" ("betaStatus") WHERE "betaStatus" IS NOT NULL`,
    );

    // --- Scores and their hot-edit cache ---
    await queryRunner.query(
      `CREATE TABLE "scores" (
         "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
         "userId" text NOT NULL,
         "title" character varying NOT NULL,
         "storageKey" character varying,
         "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
         "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
         CONSTRAINT "PK_scores" PRIMARY KEY ("id"),
         CONSTRAINT "FK_scores_user" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE
       )`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_scores_userId_updatedAt" ON "scores" ("userId", "updatedAt")`,
    );

    await queryRunner.query(
      `CREATE TABLE "cached_scores" (
         "scoreId" uuid NOT NULL,
         "data" jsonb NOT NULL,
         "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
         "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
         CONSTRAINT "PK_cached_scores" PRIMARY KEY ("scoreId"),
         CONSTRAINT "FK_cached_scores_score" FOREIGN KEY ("scoreId") REFERENCES "scores"("id") ON DELETE CASCADE
       )`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_cached_scores_updatedAt" ON "cached_scores" ("updatedAt")`,
    );

    // --- Recording sessions, credit metering, and the per-user lock ---
    await queryRunner.query(
      `CREATE TABLE "recordings" (
         "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
         "userId" text NOT NULL,
         "scoreId" uuid NOT NULL,
         "creditsSpent" integer NOT NULL DEFAULT 0,
         "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
         "endedAt" TIMESTAMP WITH TIME ZONE,
         CONSTRAINT "PK_recordings" PRIMARY KEY ("id"),
         CONSTRAINT "FK_recordings_user" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE,
         CONSTRAINT "FK_recordings_score" FOREIGN KEY ("scoreId") REFERENCES "scores"("id") ON DELETE CASCADE
       )`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_recordings_userId" ON "recordings" ("userId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_recordings_scoreId" ON "recordings" ("scoreId")`,
    );

    await queryRunner.query(
      `CREATE TABLE "recording_usage" (
         "userId" text NOT NULL,
         "day" date NOT NULL,
         "creditsUsed" integer NOT NULL DEFAULT 0,
         CONSTRAINT "PK_recording_usage" PRIMARY KEY ("userId", "day"),
         CONSTRAINT "FK_recording_usage_user" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE
       )`,
    );

    await queryRunner.query(
      `CREATE TABLE "active_recordings" (
         "userId" text NOT NULL,
         "token" uuid NOT NULL,
         "startedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
         "heartbeatAt" TIMESTAMP WITH TIME ZONE NOT NULL,
         CONSTRAINT "PK_active_recordings" PRIMARY KEY ("userId"),
         CONSTRAINT "FK_active_recordings_user" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE
       )`,
    );

    // --- Subscriptions (Polar state mirrored by the webhook handler) ---
    await queryRunner.query(
      `CREATE TABLE "user_subscriptions" (
         "userId" text NOT NULL,
         "tierId" character varying NOT NULL DEFAULT 'free',
         "polarCustomerId" character varying,
         "polarSubscriptionId" character varying,
         "polarProductId" character varying,
         "status" character varying,
         "currentPeriodEnd" TIMESTAMP WITH TIME ZONE,
         "cancelAtPeriodEnd" boolean NOT NULL DEFAULT false,
         "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
         "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
         CONSTRAINT "PK_user_subscriptions" PRIMARY KEY ("userId"),
         CONSTRAINT "FK_user_subscriptions_user" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE
       )`,
    );

    await queryRunner.query(
      `CREATE TABLE "processed_webhook_events" (
         "id" character varying NOT NULL,
         "receivedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
         CONSTRAINT "PK_processed_webhook_events" PRIMARY KEY ("id")
       )`,
    );

    // --- Per-user state: onboarding answers, settings, pending deletion ---
    await queryRunner.query(
      `CREATE TABLE "user_onboarding" (
         "userId" text NOT NULL,
         "background" character varying,
         "instruments" character varying array,
         "source" character varying,
         "sourceDetail" character varying,
         "completedAt" TIMESTAMP WITH TIME ZONE,
         "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
         "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
         CONSTRAINT "PK_user_onboarding" PRIMARY KEY ("userId"),
         CONSTRAINT "FK_user_onboarding_user" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE
       )`,
    );

    await queryRunner.query(
      `CREATE TABLE "user_settings" (
         "userId" text NOT NULL,
         "keyboardShortcuts" jsonb,
         "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
         "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
         CONSTRAINT "PK_user_settings" PRIMARY KEY ("userId"),
         CONSTRAINT "FK_user_settings_user" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE
       )`,
    );

    await queryRunner.query(
      `CREATE TABLE "account_deletions" (
         "userId" text NOT NULL,
         "requestedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
         "purgeAfter" TIMESTAMP WITH TIME ZONE NOT NULL,
         CONSTRAINT "PK_account_deletions" PRIMARY KEY ("userId"),
         CONSTRAINT "FK_account_deletions_user" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE
       )`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_account_deletions_purgeAfter" ON "account_deletions" ("purgeAfter")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "account_deletions"`);
    await queryRunner.query(`DROP TABLE "user_settings"`);
    await queryRunner.query(`DROP TABLE "user_onboarding"`);
    await queryRunner.query(`DROP TABLE "processed_webhook_events"`);
    await queryRunner.query(`DROP TABLE "user_subscriptions"`);
    await queryRunner.query(`DROP TABLE "active_recordings"`);
    await queryRunner.query(`DROP TABLE "recording_usage"`);
    await queryRunner.query(`DROP TABLE "recordings"`);
    await queryRunner.query(`DROP TABLE "cached_scores"`);
    await queryRunner.query(`DROP TABLE "scores"`);
    await queryRunner.query(`DROP INDEX "IDX_user_betaStatus"`);
    await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "betaStatus"`);
    await queryRunner.query(`ALTER TABLE "user" DROP COLUMN "role"`);
  }
}
