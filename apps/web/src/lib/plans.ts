/**
 * Display decoration for the subscription tiers: icons, taglines, display
 * prices, marketing feature lines. The tiers themselves — names and
 * entitlements — live in the database and are served by `GET /plans`
 * (see `usePlans` in lib/queries.ts); in-app surfaces merge that data with
 * this decoration by id. Only the marketing landing page renders straight
 * from this static catalogue (it must work without the API), so keep the
 * `dailyRecordingSeconds` fallbacks roughly in sync with the seeded tiers.
 * Prices are display-only; the amounts actually charged come from the Polar
 * products configured on the API. Numerals are the same in USD and EUR
 * (parity pricing — keep the Polar products configured that way too); the
 * display currency only swaps the symbol (lib/currency.ts).
 */

import { type Currency, currencySymbol, formatMoney } from './currency'

export interface PlanTier {
    id: 'free' | 'pro' | 'studio' | 'arranger'
    name: string
    icon: string
    tagline: string
    priceMonthly: number
    priceYearly: number
    /** Static fallback for the recording budget; the API value wins in-app. */
    dailyRecordingSeconds: number | null
    /** Marketing feature lines, excluding the recording budget (derived). */
    features: string[]
    popular?: boolean
    /** Professional tiers render as a slim secondary card, not in the main grid. */
    professional?: boolean
}

export type Billing = 'monthly' | 'yearly'

export const PLAN_TIERS: PlanTier[] = [
    {
        id: 'free',
        name: 'Sketch',
        icon: 'feather',
        tagline: 'For trying things out',
        priceMonthly: 0,
        priceYearly: 0,
        dailyRecordingSeconds: 180,
        features: ['Unlimited scores', 'Live audio-to-notation', 'Full editor & playback'],
    },
    {
        id: 'pro',
        name: 'Songwriter',
        icon: 'sparkles',
        tagline: 'For daily writers',
        priceMonthly: 9,
        priceYearly: 90,
        dailyRecordingSeconds: 1200,
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
    id: 'single' | 'ep' | 'album'
    name: string
    minutes: number
    price: number
    blurb: string
    /** The honest subscription comparison shown on the card. */
    compare: (currency: Currency) => string
}

export const CREDIT_PACKS: CreditPack[] = [
    {
        id: 'single',
        name: 'Single',
        minutes: 15,
        price: 6,
        blurb: 'One song, with plenty of retakes.',
        compare: (c) => `Songwriter gives you 20 min every day for ${formatMoney(3, c)} more a month.`,
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

/** The closed-beta plan — assigned automatically, never sold. */
export const BETA_PLAN = {
    id: 'beta' as const,
    name: 'Beta',
    icon: 'sparkles',
    tagline: 'Free while the beta runs',
    dailyRecordingSeconds: 1800,
    features: ['Full editor', 'Direct line to the makers'],
}

/** Mirrors the API's BETA_MODE switch; set NEXT_PUBLIC_BETA_MODE=true to
 *  enable the closed-beta signup flow in the UI. */
export const BETA_MODE = process.env.NEXT_PUBLIC_BETA_MODE === 'true'

export function planById(id: string | undefined | null): PlanTier {
    return PLAN_TIERS.find((p) => p.id === id) ?? PLAN_TIERS[0]
}

/** Human line for a daily recording budget in seconds; null = unlimited. */
export function recordingBudgetLabel(seconds: number | null): string {
    if (seconds === null) return 'Unlimited recording'
    if (seconds < 60) return `${seconds} sec of recording / day`
    if (seconds < 3600) return `${Math.round(seconds / 60)} min of recording / day`
    const hours = seconds / 3600
    return `${Number.isInteger(hours) ? hours : hours.toFixed(1)} h of recording / day`
}

/**
 * The full feature list for a plan card: the recording budget first, then the
 * marketing lines. Pass the API's `dailyRecordingCredits` when available so
 * the shown budget is the one the server actually enforces.
 */
export function planFeatures(
    plan: Pick<PlanTier, 'dailyRecordingSeconds' | 'features'>,
    dailyRecordingSeconds: number | null = plan.dailyRecordingSeconds,
): string[] {
    return [recordingBudgetLabel(dailyRecordingSeconds), ...plan.features]
}

export function planPrice(plan: PlanTier, billing: Billing, currency: Currency = 'usd'): string {
    if (plan.priceMonthly === 0) return 'Free'
    if (billing === 'yearly') {
        const m = (plan.priceYearly / 12).toFixed(plan.priceYearly % 12 === 0 ? 0 : 2)
        return `${currencySymbol(currency)}${m}/mo · billed yearly`
    }
    return `${formatMoney(plan.priceMonthly, currency)}/mo`
}
