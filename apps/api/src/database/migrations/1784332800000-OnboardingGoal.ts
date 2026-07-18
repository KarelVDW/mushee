import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds `goal` to user_onboarding: the primary-goal survey answer from the
 * onboarding wizard's goal step (transcribe/compose/arrange/teach/learn).
 * Null for accounts onboarded before the step existed.
 */
export class OnboardingGoal1784332800000 implements MigrationInterface {
  name = 'OnboardingGoal1784332800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user_onboarding" ADD "goal" character varying`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user_onboarding" DROP COLUMN "goal"`,
    );
  }
}
