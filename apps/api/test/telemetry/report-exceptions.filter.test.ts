import { type ArgumentsHost, BadRequestException, InternalServerErrorException, NotFoundException } from '@nestjs/common'
import { BaseExceptionFilter } from '@nestjs/core'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { type ErrorContext, ErrorReporter } from '../../src/telemetry/error-reporter'
import { ReportExceptionsFilter } from '../../src/telemetry/report-exceptions.filter'

class SpyReporter extends ErrorReporter {
    readonly enabled = true
    readonly captured: Array<{ error: unknown; context: ErrorContext }> = []
    capture(error: unknown, context: ErrorContext): void {
        this.captured.push({ error, context })
    }
    shutdown(): Promise<void> {
        return Promise.resolve()
    }
}

function httpHost(request: Record<string, unknown>): ArgumentsHost {
    return {
        getType: () => 'http',
        switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ArgumentsHost
}

describe('ReportExceptionsFilter', () => {
    afterEach(() => vi.restoreAllMocks())

    it('reports unknown errors and 5xx with request context, then defers to Nest for the response', () => {
        const base = vi.spyOn(BaseExceptionFilter.prototype, 'catch').mockImplementation(() => {})
        const reporter = new SpyReporter()
        const filter = new ReportExceptionsFilter(reporter)
        const host = httpHost({ method: 'PATCH', url: '/scores/abc?x=1', id: 'req-7', user: { id: 'u1' } })

        const boom = new TypeError('cannot read')
        filter.catch(boom, host)
        filter.catch(new InternalServerErrorException('db'), host)

        expect(reporter.captured.map((c) => c.error)).toEqual([boom, expect.any(InternalServerErrorException)])
        expect(reporter.captured[0].context).toEqual({
            origin: 'http',
            method: 'PATCH',
            path: '/scores/abc',
            status: 500,
            userId: 'u1',
            requestId: 'req-7',
        })
        expect(base).toHaveBeenCalledTimes(2)
    })

    it('leaves client errors (4xx) out of the tracker but still answers them', () => {
        const base = vi.spyOn(BaseExceptionFilter.prototype, 'catch').mockImplementation(() => {})
        const reporter = new SpyReporter()
        const filter = new ReportExceptionsFilter(reporter)
        const host = httpHost({ method: 'GET', url: '/scores/missing' })

        filter.catch(new NotFoundException(), host)
        filter.catch(new BadRequestException(), host)
        expect(reporter.captured).toEqual([])
        expect(base).toHaveBeenCalledTimes(2)
    })

    it('records non-HTTP (gateway) exceptions without touching the HTTP response path', () => {
        const base = vi.spyOn(BaseExceptionFilter.prototype, 'catch').mockImplementation(() => {})
        const reporter = new SpyReporter()
        const filter = new ReportExceptionsFilter(reporter)
        const wsHost = { getType: () => 'ws' } as unknown as ArgumentsHost

        filter.catch(new Error('socket'), wsHost)
        expect(reporter.captured[0].context).toEqual({ origin: 'ws' })
        expect(base).not.toHaveBeenCalled()
    })
})
