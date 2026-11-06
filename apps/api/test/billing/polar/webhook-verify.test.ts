import { describe, expect, it } from 'vitest'

import { validateEvent, WebhookUnknownTypeError, WebhookVerificationError } from '../../../src/billing/polar/webhook-verify'
import { legacySecret, signedHeaders, standardWebhooksSecret, subscriptionActiveBody } from './webhook-signing'

// Runs the real SDK verification (no mocks): the signature schemes are
// exactly what broke on 0.47.1.

const body = subscriptionActiveBody({ productId: 'prod_1', externalId: 'user-1' })

describe('validateEvent', () => {
    it('accepts a Standard Webhooks (whsec_) secret and returns the snake_case payload', async () => {
        const { secret, key } = standardWebhooksSecret()
        const event = await validateEvent(Buffer.from(body), signedHeaders(body, key), secret)
        expect(event.type).toBe('subscription.active')
        expect(event.data).toMatchObject({
            id: 'sub_1',
            product_id: 'prod_1',
            customer: { external_id: 'user-1' },
            modified_at: '2026-11-06T12:00:00.000000Z',
        })
    })

    it('accepts a legacy Polar secret (HMAC key = the secret string itself)', async () => {
        const { secret, key } = legacySecret()
        const event = await validateEvent(body, signedHeaders(body, key), secret)
        expect(event.type).toBe('subscription.active')
    })

    it('accepts a legacy-scheme signature for a whsec_ secret (key = the full string)', async () => {
        const { secret } = standardWebhooksSecret()
        const event = await validateEvent(body, signedHeaders(body, Buffer.from(secret, 'utf8')), secret)
        expect(event.type).toBe('subscription.active')
    })

    it('rejects a signature made with a different secret', async () => {
        const { secret } = standardWebhooksSecret()
        const other = standardWebhooksSecret()
        await expect(validateEvent(body, signedHeaders(body, other.key), secret)).rejects.toBeInstanceOf(WebhookVerificationError)
    })

    it('rejects a tampered body', async () => {
        const { secret, key } = standardWebhooksSecret()
        const headers = signedHeaders(body, key)
        const tampered = body.replace('prod_1', 'prod_2')
        await expect(validateEvent(tampered, headers, secret)).rejects.toBeInstanceOf(WebhookVerificationError)
    })

    it('rejects a replay outside the five-minute tolerance', async () => {
        const { secret, key } = standardWebhooksSecret()
        const headers = signedHeaders(body, key, { timestamp: Math.floor(Date.now() / 1000) - 10 * 60 })
        await expect(validateEvent(body, headers, secret)).rejects.toBeInstanceOf(WebhookVerificationError)
    })

    it('rejects a delivery without signature headers', async () => {
        const { secret } = standardWebhooksSecret()
        await expect(validateEvent(body, {}, secret)).rejects.toBeInstanceOf(WebhookVerificationError)
    })

    it('reports a correctly signed event of an unknown type as WebhookUnknownTypeError', async () => {
        const { secret, key } = standardWebhooksSecret()
        const unknown = JSON.stringify({ type: 'subscription.teleported', data: {} })
        const error = await validateEvent(unknown, signedHeaders(unknown, key), secret).catch((err: unknown) => err)
        expect(error).toBeInstanceOf(WebhookUnknownTypeError)
        expect(error).not.toBeInstanceOf(WebhookVerificationError)
        expect((error as InstanceType<typeof WebhookUnknownTypeError>).eventType).toBe('subscription.teleported')
    })

    it('checks the signature before the event type', async () => {
        const { secret } = standardWebhooksSecret()
        const unknown = JSON.stringify({ type: 'subscription.teleported', data: {} })
        const forged = signedHeaders(unknown, standardWebhooksSecret().key)
        await expect(validateEvent(unknown, forged, secret)).rejects.toBeInstanceOf(WebhookVerificationError)
    })
})
