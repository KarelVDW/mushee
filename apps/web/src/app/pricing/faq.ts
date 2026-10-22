import { BETA_MODE } from '@/lib/plans'

/**
 * The site's questions and answers — product questions (what Solkey can hear, whether it needs
 * music reading, phones) and pricing questions (plans, packs, payment). Each page renders its
 * list with FaqList and emits the same list as FAQPage structured data, so the two never
 * drift. Every answer must stay true to what the product does and the API enforces (what
 * Solkey writes, credits, packs, cancellation, tax).
 */
export interface FaqItem {
    question: string
    answer: string
    /**
     * About plans, packs or payment, none of which are on sale during the closed
     * beta: left out while it runs, like the tier ladder and its prices.
     */
    launchOnly?: boolean
    /** The closed-beta version of a launch answer: shown only while the beta runs. */
    betaOnly?: boolean
}

/** First on every page, beta included: the one FAQ answer about how Solkey hears. */
const CHORDS: FaqItem = {
    question: 'Can Solkey write chords?',
    answer: "Solkey writes melodies, one note at a time. Sing, hum or whistle, or play the tune on any instrument. On piano or guitar, play the melody line on its own: notes played together won't come out as a chord.",
}

/** The landing page's "Good to know": what a newcomer asks before trying Solkey. */
const LANDING_FAQ: readonly FaqItem[] = [
    CHORDS,
    {
        question: 'Do I need to read music?',
        answer: 'No. Sing or play, and Solkey writes the notes for you. You can fix them by tapping, and hear them played back to check.',
    },
    {
        question: 'Does it work on my phone?',
        answer: "Yes. Solkey runs in your browser on phones, tablets and computers. There's nothing to install.",
    },
    {
        question: 'Is it free?',
        answer: 'Sketch is free forever: 3 minutes of recording a day and up to five scores. No card needed.',
        launchOnly: true,
    },
    {
        question: 'Is it free?',
        answer: 'Yes, while the beta runs — every beta account gets 30 minutes of recording a day, no card needed.',
        betaOnly: true,
    },
    {
        question: 'What can I do with my sheet music?',
        answer: 'Print it as a PDF, open it in other music apps (MusicXML or MIDI), or send a link anyone can open and play.',
    },
]

/** The pricing page's questions: plans, packs and payment, after the chords question. */
const PRICING_FAQ: readonly FaqItem[] = [
    CHORDS,
    {
        question: 'Is there a free plan?',
        answer: 'Sketch is free forever: 3 minutes of recording a day, up to five scores, and the whole editor with recording and playback. No card needed.',
        launchOnly: true,
    },
    {
        question: 'What counts as recording time?',
        answer: "Only the time you're recording: from the moment you press record until you stop. Editing, playback, importing and exporting are free on every plan, without limits. Your minutes refill once a day, at midnight UTC.",
    },
    {
        question: 'What happens when I reach my daily limit?',
        answer: "Recording pauses until your minutes refill the next day — the editor, playback and exports keep working. Minutes from a pack kick in automatically once today's run out.",
        launchOnly: true,
    },
    {
        // No packs on sale in the beta: the same answer without them.
        question: 'What happens when I reach my daily limit?',
        answer: 'Recording pauses until your minutes refill the next day — the editor, playback and exports keep working.',
        betaOnly: true,
    },
    {
        question: 'Do minute packs expire?',
        answer: "Never. Pack minutes sit in your account until you use them, and they're only spent once today's daily minutes are used up, so a subscription always comes first.",
        launchOnly: true,
    },
    {
        question: 'Can I cancel any time?',
        answer: 'Yes. Cancel from Settings and your plan stays active until the end of the period you paid for, then drops to Sketch. Every score you made stays in your library; Sketch only caps new scores at five.',
        launchOnly: true,
    },
    {
        question: 'Can I switch plans?',
        answer: 'Any time, from Settings. Upgrades take effect immediately — you only pay the difference for the time left on your plan — and the new daily minutes apply right away.',
        launchOnly: true,
    },
    {
        question: 'Do the prices include tax?',
        answer: 'Euro prices include VAT — the amount shown is the total you pay. Dollar prices are shown before local sales tax, which is added at checkout where it applies.',
        launchOnly: true,
    },
    {
        question: 'How are payments handled?',
        answer: 'Polar, our payment partner, handles checkout, invoices and your card details — Solkey never sees or stores them.',
        launchOnly: true,
    },
]

/** The items of a list this build shows: launch answers at launch, their beta versions in the beta. */
export function shownFaq(items: readonly FaqItem[]): FaqItem[] {
    return items.filter((item) => (BETA_MODE ? !item.launchOnly : !item.betaOnly))
}

/** The landing page's questions as this build shows them: the one list its FAQ and structured data read. */
export const LANDING_FAQ_SHOWN: readonly FaqItem[] = shownFaq(LANDING_FAQ)

/** The pricing page's questions as this build shows them: the one list its FAQ and structured data read. */
export const PRICING_FAQ_SHOWN: readonly FaqItem[] = shownFaq(PRICING_FAQ)

/** Both pages' full lists, for tests that check every answer in either mode. */
export const FAQ_LISTS = { landing: LANDING_FAQ, pricing: PRICING_FAQ } as const
