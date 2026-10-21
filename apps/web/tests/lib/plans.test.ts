import { describe, expect, it } from 'vitest'

import type { Plan } from '@/lib/api'
import {
    BETA_PLAN,
    CREDIT_PACKS,
    isPaidTier,
    isPlanTierId,
    PLAN_TIERS,
    planById,
    PlanCatalogue,
    planFeatures,
    planPrice,
    recordingBudgetLabel,
    scoreLimitLabel,
} from '@/lib/plans'

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

    it('formats score caps, with the free tier capped and the rest open', () => {
        expect(scoreLimitLabel(5)).toBe('Up to 5 scores')
        expect(scoreLimitLabel(null)).toBe('As many scores as you like')
        expect(planById('free').maxScores).toBe(5)
        expect(PLAN_TIERS.filter((p) => p.id !== 'free').every((p) => p.maxScores === null)).toBe(true)
    })

    it('puts the recording budget and score cap first in the feature list, API values winning', () => {
        const pro = planById('pro')
        expect(planFeatures(pro)[0]).toBe('20 min of recording / day')
        expect(planFeatures(pro)[1]).toBe('As many scores as you like')
        expect(planFeatures(planById('free'))[1]).toBe('Up to 5 scores')
        // Re-tuned database entitlements override the static fallbacks.
        expect(planFeatures(pro, 600)[0]).toBe('10 min of recording / day')
        expect(planFeatures(pro, 600, 20)[1]).toBe('Up to 20 scores')
        expect(planFeatures(pro).slice(2)).toEqual(pro.features)
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

describe('tier ids', () => {
    it('knows which tiers Polar sells', () => {
        expect(isPaidTier('pro')).toBe(true)
        expect(isPaidTier('studio')).toBe(true)
        expect(isPaidTier('arranger')).toBe(true)
        expect(isPaidTier('free')).toBe(false)
        expect(isPaidTier('beta')).toBe(false)
    })

    it('recognises only the statically decorated tier ids', () => {
        expect(PLAN_TIERS.every((p) => isPlanTierId(p.id))).toBe(true)
        expect(isPlanTierId('beta')).toBe(false)
        expect(isPlanTierId('team')).toBe(false)
    })
})

describe('PlanCatalogue', () => {
    // The database catalogue, re-tuned against the static fallbacks so the merge is visible.
    const API_PLANS: Plan[] = [
        { id: 'free', name: 'Sketchbook', dailyRecordingCredits: 240, maxScores: 3, sellable: true },
        { id: 'pro', name: 'Songwriter', dailyRecordingCredits: 1500, maxScores: null, sellable: true },
        { id: 'beta', name: 'Insider', dailyRecordingCredits: 3600, maxScores: 50, sellable: false },
        { id: 'studio', name: 'Studio', dailyRecordingCredits: 10800, maxScores: null, sellable: true },
        { id: 'team', name: 'Team', dailyRecordingCredits: null, maxScores: null, sellable: true },
    ]

    it('stands in with the static catalogue while the API has not answered', () => {
        const plans = new PlanCatalogue(undefined)
        expect(plans.sellable).toBe(PLAN_TIERS)
        expect(plans.beta).toBe(BETA_PLAN)
        expect(plans.nextAfter('free')?.id).toBe('pro')
        expect(plans.maxScoresFor('free')).toBe(5)
    })

    it('offers the sellable API tiers in API order, with database names and limits over the static decoration', () => {
        const plans = new PlanCatalogue(API_PLANS)
        // Beta is not sellable; 'team' has no static decoration to show it with.
        expect(plans.sellable.map((p) => p.id)).toEqual(['free', 'pro', 'studio'])
        const free = plans.byId('free')
        expect(free).toMatchObject({ name: 'Sketchbook', dailyRecordingSeconds: 240, maxScores: 3 })
        expect(free?.icon).toBe(planById('free').icon)
        expect(free?.priceMonthly).toBe(0)
        expect(plans.byId('pro')?.priceMonthly).toBe(planById('pro').priceMonthly)
        expect(plans.byId('beta')).toBeUndefined()
    })

    it('merges the database beta plan into its static decoration', () => {
        const plans = new PlanCatalogue(API_PLANS)
        expect(plans.beta).toEqual({ ...BETA_PLAN, name: 'Insider', dailyRecordingSeconds: 3600, maxScores: 50 })
        // Without a beta row the static plan stands.
        expect(new PlanCatalogue(API_PLANS.filter((p) => p.id !== 'beta')).beta).toBe(BETA_PLAN)
    })

    it('names the next tier up the sellable ladder, and none at the top or off it', () => {
        const plans = new PlanCatalogue(API_PLANS)
        expect(plans.nextAfter('free')?.name).toBe('Songwriter')
        expect(plans.nextAfter('pro')?.name).toBe('Studio')
        expect(plans.nextAfter('studio')).toBeUndefined()
        expect(plans.nextAfter('beta')).toBeUndefined()
    })

    it('reads score caps from every API plan, beta included, falling back to the static cap', () => {
        const plans = new PlanCatalogue(API_PLANS)
        expect(plans.maxScoresFor('free')).toBe(3)
        expect(plans.maxScoresFor('beta')).toBe(50)
        expect(plans.maxScoresFor('arranger')).toBe(planById('arranger').maxScores)
    })
})
