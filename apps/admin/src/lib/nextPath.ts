/**
 * The console path to return to after login (`?next=`), accepted only when it
 * stays on this origin. A bare leading slash is not enough: browsers normalise
 * `/\host` to `//host`, so the platform URL parser has the final word.
 */
export function safeNextPath(next: string | null | undefined, fallback = '/'): string {
    if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return fallback
    try {
        return new URL(next, 'https://next.invalid').origin === 'https://next.invalid' ? next : fallback
    } catch {
        return fallback
    }
}
