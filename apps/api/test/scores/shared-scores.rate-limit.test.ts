import 'reflect-metadata'

import { HttpException, HttpStatus } from '@nestjs/common'
import type { ExecutionContext } from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'

import { SHARED_RATE_LIMIT_MAX, SharedScoreRateLimitGuard, SharedScoresController } from '../../src/scores/shared-scores.controller'

vi.mock('../../src/scores/entities/score.entity', () => ({ Score: class Score {} }))
vi.mock('../../src/cache/cache.service', () => ({ CacheService: class CacheService {} }))
vi.mock('../../src/storage/storage.service', () => ({ StorageService: class StorageService {} }))

/** Per-IP fixed-window limiter on the public share route. */

function makeContext(ip: string) {
    const headers: Record<string, string> = {}
    const reply = { header: vi.fn((name: string, value: string) => (headers[name] = value)) }
    const ctx = { switchToHttp: () => ({ getRequest: () => ({ ip }), getResponse: () => reply }) } as unknown as ExecutionContext
    return { ctx, headers }
}

describe('SharedScoreRateLimitGuard', () => {
    it('defaults to a ceiling below the global 120/min', () => {
        expect(SHARED_RATE_LIMIT_MAX).toBe(30)
        expect(SHARED_RATE_LIMIT_MAX).toBeLessThan(120)
    })

    it('allows up to max requests per IP, then answers 429 with retry-after', () => {
        let now = 1_000_000
        const guard = SharedScoreRateLimitGuard.create(3, 60_000, () => now)
        const { ctx, headers } = makeContext('10.0.0.1')

        expect(guard.canActivate(ctx)).toBe(true)
        expect(guard.canActivate(ctx)).toBe(true)
        expect(guard.canActivate(ctx)).toBe(true)
        expect(headers['x-ratelimit-remaining']).toBe('0')
        expect(headers['x-ratelimit-limit']).toBe('3')

        now += 15_000
        let thrown: unknown
        try {
            guard.canActivate(ctx)
        } catch (e) {
            thrown = e
        }
        expect(thrown).toBeInstanceOf(HttpException)
        expect((thrown as HttpException).getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS)
        expect(headers['retry-after']).toBe('45')
    })

    it('keys per IP: one client being throttled does not affect another', () => {
        const guard = SharedScoreRateLimitGuard.create(1, 60_000, () => 0)
        const a = makeContext('10.0.0.1')
        const b = makeContext('10.0.0.2')
        expect(guard.canActivate(a.ctx)).toBe(true)
        expect(() => guard.canActivate(a.ctx)).toThrow(HttpException)
        expect(guard.canActivate(b.ctx)).toBe(true)
    })

    it('resets the counter once the window has elapsed', () => {
        let now = 0
        const guard = SharedScoreRateLimitGuard.create(1, 60_000, () => now)
        const { ctx } = makeContext('10.0.0.1')
        expect(guard.canActivate(ctx)).toBe(true)
        expect(() => guard.canActivate(ctx)).toThrow(HttpException)
        now = 60_000
        expect(guard.canActivate(ctx)).toBe(true)
    })

    it('is bound to the shared controller via @UseGuards', () => {
        const guards = Reflect.getMetadata('__guards__', SharedScoresController) as unknown[]
        expect(guards).toContain(SharedScoreRateLimitGuard)
    })
})
