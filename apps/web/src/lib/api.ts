import type { ScorePatch, StoredScoreDocument } from '@mushee/notation/model'
import type { ScorePartwise } from '@mushee/notation/model/io/MusicXml'
import { requestJson } from '@mushee/ui/http'

import { API_URL, API_WS_URL } from './env'
import type { StoredShortcuts } from './Keybindings'

export { ApiError, NetworkError } from '@mushee/ui/http'

/** A call to the Solkey API, with the session cookie (see @mushee/ui/http for the error model). */
export function api<T>(path: string, init?: RequestInit): Promise<T> {
    return requestJson<T>(`${API_URL}${path}`, { ...init, credentials: 'include' })
}

export interface ScoreMeta {
    id: string
    title: string
    createdAt: string
    updatedAt: string
    /** Secret of the read-only share link (`/s/<token>`); null or absent when not shared. */
    shareToken?: string | null
}

/**
 * What the editor and the data export work from: a score's metadata plus its stored document
 * (MusicXML-JSON, or the raw MusicXML text of a file the API could not read as JSON).
 */
export interface ScoreDocument {
    meta: ScoreMeta
    document: StoredScoreDocument
}

export function listScores(search?: string): Promise<ScoreMeta[]> {
    const params = search ? `?search=${encodeURIComponent(search)}` : ''
    return api(`/scores${params}`)
}

export function getScore(id: string): Promise<ScoreMeta> {
    return api(`/scores/${id}`)
}

export function loadScore(id: string): Promise<StoredScoreDocument> {
    return api(`/scores/${id}/load`)
}

export function createScore(title: string, score: ScorePartwise): Promise<ScoreMeta> {
    return api('/scores', {
        method: 'POST',
        body: JSON.stringify({ title, score }),
    })
}

export function updateScore(id: string, data: ScorePatch & { title?: string }): Promise<ScoreMeta> {
    return api(`/scores/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
    })
}

/** Copy a score into a new one ("Title (copy)"); counts against the plan's score cap like a create. */
export function duplicateScore(id: string): Promise<ScoreMeta> {
    return api(`/scores/${id}/duplicate`, { method: 'POST' })
}

export function deleteScore(id: string): Promise<void> {
    return api(`/scores/${id}`, { method: 'DELETE' })
}

// ── Read-only share links ───────────────────────────────────────────────────

/** Turn the share link on (idempotent): the token that makes `/s/<token>`. */
export function shareScore(id: string): Promise<{ token: string }> {
    return api(`/scores/${id}/share`, { method: 'POST' })
}

export function unshareScore(id: string): Promise<void> {
    return api(`/scores/${id}/share`, { method: 'DELETE' })
}

export interface SharedScore {
    id: string
    title: string
    updatedAt: string
    document: StoredScoreDocument
}

/** Public — no session needed; 404 for unknown or revoked tokens. */
export function getSharedScore(token: string): Promise<SharedScore> {
    return api(`/shared/${encodeURIComponent(token)}`)
}

// ── Recordings ──────────────────────────────────────────────────────────────

/** The transcription gateway's socket for a take; every recording belongs to a score, and the gateway requires its id up front. */
export function recordingSocketUrl(scoreId: string): string {
    return `${API_WS_URL}/recording?scoreId=${encodeURIComponent(scoreId)}`
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
    return api('/account/reactivate', { method: 'POST' })
}

/** What the account answered in onboarding, as the API stores it; every field may be unanswered. */
export interface OnboardingAnswers {
    /** Instrument display names, in the order picked (survey-only options like 'Other' included). */
    instruments?: string[] | null
}

/** The account's stored onboarding answers; null when it has none yet (the API answers an empty body). */
export async function getOnboarding(): Promise<OnboardingAnswers | null> {
    return (await api<OnboardingAnswers | null | undefined>('/onboarding')) ?? null
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

/** The tiers Polar sells. */
export type PaidTierId = 'pro' | 'studio' | 'arranger'
/** Every tier an account can be on; 'beta' is assigned during the closed beta, never sold. */
export type TierId = 'free' | PaidTierId | 'beta'
export type BillingInterval = 'monthly' | 'yearly'
/** The one-time recording-minute packs. */
export type PackId = 'single' | 'ep' | 'album'

export interface BillingState {
    tierId: TierId
    tierName: string
    /** Polar subscription status ('active', 'trialing', …); null on free/beta. */
    status: string | null
    /** Billing cadence of the active subscription; null on free/beta. */
    interval: BillingInterval | null
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
        /**
         * When the daily budget refills (ISO timestamp). The API always sends it; an older
         * API without it leaves the client on its fallback, the next midnight UTC.
         */
        resetsAt?: string
    }
}

export function getBillingState(): Promise<BillingState> {
    return api('/billing/subscription')
}

/** Returns the Polar-hosted checkout URL to redirect the browser to. */
export function createCheckout(tierId: PaidTierId, interval: BillingInterval): Promise<{ url: string }> {
    return api('/billing/checkout', {
        method: 'POST',
        body: JSON.stringify({ tierId, interval }),
    })
}

/** Checkout URL for a one-time minute pack (no subscription involved). */
export function createPackCheckout(packId: PackId): Promise<{ url: string }> {
    return api('/billing/checkout/pack', {
        method: 'POST',
        body: JSON.stringify({ packId }),
    })
}

/** Returns the Polar-hosted customer portal URL (invoices, payment method). */
export function createBillingPortalSession(): Promise<{ url: string }> {
    return api('/billing/portal', { method: 'POST' })
}

/** Switch tier/cadence on an existing subscription (prorated by Polar). */
export function changePlan(tierId: PaidTierId, interval: BillingInterval): Promise<BillingState> {
    return api('/billing/change', {
        method: 'POST',
        body: JSON.stringify({ tierId, interval }),
    })
}

export function cancelSubscription(): Promise<BillingState> {
    return api('/billing/cancel', { method: 'POST' })
}

export function resumeSubscription(): Promise<BillingState> {
    return api('/billing/resume', { method: 'POST' })
}

// ── Closed beta ─────────────────────────────────────────────────────────────

export interface BetaStatus {
    betaMode: boolean
    /** null = account predates the beta (never gated). */
    status: 'pending' | 'approved' | null
}

/** Fresh from the database — the waiting screen polls this to spot approval.
 *  Waitlist management lives in the standalone admin console (apps/admin). */
export function getBetaStatus(): Promise<BetaStatus> {
    return api('/beta/status')
}
