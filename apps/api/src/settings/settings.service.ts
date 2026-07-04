import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { UserSettings } from './entities/user-settings.entity';
import {
  InvalidShortcutsError,
  sanitizeStoredShortcuts,
  StoredShortcuts,
} from './stored-shortcuts';

/** The settings payload the API exposes — a row's user-facing columns. */
export interface UserSettingsView {
  keyboardShortcuts: StoredShortcuts | null;
}

@Injectable()
export class SettingsService {
  constructor(
    @InjectRepository(UserSettings)
    private readonly repo: Repository<UserSettings>,
  ) {}

  async get(userId: string): Promise<UserSettingsView> {
    const row = await this.repo.findOneBy({ userId });
    return { keyboardShortcuts: row?.keyboardShortcuts ?? null };
  }

  /** Replace the user's shortcut overrides (null puts them back on the defaults). */
  async setKeyboardShortcuts(
    userId: string,
    input: unknown,
  ): Promise<UserSettingsView> {
    let keyboardShortcuts: StoredShortcuts | null;
    try {
      keyboardShortcuts = sanitizeStoredShortcuts(input);
    } catch (error) {
      if (error instanceof InvalidShortcutsError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }

    await this.repo.save(this.repo.create({ userId, keyboardShortcuts }));
    return { keyboardShortcuts };
  }

  /** Remove the user's settings (account purge). */
  async deleteForUser(userId: string): Promise<void> {
    await this.repo.delete({ userId });
  }
}
