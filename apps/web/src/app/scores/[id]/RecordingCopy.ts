import { RecordingUnsupportedError } from '@/lib/Microphone'
import { formatAllowance, formatResetWhen, formatTimeLeftToday } from '@/lib/recordingTime'

/*
 * The recording flow's words, React-free so their rules (which line shows when, singular and
 * plural, per-device wording) are unit-tested: the recording strip, the after-take summary,
 * what a microphone failure becomes, and the limit dialog. Copy follows the glossary
 * ('recording', never 'take'; 'bar', never 'measure') and states the one-note-at-a-time rule
 * only at its five sanctioned moments, none of which is here.
 */

/** A take as the recording strip shows it, from the count-in to the stop. */
export interface RecordingStatus {
    phase: 'countoff' | 'recording'
    /** The count-in click last heard (0-based) and how many the bar has; null before the first. */
    countoff: { beat: number; total: number } | null
    /** `performance.now()` when capture began; null during the count-in. */
    captureStartedAt: number | null
    /** The server's transcription: fine, down (audio still kept, time not charged), or just back. */
    health: 'ok' | 'down' | 'back'
    /** This take's count-in carries the iPhone Mic Mode reminder (once per browser session). */
    micModeReminder: boolean
    /** Recording left today when the take started, packs included; null on an uncapped plan. */
    secondsLeftAtStart: number | null
    /** The bar the take's first note lands in, 1-based (as the user counts them). */
    startBar: number
}

/** The strip's one hint line: what it says, and how it is drawn. */
export type StripHint =
    | { kind: 'mic-mode' | 'time-left' | 'warning' | 'recovered'; text: string }
    /** "Tap ■ to stop" / "Press Space or ■ to stop" — drawn with the stop glyph inline. */
    | { kind: 'stop'; touch: boolean }

/**
 * What the recording strip says at one moment of a take: its state word, its live-region news
 * and its single hint line. One line at a time, by priority: a transcription warning or
 * recovery first; then, in the count-in, the iPhone Mic Mode reminder; while recording on a
 * capped plan with a minute or less left, the time left today; otherwise how to stop.
 */
export class RecordingStripCopy {
    /** The time left today shows once this little is left (seconds). */
    static readonly TIME_LEFT_FROM = 60
    /**
     * Two lines at most in a 360px phone's strip. It says what the time doesn't count against —
     * in a flow with a count-in, "this time won't count" didn't.
     */
    static readonly WARNING = "Solkey can't write notes right now. Your audio is saved — these minutes are free."
    static readonly RECOVERED = 'Notes are back.'
    static readonly MIC_MODE = 'iPhone: keep Mic Mode on Wide Spectrum.'

    constructor(
        private readonly status: RecordingStatus,
        /** Whole seconds since capture began (0 during the count-in). */
        private readonly elapsedSeconds: number,
        /** A phone: "Tap", not "Press Space or". */
        private readonly touch: boolean,
    ) {}

    /** The state word the strip shows big: 'Get ready' through the count-in, then 'Recording'. */
    get label(): 'Get ready' | 'Recording' {
        return this.status.phase === 'countoff' ? 'Get ready' : 'Recording'
    }

    /**
     * Where the recording goes, beside 'Get ready' through the count-in ('from bar 3') — the
     * selection highlight may sit elsewhere (a score just opened has its first note selected),
     * so the strip says it. Null once recording.
     */
    get startsFrom(): string | null {
        return this.status.phase === 'countoff' ? `from bar ${this.status.startBar}` : null
    }

    /** What the editor's announcer says as the count-in starts — the strip's own words, with where it records. */
    static countInAnnouncement(startBar: number): string {
        return `Get ready, from bar ${startBar}.`
    }

    /**
     * The strip's live-region text: the transcription warning or recovery while one is up, else
     * nothing. The state words ('Get ready', 'Recording') reach screen readers through the
     * editor's announcer (contract C11) alone, so no state is ever spoken twice.
     */
    get news(): string | null {
        if (this.status.health === 'down') return RecordingStripCopy.WARNING
        if (this.status.health === 'back') return RecordingStripCopy.RECOVERED
        return null
    }

    /** Recording left today right now (never below zero), or null on an uncapped plan. */
    get secondsLeft(): number | null {
        const start = this.status.secondsLeftAtStart
        return start === null ? null : Math.max(0, start - this.elapsedSeconds)
    }

    get hint(): StripHint | null {
        const { status } = this
        if (status.health === 'down') return { kind: 'warning', text: RecordingStripCopy.WARNING }
        if (status.health === 'back') return { kind: 'recovered', text: RecordingStripCopy.RECOVERED }
        if (status.phase === 'countoff') return status.micModeReminder ? { kind: 'mic-mode', text: RecordingStripCopy.MIC_MODE } : null
        const left = this.secondsLeft
        if (left !== null && left <= RecordingStripCopy.TIME_LEFT_FROM) return { kind: 'time-left', text: formatTimeLeftToday(left) }
        return { kind: 'stop', touch: this.touch }
    }
}

interface TakeSummaryInit {
    /** The take's first and last bar, 1-based (as the user counts them). */
    firstBar: number
    lastBar: number
    wrotePitchedNotes: boolean
    /** A phone: "Tap any note", not "Click any note". */
    touch: boolean
    /** An iPhone, where a take with no notes is most often Mic Mode filtering it out. */
    iPhone: boolean
}

/** The after-take summary: the toast that names the next step, and what the live region says. */
export class TakeSummaryCopy {
    static readonly IPHONE_NO_NOTES = 'On iPhone, open Control Center → Mic Mode and choose Wide Spectrum.'

    constructor(private readonly init: TakeSummaryInit) {}

    /** "bars 3–6", or "bar 3" for a one-bar take. */
    private bars(separator: string): string {
        const { firstBar, lastBar } = this.init
        return lastBar > firstBar ? `bars ${firstBar}${separator}${lastBar}` : `bar ${firstBar}`
    }

    get toast(): string {
        const { wrotePitchedNotes, touch, iPhone } = this.init
        if (!wrotePitchedNotes) {
            const tip = 'No notes this time — try a little closer to the mic.'
            return iPhone ? `${tip} ${TakeSummaryCopy.IPHONE_NO_NOTES}` : tip
        }
        return `Added ${this.bars('–')}. ${touch ? 'Tap' : 'Click'} any note to fix it.`
    }

    get announcement(): string {
        if (!this.init.wrotePitchedNotes) return 'Recording stopped. No notes this time.'
        return `Recording stopped. Added ${this.bars(' to ')}.`
    }
}

/** What a microphone that wouldn't open becomes: the blocked-mic dialog, or a toast saying what to try. */
export type MicProblem = { kind: 'blocked' } | { kind: 'toast'; message: string }

/** Reads why the microphone failed to open (the take's own, or the Mic Mode guide's warm-up stream). */
export class MicFailure {
    static readonly UNSUPPORTED = "This browser can't record. Try a recent Chrome, Edge, Firefox or Safari."
    static readonly GENERIC = "Recording couldn't start. Check that Solkey may use your microphone, then try again."

    static problemFor(err: unknown): MicProblem {
        if (err instanceof RecordingUnsupportedError) return { kind: 'toast', message: MicFailure.UNSUPPORTED }
        if (err instanceof DOMException && (err.name === 'NotAllowedError' || err.name === 'SecurityError')) return { kind: 'blocked' }
        return { kind: 'toast', message: MicFailure.GENERIC }
    }

    /**
     * The one line that says where this browser keeps the microphone permission, or null where
     * there is no reliable path to name (Firefox, the other iPhone browsers).
     */
    static permissionStep(userAgent: string): string | null {
        if (/iPhone/.test(userAgent)) {
            return /CriOS|FxiOS|EdgiOS/.test(userAgent) ? null : 'Tap aA in the address bar → Website Settings → Microphone → Allow.'
        }
        if (/Firefox/.test(userAgent)) return null
        if (/Chrome\/|Edg\//.test(userAgent)) {
            const verb = /Android/.test(userAgent) ? 'Tap' : 'Click'
            return `${verb} the icon left of the web address, then set Microphone to Allow.`
        }
        if (/Macintosh/.test(userAgent) && /Safari\//.test(userAgent))
            return 'Safari menu → Settings for this website → Microphone → Allow.'
        return null
    }
}

interface RecordingLimitInit {
    /** The day's allowance in seconds; null (never sent in practice) falls back to what was used. */
    limitSeconds: number | null
    usedSeconds: number
    /** The tier an upgrade offers: its name and daily recording (null = no daily cap). */
    next?: { name: string; dailySeconds: number | null }
    /** When the allowance comes back (the API's timestamp when it sends one; else the next midnight UTC). */
    resetsAt?: string | null
    now?: Date
}

/** The daily-limit dialog's words: allowances in words, the reset in the viewer's own time. */
export class RecordingLimitCopy {
    static readonly NO_SURPRISES = 'No surprise charges — Solkey never bills for extra minutes.'

    constructor(private readonly init: RecordingLimitInit) {}

    get title(): string {
        const { limitSeconds, usedSeconds } = this.init
        return `That's your ${formatAllowance(limitSeconds ?? usedSeconds)} of recording for today.`
    }

    /** What still works, when recording is back, and that nothing is ever charged — the body then only offers more. */
    get subtitle(): string {
        const when = formatResetWhen(this.init.resetsAt, this.init.now)
        return `Everything you recorded is in your score. Playing, editing and exporting still work — recording is back ${when}. ${RecordingLimitCopy.NO_SURPRISES}`
    }

    /** What the next plan gives, from the catalogue — never "unlimited"; null at the top of the ladder. */
    get upgrade(): string | null {
        const { next } = this.init
        if (!next) return null
        const gives =
            next.dailySeconds === null ? 'lets you record as much as you like' : `gives you ${formatAllowance(next.dailySeconds)} every day`
        return `${next.name} ${gives}, starting right away.`
    }
}
