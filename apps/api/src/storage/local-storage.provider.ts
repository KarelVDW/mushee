import { createReadStream, createWriteStream, mkdirSync } from 'fs';
import { mkdir, readdir, readFile, rm, unlink, writeFile } from 'fs/promises';
import { dirname, join, normalize, resolve, sep } from 'path';
import type { Readable, Writable } from 'stream';

import type { StorageProvider } from './storage-provider';

/**
 * Filesystem backend for local development and docker-compose/k8s-local, where
 * a volume stands in for a bucket. Keys map to paths under `rootDir`.
 */
export class LocalStorageProvider implements StorageProvider {
  readonly name: string;
  private readonly rootDir: string;

  constructor(rootDir: string) {
    this.rootDir = resolve(rootDir);
    this.name = `local (${this.rootDir})`;
  }

  /** Map a key to a path, refusing traversal outside the root. */
  private pathFor(key: string): string {
    const path = normalize(join(this.rootDir, key));
    if (path !== this.rootDir && !path.startsWith(this.rootDir + sep)) {
      throw new Error(`Storage key escapes root: ${key}`);
    }
    return path;
  }

  async write(key: string, content: string | Buffer): Promise<void> {
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content);
  }

  async read(key: string): Promise<string> {
    return readFile(this.pathFor(key), 'utf8');
  }

  createWriteStream(key: string): Writable {
    // Sync mkdir keeps 'finish' semantics honest: the returned stream is the
    // real file stream, so awaiting its finish means the data is flushed.
    // This runs once per recording session — not on the audio hot path.
    const path = this.pathFor(key);
    mkdirSync(dirname(path), { recursive: true });
    return createWriteStream(path);
  }

  createReadStream(key: string): Readable {
    return createReadStream(this.pathFor(key));
  }

  async list(prefix: string): Promise<string[]> {
    try {
      const entries = await readdir(this.pathFor(prefix), { withFileTypes: true });
      return entries.filter((e) => e.isFile()).map((e) => `${prefix}/${e.name}`);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
  }

  signedUrl(): Promise<string | null> {
    // The filesystem has no URLs — callers stream through the API instead.
    return Promise.resolve(null);
  }

  async delete(key: string): Promise<void> {
    try {
      await unlink(this.pathFor(key));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw err;
    }
  }

  async deletePrefix(prefix: string): Promise<void> {
    await rm(this.pathFor(prefix), { recursive: true, force: true });
  }
}
