import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sgSend = vi.fn();
const sgSetApiKey = vi.fn();
vi.mock('@sendgrid/mail', () => ({
  default: {
    get send() { return sgSend; },
    get setApiKey() { return sgSetApiKey; },
    client: { setDataResidency: vi.fn() },
  },
}));

import { MailService } from '../../src/mail/mail.service';

const ENV_KEYS = [
  'SENDGRID_API_KEY',
  'SENDGRID_FROM_EMAIL',
  'SENDGRID_FROM_NAME',
  'NODE_ENV',
  'WEB_APP_URL',
  'CORS_ORIGIN',
] as const;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  sgSend.mockReset().mockResolvedValue(undefined);
  sgSetApiKey.mockReset();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('MailService configuration', () => {
  it('refuses to boot in production without an API key', () => {
    process.env.NODE_ENV = 'production';
    expect(() => new MailService()).toThrow(/SENDGRID_API_KEY/);
  });

  it('logs instead of sending when unconfigured outside production', async () => {
    const service = new MailService();
    await service.sendVerificationCode('a@b.c', '123456');
    expect(sgSend).not.toHaveBeenCalled();
  });

  it('sends through SendGrid with the configured from identity', async () => {
    process.env.SENDGRID_API_KEY = 'SG.test';
    process.env.SENDGRID_FROM_EMAIL = 'hi@example.app';
    process.env.SENDGRID_FROM_NAME = 'Example';
    const service = new MailService();
    expect(sgSetApiKey).toHaveBeenCalledWith('SG.test');

    await service.sendVerificationCode('a@b.c', '123456');
    expect(sgSend).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'a@b.c',
        from: { email: 'hi@example.app', name: 'Example' },
        subject: expect.stringContaining('123456') as unknown as string,
      }),
    );
  });

  it('rethrows SendGrid failures so callers can react', async () => {
    process.env.SENDGRID_API_KEY = 'SG.test';
    sgSend.mockRejectedValue(new Error('rate limited'));
    const service = new MailService();
    await expect(
      service.sendPasswordResetEmail('a@b.c', 'https://x/reset'),
    ).rejects.toThrow('rate limited');
  });
});

describe('MailService content', () => {
  beforeEach(() => {
    process.env.SENDGRID_API_KEY = 'SG.test';
  });

  it('links to the web app using WEB_APP_URL, trailing slash stripped', async () => {
    process.env.WEB_APP_URL = 'https://sheemu.app/';
    await new MailService().sendBetaApprovedEmail('a@b.c', 'Ada');
    const msg = sgSend.mock.calls[0][0] as { text: string };
    expect(msg.text).toContain('https://sheemu.app/login');
    expect(msg.text).not.toContain('app//login');
  });

  it('falls back to CORS_ORIGIN for links when WEB_APP_URL is unset', async () => {
    process.env.CORS_ORIGIN = 'https://web.example';
    await new MailService().sendBetaSignupNotification(
      'admin@b.c',
      'new@b.c',
      'Ada',
    );
    const msg = sgSend.mock.calls[0][0] as { text: string };
    expect(msg.text).toContain('https://web.example/admin');
  });

  it('escapes user-provided names in HTML bodies', async () => {
    await new MailService().sendBetaWaitlistEmail(
      'a@b.c',
      '<img src=x onerror=alert(1)>',
    );
    const msg = sgSend.mock.calls[0][0] as { html: string; text: string };
    expect(msg.html).not.toContain('<img src=x');
    expect(msg.html).toContain('&lt;img src=x');
  });
});
