import type { Metadata } from 'next'
import Link from 'next/link'

import { PublicPageShell } from '@/components/PublicPageShell'

export const metadata: Metadata = {
    title: 'Terms of Service',
    description: 'The agreement that governs your use of Sheemu — accounts, subscriptions, your content, and our responsibilities.',
    alternates: { canonical: '/terms' },
}

const LAST_UPDATED = '10 July 2026'

export default function TermsPage() {
    return (
        <PublicPageShell title="Terms of Service" subtitle={`Last updated: ${LAST_UPDATED}`}>
            <p>
                These terms are the agreement between you and <strong>Karel Van De Winkel, trading as Sheemu</strong> (sole
                proprietorship, enterprise no. 1039.906.118), Capucienenlaan 23, 9300 Aalst, Belgium (&quot;Sheemu&quot;,
                &quot;we&quot;) for the use of the Sheemu web application and website. By
                creating an account or using Sheemu you accept them. If you don&apos;t agree, please don&apos;t use the service.
            </p>

            <h2>1. What Sheemu is</h2>
            <p>
                Sheemu is a sheet-music editor with live audio-to-notation recording: you play or sing, and Sheemu transcribes it
                into editable notation. Features vary by plan (see <Link href="/#pricing">pricing</Link>); recording time is limited
                per day depending on your plan.
            </p>

            <h2>2. Your account</h2>
            <ul>
                <li>You must be at least 16 years old to create an account.</li>
                <li>Keep your password confidential; you are responsible for activity under your account.</li>
                <li>Provide accurate information and keep your email address current — it&apos;s how we reach you.</li>
                <li>One person per account. You may not sell, share, or transfer your account.</li>
            </ul>

            <h2>3. Beta access</h2>
            <p>
                While Sheemu is in <strong>closed beta</strong>, access is granted at our discretion: after signing up you may need
                to wait until your account is approved. Beta accounts get the Beta plan (currently 30 minutes of recording per day)
                free of charge. The beta is provided <strong>as-is for evaluation</strong>: features may change, break, or be
                removed, availability is not guaranteed, and we may revoke beta access at any time. We&apos;ll give reasonable notice
                before the beta ends and tell you what happens to your account and plan.
            </p>

            <h2>4. Plans, payment, and cancellation</h2>
            <ul>
                <li>
                    Paid subscriptions are sold through our payment partner <strong>Polar</strong>, acting as merchant of record.
                    Polar handles checkout, invoices, and payment data; prices are shown at checkout including applicable taxes.
                </li>
                <li>Subscriptions renew automatically each billing period (monthly or yearly) until cancelled.</li>
                <li>
                    You can cancel any time in Settings or via the billing portal; your plan stays active until the end of the paid
                    period, then drops to the free plan. Your scores are never deleted because of a downgrade.
                </li>
                <li>
                    Statutory withdrawal and refund rights remain unaffected. For refund requests, contact{' '}
                    <a href="mailto:support@sheemu.com">support@sheemu.com</a>.
                </li>
                <li>We may change prices; existing subscriptions are informed at least 30 days before a change takes effect.</li>
            </ul>

            <h2>5. Your content</h2>
            <p>
                The music you create or record in Sheemu is <strong>yours</strong>. You retain all rights to your scores and
                recordings. You grant us the limited licence needed to operate and improve the service — storing your scores and
                recordings (including the audio itself), processing them (e.g. transcribing your audio into notation), displaying
                the content back to you, backing it up, and using your recordings internally to{' '}
                <strong>improve our transcription technology</strong>. Your recordings are never published, shared with other
                users, or sold, and we never use your music for marketing without your explicit permission. Deleting your account
                deletes your recordings. See the <Link href="/privacy">privacy policy</Link> for details and how to object.
            </p>
            <p>
                You are responsible for your content: don&apos;t upload or transcribe material that infringes someone else&apos;s
                rights or breaks the law.
            </p>

            <h2>6. Acceptable use</h2>
            <ul>
                <li>No attempts to break, overload, probe, or reverse-engineer the service or its security.</li>
                <li>No automated account creation, scraping, or resale of the service.</li>
                <li>No circumventing plan limits (e.g. recording-time budgets).</li>
                <li>No unlawful, infringing, or abusive use.</li>
            </ul>
            <p>We may suspend or terminate accounts that violate these rules, with notice where reasonably possible.</p>

            <h2>7. Availability and changes</h2>
            <p>
                We work hard to keep Sheemu available and your data safe, but the service is provided{' '}
                <strong>&quot;as available&quot;</strong>: we don&apos;t guarantee uninterrupted availability, and we may modify or
                discontinue features. If we ever discontinue Sheemu entirely, we&apos;ll give you at least 60 days to export your
                scores.
            </p>

            <h2>8. Liability</h2>
            <p>
                Nothing in these terms limits liability that cannot be limited by law (including intent, gross negligence, and injury
                to life or health). Otherwise, our liability is limited to foreseeable damage typical for this kind of service and,
                for paid plans, to the amount you paid us in the 12 months before the event. We are not liable for indirect damage
                such as lost profits. Keep local copies of work that matters to you — export is always available.
            </p>

            <h2>9. Termination</h2>
            <p>
                You can delete your account at any time in Settings (7-day grace period, then permanent deletion — see the{' '}
                <Link href="/privacy">privacy policy</Link>). We may terminate the agreement with 30 days&apos; notice, or
                immediately for serious breach of these terms.
            </p>

            <h2>10. Changes to these terms</h2>
            <p>
                We may update these terms as the service evolves. For material changes we&apos;ll notify you by email or in the app
                at least 14 days in advance; continuing to use Sheemu after that means you accept the new terms. If you don&apos;t,
                you can delete your account and, for paid plans, receive a pro-rata refund of the unused period.
            </p>

            <h2>11. Governing law</h2>
            <p>
                These terms are governed by Belgian law. Mandatory consumer-protection rules of your country of residence remain
                unaffected, and consumers can bring or face claims in the courts of their own residence. The European Commission
                provides an online dispute resolution platform at{' '}
                <a href="https://ec.europa.eu/consumers/odr" target="_blank" rel="noreferrer">
                    ec.europa.eu/consumers/odr
                </a>
                .
            </p>

            <h2>12. Contact</h2>
            <p>
                Karel Van De Winkel, trading as Sheemu · Capucienenlaan 23, 9300 Aalst, Belgium · enterprise no.
                1039.906.118 · <a href="mailto:legal@sheemu.com">legal@sheemu.com</a> ·{' '}
                <Link href="/contact">contact page</Link>.
            </p>
        </PublicPageShell>
    )
}
