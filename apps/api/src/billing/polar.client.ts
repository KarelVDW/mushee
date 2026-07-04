import { Polar } from '@polar-sh/sdk';

/**
 * Lazily constructed Polar SDK client. `POLAR_SERVER=sandbox` targets the
 * Polar sandbox (https://sandbox.polar.sh) for testing; anything else uses
 * production. Returns null when no access token is configured so callers can
 * degrade gracefully (billing endpoints answer 503 instead of crashing boot).
 */

let client: Polar | null | undefined;

export function polarClient(): Polar | null {
  if (client !== undefined) return client;
  const accessToken = process.env.POLAR_ACCESS_TOKEN;
  client = accessToken
    ? new Polar({
        accessToken,
        server: process.env.POLAR_SERVER === 'sandbox' ? 'sandbox' : 'production',
      })
    : null;
  return client;
}

export function isBillingConfigured(): boolean {
  return Boolean(process.env.POLAR_ACCESS_TOKEN);
}

/** Test hook: forget the cached client (env vars may have changed). */
export function resetPolarClient(): void {
  client = undefined;
}
