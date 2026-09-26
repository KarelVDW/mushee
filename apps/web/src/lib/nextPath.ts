/**
 * The in-app path a visitor was heading for before auth got in the way
 * (`?next=`), accepted only when it is a same-origin absolute path — a bare
 * `/…`, never `//host` or a full URL — so it can't be used to bounce users
 * elsewhere. Falls back to the library.
 */
export function nextPathFrom(search: string, fallback = '/scores'): string {
    const next = new URLSearchParams(search).get('next')
    if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return fallback
    // Let the platform parser have the final word: browsers turn backslashes into
    // slashes, so `/\evil.example` would leave our origin even though it starts
    // with a single slash. Anything that does not resolve on a fixed dummy origin
    // is rejected.
    try {
        return new URL(next, 'https://next.invalid').origin === 'https://next.invalid' ? next : fallback
    } catch {
        return fallback
    }
}

/** `?next=<path>` for a link, or an empty string when the destination is just the fallback. */
export function withNext(path: string, next: string | null | undefined): string {
    return next && next !== '/scores' ? `${path}?next=${encodeURIComponent(next)}` : path
}
