import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * A user's paid tier. Rows are only written once billing is integrated;
 * users without a row are on the free tier.
 */
@Entity('user_subscriptions')
export class UserSubscription {
  @PrimaryColumn()
  userId: string;

  @Column({ type: 'varchar', default: 'free' })
  tierId: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
