/**
 * Every Postgres advisory-lock key the API takes (pg_advisory_lock /
 * pg_try_advisory_lock). Keys share one database-wide namespace, and two locks
 * on one key block each other: register a new lock here, under a key nothing
 * else takes, rather than inlining a number.
 *
 * Decorator-free on purpose — the demo seeder runs under tsx, which cannot
 * load the TypeORM data source, and imports this file directly.
 *
 * One known overlap from outside the API: apps/eval's schema migrator
 * (src/server/db.ts) also takes 727272 against the same database when run
 * locally. It is harmless, since it only makes eval boot and the demo seeder
 * wait for each other, but it is not a key to copy.
 */
export const ADVISORY_LOCKS = {
    /** runMigrationsLocked: one replica migrates, the rest wait. */
    migrations: 727271,
    /** seedDemoData: one seeder at a time. */
    demoSeed: 727272,
    /** CronService single-flight locks, one per job. */
    purgeAccounts: 727273,
    flushScores: 727274,
    pruneWebhooks: 727275,
} as const
