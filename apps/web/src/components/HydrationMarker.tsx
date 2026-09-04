'use client'

import { useEffect } from 'react'

/**
 * Stamps `data-hydrated` on <html> once React has taken over the page. Server-rendered
 * forms are interactive-looking before that moment, but input typed into them is lost:
 * the e2e suite waits for this attribute after every navigation so it never races
 * hydration on a slow runner. Renders nothing.
 */
export function HydrationMarker() {
    useEffect(() => {
        document.documentElement.dataset.hydrated = ''
    }, [])
    return null
}
