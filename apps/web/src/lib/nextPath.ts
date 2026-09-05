/**
 * The in-app path a visitor was heading for before auth got in the way
 * (`?next=`), accepted only when it is a same-origin absolute path — a bare
 * `/…`, never `//host` or a full URL — so it can't be used to bounce users
 * elsewhere. Falls back to the library.
 */
export function nextPathFrom(search: string, fallback = '/scores'): string {
    const next = new URLSearchParams(search).get('next')
    return next && next.startsWith('/') && !next.startsWith('//') ? next : fallback
}

/** `?next=<path>` for a link, or an empty string when the destination is just the fallback. */
export function withNext(path: string, next: string | null | undefined): string {
    return next && next !== '/scores' ? `${path}?next=${encodeURIComponent(next)}` : path
}
