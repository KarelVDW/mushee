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

import { FAQ_LISTS, type FaqItem, shownFaq } from '@/app/pricing/faq'
import { JsonLd } from '@/components/marketing/JsonLd'
import { CREDIT_PACKS, PLAN_TIERS } from '@/lib/plans'
import { faqPageJsonLd, solkeyApplicationJsonLd } from '@/lib/structuredData'

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

describe('faqPageJsonLd', () => {
    it('emits each question with its answer, in order', () => {
        const page = faqPageJsonLd([
            { question: 'A?', answer: 'Yes.' },
            { question: 'B?', answer: 'No.' },
        ])
        expect(page['@type']).toBe('FAQPage')
        expect(page.mainEntity).toEqual([
            { '@type': 'Question', name: 'A?', acceptedAnswer: { '@type': 'Answer', text: 'Yes.' } },
            { '@type': 'Question', name: 'B?', acceptedAnswer: { '@type': 'Answer', text: 'No.' } },
        ])
    })
})

describe('the FAQ lists', () => {
    beforeEach(() => {
        mode.beta = false
    })

    const lists = Object.entries(FAQ_LISTS) as [string, readonly FaqItem[]][]
    const questions = (items: readonly FaqItem[]) => items.map((item) => item.question)

    it.each(lists)('%s: opens with the chords question, at launch and in the beta', (_name, items) => {
        expect(shownFaq(items)[0].question).toBe('Can Solkey write chords?')
        mode.beta = true
        expect(shownFaq(items)[0].question).toBe('Can Solkey write chords?')
    })

    it.each(lists)('%s: shows each question once, with its launch or beta answer', (_name, items) => {
        for (const beta of [false, true]) {
            mode.beta = beta
            const shown = shownFaq(items)
            expect(new Set(questions(shown)).size).toBe(shown.length)
            expect(shown.some((item) => (beta ? item.launchOnly : item.betaOnly))).toBe(false)
        }
    })

    it('leaves plans, packs and payment out of the beta', () => {
        mode.beta = true
        const beta = shownFaq(FAQ_LISTS.pricing)
        expect(questions(beta)).not.toContain('Is there a free plan?')
        expect(questions(beta)).not.toContain('Do minute packs expire?')
        expect(beta.map((item) => item.answer).join(' ')).not.toMatch(/pack|Sketch/)
        expect(shownFaq(FAQ_LISTS.landing).find((item) => item.question === 'Is it free?')?.answer).toContain('while the beta runs')
    })

    it.each(lists)('%s: says "one note at a time" in the first answer only, in plain words', (_name, items) => {
        for (const beta of [false, true]) {
            mode.beta = beta
            const [first, ...rest] = shownFaq(items)
            expect(first.answer).toContain('melodies, one note at a time')
            for (const item of rest) expect(item.answer).not.toMatch(/one note at a time/)
            const all = shownFaq(items)
                .map((item) => `${item.question} ${item.answer}`)
                .join(' ')
            // The glossary: a recording, never "a take"; bars, never measures; no billing or engraving jargon.
            expect(all).not.toMatch(/\ba take\b|\btakes\b|audio-to-notation|prorat|merchant of record|budget|\bmeasures?\b/i)
        }
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
