import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { MailService } from '../mail/mail.service';
import type { BetaStatus } from './beta-config';
import { isBetaMode } from './beta-config';

export interface BetaUserStatus {
  betaMode: boolean;
  /** null = signed up outside the beta (grandfathered — never gated). */
  status: BetaStatus | null;
  role: string;
}

export interface BetaSignup {
  id: string;
  name: string;
  email: string;
  status: BetaStatus;
  createdAt: Date;
}

/**
 * Closed-beta waitlist. Users signing up while BETA_MODE=true start as
 * 'pending' (stamped by the auth signup hook) and only get app access once
 * an admin approves them. The `user` table is owned by better-auth, so this
 * service queries it directly instead of through a TypeORM entity.
 */
@Injectable()
export class BetaService {
  private readonly logger = new Logger(BetaService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly mailService: MailService,
  ) {}

  /** Fresh read — bypasses the 5-minute session cookie cache, so the web app
   *  can poll it to notice an approval without re-login. */
  async statusFor(userId: string): Promise<BetaUserStatus> {
    const rows: Array<{ betaStatus: BetaStatus | null; role: string }> =
      await this.dataSource.query(
        `SELECT "betaStatus", "role" FROM "user" WHERE id = $1`,
        [userId],
      );
    if (rows.length === 0) throw new NotFoundException('User not found');
    return {
      betaMode: isBetaMode(),
      status: rows[0].betaStatus,
      role: rows[0].role,
    };
  }

  /** True when this user must wait for approval before using the app. */
  async isAwaitingApproval(userId: string): Promise<boolean> {
    if (!isBetaMode()) return false;
    const { status } = await this.statusFor(userId);
    return status === 'pending';
  }

  /** Everyone who signed up through the beta flow, newest first. */
  async listSignups(): Promise<BetaSignup[]> {
    return this.dataSource.query(
      `SELECT id, name, email, "betaStatus" AS status, "createdAt"
       FROM "user"
       WHERE "betaStatus" IS NOT NULL
       ORDER BY "createdAt" DESC`,
    );
  }

  async approve(userId: string): Promise<BetaSignup[]> {
    const rows: Array<{ email: string; name: string }> = await this.dataSource.query(
      `UPDATE "user" SET "betaStatus" = 'approved', "updatedAt" = now()
       WHERE id = $1 AND "betaStatus" = 'pending'
       RETURNING email, name`,
      [userId],
    );
    if (rows.length > 0) {
      this.logger.log(`Beta signup ${userId} approved`);
      try {
        await this.mailService.sendBetaApprovedEmail(rows[0].email, rows[0].name);
      } catch (err) {
        // The approval itself stands; the user still sees it in-app.
        this.logger.error(`Approval email to ${rows[0].email} failed: ${String(err)}`);
      }
    }
    return this.listSignups();
  }

  async revoke(userId: string): Promise<BetaSignup[]> {
    await this.dataSource.query(
      `UPDATE "user" SET "betaStatus" = 'pending', "updatedAt" = now()
       WHERE id = $1 AND "betaStatus" = 'approved'`,
      [userId],
    );
    this.logger.log(`Beta access for ${userId} revoked`);
    return this.listSignups();
  }
}
