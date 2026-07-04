/**
 * The plan catalogue — single source of truth for every place that shows
 * tiers (landing pricing, onboarding, settings). Mirrors the API's
 * SubscriptionTier (apps/api/src/subscriptions/SubscriptionTier.ts) — keep
 * the two in sync. Prices are display-only; the amounts actually charged
 * come from the Polar products configured on the API.
 */

export interface PlanTier {
    id: 'free' | 'pro' | 'studio'
    name: string
    icon: string
    tagline: string
    priceMonthly: number
    priceYearly: number
    features: string[]
    popular?: boolean
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
        features: ['30 sec of recording / day', 'Unlimited scores', 'Live audio-to-notation', 'Full editor'],
    },
    {
        id: 'pro',
        name: 'Composer',
        icon: 'sparkles',
        tagline: 'For daily writers',
        priceMonthly: 8,
        priceYearly: 80,
        features: ['10 min of recording / day', 'Everything in Sketch', 'Priority transcription', 'Early access to new features'],
        popular: true,
    },
    {
        id: 'studio',
        name: 'Studio',
        icon: 'gem',
        tagline: 'For heavy sessions',
        priceMonthly: 18,
        priceYearly: 180,
        features: ['Unlimited recording', 'Everything in Composer', 'Priority support'],
    },
]

/** The closed-beta plan — assigned automatically, never sold. */
export const BETA_PLAN = {
    id: 'beta' as const,
    name: 'Beta',
    icon: 'sparkles',
    tagline: 'Free while the beta runs',
    features: ['5 min of recording / day', 'Full editor', 'Direct line to the makers'],
}

/** Mirrors the API's BETA_MODE switch; set NEXT_PUBLIC_BETA_MODE=true to
 *  enable the closed-beta signup flow in the UI. */
export const BETA_MODE = process.env.NEXT_PUBLIC_BETA_MODE === 'true'

export function planById(id: string | undefined | null): PlanTier {
    return PLAN_TIERS.find((p) => p.id === id) ?? PLAN_TIERS[0]
}

export function planPrice(plan: PlanTier, billing: Billing): string {
    if (plan.priceMonthly === 0) return 'Free'
    if (billing === 'yearly') {
        const m = (plan.priceYearly / 12).toFixed(plan.priceYearly % 12 === 0 ? 0 : 2)
        return `$${m}/mo · billed yearly`
    }
    return `$${plan.priceMonthly}/mo`
}
