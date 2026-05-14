import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('user_onboarding')
export class UserOnboarding {
  @PrimaryColumn()
  userId: string;

  @Column({ type: 'varchar', nullable: true })
  background: string | null;

  @Column({ type: 'varchar', array: true, nullable: true })
  instruments: string[] | null;

  @Column({ type: 'varchar', nullable: true })
  source: string | null;

  @Column({ type: 'varchar', nullable: true })
  sourceDetail: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  completedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
