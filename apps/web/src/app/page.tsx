import type { Metadata } from 'next'

import { PLAN_TIERS } from '@/lib/plans'

import { LandingPage } from './LandingPage'

export const metadata: Metadata = {
    alternates: { canonical: '/' },
}

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://sheemu.app'

/** Structured data for rich search results (SoftwareApplication + offers). */
const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'Sheemu',
    url: SITE_URL,
    applicationCategory: 'MultimediaApplication',
    operatingSystem: 'Web',
    description:
        'Sheemu turns what you play or sing into clean sheet music, live. The fastest way to get a melody on the page.',
    offers: PLAN_TIERS.map((tier) => ({
        '@type': 'Offer',
        name: `Sheemu ${tier.name}`,
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
