import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The module keeps a session-level confirmation flag, so every test imports a
// fresh copy via resetModules + dynamic import.
async function loadMicMode(userAgent: string) {
    vi.resetModules()
    vi.stubGlobal('navigator', { userAgent })
    return import('@/lib/micMode')
}

const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1'
const IPHONE_CHROME_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.153 Mobile/15E148 Safari/604.1'
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Mobile Safari/537.36'
const MAC_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15'

describe('micMode', () => {
    beforeEach(() => {
        window.localStorage.clear()
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

    it('wants the guide on an iPhone until confirmed, then the reminder', async () => {
        const micMode = await loadMicMode(IPHONE_UA)
        expect(micMode.needsMicModeGuide()).toBe(true)
        expect(micMode.needsMicModeReminder()).toBe(false)

        micMode.markMicModeGuideConfirmed()
        expect(micMode.needsMicModeGuide()).toBe(false)
        expect(micMode.needsMicModeReminder()).toBe(true)
    })

    it('persists confirmation across sessions via localStorage', async () => {
        const first = await loadMicMode(IPHONE_UA)
        first.markMicModeGuideConfirmed()

        // Fresh module = new session; only localStorage carries the state over.
        const second = await loadMicMode(IPHONE_UA)
        expect(second.needsMicModeGuide()).toBe(false)
        expect(second.needsMicModeReminder()).toBe(true)
    })

    it('never wants guide or reminder off-iPhone', async () => {
        const micMode = await loadMicMode(ANDROID_UA)
        expect(micMode.needsMicModeGuide()).toBe(false)
        micMode.markMicModeGuideConfirmed()
        expect(micMode.needsMicModeReminder()).toBe(false)
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
            // Same session: the in-memory flag suppresses a second dialog.
            expect(micMode.needsMicModeGuide()).toBe(false)
            expect(micMode.needsMicModeReminder()).toBe(true)
        } finally {
            setItem.mockRestore()
            getItem.mockRestore()
        }
    })
})
