'use client'

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
    createScore,
    deleteScore,
    getScore,
    listScores,
    loadScore,
    type OnboardingPatch,
    patchOnboarding,
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
