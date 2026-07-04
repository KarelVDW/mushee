import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

import type { StoredShortcuts } from '../stored-shortcuts';

/**
 * Per-user preferences that must follow the user across devices. One row per
 * user, created lazily on the first write; a missing row means "all defaults".
 */
@Entity('user_settings')
export class UserSettings {
  /** References user.id (ON DELETE CASCADE). */
  @PrimaryColumn({ type: 'text' })
  userId: string;

  /** Keyboard shortcut overrides in the web app's storage format; null = defaults. */
  @Column({ type: 'jsonb', nullable: true })
  keyboardShortcuts: StoredShortcuts | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
