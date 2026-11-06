import 'reflect-metadata'

import { Logger } from '@nestjs/common'
import type { EntityManager, Repository } from 'typeorm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ProcessedWebhookEvent } from '../../src/billing/entities/processed-webhook-event.entity'
import {
    type PolarWebhookEvent,
    validateEvent,
    WebhookUnknownTypeError,
    WebhookVerificationError,
} from '../../src/billing/polar/webhook-verify'
import { PolarWebhookService } from '../../src/billing/polar-webhook.service'
import type { RecordingCreditsService } from '../../src/recordings/recording-credits.service'
import type { SubscriptionsService } from '../../src/subscriptions/subscriptions.service'

// Signature verification is covered against the real SDK in
// polar/webhook-verify.test.ts; the entity's TypeORM decorators need
// emitDecoratorMetadata, which vitest's esbuild transform doesn't emit —
// mock both at the module seam.
vi.mock('../../src/billing/polar/webhook-verify', () => {
    class WebhookVerificationError extends Error {}
    class WebhookUnknownTypeError extends Error {
        constructor(readonly eventType: string | null) {
            super(`Unknown webhook event type: ${JSON.stringify(eventType)}`)
        }
    }
    return { validateEvent: vi.fn(), WebhookVerificationError, WebhookUnknownTypeError }
})
vi.mock('../../src/billing/entities/processed-webhook-event.entity', () => ({
    ProcessedWebhookEvent: class ProcessedWebhookEvent {},
}))

Logger.overrideLogger(false)

const PRO_MONTHLY = 'prod-pro-m'
const PACK_SINGLE = 'prod-pack-single'
const USER = { id: 'user-1', email: 'user@example.com' }
const WEBHOOK_HEADERS = { 'webhook-id': 'wh-1' }

/** PolarWebhookService with hand-rolled fakes for its three injected dependencies. */
function makeService(
    opts: {
        row?: Record<string, unknown> | null
        duplicateDelivery?: boolean
    } = {},
) {
    const subscriptions = {
        findForUser: vi.fn(() => Promise.resolve(opts.row ?? null)),
        upsert: vi.fn(() => Promise.resolve({})),
    }
    const credits = {
        grantPackSeconds: vi.fn(() => Promise.resolve()),
        revokePackSeconds: vi.fn(() => Promise.resolve()),
    }
    // Minimal EntityManager: the dedupe insert query builder + a transaction
    // that simply runs the callback against itself. The insert result mirrors
    // TypeORM on Postgres: `identifiers` is always filled from the passed
    // values; only the RETURNING rows (`raw`) are empty when ON CONFLICT DO
    // NOTHING skipped a duplicate.
    const insertResult = {
        identifiers: [{ id: 'wh-1' }],
        raw: opts.duplicateDelivery ? [] : [{ id: 'wh-1' }],
    }
    const qb = {
        insert: () => qb,
        into: () => qb,
        values: () => qb,
        orIgnore: () => qb,
        returning: () => qb,
        execute: vi.fn(() => Promise.resolve(insertResult)),
    }
    const manager = {
        createQueryBuilder: () => qb,
        transaction: async (cb: (em: EntityManager) => Promise<void>) => cb(manager as unknown as EntityManager),
    }
    const service = new PolarWebhookService(
        { manager } as unknown as Repository<ProcessedWebhookEvent>,
        subscriptions as unknown as SubscriptionsService,
        credits as unknown as RecordingCreditsService,
    )
    return { service, subscriptions, credits, dedupeInsert: qb.execute }
}

const ENV_KEYS = [
    'POLAR_WEBHOOK_SECRET',
    'POLAR_PRODUCT_PRO_MONTHLY',
    'POLAR_PRODUCT_PRO_YEARLY',
    'POLAR_PRODUCT_STUDIO_MONTHLY',
    'POLAR_PRODUCT_STUDIO_YEARLY',
    'POLAR_PRODUCT_ARRANGER_MONTHLY',
    'POLAR_PRODUCT_ARRANGER_YEARLY',
    'POLAR_PRODUCT_PACK_SINGLE',
    'POLAR_PRODUCT_PACK_EP',
    'POLAR_PRODUCT_PACK_ALBUM',
]
const savedEnv: Record<string, string | undefined> = {}

beforeEach(() => {
    for (const key of ENV_KEYS) {
        savedEnv[key] = process.env[key]
        delete process.env[key]
    }
    process.env.POLAR_PRODUCT_PRO_MONTHLY = PRO_MONTHLY
    process.env.POLAR_PRODUCT_PACK_SINGLE = PACK_SINGLE
    process.env.POLAR_WEBHOOK_SECRET = 'whsec_test'
    vi.mocked(validateEvent).mockReset()
})

afterEach(() => {
    for (const key of ENV_KEYS) {
        if (savedEnv[key] === undefined) delete process.env[key]
        else process.env[key] = savedEnv[key]
    }
})

describe('handleWebhook', () => {
    const rawBody = Buffer.from('{}')

    /** Make validateEvent resolve to this (partial, Polar-shaped) payload. */
    function deliver(event: { type: string; data: Record<string, unknown> }) {
        vi.mocked(validateEvent).mockResolvedValue(event as unknown as PolarWebhookEvent)
    }

    /** A subscription event as Polar 2026-10 sends it: snake_case, ISO timestamps. */
    function subscriptionEvent(data: Record<string, unknown>, type = 'subscription.active') {
        deliver({
            type,
            data: {
                id: 'sub-1',
                status: 'active',
                product_id: PRO_MONTHLY,
                customer_id: 'cus-1',
                customer: { id: 'cus-1', external_id: USER.id },
                metadata: {},
                current_period_end: '2026-08-08T12:00:00.000000Z',
                cancel_at_period_end: false,
                modified_at: '2026-07-08T12:00:00.000000Z',
                ...data,
            },
        })
    }

    it('throws WebhookVerificationError when no secret is configured', async () => {
        delete process.env.POLAR_WEBHOOK_SECRET
        const { service } = makeService()
        await expect(service.handleWebhook(rawBody, WEBHOOK_HEADERS)).rejects.toBeInstanceOf(WebhookVerificationError)
        expect(validateEvent).not.toHaveBeenCalled()
    })

    it('propagates signature failures from validateEvent', async () => {
        vi.mocked(validateEvent).mockRejectedValue(new WebhookVerificationError('bad signature'))
        const { service, dedupeInsert } = makeService()
        await expect(service.handleWebhook(rawBody, WEBHOOK_HEADERS)).rejects.toBeInstanceOf(WebhookVerificationError)
        expect(dedupeInsert).not.toHaveBeenCalled()
    })

    it('acknowledges a correctly signed event of an unknown type without recording or applying it', async () => {
        vi.mocked(validateEvent).mockRejectedValue(new WebhookUnknownTypeError('subscription.teleported'))
        const { service, subscriptions, credits, dedupeInsert } = makeService()
        await expect(service.handleWebhook(rawBody, WEBHOOK_HEADERS)).resolves.toBe(false)
        expect(dedupeInsert).not.toHaveBeenCalled()
        expect(subscriptions.upsert).not.toHaveBeenCalled()
        expect(credits.grantPackSeconds).not.toHaveBeenCalled()
    })

    it('returns false for a duplicate delivery id without applying anything', async () => {
        subscriptionEvent({})
        const { service, subscriptions } = makeService({ duplicateDelivery: true })
        await expect(service.handleWebhook(rawBody, WEBHOOK_HEADERS)).resolves.toBe(false)
        expect(subscriptions.upsert).not.toHaveBeenCalled()
    })

    it('verifies with the configured secret and upserts the subscription patch', async () => {
        subscriptionEvent({})
        const { service, subscriptions } = makeService()
        await expect(service.handleWebhook(rawBody, WEBHOOK_HEADERS)).resolves.toBe(true)
        expect(validateEvent).toHaveBeenCalledWith(rawBody, WEBHOOK_HEADERS, 'whsec_test')
        expect(subscriptions.upsert).toHaveBeenCalledWith(
            USER.id,
            {
                tierId: 'pro',
                polarCustomerId: 'cus-1',
                polarSubscriptionId: 'sub-1',
                polarProductId: PRO_MONTHLY,
                status: 'active',
                currentPeriodEnd: new Date('2026-08-08T12:00:00Z'),
                cancelAtPeriodEnd: false,
                lastPolarEventAt: new Date('2026-07-08T12:00:00Z'),
            },
            expect.anything(),
        )
    })

    it('mirrors a scheduled cancellation from subscription.canceled', async () => {
        subscriptionEvent({ cancel_at_period_end: true }, 'subscription.canceled')
        const { service, subscriptions } = makeService()
        await expect(service.handleWebhook(rawBody, WEBHOOK_HEADERS)).resolves.toBe(true)
        expect(subscriptions.upsert).toHaveBeenCalledWith(
            USER.id,
            expect.objectContaining({ tierId: 'pro', status: 'active', cancelAtPeriodEnd: true }),
            expect.anything(),
        )
    })

    it('drops the paid tier on subscription.revoked', async () => {
        subscriptionEvent({ status: 'canceled' }, 'subscription.revoked')
        const { service, subscriptions } = makeService()
        await expect(service.handleWebhook(rawBody, WEBHOOK_HEADERS)).resolves.toBe(true)
        expect(subscriptions.upsert).toHaveBeenCalledWith(
            USER.id,
            expect.objectContaining({ tierId: 'free', polarSubscriptionId: null, status: 'canceled' }),
            expect.anything(),
        )
    })

    it('falls back to checkout metadata when the subscription has no external customer id', async () => {
        subscriptionEvent({ customer: { id: 'cus-1', external_id: null }, metadata: { userId: USER.id } })
        const { service, subscriptions } = makeService()
        await expect(service.handleWebhook(rawBody, WEBHOOK_HEADERS)).resolves.toBe(true)
        expect(subscriptions.upsert).toHaveBeenCalledWith(USER.id, expect.objectContaining({ tierId: 'pro' }), expect.anything())
    })

    it('acknowledges but ignores events without an external customer id', async () => {
        subscriptionEvent({ customer: { id: 'cus-1' }, metadata: {} })
        const { service, subscriptions } = makeService()
        await expect(service.handleWebhook(rawBody, WEBHOOK_HEADERS)).resolves.toBe(true)
        expect(subscriptions.upsert).not.toHaveBeenCalled()
    })

    it('acknowledges but ignores products that are not mapped to a tier', async () => {
        subscriptionEvent({ product_id: 'someone-elses-product' })
        const { service, subscriptions } = makeService()
        await expect(service.handleWebhook(rawBody, WEBHOOK_HEADERS)).resolves.toBe(true)
        expect(subscriptions.upsert).not.toHaveBeenCalled()
    })

    it('drops out-of-order events older than the last applied one', async () => {
        subscriptionEvent({ modified_at: '2026-07-01T00:00:00Z' })
        const { service, subscriptions } = makeService({
            row: { tierId: 'free', lastPolarEventAt: new Date('2026-07-05T00:00:00Z') },
        })
        await expect(service.handleWebhook(rawBody, WEBHOOK_HEADERS)).resolves.toBe(true)
        expect(subscriptions.upsert).not.toHaveBeenCalled()
    })

    it('reconciles customer.state_changed snapshots', async () => {
        deliver({
            type: 'customer.state_changed',
            data: {
                id: 'cus-1',
                external_id: USER.id,
                active_subscriptions: [
                    {
                        id: 'sub-2',
                        status: 'active',
                        product_id: PRO_MONTHLY,
                        current_period_end: '2026-08-08T12:00:00Z',
                        cancel_at_period_end: false,
                        modified_at: null,
                    },
                ],
            },
        })
        const { service, subscriptions } = makeService()
        await expect(service.handleWebhook(rawBody, WEBHOOK_HEADERS)).resolves.toBe(true)
        expect(subscriptions.upsert).toHaveBeenCalledWith(
            USER.id,
            expect.objectContaining({
                tierId: 'pro',
                polarSubscriptionId: 'sub-2',
                polarCustomerId: 'cus-1',
                currentPeriodEnd: new Date('2026-08-08T12:00:00Z'),
            }),
            expect.anything(),
        )
    })

    it('downgrades a paid user whose customer.state_changed snapshot has no active subscription', async () => {
        deliver({
            type: 'customer.state_changed',
            data: { id: 'cus-1', external_id: USER.id, active_subscriptions: [] },
        })
        const { service, subscriptions } = makeService({ row: { tierId: 'pro' } })
        await expect(service.handleWebhook(rawBody, WEBHOOK_HEADERS)).resolves.toBe(true)
        expect(subscriptions.upsert).toHaveBeenCalledWith(USER.id, expect.objectContaining({ tierId: 'free' }), expect.anything())
    })

    it('acknowledges unrelated event types without mirroring anything', async () => {
        deliver({ type: 'benefit.created', data: {} })
        const { service, subscriptions } = makeService()
        await expect(service.handleWebhook(rawBody, WEBHOOK_HEADERS)).resolves.toBe(true)
        expect(subscriptions.upsert).not.toHaveBeenCalled()
    })

    it('grants pack seconds on order.paid for a pack product', async () => {
        deliver({
            type: 'order.paid',
            data: { product_id: PACK_SINGLE, customer: { external_id: USER.id }, metadata: {} },
        })
        const { service, credits } = makeService()
        await expect(service.handleWebhook(rawBody, WEBHOOK_HEADERS)).resolves.toBe(true)
        expect(credits.grantPackSeconds).toHaveBeenCalledWith(USER.id, 15 * 60, expect.anything())
    })

    it('reads the product from the nested product when product_id is absent', async () => {
        deliver({
            type: 'order.paid',
            data: { product_id: null, product: { id: PACK_SINGLE }, customer: { external_id: USER.id }, metadata: {} },
        })
        const { service, credits } = makeService()
        await expect(service.handleWebhook(rawBody, WEBHOOK_HEADERS)).resolves.toBe(true)
        expect(credits.grantPackSeconds).toHaveBeenCalledWith(USER.id, 15 * 60, expect.anything())
    })

    it('does not grant pack seconds twice when Polar retries an order.paid delivery', async () => {
        deliver({
            type: 'order.paid',
            data: { product_id: PACK_SINGLE, customer: { external_id: USER.id }, metadata: {} },
        })
        const { service, credits } = makeService({ duplicateDelivery: true })
        await expect(service.handleWebhook(rawBody, WEBHOOK_HEADERS)).resolves.toBe(false)
        expect(credits.grantPackSeconds).not.toHaveBeenCalled()
    })

    it('falls back to checkout metadata when the order has no external customer id', async () => {
        deliver({
            type: 'order.paid',
            data: { product_id: PACK_SINGLE, customer: {}, metadata: { userId: USER.id } },
        })
        const { service, credits } = makeService()
        await expect(service.handleWebhook(rawBody, WEBHOOK_HEADERS)).resolves.toBe(true)
        expect(credits.grantPackSeconds).toHaveBeenCalledWith(USER.id, 15 * 60, expect.anything())
    })

    it('ignores order.paid for subscription invoices (non-pack products)', async () => {
        deliver({
            type: 'order.paid',
            data: { product_id: PRO_MONTHLY, customer: { external_id: USER.id }, metadata: {} },
        })
        const { service, credits } = makeService()
        await expect(service.handleWebhook(rawBody, WEBHOOK_HEADERS)).resolves.toBe(true)
        expect(credits.grantPackSeconds).not.toHaveBeenCalled()
    })

    it('ignores order.created even for pack products (only order.paid grants)', async () => {
        deliver({
            type: 'order.created',
            data: { product_id: PACK_SINGLE, customer: { external_id: USER.id }, metadata: {} },
        })
        const { service, credits } = makeService()
        await expect(service.handleWebhook(rawBody, WEBHOOK_HEADERS)).resolves.toBe(true)
        expect(credits.grantPackSeconds).not.toHaveBeenCalled()
    })

    it('acknowledges but ignores a pack order without any user id', async () => {
        deliver({
            type: 'order.paid',
            data: { product_id: PACK_SINGLE, customer: {}, metadata: {} },
        })
        const { service, credits } = makeService()
        await expect(service.handleWebhook(rawBody, WEBHOOK_HEADERS)).resolves.toBe(true)
        expect(credits.grantPackSeconds).not.toHaveBeenCalled()
    })

    it('revokes pack seconds on order.refunded, but only for pack products', async () => {
        deliver({
            type: 'order.refunded',
            data: { product_id: PACK_SINGLE, customer: { external_id: USER.id }, metadata: {} },
        })
        const { service, credits } = makeService()
        await expect(service.handleWebhook(rawBody, WEBHOOK_HEADERS)).resolves.toBe(true)
        expect(credits.revokePackSeconds).toHaveBeenCalledWith(USER.id, 15 * 60, expect.anything())

        deliver({
            type: 'order.refunded',
            data: { product_id: PRO_MONTHLY, customer: { external_id: USER.id }, metadata: {} },
        })
        const second = makeService()
        await expect(second.service.handleWebhook(rawBody, WEBHOOK_HEADERS)).resolves.toBe(true)
        expect(second.credits.revokePackSeconds).not.toHaveBeenCalled()
    })
})
