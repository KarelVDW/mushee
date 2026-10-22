import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The module keeps a session-level confirmation flag, so every test imports a
// fresh copy via resetModules + dynamic import.
async function loadMicMode(userAgent: string) {
    vi.resetModules()
    vi.stubGlobal('navigator', { userAgent })
    return import('@/lib/micMode')
}

const IPHONE_UA =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1'
const IPHONE_CHROME_UA =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.153 Mobile/15E148 Safari/604.1'
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Mobile Safari/537.36'
const MAC_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15'

describe('micMode', () => {
    beforeEach(() => {
        window.localStorage.clear()
        window.sessionStorage.clear()
    })

    afterEach(() => {
        vi.unstubAllGlobals()
    })

    it('detects iPhones across browsers, and nothing else', async () => {
        expect((await loadMicMode(IPHONE_UA)).isIPhone()).toBe(true)
        expect((await loadMicMode(IPHONE_CHROME_UA)).isIPhone()).toBe(true)
        expect((await loadMicMode(ANDROID_UA)).isIPhone()).toBe(false)
        // iPads report a desktop UA since iPadOS 13 — deliberately not matched.
        expect((await loadMicMode(MAC_UA)).isIPhone()).toBe(false)
    })

    it('wants the guide on an iPhone until confirmed, then the reminder once per session', async () => {
        const micMode = await loadMicMode(IPHONE_UA)
        expect(micMode.needsMicModeGuide()).toBe(true)
        expect(micMode.takeMicModeReminder()).toBe(false)

        micMode.markMicModeGuideConfirmed()
        expect(micMode.needsMicModeGuide()).toBe(false)
        expect(micMode.takeMicModeReminder()).toBe(true)
        // Spent: later takes in this session get no reminder.
        expect(micMode.takeMicModeReminder()).toBe(false)
    })

    it('persists confirmation across visits via localStorage, the reminder per browser session', async () => {
        const first = await loadMicMode(IPHONE_UA)
        first.markMicModeGuideConfirmed()
        expect(first.takeMicModeReminder()).toBe(true)

        // A reload in the same browser session: confirmed, and already reminded.
        const reload = await loadMicMode(IPHONE_UA)
        expect(reload.needsMicModeGuide()).toBe(false)
        expect(reload.takeMicModeReminder()).toBe(false)

        // A new browser session reminds once more.
        window.sessionStorage.clear()
        const next = await loadMicMode(IPHONE_UA)
        expect(next.takeMicModeReminder()).toBe(true)
    })

    it('a walkthrough just done spends the reminder for the session', async () => {
        const micMode = await loadMicMode(IPHONE_UA)
        micMode.markMicModeGuideConfirmed()
        micMode.markMicModeReminded()
        expect(micMode.takeMicModeReminder()).toBe(false)
    })

    it('"Record without it" snoozes the guide for this visit only, without confirming', async () => {
        const micMode = await loadMicMode(IPHONE_UA)
        micMode.snoozeMicModeGuide()
        expect(micMode.needsMicModeGuide()).toBe(false)
        // Not an attestation: no reminder, and the guide is back on the next visit.
        expect(micMode.takeMicModeReminder()).toBe(false)
        expect((await loadMicMode(IPHONE_UA)).needsMicModeGuide()).toBe(true)
    })

    it('never wants guide or reminder off-iPhone', async () => {
        const micMode = await loadMicMode(ANDROID_UA)
        expect(micMode.needsMicModeGuide()).toBe(false)
        micMode.markMicModeGuideConfirmed()
        expect(micMode.takeMicModeReminder()).toBe(false)
    })

    it('falls back to a session flag when localStorage throws (private mode)', async () => {
        const micMode = await loadMicMode(IPHONE_UA)
        const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('QuotaExceededError')
        })
        const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('SecurityError')
        })
        try {
            expect(micMode.needsMicModeGuide()).toBe(true)
            expect(() => micMode.markMicModeGuideConfirmed()).not.toThrow()
            // Same session: the in-memory flag suppresses a second dialog, and the reminder still shows once.
            expect(micMode.needsMicModeGuide()).toBe(false)
            expect(micMode.takeMicModeReminder()).toBe(true)
            expect(micMode.takeMicModeReminder()).toBe(false)
            expect(() => micMode.markMicModeReminded()).not.toThrow()
        } finally {
            setItem.mockRestore()
            getItem.mockRestore()
        }
    })
})
