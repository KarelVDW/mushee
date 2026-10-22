'use client'

import type { ScorePartwise } from '@mushee/notation/model/io/MusicXml'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { useCallback, useMemo } from 'react'

import type { ExportProfile } from './AccountExport'
import {
    api,
    type BillingInterval,
    cancelSubscription,
    changePlan,
    createBillingPortalSession,
    createCheckout,
    createPackCheckout,
    createScore,
    deleteRecording,
    deleteScore,
    duplicateScore,
    getAccountDeletionStatus,
    getBetaStatus,
    getBillingState,
    getScore,
    getSettings,
    getSharedScore,
    listPlans,
    listRecordings,
    listScores,
    loadScore,
    NetworkError,
    type OnboardingPatch,
    type PackId,
    type PaidTierId,
    patchOnboarding,
    putKeyboardShortcuts,
    reactivateAccount,
    type RecordingSummary,
    requestAccountDeletion,
    resumeSubscription,
    type ScoreDocument,
    type ScoreMeta,
    shareScore,
    unshareScore,
    updateScore,
} from './api'
import { signOut, updateUser } from './auth-client'
import type { StoredShortcuts } from './Keybindings'
import { PlanCatalogue } from './plans'

// Mutation `meta` ({ errorMessage, silentError }) is typed by @mushee/ui's
// createQueryClient, whose MutationCache turns a failure into a toast.

const scoreKeys = {
    all: ['scores'] as const,
    lists: ['scores', 'list'] as const,
    list: (search?: string) => [...scoreKeys.lists, search ?? ''] as const,
    detail: (id: string) => ['scores', 'detail', id] as const,
}

/** How often a list that couldn't reach the server tries again by itself. */
const UNREACHABLE_RETRY_MS = 10_000

export function useScores(search?: string) {
    return useQuery({
        queryKey: scoreKeys.list(search),
        queryFn: () => listScores(search),
        // While a new search resolves, keep showing the previous list instead of
        // flashing back to the loading state on every keystroke.
        placeholderData: keepPreviousData,
        // Unreachable (offline, server down): keep trying every few seconds, so the
        // library comes back by itself once the connection does.
        refetchInterval: (query) => (query.state.error instanceof NetworkError ? UNREACHABLE_RETRY_MS : false),
    })
}

/** Metadata and the serialized document, fetched together — the editor needs both. */
export function useScoreDocument(id: string) {
    return useQuery({
        queryKey: scoreKeys.detail(id),
        queryFn: async () => {
            const [meta, document] = await Promise.all([getScore(id), loadScore(id)])
            return { meta, document }
        },
        // The editor owns the document after load (local mutations + auto-save);
        // a background refetch would clobber unsaved in-memory state.
        staleTime: Infinity,
        refetchOnWindowFocus: false,
        // Drop the cached document as soon as the editor unmounts: saves PATCH
        // dirty deltas (no full document comes back), so a cached entry can only
        // go stale — reopening must always load fresh from the server.
        gcTime: 0,
    })
}

export function useCreateScore() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: ({ title, score }: { title: string; score: ScorePartwise }) => createScore(title, score),
        onSuccess: () => void queryClient.invalidateQueries({ queryKey: scoreKeys.all }),
        // Callers render errors themselves: a score-limit refusal opens the
        // upgrade dialog; anything else gets its own toast.
        meta: { silentError: true },
    })
}

export function useDuplicateScore() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: (id: string) => duplicateScore(id),
        onSuccess: () => void queryClient.invalidateQueries({ queryKey: scoreKeys.all }),
        // Like create: the caller opens the upgrade dialog on a score-limit
        // refusal and toasts anything else itself.
        meta: { silentError: true },
    })
}

/** Renames a score from the library; the new title shows on its row (and an open editor) at once. */
export function useRenameScore() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: ({ id, title }: { id: string; title: string }) => updateScore(id, { title }),
        onSuccess: (meta: ScoreMeta) => {
            queryClient.setQueriesData<ScoreMeta[]>({ queryKey: scoreKeys.lists }, (rows) =>
                rows?.map((row) => (row.id === meta.id ? meta : row)),
            )
            queryClient.setQueryData<ScoreDocument>(scoreKeys.detail(meta.id), (data) => (data ? { ...data, meta } : data))
        },
        meta: { errorMessage: "Couldn't rename the score. Please try again." },
    })
}

export function useDeleteScore() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: (id: string) => deleteScore(id),
        onSuccess: (_data, id) => {
            // Drop the row from every cached list right away; the invalidation
            // then reconciles with the server in the background.
            queryClient.setQueriesData<ScoreMeta[]>({ queryKey: scoreKeys.lists }, (rows) => rows?.filter((row) => row.id !== id))
            void queryClient.invalidateQueries({ queryKey: scoreKeys.all })
        },
        meta: { errorMessage: 'Could not delete the score. Please try again.' },
    })
}

const sharedKeys = {
    detail: (token: string) => ['shared', token] as const,
}

/** A score behind its share token — public, cached for the visit. */
export function useSharedScore(token: string) {
    return useQuery({
        queryKey: sharedKeys.detail(token),
        queryFn: () => getSharedScore(token),
        staleTime: Infinity,
        refetchOnWindowFocus: false,
    })
}

/** Mint/keep the score's share link and reflect it on the cached score meta. */
export function useShareScore(id: string) {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: () => shareScore(id),
        onSuccess: ({ token }) => {
            queryClient.setQueryData<ScoreDocument>(scoreKeys.detail(id), (data) =>
                data ? { ...data, meta: { ...data.meta, shareToken: token } } : data,
            )
        },
        meta: { errorMessage: 'Could not create the share link. Please try again.' },
    })
}

export function useUnshareScore(id: string) {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: () => unshareScore(id),
        onSuccess: () => {
            queryClient.setQueryData<ScoreDocument>(scoreKeys.detail(id), (data) =>
                data ? { ...data, meta: { ...data.meta, shareToken: null } } : data,
            )
        },
        meta: { errorMessage: 'Could not turn the share link off. Please try again.' },
    })
}

const recordingKeys = {
    all: ['recordings'] as const,
    lists: ['recordings', 'list'] as const,
    list: (scoreId?: string) => [...recordingKeys.lists, scoreId ?? ''] as const,
}

/** Every take the account holds, newest first (Settings → Your data). */
export function useAllRecordings(options?: { enabled?: boolean }) {
    return useQuery({
        queryKey: recordingKeys.list(),
        queryFn: () => listRecordings(),
        enabled: options?.enabled ?? true,
    })
}

/** The takes recorded into one score, newest first. */
export function useRecordings(scoreId: string) {
    return useQuery({
        queryKey: recordingKeys.list(scoreId),
        queryFn: () => listRecordings(scoreId),
    })
}

export function useDeleteRecording() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: (id: string) => deleteRecording(id),
        onSuccess: (_data, id) => {
            // The server answers nothing new, so the patched lists are already right — no refetch.
            queryClient.setQueriesData<RecordingSummary[]>({ queryKey: recordingKeys.lists }, (rows) =>
                rows?.filter((row) => row.id !== id),
            )
        },
        meta: { errorMessage: 'Could not delete the take. Please try again.' },
    })
}

export function useUpdateScore(id: string) {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: (data: Parameters<typeof updateScore>[1]) => updateScore(id, data),
        onSuccess: (meta: ScoreMeta) => {
            // Keep list rows (title, updatedAt) honest without refetching the document.
            queryClient.setQueriesData<ScoreMeta[]>({ queryKey: scoreKeys.lists }, (rows) =>
                rows?.map((row) => (row.id === meta.id ? meta : row)),
            )
        },
        meta: { errorMessage: "Your latest changes couldn't be saved. We'll keep trying — check your connection." },
    })
}

const onboardingKeys = {
    answers: ['onboarding'] as const,
}

/** What the account answered in onboarding, as the API stores it; every field may be unanswered. */
export interface OnboardingAnswers {
    /** Instrument display names, in the order picked (survey-only options like 'Other' included). */
    instruments?: string[] | null
}

/**
 * The account's onboarding answers (GET /onboarding) — the library starts a new score on the
 * first instrument picked there. Null when the account has none yet.
 */
export function useOnboarding() {
    return useQuery({
        queryKey: onboardingKeys.answers,
        // The API answers an empty body when nothing is stored yet; the cache needs a value.
        queryFn: async () => (await api<OnboardingAnswers | null | undefined>('/onboarding')) ?? null,
        // The answers change only when onboarding saves them, which refreshes this query.
        staleTime: Infinity,
    })
}

export function usePatchOnboarding() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: (patch: OnboardingPatch) => patchOnboarding(patch),
        onSuccess: () => void queryClient.invalidateQueries({ queryKey: onboardingKeys.answers }),
        meta: { errorMessage: "Couldn't save your onboarding answers. Please try again." },
    })
}

const settingsKeys = {
    all: ['settings'] as const,
}

export function useSettings() {
    return useQuery({
        queryKey: settingsKeys.all,
        queryFn: () => getSettings(),
    })
}

export function useSaveKeyboardShortcuts() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: (keyboardShortcuts: StoredShortcuts | null) => putKeyboardShortcuts(keyboardShortcuts),
        onSuccess: (settings) => queryClient.setQueryData(settingsKeys.all, settings),
        meta: { errorMessage: "Couldn't sync your keyboard shortcuts. They still apply on this device." },
    })
}

/**
 * Asks whether the signed-in account is soft-deleted (the sign-in flow's check). A plain
 * request, deliberately kept out of the query cache: a cached answer could belong to the
 * previous sign-in or account in this tab, and when one account signs in over another,
 * SessionCacheScope clears the cache mid-check — which cancels an in-flight cached fetch,
 * and the caller would read that as "not pending". Never retried either: a backoff would
 * hold sign-in up — the caller treats a failure as "not pending" and carries on.
 */
export function useCheckPendingDeletion() {
    return getAccountDeletionStatus
}

/** Soft-deletes the account (7-day grace period) after password re-auth. */
export function useRequestAccountDeletion() {
    return useMutation({
        mutationFn: (password: string) => requestAccountDeletion(password),
        // The dialog shows wrong-password feedback inline; a toast would double up.
        meta: { silentError: true },
    })
}

/** Builds the GDPR "download my data" archive (every score, profile and settings) in the browser. */
export function useExportAccountData() {
    return useMutation({
        // Loaded on demand: the exporter pulls in the score model and MusicXML writer, and
        // this module reaches every route through AuthGate's useBetaGate.
        mutationFn: async (profile: ExportProfile) => (await import('./AccountExport')).AccountExport.collect(profile),
        meta: { errorMessage: "Your data couldn't be exported. Please try again." },
    })
}

/** Saves the account's display name — the one signup asks for and Settings edits. */
export function useUpdateProfile() {
    return useMutation({
        mutationFn: async (name: string) => {
            const { error } = await updateUser({ name })
            if (error) throw new Error(error.message ?? 'Update failed')
        },
        meta: { errorMessage: "Your profile couldn't be saved. Please try again." },
    })
}

/**
 * Signs out, then leaves for `destination`. The signed-out user's cached queries go
 * with the session (SessionCacheScope in app/providers.tsx), not here.
 */
export function useSignOut() {
    const router = useRouter()
    return useCallback(
        async (destination: string) => {
            await signOut()
            router.push(destination)
        },
        [router],
    )
}

export function useReactivateAccount() {
    return useMutation({
        mutationFn: () => reactivateAccount(),
        meta: { errorMessage: "Couldn't reactivate your account. Please try again." },
    })
}

// ── Plans (database-driven tier catalogue) ──────────────────────────────────

const planKeys = {
    all: ['plans'] as const,
}

/** The tier catalogue as the database knows it (GET /plans). */
function usePlans() {
    return useQuery({
        queryKey: planKeys.all,
        queryFn: listPlans,
        // The catalogue changes on the order of releases, not clicks.
        staleTime: 5 * 60 * 1000,
    })
}

/**
 * The database catalogue merged with the static display decoration in
 * lib/plans.ts: entitlements — names, recording budgets, score caps — come
 * from the database; icons, taglines and prices from the static entries,
 * which also stand in while the query loads.
 */
export function usePlanCatalogue(): PlanCatalogue {
    const { data } = usePlans()
    return useMemo(() => new PlanCatalogue(data), [data])
}

// ── Billing (Polar) ─────────────────────────────────────────────────────────

const billingKeys = {
    subscription: ['billing', 'subscription'] as const,
}

export function useBillingState() {
    return useQuery({
        queryKey: billingKeys.subscription,
        queryFn: getBillingState,
    })
}

/**
 * Refetches the subscription state, for a change that lands server-side rather than
 * through one of the billing mutations below (a pack's minutes arriving via the Polar
 * webhook after checkout).
 */
export function useRefreshBillingState() {
    const queryClient = useQueryClient()
    return useCallback(() => queryClient.invalidateQueries({ queryKey: billingKeys.subscription }), [queryClient])
}

/** Creates a Polar checkout and sends the browser there. */
export function useStartCheckout() {
    return useMutation({
        mutationFn: (args: { tierId: PaidTierId; interval: BillingInterval }) => createCheckout(args.tierId, args.interval),
        onSuccess: ({ url }) => {
            window.location.assign(url)
        },
        meta: { errorMessage: "Couldn't start the checkout. Please try again." },
    })
}

/** Checkout for a one-time minute pack; redirects to Polar like a plan checkout. */
export function useStartPackCheckout() {
    return useMutation({
        mutationFn: (packId: PackId) => createPackCheckout(packId),
        onSuccess: ({ url }) => {
            window.location.assign(url)
        },
        meta: { errorMessage: "Couldn't start the checkout. Please try again." },
    })
}

/** Opens the Polar customer portal (invoices, payment method, cancellation). */
export function useBillingPortal() {
    return useMutation({
        mutationFn: () => createBillingPortalSession(),
        onSuccess: ({ url }) => {
            window.location.assign(url)
        },
        meta: { errorMessage: "Couldn't open the billing portal. Please try again." },
    })
}

/** Tier/cadence switch for users who already have a subscription. */
export function useChangePlan() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: (args: { tierId: PaidTierId; interval: BillingInterval }) => changePlan(args.tierId, args.interval),
        onSuccess: (state) => queryClient.setQueryData(billingKeys.subscription, state),
        meta: { errorMessage: "Couldn't change the plan. Please try again." },
    })
}

export function useCancelSubscription() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: () => cancelSubscription(),
        onSuccess: (state) => queryClient.setQueryData(billingKeys.subscription, state),
        meta: { errorMessage: "Couldn't cancel the subscription. Please try again." },
    })
}

export function useResumeSubscription() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: () => resumeSubscription(),
        onSuccess: (state) => queryClient.setQueryData(billingKeys.subscription, state),
        meta: { errorMessage: "Couldn't resume the subscription. Please try again." },
    })
}

// ── Closed beta ─────────────────────────────────────────────────────────────

const betaKeys = {
    status: ['beta', 'status'] as const,
}

/**
 * Whether the signed-in user is still waiting for closed-beta approval, by the
 * API's own rule (BetaService.isAwaitingApproval): the server is in beta mode
 * and the account is pending. Only the server's runtime flag counts — the
 * build-time BETA_MODE can drift from it, and gating on either flag sent users
 * back and forth between /beta and the app. BETA_MODE stays for copy and plan
 * visibility.
 *
 * `poll` refetches while the user waits so the screen unlocks by itself.
 * Waitlist management lives in the standalone admin console (apps/admin).
 */
export function useBetaGate(options?: { poll?: boolean; enabled?: boolean }) {
    const { data, isFetching, refetch } = useQuery({
        queryKey: betaKeys.status,
        queryFn: getBetaStatus,
        enabled: options?.enabled ?? true,
        refetchInterval: options?.poll ? 30_000 : false,
    })
    return {
        awaitingApproval: data?.betaMode === true && data.status === 'pending',
        /** The server has answered at least once; until then neither verdict is known. */
        isResolved: data !== undefined,
        isFetching,
        refetch,
    }
}
