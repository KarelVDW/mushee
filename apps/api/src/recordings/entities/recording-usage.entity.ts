import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * Per-user daily recording credit usage. One row per user per UTC day;
 * the meter increments `creditsUsed` while a recording is running.
 */
@Entity('recording_usage')
export class RecordingUsage {
  /** References user.id (ON DELETE CASCADE). */
  @PrimaryColumn({ type: 'text' })
  userId: string;

  /** UTC calendar day, `YYYY-MM-DD`. */
  @PrimaryColumn({ type: 'date' })
  day: string;

  @Column({ type: 'int', default: 0 })
  creditsUsed: number;
}
