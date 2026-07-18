import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
    clearConsent,
    CONSENT_VERSION,
    type ConsentRecord,
    getConsent,
    hasAnalyticsConsent,
    onConsentChange,
    saveConsent,
} from '@/lib/consent'

describe('consent store', () => {
    beforeEach(() => {
        clearConsent()
    })

    it('starts undecided', () => {
        expect(getConsent()).toBeNull()
        expect(hasAnalyticsConsent()).toBe(false)
    })

    it('persists an accept-all decision', () => {
        saveConsent(true)
        const stored = getConsent()
        expect(stored?.analytics).toBe(true)
        expect(stored?.version).toBe(CONSENT_VERSION)
        expect(stored?.decidedAt).toBeTruthy()
        expect(hasAnalyticsConsent()).toBe(true)
    })

    it('persists an essential-only decision', () => {
        saveConsent(false)
        expect(getConsent()?.analytics).toBe(false)
        expect(hasAnalyticsConsent()).toBe(false)
    })

    it('re-asks when the stored record predates the current version', () => {
        saveConsent(true)
        const raw = JSON.parse(window.localStorage.getItem('solkey:consent') ?? '{}') as { version: number }
        raw.version = CONSENT_VERSION - 1
        window.localStorage.setItem('solkey:consent', JSON.stringify(raw))
        expect(getConsent()).toBeNull()
    })

    it('treats corrupted storage as undecided', () => {
        window.localStorage.setItem('solkey:consent', 'not json {')
        expect(getConsent()).toBeNull()
    })

    it('notifies subscribers on every decision and stops after unsubscribe', () => {
        const listener = vi.fn<(consent: ConsentRecord) => void>()
        const unsubscribe = onConsentChange(listener)

        saveConsent(true)
        expect(listener).toHaveBeenCalledTimes(1)
        expect(listener.mock.calls[0][0].analytics).toBe(true)

        saveConsent(false)
        expect(listener).toHaveBeenCalledTimes(2)

        unsubscribe()
        saveConsent(true)
        expect(listener).toHaveBeenCalledTimes(2)
    })

    it('clearConsent forgets the decision', () => {
        saveConsent(true)
        clearConsent()
        expect(getConsent()).toBeNull()
    })
})
