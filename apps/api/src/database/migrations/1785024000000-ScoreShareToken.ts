import { MigrationInterface, QueryRunner } from 'typeorm'

/**
 * Adds `shareToken` to scores: the secret in a read-only share link
 * (`/s/<token>`). Null = not shared; revoking sets it back to null. Unique so a
 * token resolves to exactly one score.
 */
export class ScoreShareToken1785024000000 implements MigrationInterface {
    name = 'ScoreShareToken1785024000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "scores" ADD "shareToken" text`)
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_scores_shareToken" ON "scores" ("shareToken")`)
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "IDX_scores_shareToken"`)
        await queryRunner.query(`ALTER TABLE "scores" DROP COLUMN "shareToken"`)
    }
}
