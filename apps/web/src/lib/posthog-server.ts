import { PostHog } from 'posthog-node'

/**
 * Server-side PostHog client (error tracking for server/render errors via
 * instrumentation.ts). Flushes immediately — serverless-safe. Returns null
 * when no key is configured.
 */

let client: PostHog | null | undefined

export function getPostHogServer(): PostHog | null {
    if (client !== undefined) return client
    const key = process.env.NEXT_PUBLIC_POSTHOG_KEY
    client = key
        ? new PostHog(key, {
              host: process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://eu.i.posthog.com',
              flushAt: 1,
              flushInterval: 0,
          })
        : null
    return client
}
