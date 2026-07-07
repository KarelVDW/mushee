import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds `storagePath` to recordings: the blob-storage folder holding the
 * session's archived audio and debug bundle
 * (`recordings/<userId>/<scoreId>/<recordingId>`). Null for rows that predate
 * audio archiving.
 */
export class RecordingStoragePath1783555200000 implements MigrationInterface {
  name = 'RecordingStoragePath1783555200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "recordings" ADD "storagePath" text`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "recordings" DROP COLUMN "storagePath"`,
    );
  }
}
