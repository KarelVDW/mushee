import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/queries', async () => {
    const { PlanCatalogue } = await import('@/lib/plans')
    return {
        usePlanCatalogue: () => new PlanCatalogue(undefined),
        useStartPackCheckout: () => ({ mutate: vi.fn() }),
    }
})
vi.mock('@/lib/analytics', () => ({ track: vi.fn() }))
vi.mock('@/lib/useDisplayCurrency', () => ({ useDisplayCurrency: () => 'usd' }))

import { PacksDialog } from '@/app/settings/PacksDialog'
import type { BillingState } from '@/lib/api'

// React's act() refuses to run outside a test-aware environment.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const SKETCH: BillingState = {
    tierId: 'free',
    tierName: 'Sketch',
    status: null,
    interval: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    billingConfigured: true,
    betaMode: false,
    credits: { limitSeconds: 180, usedSeconds: 0, remainingSeconds: 180, packSeconds: 0 },
}

const STUDIO: BillingState = {
    ...SKETCH,
    tierId: 'studio',
    tierName: 'Studio',
    status: 'active',
    interval: 'monthly',
    credits: { limitSeconds: 10800, usedSeconds: 0, remainingSeconds: 10800, packSeconds: 0 },
}

let unmount: (() => void) | undefined

afterEach(() => {
    unmount?.()
    unmount = undefined
})

function render(billing: BillingState): HTMLElement {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    act(() => root.render(createElement(PacksDialog, { billing, onClose: () => {}, onSeePlans: () => {} })))
    unmount = () => {
        act(() => root.unmount())
        host.remove()
    }
    return host
}

const subtitle = (host: HTMLElement) =>
    document.getElementById(host.querySelector('[role="dialog"]')?.getAttribute('aria-describedby') ?? '')?.textContent

describe('PacksDialog', () => {
    it('measures packs against a free account’s allowance and nudges it toward Songwriter once', () => {
        const host = render(SKETCH)
        expect(host.textContent).toContain('Extra recording minutes')
        expect(subtitle(host)).toBe('For busy days: used after your free 3 minutes run out, and they never expire.')
        expect(host.textContent).toContain('Recording regularly? Songwriter gives you 20 minutes every day for $9 a month')
        // The per-card subscription comparison stays on the marketing teaser only.
        expect(host.textContent).not.toContain('more a month')
    })

    it('gives a subscriber no subscription nudge, measured against its own daily allowance', () => {
        const host = render(STUDIO)
        expect(subtitle(host)).toBe('For busy days: used after your daily 3 hours run out, and they never expire.')
        expect(host.textContent).not.toContain('Recording regularly?')
    })

    it('leads each pack with its minutes, and the button says what it buys', () => {
        const host = render(SKETCH)
        const cards = [...host.querySelectorAll('[role="radio"]')].map((card) => card.textContent)
        expect(cards[0]).toMatch(/^15 min\$6Single · /)
        const buy = [...host.querySelectorAll('footer button')].at(-1)
        expect(buy?.textContent).toBe('Buy 15 min · $6')
    })

    it('picks a pack with the arrow keys, the group one Tab stop on the chosen pack', () => {
        const host = render(SKETCH)
        const cards = () => [...host.querySelectorAll<HTMLButtonElement>('[role="radio"]')]
        expect(cards().map((c) => c.tabIndex)).toEqual([0, -1, -1])
        act(() => {
            cards()[0]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
        })
        expect(cards().map((c) => c.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false'])
        expect(cards().map((c) => c.tabIndex)).toEqual([-1, 0, -1])
        expect(document.activeElement).toBe(cards()[1])
        expect([...host.querySelectorAll('footer button')].at(-1)?.textContent).toMatch(/^Buy \d+ min · /)
    })
})
