import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/useDisplayCurrency', () => ({ useDisplayCurrency: () => 'usd' }))

import { PlanPicker } from '@/components/PlanPicker'
import type { BillingInterval } from '@/lib/api'
import { PLAN_TIERS, type PlanTier } from '@/lib/plans'

// React's act() refuses to run outside a test-aware environment.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let unmount: (() => void) | undefined

afterEach(() => {
    unmount?.()
    unmount = undefined
})

function renderCompact(selected: PlanTier['id'] | null, billing: BillingInterval = 'monthly', onSelect = vi.fn()) {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    act(() =>
        root.render(
            createElement(PlanPicker, { plans: PLAN_TIERS, billing, onBillingChange: () => {}, selected, onSelect, compact: true }),
        ),
    )
    unmount = () => {
        act(() => root.unmount())
        host.remove()
    }
    return host
}

const rows = (host: HTMLElement) => [...host.querySelectorAll<HTMLButtonElement>('[role="radiogroup"][aria-label="Plans"] [role="radio"]')]
const PLAN_NAMES = PLAN_TIERS.map((p) => p.name)
/** Each row's plan name: the one span in it that reads as nothing but a plan's name. */
const rowNames = (host: HTMLElement) =>
    rows(host).map((row) => [...row.querySelectorAll('span')].map((s) => s.textContent).find((t) => PLAN_NAMES.includes(t ?? '')))
const button = (host: HTMLElement, text: RegExp) =>
    [...host.querySelectorAll<HTMLButtonElement>('button')].find((b) => text.test(b.textContent ?? ''))

describe('PlanPicker compact', () => {
    it('lists the consumer plans as radio rows, with the professional tier behind its link', () => {
        const host = renderCompact('free')
        expect(rowNames(host)).toEqual(['Sketch', 'Songwriter', 'Studio'])
        expect(button(host, /^Recording for work\? See Arranger$/)).toBeDefined()
    })

    it('checks only the tier the caller passes, and none for null', () => {
        expect(rows(renderCompact('free')).map((r) => r.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false'])
        unmount?.()
        expect(rows(renderCompact(null)).map((r) => r.getAttribute('aria-checked'))).toEqual(['false', 'false', 'false'])
    })

    it('shows prices per month, or per year once yearly is picked', () => {
        expect(rows(renderCompact('free'))[1]?.textContent).toContain('$9/month')
        unmount?.()
        expect(rows(renderCompact('free', 'yearly'))[1]?.textContent).toContain('$90/year')
    })

    it('opens the feature lists behind "Compare plans"', () => {
        const host = renderCompact('free')
        const compare = button(host, /^Compare plans$/)
        expect(compare?.getAttribute('aria-expanded')).toBe('false')
        expect(host.textContent).not.toContain('Up to 5 scores')
        act(() => compare?.click())
        expect(compare?.getAttribute('aria-expanded')).toBe('true')
        expect(host.textContent).toContain('Up to 5 scores')
    })

    it('reveals the professional tier on request, and from the start when it is the chosen one', () => {
        const host = renderCompact('free')
        act(() => button(host, /See Arranger/)?.click())
        expect(rowNames(host)).toEqual(['Sketch', 'Songwriter', 'Studio', 'Arranger'])
        expect(button(host, /See Arranger/)).toBeUndefined()
        unmount?.()
        expect(rowNames(renderCompact('arranger'))).toEqual(['Sketch', 'Songwriter', 'Studio', 'Arranger'])
    })

    it('reports a picked row', () => {
        const onSelect = vi.fn()
        const host = renderCompact('free', 'monthly', onSelect)
        act(() => rows(host)[2]?.click())
        expect(onSelect).toHaveBeenCalledWith('studio')
    })
})
