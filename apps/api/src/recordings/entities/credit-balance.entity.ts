import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * Purchased one-time recording minutes ("packs"). One row per user holding the
 * remaining balance in seconds. Pack seconds never expire and are only drawn
 * from once the day's subscription budget is spent; purchases arrive through
 * Polar `order.paid` webhooks.
 */
@Entity('credit_balances')
export class CreditBalance {
  /** References user.id (ON DELETE CASCADE). */
  @PrimaryColumn({ type: 'text' })
  userId: string;

  @Column({ type: 'int', default: 0 })
  seconds: number;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  updatedAt: Date;
}
