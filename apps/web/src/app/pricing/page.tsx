import type { Metadata } from 'next'

import { JsonLd } from '@/components/marketing/JsonLd'
import { formatMoney } from '@/lib/currency'
import { SITE_URL } from '@/lib/env'
import { BETA_MODE, CHEAPEST_PACK, PLAN_TIERS } from '@/lib/plans'
import { faqPageJsonLd, solkeyApplicationJsonLd } from '@/lib/structuredData'

import { PRICING_FAQ_SHOWN } from './faq'
import { PricingPage } from './PricingPage'

/** The cheapest paid plan's monthly price — the "plans from …" figure. */
const PLANS_FROM = Math.min(...PLAN_TIERS.filter((tier) => tier.priceMonthly > 0).map((tier) => tier.priceMonthly))

// During the closed beta the tiers and their prices stay unannounced (they may still change), so
// the page's search and social copy says only what the beta costs: nothing.
export const metadata: Metadata = BETA_MODE
    ? {
          title: 'Pricing',
          description:
              'Solkey is free while the closed beta runs: the full editor, recording that writes the notes for you, and playback, no card needed. Paid plans arrive at launch.',
          alternates: { canonical: '/pricing' },
          openGraph: {
              title: 'Solkey pricing — free while the beta runs',
              description:
                  'Every beta account gets the full editor, recording that writes the notes for you, and playback, free of charge. Paid plans arrive at launch.',
          },
      }
    : {
          title: 'Pricing',
          description:
              'Solkey plans: free to start, and you pay only for more recording time. Sketch is free forever; Songwriter, Studio and Arranger let you record more each day. One-time minute packs never expire.',
          alternates: { canonical: '/pricing' },
          openGraph: {
              title: 'Solkey pricing — free to start',
              description: `Free to start. Plans from ${formatMoney(PLANS_FROM, 'usd')} a month, one-time minute packs from ${formatMoney(CHEAPEST_PACK.price, 'usd')}. Every plan gets the full editor.`,
          },
      }

/** Structured data: the product with its offer ladder (hidden during the beta) and the FAQ, for rich results. */
const jsonLd = [solkeyApplicationJsonLd(`${SITE_URL}/pricing`), faqPageJsonLd(PRICING_FAQ_SHOWN)]

export default function Page() {
    return (
        <>
            <JsonLd data={jsonLd} />
            <PricingPage />
        </>
    )
}
