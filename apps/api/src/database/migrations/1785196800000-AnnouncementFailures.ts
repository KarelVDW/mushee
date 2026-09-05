import { MigrationInterface, QueryRunner } from 'typeorm'

/**
 * A SendGrid batch that is rejected mid-run no longer aborts the announcement;
 * the record keeps who was reached (`recipientCount`) and who was not
 * (`failedCount`) so the operator can see a partial send and follow up without
 * double-sending.
 */
export class AnnouncementFailures1785196800000 implements MigrationInterface {
    name = 'AnnouncementFailures1785196800000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "announcements" ADD "failedCount" integer NOT NULL DEFAULT 0`)
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "announcements" DROP COLUMN "failedCount"`)
    }
}
