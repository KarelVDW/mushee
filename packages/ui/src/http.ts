/**
 * The HTTP error model and fetch core every app shares. Endpoint functions
 * and DTOs stay in each app's lib/api.ts; they call requestJson and catch
 * these two error types.
 */

/** The server responded, but with an error status. */
export class ApiError extends Error {
    constructor(
        readonly status: number,
        message: string,
        /** Machine-readable refusal code some endpoints attach (e.g. 'score-limit'). */
        readonly code?: string,
    ) {
        super(message)
        this.name = 'ApiError'
    }

    /** Client errors (bad request, not found, …) are final — retrying won't change the answer. */
    get isClientError(): boolean {
        return this.status >= 400 && this.status < 500
    }

    /** The plan's score cap refused a new score (a create or a copy) — an upgrade prompt, not a failure. */
    get isScoreLimit(): boolean {
        return this.code === 'score-limit'
    }
}

/** The server could not be reached at all (down, offline, DNS, CORS). */
export class NetworkError extends Error {
    constructor(cause?: unknown) {
        super('Could not reach the server', { cause })
        this.name = 'NetworkError'
    }
}

/**
 * `fetch` for a JSON API: resolves with the parsed body (undefined when it is
 * empty), rejects with NetworkError when the server can't be reached and with
 * ApiError on an error status, carrying the server's own message when it sends one.
 */
export async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
    let res: Response
    try {
        res = await fetch(url, {
            ...init,
            headers: {
                // Only claim a JSON body when there is one — the server rejects
                // body-less requests (DELETE) that carry a content-type.
                ...(init?.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
                ...init?.headers,
            },
        })
    } catch (err) {
        throw new NetworkError(err)
    }

    if (!res.ok) {
        // Prefer the server's message when it sends one ({ message } or { error }).
        let message = `API error: ${res.status} ${res.statusText}`
        let code: string | undefined
        try {
            const body: unknown = await res.clone().json()
            if (body && typeof body === 'object') {
                const detail = (body as { message?: unknown; error?: unknown }).message ?? (body as { error?: unknown }).error
                if (typeof detail === 'string' && detail) message = detail
                const bodyCode = (body as { code?: unknown }).code
                if (typeof bodyCode === 'string' && bodyCode) code = bodyCode
            }
        } catch {
            // Non-JSON error body — keep the status-line message.
        }
        throw new ApiError(res.status, message, code)
    }

    // Void endpoints (e.g. DELETE) respond with an empty body — parsing it as
    // JSON would throw even though the request succeeded.
    const text = await res.text()
    return (text ? JSON.parse(text) : undefined) as T
}
