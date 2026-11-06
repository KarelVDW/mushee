import 'reflect-metadata'

import { ForbiddenException, Logger } from '@nestjs/common'
import { HTTP_CODE_METADATA } from '@nestjs/common/constants'
import type { FastifyRequest } from 'fastify'
import type { EntityManager, Repository } from 'typeorm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ProcessedWebhookEvent } from '../../src/billing/entities/processed-webhook-event.entity'
import { PolarWebhookController } from '../../src/billing/polar-webhook.controller'
import { PolarWebhookService } from '../../src/billing/polar-webhook.service'
import type { RecordingCreditsService } from '../../src/recordings/recording-credits.service'
import type { SubscriptionsService } from '../../src/subscriptions/subscriptions.service'
import { legacySecret, signedHeaders, standardWebhooksSecret, subscriptionActiveBody } from './polar/webhook-signing'

// The receiver end to end with real signature verification: controller →
// service → @polar-sh/sdk validateEvent. Only the database is faked (the
// entity's TypeORM decorators need emitDecoratorMetadata, which vitest's
// esbuild transform doesn't emit).
vi.mock('../../src/billing/entities/processed-webhook-event.entity', () => ({
    ProcessedWebhookEvent: class ProcessedWebhookEvent {},
}))

Logger.overrideLogger(false)

const PRO_MONTHLY = 'prod-pro-m'
const USER_ID = 'user-1'

function makeController() {
    const subscriptions = {
        findForUser: vi.fn(() => Promise.resolve(null)),
        upsert: vi.fn(() => Promise.resolve({})),
    }
    const qb = {
        insert: () => qb,
        into: () => qb,
        values: () => qb,
        orIgnore: () => qb,
        execute: vi.fn(() => Promise.resolve({ identifiers: [{ id: 'x' }] })),
    }
    const manager = {
        createQueryBuilder: () => qb,
        transaction: async (cb: (em: EntityManager) => Promise<void>) => cb(manager as unknown as EntityManager),
    }
    const service = new PolarWebhookService(
        { manager } as unknown as Repository<ProcessedWebhookEvent>,
        subscriptions as unknown as SubscriptionsService,
        {} as RecordingCreditsService,
    )
    return { controller: new PolarWebhookController(service), subscriptions, dedupeInsert: qb.execute }
}

/** A Fastify request as main.ts hands it over: lowercase headers plus the preserved raw body. */
function request(body: string | undefined, headers: Record<string, string>): FastifyRequest {
    return { headers, rawBody: body === undefined ? undefined : Buffer.from(body) } as unknown as FastifyRequest
}

const savedEnv: Record<string, string | undefined> = {}
const ENV_KEYS = ['POLAR_WEBHOOK_SECRET', 'POLAR_PRODUCT_PRO_MONTHLY']

beforeEach(() => {
    for (const key of ENV_KEYS) savedEnv[key] = process.env[key]
    process.env.POLAR_PRODUCT_PRO_MONTHLY = PRO_MONTHLY
})

afterEach(() => {
    for (const key of ENV_KEYS) {
        if (savedEnv[key] === undefined) delete process.env[key]
        else process.env[key] = savedEnv[key]
    }
})

describe('POST /billing/webhooks/polar', () => {
    const body = subscriptionActiveBody({ productId: PRO_MONTHLY, externalId: USER_ID })

    it('answers 202', () => {
        const handle = Object.getOwnPropertyDescriptor(PolarWebhookController.prototype, 'handle')?.value as object
        expect(Reflect.getMetadata(HTTP_CODE_METADATA, handle)).toBe(202)
    })

    it.each([
        ['a Standard Webhooks (whsec_) secret', standardWebhooksSecret],
        ['a legacy Polar secret', legacySecret],
    ])('verifies and applies a delivery signed with %s', async (_label, makeSecret) => {
        const { secret, key } = makeSecret()
        process.env.POLAR_WEBHOOK_SECRET = secret
        const { controller, subscriptions } = makeController()

        await expect(controller.handle(request(body, signedHeaders(body, key)))).resolves.toEqual({ received: true })
        expect(subscriptions.upsert).toHaveBeenCalledWith(
            USER_ID,
            expect.objectContaining({
                tierId: 'pro',
                polarSubscriptionId: 'sub_1',
                currentPeriodEnd: new Date('2026-12-06T12:00:00Z'),
                lastPolarEventAt: new Date('2026-11-06T12:00:00Z'),
            }),
            expect.anything(),
        )
    })

    it('403s a forged delivery and records nothing', async () => {
        process.env.POLAR_WEBHOOK_SECRET = standardWebhooksSecret().secret
        const { controller, subscriptions, dedupeInsert } = makeController()
        const forged = signedHeaders(body, standardWebhooksSecret().key)

        await expect(controller.handle(request(body, forged))).rejects.toBeInstanceOf(ForbiddenException)
        expect(dedupeInsert).not.toHaveBeenCalled()
        expect(subscriptions.upsert).not.toHaveBeenCalled()
    })

    it('403s when the raw body was not preserved', async () => {
        const { secret, key } = standardWebhooksSecret()
        process.env.POLAR_WEBHOOK_SECRET = secret
        const { controller } = makeController()

        await expect(controller.handle(request(undefined, signedHeaders(body, key)))).rejects.toBeInstanceOf(ForbiddenException)
    })

    it('acknowledges a correctly signed event of a type the pinned version does not model', async () => {
        const { secret, key } = standardWebhooksSecret()
        process.env.POLAR_WEBHOOK_SECRET = secret
        const { controller, subscriptions, dedupeInsert } = makeController()
        const unknown = JSON.stringify({ type: 'subscription.teleported', data: { id: 'sub_1' } })

        await expect(controller.handle(request(unknown, signedHeaders(unknown, key)))).resolves.toEqual({ received: true })
        expect(dedupeInsert).not.toHaveBeenCalled()
        expect(subscriptions.upsert).not.toHaveBeenCalled()
    })
})
