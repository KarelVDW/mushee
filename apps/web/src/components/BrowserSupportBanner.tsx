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
 * a quiet white strip with a plain way forward (on iPhone and iPad, Safari updates with iOS),
 * its first sentence saying what is off and the rest how to fix it. Mounted first in
 * Providers, so on document-flow pages it sits in the flow above the nav, its content on the
 * marketing container (in line with the wordmark), and covers nothing; on the full-height
 * editor and library (/scores…) it floats instead, so their docked chrome isn't pushed off
 * screen — a card bottom left above the dock on desktop, under the header on phones, never
 * over the transport. Dismissible either way. Renders nothing on supported browsers.
 * Deliberately styled with pre-floor CSS only (solid fills, flex, plain shadows — the
 * `overlay-shadow` class rather than the shadow utility) — this is the one component that
 * must look right on the browsers everything else is allowed to fail on.
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
            className={
                overlay
                    ? [
                          'fixed z-(--z-banner) rounded-lg bg-surface-container-lowest overlay-shadow',
                          // Phones: under the header. Wider: bottom left, above the dock. The editor and its
                          // loading skeleton publish both heights; unpublished (the library and its other
                          // screens), the header is the library's nav: py-3.5 around a control-md row.
                          'inset-x-4 top-[calc(var(--app-header-h,calc(var(--control-md)+1.75rem))+8px)]',
                          'md:inset-x-auto md:left-4 md:top-auto md:bottom-[calc(var(--dock-h,0px)+12px)] md:max-w-sm',
                      ].join(' ')
                    : 'relative w-full bg-surface-container-lowest tonal-layer-glow'
            }>
            <div className={['flex items-center gap-3', overlay ? 'pl-4 pr-2 py-3' : 'max-w-320 mx-auto px-5 sm:px-8 py-3'].join(' ')}>
                <span className="shrink-0 inline-flex text-on-surface-variant">
                    <Icon name="info" size={18} />
                </span>
                <p className="flex-1 max-w-[72ch] m-0 font-body font-normal text-[13px] md:text-[14px] leading-normal text-on-surface-variant">
                    <span className="font-medium text-on-surface">
                        Your browser is a bit old for Solkey, so some things may look off and recording may not work.
                    </span>{' '}
                    Update it — on iPhone or iPad, that means updating iOS — or open Solkey in a recent Chrome, Edge, Firefox or Safari.
                </p>
                {/* A plain 40px button (no CloseButton): its touch floor is a pointer-coarse variant, this one is always 40px. */}
                <button
                    type="button"
                    aria-label="Dismiss"
                    onClick={dismiss}
                    className="shrink-0 ml-auto w-10 h-10 inline-flex items-center justify-center rounded-full bg-transparent border-0 cursor-pointer text-on-surface-variant hover:text-on-surface focus-ring">
                    <Icon name="x" size={16} />
                </button>
            </div>
        </div>
    )
}
