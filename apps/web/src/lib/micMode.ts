/**
 * iPhone Mic Mode education state.
 *
 * iOS voice processing silently strips whistling and instrument tones out of
 * `getUserMedia` audio, WebKit never parses the `noiseSuppression` /
 * `autoGainControl` constraints that would disable it, and the governing
 * Control Center "Mic Mode" setting is user-only — no API can read or set it
 * (verified against WebKit source + Apple docs, 2026-07). Only "Wide
 * Spectrum" leaves music unfiltered, and the user's choice persists per app.
 * So the one lever left to a web app is education: a full walkthrough dialog
 * on the device's first recording, then a light toast reminder on later ones.
 * One more wrinkle: the Mic Mode tile only exists in Control Center while an
 * app is actively capturing, so the guide dialog runs over a live warm-up mic
 * stream (opened by useRecording before the dialog shows) — otherwise the
 * walkthrough asks for steps the user can't perform yet.
 */

const STORAGE_KEY = 'solkey:mic-mode-guide'

/** In-memory fallback so private-mode users (localStorage writes throw) still
 *  see the invasive dialog at most once per session. */
let confirmedThisSession = false

/**
 * iPhones only: iPads have reported a desktop UA since iPadOS 13 and aren't
 * where the Mic Mode complaints come from. Every iPhone browser (Safari,
 * CriOS, FxiOS) is WebKit under the hood and carries "iPhone" in the UA.
 */
export function isIPhone(): boolean {
    return typeof navigator !== 'undefined' && /iPhone/.test(navigator.userAgent)
}

function hasConfirmed(): boolean {
    if (confirmedThisSession) return true
    try {
        return window.localStorage.getItem(STORAGE_KEY) !== null
    } catch {
        return false
    }
}

/** First recording on this device: block and show the Wide Spectrum walkthrough. */
export function needsMicModeGuide(): boolean {
    return isIPhone() && !hasConfirmed()
}

/** Later recordings: the guide was confirmed before, nudge with a toast instead. */
export function needsMicModeReminder(): boolean {
    return isIPhone() && hasConfirmed()
}

export function markMicModeGuideConfirmed(): void {
    confirmedThisSession = true
    try {
        window.localStorage.setItem(STORAGE_KEY, new Date().toISOString())
    } catch {
        // Private mode — the session flag above still suppresses repeats.
    }
}
