'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

import { DialogPanel, DialogScrim, PrimaryButton, SecondaryButton, Switch, TertiaryButton } from '@/components/ui'
import { getConsent, saveConsent } from '@/lib/consent'

/** Reopens the cookie preferences dialog (e.g. from the footer link). */
export function openCookieSettings(): void {
    window.dispatchEvent(new Event('sheemu:cookie-settings'))
}

/**
 * GDPR consent banner + preferences dialog, mounted app-wide in Providers.
 * Analytics (PostHog) stays off until the user opts in; "Essential only"
 * is as easy to pick as "Accept all", as the GDPR requires.
 */
export function CookieConsent() {
    const [decided, setDecided] = useState(true) // assume decided until mounted, to avoid a flash
    const [settingsOpen, setSettingsOpen] = useState(false)
    const [analyticsChoice, setAnalyticsChoice] = useState(false)

    useEffect(() => {
        const consent = getConsent()
        setDecided(consent !== null)
        setAnalyticsChoice(consent?.analytics ?? false)

        const openSettings = () => {
            setAnalyticsChoice(getConsent()?.analytics ?? false)
            setSettingsOpen(true)
        }
        window.addEventListener('sheemu:cookie-settings', openSettings)
        return () => window.removeEventListener('sheemu:cookie-settings', openSettings)
    }, [])

    const decide = (analytics: boolean) => {
        saveConsent(analytics)
        setDecided(true)
        setSettingsOpen(false)
    }

    if (settingsOpen) {
        return (
            <DialogScrim onDismiss={() => setSettingsOpen(false)}>
                <DialogPanel
                    title="Cookie preferences"
                    subtitle="Choose what Sheemu may use. You can change this any time via 'Cookie settings' in the footer."
                    onClose={() => setSettingsOpen(false)}
                    width={520}
                    footer={
                        <>
                            <TertiaryButton onClick={() => decide(false)}>Essential only</TertiaryButton>
                            <PrimaryButton onClick={() => decide(analyticsChoice)}>Save preferences</PrimaryButton>
                        </>
                    }>
                    <div className="flex flex-col gap-5 pb-2">
                        <div className="bg-surface-container-low rounded-md px-4 py-3.5 flex flex-col gap-2">
                            <div className="flex items-center justify-between gap-3">
                                <span className="font-body font-semibold text-[14px] leading-[1.3] text-on-surface">Essential</span>
                                <span className="font-label font-semibold text-[10px] leading-none tracking-[0.12em] uppercase text-on-surface-variant">
                                    Always on
                                </span>
                            </div>
                            <p className="font-body font-normal text-[13px] leading-normal text-on-surface-variant m-0">
                                Keeps you signed in and remembers this cookie choice. Sheemu doesn&apos;t work without these.
                            </p>
                        </div>
                        <div className="bg-surface-container-low rounded-md px-4 py-3.5 flex flex-col gap-2">
                            <Switch checked={analyticsChoice} onChange={setAnalyticsChoice} label="Analytics & session replay" />
                            <p className="font-body font-normal text-[13px] leading-normal text-on-surface-variant m-0">
                                Helps us understand which features get used, watch anonymized replays of rough edges, and catch errors
                                (PostHog, hosted in the EU). Off by default — nothing is collected unless you turn it on.
                            </p>
                        </div>
                        <p className="font-body font-normal text-[12px] leading-normal text-on-surface-variant m-0">
                            Details in our{' '}
                            <Link href="/privacy#cookies" className="text-primary underline">
                                privacy policy
                            </Link>
                            .
                        </p>
                    </div>
                </DialogPanel>
            </DialogScrim>
        )
    }

    if (decided) return null

    return (
        <div
            role="dialog"
            aria-label="Cookie consent"
            className="fixed bottom-5 left-5 right-5 z-60 max-w-180 mx-auto glass-panel rounded-lg px-5.5 py-4.5 shadow-(--shadow-tonal) flex items-center gap-5 flex-wrap">
            <div className="flex-1 min-w-55 flex flex-col gap-1.5">
                <span className="font-label font-semibold text-[11px] leading-none tracking-[0.14em] uppercase text-on-surface-variant">
                    Cookies
                </span>
                <p className="font-body font-normal text-[14px] leading-normal text-on-surface m-0">
                    Sheemu uses essential cookies to keep you signed in. With your permission we&apos;d also use analytics to improve the
                    editor — that&apos;s entirely up to you.{' '}
                    <Link href="/privacy#cookies" className="text-primary underline">
                        Learn more
                    </Link>
                    .
                </p>
            </div>
            {/* "Essential only" and "Accept all" carry equal visual weight — the GDPR-parity
                the component promises. Only "Customize" steps back a level. */}
            <div className="flex items-center gap-2 shrink-0 flex-wrap">
                <TertiaryButton onClick={() => setSettingsOpen(true)}>Customize</TertiaryButton>
                <SecondaryButton onClick={() => decide(false)}>Essential only</SecondaryButton>
                <SecondaryButton onClick={() => decide(true)}>Accept all</SecondaryButton>
            </div>
        </div>
    )
}
