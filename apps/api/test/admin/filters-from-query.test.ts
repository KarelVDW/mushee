import { describe, expect, it } from 'vitest'

import { AdminController } from '../../src/admin/admin.controller'

/**
 * GET /admin/audience and the CSV export take the audience filter as query
 * parameters (the console's `audienceQuery` produces them). The parser must
 * accept exactly that form and ignore anything else.
 */
describe('AdminController.filtersFromQuery', () => {
    it('parses the console query form field by field', () => {
        const f = AdminController.filtersFromQuery({
            tiers: 'beta, free,,studio ',
            betaStatus: 'approved',
            signedUpAfter: '2026-07-01',
            signedUpBefore: '2026-09-01',
            activeWithinDays: '30',
            verifiedOnly: 'true',
            includeDeletionRequested: 'true',
        })
        expect(f.tiers).toEqual(['beta', 'free', 'studio'])
        expect(f.betaStatus).toBe('approved')
        expect(f.signedUpAfter).toBe('2026-07-01')
        expect(f.signedUpBefore).toBe('2026-09-01')
        expect(f.activeWithinDays).toBe(30)
        expect(f.verifiedOnly).toBe(true)
        expect(f.includeDeletionRequested).toBe(true)
    })

    it('an empty query is an empty filter with the booleans false', () => {
        const f = AdminController.filtersFromQuery({})
        expect(f.tiers).toBeUndefined()
        expect(f.betaStatus).toBeUndefined()
        expect(f.activeWithinDays).toBeUndefined()
        expect(f.verifiedOnly).toBe(false)
        expect(f.includeDeletionRequested).toBe(false)
    })

    it('drops unknown beta statuses, non-positive or fractional day counts, and non-"true" booleans', () => {
        const f = AdminController.filtersFromQuery({
            betaStatus: 'admin',
            activeWithinDays: '-3',
            verifiedOnly: '1',
            includeDeletionRequested: 'yes',
        })
        expect(f.betaStatus).toBeUndefined()
        expect(f.activeWithinDays).toBeUndefined()
        expect(f.verifiedOnly).toBe(false)
        expect(f.includeDeletionRequested).toBe(false)
        expect(AdminController.filtersFromQuery({ activeWithinDays: '2.5' }).activeWithinDays).toBeUndefined()
        expect(AdminController.filtersFromQuery({ activeWithinDays: 'abc' }).activeWithinDays).toBeUndefined()
        expect(AdminController.filtersFromQuery({ tiers: ' , ' }).tiers).toEqual([])
    })
})
