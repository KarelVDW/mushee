import { describe, expect, it } from 'vitest'

import { formatPurgeDate } from '@/lib/dates'

describe('formatPurgeDate', () => {
    it('names the purge day as month and day, without the year', () => {
        const iso = '2026-10-29T12:00:00.000Z'
        const label = formatPurgeDate(iso, 'soon')
        expect(label).toContain('29')
        expect(label).not.toContain('2026')
        expect(label).toBe(new Date(iso).toLocaleDateString(undefined, { month: 'long', day: 'numeric' }))
    })

    it("falls back to the caller's wording without a date", () => {
        expect(formatPurgeDate(undefined, 'in 7 days')).toBe('in 7 days')
        expect(formatPurgeDate('', 'soon')).toBe('soon')
    })
})
