import { type ArgumentsHost, Catch, HttpException, Injectable } from '@nestjs/common'
import { BaseExceptionFilter } from '@nestjs/core'
import type { FastifyRequest } from 'fastify'

import { ErrorReporter } from './error-reporter'

type RequestWithUser = FastifyRequest & { user?: { id?: string } }

/**
 * Global exception filter: reports what Nest would answer with a 5xx — unknown
 * errors and explicit server-side HttpExceptions — then hands over to Nest's
 * default handling, so responses are exactly what they were before. Client
 * errors (4xx: validation, auth, not found, plan limits) are expected traffic
 * and stay out of the tracker.
 */
@Catch()
@Injectable()
export class ReportExceptionsFilter extends BaseExceptionFilter {
    constructor(private readonly reporter: ErrorReporter) {
        super()
    }

    catch(exception: unknown, host: ArgumentsHost): void {
        if (host.getType() !== 'http') {
            // Gateways and other contexts: Nest's WS layer answers the client; we only record.
            this.reporter.capture(exception, { origin: host.getType() })
            return
        }
        if (ReportExceptionsFilter.isServerError(exception)) {
            const request = host.switchToHttp().getRequest<RequestWithUser | undefined>()
            this.reporter.capture(exception, {
                origin: 'http',
                method: request?.method,
                path: request?.url?.split('?')[0],
                status: exception instanceof HttpException ? exception.getStatus() : 500,
                userId: request?.user?.id,
                requestId: typeof request?.id === 'string' ? request.id : undefined,
            })
        }
        super.catch(exception, host)
    }

    static isServerError(exception: unknown): boolean {
        return !(exception instanceof HttpException) || exception.getStatus() >= 500
    }
}
