import posthog from 'posthog-js'

import { hasAnalyticsConsent, onConsentChange } from './consent'

/**
 * PostHog wiring — product analytics, web analytics, session replay, and
 * error tracking — in a two-tier consent model:
 *
 * - No key configured → everything here is a no-op.
 * - Base tier (everyone, no consent needed): cookieless anonymous capture.
 *   In-memory persistence and `person_profiles: 'identified_only'`, so
 *   nothing is written to the device and events stay PostHog "anonymous
 *   events" with no person profile — top-line usage data without touching
 *   ePrivacy storage. Session replay stays off.
 * - Consent tier (opt-in via the cookie banner): persistence moves to
 *   cookies/localStorage, events are identified with the account id, and
 *   session replay starts (inputs always masked).
 * - On withdrawal: identifiers are wiped (posthog.reset drops the ph_*
 *   cookie) and capture drops back to the anonymous base tier.
 *
 * Events are proxied through /ingest (next.config.ts rewrites) so ad
 * blockers don't silently blind us.
 */

const KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY
const UI_HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://eu.i.posthog.com'

let initialized = false

/** The signed-in user, remembered so a consent grant can identify retroactively. */
let currentUserId: string | null = null

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
        // Base tier: capture for everyone, but cookieless (nothing on the
        // device) and anonymous (no person profile until identify).
        persistence: 'memory',
        person_profiles: 'identified_only',
        // Error tracking: capture unhandled exceptions + rejections.
        capture_exceptions: true,
        // Session replay is consent-tier only; inputs always masked.
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
        posthog.startSessionRecording()
        // Link the session to the account now that we're allowed to.
        if (currentUserId && posthog.get_distinct_id() !== currentUserId) {
            posthog.identify(currentUserId)
        }
    } else {
        // Wipe identifiers persisted while consent was granted (withdrawal
        // must remove the ph_* cookie/localStorage, not just unlink), then
        // continue capturing anonymously in memory.
        posthog.stopSessionRecording()
        posthog.reset()
        posthog.set_config({ persistence: 'memory', disable_session_recording: true })
    }
}

/** Track a product event. Safe to call anywhere — anonymous without consent,
 *  account-linked with it; no-op without a key. */
export function track(event: string, properties?: Record<string, unknown>): void {
    if (!initialized) return
    posthog.capture(event, properties)
}

/** Tie events to the signed-in account — only once the user consented, and
 *  id only, never email/name: the privacy policy describes replays/analytics
 *  as pseudonymous, so the profile must not carry direct identifiers. */
export function identifyUser(user: { id: string; email?: string; name?: string }): void {
    if (!initialized) return
    currentUserId = user.id
    if (!hasAnalyticsConsent()) return
    if (posthog.get_distinct_id() === user.id) return
    posthog.identify(user.id)
}

/** Set person properties on the account profile — consent-gated like
 *  identifyUser, and categorical values only, never free text or direct
 *  identifiers: the profile must stay pseudonymous. Without consent the
 *  same facts still travel as anonymous event properties. */
export function setUserProperties(properties: Record<string, unknown>): void {
    if (!initialized || !hasAnalyticsConsent()) return
    posthog.setPersonProperties(properties)
}

/** On sign-out: unlink the device from the account. */
export function resetAnalyticsIdentity(): void {
    currentUserId = null
    if (!initialized) return
    posthog.reset()
}

/** Error tracking — manual capture for caught errors / error boundaries. */
export function captureException(error: unknown, properties?: Record<string, unknown>): void {
    if (!initialized) return
    posthog.captureException(error, properties)
}
