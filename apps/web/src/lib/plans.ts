/**
 * Display decoration for the subscription tiers: icons, taglines, display
 * prices, marketing feature lines. The tiers themselves — names and
 * entitlements — live in the database and are served by `GET /plans`;
 * in-app surfaces merge that data with this decoration by id through
 * PlanCatalogue (`usePlanCatalogue` in lib/queries.ts). Only the marketing
 * pages render straight from this static catalogue (they must work without
 * the API), so keep the `dailyRecordingSeconds` fallbacks roughly in sync
 * with the seeded tiers. Copy that quotes a price or budget derives it from
 * here, except prose: pricing/faq.ts and the landing copy (LandingPage,
 * BetaPricing in PricingSection) restate Sketch's and Beta's limits in
 * words — review them whenever those limits change.
 * Prices are display-only; the amounts actually charged come from the Polar
 * products configured on the API. Numerals are the same in USD and EUR
 * (parity pricing — keep the Polar products configured that way too); the
 * display currency only swaps the symbol (lib/currency.ts). The euro numeral
 * is VAT-inclusive and the dollar numeral is tax-exclusive, so the Polar
 * price tax behavior must be `location-based` for the charged total to match
 * what's shown here (see lib/currency.ts).
 */

import type { IconName } from '@mushee/ui'

import type { BillingInterval, PackId, PaidTierId, Plan, TierId } from './api'
import { type Currency, currencySymbol, formatMoney } from './currency'

export interface PlanTier {
    /** Every tier but 'beta', which is assigned rather than picked (see BETA_PLAN). */
    id: Exclude<TierId, 'beta'>
    name: string
    icon: IconName
    tagline: string
    priceMonthly: number
    priceYearly: number
    /** Static fallback for the recording budget; the API value wins in-app. */
    dailyRecordingSeconds: number | null
    /** Static fallback for the score cap (null = no cap); the API value wins in-app. */
    maxScores: number | null
    /** Marketing feature lines, excluding the recording budget and score cap (derived). */
    features: string[]
    popular?: boolean
    /** Professional tiers render as a slim secondary card, not in the main grid. */
    professional?: boolean
}

export const PLAN_TIERS: PlanTier[] = [
    {
        id: 'free',
        name: 'Sketch',
        icon: 'feather',
        tagline: 'For trying things out',
        priceMonthly: 0,
        priceYearly: 0,
        dailyRecordingSeconds: 180,
        maxScores: 5,
        features: ['Live audio-to-notation', 'Full editor & playback'],
    },
    {
        id: 'pro',
        name: 'Songwriter',
        icon: 'sparkles',
        tagline: 'For daily writers',
        priceMonthly: 9,
        priceYearly: 90,
        dailyRecordingSeconds: 1200,
        maxScores: null,
        features: ['Everything in Sketch', 'Early access to new features'],
        popular: true,
    },
    {
        id: 'studio',
        name: 'Studio',
        icon: 'gem',
        tagline: 'For heavy sessions',
        priceMonthly: 19,
        priceYearly: 190,
        dailyRecordingSeconds: 10800,
        maxScores: null,
        features: ['Everything in Songwriter', 'Priority support'],
    },
    {
        id: 'arranger',
        name: 'Arranger',
        icon: 'crown',
        tagline: 'For transcription as a job',
        priceMonthly: 49,
        priceYearly: 490,
        dailyRecordingSeconds: 28800,
        maxScores: null,
        features: ['Everything in Studio', 'Direct support from the maker'],
        professional: true,
    },
]

/**
 * One-time recording-minute packs — display catalogue only; the charged
 * amounts come from the Polar pack products on the API. Deliberately priced
 * well above the subscriptions' per-minute rate: packs serve the
 * once-in-a-while user, and every card says so out loud.
 */
export interface CreditPack {
    id: PackId
    name: string
    minutes: number
    price: number
    blurb: string
    /** The honest subscription comparison shown on the card. */
    compare(this: CreditPack, currency: Currency): string
}

/** Songwriter — the subscription the pack copy measures the packs against. */
export const SONGWRITER = planById('pro')
/** Songwriter's daily budget in minutes (a fixed allowance, never unlimited). */
export const SONGWRITER_DAILY_MINUTES = Math.round((SONGWRITER.dailyRecordingSeconds ?? 0) / 60)

export const CREDIT_PACKS: CreditPack[] = [
    {
        id: 'single',
        name: 'Single',
        minutes: 15,
        price: 6,
        blurb: 'One song, with plenty of retakes.',
        compare(c) {
            const extra = formatMoney(SONGWRITER.priceMonthly - this.price, c)
            return `${SONGWRITER.name} gives you ${SONGWRITER_DAILY_MINUTES} min every day for ${extra} more a month.`
        },
    },
    {
        id: 'ep',
        name: 'EP',
        minutes: 45,
        price: 15,
        blurb: 'A weekend writing session.',
        compare: () => 'Roughly 7 weeks of Songwriter costs the same.',
    },
    {
        id: 'album',
        name: 'Album',
        minutes: 150,
        price: 39,
        blurb: 'A whole project, start to finish.',
        compare: () => 'Four months of Songwriter costs the same.',
    },
]

/** The lowest-priced pack — what the "packs from …" lines quote. */
export const CHEAPEST_PACK = CREDIT_PACKS.reduce((cheapest, pack) => (pack.price < cheapest.price ? pack : cheapest))

/** The closed-beta plan's display data. */
export interface BetaPlan extends Pick<PlanTier, 'name' | 'icon' | 'tagline' | 'dailyRecordingSeconds' | 'maxScores' | 'features'> {
    id: 'beta'
}

/** The closed-beta plan — assigned automatically, never sold. */
export const BETA_PLAN: BetaPlan = {
    id: 'beta',
    name: 'Beta',
    icon: 'sparkles',
    tagline: 'Free while the beta runs',
    dailyRecordingSeconds: 1800,
    maxScores: null,
    features: ['Full editor'],
}

/** Mirrors the API's BETA_MODE switch; set NEXT_PUBLIC_BETA_MODE=true to
 *  enable the closed-beta signup flow in the UI. */
export const BETA_MODE = process.env.NEXT_PUBLIC_BETA_MODE === 'true'

export function planById(id: string | undefined | null): PlanTier {
    return PLAN_TIERS.find((p) => p.id === id) ?? PLAN_TIERS[0]
}

/** Whether a tier is one Polar sells — checkouts and plan changes only ever target these. */
export function isPaidTier(id: TierId): id is PaidTierId {
    return id !== 'free' && id !== 'beta'
}

/** Whether an API plan id names one of the static tiers above — the ones the app can decorate. */
export function isPlanTierId(id: string): id is PlanTier['id'] {
    return PLAN_TIERS.some((p) => p.id === id)
}

/**
 * The tier a pricing card asked for (`?plan=<id>`): carried through signup into
 * onboarding's plan step, or to Settings' plan dialog for a signed-in visitor.
 * Honoured only when it names one of the tiers above.
 */
export function requestedPlanFrom(search: string): PlanTier['id'] | null {
    const plan = new URLSearchParams(search).get('plan')
    return plan && isPlanTierId(plan) ? plan : null
}

/** `path` with `plan=<id>` added to its query (beside a `?next=`), or unchanged without a plan. */
export function withPlan(path: string, plan: PlanTier['id'] | null | undefined): string {
    return plan ? `${path}${path.includes('?') ? '&' : '?'}plan=${plan}` : path
}

/**
 * The tier catalogue as in-app surfaces show it. The database decides which
 * tiers exist, their names and the limits the server enforces; the static
 * entries only decorate them (icons, taglines, display prices) and stand in
 * until `GET /plans` resolves — construct it from `undefined` while loading.
 */
export class PlanCatalogue {
    /** The tiers a picker offers, in the API's order. */
    readonly sellable: PlanTier[]
    /** The closed-beta plan under its database name and limits. */
    readonly beta: BetaPlan
    private readonly apiPlans: Plan[] | undefined

    constructor(apiPlans: Plan[] | undefined) {
        this.apiPlans = apiPlans
        this.sellable = apiPlans
            ? apiPlans.flatMap((p) =>
                  p.sellable && isPlanTierId(p.id)
                      ? [
                            {
                                ...planById(p.id),
                                id: p.id,
                                name: p.name,
                                dailyRecordingSeconds: p.dailyRecordingCredits,
                                maxScores: p.maxScores,
                            },
                        ]
                      : [],
              )
            : PLAN_TIERS
        const betaApiPlan = apiPlans?.find((p) => p.id === BETA_PLAN.id)
        this.beta = betaApiPlan
            ? {
                  ...BETA_PLAN,
                  name: betaApiPlan.name,
                  dailyRecordingSeconds: betaApiPlan.dailyRecordingCredits,
                  maxScores: betaApiPlan.maxScores,
              }
            : BETA_PLAN
    }

    /** A sellable tier by id. */
    byId(id: string): PlanTier | undefined {
        return this.sellable.find((p) => p.id === id)
    }

    /** The next tier up the ladder — what a limit dialog offers as the upgrade.
     *  Undefined at the top, and for tiers off the ladder (beta). */
    nextAfter(id: string): PlanTier | undefined {
        const index = this.sellable.findIndex((p) => p.id === id)
        return index >= 0 ? this.sellable[index + 1] : undefined
    }

    /**
     * The score cap of any tier, beta and other unsold tiers included (null = no cap). The
     * API's answer wins, its null included; without one the static cap stands in.
     */
    maxScoresFor(id: string): number | null {
        if (id === BETA_PLAN.id) return this.beta.maxScores
        const apiPlan = this.apiPlans?.find((p) => p.id === id)
        return apiPlan ? apiPlan.maxScores : planById(id).maxScores
    }
}

/** Human line for a daily recording budget in seconds; null = unlimited. */
export function recordingBudgetLabel(seconds: number | null): string {
    if (seconds === null) return 'Unlimited recording'
    if (seconds < 60) return `${seconds} sec of recording / day`
    if (seconds < 3600) return `${Math.round(seconds / 60)} min of recording / day`
    const hours = seconds / 3600
    return `${Number.isInteger(hours) ? hours : hours.toFixed(1)} h of recording / day`
}

/** Human line for a score cap; null = no cap. */
function scoreLimitLabel(maxScores: number | null): string {
    if (maxScores === null) return 'As many scores as you like'
    return `Up to ${maxScores} scores`
}

/**
 * The full feature list for a plan card: the recording budget and score cap
 * first, then the marketing lines. In-app, pass a plan already merged with
 * the API's limits (PlanCatalogue) so the shown limits are the ones the
 * server actually enforces.
 */
export function planFeatures(plan: Pick<PlanTier, 'dailyRecordingSeconds' | 'maxScores' | 'features'>): string[] {
    return [recordingBudgetLabel(plan.dailyRecordingSeconds), scoreLimitLabel(plan.maxScores), ...plan.features]
}

/** A plan's price as one line ("$9/mo", "$7.50/mo · billed yearly", "Free"). */
export function planPrice(plan: PlanTier, billing: BillingInterval, currency: Currency = 'usd'): string {
    const { amount } = planPriceParts(plan, billing, currency)
    if (plan.priceMonthly === 0) return amount
    return billing === 'yearly' ? `${amount}/mo · billed yearly` : `${amount}/mo`
}

/**
 * A plan's price broken into the lines a selectable card renders. Paid plans
 * get the same three lines in both cadences — amount, billing note, savings —
 * so cards keep their height when the monthly/yearly toggle flips.
 */
export interface PlanPriceParts {
    amount: string
    cadence: string
    /** Billing-cadence detail line; empty for free plans. */
    note: string
    /** What a year of the plan saves over twelve monthly payments. */
    savings: number
}

export function planPriceParts(plan: PlanTier, billing: BillingInterval, currency: Currency = 'usd'): PlanPriceParts {
    if (plan.priceMonthly === 0) return { amount: 'Free', cadence: 'forever', note: '', savings: 0 }
    const savings = plan.priceMonthly * 12 - plan.priceYearly
    if (billing === 'yearly') {
        const m = (plan.priceYearly / 12).toFixed(plan.priceYearly % 12 === 0 ? 0 : 2)
        return {
            amount: `${currencySymbol(currency)}${m}`,
            cadence: '/month',
            note: `billed yearly · ${formatMoney(plan.priceYearly, currency)}/yr`,
            savings,
        }
    }
    return { amount: formatMoney(plan.priceMonthly, currency), cadence: '/month', note: 'billed monthly', savings }
}
