/**
 * Polar webhook signature verification, for the API version pinned in ./sdk.
 * A module of its own so service tests can mock it at this seam.
 *
 * `validateEvent` is async. It accepts both of Polar's signing-key schemes:
 * the legacy key (the UTF-8 bytes of the whole secret) and the Standard
 * Webhooks key (the base64-decoded part after `whsec_`), which every secret
 * created since 2026-09-08 uses. It returns the parsed JSON payload as Polar
 * sent it: snake_case fields, timestamps as ISO strings.
 *
 * Errors: `WebhookVerificationError` for a bad or stale signature (→ 403);
 * `WebhookUnknownTypeError` for a correctly signed event whose type the pinned
 * version does not model (acknowledge it, don't fail it).
 */

import { webhooks } from './sdk'

export type PolarWebhookEvent = webhooks.WebhookPayload

export const validateEvent = webhooks.validateEvent
export const WebhookVerificationError = webhooks.PolarWebhookVerificationError
export const WebhookUnknownTypeError = webhooks.PolarWebhookUnknownTypeError
