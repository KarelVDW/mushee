import 'reflect-metadata'

import { ForbiddenException, NotFoundException } from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'

import type { Recording } from '../../src/recordings/entities/recording.entity'
import type { RecordingCreditsService } from '../../src/recordings/recording-credits.service'
import type { RecordingLocksService } from '../../src/recordings/recording-locks.service'
import { RecordingsService } from '../../src/recordings/recordings.service'
import type { StorageService } from '../../src/storage/storage.service'

/** The owner-facing takes API: list, replay audio, delete — all scoped to the caller. */

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
]

function makeService(storageOverrides: Partial<StorageService> = {}) {
    const repo = {
        find: vi.fn(({ where }: { where: { userId: string; scoreId?: string } }) =>
            Promise.resolve(
                rows
                    .filter((r) => r.userId === where.userId && (!where.scoreId || r.scoreId === where.scoreId))
                    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
            ),
        ),
        findOneBy: vi.fn(({ id }: { id: string }) => Promise.resolve(rows.find((r) => r.id === id) ?? null)),
        delete: vi.fn(() => Promise.resolve({ affected: 1 })),
    }
    const deletePrefix = vi.fn(() => Promise.resolve())
    const storage = {
        list: vi.fn(() => Promise.resolve(['recordings/u1/s1/r-old/audio.webm', 'recordings/u1/s1/r-old/session.json'])),
        signedUrl: vi.fn(() => Promise.resolve(null as string | null)),
        createReadStream: vi.fn(() => 'stream' as never),
        deletePrefix,
        ...storageOverrides,
    }
    const service = new RecordingsService(
        repo as never,
        {} as RecordingCreditsService,
        {} as RecordingLocksService,
        storage as unknown as StorageService,
    )
    return { service, repo, storage, deletePrefix }
}

describe('RecordingsService takes', () => {
    it('lists the caller’s takes newest first, marking which have audio', async () => {
        const { service } = makeService()
        expect(await service.listForUser('u1')).toEqual([
            {
                id: 'r-keyed',
                scoreId: 's2',
                startedAt: '2026-09-04T10:00:00.000Z',
                endedAt: '2026-09-04T10:00:12.000Z',
                seconds: 12,
                hasAudio: true,
            },
            {
                id: 'r-old',
                scoreId: 's1',
                startedAt: '2026-09-01T10:00:00.000Z',
                endedAt: '2026-09-01T10:00:42.000Z',
                seconds: 42,
                hasAudio: true,
            },
            { id: 'r-legacy', scoreId: 's1', startedAt: '2026-08-01T10:00:00.000Z', endedAt: null, seconds: 7, hasAudio: false },
        ])
        expect(await service.listForUser('u1', 'nope')).toEqual([])
    })

    it('refuses another user’s take and unknown ids', async () => {
        const { service } = makeService()
        await expect(service.audioFor('u1', 'r-other')).rejects.toBeInstanceOf(ForbiddenException)
        await expect(service.remove('u1', 'r-other')).rejects.toBeInstanceOf(ForbiddenException)
        await expect(service.remove('u1', 'missing')).rejects.toBeInstanceOf(NotFoundException)
    })

    it('streams the archived audio with its content type when the backend cannot sign URLs', async () => {
        const { service, storage } = makeService()
        expect(await service.audioFor('u1', 'r-old')).toEqual({ stream: 'stream', contentType: 'audio/webm' })
        expect(storage.list).toHaveBeenCalledWith('recordings/u1/s1/r-old')
        expect(storage.createReadStream).toHaveBeenCalledWith('recordings/u1/s1/r-old/audio.webm')
    })

    it('replays from the persisted audio key without listing the bucket', async () => {
        const { service, storage } = makeService()
        expect(await service.audioFor('u1', 'r-keyed')).toEqual({ stream: 'stream', contentType: 'audio/mp4' })
        expect(storage.list).not.toHaveBeenCalled()
        expect(storage.createReadStream).toHaveBeenCalledWith('recordings/u1/s2/r-keyed/audio.mp4')

        const signed = makeService({ signedUrl: vi.fn(() => Promise.resolve('https://bucket/keyed?sig')) as never })
        expect(await signed.service.audioFor('u1', 'r-keyed')).toEqual({ url: 'https://bucket/keyed?sig' })
        expect(signed.storage.signedUrl).toHaveBeenCalledWith('recordings/u1/s2/r-keyed/audio.mp4', expect.any(Number))
        expect(signed.storage.list).not.toHaveBeenCalled()
    })

    it('prefers a signed URL, and falls back to streaming when signing throws', async () => {
        const signed = makeService({ signedUrl: vi.fn(() => Promise.resolve('https://bucket/audio?sig')) as never })
        expect(await signed.service.audioFor('u1', 'r-old')).toEqual({ url: 'https://bucket/audio?sig' })

        const failing = makeService({ signedUrl: vi.fn(() => Promise.reject(new Error('no signBlob permission'))) as never })
        expect(await failing.service.audioFor('u1', 'r-old')).toEqual({ stream: 'stream', contentType: 'audio/webm' })
    })

    it('reports missing audio distinctly: never archived vs. gone from storage', async () => {
        const { service } = makeService()
        await expect(service.audioFor('u1', 'r-legacy')).rejects.toThrow('No audio was archived')
        const empty = makeService({ list: vi.fn(() => Promise.resolve([])) as never })
        await expect(empty.service.audioFor('u1', 'r-old')).rejects.toThrow('missing from storage')
    })

    it('deletes the audio folder before the row, and skips storage for audio-less rows', async () => {
        const { service, repo, deletePrefix } = makeService()
        await service.remove('u1', 'r-old')
        expect(deletePrefix).toHaveBeenCalledWith('recordings/u1/s1/r-old/')
        expect(repo.delete).toHaveBeenCalledWith({ id: 'r-old' })
        expect(deletePrefix.mock.invocationCallOrder[0]).toBeLessThan(repo.delete.mock.invocationCallOrder[0])

        deletePrefix.mockClear()
        await service.remove('u1', 'r-legacy')
        expect(deletePrefix).not.toHaveBeenCalled()
        expect(repo.delete).toHaveBeenLastCalledWith({ id: 'r-legacy' })
    })

    it('does not delete the row when the audio delete fails (no orphaned audio)', async () => {
        const { service, repo } = makeService({ deletePrefix: vi.fn(() => Promise.reject(new Error('bucket down'))) as never })
        await expect(service.remove('u1', 'r-old')).rejects.toThrow('bucket down')
        expect(repo.delete).not.toHaveBeenCalled()
    })
})
