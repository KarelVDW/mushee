import type { Readable, Writable } from 'stream'

/**
 * A blob store keyed by `/`-separated paths (e.g. `scores/<userId>/<file>` or
 * `recordings/<userId>/<scoreId>/<recordingId>/audio.webm`).
 *
 * Implementations must make `delete` idempotent (an already-absent key counts
 * as deleted) and must surface every other failure — swallowing one would let
 * an account purge report success while orphaning user data.
 */
export interface StorageProvider {
    /** Human-readable backend name, for boot logging. */
    readonly name: string

    /** Write a whole object at once. */
    write(key: string, content: string | Buffer): Promise<void>

    /** Read a whole object as UTF-8 text. Rejects when the key is absent. */
    read(key: string): Promise<string>

    /**
     * Open a writable stream to `key` for data whose size isn't known up front
     * (live recording audio). The object becomes readable once the stream has
     * finished; callers must await {@link finished} on it (or listen for
     * 'error') — upload failures surface there, not at open time.
     */
    createWriteStream(key: string, options?: { contentType?: string }): Writable

    /**
     * Open a readable stream of `key`'s bytes (recording audio playback).
     * Absent keys surface as an 'error' on the stream, not at open time.
     */
    createReadStream(key: string): Readable

    /**
     * List the keys of the objects directly inside `folder` (a key prefix
     * without trailing slash; one is tolerated): no nested folders' contents,
     * and never a sibling that merely shares the string prefix (`a/b` vs
     * `a/bc/…`). An absent folder lists empty; an empty folder is refused.
     */
    list(folder: string): Promise<string[]>

    /**
     * A time-limited URL a browser can fetch `key` from directly, or null when
     * the backend has no such concept (local filesystem) — callers must then
     * stream the object themselves.
     */
    signedUrl(key: string, ttlSeconds: number): Promise<string | null>

    /** Delete one object. Absent keys resolve silently. */
    delete(key: string): Promise<void>

    /**
     * Delete everything inside `folder` (a key prefix without trailing slash,
     * e.g. `recordings/<userId>` for an account purge), nested folders
     * included — and never a sibling that merely shares the string prefix, so
     * `recordings/u1` cannot take `recordings/u10` with it. An absent folder is
     * a no-op; an empty folder is refused (it would name the whole store).
     */
    deletePrefix(folder: string): Promise<void>
}

/**
 * `folder` as both backends must read it: without trailing slashes, and never
 * empty — an empty or `/`-only folder would name the whole bucket or storage
 * root, which no caller may list or delete.
 */
export function storageFolder(folder: string): string {
    const trimmed = folder.replace(/\/+$/, '')
    if (trimmed === '') throw new Error(`Refusing an empty storage folder (${JSON.stringify(folder)}): it names the whole store`)
    return trimmed
}
