'use client'

import { TextLink } from '@mushee/ui'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { type ReactNode, type RefObject, useEffect, useRef, useState } from 'react'

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

/**
 * Pads the page's bottom by the banner's footprint while it shows (from its top edge to the
 * viewport's bottom), so the page can scroll everything — the hero's Start free, the footer —
 * clear of it. Document-flow pages only: the editor and the library are full-height app
 * surfaces with their own docked chrome, and padding them would push that chrome off screen.
 */
function usePagePaddingUnder(banner: RefObject<HTMLElement | null>) {
    const pathname = usePathname()
    const padPage = !pathname?.startsWith('/scores')
    useEffect(() => {
        const el = banner.current
        if (!el || !padPage) return
        const body = document.body
        const apply = () => {
            body.style.paddingBottom = `${Math.max(0, Math.round(window.innerHeight - el.getBoundingClientRect().top))}px`
        }
        apply()
        const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(apply)
        observer?.observe(el)
        window.addEventListener('resize', apply)
        return () => {
            observer?.disconnect()
            window.removeEventListener('resize', apply)
            body.style.paddingBottom = ''
        }
    }, [banner, padPage])
}

/**
 * First-visit notice: one-tap essential/all choices, or the full preferences. A solid card,
 * never glass, so the page can't show through its text, stacked as text, then the two choices
 * side by side, then Customize. On phones a compact full-width bottom sheet; from sm a 26rem
 * card in the bottom-right corner (clear of the left-hand hero CTA and section headings) that
 * rises in. The page is padded under it either way.
 */
function CookieBanner({ onCustomize, onDecide }: { onCustomize: () => void; onDecide: (analytics: boolean) => void }) {
    const ref = useRef<HTMLDivElement>(null)
    usePagePaddingUnder(ref)
    return (
        <div
            ref={ref}
            role="dialog"
            aria-label="Cookie consent"
            className={[
                'fixed z-(--z-banner) inset-x-0 bottom-0',
                'sm:inset-x-auto sm:right-5 sm:left-auto sm:bottom-5 sm:max-w-[26rem] sm:mx-0',
                'bg-surface-container-lowest max-sm:shadow-(--shadow-editorial) sm:shadow-overlay rounded-t-xl sm:rounded-lg',
                'px-5 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-5',
                // The corner card rises 16px and fades in over 200ms (at once under reduced motion).
                'sm:animate-[popover-sheet-in_200ms_var(--ease-solkey)] motion-reduce:animate-none',
                'flex flex-col gap-3 sm:gap-4',
            ].join(' ')}>
            <div className="flex flex-col gap-1.5">
                <Eyebrow className="max-sm:hidden">Cookies</Eyebrow>
                <p className="font-body font-normal text-[14px] leading-normal text-on-surface m-0">
                    {/* Phones get the short version, so the sheet stays clear of the hero's Start free. */}
                    <span className="sm:hidden">
                        Essential cookies keep you signed in, and anonymous stats are always on. Screen replays that help us fix bugs are up
                        to you.
                    </span>
                    <span className="max-sm:hidden">
                        Solkey uses essential cookies to keep you signed in, and counts visits without cookies. If you allow it, we&apos;d
                        also record how you use the editor, linked to your account, so we can find and fix bugs. Up to you.
                    </span>{' '}
                    <TextLink as={Link} href="/privacy#cookies">
                        Learn more
                    </TextLink>
                    .
                </p>
            </div>
            {/* "Essential only" and "Accept all" carry equal visual weight — the GDPR-parity
                the component promises. Only "Customize" steps back a level. */}
            <div className="flex flex-col gap-1">
                <div className="grid grid-cols-2 gap-2">
                    <SecondaryButton fullWidth onClick={() => onDecide(false)}>
                        Essential only
                    </SecondaryButton>
                    <SecondaryButton fullWidth onClick={() => onDecide(true)}>
                        Accept all
                    </SecondaryButton>
                </div>
                <div className="self-start">
                    <TertiaryButton onClick={onCustomize}>Customize</TertiaryButton>
                </div>
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
            subtitle="Choose what Solkey may use. You can change this any time via ‘Cookie settings’ in the footer."
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
                <ConsentCategory header={<CategoryTitle title="Anonymous statistics" status="Always on" />}>
                    Counts pages and features used, without cookies and without knowing who you are (PostHog, in the EU).
                </ConsentCategory>
                {/* Replay records whole sessions (inputs masked: lib/analytics.ts maskAllInputs) and links them and
                    the usage events to the account — the label and text say both, for an informed choice. The body
                    says "how you use Solkey" deliberately, not the plan's "what went wrong": consent copy must not
                    suggest replay only captures errors. */}
                <ConsentCategory
                    header={
                        // Semibold, like the two category titles above it.
                        <Switch checked={analytics} onChange={onAnalyticsChange} label="Screen replays to help us fix bugs" labelEmphasis />
                    }>
                    Lets us replay how you use Solkey on your screen (what you type stays hidden) and link it to your account, so we can fix
                    your issues faster. Uses one cookie. Off unless you turn it on.
                </ConsentCategory>
                <p className="font-body font-normal text-[12px] leading-normal text-on-surface-variant m-0">
                    Details in our{' '}
                    <TextLink as={Link} href="/privacy#cookies">
                        privacy policy
                    </TextLink>
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
