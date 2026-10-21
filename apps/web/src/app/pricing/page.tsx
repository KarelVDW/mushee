import type { Metadata } from 'next'

import { JsonLd } from '@/components/marketing/JsonLd'
import { formatMoney } from '@/lib/currency'
import { SITE_URL } from '@/lib/env'
import { CHEAPEST_PACK, PLAN_TIERS } from '@/lib/plans'
import { solkeyApplicationJsonLd } from '@/lib/structuredData'

import { PRICING_FAQ } from './faq'
import { PricingPage } from './PricingPage'

/** The cheapest paid plan's monthly price — the "plans from …" figure. */
const PLANS_FROM = Math.min(...PLAN_TIERS.filter((tier) => tier.priceMonthly > 0).map((tier) => tier.priceMonthly))

export const metadata: Metadata = {
    title: 'Pricing',
    description:
        'Solkey plans: pay for recording time, nothing else. Sketch is free forever; Songwriter, Studio and Arranger add daily recording budget. One-time minute packs never expire.',
    alternates: { canonical: '/pricing' },
    openGraph: {
        title: 'Solkey pricing — pay for recording time, nothing else',
        description: `Free to start. Plans from ${formatMoney(PLANS_FROM, 'usd')} a month, one-time minute packs from ${formatMoney(CHEAPEST_PACK.price, 'usd')}. Every plan gets the full editor.`,
    },
}

/** Structured data: the product with its offer ladder (hidden during the beta) and the FAQ, for rich results. */
const jsonLd = [
    solkeyApplicationJsonLd(`${SITE_URL}/pricing`),
    {
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: PRICING_FAQ.map((item) => ({
            '@type': 'Question',
            name: item.question,
            acceptedAnswer: { '@type': 'Answer', text: item.answer },
        })),
    },
]

export default function Page() {
    return (
        <>
            <JsonLd data={jsonLd} />
            <PricingPage />
        </>
    )
}
