import 'reflect-metadata'

import { describe, expect, it, vi } from 'vitest'

import type { RecordingCreditBalance, RecordingCreditsService } from '../../src/recordings/recording-credits.service'
import type { RecordingLock, RecordingLocksService } from '../../src/recordings/recording-locks.service'
import { RecordingSession } from '../../src/recordings/recording-session'
import { RecordingSessionsService } from '../../src/recordings/recording-sessions.service'
import type { StorageService } from '../../src/storage/storage.service'

// The registry loads TF.js models from the cwd and the pipeline spawns ffmpeg;
// neither is what open() decides, so both are stubbed at the module seam.
vi.mock('../../src/recordings/pipeline/providers/provider-registry', () => ({
    ProviderRegistry: class ProviderRegistry {
        initAll = vi.fn(() => Promise.resolve())
    },
}))
vi.mock('../../src/recordings/pipeline/providers/create-model-backend', () => ({
    createModelBackend: () => ({}),
}))
vi.mock('../../src/recordings/pipeline/recording-pipeline', () => ({
    RecordingPipeline: class RecordingPipeline {
        audioDurationSec = 0
        setOnUpdate() {}
        setOnSourceResolved() {}
        setOnHealth() {}
        setArchiver() {}
        finalize() {
            return Promise.resolve()
        }
    },
}))

/** Opening a live take: one slot per user, no take on an empty budget, and no failure path that leaks the slot. */

function balance(exhausted: boolean): RecordingCreditBalance {
    return { used: 600, remaining: exhausted ? 0 : 60, packSeconds: 0, exhausted } as unknown as RecordingCreditBalance
}

function makeService({ lockFree = true, credits = Promise.resolve(balance(false)), save = Promise.resolve({ id: 'rec-1' }) } = {}) {
    const release = vi.fn(() => Promise.resolve())
    const lock = { release } as unknown as RecordingLock
    const locks = { acquire: vi.fn(() => Promise.resolve(lockFree ? lock : null)) }
    const creditsService = { balance: vi.fn(() => credits) }
    const repo = {
        create: (row: object) => row,
        save: vi.fn(() => save),
        update: vi.fn(() => Promise.resolve()),
    }
    const service = new RecordingSessionsService(
        repo as never,
        creditsService as unknown as RecordingCreditsService,
        locks as unknown as RecordingLocksService,
        {} as StorageService,
    )
    const events = { onUpdate: vi.fn(), onLimitReached: vi.fn() }
    return { service, release, creditsService, repo, events }
}

describe('RecordingSessionsService.open', () => {
    it('starts a session in the user’s slot when credits are left', async () => {
        const { service, release, repo, events } = makeService()
        const opened = await service.open('u1', 's1', events)
        expect('session' in opened && opened.session).toBeInstanceOf(RecordingSession)
        expect(repo.save).toHaveBeenCalledWith({ userId: 'u1', scoreId: 's1' })
        expect(repo.update).toHaveBeenCalledWith('rec-1', { storagePath: 'recordings/u1/s1/rec-1' })
        expect(release).not.toHaveBeenCalled()
    })

    it('rejects a second take while the slot is held, without touching credits', async () => {
        const { service, creditsService, events } = makeService({ lockFree: false })
        expect(await service.open('u1', 's1', events)).toEqual({ rejected: 'concurrent-recording' })
        expect(creditsService.balance).not.toHaveBeenCalled()
    })

    it('frees the slot and reports the balance when the budget is exhausted', async () => {
        const exhausted = balance(true)
        const { service, release, repo, events } = makeService({ credits: Promise.resolve(exhausted) })
        expect(await service.open('u1', 's1', events)).toEqual({ rejected: 'limit-reached', balance: exhausted })
        expect(release).toHaveBeenCalledTimes(1)
        expect(repo.save).not.toHaveBeenCalled()
    })

    it('frees the slot and rethrows when the balance lookup fails', async () => {
        const { service, release, events } = makeService({ credits: Promise.reject(new Error('db blip')) })
        await expect(service.open('u1', 's1', events)).rejects.toThrow('db blip')
        expect(release).toHaveBeenCalledTimes(1)
    })

    it('frees the slot and rethrows when the session fails to open', async () => {
        const { service, release, events } = makeService({ save: Promise.reject(new Error('insert failed')) })
        await expect(service.open('u1', 's1', events)).rejects.toThrow('insert failed')
        expect(release).toHaveBeenCalledTimes(1)
    })
})
