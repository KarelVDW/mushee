import { describe, expect, it } from 'vitest'

import { PlanCardCopy } from '@/app/settings/PlanCardCopy'
import type { BillingState } from '@/lib/api'
import { formatLongDate } from '@/lib/dates'
import { planById } from '@/lib/plans'

const SKETCH: BillingState = {
    tierId: 'free',
    tierName: 'Sketch',
    status: null,
    interval: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    billingConfigured: true,
    betaMode: false,
    credits: { limitSeconds: 180, usedSeconds: 24, remainingSeconds: 156, packSeconds: 0 },
}

const SONGWRITER: BillingState = {
    ...SKETCH,
    tierId: 'pro',
    tierName: 'Songwriter',
    status: 'active',
    interval: 'monthly',
    currentPeriodEnd: '2026-11-22T12:00:00.000Z',
    credits: { limitSeconds: 1200, usedSeconds: 0, remainingSeconds: 1200, packSeconds: 0 },
}

// Midday UTC on 22 October: midnight UTC falls at 8 PM the same evening in New York.
const NEW_YORK = { now: new Date('2026-10-22T12:00:00.000Z'), locale: 'en-US', timeZone: 'America/New_York' }
// …and at 02:00 the next morning in Brussels (still on summer time).
const BRUSSELS = { now: new Date('2026-10-22T12:00:00.000Z'), locale: 'nl-BE', timeZone: 'Europe/Brussels' }

const copyFor = (billing: BillingState, maxScores: number | null = null, clock = NEW_YORK) =>
    new PlanCardCopy(billing, planById(billing.tierId), maxScores, 'usd', clock)

describe('PlanCardCopy', () => {
    it('describes Sketch by what it gives, in words', () => {
        expect(copyFor(SKETCH, 5).subtitle).toBe('Free — 3 minutes of recording a day and up to 5 scores.')
        expect(copyFor(SKETCH, null).subtitle).toBe('Free — 3 minutes of recording a day.')
        expect(copyFor(SKETCH).priceLine).toBe('Free')
    })

    it('names a paid plan without the payment provider', () => {
        expect(copyFor(SONGWRITER).subtitle).toBe("You're on Songwriter.")
        expect(copyFor(SONGWRITER).subtitle).not.toMatch(/polar/i)
    })

    it('prices a subscription by its cadence, with its renewal or end date', () => {
        const date = formatLongDate('2026-11-22T12:00:00.000Z')
        expect(copyFor(SONGWRITER).priceLine).toBe(`$9 a month · renews ${date}`)
        expect(copyFor({ ...SONGWRITER, interval: 'yearly' }).priceLine).toBe(`$90 a year · renews ${date}`)
        expect(copyFor({ ...SONGWRITER, cancelAtPeriodEnd: true }).priceLine).toBe(`$9 a month · ends ${date}`)
        expect(copyFor({ ...SONGWRITER, currentPeriodEnd: null }).priceLine).toBe('$9 a month')
    })

    it('says a paid tier held without a subscription is included, never "Free"', () => {
        const studio: BillingState = { ...SKETCH, tierId: 'studio', tierName: 'Studio' }
        expect(copyFor(studio).priceLine).toBe('Included with your account')
        expect(copyFor(studio).subtitle).toBe("You're on Studio.")
    })

    it('keeps the beta lines', () => {
        const beta: BillingState = { ...SKETCH, tierId: 'beta', tierName: 'Beta' }
        expect(copyFor(beta).priceLine).toBe('Free during the beta')
        expect(copyFor(beta).subtitle).toMatch(/closed beta/)
    })

    it('meters time left in words, never as a clock', () => {
        const meter = copyFor(SKETCH).meter
        expect(meter?.value).toBe('2 min 36 sec left of 3 min')
        expect(meter?.percent).toBeCloseTo(13.33, 1)
        const studio = copyFor({ ...SKETCH, credits: { ...SKETCH.credits, limitSeconds: 10800, usedSeconds: 24 } }).meter
        expect(studio?.value).toBe('2 h 59 min left of 3 h')
    })

    it("says when today's minutes refill, in the viewer's own clock", () => {
        expect(copyFor(SKETCH).meter?.helper).toBe('Refills tonight at 8:00 PM.')
        expect(copyFor(SKETCH, null, BRUSSELS).meter?.helper).toBe('Refills tomorrow at 02:00.')
    })

    it('says when all of today is used, and caps the meter', () => {
        const meter = copyFor({ ...SKETCH, credits: { ...SKETCH.credits, usedSeconds: 200, remainingSeconds: 0 } }).meter
        expect(meter?.percent).toBe(100)
        expect(meter?.value).toBe('0 sec left of 3 min')
        expect(meter?.helper).toBe('All used today — refills tonight at 8:00 PM.')
        expect(copyFor({ ...SKETCH, credits: { ...SKETCH.credits, limitSeconds: 0, usedSeconds: 0 } }).meter?.percent).toBe(100)
    })

    it('has no meter without a daily limit, and never says "unlimited"', () => {
        const copy = copyFor({ ...SONGWRITER, credits: { ...SONGWRITER.credits, limitSeconds: null, usedSeconds: 24 } })
        expect(copy.meter).toBeNull()
        expect(copy.noLimitLine).toBe('No daily recording limit — 24 sec recorded today.')
        expect(copy.noLimitLine).not.toMatch(/unlimited/i)
    })

    it('counts pack minutes in words', () => {
        expect(copyFor(SKETCH).packLine).toBeNull()
        expect(copyFor({ ...SKETCH, credits: { ...SKETCH.credits, packSeconds: 900 } }).packLine).toBe(
            "15 min from packs — used once today's minutes run out, and they never expire.",
        )
    })

    it('counts scores against a cap only', () => {
        expect(copyFor(SKETCH, 5).scoresLine(3)).toBe('Scores: 3 of 5')
        expect(copyFor(SONGWRITER, null).scoresLine(12)).toBeNull()
    })
})
