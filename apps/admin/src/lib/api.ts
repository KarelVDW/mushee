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

/** The server could not be reached at all (down, offline, DNS). */
export class NetworkError extends Error {
    constructor(cause?: unknown) {
        super('Could not reach the server', { cause })
        this.name = 'NetworkError'
    }
}

/**
 * Same-origin fetch wrapper: every data call goes to this app's /api routes,
 * which hold the session check and the server-side hop to the real API.
 */
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
    let res: Response
    try {
        res = await fetch(path, {
            ...init,
            headers: {
                ...(init?.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
                ...init?.headers,
            },
        })
    } catch (err) {
        throw new NetworkError(err)
    }

    // An expired console session answers 401 on any data route — go back to
    // the login screen instead of surfacing errors on every widget.
    if (res.status === 401 && path.startsWith('/api/admin') && typeof window !== 'undefined') {
        window.location.assign('/login')
    }

    if (!res.ok) {
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

    const text = await res.text()
    return (text ? JSON.parse(text) : undefined) as T
}

// ── Session ──────────────────────────────────────────────────────────────────

export function login(secret: string): Promise<{ ok: true }> {
    return api('/api/session', { method: 'POST', body: JSON.stringify({ secret }) })
}

export function logout(): Promise<{ ok: true }> {
    return api('/api/session', { method: 'DELETE' })
}

// ── Dashboard ────────────────────────────────────────────────────────────────

export interface AdminStats {
    totals: {
        users: number
        scores: number
        recordings: number
        recordingSeconds: number
        waitlistPending: number
        packSecondsOutstanding: number
        activeUsers7d: number
        newUsers7d: number
    }
    tiers: Array<{ id: string; name: string; users: number }>
    /** Last 30 days, oldest first, zero-filled. */
    timeseries: Array<{ day: string; signups: number; scores: number; recordingSeconds: number }>
}

export function getStats(): Promise<AdminStats> {
    return api('/api/admin/stats')
}

// ── Users ────────────────────────────────────────────────────────────────────

export interface AdminUserRow {
    id: string
    name: string
    email: string
    emailVerified: boolean
    createdAt: string
    role: string
    betaStatus: 'pending' | 'approved' | null
    tierId: string
    tierName: string
    scoreCount: number
    lastActiveAt: string | null
    deletionRequested: boolean
}

export interface AdminUserList {
    users: AdminUserRow[]
    total: number
    page: number
    pageSize: number
}

export function listUsers(params: { search?: string; page?: number; pageSize?: number }): Promise<AdminUserList> {
    const query = new URLSearchParams()
    if (params.search) query.set('search', params.search)
    if (params.page) query.set('page', String(params.page))
    if (params.pageSize) query.set('pageSize', String(params.pageSize))
    const suffix = query.size ? `?${query.toString()}` : ''
    return api(`/api/admin/users${suffix}`)
}

export interface AdminCreditState {
    tierId: string
    tierName: string
    dailyLimit: number | null
    usedToday: number
    remainingToday: number | null
    packSeconds: number
}

export interface AdminUserDetail {
    user: {
        id: string
        name: string
        email: string
        emailVerified: boolean
        image: string | null
        createdAt: string
        updatedAt: string
        role: string
        betaStatus: 'pending' | 'approved' | null
    }
    subscription: {
        tierId: string
        tierName: string | null
        status: string | null
        currentPeriodEnd: string | null
        cancelAtPeriodEnd: boolean
        polarCustomerId: string | null
        polarSubscriptionId: string | null
        createdAt: string
        updatedAt: string
    } | null
    credits: AdminCreditState
    counts: { scoreCount: number; recordingCount: number; recordingSeconds: number }
    sessions: Array<{
        id: string
        createdAt: string
        updatedAt: string
        expiresAt: string
        ipAddress: string | null
        userAgent: string | null
    }>
    recordings: Array<{
        id: string
        scoreId: string
        scoreTitle: string | null
        creditsSpent: number
        createdAt: string
        endedAt: string | null
    }>
    onboarding: {
        background: string | null
        goal: string | null
        instruments: string[] | null
        source: string | null
        sourceDetail: string | null
        completedAt: string | null
    } | null
    deletion: { requestedAt: string; purgeAfter: string } | null
}

export function getUser(id: string): Promise<AdminUserDetail> {
    return api(`/api/admin/users/${encodeURIComponent(id)}`)
}

export interface AdminScoreRow {
    id: string
    title: string
    createdAt: string
    updatedAt: string
    /** Unflushed edits still sitting in the edit cache. */
    hotEdits: boolean
}

export function listUserScores(id: string): Promise<AdminScoreRow[]> {
    return api(`/api/admin/users/${encodeURIComponent(id)}/scores`)
}

export function adjustCredits(id: string, seconds: number): Promise<AdminCreditState> {
    return api(`/api/admin/users/${encodeURIComponent(id)}/credits`, {
        method: 'POST',
        body: JSON.stringify({ seconds }),
    })
}

export function revokeSessions(id: string): Promise<{ revoked: number }> {
    return api(`/api/admin/users/${encodeURIComponent(id)}/sessions`, { method: 'DELETE' })
}

// ── Scores ───────────────────────────────────────────────────────────────────

/** MusicXML-JSON wire format (subset) — see apps/api scores/dto/mxml.dto.ts. */
export interface ScoreDocument {
    partList?: { scoreParts?: Array<{ id: string; partName: string }> }
    parts?: Array<{ id: string; measures?: ScoreMeasure[] }>
    /** Raw MusicXML passthrough for imported files the converter can't parse yet. */
    raw?: string
}

export interface ScoreMeasure {
    number: string
    entries: ScoreEntry[]
}

export interface ScoreEntry {
    _type: 'note' | 'attributes' | 'direction' | 'barline'
    pitch?: { step: string; alter?: number; octave: number }
    rest?: { measure?: boolean }
    duration?: number
    type?: string
    divisions?: number
    time?: Array<{ beats: string; beatType: string }>
    key?: Array<{ fifths: number }>
    clef?: Array<{ sign: string; line?: number }>
    sound?: { tempo?: number }
    tie?: Array<{ type: 'start' | 'stop' }>
}

export interface AdminScoreDetail {
    id: string
    title: string
    userId: string
    owner: { id: string; name: string; email: string } | null
    storageKey: string | null
    createdAt: string
    updatedAt: string
    document: ScoreDocument | null
    documentError: string | null
    recordings: AdminScoreRecording[]
}

export interface AdminScoreRecording {
    id: string
    creditsSpent: number
    createdAt: string
    endedAt: string | null
    /** Audio was archived — playable via `recordingAudioUrl`. */
    hasAudio: boolean
}

/** Same-origin player source: the proxy checks the session, then either
 *  streams the audio or passes the API's redirect to the bucket through. */
export function recordingAudioUrl(recordingId: string): string {
    return `/api/admin/recordings/${encodeURIComponent(recordingId)}/audio`
}

export function getScore(id: string): Promise<AdminScoreDetail> {
    return api(`/api/admin/scores/${encodeURIComponent(id)}`)
}

// ── Tiers ────────────────────────────────────────────────────────────────────

export interface AdminTier {
    id: string
    name: string
    dailyRecordingCredits: number | null
    maxScores: number | null
    sortOrder: number
    sellable: boolean
    userCount: number
}

export function listTiers(): Promise<AdminTier[]> {
    return api('/api/admin/tiers')
}

// ── Beta waitlist ────────────────────────────────────────────────────────────

export interface BetaSignup {
    id: string
    name: string
    email: string
    status: 'pending' | 'approved'
    createdAt: string
}

export function listBetaSignups(): Promise<BetaSignup[]> {
    return api('/api/admin/beta/signups')
}

export function approveBetaSignup(userId: string): Promise<BetaSignup[]> {
    return api(`/api/admin/beta/signups/${encodeURIComponent(userId)}/approve`, { method: 'POST', body: '{}' })
}

export function revokeBetaSignup(userId: string): Promise<BetaSignup[]> {
    return api(`/api/admin/beta/signups/${encodeURIComponent(userId)}/revoke`, { method: 'POST', body: '{}' })
}
