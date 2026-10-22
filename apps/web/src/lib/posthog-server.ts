import { PostHog } from 'posthog-node'

import { POSTHOG_HOST, POSTHOG_KEY } from './env'

/**
 * Server-side PostHog client (error tracking for server/render errors via
 * instrumentation.ts). Flushes immediately — serverless-safe. Returns null
 * when no key is configured.
 */

let client: PostHog | null | undefined

export function getPostHogServer(): PostHog | null {
    if (client !== undefined) return client
    client = POSTHOG_KEY
        ? new PostHog(POSTHOG_KEY, {
              host: POSTHOG_HOST,
              flushAt: 1,
              flushInterval: 0,
          })
        : null
    return client
}
