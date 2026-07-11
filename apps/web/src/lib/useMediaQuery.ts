'use client'

import { useSyncExternalStore } from 'react'

/**
 * Reactive `window.matchMedia`: re-renders when the query flips. Resolves to
 * `false` during SSR — callers gate chrome that only exists client-side.
 */
export function useMediaQuery(query: string): boolean {
    return useSyncExternalStore(
        (onChange) => {
            const mql = window.matchMedia(query)
            mql.addEventListener('change', onChange)
            return () => mql.removeEventListener('change', onChange)
        },
        () => window.matchMedia(query).matches,
        () => false,
    )
}
