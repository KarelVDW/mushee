import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

/**
 * Cross-instance lock: at most one recording in flight per user. Rows are
 * deleted on release; a row whose heartbeat went stale (instance crash,
 * network partition) is treated as free and taken over on the next acquire.
 */
@Entity('active_recordings')
export class ActiveRecording {
  /** References user.id (ON DELETE CASCADE). */
  @PrimaryColumn({ type: 'text' })
  userId: string;

  /** Identifies the lock holder; heartbeat/release only touch their own row. */
  @Column('uuid')
  token: string;

  @CreateDateColumn({ type: 'timestamptz' })
  startedAt: Date;

  @Column({ type: 'timestamptz' })
  heartbeatAt: Date;
}
