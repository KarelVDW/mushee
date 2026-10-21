import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mode = vi.hoisted(() => ({ beta: false }))

vi.mock('@/lib/plans', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@/lib/plans')>()),
    get BETA_MODE() {
        return mode.beta
    },
}))

import { JsonLd } from '@/components/marketing/JsonLd'
import { CREDIT_PACKS, PLAN_TIERS } from '@/lib/plans'
import { solkeyApplicationJsonLd } from '@/lib/structuredData'

describe('solkeyApplicationJsonLd', () => {
    beforeEach(() => {
        mode.beta = false
    })

    it('describes one product at the given page, with every tier and pack as an offer', () => {
        const app = solkeyApplicationJsonLd('https://solkey.test/pricing')
        expect(app['@type']).toBe('SoftwareApplication')
        expect(app.url).toBe('https://solkey.test/pricing')
        expect(app.offers).toHaveLength(PLAN_TIERS.length + CREDIT_PACKS.length)
        // Paid tiers say they bill monthly; the free tier has nothing to bill.
        const [free, songwriter] = app.offers as { price: number; priceSpecification?: { billingDuration: string } }[]
        expect(free.priceSpecification).toBeUndefined()
        expect(songwriter.priceSpecification?.billingDuration).toBe('P1M')
    })

    it('offers only the free beta while the beta runs', () => {
        mode.beta = true
        expect(solkeyApplicationJsonLd('https://solkey.test').offers).toEqual([
            { '@type': 'Offer', name: 'Solkey Beta', price: 0, priceCurrency: 'USD' },
        ])
    })
})

describe('JsonLd', () => {
    it('emits one script that no string inside can close early', () => {
        const markup = renderToStaticMarkup(createElement(JsonLd, { data: [{ name: 'a</script><b>' }, { name: 'c' }] }))
        expect(markup.match(/<script/g)).toHaveLength(1)
        expect(markup).not.toContain('</script><b>')
        const json = /<script type="application\/ld\+json">(.*)<\/script>/.exec(markup)?.[1] ?? ''
        expect(JSON.parse(json)).toEqual([{ name: 'a</script><b>' }, { name: 'c' }])
    })
})
