/** Typed queries over the `eval` schema. */

import type { GeneratedClip, GeneratorParams } from '@/lib/generator'
import type { ClipMelody } from '@/lib/melody'

import { query } from './db'

export interface Corpus {
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

export interface Clip {
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

export interface Transcription {
    id: number
    clipId: string
    createdAt: string
    notes: Array<{ onsetSec: number; durSec: number; midi: number }>
    measures: Record<number, unknown> | null
    metrics: Record<string, unknown> | null
    config: Record<string, unknown> | null
}

const CORPUS_SELECT = `
    SELECT c.id, c.label, c.kind, c.instrument_id AS "instrumentId", c.tier, c.bpm,
           c.beats_per_measure AS "beatsPerMeasure", c.params, c.notes, c.created_at AS "createdAt",
           count(cl.id)::int AS "clipCount",
           count(cl.id) FILTER (WHERE cl.status = 'recorded')::int AS "recordedCount"
    FROM eval.corpus c
    LEFT JOIN eval.clip cl ON cl.corpus_id = c.id
`

export async function listCorpora(): Promise<Corpus[]> {
    return query<Corpus & Record<string, unknown>>(`${CORPUS_SELECT} GROUP BY c.id ORDER BY c.created_at DESC`)
}

export async function getCorpus(id: string): Promise<Corpus | null> {
    const rows = await query<Corpus & Record<string, unknown>>(`${CORPUS_SELECT} WHERE c.id = $1 GROUP BY c.id`, [id])
    return rows[0] ?? null
}

export async function createCorpus(
    corpus: {
        id: string
        label: string
        kind: string
        instrumentId: string | null
        tier: string
        bpm: number
        beatsPerMeasure: number
        params: GeneratorParams
        notes: string | null
    },
    clips: GeneratedClip[],
): Promise<void> {
    await query(
        `INSERT INTO eval.corpus (id, label, kind, instrument_id, tier, bpm, beats_per_measure, params, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
            corpus.id,
            corpus.label,
            corpus.kind,
            corpus.instrumentId,
            corpus.tier,
            corpus.bpm,
            corpus.beatsPerMeasure,
            JSON.stringify(corpus.params),
            corpus.notes,
        ],
    )
    for (let i = 0; i < clips.length; i++) {
        const clip = clips[i]
        await query(`INSERT INTO eval.clip (corpus_id, name, seed, sort_order, melody) VALUES ($1, $2, $3, $4, $5)`, [
            corpus.id,
            clip.name,
            clip.seed,
            i,
            JSON.stringify(clip.melody),
        ])
    }
}

export async function deleteCorpus(id: string): Promise<void> {
    await query('DELETE FROM eval.corpus WHERE id = $1', [id])
}

const CLIP_SELECT = `
    SELECT id, corpus_id AS "corpusId", name, seed, sort_order AS "sortOrder", melody, status,
           duration_sec AS "durationSec", recorded_at AS "recordedAt"
    FROM eval.clip
`

export async function listClips(corpusId: string): Promise<Clip[]> {
    return query<Clip & Record<string, unknown>>(`${CLIP_SELECT} WHERE corpus_id = $1 ORDER BY sort_order`, [corpusId])
}

export async function getClip(id: string): Promise<Clip | null> {
    const rows = await query<Clip & Record<string, unknown>>(`${CLIP_SELECT} WHERE id = $1`, [id])
    return rows[0] ?? null
}

export async function markClipRecorded(id: string, durationSec: number): Promise<void> {
    await query(`UPDATE eval.clip SET status = 'recorded', duration_sec = $2, recorded_at = now() WHERE id = $1`, [id, durationSec])
}

export async function insertTranscription(
    clipId: string,
    data: { notes: unknown; measures: unknown; metrics: unknown; config: unknown },
): Promise<void> {
    await query(`INSERT INTO eval.transcription (clip_id, notes, measures, metrics, config) VALUES ($1, $2, $3, $4, $5)`, [
        clipId,
        JSON.stringify(data.notes),
        data.measures == null ? null : JSON.stringify(data.measures),
        data.metrics == null ? null : JSON.stringify(data.metrics),
        data.config == null ? null : JSON.stringify(data.config),
    ])
}

export async function latestTranscription(clipId: string): Promise<Transcription | null> {
    const rows = await query<Transcription & Record<string, unknown>>(
        `SELECT id, clip_id AS "clipId", created_at AS "createdAt", notes, measures, metrics, config
         FROM eval.transcription WHERE clip_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1`,
        [clipId],
    )
    return rows[0] ?? null
}

/** Latest per-clip metrics for a corpus, for the clip-list table. */
export async function latestMetricsByClip(corpusId: string): Promise<Record<string, Record<string, unknown>>> {
    const rows = await query<{ clipId: string; metrics: Record<string, unknown> | null }>(
        `SELECT DISTINCT ON (t.clip_id) t.clip_id AS "clipId", t.metrics
         FROM eval.transcription t
         JOIN eval.clip c ON c.id = t.clip_id
         WHERE c.corpus_id = $1
         ORDER BY t.clip_id, t.created_at DESC, t.id DESC`,
        [corpusId],
    )
    const out: Record<string, Record<string, unknown>> = {}
    for (const row of rows) if (row.metrics) out[row.clipId] = row.metrics
    return out
}

export interface Run {
    id: number
    createdAt: string
    label: string
    scope: string | null
    reportPath: string | null
    summary: Record<string, unknown>
}

export async function insertRun(run: { label: string; scope: string | null; reportPath: string | null; summary: unknown }): Promise<void> {
    await query(`INSERT INTO eval.run (label, scope, report_path, summary) VALUES ($1, $2, $3, $4)`, [
        run.label,
        run.scope,
        run.reportPath,
        JSON.stringify(run.summary),
    ])
}

export async function listRuns(limit = 50): Promise<Run[]> {
    return query<Run & Record<string, unknown>>(
        `SELECT id, created_at AS "createdAt", label, scope, report_path AS "reportPath", summary
         FROM eval.run ORDER BY created_at DESC LIMIT $1`,
        [limit],
    )
}
