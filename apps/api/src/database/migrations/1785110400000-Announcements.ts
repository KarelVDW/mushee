import { MigrationInterface, QueryRunner } from 'typeorm'

/**
 * Audit log of account-wide announcements sent from the admin console (service
 * messages such as "the beta is ending"): what was sent, to which audience
 * filter, to how many recipients, and when. Test sends are recorded too, with
 * the test address, so the history shows what was previewed before the real run.
 */
export class Announcements1785110400000 implements MigrationInterface {
    name = 'Announcements1785110400000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "announcements" (
            "id" uuid NOT NULL DEFAULT gen_random_uuid(),
            "subject" text NOT NULL,
            "body" text NOT NULL,
            "filters" jsonb NOT NULL,
            "recipientCount" integer NOT NULL,
            "testTo" text,
            "sentAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
            CONSTRAINT "PK_announcements" PRIMARY KEY ("id")
        )`)
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE "announcements"`)
    }
}
