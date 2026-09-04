import type { Metadata } from 'next'

import { BETA_MODE, PLAN_TIERS } from '@/lib/plans'

import { LandingPage } from './LandingPage'

export const metadata: Metadata = {
    alternates: { canonical: '/' },
}

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://solkey.io'

/** Structured data for rich search results (SoftwareApplication + offers). */
const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'Solkey',
    url: SITE_URL,
    applicationCategory: 'MultimediaApplication',
    operatingSystem: 'Web',
    description: 'Solkey turns what you play or sing into sheet music, live. The fastest way to get a melody on the page.',
    // During the closed beta the tier ladder is unannounced (prices may still
    // change), so search results only see the one truthful offer: free.
    offers: BETA_MODE
        ? [{ '@type': 'Offer', name: 'Solkey Beta', price: 0, priceCurrency: 'USD' }]
        : PLAN_TIERS.map((tier) => ({
              '@type': 'Offer',
              name: `Solkey ${tier.name}`,
              price: tier.priceMonthly,
              priceCurrency: 'USD',
          })),
}

export default function Page() {
    return (
        <>
            <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
            <LandingPage />
        </>
    )
}
