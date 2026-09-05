import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const sgSend = vi.fn()
const sgSetApiKey = vi.fn()
vi.mock('@sendgrid/mail', () => ({
    default: {
        get send() {
            return sgSend
        },
        get setApiKey() {
            return sgSetApiKey
        },
        client: { setDataResidency: vi.fn() },
    },
}))

import { MailService } from '../../src/mail/mail.service'

const ENV_KEYS = [
    'SENDGRID_API_KEY',
    'SENDGRID_FROM_EMAIL',
    'SENDGRID_FROM_NAME',
    'NODE_ENV',
    'WEB_APP_URL',
    'CORS_ORIGIN',
    'ADMIN_APP_URL',
] as const
let saved: Record<string, string | undefined>

beforeEach(() => {
    saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]))
    for (const k of ENV_KEYS) delete process.env[k]
    sgSend.mockReset().mockResolvedValue(undefined)
    sgSetApiKey.mockReset()
})

afterEach(() => {
    for (const k of ENV_KEYS) {
        if (saved[k] === undefined) delete process.env[k]
        else process.env[k] = saved[k]
    }
})

describe('MailService configuration', () => {
    it('refuses to boot in production without an API key', () => {
        process.env.NODE_ENV = 'production'
        expect(() => new MailService()).toThrow(/SENDGRID_API_KEY/)
    })

    it('logs instead of sending when unconfigured outside production', async () => {
        const service = new MailService()
        await service.sendVerificationCode('a@b.c', '123456')
        expect(sgSend).not.toHaveBeenCalled()
    })

    it('sends through SendGrid with the configured from identity', async () => {
        process.env.SENDGRID_API_KEY = 'SG.test'
        process.env.SENDGRID_FROM_EMAIL = 'hi@example.app'
        process.env.SENDGRID_FROM_NAME = 'Example'
        const service = new MailService()
        expect(sgSetApiKey).toHaveBeenCalledWith('SG.test')

        await service.sendVerificationCode('a@b.c', '123456')
        expect(sgSend).toHaveBeenCalledWith(
            expect.objectContaining({
                to: 'a@b.c',
                from: { email: 'hi@example.app', name: 'Example' },
                subject: expect.stringContaining('123456') as unknown as string,
            }),
        )
    })

    it('rethrows SendGrid failures so callers can react', async () => {
        process.env.SENDGRID_API_KEY = 'SG.test'
        sgSend.mockRejectedValue(new Error('rate limited'))
        const service = new MailService()
        await expect(service.sendPasswordResetEmail('a@b.c', 'https://x/reset')).rejects.toThrow('rate limited')
    })
})

describe('MailService content', () => {
    beforeEach(() => {
        process.env.SENDGRID_API_KEY = 'SG.test'
    })

    it('links to the web app using WEB_APP_URL, trailing slash stripped', async () => {
        process.env.WEB_APP_URL = 'https://solkey.io/'
        await new MailService().sendBetaApprovedEmail('a@b.c', 'Ada')
        const msg = sgSend.mock.calls[0][0] as { text: string }
        expect(msg.text).toContain('https://solkey.io/login')
        expect(msg.text).not.toContain('app//login')
    })

    it('falls back to CORS_ORIGIN for web links when WEB_APP_URL is unset', async () => {
        process.env.CORS_ORIGIN = 'https://web.example'
        await new MailService().sendBetaApprovedEmail('a@b.c', 'Ada')
        const msg = sgSend.mock.calls[0][0] as { text: string }
        expect(msg.text).toContain('https://web.example/login')
    })

    it('links beta signup notifications to the admin console via ADMIN_APP_URL', async () => {
        process.env.ADMIN_APP_URL = 'https://admin.solkey.io/'
        await new MailService().sendBetaSignupNotification('admin@b.c', 'new@b.c', 'Ada')
        const msg = sgSend.mock.calls[0][0] as { text: string }
        expect(msg.text).toContain('https://admin.solkey.io/waitlist')
        expect(msg.text).not.toContain('io//waitlist')
    })

    it('escapes user-provided names in HTML bodies', async () => {
        await new MailService().sendBetaWaitlistEmail('a@b.c', '<img src=x onerror=alert(1)>')
        const msg = sgSend.mock.calls[0][0] as { html: string; text: string }
        expect(msg.html).not.toContain('<img src=x')
        expect(msg.html).toContain('&lt;img src=x')
    })
})

describe('MailService announcements', () => {
    it('renders paragraphs, escapes HTML and swaps {{name}} for the per-recipient token', () => {
        const { subject, text, html } = MailService.renderAnnouncement(
            'Hi {{name}} — the beta ends',
            'Dear {{ name }},\n\nThe <beta> ends soon.\nThanks & see you.',
        )
        expect(subject).toBe('Hi -firstName- — the beta ends')
        expect(text).toContain('Dear -firstName-,\n\nThe <beta> ends soon.\nThanks & see you.')
        expect(text).toContain("You're receiving this because you have a Solkey account.")
        expect(html).toContain('<p>Dear -firstName-,</p>')
        expect(html).toContain('<p>The &lt;beta&gt; ends soon.<br/>Thanks &amp; see you.</p>')
        expect(html).toContain('/settings')
    })

    it('understands **bold** and [label](https://url) links, and nothing else', () => {
        const { html, text } = MailService.renderAnnouncement(
            'S',
            'Read the **new terms** at [solkey.io/terms](https://solkey.io/terms) — <b>not html</b> [x](javascript:alert(1))',
        )
        expect(html).toContain('Read the <strong>new terms</strong> at <a href="https://solkey.io/terms">solkey.io/terms</a>')
        expect(html).toContain('&lt;b&gt;not html&lt;/b&gt; [x](javascript:alert(1))')
        expect(text).toContain('Read the new terms at solkey.io/terms (https://solkey.io/terms)')
    })

    it('greets by first name, safely, or "there"', () => {
        expect(MailService.firstName('Ada Lovelace')).toBe('Ada')
        expect(MailService.firstName('  <script>x</script> ')).toBe('scriptx/script')
        expect(MailService.firstName('')).toBe('there')
    })

    it('sends one personalization per recipient in batches of at most 500', async () => {
        process.env.SENDGRID_API_KEY = 'SG.test'
        sgSend.mockResolvedValue(undefined)
        const service = new MailService()
        const recipients = Array.from({ length: 1201 }, (_, i) => ({ email: `u${i}@x`, name: `User ${i}` }))
        const outcome = await service.sendAnnouncement(recipients, 'Subject {{name}}', 'Body {{name}}')
        expect(outcome).toEqual({ sent: 1201, failed: 0, failedRecipients: [], errors: [] })
        expect(sgSend).toHaveBeenCalledTimes(3)
        const sizes = sgSend.mock.calls.map(([msg]) => (msg as { personalizations: unknown[] }).personalizations.length)
        expect(sizes).toEqual([500, 500, 201])
        const first = sgSend.mock.calls[0][0] as {
            personalizations: Array<{ to: string; substitutions: Record<string, string> }>
            subject: string
        }
        expect(first.personalizations[0]).toEqual({ to: 'u0@x', substitutions: { '-firstName-': 'User' } })
        expect(first.subject).toBe('Subject -firstName-')
        delete process.env.SENDGRID_API_KEY
    })

    it('keeps going when a batch is rejected and reports who was not reached', async () => {
        process.env.SENDGRID_API_KEY = 'SG.test'
        sgSend.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('429 rate limited')).mockResolvedValueOnce(undefined)
        const service = new MailService()
        const recipients = Array.from({ length: 1201 }, (_, i) => ({ email: `u${i}@x`, name: `User ${i}` }))
        const outcome = await service.sendAnnouncement(recipients, 'S', 'B')
        expect(sgSend).toHaveBeenCalledTimes(3)
        expect(outcome.sent).toBe(701)
        expect(outcome.failed).toBe(500)
        expect(outcome.failedRecipients.map((r) => r.email)).toEqual(recipients.slice(500, 1000).map((r) => r.email))
        expect(outcome.errors).toEqual(['500 recipients from u500@x: 429 rate limited'])
        delete process.env.SENDGRID_API_KEY
    })

    it('counts unconfigured (logged) batches as sent so dev runs look like production ones', async () => {
        const service = new MailService()
        expect(await service.sendAnnouncement([{ email: 'a@x', name: 'A' }], 'S', 'B')).toEqual({
            sent: 1,
            failed: 0,
            failedRecipients: [],
            errors: [],
        })
        expect(sgSend).not.toHaveBeenCalled()
    })

    it('sends nothing for an empty audience', async () => {
        const service = new MailService()
        expect(await service.sendAnnouncement([], 'S', 'B')).toEqual({ sent: 0, failed: 0, failedRecipients: [], errors: [] })
        expect(sgSend).not.toHaveBeenCalled()
    })
})
