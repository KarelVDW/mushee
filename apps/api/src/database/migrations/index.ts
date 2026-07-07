import { BetterAuthSchema1782864000000 } from './1782864000000-BetterAuthSchema';
import { InitialSchema1783296000000 } from './1783296000000-InitialSchema';
import { SubscriptionEventOrdering1783382400000 } from './1783382400000-SubscriptionEventOrdering';
import { RecordingStoragePath1783555200000 } from './1783555200000-RecordingStoragePath';

/**
 * All migrations, in order: better-auth's tables first so the app schema can
 * reference user(id). New migrations (pnpm migration:generate) must be added
 * here — they are imported explicitly instead of glob-loaded so the list
 * works identically for the CLI and the app, in ts and compiled dist.
 */
export const migrations = [
  BetterAuthSchema1782864000000,
  InitialSchema1783296000000,
  SubscriptionEventOrdering1783382400000,
  RecordingStoragePath1783555200000,
];
