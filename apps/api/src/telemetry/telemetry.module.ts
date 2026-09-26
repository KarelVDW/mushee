import { Global, Module, type OnApplicationShutdown } from '@nestjs/common'
import { APP_FILTER } from '@nestjs/core'

import { ErrorReporter, errorReporterFromEnv } from './error-reporter'
import { ReportExceptionsFilter } from './report-exceptions.filter'

/**
 * Error tracking for the API: the `ErrorReporter` token (global, so any module
 * can report an error it deliberately swallows) and the exception filter that
 * reports unexpected request failures. Pending events are flushed on shutdown.
 */
@Global()
@Module({
    providers: [
        { provide: ErrorReporter, useFactory: () => errorReporterFromEnv() },
        { provide: APP_FILTER, useClass: ReportExceptionsFilter },
    ],
    exports: [ErrorReporter],
})
export class TelemetryModule implements OnApplicationShutdown {
    constructor(private readonly reporter: ErrorReporter) {}

    onApplicationShutdown(): Promise<void> {
        return this.reporter.shutdown()
    }
}
