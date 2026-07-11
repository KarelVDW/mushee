import { describe, expect, it } from 'vitest'

import { currencySymbol, formatMoney, isEurozone } from '@/lib/currency'

describe('formatMoney', () => {
    it('swaps only the symbol — numerals are parity-priced', () => {
        expect(formatMoney(9, 'usd')).toBe('$9')
        expect(formatMoney(9, 'eur')).toBe('€9')
        expect(formatMoney(490, 'eur')).toBe('€490')
        expect(currencySymbol('usd')).toBe('$')
        expect(currencySymbol('eur')).toBe('€')
    })
})

describe('isEurozone', () => {
    it('detects eurozone regions from locale subtags', () => {
        expect(isEurozone(['nl-BE'])).toBe(true)
        expect(isEurozone(['de-DE', 'en-US'])).toBe(true)
        expect(isEurozone(['fr-FR'])).toBe(true)
        expect(isEurozone(['en-US'])).toBe(false)
    })

    it('does not treat non-euro Europe as eurozone', () => {
        expect(isEurozone(['en-GB'])).toBe(false)
        expect(isEurozone(['sv-SE'])).toBe(false)
        expect(isEurozone(['pl-PL'])).toBe(false)
        expect(isEurozone(['de-CH'])).toBe(false)
        expect(isEurozone([], 'Europe/London')).toBe(false)
        expect(isEurozone([], 'Europe/Zurich')).toBe(false)
    })

    it('the first locale with a region decides, even over the time zone', () => {
        // An American in Berlin keeps USD display; checkout geolocation may
        // still charge EUR — display is only a guess.
        expect(isEurozone(['en-US'], 'Europe/Berlin')).toBe(false)
        expect(isEurozone(['nl-BE'], 'America/New_York')).toBe(true)
    })

    it('falls back to the time zone when no locale names a region', () => {
        expect(isEurozone(['nl'], 'Europe/Brussels')).toBe(true)
        expect(isEurozone(['en'], 'America/New_York')).toBe(false)
        expect(isEurozone([], undefined)).toBe(false)
    })

    it('survives malformed locale tags', () => {
        expect(isEurozone(['not a locale', 'nl-BE'])).toBe(true)
    })
})
