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

import { ChangePlanDialog } from '@/app/settings/ChangePlanDialog'
import type { BillingState } from '@/lib/api'
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

let unmount: (() => void) | undefined

afterEach(() => {
    unmount?.()
    unmount = undefined
})

/**
 * The plan the dialog opens on: the name heading its one pressed tier card ("Studio", or
 * "Arranger — …" on the professional row). Feature lines name other tiers too.
 */
function openedOn(billing: BillingState, initialTier?: PlanTier['id']): string | undefined {
    const host = document.createElement('div')
    const root = createRoot(host)
    act(() => root.render(createElement(ChangePlanDialog, { billing, initialTier, onClose: () => {} })))
    unmount = () => act(() => root.unmount())
    const pressed = [...host.querySelectorAll('button[aria-pressed="true"]')]
    expect(pressed).toHaveLength(1)
    const texts = [...pressed[0].querySelectorAll('span')].map((span) => span.textContent)
    return ['Sketch', 'Songwriter', 'Studio', 'Arranger'].find((name) =>
        texts.some((text) => text === name || text?.startsWith(`${name} — `)),
    )
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
})
