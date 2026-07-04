import { InitialSchema1781203417001 } from './1781203417001-InitialSchema';
import { BetterAuthSchema1782864000000 } from './1782864000000-BetterAuthSchema';
import { BillingAndBeta1783124612256 } from './1783124612256-BillingAndBeta';

/**
 * All migrations, in order. New migrations (pnpm migration:generate) must be
 * added here — they are imported explicitly instead of glob-loaded so the
 * list works identically for the CLI and the app, in ts and compiled dist.
 */
export const migrations = [
  InitialSchema1781203417001,
  BetterAuthSchema1782864000000,
  BillingAndBeta1783124612256,
];
