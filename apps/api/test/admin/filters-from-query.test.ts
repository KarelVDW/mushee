import { BadRequestException } from '@nestjs/common'
import { describe, expect, it } from 'vitest'

import { AudienceFilterDto } from '../../src/admin/dto/audience-filter.dto'

/**
 * GET /admin/audience and the CSV export take the audience filter as query
 * parameters (the console's `audienceQuery` produces them). The parser must
 * accept exactly that form and ignore anything else, except a malformed date,
 * which is a 400 rather than a silently wider audience.
 */
describe('AudienceFilterDto.fromQuery', () => {
    it('parses the console query form field by field', () => {
        const f = AudienceFilterDto.fromQuery({
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
        const f = AudienceFilterDto.fromQuery({})
        expect(f.tiers).toBeUndefined()
        expect(f.betaStatus).toBeUndefined()
        expect(f.activeWithinDays).toBeUndefined()
        expect(f.verifiedOnly).toBe(false)
        expect(f.includeDeletionRequested).toBe(false)
    })

    it('drops unknown beta statuses, non-positive or fractional day counts, and non-"true" booleans', () => {
        const f = AudienceFilterDto.fromQuery({
            betaStatus: 'admin',
            activeWithinDays: '-3',
            verifiedOnly: '1',
            includeDeletionRequested: 'yes',
        })
        expect(f.betaStatus).toBeUndefined()
        expect(f.activeWithinDays).toBeUndefined()
        expect(f.verifiedOnly).toBe(false)
        expect(f.includeDeletionRequested).toBe(false)
        expect(AudienceFilterDto.fromQuery({ activeWithinDays: '2.5' }).activeWithinDays).toBeUndefined()
        expect(AudienceFilterDto.fromQuery({ activeWithinDays: 'abc' }).activeWithinDays).toBeUndefined()
        expect(AudienceFilterDto.fromQuery({ tiers: ' , ' }).tiers).toEqual([])
    })

    it('rejects a malformed sign-up date instead of widening the audience', () => {
        expect(() => AudienceFilterDto.fromQuery({ signedUpAfter: 'garbage' })).toThrow(BadRequestException)
        expect(() => AudienceFilterDto.fromQuery({ signedUpAfter: 'garbage' })).toThrow('signedUpAfter must be an ISO 8601 date')
        expect(() => AudienceFilterDto.fromQuery({ signedUpBefore: '01/09/2026' })).toThrow('signedUpBefore must be an ISO 8601 date')
        expect(AudienceFilterDto.fromQuery({ signedUpAfter: '2026-07-01T00:00:00.000Z' }).signedUpAfter).toBe('2026-07-01T00:00:00.000Z')
    })
})
