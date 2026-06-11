import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

/** One recording session: which user recorded into which score, and what it cost. */
@Entity('recordings')
export class Recording {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  userId: string;

  @Column()
  scoreId: string;

  /** Credits spent on this session (1 credit = 1 second of recording). */
  @Column({ type: 'int', default: 0 })
  creditsSpent: number;

  @CreateDateColumn()
  createdAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  endedAt: Date | null;
}
