import { readFileSync, statSync } from 'fs'

/**
 * Parsed file contents, kept until the file changes on disk (mtime or size). The result JSON is
 * up to half a megabyte per run and the corpus manifests are read on every page, so each file is
 * parsed once per change rather than once per request. Everything is read-only: a missing or
 * unparsable file reads as `null` and is never cached, so it is picked up as soon as it appears.
 */
export class FileCache<T> {
    private readonly entries = new Map<string, { mtimeMs: number; size: number; value: T }>()

    /** `load` reads the file at `path` into its value; it runs again only once the file changes. */
    constructor(private readonly load: (path: string) => T) {}

    /** A cache of plain JSON files. */
    static json<T>(): FileCache<T> {
        return new FileCache<T>((path) => JSON.parse(readFileSync(path, 'utf8')) as T)
    }

    read(path: string): T | null {
        let stat
        try {
            stat = statSync(path)
        } catch {
            this.entries.delete(path)
            return null
        }
        const hit = this.entries.get(path)
        if (hit && hit.mtimeMs === stat.mtimeMs && hit.size === stat.size) return hit.value
        try {
            const value = this.load(path)
            this.entries.set(path, { mtimeMs: stat.mtimeMs, size: stat.size, value })
            return value
        } catch {
            // A file being written right now (an agent mid-export) reads as absent until it parses.
            return null
        }
    }
}
