import { describe, expect, it } from 'vitest'

import { BETA_PLAN, CREDIT_PACKS, PLAN_TIERS, planById, planFeatures, planPrice, recordingBudgetLabel } from '@/lib/plans'

describe('plan catalogue', () => {
    it('lists the four sellable tiers with unique ids', () => {
        expect(PLAN_TIERS.map((p) => p.id)).toEqual(['free', 'pro', 'studio', 'arranger'])
        expect(new Set(PLAN_TIERS.map((p) => p.id)).size).toBe(4)
    })

    it('carries the seeded tier names as static fallbacks', () => {
        expect(planById('free').name).toBe('Sketch')
        expect(planById('pro').name).toBe('Songwriter')
        expect(planById('studio').name).toBe('Studio')
        expect(planById('arranger').name).toBe('Arranger')
        expect(BETA_PLAN.name).toBe('Beta')
    })

    it('marks only the professional tier for the slim card treatment', () => {
        expect(PLAN_TIERS.filter((p) => p.professional).map((p) => p.id)).toEqual(['arranger'])
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
        const arranger = planById('arranger')
        expect(planPrice(free, 'monthly')).toBe('Free')
        expect(planPrice(pro, 'monthly')).toBe('$9/mo')
        expect(planPrice(pro, 'yearly')).toBe('$7.50/mo · billed yearly')
        expect(planPrice(studio, 'yearly')).toBe('$15.83/mo · billed yearly')
        expect(planPrice(arranger, 'monthly')).toBe('$49/mo')
    })

    it('formats recording budgets for seconds, minutes, hours, and unlimited', () => {
        expect(recordingBudgetLabel(30)).toBe('30 sec of recording / day')
        expect(recordingBudgetLabel(600)).toBe('10 min of recording / day')
        expect(recordingBudgetLabel(1800)).toBe('30 min of recording / day')
        expect(recordingBudgetLabel(10800)).toBe('3 h of recording / day')
        expect(recordingBudgetLabel(28800)).toBe('8 h of recording / day')
        expect(recordingBudgetLabel(5400)).toBe('1.5 h of recording / day')
        expect(recordingBudgetLabel(null)).toBe('Unlimited recording')
    })

    it('puts the recording budget first in the feature list, API value winning', () => {
        const pro = planById('pro')
        expect(planFeatures(pro)[0]).toBe('20 min of recording / day')
        // A re-tuned database budget overrides the static fallback.
        expect(planFeatures(pro, 600)[0]).toBe('10 min of recording / day')
        expect(planFeatures(pro).slice(1)).toEqual(pro.features)
    })
})

describe('credit packs', () => {
    it('lists the three packs with unique ids', () => {
        expect(CREDIT_PACKS.map((p) => p.id)).toEqual(['single', 'ep', 'album'])
    })

    it('never undercuts the subscriptions: every pack costs far more per minute', () => {
        // Songwriter: $9 for ~600 min/month (20 min/day) ≈ 1.5¢/min. Packs are
        // deliberately the expensive convenience — the plan must stay the
        // obviously better deal at every size.
        const songwriterPerMinute = 9 / 600
        for (const pack of CREDIT_PACKS) {
            expect(pack.price / pack.minutes).toBeGreaterThan(songwriterPerMinute * 10)
        }
    })

    it('prices larger packs at a gently declining per-minute rate', () => {
        const rates = CREDIT_PACKS.map((p) => p.price / p.minutes)
        for (let i = 1; i < rates.length; i++) {
            expect(rates[i]).toBeLessThan(rates[i - 1])
        }
    })
})
