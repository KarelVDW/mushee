import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The 2026-07 pricing relaunch:
 *
 * - Retunes the tier ladder. The free tier goes from one 30-second take to a
 *   3-minute daily budget (many short sketches instead of one shot); the mid
 *   tier is renamed Songwriter and doubled to 20 min/day; Studio trades the
 *   literal "unlimited" for an honest 3 h/day ceiling (advertising unlimited
 *   over enforced caps is an EU misleading-practice risk); a new Arranger
 *   tier (8 h/day) serves people transcribing professionally. Beta testers
 *   get 30 min/day — enough to genuinely exercise recording.
 * - Adds `credit_balances`: one-time purchased recording minutes ("packs").
 *   Pack seconds never expire, are granted by Polar `order.paid` webhooks,
 *   and are drawn from only after the day's subscription budget is spent.
 */
export class PricingRelaunch1783900800000 implements MigrationInterface {
  name = 'PricingRelaunch1783900800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "subscription_tiers" SET "dailyRecordingCredits" = 180 WHERE "id" = 'free'`,
    );
    await queryRunner.query(
      `UPDATE "subscription_tiers" SET "name" = 'Songwriter', "dailyRecordingCredits" = 1200 WHERE "id" = 'pro'`,
    );
    await queryRunner.query(
      `UPDATE "subscription_tiers" SET "dailyRecordingCredits" = 10800 WHERE "id" = 'studio'`,
    );
    await queryRunner.query(
      `UPDATE "subscription_tiers" SET "dailyRecordingCredits" = 1800, "sortOrder" = 4 WHERE "id" = 'beta'`,
    );
    await queryRunner.query(
      `INSERT INTO "subscription_tiers" ("id", "name", "dailyRecordingCredits", "sortOrder", "sellable")
       VALUES ('arranger', 'Arranger', 28800, 3, true)
       ON CONFLICT ("id") DO NOTHING`,
    );

    await queryRunner.query(
      `CREATE TABLE "credit_balances" (
        "userId" text NOT NULL,
        "seconds" integer NOT NULL DEFAULT 0,
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_credit_balances" PRIMARY KEY ("userId"),
        CONSTRAINT "FK_credit_balances_user" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE
      )`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "credit_balances"`);
    await queryRunner.query(
      `DELETE FROM "subscription_tiers" WHERE "id" = 'arranger'`,
    );
    await queryRunner.query(
      `UPDATE "subscription_tiers" SET "dailyRecordingCredits" = 300, "sortOrder" = 3 WHERE "id" = 'beta'`,
    );
    await queryRunner.query(
      `UPDATE "subscription_tiers" SET "dailyRecordingCredits" = NULL WHERE "id" = 'studio'`,
    );
    await queryRunner.query(
      `UPDATE "subscription_tiers" SET "name" = 'Composer', "dailyRecordingCredits" = 600 WHERE "id" = 'pro'`,
    );
    await queryRunner.query(
      `UPDATE "subscription_tiers" SET "dailyRecordingCredits" = 30 WHERE "id" = 'free'`,
    );
  }
}
