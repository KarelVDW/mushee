'use client'

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
    adjustCredits,
    approveBetaSignup,
    getScore,
    getStats,
    getUser,
    listBetaSignups,
    listTiers,
    listUsers,
    listUserScores,
    revokeBetaSignup,
    revokeSessions,
} from './api'

export const adminKeys = {
    stats: ['stats'] as const,
    users: (search: string, page: number) => ['users', search, page] as const,
    user: (id: string) => ['user', id] as const,
    userScores: (id: string) => ['user', id, 'scores'] as const,
    score: (id: string) => ['score', id] as const,
    tiers: ['tiers'] as const,
    signups: ['signups'] as const,
}

export function useStats() {
    return useQuery({ queryKey: adminKeys.stats, queryFn: getStats })
}

export function useUsers(search: string, page: number) {
    return useQuery({
        queryKey: adminKeys.users(search, page),
        queryFn: () => listUsers({ search: search || undefined, page }),
        placeholderData: keepPreviousData,
    })
}

export function useUser(id: string) {
    return useQuery({ queryKey: adminKeys.user(id), queryFn: () => getUser(id) })
}

export function useUserScores(id: string) {
    return useQuery({ queryKey: adminKeys.userScores(id), queryFn: () => listUserScores(id) })
}

export function useScore(id: string) {
    return useQuery({ queryKey: adminKeys.score(id), queryFn: () => getScore(id) })
}

export function useTiers() {
    return useQuery({ queryKey: adminKeys.tiers, queryFn: listTiers })
}

export function useBetaSignups() {
    return useQuery({ queryKey: adminKeys.signups, queryFn: listBetaSignups })
}

export function useApproveBetaSignup() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: approveBetaSignup,
        onSuccess: (signups) => queryClient.setQueryData(adminKeys.signups, signups),
        meta: { errorMessage: "Couldn't approve the signup. Please try again." },
    })
}

export function useRevokeBetaSignup() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: revokeBetaSignup,
        onSuccess: (signups) => queryClient.setQueryData(adminKeys.signups, signups),
        meta: { errorMessage: "Couldn't revoke the signup. Please try again." },
    })
}

export function useAdjustCredits(userId: string) {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: (seconds: number) => adjustCredits(userId, seconds),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: adminKeys.user(userId) }),
        meta: { errorMessage: "Couldn't adjust the minutes. Please try again." },
    })
}

export function useRevokeSessions(userId: string) {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: () => revokeSessions(userId),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: adminKeys.user(userId) }),
        meta: { errorMessage: "Couldn't revoke the sessions. Please try again." },
    })
}
