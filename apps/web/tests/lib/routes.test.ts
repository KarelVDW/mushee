import { describe, expect, it } from 'vitest'

import { isBetaAllowedPath, isPublicPath } from '@/lib/routes'

describe('isPublicPath', () => {
    it('opens the marketing, auth, legal and share pages', () => {
        for (const path of ['/', '/login', '/signup', '/reset-password', '/pricing', '/privacy', '/terms', '/contact']) {
            expect(isPublicPath(path), path).toBe(true)
        }
        expect(isPublicPath('/s/AbC-123_xyz')).toBe(true)
        expect(isPublicPath('/login/extra')).toBe(true)
    })

    it('keeps the app behind sign-in', () => {
        for (const path of ['/scores', '/scores/abc', '/settings', '/onboarding', '/beta']) {
            expect(isPublicPath(path), path).toBe(false)
        }
    })

    it('matches prefixes on segment boundaries only', () => {
        // '/' is exact, not a prefix of everything.
        expect(isPublicPath('/scores')).toBe(false)
        // '/s' (share links) must not open up its lookalikes.
        expect(isPublicPath('/s')).toBe(true)
        expect(isPublicPath('/sx')).toBe(false)
        expect(isPublicPath('/contact-sales')).toBe(false)
        expect(isPublicPath('/pricingx')).toBe(false)
    })
})

describe('isBetaAllowedPath', () => {
    it('lets a pending beta user reach the waiting room, onboarding and settings', () => {
        expect(isBetaAllowedPath('/beta')).toBe(true)
        expect(isBetaAllowedPath('/onboarding')).toBe(true)
        expect(isBetaAllowedPath('/settings')).toBe(true)
        expect(isBetaAllowedPath('/settings/billing')).toBe(true)
    })

    it('keeps the app and lookalike paths out', () => {
        expect(isBetaAllowedPath('/scores')).toBe(false)
        expect(isBetaAllowedPath('/scores/abc')).toBe(false)
        expect(isBetaAllowedPath('/betas')).toBe(false)
        expect(isBetaAllowedPath('/settingsx')).toBe(false)
    })
})
