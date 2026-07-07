import { describe, expect, it } from 'vitest'

import { BETA_PLAN, PLAN_TIERS, planById, planFeatures, planPrice, recordingBudgetLabel } from '@/lib/plans'

describe('plan catalogue', () => {
    it('lists the three sellable tiers with unique ids', () => {
        expect(PLAN_TIERS.map((p) => p.id)).toEqual(['free', 'pro', 'studio'])
        expect(new Set(PLAN_TIERS.map((p) => p.id)).size).toBe(3)
    })

    it('carries the seeded tier names as static fallbacks', () => {
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

    it('formats recording budgets for seconds, minutes, and unlimited', () => {
        expect(recordingBudgetLabel(30)).toBe('30 sec of recording / day')
        expect(recordingBudgetLabel(600)).toBe('10 min of recording / day')
        expect(recordingBudgetLabel(300)).toBe('5 min of recording / day')
        expect(recordingBudgetLabel(null)).toBe('Unlimited recording')
    })

    it('puts the recording budget first in the feature list, API value winning', () => {
        const pro = planById('pro')
        expect(planFeatures(pro)[0]).toBe('10 min of recording / day')
        // A re-tuned database budget overrides the static fallback.
        expect(planFeatures(pro, 1200)[0]).toBe('20 min of recording / day')
        expect(planFeatures(pro).slice(1)).toEqual(pro.features)
    })
})
