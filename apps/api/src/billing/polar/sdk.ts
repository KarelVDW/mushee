/**
 * The one place the Polar API version is pinned. `@polar-sh/sdk` 1.x ships
 * each API version as its own entry point; importing `2026-10` makes the
 * client send `Polar-Version: 2026-10` on every request and types webhook
 * payloads for that version. Without a pinned header Polar answers with its
 * "current" version, which moves under us (2027-01 removes order and
 * subscription fields).
 *
 * The webhook endpoint in the Polar dashboard has its own API-version
 * setting, which shapes the payloads we receive. Keep it on the same version
 * as this import. To move versions: change the import below and the matching
 * `paths` entry in apps/api/tsconfig.json, adapt the field access the
 * compiler flags, then switch the dashboard endpoint.
 */

export { createPolar, type models, type Polar, webhooks } from '@polar-sh/sdk/2026-10'
// Transport errors are shared by every API version (the version-less root entry).
export { PolarClientError } from '@polar-sh/sdk'
