import { describe, expect, it } from 'vitest'

import { MicFailure, RecordingLimitCopy, type RecordingStatus, RecordingStripCopy, TakeSummaryCopy } from '@/app/scores/[id]/RecordingCopy'
import { RecordingUnsupportedError } from '@/lib/Microphone'

const status = (over: Partial<RecordingStatus> = {}): RecordingStatus => ({
    phase: 'recording',
    countoff: null,
    captureStartedAt: 0,
    health: 'ok',
    micModeReminder: false,
    secondsLeftAtStart: null,
    startBar: 1,
    ...over,
})

describe('RecordingStripCopy', () => {
    it('reads "Get ready" through the count-in and "Recording" after, leaving the state words out of its live region', () => {
        const countoff = new RecordingStripCopy(status({ phase: 'countoff', captureStartedAt: null }), 0, false)
        expect(countoff.label).toBe('Get ready')
        // The editor's announcer says 'Get ready' and 'Recording': the strip's region stays quiet, so neither is heard twice.
        expect(countoff.news).toBeNull()
        const live = new RecordingStripCopy(status(), 7, false)
        expect(live.label).toBe('Recording')
        expect(live.news).toBeNull()
    })

    it('says where the recording goes through the count-in, in the strip and to a screen reader alike', () => {
        const countoff = new RecordingStripCopy(status({ phase: 'countoff', captureStartedAt: null, startBar: 3 }), 0, true)
        expect(countoff.startsFrom).toBe('from bar 3')
        expect(new RecordingStripCopy(status({ startBar: 3 }), 2, true).startsFrom).toBeNull()
        expect(RecordingStripCopy.countInAnnouncement(3)).toBe('Get ready, from bar 3.')
    })

    it('says how to stop while recording — by tap on a phone, by Space or the stop square elsewhere', () => {
        expect(new RecordingStripCopy(status(), 3, true).hint).toEqual({ kind: 'stop', touch: true })
        expect(new RecordingStripCopy(status(), 3, false).hint).toEqual({ kind: 'stop', touch: false })
    })

    it('carries the iPhone Mic Mode reminder in the count-in only, and nothing else there', () => {
        const reminded = status({ phase: 'countoff', micModeReminder: true })
        expect(new RecordingStripCopy(reminded, 0, true).hint).toEqual({
            kind: 'mic-mode',
            text: 'iPhone: keep Mic Mode on Wide Spectrum.',
        })
        expect(new RecordingStripCopy(status({ phase: 'countoff' }), 0, true).hint).toBeNull()
        // Once recording, the reminder gives way to the stop hint.
        expect(new RecordingStripCopy(status({ micModeReminder: true }), 1, true).hint?.kind).toBe('stop')
    })

    it('counts down the last minute of a capped day (packs included by the caller), and never below zero', () => {
        const capped = status({ secondsLeftAtStart: 90 })
        expect(new RecordingStripCopy(capped, 20, false).hint?.kind).toBe('stop')
        expect(new RecordingStripCopy(capped, 30, false).hint).toEqual({ kind: 'time-left', text: '1 min left today' })
        expect(new RecordingStripCopy(capped, 60, false).hint).toEqual({ kind: 'time-left', text: '30 sec left today' })
        expect(new RecordingStripCopy(capped, 200, false).secondsLeft).toBe(0)
        // An uncapped plan never counts down.
        expect(new RecordingStripCopy(status(), 5000, false).secondsLeft).toBeNull()
    })

    it('puts a transcription outage first — line and live region — then "Notes are back."', () => {
        const down = new RecordingStripCopy(status({ health: 'down', phase: 'countoff', micModeReminder: true }), 0, true)
        expect(down.hint).toEqual({ kind: 'warning', text: RecordingStripCopy.WARNING })
        expect(down.news).toBe("Solkey can't write notes right now. Your audio is saved — these minutes are free.")
        const back = new RecordingStripCopy(status({ health: 'back', secondsLeftAtStart: 10 }), 5, true)
        expect(back.hint).toEqual({ kind: 'recovered', text: 'Notes are back.' })
        expect(back.news).toBe('Notes are back.')
    })
})

describe('TakeSummaryCopy', () => {
    const summary = (over: Partial<ConstructorParameters<typeof TakeSummaryCopy>[0]> = {}) =>
        new TakeSummaryCopy({ firstBar: 3, lastBar: 6, wrotePitchedNotes: true, touch: true, iPhone: false, ...over })

    it('names the bars it added and the next step, per device', () => {
        expect(summary().toast).toBe('Added bars 3–6. Tap any note to fix it.')
        expect(summary({ touch: false }).toast).toBe('Added bars 3–6. Click any note to fix it.')
        expect(summary({ lastBar: 3 }).toast).toBe('Added bar 3. Tap any note to fix it.')
    })

    it('announces the stop in words a screen reader reads well', () => {
        expect(summary().announcement).toBe('Recording stopped. Added bars 3 to 6.')
        expect(summary({ lastBar: 3 }).announcement).toBe('Recording stopped. Added bar 3.')
        expect(summary({ wrotePitchedNotes: false }).announcement).toBe('Recording stopped. No notes this time.')
    })

    it('with no notes, suggests the mic — and on an iPhone, the Mic Mode setting', () => {
        expect(summary({ wrotePitchedNotes: false }).toast).toBe('No notes this time — try a little closer to the mic.')
        expect(summary({ wrotePitchedNotes: false, iPhone: true }).toast).toBe(
            'No notes this time — try a little closer to the mic. On iPhone, open Control Center → Mic Mode and choose Wide Spectrum.',
        )
    })
})

describe('MicFailure', () => {
    it('turns a refused permission into the blocked-mic dialog, everything else into a plain toast', () => {
        expect(MicFailure.problemFor(new DOMException('no', 'NotAllowedError'))).toEqual({ kind: 'blocked' })
        expect(MicFailure.problemFor(new DOMException('no', 'SecurityError'))).toEqual({ kind: 'blocked' })
        expect(MicFailure.problemFor(new RecordingUnsupportedError())).toEqual({
            kind: 'toast',
            message: "This browser can't record. Try a recent Chrome, Edge, Firefox or Safari.",
        })
        expect(MicFailure.problemFor(new DOMException('busy', 'NotReadableError'))).toEqual({
            kind: 'toast',
            message: "Recording couldn't start. Check that Solkey may use your microphone, then try again.",
        })
    })

    const ua = {
        chromeMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
        edge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Edg/130.0',
        android: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36',
        safariMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
        iPhone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
        iPhoneChrome:
            'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0 Mobile/15E148 Safari/604.1',
        iPhoneFirefox:
            'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/131.0 Mobile/15E148 Safari/605.1.15',
        iPhoneEdge:
            'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) EdgiOS/130.0 Mobile/15E148 Safari/605.1.15',
        firefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0',
        firefoxAndroid: 'Mozilla/5.0 (Android 14; Mobile; rv:131.0) Gecko/131.0 Firefox/131.0',
    }

    it('names where this browser keeps the microphone permission', () => {
        expect(MicFailure.permissionStep(ua.chromeMac)).toBe('Click the icon left of the web address, then set Microphone to Allow.')
        expect(MicFailure.permissionStep(ua.edge)).toBe('Click the icon left of the web address, then set Microphone to Allow.')
        expect(MicFailure.permissionStep(ua.android)).toBe('Tap the icon left of the web address, then set Microphone to Allow.')
        expect(MicFailure.permissionStep(ua.safariMac)).toBe('Safari menu → Settings for this website → Microphone → Allow.')
        expect(MicFailure.permissionStep(ua.iPhone)).toBe('Tap aA in the address bar → Website Settings → Microphone → Allow.')
    })

    it('lists the same path as numbered steps, one action each', () => {
        expect(MicFailure.permissionSteps(ua.iPhone)).toEqual([
            'Tap aA in the address bar.',
            'Tap Website Settings.',
            'Set Microphone to Allow.',
        ])
        expect(MicFailure.permissionSteps(ua.chromeMac)).toEqual(['Click the icon left of the web address.', 'Set Microphone to Allow.'])
        expect(MicFailure.permissionSteps(ua.edge)).toEqual(['Click the icon left of the web address.', 'Set Microphone to Allow.'])
        expect(MicFailure.permissionSteps(ua.android)).toEqual(['Tap the icon left of the web address.', 'Set Microphone to Allow.'])
        expect(MicFailure.permissionSteps(ua.safariMac)).toEqual([
            'Open the Safari menu.',
            'Choose Settings for this website.',
            'Set Microphone to Allow.',
        ])
    })

    it('has no steps wherever it has no line to name', () => {
        for (const agent of [ua.iPhoneChrome, ua.iPhoneFirefox, ua.iPhoneEdge, ua.firefox, ua.firefoxAndroid, 'curl/8']) {
            expect(MicFailure.permissionStep(agent)).toBeNull()
            expect(MicFailure.permissionSteps(agent)).toBeNull()
        }
    })
})

describe('RecordingLimitCopy', () => {
    // 18:00 UTC on 22 Oct 2026: the allowance comes back at the next midnight UTC.
    const now = new Date('2026-10-22T18:00:00.000Z')

    it('names the allowance in words and when it comes back, never as a clock', () => {
        const copy = new RecordingLimitCopy({ limitSeconds: 180, usedSeconds: 180, now })
        expect(copy.title).toBe("That's your 3 minutes of recording for today.")
        expect(copy.subtitle).toMatch(
            /^Everything you recorded is in your score\. Playing, editing and exporting still work — recording is back (tonight|today|tomorrow) at .+\. No surprise charges — Solkey never bills for extra minutes\.$/,
        )
        expect(new RecordingLimitCopy({ limitSeconds: null, usedSeconds: 10800, now }).title).toBe(
            "That's your 3 hours of recording for today.",
        )
        expect(RecordingLimitCopy.NO_SURPRISES).toBe('No surprise charges — Solkey never bills for extra minutes.')
    })

    it('offers what the next tier gives, from the catalogue — and nothing at the top of the ladder', () => {
        const next = (dailySeconds: number | null) =>
            new RecordingLimitCopy({ limitSeconds: 180, usedSeconds: 180, next: { name: 'Songwriter', dailySeconds }, now })
        expect(next(1200).upgrade).toBe('Songwriter gives you 20 minutes every day, starting right away.')
        expect(next(null).upgrade).toBe('Songwriter lets you record as much as you like, starting right away.')
        expect(new RecordingLimitCopy({ limitSeconds: 10800, usedSeconds: 10800, now }).upgrade).toBeNull()
    })
})
