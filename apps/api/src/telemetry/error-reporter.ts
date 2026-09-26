import { hostname } from 'node:os'

import { Logger } from '@nestjs/common'
import { PostHog } from 'posthog-node'

/**
 * Where an error surfaced and what was going on. Kept flat and boring so it can
 * be attached to an event as-is; never put secrets or request bodies in here.
 */
export interface ErrorContext {
    /** 'http' (request handling), 'process' (uncaught exception / unhandled rejection), 'recording', … */
    origin: string
    userId?: string
    method?: string
    path?: string
    status?: number
    [detail: string]: string | number | boolean | undefined
}

/**
 * The API's error-tracking seam. Production users report bugs as vibes; this
 * turns unexpected server errors into stack traces in the error tracker. The
 * web app already captures browser exceptions into PostHog (see
 * `apps/web/src/lib/analytics.ts`); the API reports into the same project so
 * one place shows both halves of an incident.
 *
 * Injectable Nest token (abstract class) — the filter and any service that
 * wants to report a swallowed error depend on this, not on PostHog.
 */
export abstract class ErrorReporter {
    abstract readonly enabled: boolean
    abstract capture(error: unknown, context: ErrorContext): void
    /** Flush pending events; called on application shutdown. */
    abstract shutdown(): Promise<void>
}

/** Installed when no tracker is configured: local dev, tests, CI. */
export class NoopErrorReporter extends ErrorReporter {
    readonly enabled = false
    capture(): void {}
    shutdown(): Promise<void> {
        return Promise.resolve()
    }
}

/** The subset of the PostHog client the reporter uses — small enough to fake in tests. */
export type ExceptionSink = Pick<PostHog, 'captureException' | 'shutdown'>

export class PostHogErrorReporter extends ErrorReporter {
    readonly enabled = true
    private readonly logger = new Logger(PostHogErrorReporter.name)

    constructor(
        private readonly client: ExceptionSink,
        /** Identifies this server in the tracker (person-less: `$process_person_profile` is off). */
        private readonly serverId = `api:${hostname()}`,
    ) {
        super()
    }

    capture(error: unknown, context: ErrorContext): void {
        try {
            const { userId, ...details } = context
            this.client.captureException(error, userId ?? this.serverId, {
                ...details,
                server: this.serverId,
                // Server-side events must not mint person profiles for hostnames.
                $process_person_profile: userId !== undefined,
            })
        } catch (err) {
            // Reporting must never take the request down with it.
            this.logger.warn(`Error report failed: ${err instanceof Error ? err.message : String(err)}`)
        }
    }

    async shutdown(): Promise<void> {
        try {
            // Bounded: a PostHog outage must not eat the pod's termination grace period.
            await this.client.shutdown(SHUTDOWN_TIMEOUT_MS)
        } catch (err) {
            this.logger.warn(`Error reporter shutdown failed: ${err instanceof Error ? err.message : String(err)}`)
        }
    }
}

const DEFAULT_HOST = 'https://eu.i.posthog.com'
const SHUTDOWN_TIMEOUT_MS = 5000

/**
 * Build the reporter from the environment: `POSTHOG_API_KEY` (the project API
 * key — the same value as the web's `NEXT_PUBLIC_POSTHOG_KEY` works) and the
 * optional `POSTHOG_HOST` (EU cloud by default). Unset → no-op, with a warning
 * in production so a blind launch is never silent.
 */
export function errorReporterFromEnv(env: NodeJS.ProcessEnv = process.env): ErrorReporter {
    const key = env.POSTHOG_API_KEY?.trim()
    if (!key) {
        if (env.NODE_ENV === 'production') {
            new Logger('ErrorReporter').warn('POSTHOG_API_KEY is not set: server errors are only logged, not tracked.')
        }
        return new NoopErrorReporter()
    }
    const client = new PostHog(key, {
        host: env.POSTHOG_HOST?.trim() || DEFAULT_HOST,
        // Deliver within a couple of seconds, but batch: during an outage every
        // request fails at once, and one POST per error would add a second load
        // to a pod that is already unhealthy.
        flushAt: 20,
        flushInterval: 2000,
        // We register our own crash monitor (below) so the process keeps its
        // fail-fast semantics; the SDK's hook would take over the handlers.
        enableExceptionAutocapture: false,
    })
    return new PostHogErrorReporter(client)
}

/**
 * Report crashes without changing how the process dies. `uncaughtExceptionMonitor`
 * observes both uncaught exceptions and (under Node's default
 * `--unhandled-rejections=throw`) unhandled rejections, and — unlike an
 * 'uncaughtException' handler — does not stop Node from exiting afterwards, so
 * Kubernetes still restarts the pod. Delivery is best-effort: the flush races
 * the exit. Returns the unsubscribe function.
 */
export function monitorProcessErrors(reporter: ErrorReporter, proc: NodeJS.Process = process): () => void {
    if (!reporter.enabled) return () => {}
    const monitor = (error: Error, origin: NodeJS.UncaughtExceptionOrigin) => {
        reporter.capture(error, { origin: 'process', event: origin })
    }
    proc.on('uncaughtExceptionMonitor', monitor)
    return () => {
        proc.off('uncaughtExceptionMonitor', monitor)
    }
}
