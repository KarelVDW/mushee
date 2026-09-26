import { describe, expect, it } from 'vitest'

import { audienceCsvUrl, audienceQuery } from '../src/lib/api'

/**
 * The console builds the audience query string that GET /admin/audience,
 * the CSV export and (as JSON) the send all understand. The mapping must be
 * lossless for real filters and must not leak UI-only defaults.
 */
describe('audienceQuery', () => {
    it('is empty for the default filter ("any" beta status is not a filter)', () => {
        expect(audienceQuery({ betaStatus: 'any' })).toBe('')
        expect(audienceQuery({})).toBe('')
    })

    it('encodes every filter field in the API form', () => {
        const query = audienceQuery({
            tiers: ['beta', 'free'],
            betaStatus: 'approved',
            signedUpAfter: '2026-07-01',
            signedUpBefore: '2026-09-01',
            activeWithinDays: 30,
            verifiedOnly: true,
            includeDeletionRequested: true,
        })
        const params = new URLSearchParams(query.slice(1))
        expect(query.startsWith('?')).toBe(true)
        expect(params.get('tiers')).toBe('beta,free')
        expect(params.get('betaStatus')).toBe('approved')
        expect(params.get('signedUpAfter')).toBe('2026-07-01')
        expect(params.get('signedUpBefore')).toBe('2026-09-01')
        expect(params.get('activeWithinDays')).toBe('30')
        expect(params.get('verifiedOnly')).toBe('true')
        expect(params.get('includeDeletionRequested')).toBe('true')
    })

    it('omits false booleans, empty tier lists and unknown keys', () => {
        const query = audienceQuery({
            tiers: [],
            verifiedOnly: false,
            includeDeletionRequested: false,
            ...({ retryOf: 'abc' } as object),
        })
        expect(query).toBe('')
    })

    it('the CSV download URL is same-origin and carries the same filter', () => {
        expect(audienceCsvUrl({ tiers: ['beta'], verifiedOnly: true })).toBe('/api/admin/audience/export.csv?tiers=beta&verifiedOnly=true')
    })
})
