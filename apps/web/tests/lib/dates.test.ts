import { describe, expect, it } from 'vitest'

import { formatLongDate, formatPurgeDate, formatRelativeTime, formatShortDate, formatTakeDate } from '@/lib/dates'

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

describe('formatShortDate / formatLongDate', () => {
    it('formats a calendar date with its year, short or spelled out', () => {
        const iso = new Date(2026, 9, 22, 12, 0).toISOString()
        expect(formatShortDate(iso)).toBe(new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }))
        expect(formatLongDate(iso)).toBe(new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }))
        expect(formatShortDate(iso)).toContain('2026')
        expect(formatLongDate(iso)).toContain('2026')
    })
})

describe('formatRelativeTime', () => {
    const now = NOW.getTime()
    const ago = (ms: number) => new Date(now - ms).toISOString()
    const MINUTE = 60_000
    const HOUR = 60 * MINUTE
    const DAY = 24 * HOUR

    it('counts up from just now through minutes and hours', () => {
        expect(formatRelativeTime(ago(30_000), now)).toBe('Just now')
        expect(formatRelativeTime(ago(5 * MINUTE), now)).toBe('5m ago')
        expect(formatRelativeTime(ago(3 * HOUR), now)).toBe('3h ago')
    })

    it('names yesterday, then days, then the short date past a week', () => {
        expect(formatRelativeTime(ago(DAY + HOUR), now)).toBe('Yesterday')
        expect(formatRelativeTime(ago(4 * DAY), now)).toBe('4 days ago')
        expect(formatRelativeTime(ago(7 * DAY + HOUR), now)).toBe('7 days ago')
        expect(formatRelativeTime(ago(8 * DAY), now)).toBe(formatShortDate(ago(8 * DAY)))
    })
})

describe('formatPurgeDate', () => {
    it('names the purge day as month and day, without the year', () => {
        const iso = '2026-10-29T12:00:00.000Z'
        const label = formatPurgeDate(iso)
        expect(label).toContain('29')
        expect(label).not.toContain('2026')
        expect(label).toBe(new Date(iso).toLocaleDateString(undefined, { month: 'long', day: 'numeric' }))
    })

    it('has no label without a date, so each sentence can word that case', () => {
        expect(formatPurgeDate(undefined)).toBeNull()
        expect(formatPurgeDate('')).toBeNull()
    })
})
