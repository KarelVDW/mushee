import type { Metadata } from 'next'

import { JsonLd } from '@/components/marketing/JsonLd'
import { SITE_URL } from '@/lib/env'
import { solkeyApplicationJsonLd } from '@/lib/structuredData'

import { LandingPage } from './LandingPage'

export const metadata: Metadata = {
    alternates: { canonical: '/' },
}

export default function Page() {
    return (
        <>
            <JsonLd data={solkeyApplicationJsonLd(SITE_URL)} />
            <LandingPage />
        </>
    )
}
