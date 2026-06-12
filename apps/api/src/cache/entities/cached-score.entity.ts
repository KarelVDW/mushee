import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Hot cache for scores under active editing. The full JSON score structure
 * lives in `data`; a cron flushes stale rows to MusicXML storage and deletes
 * them.
 */
@Entity('cached_scores')
export class CachedScore {
  /** References Score.id — one cache row per score. */
  @PrimaryColumn()
  scoreId: string;

  @Column({ type: 'jsonb' })
  data: Record<string, unknown>;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
