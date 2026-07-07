/**
 * TLS settings for the Postgres connections (TypeORM data source and
 * better-auth's pg.Pool — both must agree or they'd connect differently).
 *
 * POSTGRES_SSL:
 *  - unset / 'false'   → plaintext (local dev, docker-compose)
 *  - 'require' / 'true' → encrypted, certificate NOT verified (managed-DB
 *                         default; equivalent to libpq sslmode=require)
 *  - 'verify'           → encrypted + verified: against POSTGRES_SSL_CA
 *                         (inline PEM) when set, else the system CA bundle
 */
export function postgresSsl():
  | false
  | { rejectUnauthorized: boolean; ca?: string } {
  const mode = (process.env.POSTGRES_SSL ?? 'false').trim().toLowerCase();
  if (mode === '' || mode === 'false') return false;
  if (mode === 'verify') {
    return { rejectUnauthorized: true, ca: process.env.POSTGRES_SSL_CA };
  }
  return { rejectUnauthorized: false };
}
