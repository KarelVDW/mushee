import { describe, expect, it } from 'vitest'

import { formatLongDate, formatPurgeDate, formatRelativeTime, formatShortDate } from '@/lib/dates'

// A local-time constructor keeps the reference instant independent of the runner's timezone.
const NOW = new Date(2026, 9, 22, 16, 30)

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
