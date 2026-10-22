import { mkdtemp, readFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { finished } from 'stream/promises'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { LocalStorageProvider } from '../../src/storage/local-storage.provider'

describe('LocalStorageProvider', () => {
    let root: string
    let provider: LocalStorageProvider

    beforeEach(async () => {
        root = await mkdtemp(join(tmpdir(), 'mushee-storage-'))
        provider = new LocalStorageProvider(root)
    })

    afterEach(async () => {
        await rm(root, { recursive: true, force: true })
    })

    it('round-trips write/read, creating parent directories', async () => {
        await provider.write('scores/user-1/a.musicxml', '<score/>')
        await expect(provider.read('scores/user-1/a.musicxml')).resolves.toBe('<score/>')
    })

    it('streams chunk-by-chunk and the object is complete after finish', async () => {
        const stream = provider.createWriteStream('recordings/u/s/r/audio.webm')
        stream.write(Buffer.from('abc'))
        stream.write(Buffer.from('def'))
        stream.end()
        await finished(stream)
        const content = await readFile(join(root, 'recordings/u/s/r/audio.webm'))
        expect(content.toString()).toBe('abcdef')
    })

    it('treats deleting an absent key as success', async () => {
        await expect(provider.delete('nope/missing.bin')).resolves.toBeUndefined()
    })

    it('deletes everything inside a folder', async () => {
        await provider.write('recordings/u1/s1/r1/audio.webm', 'x')
        await provider.write('recordings/u1/s2/r2/plot.svg', 'y')
        await provider.write('recordings/u2/s3/r3/audio.webm', 'z')
        await provider.deleteFolder('recordings/u1/')
        await expect(provider.read('recordings/u1/s1/r1/audio.webm')).rejects.toThrow()
        await expect(provider.read('recordings/u2/s3/r3/audio.webm')).resolves.toBe('z')
    })

    it('deletes a folder given without a trailing slash, never a sibling that shares the string prefix', async () => {
        await provider.write('recordings/u1/s1/r1/audio.webm', 'x')
        await provider.write('recordings/u10/s2/r2/audio.webm', 'y')
        await provider.deleteFolder('recordings/u1')
        await expect(provider.read('recordings/u1/s1/r1/audio.webm')).rejects.toThrow()
        await expect(provider.read('recordings/u10/s2/r2/audio.webm')).resolves.toBe('y')
        await expect(provider.deleteFolder('recordings/nobody')).resolves.toBeUndefined()
    })

    it('refuses to list or delete the whole store', async () => {
        await provider.write('scores/u1/a.musicxml', '{}')
        for (const folder of ['', '/', '//', '.', 'scores/..']) {
            await expect(provider.deleteFolder(folder)).rejects.toThrow(/whole store/)
            await expect(provider.list(folder)).rejects.toThrow(/whole store/)
        }
        await expect(provider.read('scores/u1/a.musicxml')).resolves.toBe('{}')
    })

    it('refuses keys that escape the root', async () => {
        await expect(provider.write('../outside.txt', 'x')).rejects.toThrow(/escapes root/)
    })

    it('lists the files directly under a prefix; absent prefixes list empty', async () => {
        await provider.write('recordings/u/s/r/audio.webm', 'bytes')
        await provider.write('recordings/u/s/r/debug.json', '{}')
        await expect(provider.list('recordings/u/s/r')).resolves.toEqual(['recordings/u/s/r/audio.webm', 'recordings/u/s/r/debug.json'])
        await expect(provider.list('recordings/nobody')).resolves.toEqual([])
    })

    it('lists the same keys whether or not the folder has a trailing slash, and skips nested folders', async () => {
        await provider.write('recordings/u/s/r/audio.webm', 'bytes')
        await provider.write('recordings/u/s/r/nested/plot.svg', '<svg/>')
        await expect(provider.list('recordings/u/s/r/')).resolves.toEqual(['recordings/u/s/r/audio.webm'])
    })

    it('reads back bytes through a read stream', async () => {
        await provider.write('recordings/u/s/r/audio.webm', 'audio-bytes')
        const chunks: Buffer[] = []
        const stream = provider.createReadStream('recordings/u/s/r/audio.webm')
        stream.on('data', (chunk) => chunks.push(chunk as Buffer))
        await finished(stream)
        expect(Buffer.concat(chunks).toString()).toBe('audio-bytes')
    })

    it('has no signed URLs (callers stream instead)', async () => {
        await expect(provider.signedUrl()).resolves.toBeNull()
    })
})
