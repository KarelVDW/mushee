/** Shared display formatting for the console's tables and stat tiles. */

export function formatDate(value: string | null | undefined): string {
    if (!value) return '—'
    return new Date(value).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}

export function formatDateTime(value: string | null | undefined): string {
    if (!value) return '—'
    return new Date(value).toLocaleString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    })
}

/** 5025 → "1h 24m"; 90 → "1m 30s"; 0 → "0m". */
export function formatSeconds(total: number | null | undefined): string {
    if (total == null) return '—'
    if (total === 0) return '0m'
    const hours = Math.floor(total / 3600)
    const minutes = Math.floor((total % 3600) / 60)
    const seconds = total % 60
    if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`
    if (minutes > 0) return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`
    return `${seconds}s`
}

export function formatCount(value: number): string {
    return value.toLocaleString('en-US')
}

/** "Jul 14" style tick label for the timeseries days. */
export function formatDayTick(day: string): string {
    return new Date(`${day}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}
