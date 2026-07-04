import { describe, expect, it } from 'vitest'

import { BETA_PLAN, PLAN_TIERS, planById, planPrice } from '@/lib/plans'

describe('plan catalogue', () => {
    it('lists the three sellable tiers with unique ids', () => {
        expect(PLAN_TIERS.map((p) => p.id)).toEqual(['free', 'pro', 'studio'])
        expect(new Set(PLAN_TIERS.map((p) => p.id)).size).toBe(3)
    })

    it('mirrors the API tier names (SubscriptionTier)', () => {
        expect(planById('free').name).toBe('Sketch')
        expect(planById('pro').name).toBe('Composer')
        expect(planById('studio').name).toBe('Studio')
        expect(BETA_PLAN.name).toBe('Beta')
    })

    it('falls back to the free tier for unknown ids', () => {
        expect(planById('nope').id).toBe('free')
        expect(planById(undefined).id).toBe('free')
        // 'beta' is not sellable, so the catalogue lookup falls back too.
        expect(planById('beta').id).toBe('free')
    })

    it('formats prices per cadence', () => {
        const free = planById('free')
        const pro = planById('pro')
        const studio = planById('studio')
        expect(planPrice(free, 'monthly')).toBe('Free')
        expect(planPrice(pro, 'monthly')).toBe('$8/mo')
        expect(planPrice(pro, 'yearly')).toBe('$6.67/mo · billed yearly')
        expect(planPrice(studio, 'yearly')).toBe('$15/mo · billed yearly')
    })
})
