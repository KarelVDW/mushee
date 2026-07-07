/**
 * Display decoration for the subscription tiers: icons, taglines, display
 * prices, marketing feature lines. The tiers themselves — names and
 * entitlements — live in the database and are served by `GET /plans`
 * (see `usePlans` in lib/queries.ts); in-app surfaces merge that data with
 * this decoration by id. Only the marketing landing page renders straight
 * from this static catalogue (it must work without the API), so keep the
 * `dailyRecordingSeconds` fallbacks roughly in sync with the seeded tiers.
 * Prices are display-only; the amounts actually charged come from the Polar
 * products configured on the API.
 */

export interface PlanTier {
    id: 'free' | 'pro' | 'studio'
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
        dailyRecordingSeconds: 30,
        features: ['Unlimited scores', 'Live audio-to-notation', 'Full editor'],
    },
    {
        id: 'pro',
        name: 'Composer',
        icon: 'sparkles',
        tagline: 'For daily writers',
        priceMonthly: 8,
        priceYearly: 80,
        dailyRecordingSeconds: 600,
        features: ['Everything in Sketch', 'Priority transcription', 'Early access to new features'],
        popular: true,
    },
    {
        id: 'studio',
        name: 'Studio',
        icon: 'gem',
        tagline: 'For heavy sessions',
        priceMonthly: 18,
        priceYearly: 180,
        dailyRecordingSeconds: null,
        features: ['Everything in Composer', 'Priority support'],
    },
]

/** The closed-beta plan — assigned automatically, never sold. */
export const BETA_PLAN = {
    id: 'beta' as const,
    name: 'Beta',
    icon: 'sparkles',
    tagline: 'Free while the beta runs',
    dailyRecordingSeconds: 300,
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
    return `${Math.round(seconds / 60)} min of recording / day`
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

export function planPrice(plan: PlanTier, billing: Billing): string {
    if (plan.priceMonthly === 0) return 'Free'
    if (billing === 'yearly') {
        const m = (plan.priceYearly / 12).toFixed(plan.priceYearly % 12 === 0 ? 0 : 2)
        return `$${m}/mo · billed yearly`
    }
    return `$${plan.priceMonthly}/mo`
}
