import 'reflect-metadata';

import type { DataSource } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';

import { BetaService } from '../../src/beta/beta.service';
import type { MailService } from '../../src/mail/mail.service';

/**
 * The fake mirrors the postgres driver's raw-query contract, which is the
 * part that bit us in production: SELECT resolves to plain rows, but
 * UPDATE … RETURNING resolves to a [rows, affectedRowCount] tuple.
 */
function makeService(updateReturning: Array<{ email: string; name: string }>) {
  const dataSource = {
    query: vi.fn((sql: string) =>
      Promise.resolve(
        sql.trimStart().startsWith('UPDATE')
          ? [updateReturning, updateReturning.length]
          : [],
      ),
    ),
  };
  const mailService = {
    sendBetaApprovedEmail: vi.fn(() => Promise.resolve()),
  };
  const service = new BetaService(
    dataSource as unknown as DataSource,
    mailService as unknown as MailService,
  );
  return { service, dataSource, mailService };
}

describe('BetaService.approve', () => {
  it('emails the approved user with their real address and name', async () => {
    const { service, mailService } = makeService([
      { email: 'ada@example.com', name: 'Ada' },
    ]);

    await service.approve('user-1');

    expect(mailService.sendBetaApprovedEmail).toHaveBeenCalledWith('ada@example.com', 'Ada');
  });

  it('sends nothing when the user was not pending (0 rows updated)', async () => {
    const { service, mailService } = makeService([]);

    await service.approve('user-1');

    expect(mailService.sendBetaApprovedEmail).not.toHaveBeenCalled();
  });

  it('still returns the signup list when the approval email fails', async () => {
    const { service, mailService } = makeService([
      { email: 'ada@example.com', name: 'Ada' },
    ]);
    mailService.sendBetaApprovedEmail.mockRejectedValueOnce(new Error('SendGrid down'));

    await expect(service.approve('user-1')).resolves.toEqual([]);
  });
});
