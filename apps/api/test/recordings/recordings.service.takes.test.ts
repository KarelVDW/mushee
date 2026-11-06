import 'reflect-metadata'

import { NotFoundException } from '@nestjs/common'
import { MODULE_METADATA } from '@nestjs/common/constants'
import { describe, expect, it, vi } from 'vitest'

import type { Recording } from '../../src/recordings/entities/recording.entity'
import { RecordingArchiver } from '../../src/recordings/recording-archiver'
import { RecordingsModule } from '../../src/recordings/recordings.module'
import { RecordingsService } from '../../src/recordings/recordings.service'
import type { StorageService } from '../../src/storage/storage.service'

/**
 * Takes after the fact are the operator's: the admin console replays archived audio, the
 * account purge sweeps it. Users get no read or delete surface (storage reads scale with replays).
 */

const rows: Recording[] = [
    {
        id: 'r-old',
        userId: 'u1',
        scoreId: 's1',
        creditsSpent: 42,
        storagePath: 'recordings/u1/s1/r-old',
        audioKey: null,
        createdAt: new Date('2026-09-01T10:00:00Z'),
        endedAt: new Date('2026-09-01T10:00:42Z'),
    },
    {
        id: 'r-legacy',
        userId: 'u1',
        scoreId: 's1',
        creditsSpent: 7,
        storagePath: null,
        audioKey: null,
        createdAt: new Date('2026-08-01T10:00:00Z'),
        endedAt: null,
    },
    {
        id: 'r-other',
        userId: 'u2',
        scoreId: 's9',
        creditsSpent: 3,
        storagePath: 'recordings/u2/s9/r-other',
        audioKey: null,
        createdAt: new Date(),
        endedAt: null,
    },
    {
        id: 'r-keyed',
        userId: 'u1',
        scoreId: 's2',
        creditsSpent: 12,
        storagePath: 'recordings/u1/s2/r-keyed',
        audioKey: 'recordings/u1/s2/r-keyed/audio.mp4',
        createdAt: new Date('2026-09-04T10:00:00Z'),
        endedAt: new Date('2026-09-04T10:00:12Z'),
    },
    {
        // The upload failed after the folder was claimed: a row with a storage path but no
        // audio key and no audio object — only the debug bundle made it.
        id: 'r-failed',
        userId: 'u3',
        scoreId: 's3',
        creditsSpent: 5,
        storagePath: 'recordings/u3/s3/r-failed',
        audioKey: null,
        createdAt: new Date('2026-09-03T10:00:00Z'),
        endedAt: new Date('2026-09-03T10:00:05Z'),
    },
]

/** What the bucket holds under each take's folder. */
const OBJECTS: Record<string, string[]> = {
    'recordings/u1/s1/r-old': ['recordings/u1/s1/r-old/audio.webm', 'recordings/u1/s1/r-old/session.json'],
    'recordings/u2/s9/r-other': ['recordings/u2/s9/r-other/audio.webm'],
    'recordings/u3/s3/r-failed': ['recordings/u3/s3/r-failed/session.json'],
}

function makeService(storageOverrides: Partial<StorageService> = {}) {
    const repo = {
        findOneBy: vi.fn(({ id }: { id: string }) => Promise.resolve(rows.find((r) => r.id === id) ?? null)),
    }
    const deleteFolder = vi.fn(() => Promise.resolve())
    const storage = {
        list: vi.fn((prefix: string) => Promise.resolve(OBJECTS[prefix] ?? [])),
        signedUrl: vi.fn(() => Promise.resolve(null as string | null)),
        createReadStream: vi.fn(() => 'stream' as never),
        deleteFolder,
        ...storageOverrides,
    }
    const service = new RecordingsService(repo as never, storage as unknown as StorageService)
    return { service, repo, storage, deleteFolder }
}

describe('RecordingsService takes', () => {
    it('gives users no HTTP surface over takes: the module registers no controller', () => {
        // Recording happens over the gateway; replay is the admin console's (AdminController).
        expect(Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, RecordingsModule) ?? []).toEqual([])
    })

    it('replays any take for support without an owner check, and 404s unknown ids', async () => {
        const { service } = makeService()
        expect(await service.audioForSupport('r-other')).toEqual({ stream: 'stream', contentType: 'audio/webm' })
        await expect(service.audioForSupport('missing')).rejects.toBeInstanceOf(NotFoundException)
    })

    it('streams the archived audio with its content type when the backend cannot sign URLs', async () => {
        const { service, storage } = makeService()
        expect(await service.audioForSupport('r-old')).toEqual({ stream: 'stream', contentType: 'audio/webm' })
        expect(storage.list).toHaveBeenCalledWith('recordings/u1/s1/r-old')
        expect(storage.createReadStream).toHaveBeenCalledWith('recordings/u1/s1/r-old/audio.webm')
    })

    it('replays from the persisted audio key without listing the bucket', async () => {
        const { service, storage } = makeService()
        expect(await service.audioForSupport('r-keyed')).toEqual({ stream: 'stream', contentType: 'audio/mp4' })
        expect(storage.list).not.toHaveBeenCalled()
        expect(storage.createReadStream).toHaveBeenCalledWith('recordings/u1/s2/r-keyed/audio.mp4')

        const signed = makeService({ signedUrl: vi.fn(() => Promise.resolve('https://bucket/keyed?sig')) as never })
        expect(await signed.service.audioForSupport('r-keyed')).toEqual({ url: 'https://bucket/keyed?sig' })
        expect(signed.storage.signedUrl).toHaveBeenCalledWith('recordings/u1/s2/r-keyed/audio.mp4', expect.any(Number))
        expect(signed.storage.list).not.toHaveBeenCalled()
    })

    it('prefers a signed URL, and falls back to streaming when signing throws', async () => {
        const signed = makeService({ signedUrl: vi.fn(() => Promise.resolve('https://bucket/audio?sig')) as never })
        expect(await signed.service.audioForSupport('r-old')).toEqual({ url: 'https://bucket/audio?sig' })

        const failing = makeService({ signedUrl: vi.fn(() => Promise.reject(new Error('no signBlob permission'))) as never })
        expect(await failing.service.audioForSupport('r-old')).toEqual({ stream: 'stream', contentType: 'audio/webm' })
    })

    it('reports missing audio distinctly: never archived vs. gone from storage', async () => {
        const { service } = makeService()
        await expect(service.audioForSupport('r-legacy')).rejects.toThrow('No audio was archived')
        const empty = makeService({ list: vi.fn(() => Promise.resolve([])) as never })
        await expect(empty.service.audioForSupport('r-old')).rejects.toThrow('missing from storage')
    })

    it('a take whose upload failed (folder but no audio object) replays as missing from storage', async () => {
        const { service, storage } = makeService()
        await expect(service.audioForSupport('r-failed')).rejects.toThrow('missing from storage')
        expect(storage.list).toHaveBeenCalledWith('recordings/u3/s3/r-failed')
    })

    it('the account purge deletes the user-level audio folder', async () => {
        const { service, deleteFolder } = makeService()
        await service.deleteAudioForUser('u1')
        expect(deleteFolder).toHaveBeenCalledWith(RecordingArchiver.folderForUser('u1'))
    })
})
