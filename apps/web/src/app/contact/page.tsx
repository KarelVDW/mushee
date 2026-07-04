import type { Metadata } from 'next'

import { PublicPageShell } from '@/components/PublicPageShell'

export const metadata: Metadata = {
    title: 'Contact',
    description: 'Get in touch with the Sheemu team — support, feedback, privacy, and legal.',
    alternates: { canonical: '/contact' },
}

// NOTE: all contact details below are placeholders — swap in the real
// company data before launch (see AFTERTHOUGHTS.md).

const CHANNELS: { label: string; email: string; blurb: string }[] = [
    { label: 'Support', email: 'support@sheemu.app', blurb: 'Something broken, confusing, or missing? We usually reply within one business day.' },
    { label: 'Hello', email: 'hello@sheemu.app', blurb: 'Feedback, ideas, partnerships, press — or just to tell us what you wrote today.' },
    { label: 'Privacy', email: 'privacy@sheemu.app', blurb: 'Anything about your personal data or GDPR requests.' },
    { label: 'Legal', email: 'legal@sheemu.app', blurb: 'Terms, licensing, and other formal matters.' },
]

export default function ContactPage() {
    return (
        <PublicPageShell title="Contact" subtitle="Real humans, real inboxes. Pick the one that fits.">
            <div className="grid grid-cols-2 gap-4 not-prose m-0 mb-8">
                {CHANNELS.map((c) => (
                    <div key={c.label} className="bg-surface-container-lowest rounded-lg editorial-shadow p-6 flex flex-col gap-2">
                        <span className="font-label font-semibold text-[11px] leading-none tracking-[0.12em] uppercase text-on-surface-variant">
                            {c.label}
                        </span>
                        <a href={`mailto:${c.email}`} className="font-headline font-semibold text-[18px] leading-[1.2] text-primary no-underline">
                            {c.email}
                        </a>
                        <p className="font-body font-normal text-[13px] leading-normal text-on-surface-variant m-0">{c.blurb}</p>
                    </div>
                ))}
            </div>

            <h2>Postal address</h2>
            <p>
                Sheemu (Sheemu Music BV)
                <br />
                Voorbeeldstraat 12
                <br />
                2000 Antwerp, Belgium
            </p>

            <h2>In the app</h2>
            <p>
                Signed in? You&apos;ll find the same support links under <strong>Settings → Account → Support</strong>.
            </p>
        </PublicPageShell>
    )
}
