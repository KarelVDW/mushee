import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'

import type { PipelineHealth, RecordingPipeline, ScoreUpdate, SourceResolution } from '../../src/recordings/pipeline/recording-pipeline'
import type { RecordingArchiver } from '../../src/recordings/recording-archiver'
import type { RecordingCreditBalance, RecordingCreditsService } from '../../src/recordings/recording-credits.service'
import type { RecordingLock } from '../../src/recordings/recording-locks.service'
import { RecordingSession, type RecordingSessionEvents } from '../../src/recordings/recording-session'

/**
 * The credit meter around a transcription outage. When the inference service is
 * unreachable the pipeline reports `ok: false`; the session must stop billing
 * from that moment, tell the client, and — once transcription is back — resume
 * without charging the outage retroactively (the wall-clock/decoded-audio
 * catch-up must skip the waived stretch).
 */

class FakePipeline {
    audioDurationSec = 0
    private health: (health: PipelineHealth) => void = () => {}
    setOnUpdate(_cb: (update: ScoreUpdate) => void) {}
    setOnSourceResolved(_cb: (resolution: SourceResolution) => void) {}
    setOnHealth(cb: (health: PipelineHealth) => void) {
        this.health = cb
    }
    setArchiver(_archiver: RecordingArchiver) {}
    setMeta() {}
    appendChunk(_buffer: Buffer) {}
    finalize() {
        return Promise.resolve()
    }
    /** Test hook: the pipeline reporting a failed / recovered pass. */
    report(health: PipelineHealth) {
        this.health(health)
    }
}

function balance(exhausted = false): RecordingCreditBalance {
    return { used: 0, remaining: exhausted ? 0 : 1000, exhausted, packSeconds: 0 } as unknown as RecordingCreditBalance
}

describe('RecordingSession metering during a transcription outage', () => {
    let pipeline: FakePipeline
    let spend: ReturnType<typeof vi.fn>
    let onHealth: Mock<(health: PipelineHealth) => void>
    let events: RecordingSessionEvents
    let session: RecordingSession

    beforeEach(() => {
        vi.useFakeTimers()
        pipeline = new FakePipeline()
        spend = vi.fn(() => Promise.resolve(balance()))
        onHealth = vi.fn<(health: PipelineHealth) => void>()
        events = { onUpdate: vi.fn(), onLimitReached: vi.fn(), onHealth }
        const repo = {
            save: vi.fn((row: object) => Promise.resolve({ id: 'rec-1', ...row })),
            create: (row: object) => row,
            update: vi.fn(() => Promise.resolve()),
        }
        session = new RecordingSession(
            'user-1',
            'score-1',
            pipeline as unknown as RecordingPipeline,
            { spend } as unknown as RecordingCreditsService,
            repo as never,
            events,
            { release: () => Promise.resolve() } as unknown as RecordingLock,
            () => ({ basePath: 'recordings/u/s/r', appendAudio() {} }) as unknown as RecordingArchiver,
        )
    })

    afterEach(() => vi.useRealTimers())

    const spent = () => spend.mock.calls.reduce((sum, call) => sum + (call[1] as number), 0)

    /** Let `seconds` of wall-clock pass with the same amount of audio decoded. */
    async function record(seconds: number) {
        for (let i = 0; i < seconds; i++) {
            pipeline.audioDurationSec += 1
            await vi.advanceTimersByTimeAsync(1000)
        }
    }

    it('bills one credit per second while transcription is healthy', async () => {
        session.appendChunk(Buffer.alloc(10))
        await vi.advanceTimersByTimeAsync(0)
        expect(spent()).toBe(1) // the first second is billed up front
        await record(4)
        expect(spent()).toBe(5)
        expect(session.degraded).toBe(false)
    })

    it('pauses the meter while transcription is down, tells the client once, and never bills the outage', async () => {
        session.appendChunk(Buffer.alloc(10))
        await record(3)
        const before = spent()

        pipeline.report({ ok: false, message: '14 UNAVAILABLE: crepe-inference' })
        pipeline.report({ ok: false, message: 'again' }) // a repeat report changes nothing
        expect(session.degraded).toBe(true)
        expect(onHealth).toHaveBeenCalledTimes(1)
        expect(onHealth).toHaveBeenLastCalledWith({ ok: false, message: '14 UNAVAILABLE: crepe-inference' })

        await record(10) // ten seconds of audio with a dead model: archived, not charged
        expect(spent()).toBe(before)

        pipeline.report({ ok: true })
        expect(session.degraded).toBe(false)
        expect(onHealth).toHaveBeenCalledTimes(2)
        expect(onHealth).toHaveBeenLastCalledWith({ ok: true })

        // Back to one credit per second — the catch-up must not sweep in the waived ten.
        await record(3)
        expect(spent()).toBe(before + 3)
    })

    it('ignores health reports after close', async () => {
        session.appendChunk(Buffer.alloc(10))
        await session.close()
        pipeline.report({ ok: false, message: 'down' })
        expect(onHealth).not.toHaveBeenCalled()
        expect(session.degraded).toBe(false)
    })
})
