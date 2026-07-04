import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Billing (Polar) + closed-beta launch support.
 *
 * - `user.role`: 'user' | 'admin' — gates the admin endpoints (beta approvals).
 * - `user.betaStatus`: null | 'pending' | 'approved' — set at signup while
 *   BETA_MODE=true; pending users cannot use the app until approved.
 * - `user_subscriptions.*`: Polar subscription state mirrored by the webhook
 *   handler (customer/subscription ids, status, period end, cancellation).
 * - `processed_webhook_events`: webhook-id dedupe table so Polar redeliveries
 *   are idempotent.
 */
export class BillingAndBeta1783124612256 implements MigrationInterface {
  name = 'BillingAndBeta1783124612256';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "role" text NOT NULL DEFAULT 'user'`,
    );
    await queryRunner.query(
      `ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "betaStatus" text`,
    );

    await queryRunner.query(
      `ALTER TABLE "user_subscriptions"
         ADD COLUMN IF NOT EXISTS "polarCustomerId" varchar,
         ADD COLUMN IF NOT EXISTS "polarSubscriptionId" varchar,
         ADD COLUMN IF NOT EXISTS "polarProductId" varchar,
         ADD COLUMN IF NOT EXISTS "status" varchar,
         ADD COLUMN IF NOT EXISTS "currentPeriodEnd" TIMESTAMP WITH TIME ZONE,
         ADD COLUMN IF NOT EXISTS "cancelAtPeriodEnd" boolean NOT NULL DEFAULT false`,
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "processed_webhook_events" (
         "id" varchar PRIMARY KEY,
         "receivedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
       )`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "processed_webhook_events"`);
    await queryRunner.query(
      `ALTER TABLE "user_subscriptions"
         DROP COLUMN IF EXISTS "cancelAtPeriodEnd",
         DROP COLUMN IF EXISTS "currentPeriodEnd",
         DROP COLUMN IF EXISTS "status",
         DROP COLUMN IF EXISTS "polarProductId",
         DROP COLUMN IF EXISTS "polarSubscriptionId",
         DROP COLUMN IF EXISTS "polarCustomerId"`,
    );
    await queryRunner.query(`ALTER TABLE "user" DROP COLUMN IF EXISTS "betaStatus"`);
    await queryRunner.query(`ALTER TABLE "user" DROP COLUMN IF EXISTS "role"`);
  }
}
