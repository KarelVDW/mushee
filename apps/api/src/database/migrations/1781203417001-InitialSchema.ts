import { MigrationInterface, QueryRunner } from "typeorm";

export class InitialSchema1781203417001 implements MigrationInterface {
    name = 'InitialSchema1781203417001'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
        await queryRunner.query(`CREATE TABLE "account_deletions" ("userId" character varying NOT NULL, "requestedAt" TIMESTAMP NOT NULL DEFAULT now(), "purgeAfter" TIMESTAMP WITH TIME ZONE NOT NULL, CONSTRAINT "PK_22c712abaee30bc67fbe8b3711e" PRIMARY KEY ("userId"))`);
        await queryRunner.query(`CREATE TABLE "cached_scores" ("scoreId" character varying NOT NULL, "data" jsonb NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_ffc838d60632091187634b2e896" PRIMARY KEY ("scoreId"))`);
        await queryRunner.query(`CREATE TABLE "user_onboarding" ("userId" character varying NOT NULL, "background" character varying, "instruments" character varying array, "source" character varying, "sourceDetail" character varying, "completedAt" TIMESTAMP WITH TIME ZONE, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_f3e7bb4005372c40076e8af93ca" PRIMARY KEY ("userId"))`);
        await queryRunner.query(`CREATE TABLE "active_recordings" ("userId" character varying NOT NULL, "token" uuid NOT NULL, "startedAt" TIMESTAMP NOT NULL DEFAULT now(), "heartbeatAt" TIMESTAMP WITH TIME ZONE NOT NULL, CONSTRAINT "PK_95ac7982211fff2bfa08b2f5e4b" PRIMARY KEY ("userId"))`);
        await queryRunner.query(`CREATE TABLE "recording_usage" ("userId" character varying NOT NULL, "day" date NOT NULL, "creditsUsed" integer NOT NULL DEFAULT '0', CONSTRAINT "PK_3e0d028b85a028edfd3dbab8597" PRIMARY KEY ("userId", "day"))`);
        await queryRunner.query(`CREATE TABLE "recordings" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" character varying NOT NULL, "scoreId" character varying NOT NULL, "creditsSpent" integer NOT NULL DEFAULT '0', "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "endedAt" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_8c3247d5ee4551d59bb2115a484" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "scores" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" character varying NOT NULL, "title" character varying NOT NULL, "storageKey" character varying, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_c36917e6f26293b91d04b8fd521" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "user_subscriptions" ("userId" character varying NOT NULL, "tierId" character varying NOT NULL DEFAULT 'free', "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_2dfab576863bc3f84d4f6962274" PRIMARY KEY ("userId"))`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE "user_subscriptions"`);
        await queryRunner.query(`DROP TABLE "scores"`);
        await queryRunner.query(`DROP TABLE "recordings"`);
        await queryRunner.query(`DROP TABLE "recording_usage"`);
        await queryRunner.query(`DROP TABLE "active_recordings"`);
        await queryRunner.query(`DROP TABLE "user_onboarding"`);
        await queryRunner.query(`DROP TABLE "cached_scores"`);
        await queryRunner.query(`DROP TABLE "account_deletions"`);
    }

}
