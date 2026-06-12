import { Client } from 'pg';

/**
 * Wipes the database by dropping the public schema: TypeORM-managed tables,
 * better-auth's tables, and the migrations table all go. Rebuild with
 * `pnpm migration:run` and `pnpm migrate`.
 *
 * Connects with pg directly (same env defaults as src/database/data-source.ts)
 * rather than importing the data source: that would pull in the entity
 * decorators, which tsx cannot compile (no emitDecoratorMetadata support).
 */
async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to clean the database with NODE_ENV=production');
  }

  const host = process.env.POSTGRES_HOST ?? 'localhost';
  const database = process.env.POSTGRES_DB ?? 'mushee';
  const client = new Client({
    host,
    port: parseInt(process.env.POSTGRES_PORT ?? '5432', 10),
    user: process.env.POSTGRES_USER ?? 'mushee',
    password: process.env.POSTGRES_PASSWORD ?? 'mushee',
    database,
  });

  await client.connect();
  try {
    await client.query('DROP SCHEMA IF EXISTS public CASCADE');
    await client.query('CREATE SCHEMA public');
  } finally {
    await client.end();
  }

  console.log(`Dropped all tables in "${database}" at ${host}.`);
  console.log('Recreate them with: pnpm migration:run && pnpm migrate');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
