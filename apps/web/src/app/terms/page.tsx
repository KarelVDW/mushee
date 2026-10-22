import type { Metadata } from 'next'
import Link from 'next/link'

import { PublicPageShell, ShortVersion } from '@/components/PublicPageShell'

export const metadata: Metadata = {
    title: 'Terms of service',
    description: 'The agreement that governs your use of Solkey — accounts, subscriptions, your content, and our responsibilities.',
    alternates: { canonical: '/terms' },
}

const LAST_UPDATED = '5 September 2026'

/** The terms in a few plain lines, each restating a section below (keep them in step with it). */
const SHORT_VERSION = [
    'Your scores and recordings are yours. We use them only to run Solkey and to improve how it hears music.',
    'How much you can record each day depends on your plan.',
    'Paid plans renew until you cancel. Cancel any time in Settings, and your plan runs to the end of the period you paid for.',
    'Anyone with a score’s share link can view, play and download that score — never your recordings — until you turn the link off.',
    'Don’t use Solkey to break the law or someone else’s rights, or to get around plan limits.',
    'You can delete your account any time from Settings.',
]

const SECTIONS = [
    { id: 'what-solkey-is', title: 'What Solkey is' },
    { id: 'account', title: 'Your account' },
    { id: 'beta', title: 'Beta access' },
    { id: 'plans', title: 'Plans and payment' },
    { id: 'your-content', title: 'Your content' },
    { id: 'acceptable-use', title: 'Acceptable use' },
    { id: 'availability', title: 'Availability' },
    { id: 'liability', title: 'Liability' },
    { id: 'termination', title: 'Termination' },
    { id: 'changes', title: 'Changes' },
    { id: 'law', title: 'Governing law' },
    { id: 'contact', title: 'Contact' },
]

export default function TermsPage() {
    return (
        <PublicPageShell
            title="Terms of service"
            subtitle={`Last updated: ${LAST_UPDATED}`}
            lead={<ShortVersion points={SHORT_VERSION} closing="The full terms below are the ones that count." sections={SECTIONS} />}>
            <p>
                These terms are the agreement between you and <strong>Karel Van De Winkel, trading as Solkey</strong> (sole proprietorship,
                enterprise no. 1039.906.118), Capucienenlaan 23, 9300 Aalst, Belgium (&quot;Solkey&quot;, &quot;we&quot;) for the use of the
                Solkey web application and website. By creating an account or using Solkey you accept them. If you don&apos;t agree, please
                don&apos;t use the service.
            </p>

            <h2 id="what-solkey-is">1. What Solkey is</h2>
            <p>
                Solkey is a sheet-music editor with live recording that writes the notes for you: you play or sing, and Solkey transcribes
                it into editable notation. Automatic transcription won&apos;t always be perfect, and you can fix any note in the editor.
                Features vary by plan (see <Link href="/pricing">pricing</Link>); recording time is limited per day depending on your plan.
            </p>

            <h2 id="account">2. Your account</h2>
            <ul>
                <li>You must be at least 16 years old to create an account.</li>
                <li>Keep your password confidential; you are responsible for activity under your account.</li>
                <li>Provide accurate information and keep your email address current — it&apos;s how we reach you.</li>
                <li>One person per account. You may not sell, share, or transfer your account.</li>
            </ul>

            <h2 id="beta">3. Beta access</h2>
            <p>
                While Solkey is in <strong>closed beta</strong>, access is granted at our discretion: after signing up you may need to wait
                until your account is approved. Beta accounts get the Beta plan (currently 30 minutes of recording per day) free of charge.
                The beta is provided <strong>as-is for evaluation</strong>: features may change, break, or be removed, availability is not
                guaranteed, and we may revoke beta access at any time.
            </p>

            <h2 id="plans">4. Plans, payment, and cancellation</h2>
            <ul>
                <li>
                    Paid subscriptions are sold through our payment partner <strong>Polar</strong>, acting as merchant of record. Polar
                    handles checkout, invoices, and payment data; prices are shown at checkout including applicable taxes.
                </li>
                <li>Subscriptions renew automatically each billing period (monthly or yearly) until cancelled.</li>
                <li>
                    You can cancel any time in Settings or via the billing portal; your plan stays active until the end of the paid period,
                    then drops to the free plan. Your scores are never deleted because of a downgrade.
                </li>
                <li>
                    Statutory withdrawal and refund rights remain unaffected. For refund requests, contact{' '}
                    <a href="mailto:support@solkey.io">support@solkey.io</a>.
                </li>
                <li>We may change prices; existing subscriptions are informed at least 30 days before a change takes effect.</li>
            </ul>

            <h2 id="your-content">5. Your content</h2>
            <p>
                The music you create or record in Solkey is <strong>yours</strong>. You retain all rights to your scores and recordings. You
                grant us the limited licence needed to operate and improve the service — storing your scores and recordings (including the
                audio itself), processing them (e.g. transcribing your audio into notation), displaying the content back to you, backing it
                up, and using your recordings internally to <strong>improve our transcription technology</strong>. Your recordings are never
                published, shared with other users, or sold, and we never use your music for marketing without your explicit permission.
                Deleting your account deletes your recordings. See the <Link href="/privacy">privacy policy</Link> for details and how to
                object.
            </p>
            <p>
                <strong>Share links.</strong> You can choose to share a score through a read-only link. Anyone who has the link can view,
                play back and download that score (not your recordings) until you turn the link off in the editor. You decide who receives
                the link; we don&apos;t list shared scores anywhere or submit them to search engines. Don&apos;t share material you have no
                right to distribute — we may disable a link that is reported to us.
            </p>
            <p>
                You are responsible for your content: don&apos;t upload or transcribe material that infringes someone else&apos;s rights or
                breaks the law.
            </p>

            <h2 id="acceptable-use">6. Acceptable use</h2>
            <ul>
                <li>No attempts to break, overload, probe, or reverse-engineer the service or its security.</li>
                <li>No automated account creation, scraping, or resale of the service.</li>
                <li>No circumventing plan limits (e.g. recording-time budgets).</li>
                <li>No unlawful, infringing, or abusive use.</li>
            </ul>
            <p>We may suspend or terminate accounts that violate these rules, with notice where reasonably possible.</p>

            <h2 id="availability">7. Availability and changes</h2>
            <p>
                We work hard to keep Solkey available and your data safe, but the service is provided{' '}
                <strong>&quot;as available&quot;</strong>: we don&apos;t guarantee uninterrupted availability, and we may modify or
                discontinue features. If we ever discontinue Solkey entirely, we&apos;ll give you at least 60 days to export your scores.
            </p>

            <h2 id="liability">8. Liability</h2>
            <p>
                Nothing in these terms limits liability that cannot be limited by law (including intent, gross negligence, and injury to
                life or health). Otherwise, our liability is limited to foreseeable damage typical for this kind of service and, for paid
                plans, to the amount you paid us in the 12 months before the event. We are not liable for indirect damage such as lost
                profits. Keep local copies of work that matters to you — export is always available.
            </p>

            <h2 id="termination">9. Termination</h2>
            <p>
                You can delete your account at any time in Settings (7-day grace period, then permanent deletion — see the{' '}
                <Link href="/privacy">privacy policy</Link>). We may terminate the agreement with 30 days&apos; notice, or immediately for
                serious breach of these terms.
            </p>

            <h2 id="changes">10. Changes to these terms</h2>
            <p>
                We may update these terms as the service evolves. For material changes we&apos;ll notify you by email or in the app at least
                14 days in advance; continuing to use Solkey after that means you accept the new terms. If you don&apos;t, you can delete
                your account and, for paid plans, receive a pro-rata refund of the unused period.
            </p>

            <h2 id="law">11. Governing law</h2>
            <p>
                These terms are governed by Belgian law. Mandatory consumer-protection rules of your country of residence remain unaffected,
                and consumers can bring or face claims in the courts of their own residence. The European Commission provides an online
                dispute resolution platform at{' '}
                <a href="https://ec.europa.eu/consumers/odr" target="_blank" rel="noreferrer">
                    ec.europa.eu/consumers/odr
                </a>
                .
            </p>

            <h2 id="contact">12. Contact</h2>
            <p>
                Karel Van De Winkel, trading as Solkey · Capucienenlaan 23, 9300 Aalst, Belgium · enterprise no. 1039.906.118 ·{' '}
                <a href="mailto:legal@solkey.io">legal@solkey.io</a> · <Link href="/contact">contact page</Link>.
            </p>
        </PublicPageShell>
    )
}
