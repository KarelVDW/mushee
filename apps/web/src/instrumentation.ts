import type { Instrumentation } from 'next'

/**
 * Server-side error tracking: uncaught errors in server components, route
 * handlers, and rendering are reported to PostHog. The distinct id is only
 * recovered from the PostHog cookie, which exists solely for visitors who
 * opted in to analytics — everyone else is reported anonymously.
 */
export const onRequestError: Instrumentation.onRequestError = async (err, request) => {
    if (process.env.NEXT_RUNTIME !== 'nodejs') return
    const { getPostHogServer } = await import('./lib/posthog-server')
    const posthog = getPostHogServer()
    if (!posthog) return

    let distinctId: string | undefined
    const cookies = request.headers.cookie
    const cookieString = Array.isArray(cookies) ? cookies.join('; ') : (cookies ?? '')
    const match = /ph_phc_.*?_posthog=([^;]+)/.exec(cookieString)
    if (match) {
        try {
            const data = JSON.parse(decodeURIComponent(match[1])) as { distinct_id?: string }
            distinctId = data.distinct_id
        } catch {
            // Unparseable cookie — report anonymously.
        }
    }

    posthog.captureException(err, distinctId)
}
