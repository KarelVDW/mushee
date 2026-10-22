/**
 * The app's date and time labels, in the visitor's locale. One home for them, so a new
 * surface reuses a label (and its toLocale options) instead of restating it inline.
 */

/** A calendar date with its year ("Oct 22, 2026"): the library's created column. */
export function formatShortDate(iso: string): string {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

/** A calendar date spelled out ("22 October 2026"): when a billing period renews or ends. */
export function formatLongDate(iso: string): string {
    return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })
}

/**
 * How long ago something changed ("Just now", "5m ago", "3h ago", "Yesterday",
 * "4 days ago"), or its short date once it is over a week old: the library's
 * updated column.
 */
export function formatRelativeTime(iso: string, now = Date.now()): string {
    const diff = now - new Date(iso).getTime()
    const minutes = Math.floor(diff / 60_000)
    const hours = Math.floor(minutes / 60)
    const days = Math.floor(hours / 24)
    if (days > 7) return formatShortDate(iso)
    if (days > 1) return `${days} days ago`
    if (days === 1) return 'Yesterday'
    if (hours >= 1) return `${hours}h ago`
    if (minutes >= 1) return `${minutes}m ago`
    return 'Just now'
}

/** When a recording take started: "Today, 14:02" / "Yesterday, 09:10" / "3 Sep, 14:02" / "3 Sep 2025, 14:02". */
export function formatTakeDate(iso: string, now = new Date()): string {
    const date = new Date(iso)
    const time = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString()
    const yesterday = new Date(now)
    yesterday.setDate(now.getDate() - 1)
    if (sameDay(date, now)) return `Today, ${time}`
    if (sameDay(date, yesterday)) return `Yesterday, ${time}`
    const day = date.toLocaleDateString(undefined, {
        day: 'numeric',
        month: 'short',
        ...(date.getFullYear() !== now.getFullYear() && { year: 'numeric' }),
    })
    return `${day}, ${time}`
}

/**
 * The day a soft-deleted account is purged ("October 29"), for the sentences that
 * name it; null when the API sent no date. Each sentence words that case itself, around
 * its own preposition ("deleted on October 29" has no dateless twin that reads), and
 * says it differently: at deletion time the grace period is exactly 7 days, at a later
 * sign-in only part of it is left.
 */
export function formatPurgeDate(iso: string | undefined): string | null {
    return iso ? new Date(iso).toLocaleDateString(undefined, { month: 'long', day: 'numeric' }) : null
}
