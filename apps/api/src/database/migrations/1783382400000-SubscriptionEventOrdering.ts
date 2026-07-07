import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds `lastPolarEventAt` to user_subscriptions: the `modified_at` of the
 * newest Polar webhook event applied, so out-of-order retries can't overwrite
 * newer subscription state with older snapshots.
 */
export class SubscriptionEventOrdering1783382400000
  implements MigrationInterface
{
  name = 'SubscriptionEventOrdering1783382400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user_subscriptions" ADD "lastPolarEventAt" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user_subscriptions" DROP COLUMN "lastPolarEventAt"`,
    );
  }
}
