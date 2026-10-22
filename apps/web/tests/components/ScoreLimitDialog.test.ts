import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { BillingState } from '@/lib/api'

const billing: { data: BillingState | undefined } = { data: undefined }

vi.mock('@/lib/queries', async () => {
    const { PlanCatalogue } = await import('@/lib/plans')
    return {
        usePlanCatalogue: () => new PlanCatalogue(undefined),
        useBillingState: () => billing,
    }
})
vi.mock('@/lib/useDisplayCurrency', () => ({ useDisplayCurrency: () => 'eur' }))

import { ScoreAllowance, ScoreLimitCopy, ScoreLimitDialog, useScoreAllowance } from '@/components/ScoreLimitDialog'
import { planById } from '@/lib/plans'

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
    billing.data = undefined
})

function mount(element: React.ReactElement): HTMLElement {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    act(() => root.render(element))
    unmount = () => {
        act(() => root.unmount())
        host.remove()
    }
    return host
}

const sketch = (count: number) => new ScoreAllowance({ count, cap: 5, tierId: 'free', tierName: 'Sketch', next: planById('pro') })

describe('ScoreAllowance', () => {
    it('stays quiet until two below the cap, then counts the free scores', () => {
        expect(sketch(0).line).toBeNull()
        expect(sketch(2).line).toBeNull()
        expect(sketch(3).line).toBe('3 of 5 free scores')
        expect(sketch(4).line).toBe('4 of 5 free scores')
        expect(sketch(4).atCap).toBe(false)
    })

    it('says plainly when the cap is reached — and past it, after a downgrade', () => {
        expect(sketch(5).line).toBe("You've used all 5 free scores.")
        expect(sketch(5).atCap).toBe(true)
        expect(sketch(7).atCap).toBe(true)
    })

    it('names another capped tier instead of calling its scores free', () => {
        const beta = new ScoreAllowance({ count: 9, cap: 10, tierId: 'beta', tierName: 'Beta' })
        expect(beta.line).toBe('9 of 10 scores on Beta')
        expect(new ScoreAllowance({ count: 10, cap: 10, tierId: 'beta', tierName: 'Beta' }).line).toBe("You've used all 10 scores on Beta.")
    })

    it('never counts an uncapped plan', () => {
        const studio = new ScoreAllowance({ count: 400, cap: null, tierId: 'studio', tierName: 'Studio' })
        expect(studio.line).toBeNull()
        expect(studio.atCap).toBe(false)
    })
})

describe('useScoreAllowance', () => {
    function Probe({ count, onAllowance }: { count: number | undefined; onAllowance: (a: ScoreAllowance | null) => void }) {
        onAllowance(useScoreAllowance(count))
        return null
    }

    it('waits for both the billing state and the count', () => {
        const seen = vi.fn()
        mount(createElement(Probe, { count: 3, onAllowance: seen }))
        expect(seen).toHaveBeenLastCalledWith(null)
        unmount?.()

        billing.data = SKETCH
        mount(createElement(Probe, { count: undefined, onAllowance: seen }))
        expect(seen).toHaveBeenLastCalledWith(null)
        unmount?.()

        mount(createElement(Probe, { count: 5, onAllowance: seen }))
        const allowance = seen.mock.lastCall?.[0] as ScoreAllowance
        expect(allowance.atCap).toBe(true)
        expect(allowance.next?.id).toBe('pro')
    })

    it('offers no upgrade while plans are not on sale (the closed beta)', () => {
        billing.data = { ...SKETCH, betaMode: true }
        const seen = vi.fn()
        mount(createElement(Probe, { count: 5, onAllowance: seen }))
        expect((seen.mock.lastCall?.[0] as ScoreAllowance).next).toBeUndefined()
    })
})

describe('ScoreLimitCopy', () => {
    it('states the plan fact and the two ways forward in one sentence, priced', () => {
        const copy = new ScoreLimitCopy({ planName: 'Sketch', limit: 5, next: planById('pro'), nextLimit: null, price: '$9' })
        expect(copy.title).toBe('Your Sketch plan holds 5 scores.')
        expect(copy.body).toBe(
            "To start a new one, delete a score you don't need — or switch to Songwriter for as many scores as you like ($9 a month).",
        )
    })

    it('keeps to what the next tier really holds, and drops what it can’t say', () => {
        expect(new ScoreLimitCopy({ planName: 'Sketch', limit: 5, next: planById('pro'), nextLimit: 50 }).body).toBe(
            "To start a new one, delete a score you don't need — or switch to Songwriter for up to 50 scores.",
        )
        expect(new ScoreLimitCopy({ planName: 'Beta', limit: 10 }).body).toBe("To start a new one, delete a score you don't need.")
        expect(new ScoreLimitCopy({ planName: 'Sketch', limit: null }).title).toBe("You've reached your plan's score limit.")
    })
})

describe('ScoreLimitDialog', () => {
    const footerButton = (text: string) => [...document.querySelectorAll('footer button')].find((b) => b.textContent === text)

    it('is calm and flat: one paragraph, the price in the display currency, the next tier as the way up', () => {
        billing.data = SKETCH
        const onUpgrade = vi.fn()
        mount(createElement(ScoreLimitDialog, { onUpgrade, onClose: () => {} }))
        const dialog = document.querySelector('[role="dialog"]')
        if (!dialog) throw new Error('no dialog')
        expect(dialog.textContent).toContain('Your Sketch plan holds 5 scores.')
        expect(dialog.textContent).toContain("Everything you've written stays safe and editable.")
        expect(dialog.textContent).toContain('for as many scores as you like (€9 a month).')
        // No error tone anywhere: this is a plan limit, not a failure.
        expect(dialog.innerHTML).not.toContain('error')

        const see = footerButton('See Songwriter')
        if (!(see instanceof HTMLButtonElement)) throw new Error('no See Songwriter button')
        expect(see.className).not.toContain('shadow-(--shadow-offset')
        act(() => see.click())
        expect(onUpgrade).toHaveBeenCalledWith('pro')
    })

    it('offers no upgrade during the closed beta, and falls back to the free tier while billing loads', () => {
        billing.data = { ...SKETCH, betaMode: true }
        mount(createElement(ScoreLimitDialog, { onUpgrade: () => {}, onClose: () => {} }))
        expect(footerButton('See Songwriter')).toBeUndefined()
        expect(document.body.textContent).toContain("To start a new one, delete a score you don't need.")
        unmount?.()
        unmount = undefined

        billing.data = undefined
        mount(createElement(ScoreLimitDialog, { onUpgrade: () => {}, onClose: () => {} }))
        expect(document.body.textContent).toContain('Your Sketch plan holds 5 scores.')
    })
})
