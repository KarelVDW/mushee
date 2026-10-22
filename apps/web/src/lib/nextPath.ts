import { safeNextPath } from '@mushee/ui/nextPath'

/** The signed-in home: where auth lands when there is nowhere better to go. */
export const LIBRARY_PATH = '/scores'

/**
 * The in-app path a visitor was heading for before auth got in the way
 * (`?next=` in `search`), through the shared open-redirect guard — so it can't
 * be used to bounce users elsewhere. Falls back to the library.
 */
export function nextPathFrom(search: string, fallback = LIBRARY_PATH): string {
    return safeNextPath(new URLSearchParams(search).get('next'), fallback)
}

/** `?next=<path>` for a link, or an empty string when the destination is just the fallback. */
export function withNext(path: string, next: string | null | undefined): string {
    return next && next !== LIBRARY_PATH ? `${path}?next=${encodeURIComponent(next)}` : path
}
