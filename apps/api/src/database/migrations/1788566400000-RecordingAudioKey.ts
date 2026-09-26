import { MigrationInterface, QueryRunner } from 'typeorm'

/**
 * Adds `audioKey` to recordings: the exact blob-storage object holding the
 * take's archived audio (`<storagePath>/audio.<ext>`). Replay used to LIST the
 * take's folder to discover the extension on every request; the key is now
 * written once when the upload completes. Null for rows archived before this
 * column existed (and for takes whose upload failed) — those still fall back to
 * listing.
 */
export class RecordingAudioKey1788566400000 implements MigrationInterface {
    name = 'RecordingAudioKey1788566400000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "recordings" ADD "audioKey" text`)
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "recordings" DROP COLUMN "audioKey"`)
    }
}
