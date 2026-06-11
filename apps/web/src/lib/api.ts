const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'

/** The server responded, but with an error status. */
export class ApiError extends Error {
    constructor(
        readonly status: number,
        message: string,
    ) {
        super(message)
        this.name = 'ApiError'
    }

    /** Client errors (bad request, not found, …) are final — retrying won't change the answer. */
    get isClientError(): boolean {
        return this.status >= 400 && this.status < 500
    }
}

/** The server could not be reached at all (down, offline, DNS, CORS). */
export class NetworkError extends Error {
    constructor(cause?: unknown) {
        super('Could not reach the server', { cause })
        this.name = 'NetworkError'
    }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
    let res: Response
    try {
        res = await fetch(`${API_URL}${path}`, {
            ...init,
            credentials: 'include',
            headers: {
                'Content-Type': 'application/json',
                ...init?.headers,
            },
        })
    } catch (err) {
        throw new NetworkError(err)
    }

    if (!res.ok) {
        // Prefer the server's message when it sends one ({ message } or { error }).
        let message = `API error: ${res.status} ${res.statusText}`
        try {
            const body: unknown = await res.clone().json()
            if (body && typeof body === 'object') {
                const detail = (body as { message?: unknown; error?: unknown }).message ?? (body as { error?: unknown }).error
                if (typeof detail === 'string' && detail) message = detail
            }
        } catch {
            // Non-JSON error body — keep the status-line message.
        }
        throw new ApiError(res.status, message)
    }

    return res.json() as Promise<T>
}

export interface ScoreMeta {
    id: string
    title: string
    createdAt: string
    updatedAt: string
}

export function listScores(search?: string): Promise<ScoreMeta[]> {
    const params = search ? `?search=${encodeURIComponent(search)}` : ''
    return api(`/scores${params}`)
}

export function getScore(id: string): Promise<ScoreMeta> {
    return api(`/scores/${id}`)
}

export function loadScore(id: string): Promise<Record<string, unknown>> {
    return api(`/scores/${id}/load`)
}

export function createScore(title: string, score: Record<string, unknown>): Promise<ScoreMeta> {
    return api('/scores', {
        method: 'POST',
        body: JSON.stringify({ title, score }),
    })
}

export function updateScore(
    id: string,
    data: { title?: string; measures?: Record<string, unknown>; allMeasures?: unknown[]; partList?: Record<string, unknown> },
): Promise<ScoreMeta> {
    return api(`/scores/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
    })
}

export function deleteScore(id: string): Promise<void> {
    return api(`/scores/${id}`, { method: 'DELETE' })
}

export interface AccountDeletionStatus {
    pending: boolean
    requestedAt?: string
    /** End of the 7-day grace period; the account is permanently deleted after this. */
    purgeAfter?: string
}

/** Soft-delete: starts the grace period and signs the user out everywhere. */
export function requestAccountDeletion(password: string): Promise<AccountDeletionStatus> {
    return api('/account/delete', {
        method: 'POST',
        body: JSON.stringify({ password }),
    })
}

export function getAccountDeletionStatus(): Promise<AccountDeletionStatus> {
    return api('/account/deletion')
}

export function reactivateAccount(): Promise<AccountDeletionStatus> {
    // Fastify rejects an empty body when Content-Type is application/json.
    return api('/account/reactivate', { method: 'POST', body: '{}' })
}

export interface OnboardingPatch {
    background?: string
    instruments?: string[]
    source?: string
    sourceDetail?: string
    completedAt?: string
}

export function patchOnboarding(patch: OnboardingPatch): Promise<unknown> {
    return api('/onboarding', {
        method: 'PATCH',
        body: JSON.stringify(patch),
    })
}
