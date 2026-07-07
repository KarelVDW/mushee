import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/** One recording session: which user recorded into which score, and what it cost. */
@Entity('recordings')
@Index('IDX_recordings_userId', ['userId'])
@Index('IDX_recordings_scoreId', ['scoreId'])
export class Recording {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** References user.id (ON DELETE CASCADE). */
  @Column({ type: 'text' })
  userId: string;

  /** References scores.id (ON DELETE CASCADE). */
  @Column('uuid')
  scoreId: string;

  /** Credits spent on this session (1 credit = 1 second of recording). */
  @Column({ type: 'int', default: 0 })
  creditsSpent: number;

  /**
   * Blob-storage folder holding this recording's audio + debug bundle
   * (`recordings/<userId>/<scoreId>/<id>`). Null for rows that predate
   * audio archiving.
   */
  @Column({ type: 'text', nullable: true })
  storagePath: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  endedAt: Date | null;
}
