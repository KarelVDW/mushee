import { createPolar, type Polar } from './sdk'

/**
 * Lazily constructed Polar SDK client, pinned to the API version in ./sdk.
 * `POLAR_SERVER=sandbox` targets the Polar sandbox (https://sandbox.polar.sh)
 * for testing; anything else uses production. Returns null when no access
 * token is configured so callers can degrade gracefully (billing endpoints
 * answer 503 instead of crashing boot).
 */

/** Per-request timeout in seconds. The SDK's 5 s default is too tight for a
 *  checkout create, which waits on Polar's payment and tax providers. */
const REQUEST_TIMEOUT_SECONDS = 20

let client: Polar | null | undefined

export function polarClient(): Polar | null {
    if (client !== undefined) return client
    const accessToken = process.env.POLAR_ACCESS_TOKEN
    client = accessToken
        ? createPolar({
              accessToken,
              environment: process.env.POLAR_SERVER === 'sandbox' ? 'sandbox' : 'production',
              timeout: REQUEST_TIMEOUT_SECONDS,
          })
        : null
    return client
}

export function isBillingConfigured(): boolean {
    return Boolean(process.env.POLAR_ACCESS_TOKEN)
}
