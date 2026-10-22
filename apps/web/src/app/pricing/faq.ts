import { BETA_MODE } from '@/lib/plans'

/**
 * Pricing questions and their answers — rendered on /pricing and emitted as
 * FAQPage structured data by the same route, so the two never drift. Keep every
 * answer true to what the API enforces (credits, packs, cancellation, tax).
 */
interface PricingQuestion {
    question: string
    answer: string
    /**
     * About plans, packs or payment, none of which are on sale during the closed
     * beta: left out while it runs, like the tier ladder and its prices.
     */
    launchOnly?: boolean
}

const PRICING_FAQ: readonly PricingQuestion[] = [
    {
        question: 'What counts as recording time?',
        answer: 'Only a running take: from the moment you press record until you stop. Editing, playback, importing and exporting are free on every plan, without limits. Your daily budget resets at midnight UTC.',
    },
    {
        question: 'What happens when I reach my daily limit?',
        answer: 'Recording pauses until the budget resets the next day — the editor, playback and exports keep working. Banked minutes from a one-time pack are used automatically once the daily budget runs out.',
    },
    {
        question: 'Do minute packs expire?',
        answer: 'Never. Pack minutes sit in your account until you use them, and they are only spent after your daily budget is used up, so a subscription always comes first.',
        launchOnly: true,
    },
    {
        question: 'Can I cancel any time?',
        answer: 'Yes. Cancel from Settings and your plan stays active until the end of the period you paid for, then drops to Sketch. Every score you made stays in your library; Sketch only caps new scores at five.',
        launchOnly: true,
    },
    {
        question: 'Can I switch plans?',
        answer: 'Any time, from Settings. Upgrades take effect immediately and the price difference is prorated; the new daily budget applies right away.',
        launchOnly: true,
    },
    {
        question: 'Do the prices include tax?',
        answer: 'Euro prices include VAT — the amount shown is the total you pay. Dollar prices are shown before local sales tax, which is added at checkout where it applies.',
        launchOnly: true,
    },
    {
        question: 'How are payments handled?',
        answer: 'Checkout, invoices and card details are handled by Polar, our merchant of record. Solkey never sees or stores your payment details.',
        launchOnly: true,
    },
    {
        question: 'Is there a free plan?',
        answer: 'Sketch is free forever: three minutes of recording a day, up to five scores, and the complete editor with live audio-to-notation and playback. No card needed.',
        launchOnly: true,
    },
]

/** The questions this build shows: the one list both the page and its structured data read. */
export const PRICING_FAQ_SHOWN: readonly PricingQuestion[] = BETA_MODE ? PRICING_FAQ.filter((item) => !item.launchOnly) : PRICING_FAQ
