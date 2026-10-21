'use client'

import Link from 'next/link'
import { type ReactNode, useEffect, useState } from 'react'

import { DialogPanel, Eyebrow, PrimaryButton, SecondaryButton, Switch, TertiaryButton } from '@/components/ui'
import { getConsent, onConsentSettingsRequested, saveConsent } from '@/lib/consent'

/**
 * GDPR consent banner + preferences dialog, mounted app-wide in Providers.
 * Anonymous cookieless usage stats run regardless (nothing stored on the
 * device — see lib/analytics.ts); the opt-in here covers session replay,
 * account-linked analytics, and the persistent PostHog cookie. "Essential
 * only" is as easy to pick as "Accept all", as the GDPR requires.
 */
export function CookieConsent() {
    const [decided, setDecided] = useState(true) // assume decided until mounted, to avoid a flash
    const [settingsOpen, setSettingsOpen] = useState(false)
    const [analyticsChoice, setAnalyticsChoice] = useState(false)

    useEffect(() => {
        const consent = getConsent()
        setDecided(consent !== null)
        setAnalyticsChoice(consent?.analytics ?? false)

        // Re-read on every request: the stored choice may have changed since mount.
        return onConsentSettingsRequested(() => {
            setAnalyticsChoice(getConsent()?.analytics ?? false)
            setSettingsOpen(true)
        })
    }, [])

    const decide = (analytics: boolean) => {
        saveConsent(analytics)
        setDecided(true)
        setSettingsOpen(false)
    }

    if (settingsOpen) {
        return (
            <CookiePreferencesDialog
                analytics={analyticsChoice}
                onAnalyticsChange={setAnalyticsChoice}
                onDecide={decide}
                onClose={() => setSettingsOpen(false)}
            />
        )
    }
    return decided ? null : <CookieBanner onCustomize={() => setSettingsOpen(true)} onDecide={decide} />
}

/** First-visit bar: one-tap essential/all choices, or the full preferences. */
function CookieBanner({ onCustomize, onDecide }: { onCustomize: () => void; onDecide: (analytics: boolean) => void }) {
    return (
        <div
            role="dialog"
            aria-label="Cookie consent"
            className="fixed bottom-5 left-5 right-5 z-(--z-banner) max-w-180 mx-auto glass-panel rounded-lg px-5.5 py-4.5 shadow-(--shadow-tonal) flex items-center gap-5 flex-wrap">
            <div className="flex-1 min-w-55 flex flex-col gap-1.5">
                <Eyebrow>Cookies</Eyebrow>
                <p className="font-body font-normal text-[14px] leading-normal text-on-surface m-0">
                    Solkey uses essential cookies to keep you signed in, plus cookieless, anonymous usage stats. With your permission
                    we&apos;d also use session replay to improve the editor — that&apos;s entirely up to you.{' '}
                    <Link href="/privacy#cookies" className="text-primary underline">
                        Learn more
                    </Link>
                    .
                </p>
            </div>
            {/* "Essential only" and "Accept all" carry equal visual weight — the GDPR-parity
                the component promises. Only "Customize" steps back a level. */}
            <div className="flex items-center gap-2 shrink-0 flex-wrap">
                <TertiaryButton onClick={onCustomize}>Customize</TertiaryButton>
                <SecondaryButton onClick={() => onDecide(false)}>Essential only</SecondaryButton>
                <SecondaryButton onClick={() => onDecide(true)}>Accept all</SecondaryButton>
            </div>
        </div>
    )
}

interface CookiePreferencesDialogProps {
    analytics: boolean
    onAnalyticsChange: (analytics: boolean) => void
    onDecide: (analytics: boolean) => void
    onClose: () => void
}

/** Per-category preferences, reopened any time from the footer's 'Cookie settings'. */
function CookiePreferencesDialog({ analytics, onAnalyticsChange, onDecide, onClose }: CookiePreferencesDialogProps) {
    return (
        <DialogPanel
            title="Cookie preferences"
            subtitle="Choose what Solkey may use. You can change this any time via 'Cookie settings' in the footer."
            onClose={onClose}
            width={520}
            footer={
                <>
                    <TertiaryButton onClick={() => onDecide(false)}>Essential only</TertiaryButton>
                    <PrimaryButton onClick={() => onDecide(analytics)}>Save preferences</PrimaryButton>
                </>
            }>
            <div className="flex flex-col gap-5 pb-2">
                <ConsentCategory header={<CategoryTitle title="Essential" status="Always on" />}>
                    Keeps you signed in and remembers this cookie choice. Solkey doesn&apos;t work without these.
                </ConsentCategory>
                <ConsentCategory header={<CategoryTitle title="Anonymous statistics" status="Always on · no cookies" />}>
                    Counts pages and feature use without cookies or anything stored on your device — never linked to who you are (PostHog,
                    hosted in the EU).
                </ConsentCategory>
                <ConsentCategory
                    header={<Switch checked={analytics} onChange={onAnalyticsChange} label="Session replay & linked analytics" />}>
                    Lets us watch anonymized replays of rough edges and connect usage to your account id so we can debug your issues. Uses
                    one PostHog cookie. Off by default.
                </ConsentCategory>
                <p className="font-body font-normal text-[12px] leading-normal text-on-surface-variant m-0">
                    Details in our{' '}
                    <Link href="/privacy#cookies" className="text-primary underline">
                        privacy policy
                    </Link>
                    .
                </p>
            </div>
        </DialogPanel>
    )
}

/** One consent category card: a header row (title + status, or the opt-in switch) over its description. */
function ConsentCategory({ header, children }: { header: ReactNode; children: ReactNode }) {
    return (
        <div className="bg-surface-container-low rounded-md px-4 py-3.5 flex flex-col gap-2">
            {header}
            <p className="font-body font-normal text-[13px] leading-normal text-on-surface-variant m-0">{children}</p>
        </div>
    )
}

function CategoryTitle({ title, status }: { title: string; status: string }) {
    return (
        <div className="flex items-center justify-between gap-3">
            <span className="font-body font-semibold text-[14px] leading-[1.3] text-on-surface">{title}</span>
            <Eyebrow>{status}</Eyebrow>
        </div>
    )
}
