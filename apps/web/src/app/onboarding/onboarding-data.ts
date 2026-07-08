import { type Billing, type PlanTier } from '@/lib/plans'

export const BACKGROUNDS: [string, string, string][] = [
    ['curious', 'Just curious', 'I tinker with melodies sometimes.'],
    ['hobbyist', 'Hobbyist', 'I play for myself — a few years in.'],
    ['student', 'Student', 'Studying music formally right now.'],
    ['teacher', 'Teacher', 'I teach others to play or compose.'],
    ['composer', 'Composer / arranger', 'I write or arrange music regularly.'],
    ['professional', 'Performing musician', 'I gig, record, or perform for a living.'],
]

export const PRIMARY_INSTRUMENTS = [
    'Piano',
    'Guitar',
    'Violin',
    'Cello',
    'Flute',
    'Clarinet',
    'Voice',
    'Trumpet',
    'Drums',
    'Bass',
    'Other',
    "I don't play (yet)",
]

export const REFERRAL_SOURCES: [string, string][] = [
    ['friend', 'A friend told me'],
    ['search', 'Found it on a search engine'],
    ['social', 'Saw it on social media'],
    ['youtube', 'Saw it on YouTube'],
    ['teacher', 'My teacher recommended it'],
    ['blog', 'Read about it in an article'],
    ['other', 'Somewhere else'],
]

export function formatPrice(plan: PlanTier, billing: Billing): { amount: string; cadence: string } {
    if (plan.priceMonthly === 0) return { amount: 'Free', cadence: 'forever' }
    if (billing === 'yearly') {
        const monthlyEquiv = (plan.priceYearly / 12).toFixed(plan.priceYearly % 12 === 0 ? 0 : 2)
        return { amount: `$${monthlyEquiv}`, cadence: '/month, billed yearly' }
    }
    return { amount: `$${plan.priceMonthly}`, cadence: '/month' }
}

// Steps in order: verify email, mic permission, name, background, instruments, source, tier.
export const STEP_COUNT = 7
