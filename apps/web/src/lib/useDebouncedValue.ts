'use client'

import { useEffect, useState } from 'react'

/** The latest value, but only after it has stopped changing for `delayMs`. */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
    const [debounced, setDebounced] = useState(value)

    useEffect(() => {
        const timeout = setTimeout(() => setDebounced(value), delayMs)
        return () => clearTimeout(timeout)
    }, [value, delayMs])

    return debounced
}
