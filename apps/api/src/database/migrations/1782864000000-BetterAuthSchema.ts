import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * better-auth's tables, snapshotted from `npx auth migrate` (better-auth 1.6)
 * so a fresh database is fully provisioned by the boot migration run alone —
 * no separate host-side CLI step before the API can authenticate anyone.
 *
 * Guarded with IF NOT EXISTS: databases that were already provisioned by the
 * better-auth CLI keep their existing tables untouched. After a better-auth
 * upgrade that changes its schema, run `pnpm migrate` and snapshot the diff
 * into a new migration like this one.
 */
export class BetterAuthSchema1782864000000 implements MigrationInterface {
    name = 'BetterAuthSchema1782864000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE IF NOT EXISTS "user" ("id" text NOT NULL, "name" text NOT NULL, "email" text NOT NULL, "emailVerified" boolean NOT NULL, "image" text, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "user_pkey" PRIMARY KEY ("id"), CONSTRAINT "user_email_key" UNIQUE ("email"))`);
        await queryRunner.query(`CREATE TABLE IF NOT EXISTS "session" ("id" text NOT NULL, "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL, "token" text NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL, "ipAddress" text, "userAgent" text, "userId" text NOT NULL, CONSTRAINT "session_pkey" PRIMARY KEY ("id"), CONSTRAINT "session_token_key" UNIQUE ("token"), CONSTRAINT "session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE)`);
        await queryRunner.query(`CREATE TABLE IF NOT EXISTS "account" ("id" text NOT NULL, "accountId" text NOT NULL, "providerId" text NOT NULL, "userId" text NOT NULL, "accessToken" text, "refreshToken" text, "idToken" text, "accessTokenExpiresAt" TIMESTAMP WITH TIME ZONE, "refreshTokenExpiresAt" TIMESTAMP WITH TIME ZONE, "scope" text, "password" text, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL, CONSTRAINT "account_pkey" PRIMARY KEY ("id"), CONSTRAINT "account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE)`);
        await queryRunner.query(`CREATE TABLE IF NOT EXISTS "verification" ("id" text NOT NULL, "identifier" text NOT NULL, "value" text NOT NULL, "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL, "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "verification_pkey" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "session_userId_idx" ON "session" ("userId")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "account_userId_idx" ON "account" ("userId")`);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "verification_identifier_idx" ON "verification" ("identifier")`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE IF EXISTS "verification"`);
        await queryRunner.query(`DROP TABLE IF EXISTS "session"`);
        await queryRunner.query(`DROP TABLE IF EXISTS "account"`);
        await queryRunner.query(`DROP TABLE IF EXISTS "user"`);
    }

}
