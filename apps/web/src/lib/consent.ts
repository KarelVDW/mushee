/**
 * GDPR cookie-consent store. One consent record, versioned so a future
 * change in what we track re-prompts everyone. 'necessary' (session cookie,
 * the consent choice itself) needs no consent; anonymous cookieless usage
 * stats also run without consent (legitimate interest — nothing stored on
 * the device, no identity). The 'analytics' toggle is the opt-in upgrade:
 * session replay, account-linked analytics, and the persistent ph_* cookie.
 */

/** Bump when the categories or their meaning change — users get re-asked.
 *  v2 (2026-07-11): base analytics became always-on anonymous/cookieless;
 *  the consent toggle now covers replay + account linking + the cookie. */
export const CONSENT_VERSION = 2

const STORAGE_KEY = 'solkey:consent'

export interface ConsentRecord {
    version: number
    analytics: boolean
    decidedAt: string
}

type Listener = (consent: ConsentRecord) => void

const listeners = new Set<Listener>()

/** The stored decision, or null when the user hasn't chosen yet (or the
 *  stored record predates CONSENT_VERSION and must be re-asked). */
export function getConsent(): ConsentRecord | null {
    if (typeof window === 'undefined') return null
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY)
        if (!raw) return null
        const parsed = JSON.parse(raw) as Partial<ConsentRecord>
        if (parsed.version !== CONSENT_VERSION || typeof parsed.analytics !== 'boolean') return null
        return parsed as ConsentRecord
    } catch {
        // localStorage unavailable (private mode) — treat as undecided.
        return null
    }
}

export function hasAnalyticsConsent(): boolean {
    return getConsent()?.analytics === true
}

/** Persist a decision and notify subscribers (analytics wiring, UI). */
export function saveConsent(analytics: boolean): ConsentRecord {
    const record: ConsentRecord = {
        version: CONSENT_VERSION,
        analytics,
        decidedAt: new Date().toISOString(),
    }
    try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(record))
    } catch {
        // Not persistable — the choice still applies for this page load.
    }
    for (const listener of listeners) listener(record)
    return record
}

/** Forget the decision — the banner shows again on next load. */
export function clearConsent(): void {
    try {
        window.localStorage.removeItem(STORAGE_KEY)
    } catch {
        // Nothing stored anyway.
    }
}

export function onConsentChange(listener: Listener): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
}
