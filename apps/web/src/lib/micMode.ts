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
 * on the device's first recording, then one quiet line in the recording
 * strip's count-in, at most once per browser session, on later ones.
 * One more wrinkle: the Mic Mode tile only exists in Control Center while an
 * app is actively capturing, so the guide dialog runs over a live warm-up mic
 * stream (opened by useRecording before the dialog shows) — otherwise the
 * walkthrough asks for steps the user can't perform yet.
 */

const STORAGE_KEY = 'solkey:mic-mode-guide'
/** sessionStorage: the reminder already showed in this browser session. */
const REMINDER_KEY = 'solkey:mic-mode-reminded'

/** In-memory fallback so private-mode users (localStorage writes throw) still
 *  see the invasive dialog at most once per session. */
let confirmedThisSession = false
/** "Record without it": the guide stays out of the way for the rest of this visit
 *  (never persisted, so it comes back next time — the setting still matters). */
let guideSnoozed = false
/** In-memory twin of {@link REMINDER_KEY}, for when sessionStorage is unavailable. */
let remindedThisSession = false

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

/** First recording on this device: block and show the Wide Spectrum walkthrough (unless snoozed for this visit). */
export function needsMicModeGuide(): boolean {
    return isIPhone() && !hasConfirmed() && !guideSnoozed
}

/** "Record without it": skip the guide for the rest of this visit, without attesting the setting. */
export function snoozeMicModeGuide(): void {
    guideSnoozed = true
}

/**
 * Whether this take's count-in should carry the Mic Mode reminder: on an iPhone whose user
 * confirmed the guide before, once per browser session. Asking spends it — the next take in
 * this session gets no reminder.
 */
export function takeMicModeReminder(): boolean {
    if (!isIPhone() || !hasConfirmed() || remindedThisSession) return false
    remindedThisSession = true
    try {
        if (window.sessionStorage.getItem(REMINDER_KEY) !== null) return false
        window.sessionStorage.setItem(REMINDER_KEY, '1')
    } catch {
        // Storage unavailable — the in-memory flag above still keeps it to once per page.
    }
    return true
}

/** The reminder is moot this session (the user just walked through the guide): don't show it. */
export function markMicModeReminded(): void {
    remindedThisSession = true
    try {
        window.sessionStorage.setItem(REMINDER_KEY, '1')
    } catch {
        // Storage unavailable — the in-memory flag above still holds for this page.
    }
}

export function markMicModeGuideConfirmed(): void {
    confirmedThisSession = true
    try {
        window.localStorage.setItem(STORAGE_KEY, new Date().toISOString())
    } catch {
        // Private mode — the session flag above still suppresses repeats.
    }
}
