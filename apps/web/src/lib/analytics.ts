import posthog from 'posthog-js'

import { hasAnalyticsConsent, onConsentChange } from './consent'

/**
 * PostHog wiring — product analytics, web analytics, session replay, and
 * error tracking — strictly gated behind cookie consent:
 *
 * - No key configured → everything here is a no-op.
 * - Initialized opted-out with in-memory persistence, so before (or without)
 *   consent PostHog stores nothing and sends nothing.
 * - On consent: opt in, move persistence to cookies/localStorage, start
 *   session recording, and backfill the current pageview.
 * - On withdrawal: opt back out and drop to memory persistence.
 *
 * Events are proxied through /ingest (next.config.ts rewrites) so ad
 * blockers don't silently blind us.
 */

const KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY
const UI_HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://eu.i.posthog.com'

let initialized = false

export function isAnalyticsEnabled(): boolean {
    return initialized
}

export function initAnalytics(): void {
    if (initialized || !KEY || typeof window === 'undefined') return
    initialized = true

    posthog.init(KEY, {
        api_host: '/ingest',
        ui_host: UI_HOST.replace('.i.posthog.com', '.posthog.com'),
        defaults: '2026-05-30',
        // Consent-first: nothing leaves the browser until opt-in.
        opt_out_capturing_by_default: true,
        persistence: 'memory',
        // Error tracking: capture unhandled exceptions + rejections.
        capture_exceptions: true,
        // Session replay starts only after consent; inputs always masked.
        disable_session_recording: true,
        session_recording: {
            maskAllInputs: true,
        },
    })

    applyConsent(hasAnalyticsConsent())
    onConsentChange((consent) => applyConsent(consent.analytics))
}

function applyConsent(granted: boolean): void {
    if (!initialized) return
    if (granted) {
        posthog.set_config({ persistence: 'localStorage+cookie', disable_session_recording: false })
        if (posthog.has_opted_out_capturing()) {
            posthog.opt_in_capturing({ captureEventName: null })
            // The initial pageview fired while opted out; recapture it.
            posthog.capture('$pageview')
        }
        posthog.startSessionRecording()
    } else {
        posthog.opt_out_capturing()
        // Clear identifiers persisted while consent was granted (withdrawal
        // must remove the ph_* cookie/localStorage, not just stop capture),
        // then drop back to memory-only persistence.
        posthog.reset()
        posthog.set_config({ persistence: 'memory', disable_session_recording: true })
    }
}

/** Track a product event. Safe to call anywhere — no-op without consent/key. */
export function track(event: string, properties?: Record<string, unknown>): void {
    if (!initialized) return
    posthog.capture(event, properties)
}

/** Tie events to the signed-in account. Id only — never email/name: the
 *  privacy policy describes replays/analytics as pseudonymous, so the profile
 *  must not carry direct identifiers. */
export function identifyUser(user: { id: string; email?: string; name?: string }): void {
    if (!initialized) return
    if (posthog.get_distinct_id() === user.id) return
    posthog.identify(user.id)
}

/** On sign-out: unlink the device from the account. */
export function resetAnalyticsIdentity(): void {
    if (!initialized) return
    posthog.reset()
}

/** Error tracking — manual capture for caught errors / error boundaries. */
export function captureException(error: unknown, properties?: Record<string, unknown>): void {
    if (!initialized) return
    posthog.captureException(error, properties)
}
