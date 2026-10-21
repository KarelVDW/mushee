import 'reflect-metadata'

import { Logger } from '@nestjs/common'
import type { EntityManager, Repository } from 'typeorm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ProcessedWebhookEvent } from '../../src/billing/entities/processed-webhook-event.entity'
import { validateEvent, WebhookVerificationError } from '../../src/billing/polar/webhook-verify'
import { PolarWebhookService } from '../../src/billing/polar-webhook.service'
import type { RecordingCreditsService } from '../../src/recordings/recording-credits.service'
import type { SubscriptionsService } from '../../src/subscriptions/subscriptions.service'

// The webhook signature shim is third-party code; the entity's TypeORM
// decorators need emitDecoratorMetadata, which vitest's esbuild transform
// doesn't emit — mock both at the module seam.
vi.mock('../../src/billing/polar/webhook-verify', () => {
    class WebhookVerificationError extends Error {}
    return { validateEvent: vi.fn(), WebhookVerificationError }
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
    // that simply runs the callback against itself.
    const insertResult = {
        identifiers: opts.duplicateDelivery ? [] : [{ id: 'wh-1' }],
    }
    const qb = {
        insert: () => qb,
        into: () => qb,
        values: () => qb,
        orIgnore: () => qb,
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
    return { service, subscriptions, credits }
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

    function subscriptionEvent(data: Record<string, unknown>) {
        vi.mocked(validateEvent).mockReturnValue({
            type: 'subscription.active',
            data: {
                id: 'sub-1',
                status: 'active',
                productId: PRO_MONTHLY,
                customer: { externalId: USER.id },
                modifiedAt: new Date('2026-07-08T12:00:00Z'),
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
        vi.mocked(validateEvent).mockImplementation(() => {
            throw new WebhookVerificationError('bad signature')
        })
        const { service } = makeService()
        await expect(service.handleWebhook(rawBody, WEBHOOK_HEADERS)).rejects.toBeInstanceOf(WebhookVerificationError)
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
            expect.objectContaining({
                tierId: 'pro',
                polarSubscriptionId: 'sub-1',
                polarProductId: PRO_MONTHLY,
                status: 'active',
            }),
            expect.anything(),
        )
    })

    it('acknowledges but ignores events without an external customer id', async () => {
        subscriptionEvent({ customer: {}, metadata: {} })
        const { service, subscriptions } = makeService()
        await expect(service.handleWebhook(rawBody, WEBHOOK_HEADERS)).resolves.toBe(true)
        expect(subscriptions.upsert).not.toHaveBeenCalled()
    })

    it('acknowledges but ignores products that are not mapped to a tier', async () => {
        subscriptionEvent({ productId: 'someone-elses-product' })
        const { service, subscriptions } = makeService()
        await expect(service.handleWebhook(rawBody, WEBHOOK_HEADERS)).resolves.toBe(true)
        expect(subscriptions.upsert).not.toHaveBeenCalled()
    })

    it('drops out-of-order events older than the last applied one', async () => {
        subscriptionEvent({ modifiedAt: new Date('2026-07-01T00:00:00Z') })
        const { service, subscriptions } = makeService({
            row: { tierId: 'free', lastPolarEventAt: new Date('2026-07-05T00:00:00Z') },
        })
        await expect(service.handleWebhook(rawBody, WEBHOOK_HEADERS)).resolves.toBe(true)
        expect(subscriptions.upsert).not.toHaveBeenCalled()
    })

    it('reconciles customer.state_changed snapshots', async () => {
        vi.mocked(validateEvent).mockReturnValue({
            type: 'customer.state_changed',
            data: {
                id: 'cus-1',
                externalId: USER.id,
                activeSubscriptions: [{ id: 'sub-2', status: 'active', productId: PRO_MONTHLY }],
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
            }),
            expect.anything(),
        )
    })

    it('acknowledges unrelated event types without mirroring anything', async () => {
        vi.mocked(validateEvent).mockReturnValue({ type: 'benefit.created', data: {} })
        const { service, subscriptions } = makeService()
        await expect(service.handleWebhook(rawBody, WEBHOOK_HEADERS)).resolves.toBe(true)
        expect(subscriptions.upsert).not.toHaveBeenCalled()
    })

    it('grants pack seconds on order.paid for a pack product', async () => {
        vi.mocked(validateEvent).mockReturnValue({
            type: 'order.paid',
            data: { productId: PACK_SINGLE, customer: { externalId: USER.id } },
        })
        const { service, credits } = makeService()
        await expect(service.handleWebhook(rawBody, WEBHOOK_HEADERS)).resolves.toBe(true)
        expect(credits.grantPackSeconds).toHaveBeenCalledWith(USER.id, 15 * 60, expect.anything())
    })

    it('falls back to checkout metadata when the order has no external customer id', async () => {
        vi.mocked(validateEvent).mockReturnValue({
            type: 'order.paid',
            data: { productId: PACK_SINGLE, customer: {}, metadata: { userId: USER.id } },
        })
        const { service, credits } = makeService()
        await expect(service.handleWebhook(rawBody, WEBHOOK_HEADERS)).resolves.toBe(true)
        expect(credits.grantPackSeconds).toHaveBeenCalledWith(USER.id, 15 * 60, expect.anything())
    })

    it('ignores order.paid for subscription invoices (non-pack products)', async () => {
        vi.mocked(validateEvent).mockReturnValue({
            type: 'order.paid',
            data: { productId: PRO_MONTHLY, customer: { externalId: USER.id } },
        })
        const { service, credits } = makeService()
        await expect(service.handleWebhook(rawBody, WEBHOOK_HEADERS)).resolves.toBe(true)
        expect(credits.grantPackSeconds).not.toHaveBeenCalled()
    })

    it('ignores order.created even for pack products (only order.paid grants)', async () => {
        vi.mocked(validateEvent).mockReturnValue({
            type: 'order.created',
            data: { productId: PACK_SINGLE, customer: { externalId: USER.id } },
        })
        const { service, credits } = makeService()
        await expect(service.handleWebhook(rawBody, WEBHOOK_HEADERS)).resolves.toBe(true)
        expect(credits.grantPackSeconds).not.toHaveBeenCalled()
    })

    it('acknowledges but ignores a pack order without any user id', async () => {
        vi.mocked(validateEvent).mockReturnValue({
            type: 'order.paid',
            data: { productId: PACK_SINGLE, customer: {}, metadata: {} },
        })
        const { service, credits } = makeService()
        await expect(service.handleWebhook(rawBody, WEBHOOK_HEADERS)).resolves.toBe(true)
        expect(credits.grantPackSeconds).not.toHaveBeenCalled()
    })

    it('revokes pack seconds on order.refunded, but only for pack products', async () => {
        vi.mocked(validateEvent).mockReturnValue({
            type: 'order.refunded',
            data: { productId: PACK_SINGLE, customer: { externalId: USER.id } },
        })
        const { service, credits } = makeService()
        await expect(service.handleWebhook(rawBody, WEBHOOK_HEADERS)).resolves.toBe(true)
        expect(credits.revokePackSeconds).toHaveBeenCalledWith(USER.id, 15 * 60, expect.anything())

        vi.mocked(validateEvent).mockReturnValue({
            type: 'order.refunded',
            data: { productId: PRO_MONTHLY, customer: { externalId: USER.id } },
        })
        const second = makeService()
        await expect(second.service.handleWebhook(rawBody, WEBHOOK_HEADERS)).resolves.toBe(true)
        expect(second.credits.revokePackSeconds).not.toHaveBeenCalled()
    })
})
