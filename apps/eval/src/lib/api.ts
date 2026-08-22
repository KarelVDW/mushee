/** Typed client for this app's own API routes. */

import type { GeneratorParams } from './generator'
import type { ClipMelody } from './melody'

export interface CorpusDto {
    id: string
    label: string
    kind: 'voice' | 'whistle' | 'instrument'
    instrumentId: string | null
    tier: 'benchmark' | 'context'
    bpm: number
    beatsPerMeasure: number
    params: GeneratorParams
    notes: string | null
    createdAt: string
    clipCount: number
    recordedCount: number
}

export interface ClipDto {
    id: string
    corpusId: string
    name: string
    seed: number
    sortOrder: number
    melody: ClipMelody
    status: 'pending' | 'recorded'
    durationSec: number | null
    recordedAt: string | null
}

export interface EstNoteDto {
    onsetSec: number
    durSec: number
    midi: number
}

export interface TranscriptionDto {
    id: number
    clipId: string
    createdAt: string
    notes: EstNoteDto[]
    measures: Record<number, unknown> | null
    metrics: Record<string, unknown> | null
    config: Record<string, unknown> | null
}

export interface CorpusDetailDto {
    corpus: CorpusDto
    clips: ClipDto[]
    metricsByClip: Record<string, Record<string, unknown>>
}

export interface ClipDetailDto {
    clip: ClipDto
    corpus: CorpusDto
    transcription: TranscriptionDto | null
    prevClipId: string | null
    nextClipId: string | null
    clipIndex: number
    clipTotal: number
}

export interface ReportListingDto {
    root: string
    file: string
    label: string
    mode: string
    provider: string
    overallF1: number
    scenarios: number
    modifiedAt: string
}

export interface ReportScenarioDto {
    scenario: string
    label: string
    clips: number
    pooled: boolean
    f1: number
    chromaF1: number
    precision: number
    recall: number
    octaveErrorRate: number
    onsetF1: number
    onsetRecall: number
}

export interface ReportDto {
    label: string
    mode: string
    provider: string
    overallF1: number
    perScenario: ReportScenarioDto[]
    perCondition: Array<{ condition: string; label: string; clips: number; f1: number; precision: number; recall: number }>
}

export interface RunDto {
    id: number
    createdAt: string
    label: string
    scope: string | null
    reportPath: string | null
    summary: {
        overallF1: number
        mode: string
        perScenario: Array<{ scenario: string; f1: number; onsetF1: number; clips: number; pooled: boolean }>
    }
}

export class ApiError extends Error {
    constructor(
        message: string,
        readonly status: number,
    ) {
        super(message)
    }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(path, init)
    if (!response.ok) {
        let message = `${response.status} ${response.statusText}`
        try {
            const body = (await response.json()) as { error?: string }
            if (body.error) message = body.error
        } catch {
            /* non-JSON error body */
        }
        throw new ApiError(message, response.status)
    }
    return (await response.json()) as T
}

export const api = {
    listCorpora: () => request<CorpusDto[]>('/api/corpora'),
    createCorpus: (body: {
        label: string
        kind: string
        instrumentId?: string
        tier: string
        notes?: string
        params: GeneratorParams
    }) => request<{ id: string }>('/api/corpora', { method: 'POST', body: JSON.stringify(body) }),
    getCorpus: (id: string) => request<CorpusDetailDto>(`/api/corpora/${encodeURIComponent(id)}`),
    deleteCorpus: (id: string) => request<{ ok: true }>(`/api/corpora/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    getClip: (id: string) => request<ClipDetailDto>(`/api/clips/${encodeURIComponent(id)}`),
    uploadTake: (clipId: string, take: Blob, trimSec: number) =>
        request<{ ok: true; durationSec: number }>(`/api/clips/${encodeURIComponent(clipId)}/audio`, {
            method: 'POST',
            body: take,
            headers: { 'Content-Type': take.type || 'application/octet-stream', 'x-trim-seconds': String(trimSec) },
        }),
    transcribe: (clipId: string) =>
        request<{ transcription: TranscriptionDto }>(`/api/clips/${encodeURIComponent(clipId)}/transcribe`, { method: 'POST' }),
    listReports: () => request<ReportListingDto[]>('/api/reports'),
    reportDetail: (root: string, file: string) =>
        request<ReportDto>(`/api/reports/detail?root=${encodeURIComponent(root)}&file=${encodeURIComponent(file)}`),
    listRuns: () => request<RunDto[]>('/api/runs'),
    startRun: (corpusId?: string) =>
        request<{ run: RunDto; reportFile: string }>('/api/runs', {
            method: 'POST',
            body: JSON.stringify(corpusId ? { corpusId } : {}),
        }),
}

export function clipAudioUrl(clipId: string): string {
    return `/api/clips/${encodeURIComponent(clipId)}/audio`
}
