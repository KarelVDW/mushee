/**
 * Seed the demo accounts + scores into the dev database:
 *
 *   pnpm db:seed          (this script, against .env.development)
 *   pnpm db:reset         (clean + migrate + seed)
 *
 * Same seeding code the API runs on boot when SEED_DEMO_DATA=true; see
 * src/database/seed/demo-seed.ts for the account list and idempotency rules.
 */
import { seedDemoData } from '../src/database/seed/demo-seed';

seedDemoData().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
