/**
 * Display currency for the pricing surfaces. Numerals are identical in both
 * currencies (parity pricing: $9 ↔ €9 — configure the Polar products the same
 * way); only the symbol swaps, so the catalogue needs no per-currency prices.
 *
 * Display is a best-effort locale guess; the currency actually charged is
 * decided by Polar at checkout from the customer's geolocation (the API
 * forwards the client IP when creating the session).
 */

export type Currency = 'usd' | 'eur'

export function currencySymbol(currency: Currency): string {
    return currency === 'eur' ? '€' : '$'
}

export function formatMoney(amount: number, currency: Currency): string {
    return `${currencySymbol(currency)}${amount}`
}

/** The 20 eurozone members (2026). Other EU/European countries (SE, DK, PL,
 *  CZ, HU, RO, BG, CH, GB, NO…) don't pay in euro and stay on USD display. */
const EUROZONE = new Set([
    'AT', 'BE', 'HR', 'CY', 'EE', 'FI', 'FR', 'DE', 'GR', 'IE',
    'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PT', 'SK', 'SI', 'ES',
])

/** IANA zones of the eurozone, for locales without a region subtag. */
const EUROZONE_TIMEZONES = new Set([
    'Europe/Amsterdam', 'Europe/Athens', 'Europe/Berlin', 'Europe/Bratislava',
    'Europe/Brussels', 'Europe/Busingen', 'Europe/Dublin', 'Europe/Helsinki',
    'Europe/Lisbon', 'Europe/Ljubljana', 'Europe/Luxembourg', 'Europe/Madrid',
    'Europe/Malta', 'Europe/Nicosia', 'Europe/Paris', 'Europe/Riga',
    'Europe/Rome', 'Europe/Tallinn', 'Europe/Vatican', 'Europe/Vienna',
    'Europe/Vilnius', 'Europe/Zagreb', 'Asia/Nicosia', 'Atlantic/Azores',
    'Atlantic/Canary', 'Atlantic/Madeira',
])

/**
 * Pure eurozone check over locale tags (`nl-BE`, `fr`) and an IANA time
 * zone. A locale's region subtag wins; the time zone only breaks ties when
 * no locale names a region.
 */
export function isEurozone(locales: readonly string[], timeZone?: string): boolean {
    for (const locale of locales) {
        const region = localeRegion(locale)
        if (region) return EUROZONE.has(region)
    }
    return timeZone !== undefined && EUROZONE_TIMEZONES.has(timeZone)
}

function localeRegion(locale: string): string | null {
    try {
        return new Intl.Locale(locale).region ?? null
    } catch {
        return null
    }
}

/** Browser-side guess of the display currency. */
export function detectDisplayCurrency(): Currency {
    if (typeof navigator === 'undefined') return 'usd'
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
    return isEurozone(navigator.languages ?? [navigator.language], timeZone) ? 'eur' : 'usd'
}
