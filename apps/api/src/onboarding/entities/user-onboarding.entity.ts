import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('user_onboarding')
export class UserOnboarding {
  /** References user.id (ON DELETE CASCADE). */
  @PrimaryColumn({ type: 'text' })
  userId: string;

  @Column({ type: 'varchar', nullable: true })
  background: string | null;

  @Column({ type: 'varchar', nullable: true })
  goal: string | null;

  @Column({ type: 'varchar', array: true, nullable: true })
  instruments: string[] | null;

  @Column({ type: 'varchar', nullable: true })
  source: string | null;

  @Column({ type: 'varchar', nullable: true })
  sourceDetail: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  completedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
