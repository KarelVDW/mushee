import type { Metadata } from 'next'

import { BETA_MODE, CREDIT_PACKS, PLAN_TIERS } from '@/lib/plans'

import { PRICING_FAQ } from './faq'
import { PricingPage } from './PricingPage'

export const metadata: Metadata = {
    title: 'Pricing',
    description:
        'Solkey plans: pay for recording time, nothing else. Sketch is free forever; Songwriter, Studio and Arranger add daily recording budget. One-time minute packs never expire.',
    alternates: { canonical: '/pricing' },
    openGraph: {
        title: 'Solkey pricing — pay for recording time, nothing else',
        description: 'Free to start. Plans from $9 a month, one-time minute packs from $6. Every plan gets the full editor.',
    },
}

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://solkey.io'

/** Structured data: the offer ladder (hidden during the beta) and the FAQ, for rich results. */
const jsonLd = [
    {
        '@context': 'https://schema.org',
        '@type': 'SoftwareApplication',
        name: 'Solkey',
        url: `${SITE_URL}/pricing`,
        applicationCategory: 'MultimediaApplication',
        operatingSystem: 'Web',
        offers: BETA_MODE
            ? [{ '@type': 'Offer', name: 'Solkey Beta', price: 0, priceCurrency: 'USD' }]
            : [
                  ...PLAN_TIERS.map((tier) => ({
                      '@type': 'Offer',
                      name: `Solkey ${tier.name}`,
                      price: tier.priceMonthly,
                      priceCurrency: 'USD',
                      ...(tier.priceMonthly > 0 && {
                          priceSpecification: {
                              '@type': 'UnitPriceSpecification',
                              price: tier.priceMonthly,
                              priceCurrency: 'USD',
                              billingDuration: 'P1M',
                          },
                      }),
                  })),
                  ...CREDIT_PACKS.map((pack) => ({
                      '@type': 'Offer',
                      name: `Solkey ${pack.name} pack (${pack.minutes} min)`,
                      price: pack.price,
                      priceCurrency: 'USD',
                  })),
              ],
    },
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
            <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
            <PricingPage />
        </>
    )
}
