import type { BillingState } from '@/lib/api'
import { type Currency, formatMoney } from '@/lib/currency'
import { formatLongDate } from '@/lib/dates'
import type { PlanTier } from '@/lib/plans'
import { formatAllowance, formatAllowanceShort, formatResetWhen } from '@/lib/recordingTime'

/** Where the account's day of recording stands, as the plan card's meter shows it. */
export interface RecordingMeter {
    /** How much of today's allowance is used, 0–100. */
    readonly percent: number
    /** Time left in words: "2 min 36 sec left of 3 min" — also the progressbar's spoken value. */
    readonly value: string
    /** When it refills, in the viewer's clock: "Refills tonight at 8:00 PM." */
    readonly helper: string
}

/** The viewer's clock, overridable so tests can pin a moment, locale and time zone. */
export interface PlanCardClock {
    readonly now?: Date
    readonly locale?: string
    readonly timeZone?: string
}

/**
 * The words on Settings' plan card for one account, in plain units: allowances as words,
 * never a clock ("2 min 36 sec left of 3 min", not "2:36 / 3:00"), reset times in the
 * viewer's own time, and no payment-provider name. `plan` is the account's tier merged
 * with the API catalogue (prices and limits); `maxScores` its score cap (null = none).
 */
export class PlanCardCopy {
    constructor(
        private readonly billing: BillingState,
        private readonly plan: PlanTier,
        private readonly maxScores: number | null,
        private readonly currency: Currency,
        private readonly clock: PlanCardClock = {},
    ) {}

    private get isBeta(): boolean {
        return this.billing.tierId === 'beta'
    }

    private get hasSubscription(): boolean {
        return Boolean(this.billing.status)
    }

    /** Today's allowance in seconds as the server enforces it (null = no daily limit). */
    private get dailySeconds(): number | null {
        return this.billing.credits.limitSeconds
    }

    /** The line under the card's heading: what the plan gives, or which plan it is. */
    get subtitle(): string {
        if (this.isBeta) return 'Solkey is in closed beta — your plan is on the house. Paid plans arrive at launch.'
        if (this.plan.priceMonthly > 0 || this.hasSubscription) return `You're on ${this.billing.tierName}.`
        const budget = this.dailySeconds === null ? 'no daily recording limit' : `${formatAllowance(this.dailySeconds)} of recording a day`
        return this.maxScores === null ? `Free — ${budget}.` : `Free — ${budget} and up to ${this.maxScores} scores.`
    }

    /**
     * The price line under the plan's name: "$9 a month · renews 22 November 2026" (a year, or
     * "· ends …" once cancelled), "Free" on Sketch, and "Included with your account" for a
     * paid tier the account holds without paying for it.
     */
    get priceLine(): string {
        if (this.isBeta) return 'Free during the beta'
        if (this.hasSubscription) {
            const yearly = this.billing.interval === 'yearly'
            const price = `${formatMoney(yearly ? this.plan.priceYearly : this.plan.priceMonthly, this.currency)} ${yearly ? 'a year' : 'a month'}`
            const end = this.billing.currentPeriodEnd ? formatLongDate(this.billing.currentPeriodEnd) : null
            if (!end) return price
            return `${price} · ${this.billing.cancelAtPeriodEnd ? 'ends' : 'renews'} ${end}`
        }
        return this.plan.priceMonthly === 0 ? 'Free' : 'Included with your account'
    }

    /** Today's recording as a meter, or null when the plan has no daily limit (see noLimitLine). */
    get meter(): RecordingMeter | null {
        const limit = this.dailySeconds
        if (limit === null) return null
        const used = this.billing.credits.usedSeconds
        const left = Math.max(0, limit - used)
        const when = formatResetWhen(this.billing.credits.resetsAt, this.clock.now, this.clock.locale, this.clock.timeZone)
        return {
            percent: limit > 0 ? Math.min(100, (used / limit) * 100) : 100,
            value: `${formatAllowanceShort(left)} left of ${formatAllowanceShort(limit)}`,
            helper: left > 0 ? `Refills ${when}.` : `All used today — refills ${when}.`,
        }
    }

    /** The readout for a plan without a daily limit, which is never called "unlimited". */
    get noLimitLine(): string {
        return `No daily recording limit — ${formatAllowanceShort(this.billing.credits.usedSeconds)} recorded today.`
    }

    /** Purchased pack minutes waiting behind today's allowance, or null when there are none. */
    get packLine(): string | null {
        const { packSeconds } = this.billing.credits
        if (packSeconds <= 0) return null
        return `${formatAllowanceShort(packSeconds)} from packs — used once today's minutes run out, and they never expire.`
    }

    /** How many of a capped plan's scores are in use ("Scores: 3 of 5"), or null without a cap. */
    scoresLine(count: number): string | null {
        return this.maxScores === null ? null : `Scores: ${count} of ${this.maxScores}`
    }
}
