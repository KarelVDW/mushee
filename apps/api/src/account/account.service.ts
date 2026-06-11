import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThanOrEqual, Repository } from 'typeorm';

import { auth } from '../auth/auth';
import { OnboardingService } from '../onboarding/onboarding.service';
import { RecordingsService } from '../recordings/recordings.service';
import { ScoresService } from '../scores/scores.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { AccountDeletion } from './entities/account-deletion.entity';

export const DELETION_GRACE_PERIOD_DAYS = 7;

export interface AccountDeletionStatus {
  pending: boolean;
  requestedAt?: Date;
  purgeAfter?: Date;
}

@Injectable()
export class AccountService {
  private readonly logger = new Logger(AccountService.name);

  constructor(
    @InjectRepository(AccountDeletion)
    private readonly deletionRepo: Repository<AccountDeletion>,
    private readonly scoresService: ScoresService,
    private readonly recordingsService: RecordingsService,
    private readonly subscriptionsService: SubscriptionsService,
    private readonly onboardingService: OnboardingService,
  ) {}

  /**
   * Soft-delete the account: re-authenticate with the password, schedule the
   * purge for after the grace period, and revoke every session so all devices
   * land back on the login screen (where the reactivation prompt lives).
   */
  async requestDeletion(
    userId: string,
    password: string,
  ): Promise<AccountDeletionStatus> {
    const ctx = await auth.$context;

    const accounts = await ctx.internalAdapter.findAccounts(userId);
    const credential = accounts.find((a) => a.providerId === 'credential');
    const valid =
      credential?.password &&
      (await ctx.password.verify({ hash: credential.password, password }));
    if (!valid) {
      throw new UnauthorizedException('Incorrect password');
    }

    // Re-requesting while already pending keeps the original window rather
    // than restarting the 7 days.
    const existing = await this.deletionRepo.findOneBy({ userId });
    const deletion =
      existing ??
      (await this.deletionRepo.save(
        this.deletionRepo.create({
          userId,
          purgeAfter: new Date(
            Date.now() + DELETION_GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000,
          ),
        }),
      ));

    await ctx.internalAdapter.deleteSessions(userId);
    this.logger.log(
      `Account ${userId} scheduled for deletion after ${deletion.purgeAfter.toISOString()}`,
    );

    return this.toStatus(deletion);
  }

  async status(userId: string): Promise<AccountDeletionStatus> {
    return this.toStatus(await this.deletionRepo.findOneBy({ userId }));
  }

  /** Cancel a pending deletion — the user changed their mind within the grace period. */
  async reactivate(userId: string): Promise<AccountDeletionStatus> {
    const result = await this.deletionRepo.delete({ userId });
    if (result.affected) {
      this.logger.log(`Account ${userId} reactivated, deletion cancelled`);
    }
    return { pending: false };
  }

  /**
   * Permanently delete every account whose grace period has passed: all the
   * user's data first, then the better-auth user itself (sessions, credential
   * accounts, user row).
   */
  async purgeExpired(): Promise<number> {
    const due = await this.deletionRepo.find({
      where: { purgeAfter: LessThanOrEqual(new Date()) },
    });

    let purged = 0;
    for (const { userId } of due) {
      try {
        await this.scoresService.removeAllForUser(userId);
        await this.recordingsService.deleteAllForUser(userId);
        await this.subscriptionsService.deleteForUser(userId);
        await this.onboardingService.deleteForUser(userId);

        const ctx = await auth.$context;
        await ctx.internalAdapter.deleteUser(userId);

        await this.deletionRepo.delete({ userId });
        purged++;
        this.logger.log(`Purged account ${userId} and all its data`);
      } catch (error) {
        // Leave the row in place; the next run retries.
        this.logger.error(`Failed to purge account ${userId}: ${String(error)}`);
      }
    }
    return purged;
  }

  private toStatus(deletion: AccountDeletion | null): AccountDeletionStatus {
    if (!deletion) return { pending: false };
    return {
      pending: true,
      requestedAt: deletion.requestedAt,
      purgeAfter: deletion.purgeAfter,
    };
  }
}
