import 'reflect-metadata'

import type { ExecutionContext } from '@nestjs/common'
import { HttpException, HttpStatus } from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'

import {
    positiveIntSetting,
    SHARED_RATE_LIMIT_MAX,
    SHARED_RATE_LIMIT_MAX_TRACKED,
    SharedScoreRateLimitGuard,
    SharedScoresController,
} from '../../src/scores/shared-scores.controller'

vi.mock('../../src/scores/entities/score.entity', () => ({ Score: class Score {} }))
vi.mock('../../src/cache/cache.service', () => ({ CacheService: class CacheService {} }))
vi.mock('../../src/storage/storage.service', () => ({ StorageService: class StorageService {} }))

/** Per-IP fixed-window limiter on the public share route. */

function makeContext(ip: string | undefined) {
    const headers: Record<string, string> = {}
    const reply = { header: vi.fn((name: string, value: string) => (headers[name] = value)) }
    const ctx = { switchToHttp: () => ({ getRequest: () => ({ ip }), getResponse: () => reply }) } as unknown as ExecutionContext
    return { ctx, headers }
}

describe('SharedScoreRateLimitGuard', () => {
    it('defaults to a ceiling below the global 120/min', () => {
        // The exported constant reads the environment at import time, so only its bound is asserted here.
        expect(SHARED_RATE_LIMIT_MAX).toBeLessThan(120)
        expect(positiveIntSetting(undefined, 30)).toBe(30)
        expect(positiveIntSetting('45', 30)).toBe(45)
    })

    it('falls back to the default on a malformed or non-positive setting instead of disabling the limiter', () => {
        expect(positiveIntSetting('abc', 30)).toBe(30)
        expect(positiveIntSetting('0', 30)).toBe(30)
        expect(positiveIntSetting('-5', 30)).toBe(30)
        expect(positiveIntSetting('', 60_000)).toBe(60_000)
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
        now = 59_999 // the last millisecond of the window is still throttled
        expect(() => guard.canActivate(ctx)).toThrow(HttpException)
        now = 60_000
        expect(guard.canActivate(ctx)).toBe(true)
    })

    it('requests without a resolvable address share one bucket (behind a proxy without TRUST_PROXY, that is everyone)', () => {
        const guard = SharedScoreRateLimitGuard.create(1, 60_000, () => 0)
        const a = makeContext(undefined)
        const b = makeContext(undefined)
        expect(guard.canActivate(a.ctx)).toBe(true)
        expect(() => guard.canActivate(b.ctx)).toThrow(HttpException)
    })

    it('forgets all clients rather than growing without bound under a flood of distinct addresses', () => {
        const guard = SharedScoreRateLimitGuard.create(1, 60_000, () => 0)
        const first = makeContext('203.0.113.7') // outside the 10.x.x.x flood below
        expect(guard.canActivate(first.ctx)).toBe(true)
        for (let i = 0; i < SHARED_RATE_LIMIT_MAX_TRACKED; i++)
            guard.canActivate(makeContext(`10.${i >> 16}.${(i >> 8) & 255}.${i & 255}`).ctx)
        // The map was cleared somewhere in the flood, so the first client has a fresh window again.
        expect(guard.canActivate(first.ctx)).toBe(true)
    })

    it('is bound to the shared controller via @UseGuards', () => {
        const guards = Reflect.getMetadata('__guards__', SharedScoresController) as unknown[]
        expect(guards).toContain(SharedScoreRateLimitGuard)
    })
})
