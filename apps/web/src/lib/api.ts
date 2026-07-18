import type { StoredShortcuts } from './Keybindings'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4200'

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
    goal?: string
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

// ── Settings ────────────────────────────────────────────────────────────────

export interface UserSettings {
    /** Keyboard shortcut overrides in Keybindings' storage format; null = all defaults. */
    keyboardShortcuts: StoredShortcuts | null
}

export function getSettings(): Promise<UserSettings> {
    return api('/settings')
}

export function putKeyboardShortcuts(keyboardShortcuts: StoredShortcuts | null): Promise<UserSettings> {
    return api('/settings/keyboard-shortcuts', {
        method: 'PUT',
        body: JSON.stringify({ keyboardShortcuts }),
    })
}

// ── Plans (database-driven tier catalogue) ──────────────────────────────────

export interface Plan {
    id: string
    name: string
    /** Daily recording budget in seconds; null = unlimited. */
    dailyRecordingCredits: number | null
    /** Maximum saved scores; null = no cap. */
    maxScores: number | null
    /** Whether the plan appears in pickers (beta is assigned, never sold). */
    sellable: boolean
}

/** The tier catalogue as the server knows it. Public — no session required. */
export function listPlans(): Promise<Plan[]> {
    return api('/plans')
}

// ── Billing (Polar) ─────────────────────────────────────────────────────────

export interface BillingState {
    tierId: 'free' | 'pro' | 'studio' | 'arranger' | 'beta'
    tierName: string
    /** Polar subscription status ('active', 'trialing', …); null on free/beta. */
    status: string | null
    /** Billing cadence of the active subscription; null on free/beta. */
    interval: 'monthly' | 'yearly' | null
    currentPeriodEnd: string | null
    cancelAtPeriodEnd: boolean
    billingConfigured: boolean
    betaMode: boolean
    credits: {
        limitSeconds: number | null
        usedSeconds: number
        remainingSeconds: number | null
        /** Purchased one-time pack seconds; never expire. */
        packSeconds: number
    }
}

export function getBillingState(): Promise<BillingState> {
    return api('/billing/subscription')
}

export type PaidTierId = 'pro' | 'studio' | 'arranger'

/** Returns the Polar-hosted checkout URL to redirect the browser to. */
export function createCheckout(tierId: PaidTierId, interval: 'monthly' | 'yearly'): Promise<{ url: string }> {
    return api('/billing/checkout', {
        method: 'POST',
        body: JSON.stringify({ tierId, interval }),
    })
}

/** Checkout URL for a one-time minute pack (no subscription involved). */
export function createPackCheckout(packId: 'single' | 'ep' | 'album'): Promise<{ url: string }> {
    return api('/billing/checkout/pack', {
        method: 'POST',
        body: JSON.stringify({ packId }),
    })
}

/** Returns the Polar-hosted customer portal URL (invoices, payment method). */
export function createBillingPortalSession(): Promise<{ url: string }> {
    return api('/billing/portal', { method: 'POST', body: '{}' })
}

/** Switch tier/cadence on an existing subscription (prorated by Polar). */
export function changePlan(tierId: PaidTierId, interval: 'monthly' | 'yearly'): Promise<BillingState> {
    return api('/billing/change', {
        method: 'POST',
        body: JSON.stringify({ tierId, interval }),
    })
}

export function cancelSubscription(): Promise<BillingState> {
    return api('/billing/cancel', { method: 'POST', body: '{}' })
}

export function resumeSubscription(): Promise<BillingState> {
    return api('/billing/resume', { method: 'POST', body: '{}' })
}

// ── Closed beta ─────────────────────────────────────────────────────────────

export interface BetaStatus {
    betaMode: boolean
    /** null = account predates the beta (never gated). */
    status: 'pending' | 'approved' | null
    role: string
}

/** Fresh from the database — the waiting screen polls this to spot approval. */
export function getBetaStatus(): Promise<BetaStatus> {
    return api('/beta/status')
}

export interface BetaSignup {
    id: string
    name: string
    email: string
    status: 'pending' | 'approved'
    createdAt: string
}

export function listBetaSignups(): Promise<BetaSignup[]> {
    return api('/admin/beta/signups')
}

export function approveBetaSignup(userId: string): Promise<BetaSignup[]> {
    return api(`/admin/beta/signups/${userId}/approve`, { method: 'POST', body: '{}' })
}

export function revokeBetaSignup(userId: string): Promise<BetaSignup[]> {
    return api(`/admin/beta/signups/${userId}/revoke`, { method: 'POST', body: '{}' })
}
