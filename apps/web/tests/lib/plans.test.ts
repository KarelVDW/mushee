import { describe, expect, it } from 'vitest'

import type { Plan } from '@/lib/api'
import {
    BETA_PLAN,
    CHEAPEST_PACK,
    CREDIT_PACKS,
    dailyMinutes,
    isPaidTier,
    isPlanTierId,
    PLAN_TIERS,
    planBudgetHint,
    planById,
    PlanCatalogue,
    planCtaLabel,
    planFeatures,
    planPrice,
    recordingBudgetLabel,
    requestedPlanFrom,
    withPlan,
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

    it('writes recording budgets as allowances in words, and no cap without the word unlimited', () => {
        expect(recordingBudgetLabel(180)).toBe('3 minutes of recording a day')
        expect(recordingBudgetLabel(30)).toBe('30 seconds of recording a day')
        expect(recordingBudgetLabel(600)).toBe('10 minutes of recording a day')
        expect(recordingBudgetLabel(1800)).toBe('30 minutes of recording a day')
        expect(recordingBudgetLabel(3600)).toBe('1 hour of recording a day')
        expect(recordingBudgetLabel(10800)).toBe('3 hours of recording a day')
        expect(recordingBudgetLabel(28800)).toBe('8 hours of recording a day')
        expect(recordingBudgetLabel(5400)).toBe('1 h 30 min of recording a day')
        expect(recordingBudgetLabel(null)).toBe('No daily recording limit')
    })

    it('words every tier in plain language, never the retired jargon', () => {
        const copy = [
            ...PLAN_TIERS.flatMap((p) => [p.tagline, ...planFeatures(p), planCtaLabel(p), planBudgetHint(p) ?? '']),
            ...planFeatures(BETA_PLAN),
            recordingBudgetLabel(null),
            ...CREDIT_PACKS.flatMap((p) => [p.name, p.blurb, p.compare('usd'), p.compare('eur')]),
        ]
        // 'recording', never 'take' (C12 glossary) — a retake included.
        for (const line of copy)
            expect(line).not.toMatch(/unlimited|audio-to-notation|engraving|keyboard-first|tier|cadence|budget|prorat|\btakes?\b|retake/i)
        expect(planFeatures(planById('free'))).toEqual([
            '3 minutes of recording a day',
            'Up to 5 scores',
            'Sing or play, see the notes',
            'Fix notes and hear them back',
        ])
        expect(PLAN_TIERS.map((p) => p.tagline)).toEqual([
            'For trying things out',
            'For daily writers',
            'For heavy sessions',
            'For transcribing every day',
        ])
    })

    it('pictures the free budget in 30-second recordings, on the free tier only', () => {
        expect(planBudgetHint(planById('free'))).toBe('Enough for about six 30-second recordings.')
        // Derived from the budget the API serves, so a re-tuned free tier stays truthful.
        expect(planBudgetHint({ id: 'free', dailyRecordingSeconds: 300 })).toBe('Enough for about ten 30-second recordings.')
        // Past ten the numeral would sit beside the 30, so the length moves behind it.
        expect(planBudgetHint({ id: 'free', dailyRecordingSeconds: 600 })).toBe('Enough for about 20 recordings of 30 seconds.')
        expect(planBudgetHint({ id: 'free', dailyRecordingSeconds: 45 })).toBe('Enough for about one 30-second recording.')
        expect(planBudgetHint({ id: 'free', dailyRecordingSeconds: 20 })).toBeNull()
        expect(planBudgetHint({ id: 'free', dailyRecordingSeconds: null })).toBeNull()
        for (const paid of PLAN_TIERS.filter((p) => p.id !== 'free')) expect(planBudgetHint(paid)).toBeNull()
    })

    it("labels a card's button 'Start free' for the free tier and 'Choose …' for a paid one", () => {
        expect(planCtaLabel(planById('free'))).toBe('Start free')
        expect(planCtaLabel(planById('pro'))).toBe('Choose Songwriter')
        expect(planCtaLabel(planById('studio'))).toBe('Choose Studio')
        expect(planCtaLabel(planById('arranger'))).toBe('Choose Arranger')
        // In-app, the database name wins.
        expect(planCtaLabel({ ...planById('pro'), name: 'Writer' })).toBe('Choose Writer')
    })

    it('formats score caps, with the free tier capped and the rest open', () => {
        expect(planFeatures({ dailyRecordingSeconds: null, maxScores: 5, features: [] })[1]).toBe('Up to 5 scores')
        expect(planFeatures({ dailyRecordingSeconds: null, maxScores: null, features: [] })[1]).toBe('As many scores as you like')
        expect(planById('free').maxScores).toBe(5)
        expect(PLAN_TIERS.filter((p) => p.id !== 'free').every((p) => p.maxScores === null)).toBe(true)
    })

    it('puts the recording budget and score cap first in the feature list, API values winning', () => {
        const pro = planById('pro')
        expect(planFeatures(pro)[0]).toBe('20 minutes of recording a day')
        expect(planFeatures(pro)[1]).toBe('As many scores as you like')
        expect(planFeatures(planById('free'))[1]).toBe('Up to 5 scores')
        // A plan merged with re-tuned database entitlements shows those, not the static fallbacks.
        const merged = { ...pro, dailyRecordingSeconds: 600, maxScores: 20 }
        expect(planFeatures(merged)[0]).toBe('10 minutes of recording a day')
        expect(planFeatures(merged)[1]).toBe('Up to 20 scores')
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

    it('quotes the cheapest pack and compares the single pack against Songwriter from the catalogue', () => {
        expect(CHEAPEST_PACK.id).toBe('single')
        expect(CREDIT_PACKS[0].compare('usd')).toBe('Songwriter gives you 20 min every day for $3 more a month.')
        expect(CREDIT_PACKS[0].compare('eur')).toBe('Songwriter gives you 20 min every day for €3 more a month.')
    })

    it("compares packs against the Songwriter it is handed — in-app, the database's name and budget", () => {
        const songwriter = { ...planById('pro'), name: 'Writer', dailyRecordingSeconds: 1500 }
        expect(CREDIT_PACKS[0].compare('usd', songwriter)).toBe('Writer gives you 25 min every day for $3 more a month.')
        expect(CREDIT_PACKS[1].compare('usd', songwriter)).toBe('Roughly 7 weeks of Writer costs the same.')
        expect(dailyMinutes(songwriter)).toBe(25)
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

describe('the ?plan= a pricing card carries', () => {
    it('is read back only when it names a static tier', () => {
        expect(requestedPlanFrom('?plan=studio')).toBe('studio')
        expect(requestedPlanFrom('?next=%2Fs%2Fabc&plan=free')).toBe('free')
        expect(requestedPlanFrom('')).toBeNull()
        expect(requestedPlanFrom('?plan=beta')).toBeNull()
        expect(requestedPlanFrom('?plan=%2F%2Fevil.example')).toBeNull()
    })

    it('joins whatever query the path already has', () => {
        expect(withPlan('/signup', 'pro')).toBe('/signup?plan=pro')
        expect(withPlan('/signup?next=%2Fs%2Fabc', 'pro')).toBe('/signup?next=%2Fs%2Fabc&plan=pro')
        expect(withPlan('/signup', null)).toBe('/signup')
        expect(withPlan('/signup', undefined)).toBe('/signup')
        expect(requestedPlanFrom(withPlan('/onboarding?next=%2Fscores%2F1', 'arranger').slice('/onboarding'.length))).toBe('arranger')
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

    it('serves Songwriter merged with the database, or the static entry when the API lacks it', () => {
        expect(new PlanCatalogue(API_PLANS).songwriter).toMatchObject({ id: 'pro', dailyRecordingSeconds: 1500 })
        expect(new PlanCatalogue(undefined).songwriter).toBe(planById('pro'))
        expect(new PlanCatalogue(API_PLANS.filter((p) => p.id !== 'pro')).songwriter).toBe(planById('pro'))
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

    it("keeps an API 'no cap' (null) over the static cap, and beta uncapped until the API answers", () => {
        const uncapped = new PlanCatalogue(API_PLANS.map((p) => (p.id === 'free' ? { ...p, maxScores: null } : p)))
        expect(uncapped.maxScoresFor('free')).toBeNull()
        expect(new PlanCatalogue(undefined).maxScoresFor('beta')).toBe(BETA_PLAN.maxScores)
        expect(new PlanCatalogue(API_PLANS.filter((p) => p.id !== 'beta')).maxScoresFor('beta')).toBeNull()
    })
})
