import { BETA_MODE, CREDIT_PACKS, PLAN_TIERS } from './plans'

/**
 * Solkey as a schema.org SoftwareApplication, for rich search results. One
 * builder for every page that describes the product, so search engines see a
 * single consistent entity: the same description and the same offers wherever
 * it appears. `url` is the page it is embedded in.
 */
export function solkeyApplicationJsonLd(url: string) {
    return {
        '@context': 'https://schema.org',
        '@type': 'SoftwareApplication',
        name: 'Solkey',
        url,
        applicationCategory: 'MultimediaApplication',
        operatingSystem: 'Web',
        description: 'Solkey turns what you play or sing into sheet music, live. The fastest way to get a melody on the page.',
        offers: solkeyOffers(),
    }
}

/**
 * The offer ladder: every tier (paid ones billed monthly) and the one-time
 * minute packs. During the closed beta the ladder is unannounced (prices may
 * still change), so search results only see the one truthful offer: free.
 */
function solkeyOffers() {
    if (BETA_MODE) return [{ '@type': 'Offer', name: 'Solkey Beta', price: 0, priceCurrency: 'USD' }]
    return [
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
    ]
}
