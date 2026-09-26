import { EventEmitter } from 'node:events'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
    errorReporterFromEnv,
    type ExceptionSink,
    monitorProcessErrors,
    NoopErrorReporter,
    PostHogErrorReporter,
} from '../../src/telemetry/error-reporter'

function sink(): ExceptionSink & { captureException: ReturnType<typeof vi.fn>; shutdown: ReturnType<typeof vi.fn> } {
    return { captureException: vi.fn(), shutdown: vi.fn(() => Promise.resolve()) } as never
}

describe('PostHogErrorReporter', () => {
    it('captures with the user as distinct id when known, the server otherwise (person-less)', () => {
        const client = sink()
        const reporter = new PostHogErrorReporter(client, 'api:test-host')
        const error = new Error('boom')

        reporter.capture(error, { origin: 'http', method: 'GET', path: '/scores', status: 500, userId: 'u1' })
        expect(client.captureException).toHaveBeenLastCalledWith(error, 'u1', {
            origin: 'http',
            method: 'GET',
            path: '/scores',
            status: 500,
            server: 'api:test-host',
            $process_person_profile: true,
        })

        reporter.capture(error, { origin: 'process', event: 'uncaughtException' })
        expect(client.captureException).toHaveBeenLastCalledWith(error, 'api:test-host', {
            origin: 'process',
            event: 'uncaughtException',
            server: 'api:test-host',
            $process_person_profile: false,
        })
    })

    it('never lets a failing report escape', async () => {
        const client = sink()
        client.captureException.mockImplementation(() => {
            throw new Error('network')
        })
        client.shutdown.mockRejectedValue(new Error('network'))
        const reporter = new PostHogErrorReporter(client, 'api:test-host')
        expect(() => reporter.capture(new Error('x'), { origin: 'http' })).not.toThrow()
        await expect(reporter.shutdown()).resolves.toBeUndefined()
    })
})

describe('errorReporterFromEnv', () => {
    it('is a no-op without a key, warning only in production', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
        expect(errorReporterFromEnv({ NODE_ENV: 'development' })).toBeInstanceOf(NoopErrorReporter)
        expect(errorReporterFromEnv({ NODE_ENV: 'development' }).enabled).toBe(false)
        expect(warn).not.toHaveBeenCalled()
        expect(stderr).not.toHaveBeenCalled()
        vi.restoreAllMocks()
    })

    it('builds a PostHog-backed reporter when a key is present', async () => {
        const reporter = errorReporterFromEnv({ POSTHOG_API_KEY: 'phc_test', POSTHOG_HOST: 'https://eu.i.posthog.com' })
        expect(reporter).toBeInstanceOf(PostHogErrorReporter)
        expect(reporter.enabled).toBe(true)
        await reporter.shutdown() // nothing queued; must not hang or throw
    })
})

describe('monitorProcessErrors', () => {
    afterEach(() => vi.restoreAllMocks())

    it('reports through the crash monitor without registering a handler that would swallow the crash', () => {
        const client = sink()
        const reporter = new PostHogErrorReporter(client, 'api:test-host')
        const emitter = new EventEmitter()
        const proc = emitter as unknown as NodeJS.Process
        const off = monitorProcessErrors(reporter, proc)

        expect(proc.listenerCount('uncaughtException')).toBe(0)
        expect(proc.listenerCount('unhandledRejection')).toBe(0)
        expect(proc.listenerCount('uncaughtExceptionMonitor')).toBe(1)

        const error = new Error('crash')
        emitter.emit('uncaughtExceptionMonitor', error, 'unhandledRejection')
        expect(client.captureException).toHaveBeenCalledWith(
            error,
            'api:test-host',
            expect.objectContaining({ origin: 'process', event: 'unhandledRejection' }),
        )

        off()
        expect(proc.listenerCount('uncaughtExceptionMonitor')).toBe(0)
    })

    it('installs nothing for a disabled reporter', () => {
        const proc = new EventEmitter() as unknown as NodeJS.Process
        monitorProcessErrors(new NoopErrorReporter(), proc)
        expect(proc.listenerCount('uncaughtExceptionMonitor')).toBe(0)
    })
})
