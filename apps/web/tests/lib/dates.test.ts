import { describe, expect, it } from 'vitest'

import { formatPurgeDate } from '@/lib/dates'

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
