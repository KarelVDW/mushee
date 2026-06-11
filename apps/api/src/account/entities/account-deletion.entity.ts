import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

/**
 * A pending account deletion. The row marks the user as soft-deleted;
 * signing back in and reactivating removes it. Once `purgeAfter` passes,
 * the purge cron permanently deletes the user and all their data.
 */
@Entity('account_deletions')
export class AccountDeletion {
  @PrimaryColumn()
  userId: string;

  @CreateDateColumn()
  requestedAt: Date;

  /** End of the grace period; the purge cron deletes everything after this. */
  @Column({ type: 'timestamptz' })
  purgeAfter: Date;
}
