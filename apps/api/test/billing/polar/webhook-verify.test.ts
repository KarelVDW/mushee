import { afterEach, describe, expect, it, vi } from 'vitest'

import { validateEvent, WebhookUnknownTypeError, WebhookVerificationError } from '../../../src/billing/polar/webhook-verify'
import { legacySecret, signedHeaders, standardWebhooksSecret, subscriptionActiveBody } from './webhook-signing'

// Runs the real SDK verification (no mocks): the signature schemes are
// exactly what broke on 0.47.1.

const body = subscriptionActiveBody({ productId: 'prod_1', externalId: 'user-1' })

/** The outcome of a validateEvent call: the error it threw, or undefined when it verified. */
async function failureOf(promise: Promise<unknown>): Promise<unknown> {
    return promise.then(
        () => undefined,
        (err: unknown) => err,
    )
}

afterEach(() => {
    vi.useRealTimers()
})

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

    it('accepts a legacy Polar HMAC secret (key = the UTF-8 bytes of the whole whsec_ string)', async () => {
        const { secret, key } = legacySecret()
        const event = await validateEvent(Buffer.from(body), signedHeaders(body, key), secret)
        expect(event.type).toBe('subscription.active')
    })

    it('returns the payload exactly as Polar sent it: snake_case keys, timestamps left as ISO strings', async () => {
        const { secret, key } = standardWebhooksSecret()
        const deleted = JSON.stringify({
            type: 'customer.deleted',
            timestamp: '2026-11-06T12:00:00Z',
            data: { id: 'cus_1', external_id: 'user-1', organization_id: 'org_1', deleted_at: '2026-11-06T12:00:00Z' },
        })
        const event = await validateEvent(deleted, signedHeaders(deleted, key), secret)
        expect(event.type).toBe('customer.deleted')
        expect(event.data).toEqual({ id: 'cus_1', external_id: 'user-1', organization_id: 'org_1', deleted_at: '2026-11-06T12:00:00Z' })
    })

    it('verifies the published Standard Webhooks test vector (an oracle independent of our signer)', async () => {
        // From the Standard Webhooks spec's reference test suite.
        const secret = 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw'
        const id = 'msg_p5jXN8AQM9LWM0D4loKWxJek'
        const timestamp = 1614265330
        const payload = '{"test": 2432232314}'
        const signature = 'v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE='

        // Our test signer reproduces it…
        const key = Buffer.from(secret.slice('whsec_'.length), 'base64')
        expect(signedHeaders(payload, key, { id, timestamp })['webhook-signature']).toBe(signature)

        // …and the SDK accepts it: the signature passes, and only the missing
        // event type is reported (a bad signature would be a verification error).
        vi.useFakeTimers({ toFake: ['Date'] })
        vi.setSystemTime(timestamp * 1000)
        const headers = { 'webhook-id': id, 'webhook-timestamp': String(timestamp), 'webhook-signature': signature }
        expect(await failureOf(validateEvent(payload, headers, secret))).toBeInstanceOf(WebhookUnknownTypeError)
    })

    it('rejects a signature made with a different secret', async () => {
        const { secret } = standardWebhooksSecret()
        const other = standardWebhooksSecret()
        await expect(validateEvent(body, signedHeaders(body, other.key), secret)).rejects.toBeInstanceOf(WebhookVerificationError)
    })

    it('rejects a tampered body under either scheme', async () => {
        const tampered = body.replace('prod_1', 'prod_2')
        for (const { secret, key } of [standardWebhooksSecret(), legacySecret()]) {
            await expect(validateEvent(tampered, signedHeaders(body, key), secret)).rejects.toBeInstanceOf(WebhookVerificationError)
        }
    })

    it('rejects a replay outside the five-minute tolerance', async () => {
        const { secret, key } = standardWebhooksSecret()
        const headers = signedHeaders(body, key, { timestamp: Math.floor(Date.now() / 1000) - 10 * 60 })
        await expect(validateEvent(body, headers, secret)).rejects.toBeInstanceOf(WebhookVerificationError)
    })

    it('fails closed with a verification error when the secret is not valid base64', async () => {
        const secret = 'whsec_not*base64!'
        const bogus = { 'webhook-id': 'msg_1', 'webhook-timestamp': String(Math.floor(Date.now() / 1000)), 'webhook-signature': 'v1,bogus' }
        await expect(validateEvent(body, bogus, secret)).rejects.toBeInstanceOf(WebhookVerificationError)
        // The legacy key (the string's own bytes) still works for such a secret.
        const event = await validateEvent(body, signedHeaders(body, Buffer.from(secret, 'utf8')), secret)
        expect(event.type).toBe('subscription.active')
    })

    it('rejects a delivery without signature headers', async () => {
        const { secret } = standardWebhooksSecret()
        await expect(validateEvent(body, {}, secret)).rejects.toBeInstanceOf(WebhookVerificationError)
    })

    it('reports a correctly signed event of an unknown type as WebhookUnknownTypeError', async () => {
        const { secret, key } = standardWebhooksSecret()
        const unknown = JSON.stringify({ type: 'subscription.teleported', data: {} })
        const error = await failureOf(validateEvent(unknown, signedHeaders(unknown, key), secret))
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
