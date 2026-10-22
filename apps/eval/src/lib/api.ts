/** Typed client for this app's own API routes. */

import { ApiError, NetworkError, requestJson } from '@mushee/ui/http'

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

/**
 * An error as display text, the same on both sides of the wire: routes return
 * it as `{ error }`, pages render it. String(err) would prefix a generic
 * 'Error: ' on each side and double it; a specific name (NotAllowedError,
 * TypeError) is kept because it is part of the diagnosis. The shared fetch
 * core's errors read as what they carry: an ApiError is the route's own text,
 * a NetworkError wraps what fetch threw.
 */
export function errorText(err: unknown): string {
    if (err instanceof ApiError) return err.message
    if (err instanceof NetworkError) return errorText(err.cause)
    if (!(err instanceof Error)) return String(err)
    return err.name && err.name !== 'Error' ? `${err.name}: ${err.message}` : err.message
}

export const api = {
    listCorpora: () => requestJson<CorpusDto[]>('/api/corpora'),
    createCorpus: (body: { label: string; kind: string; instrumentId?: string; tier: string; notes?: string; params: GeneratorParams }) =>
        requestJson<{ id: string }>('/api/corpora', { method: 'POST', body: JSON.stringify(body) }),
    getCorpus: (id: string) => requestJson<CorpusDetailDto>(`/api/corpora/${encodeURIComponent(id)}`),
    deleteCorpus: (id: string) => requestJson<{ ok: true }>(`/api/corpora/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    getClip: (id: string) => requestJson<ClipDetailDto>(`/api/clips/${encodeURIComponent(id)}`),
    uploadTake: (clipId: string, take: Blob, trimSec: number) =>
        requestJson<{ ok: true; durationSec: number }>(`/api/clips/${encodeURIComponent(clipId)}/audio`, {
            method: 'POST',
            body: take,
            headers: { 'Content-Type': take.type || 'application/octet-stream', 'x-trim-seconds': String(trimSec) },
        }),
    transcribe: (clipId: string) =>
        requestJson<{ transcription: TranscriptionDto }>(`/api/clips/${encodeURIComponent(clipId)}/transcribe`, { method: 'POST' }),
    listReports: () => requestJson<ReportListingDto[]>('/api/reports'),
    reportDetail: (root: string, file: string) =>
        requestJson<ReportDto>(`/api/reports/detail?root=${encodeURIComponent(root)}&file=${encodeURIComponent(file)}`),
    listRuns: () => requestJson<RunDto[]>('/api/runs'),
    startRun: (corpusId?: string) =>
        requestJson<{ run: RunDto; reportFile: string }>('/api/runs', {
            method: 'POST',
            body: JSON.stringify(corpusId ? { corpusId } : {}),
        }),
}

export function clipAudioUrl(clipId: string): string {
    return `/api/clips/${encodeURIComponent(clipId)}/audio`
}
