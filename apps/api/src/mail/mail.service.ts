import { Injectable, Logger } from '@nestjs/common';
import sgMail from '@sendgrid/mail';

type SendArgs = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly from: string;
  private readonly fromName: string;
  private readonly configured: boolean;

  constructor() {
    const apiKey = process.env.SENDGRID_API_KEY;
    // Fallback must match the canonical site domain (sheemu.app) — a mismatch
    // breaks SPF/DKIM alignment and lands every verification code in spam.
    this.from = process.env.SENDGRID_FROM_EMAIL ?? 'no-reply@sheemu.app';
    this.fromName = process.env.SENDGRID_FROM_NAME ?? 'Sheemu';
    this.configured = Boolean(apiKey);

    if (this.configured) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      sgMail.setApiKey(apiKey!);
      if (process.env.SENDGRID_EU_RESIDENCY === 'true') {
        (sgMail as unknown as { client: { setDataResidency: (r: string) => void } })
          .client.setDataResidency('eu');
      }
    } else if (process.env.NODE_ENV === 'production') {
      // Fail fast: without mail, signups dead-end at email verification and
      // the dev fallback below would write OTP codes into production logs.
      throw new Error(
        'SENDGRID_API_KEY must be set in production — verification and password-reset emails cannot be delivered without it.',
      );
    } else {
      this.logger.warn(
        'SENDGRID_API_KEY is not set — outgoing emails will be logged but not delivered.',
      );
    }
  }

  async send({ to, subject, html, text }: SendArgs): Promise<void> {
    if (!this.configured) {
      this.logger.log(`[MAIL:skipped] to=${to} subject="${subject}"\n${text}`);
      return;
    }

    try {
      await sgMail.send({
        to,
        from: { email: this.from, name: this.fromName },
        subject,
        text,
        html,
      });
    } catch (err) {
      this.logger.error(
        `SendGrid send failed for ${to}: ${(err as Error).message}`,
        err as Error,
      );
      throw err;
    }
  }

  async sendVerificationCode(to: string, code: string): Promise<void> {
    const subject = `Your Sheemu verification code: ${code}`;
    const text =
      `Welcome to Sheemu!\n\n` +
      `Your verification code is: ${code}\n\n` +
      `Enter it in the app to finish setting up your account. The code expires in 10 minutes.\n\n` +
      `If you didn't create an account, you can ignore this message.`;
    const html = layout(
      'Verify your email',
      `<p>Welcome to <strong>Sheemu</strong>!</p>
       <p>Enter this code in the app to finish setting up your account:</p>
       ${codeBlock(code)}
       <p class="muted">The code expires in 10 minutes. If you didn't create an account, you can ignore this message.</p>`,
    );
    await this.send({ to, subject, html, text });
  }

  async sendPasswordResetEmail(to: string, resetUrl: string): Promise<void> {
    const subject = 'Reset your Sheemu password';
    const text =
      `We received a request to reset the password on your Sheemu account.\n\n` +
      `Reset your password here:\n${resetUrl}\n\n` +
      `This link is good for 30 minutes. If you didn't request this, you can ignore the email — your password stays the same.`;
    const html = layout(
      'Reset your password',
      `<p>We received a request to reset the password on your Sheemu account.</p>
       ${button(resetUrl, 'Set a new password')}
       <p class="muted">This link is good for 30 minutes. If you didn't request this, you can ignore the email — your password stays the same.</p>`,
    );
    await this.send({ to, subject, html, text });
  }

  /** Beta waitlist confirmation, sent right after signup while BETA_MODE=true. */
  async sendBetaWaitlistEmail(to: string, name: string): Promise<void> {
    const subject = "You're on the Sheemu beta waitlist";
    const text =
      `Hi ${name},\n\n` +
      `Thanks for signing up for the Sheemu beta!\n\n` +
      `Sheemu is currently in a closed beta, so access is granted personally. ` +
      `You're on the waitlist now — we'll email you the moment your account is approved.\n\n` +
      `Once you're in, your beta account comes with 5 minutes of recording per day, free of charge.\n\n` +
      `Questions? Write to support@sheemu.app.`;
    const html = layout(
      "You're on the waitlist",
      `<p>Hi <strong>${escapeHtml(name)}</strong>,</p>
       <p>Thanks for signing up for the <strong>Sheemu</strong> beta!</p>
       <p>Sheemu is currently in a closed beta, so access is granted personally. You're on the waitlist now — we'll email you the moment your account is approved.</p>
       <p>Once you're in, your beta account comes with <strong>5 minutes of recording per day</strong>, free of charge.</p>
       <p class="muted">Questions? Write to support@sheemu.app.</p>`,
    );
    await this.send({ to, subject, html, text });
  }

  /** Sent when an admin approves the beta signup. */
  async sendBetaApprovedEmail(to: string, name: string): Promise<void> {
    const appUrl = webAppUrl();
    const subject = "You're in — your Sheemu beta account is ready";
    const text =
      `Hi ${name},\n\n` +
      `Good news: your Sheemu beta account has been approved!\n\n` +
      `Sign in and start recording — hum, sing or play, and watch the notation appear:\n${appUrl}/login\n\n` +
      `Your beta plan includes 5 minutes of recording per day.\n\n` +
      `Have fun, and tell us everything that feels rough: support@sheemu.app.`;
    const html = layout(
      "You're in!",
      `<p>Hi <strong>${escapeHtml(name)}</strong>,</p>
       <p>Good news: your <strong>Sheemu</strong> beta account has been approved!</p>
       <p>Sign in and start recording — hum, sing or play, and watch the notation appear.</p>
       ${button(`${appUrl}/login`, 'Open Sheemu')}
       <p>Your beta plan includes <strong>5 minutes of recording per day</strong>.</p>
       <p class="muted">Have fun, and tell us everything that feels rough: support@sheemu.app.</p>`,
    );
    await this.send({ to, subject, html, text });
  }

  /** Heads-up to an admin that someone joined the waitlist. */
  async sendBetaSignupNotification(
    to: string,
    signupEmail: string,
    signupName: string,
  ): Promise<void> {
    const appUrl = webAppUrl();
    const subject = `New Sheemu beta signup: ${signupEmail}`;
    const text =
      `${signupName} (${signupEmail}) just joined the beta waitlist.\n\n` +
      `Approve or review signups in the admin panel:\n${appUrl}/admin`;
    const html = layout(
      'New beta signup',
      `<p><strong>${escapeHtml(signupName)}</strong> (${escapeHtml(signupEmail)}) just joined the beta waitlist.</p>
       ${button(`${appUrl}/admin`, 'Review signups')}`,
    );
    await this.send({ to, subject, html, text });
  }

  async sendChangeEmailVerification(to: string, verifyUrl: string, newEmail: string): Promise<void> {
    const subject = 'Confirm your new Sheemu email address';
    const text =
      `Confirm that you want to change your Sheemu account email to ${newEmail}.\n\n` +
      `Open this link to approve the change:\n${verifyUrl}\n\n` +
      `If this wasn't you, ignore this message — nothing will change.`;
    const html = layout(
      'Confirm your new email',
      `<p>Confirm that you want to change your Sheemu account email to <strong>${escapeHtml(newEmail)}</strong>.</p>
       ${button(verifyUrl, 'Approve change')}
       <p class="muted">If this wasn't you, ignore this message — nothing will change.</p>`,
    );
    await this.send({ to, subject, html, text });
  }
}

export const mailService = new MailService();

/** Public base URL of the web app, for links in emails. */
function webAppUrl(): string {
  return (
    process.env.WEB_APP_URL ??
    process.env.CORS_ORIGIN ??
    'http://localhost:3200'
  ).replace(/\/$/, '');
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function button(href: string, label: string): string {
  return `<p style="margin:28px 0;">
    <a href="${escapeHtml(href)}" style="background:#00DBE9;color:#0a0a0a;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:600;display:inline-block;">${escapeHtml(label)}</a>
  </p>
  <p class="muted">Or paste this URL into your browser:<br/><span style="word-break:break-all;color:#555;">${escapeHtml(href)}</span></p>`;
}

function codeBlock(code: string): string {
  return `<div style="margin:28px 0;text-align:center;">
    <div style="display:inline-block;background:#f5f5f4;border-radius:12px;padding:18px 28px;font-family:'SFMono-Regular',Menlo,Consolas,monospace;font-size:32px;font-weight:600;letter-spacing:0.4em;color:#0a0a0a;">${escapeHtml(code)}</div>
  </div>`;
}

function layout(heading: string, bodyHtml: string): string {
  return `<!doctype html>
<html>
  <body style="margin:0;background:#f5f5f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1a1a1a;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;padding:36px 40px;box-shadow:0 1px 3px rgba(0,0,0,0.06);">
            <tr><td>
              <div style="font-family:Georgia,'Times New Roman',serif;font-style:italic;font-size:24px;letter-spacing:-0.01em;margin-bottom:24px;">Sheemu</div>
              <h1 style="font-size:22px;margin:0 0 16px 0;">${escapeHtml(heading)}</h1>
              <div style="font-size:15px;line-height:1.55;">${bodyHtml}</div>
              <hr style="border:none;border-top:1px solid #ececec;margin:32px 0 16px;" />
              <p style="font-size:12px;color:#888;margin:0;">Sheemu · sent automatically — please don't reply.</p>
            </td></tr>
          </table>
        </td>
      </tr>
    </table>
    <style>.muted{color:#666;font-size:13px;}</style>
  </body>
</html>`;
}
