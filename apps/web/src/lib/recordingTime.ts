/**
 * How the product writes recording time. Two kinds of number, two styles:
 *
 * - The length of a recording is a clock reading (formatRecordingTime): "0:42".
 * - An allowance — a plan's daily minutes, what is left today, pack minutes — is
 *   written in words (formatAllowance, formatAllowanceShort, formatTimeLeftToday):
 *   "3 minutes", "2 min 40 sec left today". A clock there reads as a time of day
 *   ("3:00"), so allowances never use it.
 *
 * The daily allowance comes back at midnight UTC (the API's recording-credits
 * service), which is evening in the Americas and the small hours in Europe, so the
 * reset is always shown in the viewer's own time (formatResetWhen, formatResetTime).
 */

/**
 * A recording's length as a clock reading — takes list, recording strip, waveform
 * timer: 42 → "0:42", 125 → "2:05", 3725 → "1:02:05". Whole seconds, rounded down
 * like a stopwatch. Not for allowances: those are written in words (formatAllowance).
 */
export function formatRecordingTime(seconds: number): string {
    const total = wholeSeconds(seconds)
    const h = Math.floor(total / 3600)
    const m = Math.floor((total % 3600) / 60)
    const s = total % 60
    const mmss = `${h ? String(m).padStart(2, '0') : m}:${String(s).padStart(2, '0')}`
    return h ? `${h}:${mmss}` : mmss
}

/**
 * An allowance in words, the way a plan or a limit dialog names it: 180 → "3 minutes",
 * 1200 → "20 minutes", 10800 → "3 hours", 30 → "30 seconds". An amount that isn't a whole
 * number of minutes or hours falls back to the short form ("2 min 40 sec", "1 h 30 min").
 */
export function formatAllowance(seconds: number): string {
    const total = wholeSeconds(seconds)
    if (total < 60) return plural(total, 'second')
    if (total < 3600 && total % 60 === 0) return plural(total / 60, 'minute')
    if (total % 3600 === 0) return plural(total / 3600, 'hour')
    return formatAllowanceShort(total)
}

/**
 * An allowance in short words, for meters and one-line readouts: 180 → "3 min",
 * 156 → "2 min 36 sec", 45 → "45 sec", 10740 → "2 h 59 min". Below an hour it counts
 * minutes and seconds; from an hour on, hours and minutes (seconds no longer matter).
 * Rounded down, so a "left" figure never promises a second that isn't there.
 */
export function formatAllowanceShort(seconds: number): string {
    const total = wholeSeconds(seconds)
    const h = Math.floor(total / 3600)
    const m = Math.floor((total % 3600) / 60)
    const s = total % 60
    const parts = h ? [`${h} h`, m && `${m} min`] : [m && `${m} min`, s && `${s} sec`]
    return parts.filter(Boolean).join(' ') || '0 sec'
}

/** What is left of today's recording: "1 min left today", "30 sec left today". */
export function formatTimeLeftToday(seconds: number): string {
    return `${formatAllowanceShort(seconds)} left today`
}

/** The next daily reset after `now`: the coming midnight UTC, when the API refills the allowance. */
export function nextBudgetReset(now: Date = new Date()): Date {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1))
}

/**
 * The reset's time of day in the viewer's clock: "2:00 AM" in en-US, "01:00" in nl-BE
 * (two-digit hours wherever the locale counts 24 hours). For lines where the day is
 * implied ("Refills daily at 2:00 AM"); say which day with formatResetWhen.
 * `resetsAt` is the API's timestamp when it sends one, else the next midnight UTC.
 */
export function formatResetTime(resetsAt?: Date | string | null, now: Date = new Date(), locale?: string, timeZone?: string): string {
    return clockTime(resetMoment(resetsAt, now), locale, timeZone)
}

/**
 * When recording comes back, as the end of a sentence ("recording is back {when}"):
 * "tonight at 8:00 PM" when the reset falls later today in the evening or the small
 * hours, "today at 9:00 AM" for a reset later today in daylight (midnight UTC is
 * morning in East Asia), "tomorrow at 1:00 AM" when it falls on the next local day.
 * Times follow the locale's clock ("tomorrow at 01:00" in nl-BE). `resetsAt` is the
 * API's timestamp when it sends one, else the next midnight UTC; `locale` and
 * `timeZone` default to the viewer's.
 */
export function formatResetWhen(resetsAt?: Date | string | null, now: Date = new Date(), locale?: string, timeZone?: string): string {
    const reset = resetMoment(resetsAt, now)
    const time = clockTime(reset, locale, timeZone)
    const days = calendarDay(reset, timeZone) - calendarDay(now, timeZone)
    if (days <= 0) {
        const hour = Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone }).format(reset))
        return `${hour >= 17 || hour < 5 ? 'tonight' : 'today'} at ${time}`
    }
    if (days === 1) return `tomorrow at ${time}`
    const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone }).format(reset)
    return `on ${weekday} at ${time}`
}

/** The reset to describe: the API's timestamp when it is a valid moment still ahead, else the next midnight UTC. */
function resetMoment(resetsAt: Date | string | null | undefined, now: Date): Date {
    const given = resetsAt == null ? null : new Date(resetsAt)
    return given && given.getTime() > now.getTime() ? given : nextBudgetReset(now)
}

/** A time of day in the locale's clock; the space before AM/PM is kept unbreakable. */
function clockTime(moment: Date, locale: string | undefined, timeZone: string | undefined): string {
    const { hourCycle } = new Intl.DateTimeFormat(locale, { hour: 'numeric', timeZone }).resolvedOptions()
    const twentyFourHour = hourCycle === 'h23' || hourCycle === 'h24'
    return new Intl.DateTimeFormat(locale, { hour: twentyFourHour ? '2-digit' : 'numeric', minute: '2-digit', timeZone })
        .format(moment)
        .replace(/\s+/g, '\u00a0')
}

/** The moment's calendar date in `timeZone`, as a day count — so two moments compare by local date. */
function calendarDay(moment: Date, timeZone: string | undefined): number {
    const parts = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'numeric', day: 'numeric', timeZone }).formatToParts(moment)
    const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value)
    return Date.UTC(part('year'), part('month') - 1, part('day')) / 86_400_000
}

function wholeSeconds(seconds: number): number {
    return Math.max(0, Math.floor(seconds))
}

function plural(count: number, unit: string): string {
    return `${count} ${unit}${count === 1 ? '' : 's'}`
}
