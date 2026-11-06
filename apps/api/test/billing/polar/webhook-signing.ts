import { createHmac, randomBytes } from 'node:crypto'

/**
 * Test-side Polar webhook signing for both of Polar's secret schemes:
 *
 *  - Standard Webhooks (every secret created since 2026-09-08): the secret is
 *    `whsec_<base64 key>` and the HMAC key is the base64-decoded remainder.
 *    @polar-sh/sdk 0.47.1 could not verify these.
 *  - Legacy Polar HMAC (secrets created before then): the secret also looks
 *    like `whsec_…` (a hex remainder), but the HMAC key is the UTF-8 bytes of
 *    the whole string, prefix included.
 *
 * Either way the signature is base64 HMAC-SHA256 over
 * `${webhook-id}.${webhook-timestamp}.${raw body}`, sent as `v1,<sig>`.
 * webhook-verify.test.ts pins this signer to the published Standard Webhooks
 * test vector, so the tests don't just agree with themselves.
 */

export function standardWebhooksSecret(): { secret: string; key: Buffer } {
    const key = randomBytes(32)
    return { secret: `whsec_${key.toString('base64')}`, key }
}

/** A pre-2026-09-08 secret. Its hex remainder is valid base64 too, so the
 *  verifier must still try the UTF-8 key when the remainder decodes. */
export function legacySecret(): { secret: string; key: Buffer } {
    const secret = `whsec_${randomBytes(16).toString('hex')}`
    return { secret, key: Buffer.from(secret, 'utf8') }
}

/** The headers Polar sends with a delivery of `body`, signed with `key`. */
export function signedHeaders(body: string, key: Buffer, opts: { id?: string; timestamp?: number } = {}): Record<string, string> {
    const id = opts.id ?? `msg_${randomBytes(8).toString('hex')}`
    const timestamp = opts.timestamp ?? Math.floor(Date.now() / 1000)
    const signature = createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64')
    return {
        'webhook-id': id,
        'webhook-timestamp': String(timestamp),
        'webhook-signature': `v1,${signature}`,
    }
}

/** A subscription.active delivery body as the 2026-10 endpoint sends it (the fields we read). */
export function subscriptionActiveBody(opts: { productId: string; externalId: string }): string {
    return JSON.stringify({
        type: 'subscription.active',
        timestamp: '2026-11-06T12:00:00.000000Z',
        api_version: '2026-10',
        data: {
            id: 'sub_1',
            created_at: '2026-11-06T11:59:00.000000Z',
            modified_at: '2026-11-06T12:00:00.000000Z',
            status: 'active',
            current_period_start: '2026-11-06T12:00:00.000000Z',
            current_period_end: '2026-12-06T12:00:00.000000Z',
            cancel_at_period_end: false,
            customer_id: 'cus_1',
            product_id: opts.productId,
            metadata: {},
            customer: { id: 'cus_1', external_id: opts.externalId, metadata: {} },
        },
    })
}
