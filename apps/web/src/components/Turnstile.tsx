'use client'

import Script from 'next/script'
import { useCallback, useEffect, useRef } from 'react'

/** The Cloudflare Turnstile site key; unset = the signup form renders no CAPTCHA (dev, tests). */
export const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim() || undefined

interface TurnstileApi {
    render(container: HTMLElement, options: Record<string, unknown>): string
    remove(widgetId: string): void
}

declare global {
    interface Window {
        turnstile?: TurnstileApi
    }
}

interface TurnstileProps {
    siteKey: string
    /** A fresh token when the challenge passes; null when it expires or fails and a new one is needed. */
    onToken: (token: string | null) => void
}

/**
 * Cloudflare Turnstile widget (the signup CAPTCHA). Loads the API script once
 * and renders explicitly into its own container so React owns the DOM around
 * it; the token reaches better-auth as the `x-captcha-response` header (see
 * the API's captcha-config.ts). Remount (change the `key`) to reset it after a
 * rejected signup — Turnstile tokens are single-use.
 */
export function Turnstile({ siteKey, onToken }: TurnstileProps) {
    const container = useRef<HTMLDivElement>(null)
    const widgetId = useRef<string | undefined>(undefined)
    const onTokenRef = useRef(onToken)
    onTokenRef.current = onToken

    const render = useCallback(() => {
        if (!container.current || !window.turnstile || widgetId.current) return
        widgetId.current = window.turnstile.render(container.current, {
            sitekey: siteKey,
            theme: 'light',
            appearance: 'always',
            callback: (token: string) => onTokenRef.current(token),
            'expired-callback': () => onTokenRef.current(null),
            'error-callback': () => onTokenRef.current(null),
        })
    }, [siteKey])

    useEffect(() => {
        render() // the script may already be loaded (e.g. a remount)
        return () => {
            if (widgetId.current) window.turnstile?.remove(widgetId.current)
            widgetId.current = undefined
        }
    }, [render])

    return (
        <>
            <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" strategy="afterInteractive" onLoad={render} />
            <div ref={container} data-testid="turnstile" className="min-h-16 flex justify-center" />
        </>
    )
}
