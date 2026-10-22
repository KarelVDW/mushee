import type { Metadata } from 'next'

import { JsonLd } from '@/components/marketing/JsonLd'
import { SITE_URL } from '@/lib/env'
import { faqPageJsonLd, solkeyApplicationJsonLd } from '@/lib/structuredData'

import { LandingPage } from './LandingPage'
import { LANDING_FAQ_SHOWN } from './pricing/faq'

export const metadata: Metadata = {
    alternates: { canonical: '/' },
}

/** Structured data: the product with its offers, and the "Good to know" questions the page shows. */
const jsonLd = [solkeyApplicationJsonLd(SITE_URL), faqPageJsonLd(LANDING_FAQ_SHOWN)]

export default function Page() {
    return (
        <>
            <JsonLd data={jsonLd} />
            <LandingPage />
        </>
    )
}
