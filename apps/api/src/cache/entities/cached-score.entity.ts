import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Hot cache for scores under active editing. The full JSON score structure
 * lives in `data`; a cron flushes stale rows to MusicXML storage and deletes
 * them.
 */
@Entity('cached_scores')
@Index('IDX_cached_scores_updatedAt', ['updatedAt'])
export class CachedScore {
  /** References scores.id (ON DELETE CASCADE) — one cache row per score. */
  @PrimaryColumn('uuid')
  scoreId: string;

  @Column({ type: 'jsonb' })
  data: Record<string, unknown>;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
