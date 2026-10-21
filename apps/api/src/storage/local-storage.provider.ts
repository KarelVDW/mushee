import { createReadStream, createWriteStream, mkdirSync } from 'fs'
import { mkdir, readdir, readFile, rm, unlink, writeFile } from 'fs/promises'
import { dirname, join, normalize, resolve, sep } from 'path'
import type { Readable, Writable } from 'stream'

import { storageFolder, type StorageProvider } from './storage-provider'

/**
 * Filesystem backend for local development and docker-compose/k8s-local, where
 * a volume stands in for a bucket. Keys map to paths under `rootDir`.
 */
export class LocalStorageProvider implements StorageProvider {
    readonly name: string
    private readonly rootDir: string

    constructor(rootDir: string) {
        this.rootDir = resolve(rootDir)
        this.name = `local (${this.rootDir})`
    }

    /** Map a key to a path, refusing traversal outside the root. */
    private pathFor(key: string): string {
        const path = normalize(join(this.rootDir, key))
        if (path !== this.rootDir && !path.startsWith(this.rootDir + sep)) {
            throw new Error(`Storage key escapes root: ${key}`)
        }
        return path
    }

    /** A folder's path; a folder that resolves to the root itself (`.`, `a/..`) is refused like an empty one. */
    private folderPath(folder: string): string {
        const path = this.pathFor(folder)
        if (path === this.rootDir) throw new Error(`Refusing storage folder ${JSON.stringify(folder)}: it names the whole store`)
        return path
    }

    async write(key: string, content: string | Buffer): Promise<void> {
        const path = this.pathFor(key)
        await mkdir(dirname(path), { recursive: true })
        await writeFile(path, content)
    }

    async read(key: string): Promise<string> {
        return readFile(this.pathFor(key), 'utf8')
    }

    createWriteStream(key: string): Writable {
        // Sync mkdir keeps 'finish' semantics honest: the returned stream is the
        // real file stream, so awaiting its finish means the data is flushed.
        // This runs once per recording session — not on the audio hot path.
        const path = this.pathFor(key)
        mkdirSync(dirname(path), { recursive: true })
        return createWriteStream(path)
    }

    createReadStream(key: string): Readable {
        return createReadStream(this.pathFor(key))
    }

    async list(folder: string): Promise<string[]> {
        const dir = storageFolder(folder)
        try {
            const entries = await readdir(this.folderPath(dir), { withFileTypes: true })
            return entries.filter((e) => e.isFile()).map((e) => `${dir}/${e.name}`)
        } catch (err) {
            if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
            throw err
        }
    }

    signedUrl(): Promise<string | null> {
        // The filesystem has no URLs — callers stream through the API instead.
        return Promise.resolve(null)
    }

    async delete(key: string): Promise<void> {
        try {
            await unlink(this.pathFor(key))
        } catch (err) {
            if ((err as NodeJS.ErrnoException).code === 'ENOENT') return
            throw err
        }
    }

    async deletePrefix(folder: string): Promise<void> {
        await rm(this.folderPath(storageFolder(folder)), { recursive: true, force: true })
    }
}
