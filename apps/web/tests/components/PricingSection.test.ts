import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { BillingState } from '@/lib/api'

const visitor = vi.hoisted(() => ({ authed: false, tierId: null as string | null }))

vi.mock('@/lib/auth-client', () => ({
    useSession: () => ({ data: visitor.authed ? { user: { id: 'u1' } } : null }),
}))
vi.mock('@/lib/analytics', () => ({ track: vi.fn() }))
vi.mock('@/lib/queries', () => ({
    // Resolved once a tier is set; loading (no data) otherwise.
    useBillingState: () => ({ data: visitor.tierId ? ({ tierId: visitor.tierId } as Partial<BillingState>) : undefined }),
}))

import { Pricing } from '@/app/PricingSection'

/** The rendered cards as { name, badge, cta label, cta href }, in ladder order. */
function cards() {
    const host = document.createElement('div')
    host.innerHTML = renderToStaticMarkup(createElement(Pricing, { ctaLocation: 'pricing' }))
    return [...host.querySelectorAll('h3')].map((title) => {
        const card = title.closest('div.rounded-lg') as HTMLElement
        const cta = card.querySelector('a')
        return {
            name: title.textContent,
            badges: [...card.querySelectorAll('span.uppercase')].map((b) => b.textContent),
            cta: cta?.textContent,
            href: cta?.getAttribute('href')?.replace(/&amp;/g, '&'),
            text: card.textContent ?? '',
        }
    })
}

describe('Pricing', () => {
    beforeEach(() => {
        visitor.authed = false
        visitor.tierId = null
    })

    it('reads as plans: taglines, allowances in words, the free budget pictured, "Start free" and "Choose …"', () => {
        const [sketch, songwriter, studio] = cards()
        expect(sketch.text).toContain('For trying things out')
        expect(sketch.text).toContain('3 minutes of recording a day')
        expect(sketch.text).toContain('Enough for about six 30-second recordings.')
        expect(songwriter.text).not.toContain('Enough for about')
        expect([sketch.cta, songwriter.cta, studio.cta]).toEqual(['Start free', 'Choose Songwriter', 'Choose Studio'])
        expect(sketch.href).toBe('/signup?plan=free')
        expect(songwriter.badges).toEqual(['Best value'])
    })

    it('offers the professional tier as "Choose Arranger"', () => {
        const host = document.createElement('div')
        host.innerHTML = renderToStaticMarkup(createElement(Pricing, { ctaLocation: 'pricing' }))
        expect([...host.querySelectorAll('a')].map((a) => a.textContent)).toContain('Choose Arranger')
    })

    it('keeps the static cards for a signed-in visitor until their plan resolves', () => {
        visitor.authed = true
        const [sketch, songwriter] = cards()
        expect(sketch.badges).toEqual([])
        expect(songwriter.cta).toBe('Choose Songwriter')
        expect(songwriter.href).toBe('/settings?tab=plan&plan=pro')
    })

    it('marks a signed-in visitor’s own plan and offers the others as switches on the plan tab', () => {
        visitor.authed = true
        visitor.tierId = 'free'
        const [sketch, songwriter, studio] = cards()
        expect(sketch.badges).toEqual(['Your plan'])
        expect(sketch.cta).toBe('Your plan')
        expect(sketch.href).toBe('/settings?tab=plan')
        // "Best value" stays on the popular card when it isn't the visitor's own.
        expect(songwriter.badges).toEqual(['Best value'])
        expect(songwriter.cta).toBe('Switch to Songwriter')
        expect(songwriter.href).toBe('/settings?tab=plan&plan=pro')
        expect(studio.href).toBe('/settings?tab=plan&plan=studio')
    })

    it('puts "Your plan" in place of "Best value" on the popular card, and lets a subscriber switch to Sketch', () => {
        visitor.authed = true
        visitor.tierId = 'pro'
        const [sketch, songwriter] = cards()
        expect(songwriter.badges).toEqual(['Your plan'])
        expect(sketch.cta).toBe('Switch to Sketch')
        expect(sketch.href).toBe('/settings?tab=plan&plan=free')
    })

    it('treats a tier off the ladder like an unknown plan', () => {
        visitor.authed = true
        visitor.tierId = 'beta'
        expect(cards().flatMap((card) => card.badges)).toEqual(['Best value'])
    })
})
