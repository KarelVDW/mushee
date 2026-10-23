import type { Metadata } from 'next'
import Link from 'next/link'

import { PublicPageShell } from '@/components/PublicPageShell'
import { Eyebrow, PrimaryButton } from '@/components/ui'

import { CopyAddressButton, SettingsSupportLink } from './ContactActions'

export const metadata: Metadata = {
    title: 'Contact',
    description: 'Get in touch with the Solkey team — support, feedback, privacy, and legal.',
    alternates: { canonical: '/contact' },
}

const SUPPORT = 'support@solkey.io'

/** The other inboxes, for the few who need one: plain selectable addresses, no department to pick first. */
const OTHER_CHANNELS: { label: string; email: string }[] = [
    { label: 'Ideas and feedback', email: 'hello@solkey.io' },
    { label: 'Your data', email: 'privacy@solkey.io' },
    { label: 'Legal', email: 'legal@solkey.io' },
]

export default function ContactPage() {
    return (
        <PublicPageShell
            title="Contact"
            lead={
                <div className="flex flex-col gap-6">
                    {/* One obvious inbox first; a copy button for when mailto: opens nothing (webmail). */}
                    <section
                        aria-labelledby="contact-support"
                        className="bg-surface-container-lowest rounded-lg tonal-layer-glow p-6 sm:p-8 flex flex-col gap-3">
                        <Eyebrow className="text-primary">Need a hand?</Eyebrow>
                        <h2
                            id="contact-support"
                            className="font-headline font-semibold text-[24px] sm:text-[28px] leading-[1.15] tracking-[-0.01em] text-on-surface m-0 break-all select-all">
                            {SUPPORT}
                        </h2>
                        <p className="font-body font-normal text-[16px] leading-normal text-on-surface-variant m-0">
                            Something broken, confusing or missing? Write to us. A real person reads every message.
                        </p>
                        <div className="flex flex-wrap items-center gap-3 mt-2">
                            <PrimaryButton href={`mailto:${SUPPORT}`} icon="mail">
                                Write an email
                            </PrimaryButton>
                            <CopyAddressButton address={SUPPORT} />
                        </div>
                    </section>
                    <ul className="list-none m-0 p-0 flex flex-col gap-2">
                        {OTHER_CHANNELS.map((c) => (
                            <li
                                key={c.email}
                                className="min-h-11 bg-surface-container-lowest rounded-md px-5 py-2.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 font-body font-normal text-[16px] leading-[1.4]">
                                <span className="text-on-surface">{c.label}</span>
                                <a href={`mailto:${c.email}`} className="text-primary select-text break-all">
                                    {c.email}
                                </a>
                            </li>
                        ))}
                    </ul>
                    <div className="flex flex-col gap-2 items-start">
                        <Link href="/#faq" className="font-body font-normal text-[14px] text-primary underline">
                            Common questions are answered on the home page
                        </Link>
                        <SettingsSupportLink />
                    </div>
                </div>
            }
        />
    )
}
