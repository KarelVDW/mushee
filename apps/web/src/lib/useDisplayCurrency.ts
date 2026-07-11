'use client'

import { useEffect, useState } from 'react'

import { type Currency, detectDisplayCurrency } from './currency'

/**
 * The display currency for pricing surfaces. Server-rendered markup always
 * shows USD; the eurozone guess lands after hydration (a brief symbol swap
 * beats a hydration mismatch). What's charged is decided by Polar at
 * checkout, not by this hook.
 */
export function useDisplayCurrency(): Currency {
    const [currency, setCurrency] = useState<Currency>('usd')
    useEffect(() => setCurrency(detectDisplayCurrency()), [])
    return currency
}
