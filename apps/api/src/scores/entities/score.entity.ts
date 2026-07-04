import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('scores')
@Index('IDX_scores_userId_updatedAt', ['userId', 'updatedAt'])
export class Score {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** References user.id (ON DELETE CASCADE). */
  @Column({ type: 'text' })
  userId: string;

  @Column()
  title: string;

  @Column({ nullable: true })
  storageKey: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
