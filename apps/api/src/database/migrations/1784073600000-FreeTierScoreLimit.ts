import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Caps the free tier at five saved scores. The cap lives on
 * subscription_tiers so it can be re-tuned in production without a deploy;
 * NULL means no cap (every paid tier, and beta).
 */
export class FreeTierScoreLimit1784073600000 implements MigrationInterface {
  name = 'FreeTierScoreLimit1784073600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "subscription_tiers" ADD "maxScores" integer`,
    );
    await queryRunner.query(
      `UPDATE "subscription_tiers" SET "maxScores" = 5 WHERE "id" = 'free'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "subscription_tiers" DROP COLUMN "maxScores"`,
    );
  }
}
