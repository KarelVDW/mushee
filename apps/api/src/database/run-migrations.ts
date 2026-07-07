import { Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { dataSourceOptions } from './data-source';

/**
 * Run pending migrations under a Postgres advisory lock, so any number of API
 * replicas can boot concurrently against a fresh database: one runs the
 * migrations, the rest wait on the lock and then find nothing pending.
 * (TypeORM's own `migrationsRun` has no such lock — concurrent replicas race
 * on `CREATE TABLE migrations` and crash into their retry loop.)
 */
export async function runMigrationsLocked(): Promise<void> {
  const logger = new Logger('Migrations');
  const dataSource = new DataSource(dataSourceOptions);
  await initializeWithRetry(dataSource, logger);
  // Advisory locks are session-scoped: lock and unlock must run on the SAME
  // connection, so pin one QueryRunner instead of borrowing from the pool
  // (where they could land on different sessions and the unlock would no-op).
  const runner = dataSource.createQueryRunner();
  try {
    await runner.query('SELECT pg_advisory_lock(727271)');
    const applied = await dataSource.runMigrations({ transaction: 'each' });
    if (applied.length > 0) {
      logger.log(`Applied ${applied.length} migration(s): ${applied.map((m) => m.name).join(', ')}`);
    }
  } finally {
    await runner.query('SELECT pg_advisory_unlock(727271)').catch(() => {});
    await runner.release().catch(() => {});
    await dataSource.destroy();
  }
}

/** The database may still be starting alongside us (compose/k8s), so give it
 *  the same grace TypeOrmModule's own retry loop used to. */
async function initializeWithRetry(
  dataSource: DataSource,
  logger: Logger,
  attempts = 10,
  delayMs = 3000,
): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await dataSource.initialize();
      return;
    } catch (err) {
      if (attempt >= attempts) throw err;
      logger.warn(
        `Database not reachable (attempt ${attempt}/${attempts}), retrying: ${err instanceof Error ? err.message : String(err)}`,
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}
