import 'reflect-metadata'

import { BadRequestException, ForbiddenException, Logger, ServiceUnavailableException } from '@nestjs/common'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BillingService } from '../../src/billing/billing.service'
import { isBillingConfigured, polarClient } from '../../src/billing/polar/client'
import { type Polar, PolarClientError } from '../../src/billing/polar/sdk'
import type { RecordingCreditsService } from '../../src/recordings/recording-credits.service'
import type { SubscriptionsService } from '../../src/subscriptions/subscriptions.service'

// The Polar SDK client is third-party code — mock it at the module seam.
vi.mock('../../src/billing/polar/client', () => ({
    polarClient: vi.fn(),
    isBillingConfigured: vi.fn(),
}))

Logger.overrideLogger(false)

const PRO_MONTHLY = 'prod-pro-m'
const PRO_YEARLY = 'prod-pro-y'
const PACK_SINGLE = 'prod-pack-single'
const USER = { id: 'user-1', email: 'user@example.com' }

function fakePolar() {
    return {
        checkouts: {
            create: vi.fn(() => Promise.resolve({ url: 'https://polar.sh/checkout/1' })),
        },
        customerSessions: {
            create: vi.fn(() => Promise.resolve({ customer_portal_url: 'https://polar.sh/portal/1' })),
        },
        subscriptions: { update: vi.fn(() => Promise.resolve({})) },
        customers: { deleteExternal: vi.fn(() => Promise.resolve()) },
    }
}

function configurePolar(polar: ReturnType<typeof fakePolar> | null) {
    vi.mocked(polarClient).mockReturnValue(polar as unknown as Polar | null)
    vi.mocked(isBillingConfigured).mockReturnValue(polar !== null)
}

/** BillingService with hand-rolled fakes for its two injected dependencies. */
function makeService(opts: { row?: Record<string, unknown> | null } = {}) {
    const tiers: Record<string, unknown> = {
        pro: { id: 'pro', name: 'Pro', dailyRecordingCredits: 3600 },
        free: { id: 'free', name: 'Free', dailyRecordingCredits: 300 },
    }
    const subscriptions = {
        findForUser: vi.fn(() => Promise.resolve(opts.row ?? null)),
        tierById: vi.fn((id?: string | null) => Promise.resolve(tiers[id ?? 'free'] ?? tiers.free)),
        upsert: vi.fn(() => Promise.resolve({})),
    }
    const credits = {
        balance: vi.fn(() => Promise.resolve({ used: 60, remaining: 3540, packSeconds: 120, resetsAt: '2026-07-15T00:00:00.000Z' })),
    }
    const service = new BillingService(subscriptions as unknown as SubscriptionsService, credits as unknown as RecordingCreditsService)
    return { service, subscriptions, credits }
}

const ENV_KEYS = [
    'BETA_MODE',
    'WEB_APP_URL',
    'CORS_ORIGIN',
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
    process.env.POLAR_PRODUCT_PRO_YEARLY = PRO_YEARLY
    process.env.POLAR_PRODUCT_PACK_SINGLE = PACK_SINGLE
    configurePolar(null)
})

afterEach(() => {
    for (const key of ENV_KEYS) {
        if (savedEnv[key] === undefined) delete process.env[key]
        else process.env[key] = savedEnv[key]
    }
})

describe('getState', () => {
    it('assembles tier, subscription state and credits for a paid user', async () => {
        configurePolar(fakePolar())
        const { service } = makeService({
            row: {
                tierId: 'pro',
                status: 'active',
                polarProductId: PRO_MONTHLY,
                currentPeriodEnd: new Date('2026-08-01T00:00:00Z'),
                cancelAtPeriodEnd: true,
            },
        })
        expect(await service.getState(USER.id)).toEqual({
            tierId: 'pro',
            tierName: 'Pro',
            status: 'active',
            interval: 'monthly',
            currentPeriodEnd: '2026-08-01T00:00:00.000Z',
            cancelAtPeriodEnd: true,
            billingConfigured: true,
            betaMode: false,
            credits: {
                limitSeconds: 3600,
                usedSeconds: 60,
                remainingSeconds: 3540,
                packSeconds: 120,
                resetsAt: '2026-07-15T00:00:00.000Z',
            },
        })
    })

    it('falls back to the free tier with null billing fields when there is no row', async () => {
        process.env.BETA_MODE = 'true'
        const { service } = makeService({ row: null })
        expect(await service.getState(USER.id)).toMatchObject({
            tierId: 'free',
            status: null,
            interval: null,
            currentPeriodEnd: null,
            cancelAtPeriodEnd: false,
            billingConfigured: false,
            betaMode: true,
            credits: { limitSeconds: 300 },
        })
    })
})

describe('createCheckout', () => {
    it('is forbidden in beta mode', async () => {
        process.env.BETA_MODE = 'true'
        const { service } = makeService()
        await expect(service.createCheckout(USER, 'pro', 'monthly')).rejects.toBeInstanceOf(ForbiddenException)
    })

    it('answers 503 when Polar is not configured', async () => {
        const { service } = makeService()
        await expect(service.createCheckout(USER, 'pro', 'monthly')).rejects.toBeInstanceOf(ServiceUnavailableException)
    })

    it('answers 503, not 400, when Polar and the product are both unconfigured', async () => {
        const { service } = makeService()
        await expect(service.createCheckout(USER, 'studio', 'yearly')).rejects.toBeInstanceOf(ServiceUnavailableException)
    })

    it('rejects tier/interval combinations without a configured product', async () => {
        configurePolar(fakePolar())
        const { service } = makeService()
        await expect(service.createCheckout(USER, 'studio', 'yearly')).rejects.toBeInstanceOf(BadRequestException)
    })

    it('creates a Polar checkout keyed to the user, forwarding the client IP for currency geolocation', async () => {
        process.env.WEB_APP_URL = 'https://app.example.com/'
        const polar = fakePolar()
        configurePolar(polar)
        const { service } = makeService()
        await expect(service.createCheckout(USER, 'pro', 'monthly', '203.0.113.7')).resolves.toEqual({
            url: 'https://polar.sh/checkout/1',
        })
        expect(polar.checkouts.create).toHaveBeenCalledWith({
            products: [PRO_MONTHLY],
            external_customer_id: USER.id,
            customer_email: USER.email,
            customer_ip_address: '203.0.113.7',
            success_url: 'https://app.example.com/settings?checkout=success',
            metadata: { userId: USER.id },
        })
    })
})

describe('createPackCheckout', () => {
    it('is forbidden in beta mode', async () => {
        process.env.BETA_MODE = 'true'
        const { service } = makeService()
        await expect(service.createPackCheckout(USER, 'single')).rejects.toBeInstanceOf(ForbiddenException)
    })

    it('answers 503 when Polar is not configured', async () => {
        const { service } = makeService()
        await expect(service.createPackCheckout(USER, 'single')).rejects.toBeInstanceOf(ServiceUnavailableException)
    })

    it('answers 503, not 400, when Polar and the pack product are both unconfigured', async () => {
        const { service } = makeService()
        await expect(service.createPackCheckout(USER, 'album')).rejects.toBeInstanceOf(ServiceUnavailableException)
    })

    it('rejects packs without a configured product', async () => {
        configurePolar(fakePolar())
        const { service } = makeService()
        await expect(service.createPackCheckout(USER, 'album')).rejects.toBeInstanceOf(BadRequestException)
    })

    it('creates a one-time checkout keyed to the user and pack, forwarding the client IP', async () => {
        process.env.WEB_APP_URL = 'https://app.example.com/'
        const polar = fakePolar()
        configurePolar(polar)
        const { service } = makeService()
        await expect(service.createPackCheckout(USER, 'single', '203.0.113.7')).resolves.toEqual({
            url: 'https://polar.sh/checkout/1',
        })
        expect(polar.checkouts.create).toHaveBeenCalledWith({
            products: [PACK_SINGLE],
            external_customer_id: USER.id,
            customer_email: USER.email,
            customer_ip_address: '203.0.113.7',
            success_url: 'https://app.example.com/settings?pack=success',
            metadata: { userId: USER.id, packId: 'single' },
        })
    })
})

describe('createPortalSession', () => {
    it('answers 503 when Polar is not configured', async () => {
        const { service } = makeService()
        await expect(service.createPortalSession(USER.id)).rejects.toBeInstanceOf(ServiceUnavailableException)
    })

    it('opens the hosted portal for the external customer, returning to settings', async () => {
        process.env.WEB_APP_URL = 'https://app.example.com/'
        const polar = fakePolar()
        configurePolar(polar)
        const { service } = makeService()
        await expect(service.createPortalSession(USER.id)).resolves.toEqual({ url: 'https://polar.sh/portal/1' })
        expect(polar.customerSessions.create).toHaveBeenCalledWith({
            external_customer_id: USER.id,
            return_url: 'https://app.example.com/settings',
        })
    })
})

describe('changePlan', () => {
    it('requires an active subscription', async () => {
        configurePolar(fakePolar())
        const { service } = makeService({ row: null })
        await expect(service.changePlan(USER.id, 'pro', 'yearly')).rejects.toBeInstanceOf(BadRequestException)
    })

    it('rejects a switch to an unconfigured product', async () => {
        configurePolar(fakePolar())
        const { service } = makeService({ row: { polarSubscriptionId: 'sub-1' } })
        await expect(service.changePlan(USER.id, 'studio', 'monthly')).rejects.toBeInstanceOf(BadRequestException)
    })

    it('updates the Polar subscription and mirrors the new product locally', async () => {
        const polar = fakePolar()
        configurePolar(polar)
        const { service, subscriptions } = makeService({
            row: { tierId: 'pro', polarSubscriptionId: 'sub-1', polarProductId: PRO_MONTHLY },
        })
        const state = await service.changePlan(USER.id, 'pro', 'yearly')
        expect(polar.subscriptions.update).toHaveBeenCalledWith('sub-1', { product_id: PRO_YEARLY })
        expect(subscriptions.upsert).toHaveBeenCalledWith(USER.id, {
            tierId: 'pro',
            polarProductId: PRO_YEARLY,
        })
        expect(state.tierId).toBe('pro')
    })
})

describe('cancelAtPeriodEnd / resumeSubscription', () => {
    it('requires an active subscription', async () => {
        configurePolar(fakePolar())
        const { service } = makeService({ row: {} })
        await expect(service.cancelAtPeriodEnd(USER.id)).rejects.toBeInstanceOf(BadRequestException)
        await expect(service.resumeSubscription(USER.id)).rejects.toBeInstanceOf(BadRequestException)
    })

    it('schedules and undoes cancellation via Polar, mirroring immediately', async () => {
        const polar = fakePolar()
        configurePolar(polar)
        const { service, subscriptions } = makeService({
            row: { tierId: 'pro', polarSubscriptionId: 'sub-1' },
        })

        await service.cancelAtPeriodEnd(USER.id)
        expect(polar.subscriptions.update).toHaveBeenLastCalledWith('sub-1', { cancel_at_period_end: true })
        expect(subscriptions.upsert).toHaveBeenLastCalledWith(USER.id, {
            cancelAtPeriodEnd: true,
        })

        await service.resumeSubscription(USER.id)
        expect(polar.subscriptions.update).toHaveBeenLastCalledWith('sub-1', { cancel_at_period_end: false })
        expect(subscriptions.upsert).toHaveBeenLastCalledWith(USER.id, {
            cancelAtPeriodEnd: false,
        })
    })
})

describe('deletePolarCustomer', () => {
    it('is a no-op when Polar is not configured', async () => {
        const { service } = makeService()
        await expect(service.deletePolarCustomer(USER.id)).resolves.toBeUndefined()
    })

    it('deletes the customer by external id', async () => {
        const polar = fakePolar()
        configurePolar(polar)
        const { service } = makeService()
        await service.deletePolarCustomer(USER.id)
        expect(polar.customers.deleteExternal).toHaveBeenCalledWith(USER.id)
    })

    it('swallows a 404 (customer never checked out)', async () => {
        const polar = fakePolar()
        polar.customers.deleteExternal.mockRejectedValue(new PolarClientError(404, { detail: 'Not found' }))
        configurePolar(polar)
        const { service } = makeService()
        await expect(service.deletePolarCustomer(USER.id)).resolves.toBeUndefined()
    })

    it('rethrows other Polar errors so the purge cron retries', async () => {
        const polar = fakePolar()
        const rateLimited = new PolarClientError(429, 'Too many requests')
        polar.customers.deleteExternal.mockRejectedValue(rateLimited)
        configurePolar(polar)
        const { service } = makeService()
        await expect(service.deletePolarCustomer(USER.id)).rejects.toBe(rateLimited)
    })
})
