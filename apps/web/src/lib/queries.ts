'use client'

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
    approveBetaSignup,
    cancelSubscription,
    changePlan,
    createBillingPortalSession,
    createCheckout,
    createScore,
    deleteScore,
    getBetaStatus,
    getBillingState,
    getScore,
    listBetaSignups,
    listScores,
    loadScore,
    type OnboardingPatch,
    patchOnboarding,
    reactivateAccount,
    requestAccountDeletion,
    resumeSubscription,
    revokeBetaSignup,
    type ScoreMeta,
    updateScore,
} from './api'

export const scoreKeys = {
    all: ['scores'] as const,
    list: (search?: string) => ['scores', 'list', search ?? ''] as const,
    detail: (id: string) => ['scores', 'detail', id] as const,
}

export function useScores(search?: string) {
    return useQuery({
        queryKey: scoreKeys.list(search),
        queryFn: () => listScores(search),
        // While a new search resolves, keep showing the previous list instead of
        // flashing back to the loading state on every keystroke.
        placeholderData: keepPreviousData,
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
    })
}

export function useCreateScore() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: ({ title, score }: { title: string; score: Record<string, unknown> }) => createScore(title, score),
        onSuccess: () => void queryClient.invalidateQueries({ queryKey: scoreKeys.all }),
        meta: { errorMessage: 'Could not create the score. Please try again.' },
    })
}

export function useDeleteScore() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: (id: string) => deleteScore(id),
        onSuccess: (_data, id) => {
            // Drop the row from every cached list right away; the invalidation
            // then reconciles with the server in the background.
            queryClient.setQueriesData<ScoreMeta[]>({ queryKey: [...scoreKeys.all, 'list'] }, (rows) =>
                rows?.filter((row) => row.id !== id),
            )
            void queryClient.invalidateQueries({ queryKey: scoreKeys.all })
        },
        meta: { errorMessage: 'Could not delete the score. Please try again.' },
    })
}

export function useUpdateScore(id: string) {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: (data: Parameters<typeof updateScore>[1]) => updateScore(id, data),
        onSuccess: (meta: ScoreMeta) => {
            // Keep list rows (title, updatedAt) honest without refetching the document.
            queryClient.setQueriesData<ScoreMeta[]>({ queryKey: [...scoreKeys.all, 'list'] }, (rows) =>
                rows?.map((row) => (row.id === meta.id ? meta : row)),
            )
        },
        meta: { errorMessage: "Your latest changes couldn't be saved. We'll keep trying — check your connection." },
    })
}

export function usePatchOnboarding() {
    return useMutation({
        mutationFn: (patch: OnboardingPatch) => patchOnboarding(patch),
        meta: { errorMessage: "Couldn't save your onboarding answers. Please try again." },
    })
}

/** Soft-deletes the account (7-day grace period) after password re-auth. */
export function useRequestAccountDeletion() {
    return useMutation({
        mutationFn: (password: string) => requestAccountDeletion(password),
        // The dialog shows wrong-password feedback inline; a toast would double up.
        meta: { silentError: true },
    })
}

export function useReactivateAccount() {
    return useMutation({
        mutationFn: () => reactivateAccount(),
        meta: { errorMessage: "Couldn't reactivate your account. Please try again." },
    })
}

// ── Billing (Polar) ─────────────────────────────────────────────────────────

export const billingKeys = {
    subscription: ['billing', 'subscription'] as const,
}

export function useBillingState() {
    return useQuery({
        queryKey: billingKeys.subscription,
        queryFn: getBillingState,
    })
}

/** Creates a Polar checkout and sends the browser there. */
export function useStartCheckout() {
    return useMutation({
        mutationFn: (args: { tierId: 'pro' | 'studio'; interval: 'monthly' | 'yearly' }) =>
            createCheckout(args.tierId, args.interval),
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
        mutationFn: (args: { tierId: 'pro' | 'studio'; interval: 'monthly' | 'yearly' }) =>
            changePlan(args.tierId, args.interval),
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

export const betaKeys = {
    status: ['beta', 'status'] as const,
    signups: ['beta', 'signups'] as const,
}

/** Polls while the user waits for approval so the screen unlocks by itself. */
export function useBetaStatus(options?: { poll?: boolean; enabled?: boolean }) {
    return useQuery({
        queryKey: betaKeys.status,
        queryFn: getBetaStatus,
        enabled: options?.enabled ?? true,
        refetchInterval: options?.poll ? 30_000 : false,
    })
}

export function useBetaSignups() {
    return useQuery({
        queryKey: betaKeys.signups,
        queryFn: listBetaSignups,
    })
}

export function useApproveBetaSignup() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: (userId: string) => approveBetaSignup(userId),
        onSuccess: (signups) => queryClient.setQueryData(betaKeys.signups, signups),
        meta: { errorMessage: "Couldn't approve this signup. Please try again." },
    })
}

export function useRevokeBetaSignup() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: (userId: string) => revokeBetaSignup(userId),
        onSuccess: (signups) => queryClient.setQueryData(betaKeys.signups, signups),
        meta: { errorMessage: "Couldn't revoke this signup. Please try again." },
    })
}
