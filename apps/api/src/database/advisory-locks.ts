/**
 * Every Postgres advisory-lock key the API takes (pg_advisory_lock /
 * pg_try_advisory_lock). Keys share one database-wide namespace, so each must
 * be unique: register a new lock here rather than inlining a number.
 *
 * Decorator-free on purpose — the demo seeder runs under tsx, which cannot
 * load the TypeORM data source, and imports this file directly.
 *
 * apps/eval's own schema migrator also takes 727272 against the same database
 * when run locally; sharing the demo seeder's key only serializes the two.
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
