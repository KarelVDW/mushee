/**
 * The open-redirect guard for `?next=` — the path to return to after a login,
 * which arrives in a link and so is attacker-controlled. `next` is accepted only
 * when it is a same-origin absolute path (a bare `/…`, never `//host`, `/\host`
 * or a full URL); anything else yields `fallback`.
 */
export function safeNextPath(next: string | null | undefined, fallback: string): string {
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
