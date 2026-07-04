import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * A user's subscription tier plus the Polar state backing it. Rows are
 * written at beta signup (tier 'beta') and by the Polar webhook handler;
 * users without a row are on the free tier.
 */
@Entity('user_subscriptions')
export class UserSubscription {
  /** References user.id (ON DELETE CASCADE). */
  @PrimaryColumn({ type: 'text' })
  userId: string;

  @Column({ type: 'varchar', default: 'free' })
  tierId: string;

  /** Polar customer id (Polar also knows us by externalId = userId). */
  @Column({ type: 'varchar', nullable: true })
  polarCustomerId: string | null;

  @Column({ type: 'varchar', nullable: true })
  polarSubscriptionId: string | null;

  @Column({ type: 'varchar', nullable: true })
  polarProductId: string | null;

  /** Polar subscription status ('active', 'canceled', …); null when unpaid tier. */
  @Column({ type: 'varchar', nullable: true })
  status: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  currentPeriodEnd: Date | null;

  @Column({ type: 'boolean', default: false })
  cancelAtPeriodEnd: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
