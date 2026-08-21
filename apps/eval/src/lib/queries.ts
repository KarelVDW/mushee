'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { api } from './api'
import type { GeneratorParams } from './generator'

export function useCorpora() {
    return useQuery({ queryKey: ['corpora'], queryFn: api.listCorpora })
}

export function useCorpus(id: string) {
    return useQuery({ queryKey: ['corpus', id], queryFn: () => api.getCorpus(id) })
}

export function useClip(id: string) {
    return useQuery({ queryKey: ['clip', id], queryFn: () => api.getClip(id) })
}

export function useCreateCorpus() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: (body: { label: string; kind: string; instrumentId?: string; tier: string; notes?: string; params: GeneratorParams }) =>
            api.createCorpus(body),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['corpora'] }),
    })
}

export function useDeleteCorpus() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: (id: string) => api.deleteCorpus(id),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['corpora'] }),
    })
}

export function useUploadTake() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: ({ clipId, take, trimSec }: { clipId: string; take: Blob; trimSec: number }) =>
            api.uploadTake(clipId, take, trimSec),
        onSuccess: (_result, { clipId }) => {
            void queryClient.invalidateQueries({ queryKey: ['clip', clipId] })
            void queryClient.invalidateQueries({ queryKey: ['corpus'] })
            void queryClient.invalidateQueries({ queryKey: ['corpora'] })
        },
    })
}

export function useTranscribe() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: (clipId: string) => api.transcribe(clipId),
        onSuccess: (_result, clipId) => {
            void queryClient.invalidateQueries({ queryKey: ['clip', clipId] })
            void queryClient.invalidateQueries({ queryKey: ['corpus'] })
        },
    })
}

export function useReports() {
    return useQuery({ queryKey: ['reports'], queryFn: api.listReports })
}

export function useReportDetail(ref: { root: string; file: string } | null) {
    return useQuery({
        queryKey: ['report', ref?.root, ref?.file],
        queryFn: () => api.reportDetail(ref!.root, ref!.file),
        enabled: ref !== null,
        staleTime: 60_000,
    })
}

export function useRuns() {
    return useQuery({ queryKey: ['runs'], queryFn: api.listRuns })
}

export function useStartRun() {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: (corpusId?: string) => api.startRun(corpusId),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: ['runs'] })
            void queryClient.invalidateQueries({ queryKey: ['reports'] })
        },
    })
}
