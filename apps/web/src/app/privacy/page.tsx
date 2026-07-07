import type { Metadata } from 'next'
import Link from 'next/link'

import { PublicPageShell } from '@/components/PublicPageShell'

export const metadata: Metadata = {
    title: 'Privacy Policy',
    description: 'How Sheemu collects, uses, and protects your personal data — including audio recordings, analytics, and cookies.',
    alternates: { canonical: '/privacy' },
}

const LAST_UPDATED = '4 July 2026'

// NOTE: contact details and the legal entity below are placeholders — swap in
// the real company data before launch (see AFTERTHOUGHTS.md at the repo root).

export default function PrivacyPolicyPage() {
    return (
        <PublicPageShell title="Privacy Policy" subtitle={`Last updated: ${LAST_UPDATED}`}>
            <p>
                Sheemu is a sheet-music editor that turns what you play or sing into notation. Doing that requires handling some of
                your personal data — this policy explains exactly what we collect, why, how long we keep it, and the rights you have
                over it. We&apos;ve tried to keep it readable; if anything is unclear, write to{' '}
                <a href="mailto:privacy@sheemu.app">privacy@sheemu.app</a>.
            </p>

            <h2 id="controller">1. Who is responsible for your data</h2>
            <p>
                The data controller for Sheemu is <strong>Sheemu (Sheemu Music BV)</strong>, Voorbeeldstraat 12, 2000 Antwerp, Belgium
                (&quot;Sheemu&quot;, &quot;we&quot;, &quot;us&quot;). For any privacy matter, contact{' '}
                <a href="mailto:privacy@sheemu.app">privacy@sheemu.app</a>.
            </p>

            <h2 id="data-we-collect">2. What we collect and why</h2>

            <h3>Account data</h3>
            <p>
                When you create an account we store your <strong>name, email address, and a hash of your password</strong> (we never
                store the password itself). We use this to operate your account, sign you in, and send you essential service email
                such as verification codes and password resets. For each signed-in session we also record the{' '}
                <strong>IP address and browser (user agent)</strong> it was started from, to secure your account and let us revoke
                stolen sessions; these are deleted with the session. Legal basis: <strong>performance of a contract</strong> (Art.
                6(1)(b) GDPR).
            </p>

            <h3>Your music</h3>
            <p>
                Scores you create — notes, titles, instrument choices — are stored so you can access them from any device. Your music
                is <strong>yours</strong>: we don&apos;t use it for anything except providing the service to you. Legal basis:{' '}
                <strong>performance of a contract</strong>.
            </p>

            <h3>Audio while recording</h3>
            <p>
                When you press Record, audio from your microphone is streamed to our servers and{' '}
                <strong>transcribed to notation in real time, in memory</strong>. The resulting notation is saved to your score; the
                raw audio is <strong>not stored</strong> on our servers once transcription completes. We keep a record of{' '}
                <em>how long</em> you recorded (for the daily recording budget of your plan), but not the sound itself. Capture only
                happens while you have actively started a recording — never in the background. Legal basis:{' '}
                <strong>performance of a contract</strong>.
            </p>

            <h3>Payments</h3>
            <p>
                Paid plans are sold through <strong>Polar (Polar Software Inc.)</strong>, who act as merchant of record. Card and
                payment details go directly to Polar — <strong>we never see or store your payment card data</strong>. Polar shares
                with us your subscription status and a billing reference so we can activate your plan. See{' '}
                <a href="https://polar.sh/legal/privacy" target="_blank" rel="noreferrer">
                    Polar&apos;s privacy policy
                </a>
                . Legal basis: <strong>performance of a contract</strong>.
            </p>

            <h3>Analytics, session replay &amp; error tracking (opt-in)</h3>
            <p>
                With your <strong>consent</strong> — and only with it — we use <strong>PostHog</strong> (hosted in the EU, Frankfurt)
                to understand how Sheemu is used: which features get used (product &amp; web analytics), pseudonymous session replays
                of rough edges in the interface — linked to your account id but never your name or email, with keystrokes and form
                inputs masked — and reports of errors you run into. You give
                or refuse this consent in the cookie banner and can change your mind any time via{' '}
                <strong>Cookie settings</strong> in the footer. Refusing has no effect on how Sheemu works. Legal basis:{' '}
                <strong>consent</strong> (Art. 6(1)(a) GDPR).
            </p>
            <p>
                Independent of consent, our servers report <strong>technical errors</strong> (stack traces, request metadata — not
                your scores or audio) so we can fix crashes. Legal basis: <strong>legitimate interest</strong> in providing a
                reliable service (Art. 6(1)(f) GDPR).
            </p>

            <h3>Onboarding answers</h3>
            <p>
                The optional questions after signup (musical background, instruments, how you found us) tune Sheemu&apos;s defaults
                and tell us where new users come from. Answering is optional. Legal basis: <strong>legitimate interest</strong>; the
                answers are deleted with your account.
            </p>

            <h2 id="cookies">3. Cookies and similar technologies</h2>
            <p>Sheemu uses as few cookies as we can get away with:</p>
            <table>
                <thead>
                    <tr>
                        <th>Name</th>
                        <th>Kind</th>
                        <th>Purpose</th>
                        <th>Lifetime</th>
                    </tr>
                </thead>
                <tbody>
                    <tr>
                        <td>__Secure-better-auth.session_token</td>
                        <td>Essential cookie</td>
                        <td>Keeps you signed in.</td>
                        <td>7 days</td>
                    </tr>
                    <tr>
                        <td>sheemu:consent</td>
                        <td>Essential (localStorage)</td>
                        <td>Remembers your cookie choice.</td>
                        <td>Until cleared</td>
                    </tr>
                    <tr>
                        <td>ph_* (PostHog)</td>
                        <td>Analytics — only after opt-in</td>
                        <td>Distinguishes visitors, powers analytics &amp; session replay.</td>
                        <td>1 year</td>
                    </tr>
                </tbody>
            </table>
            <p>
                Essential cookies don&apos;t require consent (they&apos;re strictly necessary to provide the service you asked for).
                Analytics storage is only set after you accept it in the banner. Withdraw any time via{' '}
                <strong>Cookie settings</strong> in the footer.
            </p>

            <h2 id="processors">4. Who processes data on our behalf</h2>
            <ul>
                <li>
                    <strong>Polar Software Inc.</strong> — payment processing and subscription billing (merchant of record).
                </li>
                <li>
                    <strong>PostHog</strong> (EU cloud, Frankfurt) — analytics, session replay, and error tracking, only after your
                    consent (client-side) or for server error reports (legitimate interest).
                </li>
                <li>
                    <strong>Twilio SendGrid</strong> — delivery of transactional email (verification codes, password resets, beta
                    notifications), configured for EU data residency.
                </li>
                <li>
                    <strong>Our hosting provider</strong> — runs the Sheemu servers and database where your account and scores live.
                </li>
            </ul>
            <p>
                Each processor is bound by a data-processing agreement. Where a processor is established outside the EEA, transfers
                are protected by the EU Standard Contractual Clauses or an adequacy decision.
            </p>

            <h2 id="retention">5. How long we keep your data</h2>
            <ul>
                <li>
                    <strong>Account, scores, settings:</strong> for as long as your account exists.
                </li>
                <li>
                    <strong>Account deletion:</strong> deleting your account (Settings → Delete account) deactivates it immediately
                    and starts a 7-day grace period during which you can change your mind. After 7 days your account, scores,
                    recordings history, subscription record, and onboarding answers are <strong>permanently and irreversibly
                    deleted</strong>, and we ask Polar to delete your customer record.
                </li>
                <li>
                    <strong>Recording usage counters:</strong> per-day totals used to enforce your plan&apos;s recording budget;
                    deleted with your account.
                </li>
                <li>
                    <strong>Raw audio:</strong> not retained (processed in memory during transcription only).
                </li>
                <li>
                    <strong>Invoices &amp; payment records:</strong> kept by Polar for as long as tax law requires.
                </li>
            </ul>

            <h2 id="rights">6. Your rights</h2>
            <p>Under the GDPR you can, at any time and free of charge:</p>
            <ul>
                <li>
                    <strong>Access</strong> the personal data we hold about you and receive a copy;
                </li>
                <li>
                    <strong>Rectify</strong> inaccurate data (name and email can be changed in Settings);
                </li>
                <li>
                    <strong>Erase</strong> your data (the in-app account deletion does this end-to-end);
                </li>
                <li>
                    <strong>Export</strong> your data in a portable format — your scores belong to you;
                </li>
                <li>
                    <strong>Restrict or object</strong> to processing based on legitimate interest;
                </li>
                <li>
                    <strong>Withdraw consent</strong> for analytics via Cookie settings, with effect for the future;
                </li>
                <li>
                    <strong>Complain</strong> to your supervisory authority — in Belgium the{' '}
                    <a href="https://www.dataprotectionauthority.be" target="_blank" rel="noreferrer">
                        Data Protection Authority
                    </a>
                    , or the authority of your own EU member state.
                </li>
            </ul>
            <p>
                To exercise any of these, email <a href="mailto:privacy@sheemu.app">privacy@sheemu.app</a>. We respond within one
                month.
            </p>

            <h2 id="security">7. Security</h2>
            <p>
                All traffic is encrypted in transit (TLS). Passwords are stored as salted hashes. Access to production systems is
                limited to the people who operate the service. Should a breach ever affect your personal data, we will notify the
                supervisory authority and, where required, you — within the legal deadlines.
            </p>

            <h2 id="children">8. Children</h2>
            <p>
                Sheemu is not directed at children under 16, and we don&apos;t knowingly collect their data. If you believe a child
                has created an account, contact us and we will delete it.
            </p>

            <h2 id="changes">9. Changes to this policy</h2>
            <p>
                When we change this policy we&apos;ll update the date at the top; for material changes we&apos;ll notify you by email
                or in the app before they take effect. Earlier versions are available on request.
            </p>

            <h2 id="contact">10. Contact</h2>
            <p>
                Sheemu (Sheemu Music BV) · Voorbeeldstraat 12, 2000 Antwerp, Belgium ·{' '}
                <a href="mailto:privacy@sheemu.app">privacy@sheemu.app</a>. General questions:{' '}
                <a href="mailto:support@sheemu.app">support@sheemu.app</a> or the <Link href="/contact">contact page</Link>.
            </p>
        </PublicPageShell>
    )
}
