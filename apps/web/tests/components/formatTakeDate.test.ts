import { describe, expect, it } from 'vitest'

import { formatTakeDate } from '@/components/TakesList'

// Local-time constructors keep the day boundaries independent of the runner's
// timezone; the expected time/date parts use the same locale calls as the
// formatter, so the assertions hold under any runner locale.
const NOW = new Date(2026, 9, 22, 16, 30)
const time = (d: Date) => d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })

describe('formatTakeDate', () => {
    it('labels a take from earlier today as "Today"', () => {
        const take = new Date(2026, 9, 22, 14, 2)
        expect(formatTakeDate(take.toISOString(), NOW)).toBe(`Today, ${time(take)}`)
    })

    it('labels a take from the previous calendar day as "Yesterday"', () => {
        const take = new Date(2026, 9, 21, 23, 59)
        expect(formatTakeDate(take.toISOString(), NOW)).toBe(`Yesterday, ${time(take)}`)
    })

    it('treats the last day of the previous month as yesterday', () => {
        const now = new Date(2026, 2, 1, 9, 0)
        const take = new Date(2026, 1, 28, 20, 15)
        expect(formatTakeDate(take.toISOString(), now)).toBe(`Yesterday, ${time(take)}`)
    })

    it('shows day and month, without the year, for older takes this year', () => {
        const take = new Date(2026, 8, 3, 14, 2)
        const day = take.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
        const label = formatTakeDate(take.toISOString(), NOW)
        expect(label).toBe(`${day}, ${time(take)}`)
        expect(label).not.toContain('2026')
    })

    it('adds the year for takes from a prior year', () => {
        const take = new Date(2025, 8, 3, 14, 2)
        const day = take.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
        const label = formatTakeDate(take.toISOString(), NOW)
        expect(label).toBe(`${day}, ${time(take)}`)
        expect(label).toContain('2025')
    })
})
