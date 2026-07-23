import type { Readable, Writable } from 'stream';

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
  readonly name: string;

  /** Write a whole object at once. */
  write(key: string, content: string | Buffer): Promise<void>;

  /** Read a whole object as UTF-8 text. Rejects when the key is absent. */
  read(key: string): Promise<string>;

  /**
   * Open a writable stream to `key` for data whose size isn't known up front
   * (live recording audio). The object becomes readable once the stream has
   * finished; callers must await {@link finished} on it (or listen for
   * 'error') — upload failures surface there, not at open time.
   */
  createWriteStream(key: string, options?: { contentType?: string }): Writable;

  /**
   * Open a readable stream of `key`'s bytes (recording audio playback).
   * Absent keys surface as an 'error' on the stream, not at open time.
   */
  createReadStream(key: string): Readable;

  /** List the keys directly under `prefix` (a "directory"). Absent prefixes
   *  resolve to an empty list. */
  list(prefix: string): Promise<string[]>;

  /**
   * A time-limited URL a browser can fetch `key` from directly, or null when
   * the backend has no such concept (local filesystem) — callers must then
   * stream the object themselves.
   */
  signedUrl(key: string, ttlSeconds: number): Promise<string | null>;

  /** Delete one object. Absent keys resolve silently. */
  delete(key: string): Promise<void>;

  /**
   * Delete every object under `prefix` (used for account purges, e.g.
   * `recordings/<userId>/`). An empty prefix match is a no-op, not an error.
   */
  deletePrefix(prefix: string): Promise<void>;
}
