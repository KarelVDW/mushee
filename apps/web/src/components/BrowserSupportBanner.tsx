'use client'

import { useEffect, useState } from 'react'

import { Icon } from '@/components/ui'

const DISMISS_KEY = 'sheemu:unsupported-browser-dismissed'

/**
 * Whether the browser meets the app's CSS floor. Feature-detected, not
 * UA-sniffed: Tailwind v4 needs `color-mix()` and `@property`, which together
 * mean Chrome/Edge 111+, Safari 16.4+, Firefox 128+ — the same floor as the
 * Next.js compile target, so JS support follows automatically.
 */
export function meetsBrowserFloor(): boolean {
    return (
        typeof CSS !== 'undefined' &&
        typeof CSS.supports === 'function' &&
        CSS.supports('color', 'color-mix(in oklab, red, red)') &&
        typeof CSSPropertyRule !== 'undefined'
    )
}

/**
 * Warns users on browsers below the supported floor that pages may render
 * broken. Mounted app-wide in Providers; renders nothing on supported
 * browsers. Deliberately styled with pre-floor CSS only (solid fills, flex,
 * plain shadows) — this is the one component that must look right on the
 * browsers everything else is allowed to fail on.
 */
export function BrowserSupportBanner() {
    const [visible, setVisible] = useState(false)

    useEffect(() => {
        let dismissed = false
        try {
            dismissed = window.sessionStorage.getItem(DISMISS_KEY) === '1'
        } catch {
            // Storage unavailable (private mode) — treat as not dismissed.
        }
        if (!dismissed && !meetsBrowserFloor()) setVisible(true)
    }, [])

    const dismiss = () => {
        setVisible(false)
        try {
            window.sessionStorage.setItem(DISMISS_KEY, '1')
        } catch {
            // Storage unavailable — the dismissal just won't stick across pages.
        }
    }

    if (!visible) return null

    return (
        <div
            role="status"
            aria-label="Unsupported browser"
            className="fixed top-5 left-5 right-5 z-60 max-w-180 mx-auto bg-surface-container-lowest rounded-lg editorial-shadow px-5 py-3.5 flex items-center gap-4">
            <span className="w-7 h-7 rounded-full shrink-0 inline-flex items-center justify-center bg-error-container text-on-error-container">
                <Icon name="error" size={16} />
            </span>
            <p className="flex-1 font-body font-normal text-[14px] leading-normal text-on-surface m-0">
                This browser is older than Sheemu supports, so pages may not display correctly. For the full experience — including
                recording — use a recent Chrome, Edge, Firefox, or Safari.
            </p>
            <button
                type="button"
                aria-label="Dismiss"
                onClick={dismiss}
                className="bg-transparent border-0 p-1.5 cursor-pointer text-on-surface-variant hover:text-on-surface inline-flex shrink-0">
                <Icon name="x" size={14} />
            </button>
        </div>
    )
}
