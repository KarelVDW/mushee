'use client'

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
    adjustCredits,
    approveBetaSignup,
    type AudienceFilter,
    getAudience,
    getScore,
    getStats,
    getUser,
    listAnnouncements,
    listBetaSignups,
    listTiers,
    listUsers,
    listUserScores,
    previewAnnouncement,
    revokeBetaSignup,
    revokeSessions,
    revokeShare,
    sendAnnouncement,
} from './api'

export const adminKeys = {
    stats: ['stats'] as const,
    users: (search: string, page: number) => ['users', search, page] as const,
    user: (id: string) => ['user', id] as const,
    userScores: (id: string) => ['user', id, 'scores'] as const,
    score: (id: string) => ['score', id] as const,
    tiers: ['tiers'] as const,
    signups: ['signups'] as const,
    audience: (filters: AudienceFilter) => ['audience', filters] as const,
    announcements: ['announcements'] as const,
    announcementPreview: (subject: string, body: string) => ['announcement-preview', subject, body] as const,
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

export function useRevokeShare(scoreId: string) {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: () => revokeShare(scoreId),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: adminKeys.score(scoreId) }),
        meta: { errorMessage: "Couldn't turn the share link off. Please try again." },
    })
}

/** Who a filter reaches — refetched as the filter changes, kept while the next answer loads. */
export function useAudience(filters: AudienceFilter) {
    return useQuery({ queryKey: adminKeys.audience(filters), queryFn: () => getAudience(filters), placeholderData: (previous) => previous })
}

export function useAnnouncements() {
    return useQuery({ queryKey: adminKeys.announcements, queryFn: listAnnouncements })
}

export function useSendAnnouncement() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: sendAnnouncement,
        onSuccess: () => queryClient.invalidateQueries({ queryKey: adminKeys.announcements }),
        meta: { errorMessage: "The announcement couldn't be sent. Nothing was recorded — check the API log and try again." },
    })
}

/** Rendered preview of a draft; the caller debounces the inputs. Empty drafts render nothing. */
export function useAnnouncementPreview(subject: string, body: string) {
    return useQuery({
        queryKey: adminKeys.announcementPreview(subject, body),
        queryFn: () => previewAnnouncement({ subject, body }),
        enabled: subject.trim().length > 0 && body.trim().length > 0,
        placeholderData: (previous) => previous,
        staleTime: Infinity,
    })
}
