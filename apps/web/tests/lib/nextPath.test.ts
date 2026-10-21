import { describe, expect, it } from 'vitest'

import { LIBRARY_PATH, nextPathFrom, withNext } from '@/lib/nextPath'

describe('nextPathFrom', () => {
    it('accepts only same-origin absolute paths', () => {
        expect(nextPathFrom('?next=%2Fs%2Fabc')).toBe('/s/abc')
        expect(nextPathFrom('?next=/pricing&x=1')).toBe('/pricing')
        expect(nextPathFrom('?next=//evil.example')).toBe('/scores')
        expect(nextPathFrom('?next=https://evil.example/')).toBe('/scores')
        expect(nextPathFrom('?next=/\\evil.example')).toBe('/scores')
        expect(nextPathFrom('?next=/\\/evil.example')).toBe('/scores')
        expect(nextPathFrom('')).toBe('/scores')
        expect(nextPathFrom('?other=1', '/beta')).toBe('/beta')
    })
})

describe('withNext', () => {
    it('appends an encoded next only when it says something', () => {
        expect(withNext('/signup', '/s/abc')).toBe('/signup?next=%2Fs%2Fabc')
        expect(withNext('/onboarding', '/scores')).toBe('/onboarding')
        expect(withNext('/onboarding', null)).toBe('/onboarding')
        // Only the bare library is implied; a filtered library view is a real destination.
        expect(withNext('/login', `${LIBRARY_PATH}?q=bach`)).toBe('/login?next=%2Fscores%3Fq%3Dbach')
    })
})
