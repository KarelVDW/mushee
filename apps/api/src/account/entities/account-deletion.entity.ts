import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
} from 'typeorm';

/**
 * A pending account deletion. The row marks the user as soft-deleted;
 * signing back in and reactivating removes it. Once `purgeAfter` passes,
 * the purge cron permanently deletes the user and all their data.
 */
@Entity('account_deletions')
@Index('IDX_account_deletions_purgeAfter', ['purgeAfter'])
export class AccountDeletion {
  /** References user.id (ON DELETE CASCADE). */
  @PrimaryColumn({ type: 'text' })
  userId: string;

  @CreateDateColumn({ type: 'timestamptz' })
  requestedAt: Date;

  /** End of the grace period; the purge cron deletes everything after this. */
  @Column({ type: 'timestamptz' })
  purgeAfter: Date;
}
