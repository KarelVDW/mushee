import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm'

/**
 * The authoritative copy of a score's unsaved edits (the full JSON document in
 * `data`), not a disposable cache. The flush cron writes idle rows to storage
 * (JSON, see ScoresService's storage-format note) and only then deletes them.
 */
@Entity('cached_scores')
@Index('IDX_cached_scores_updatedAt', ['updatedAt'])
export class CachedScore {
    /** References scores.id (ON DELETE CASCADE) — one cache row per score. */
    @PrimaryColumn('uuid')
    scoreId: string

    @Column({ type: 'jsonb' })
    data: Record<string, unknown>

    @CreateDateColumn({ type: 'timestamptz' })
    createdAt: Date

    @UpdateDateColumn({ type: 'timestamptz' })
    updatedAt: Date
}
