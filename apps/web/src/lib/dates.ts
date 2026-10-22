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
