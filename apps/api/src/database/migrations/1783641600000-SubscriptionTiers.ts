import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Moves the subscription-tier catalogue from code into the database:
 * creates `subscription_tiers` and seeds it with the tiers that used to be
 * hard-coded (SubscriptionTier class / web PLAN_TIERS). Entitlements can now
 * be re-tuned in production without a deploy.
 */
export class SubscriptionTiers1783641600000 implements MigrationInterface {
  name = 'SubscriptionTiers1783641600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "subscription_tiers" (
        "id" text NOT NULL,
        "name" text NOT NULL,
        "dailyRecordingCredits" integer,
        "sortOrder" integer NOT NULL DEFAULT 0,
        "sellable" boolean NOT NULL DEFAULT true,
        CONSTRAINT "PK_subscription_tiers" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `INSERT INTO "subscription_tiers" ("id", "name", "dailyRecordingCredits", "sortOrder", "sellable") VALUES
        ('free',   'Sketch',   30,   0, true),
        ('pro',    'Composer', 600,  1, true),
        ('studio', 'Studio',   NULL, 2, true),
        ('beta',   'Beta',     300,  3, false)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "subscription_tiers"`);
  }
}
