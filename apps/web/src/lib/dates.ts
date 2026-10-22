/**
 * The day a soft-deleted account is purged ("October 29"), for the sentences that
 * name it. `fallback` stands in when the API sent no date — each sentence words that
 * differently (at deletion time the grace period is exactly 7 days; at a later
 * sign-in it is only "soon").
 */
export function formatPurgeDate(iso: string | undefined, fallback: string): string {
    return iso ? new Date(iso).toLocaleDateString(undefined, { month: 'long', day: 'numeric' }) : fallback
}
