import { CanActivate, Controller, ExecutionContext, Get, HttpException, HttpStatus, Injectable, Param, UseGuards } from '@nestjs/common'
import type { FastifyReply, FastifyRequest } from 'fastify'

import { ScoresService } from './scores.service'

/** Requests per IP per window on the public share endpoint (default 30/min);
 *  tighter than the global limiter, which keys per-user and allows 120/min. */
export const SHARED_RATE_LIMIT_MAX = parseInt(process.env.SHARED_RATE_LIMIT_MAX ?? '30', 10)
export const SHARED_RATE_LIMIT_WINDOW_MS = parseInt(process.env.SHARED_RATE_LIMIT_WINDOW_MS ?? String(60_000), 10)

/**
 * Fixed-window per-IP counter for the unauthenticated share route. The global
 * @fastify/rate-limit instance stays untouched and still applies on top; this
 * guard only lowers the ceiling for token guessing on `/shared/:token`. Nest
 * doesn't expose Fastify's per-route `config.rateLimit`, hence a guard.
 * Per-process memory, like the global limiter's default store.
 */
@Injectable()
export class SharedScoreRateLimitGuard implements CanActivate {
    private readonly hits = new Map<string, { count: number; resetAt: number }>()

    // No constructor parameters: Nest instantiates guards through DI and would
    // try to resolve `Number`/`Function` tokens for typed params. Tests use create().
    private max = SHARED_RATE_LIMIT_MAX
    private windowMs = SHARED_RATE_LIMIT_WINDOW_MS
    private now: () => number = Date.now

    static create(max: number, windowMs: number, now: () => number = Date.now): SharedScoreRateLimitGuard {
        const guard = new SharedScoreRateLimitGuard()
        guard.max = max
        guard.windowMs = windowMs
        guard.now = now
        return guard
    }

    canActivate(context: ExecutionContext): boolean {
        const http = context.switchToHttp()
        const req = http.getRequest<FastifyRequest>()
        const reply = http.getResponse<FastifyReply>()
        const now = this.now()
        const key = req.ip ?? 'unknown'

        let entry = this.hits.get(key)
        if (!entry || entry.resetAt <= now) {
            if (this.hits.size > 10_000) this.prune(now)
            entry = { count: 0, resetAt: now + this.windowMs }
            this.hits.set(key, entry)
        }
        entry.count += 1

        const retryAfterSec = Math.max(1, Math.ceil((entry.resetAt - now) / 1000))
        const remaining = Math.max(0, this.max - entry.count)
        reply.header?.('x-ratelimit-limit', String(this.max))
        reply.header?.('x-ratelimit-remaining', String(remaining))
        reply.header?.('x-ratelimit-reset', String(retryAfterSec))

        if (entry.count > this.max) {
            reply.header?.('retry-after', String(retryAfterSec))
            throw new HttpException(
                {
                    statusCode: HttpStatus.TOO_MANY_REQUESTS,
                    error: 'Too Many Requests',
                    message: `Rate limit exceeded, retry in ${retryAfterSec} seconds`,
                },
                HttpStatus.TOO_MANY_REQUESTS,
            )
        }
        return true
    }

    private prune(now: number) {
        for (const [key, entry] of this.hits) if (entry.resetAt <= now) this.hits.delete(key)
    }
}

/**
 * Public, unauthenticated: a score behind its share token, for the read-only
 * `/s/<token>` page. Rate-limited per IP more tightly than the rest of the API
 * (see SharedScoreRateLimitGuard); an unknown or revoked token is a plain 404.
 * Deliberately not under /scores so the auth guards there stay blanket.
 */
@Controller('shared')
@UseGuards(SharedScoreRateLimitGuard)
export class SharedScoresController {
    constructor(private readonly scoresService: ScoresService) {}

    @Get(':token')
    load(@Param('token') token: string) {
        return this.scoresService.loadShared(token)
    }
}
