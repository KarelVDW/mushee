'use client'

import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'

import { Icon } from '@/components/ui'

const DISMISS_KEY = 'solkey:unsupported-browser-dismissed'

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
 * Advises users on browsers below the supported floor to update — advice, not an error:
 * a neutral strip with a plain way forward (on iPhone and iPad, Safari updates with iOS).
 * Mounted first in Providers, so on document-flow pages it sits in the flow above the nav
 * and covers nothing; on the full-height editor and library (/scores…) it floats over the
 * top instead, so their docked chrome isn't pushed off screen. Dismissible either way.
 * Renders nothing on supported browsers. Deliberately styled with pre-floor CSS only (solid
 * fills, flex, plain shadows) — this is the one component that must look right on the
 * browsers everything else is allowed to fail on.
 */
export function BrowserSupportBanner() {
    const [visible, setVisible] = useState(false)
    const pathname = usePathname()
    const overlay = pathname?.startsWith('/scores') ?? false

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
            className={[
                'bg-surface-container-high px-5 py-3 flex items-center gap-3',
                overlay ? 'fixed top-5 left-5 right-5 z-(--z-banner) max-w-180 mx-auto rounded-lg editorial-shadow' : 'relative w-full',
            ].join(' ')}>
            <span className="shrink-0 inline-flex text-on-surface-variant">
                <Icon name="alert-triangle" size={18} />
            </span>
            <p className="flex-1 font-body font-normal text-[14px] leading-normal text-on-surface m-0">
                Your browser is a bit old for Solkey, so some things may look off and recording may not work. Update it — on iPhone or iPad,
                that means updating iOS — or open Solkey in a recent Chrome, Edge, Firefox or Safari.
            </p>
            {/* A plain 40px button (no CloseButton): its touch floor is a pointer-coarse variant, this one is always 40px. */}
            <button
                type="button"
                aria-label="Dismiss"
                onClick={dismiss}
                className="shrink-0 w-10 h-10 inline-flex items-center justify-center rounded-full bg-transparent border-0 cursor-pointer text-on-surface-variant hover:text-on-surface focus-ring">
                <Icon name="x" size={16} />
            </button>
        </div>
    )
}
