import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/queries', async () => {
    const { PlanCatalogue } = await import('@/lib/plans')
    const mutation = () => ({ mutate: vi.fn() })
    return {
        // No API catalogue yet: the picker offers the built-in tiers.
        usePlanCatalogue: () => new PlanCatalogue(undefined),
        useStartCheckout: mutation,
        useChangePlan: mutation,
        useCancelSubscription: mutation,
    }
})
// Prices in dollars whatever the machine's time zone suggests.
vi.mock('@/lib/useDisplayCurrency', () => ({ useDisplayCurrency: () => 'usd' }))

import { ChangePlanDialog } from '@/app/settings/ChangePlanDialog'
import type { BillingState } from '@/lib/api'
import { formatLongDate } from '@/lib/dates'
import type { PlanTier } from '@/lib/plans'

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
    currentPeriodEnd: '2026-11-22T12:00:00.000Z',
    credits: { limitSeconds: 10800, usedSeconds: 0, remainingSeconds: 10800, packSeconds: 0 },
}

let unmount: (() => void) | undefined

afterEach(() => {
    unmount?.()
    unmount = undefined
})

function render(billing: BillingState, initialTier?: PlanTier['id']): HTMLElement {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    act(() => root.render(createElement(ChangePlanDialog, { billing, initialTier, onClose: () => {} })))
    unmount = () => {
        act(() => root.unmount())
        host.remove()
    }
    return host
}

/**
 * The plan the dialog opens on: the name heading its one pressed tier card ("Studio", or
 * "Arranger — …" on the professional row). Feature lines name other tiers too.
 */
function openedOn(billing: BillingState, initialTier?: PlanTier['id']): string | undefined {
    const host = render(billing, initialTier)
    const pressed = [...host.querySelectorAll('button[aria-pressed="true"]')]
    expect(pressed).toHaveLength(1)
    const texts = [...pressed[0].querySelectorAll('span')].map((span) => span.textContent)
    return ['Sketch', 'Songwriter', 'Studio', 'Arranger'].find((name) =>
        texts.some((text) => text === name || text?.startsWith(`${name} — `)),
    )
}

/** The footer's button labels, in order. */
function footerButtons(host: HTMLElement): string[] {
    return [...host.querySelectorAll('footer button')].map((b) => b.textContent ?? '')
}

/** Clicks the tier card headed by `name`. */
function pick(host: HTMLElement, name: string) {
    const card = [...host.querySelectorAll<HTMLButtonElement>('button[aria-pressed]')].find((b) =>
        [...b.querySelectorAll('span')].some((s) => s.textContent === name),
    )
    act(() => card?.click())
}

/** Clicks a billing-cadence option ("Monthly", "Yearly · save 17%"). */
function cadence(host: HTMLElement, label: RegExp) {
    const option = [...host.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find((b) => label.test(b.textContent ?? ''))
    act(() => option?.click())
}

describe('ChangePlanDialog', () => {
    it('opens on the account’s current plan', () => {
        expect(openedOn(SKETCH)).toBe('Sketch')
        unmount?.()
        // The beta plan isn't on offer, so a beta account starts from Sketch.
        expect(openedOn({ ...SKETCH, tierId: 'beta', tierName: 'Beta' })).toBe('Sketch')
    })

    it('opens on the tier a pricing card asked for', () => {
        expect(openedOn(SKETCH, 'studio')).toBe('Studio')
        unmount?.()
        expect(openedOn(SKETCH, 'arranger')).toBe('Arranger')
    })

    it('says which plan the account is on, in plain words without the payment provider in the subtitle', () => {
        const host = render(STUDIO)
        const dialog = host.querySelector('[role="dialog"]')
        expect(dialog?.textContent).toContain("You're on Studio.")
        const description = document.getElementById(dialog?.getAttribute('aria-describedby') ?? '')
        expect(description?.textContent).toBe("Pick how much you'd like to record each day. Switch or cancel any time.")
        expect(host.querySelector('[aria-label="How often you pay"]')).not.toBeNull()
    })

    it('offers only Close while the current plan is picked', () => {
        expect(footerButtons(render(SKETCH))).toEqual(['Close'])
    })

    it('leads a new subscription to the payment page, naming the payment partner there', () => {
        const host = render(SKETCH)
        pick(host, 'Songwriter')
        expect(footerButtons(host)).toEqual(['Keep my plan', 'Continue to payment'])
        expect(host.textContent).toContain("You'll pay on a secure page run by our payment partner, Polar.")
    })

    it('names the switch and its price in the picked cadence', () => {
        const host = render(STUDIO)
        pick(host, 'Songwriter')
        expect(footerButtons(host)).toEqual(['Keep my plan', 'Switch to Songwriter — $9 a month'])
        expect(host.textContent).toContain("your next bill is adjusted for the days you've already paid")
        cadence(host, /^Yearly/)
        expect(footerButtons(host)).toEqual(['Keep my plan', 'Switch to Songwriter — $90 a year'])
        // The current tier in the other cadence is a switch too.
        pick(host, 'Studio')
        expect(footerButtons(host)).toEqual(['Keep my plan', 'Switch to Studio — $190 a year'])
    })

    it('cancels from Sketch, saying the plan stays until the period ends', () => {
        const host = render(STUDIO, 'free')
        expect(footerButtons(host)).toEqual(['Keep my plan', 'Cancel subscription'])
        expect(host.textContent).toContain(
            `You keep Studio until ${formatLongDate('2026-11-22T12:00:00.000Z')}, then move to Sketch. Your scores stay.`,
        )
    })

    it('never uses the magenta pop on its confirm', () => {
        const host = render(STUDIO)
        pick(host, 'Songwriter')
        const confirm = [...host.querySelectorAll('footer button')].at(-1)
        expect(confirm?.className).not.toContain('shadow-(--shadow-offset-3)')
    })
})
