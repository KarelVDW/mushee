'use client'

import { useRouter } from 'next/navigation'
import { type ReactNode, useEffect, useState } from 'react'

import {
    Alert,
    Footer,
    Icon,
    PageHeader,
    PrimaryButton,
    SecondaryButton,
    showToast,
    TertiaryButton,
    TextField,
    TopNav,
} from '@/components/ui'
import { signOut, updateUser, useSession } from '@/lib/auth-client'
import { BETA_PLAN, planById, planPrice } from '@/lib/plans'
import { useBillingPortal, useBillingState, useResumeSubscription } from '@/lib/queries'

import { ChangePasswordDialog } from './ChangePasswordDialog'
import { ChangePlanDialog } from './ChangePlanDialog'
import { DeleteAccountDialog } from './DeleteAccountDialog'

type Tab = 'profile' | 'account'

export default function SettingsPage() {
    const router = useRouter()
    const { data: session } = useSession()
    const [tab, setTab] = useState<Tab>('profile')

    const [name, setName] = useState(session?.user?.name ?? '')
    const [saving, setSaving] = useState(false)
    const [changePwOpen, setChangePwOpen] = useState(false)
    const [deleteOpen, setDeleteOpen] = useState(false)

    // The session usually resolves after first render — sync the form once it does.
    const sessionName = session?.user?.name
    useEffect(() => {
        if (sessionName !== undefined) setName(sessionName)
    }, [sessionName])

    async function handleSaveProfile() {
        setSaving(true)
        try {
            const { error } = await updateUser({ name: name.trim() })
            if (error) throw new Error(error.message ?? 'Update failed')
            showToast('Profile updated.', 'info')
        } catch {
            showToast("Your profile couldn't be saved. Please try again.")
        } finally {
            setSaving(false)
        }
    }

    // Coming back from a successful Polar checkout: land on the account tab.
    useEffect(() => {
        if (new URLSearchParams(window.location.search).get('checkout') === 'success') {
            setTab('account')
            showToast('Payment confirmed — welcome to your new plan!', 'info')
            window.history.replaceState(null, '', '/settings')
        }
    }, [])

    async function handleSignOut() {
        await signOut()
        router.push('/login')
    }

    return (
        <div className="bg-surface text-on-surface min-h-dvh flex flex-col">
            <TopNav user={session?.user?.name ?? undefined} onCreate={() => router.push('/scores')} />

            <main className="flex-1 max-w-5xl mx-auto px-4 sm:px-8 py-6 sm:py-10 flex flex-col gap-6 sm:gap-8 w-full box-border">
                <PageHeader title="Settings" subtitle="Tweak your profile and account." />

                <div className="grid grid-cols-1 md:grid-cols-[220px_1fr] gap-4 md:gap-8 items-start">
                    <SideNav tab={tab} onTab={setTab} />
                    <div className="flex flex-col gap-4">
                        {tab === 'profile' && (
                            <Section title="Profile" subtitle="How you appear across Sheemu.">
                                <div className="flex items-center gap-4">
                                    <Avatar name={name || 'You'} />
                                </div>
                                <TextField label="Display name" value={name} onChange={setName} />
                                <div className="flex flex-col gap-1.5">
                                    <span className="font-label font-semibold text-[11px] leading-none tracking-[0.12em] uppercase text-on-surface-variant">
                                        Email
                                    </span>
                                    <span className="font-body font-normal text-[14px] leading-none text-on-surface py-1">
                                        {session?.user?.email ?? '—'}
                                    </span>
                                    <span className="font-body font-normal text-[12px] leading-[1.4] text-on-surface-variant">
                                        Your sign-in email. Contact support to change it.
                                    </span>
                                </div>
                                <div className="flex justify-end">
                                    <PrimaryButton onClick={() => void handleSaveProfile()} disabled={saving || !name.trim()}>
                                        {saving ? 'Saving…' : 'Save changes'}
                                    </PrimaryButton>
                                </div>
                            </Section>
                        )}

                        {tab === 'account' && (
                            <>
                                <BillingSection />
                                <Section title="Password" subtitle="Update the password you use to sign in.">
                                    <div>
                                        <SecondaryButton onClick={() => setChangePwOpen(true)}>Change password</SecondaryButton>
                                    </div>
                                </Section>
                                <Section
                                    title="Support"
                                    subtitle="Stuck, found a bug, or want to say hi? We read everything.">
                                    <div className="flex items-center gap-4">
                                        <a
                                            href="mailto:support@sheemu.com"
                                            className="inline-flex items-center gap-2 font-body font-medium text-[14px] text-primary no-underline">
                                            <Icon name="mail" size={16} />
                                            support@sheemu.com
                                        </a>
                                        <a
                                            href="/contact"
                                            className="font-body font-normal text-[13px] text-on-surface-variant underline">
                                            All contact options
                                        </a>
                                    </div>
                                </Section>
                                <Section title="Sign out" subtitle="Log out of this browser.">
                                    <div>
                                        <TertiaryButton onClick={() => void handleSignOut()}>Sign out</TertiaryButton>
                                    </div>
                                </Section>
                                <Section
                                    title="Delete account"
                                    subtitle="Deactivates your account today; after 7 days everything is permanently deleted.">
                                    <div>
                                        <TertiaryButton danger onClick={() => setDeleteOpen(true)}>
                                            Delete my account
                                        </TertiaryButton>
                                    </div>
                                </Section>
                            </>
                        )}
                    </div>
                </div>
            </main>

            <Footer />

            {changePwOpen && <ChangePasswordDialog onCancel={() => setChangePwOpen(false)} onSuccess={() => setChangePwOpen(false)} />}

            {deleteOpen && (
                <DeleteAccountDialog
                    email={session?.user?.email}
                    onCancel={() => setDeleteOpen(false)}
                    onConfirm={() => {
                        setDeleteOpen(false)
                        void handleSignOut()
                    }}
                />
            )}
        </div>
    )
}

/** Live Polar-backed subscription state: plan, renewal, credits, actions. */
function BillingSection() {
    const { data: billing, isPending, isError, refetch } = useBillingState()
    const portal = useBillingPortal()
    const resume = useResumeSubscription()
    const [changePlanOpen, setChangePlanOpen] = useState(false)

    if (isPending) {
        return (
            <Section title="Plan & billing" subtitle="Loading your subscription…">
                <div className="h-20 bg-surface-container-low rounded-md animate-pulse" />
            </Section>
        )
    }
    if (isError || !billing) {
        return (
            <Section title="Plan & billing">
                <Alert onRetry={() => void refetch()}>Couldn&apos;t load your subscription.</Alert>
            </Section>
        )
    }

    const isBeta = billing.tierId === 'beta'
    const plan = planById(billing.tierId)
    const hasSubscription = Boolean(billing.status)
    const periodEnd = billing.currentPeriodEnd
        ? new Date(billing.currentPeriodEnd).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })
        : null

    const priceLine = isBeta
        ? 'Free during the beta'
        : hasSubscription
          ? `${planPrice(plan, billing.interval ?? 'monthly')}${
                periodEnd ? (billing.cancelAtPeriodEnd ? ` · ends ${periodEnd}` : ` · renews ${periodEnd}`) : ''
            }`
          : 'Free'

    return (
        <Section
            title="Plan & billing"
            subtitle={
                isBeta
                    ? 'Sheemu is in closed beta — your plan is on the house. Paid plans arrive at launch.'
                    : `You're on the ${billing.tierName} plan. Payments are handled securely by Polar.`
            }>
            <div className="flex items-center gap-4 p-4 bg-surface-container-low rounded-md">
                <span className="w-11 h-11 rounded-full bg-primary-soft text-on-primary-soft inline-flex items-center justify-center">
                    <Icon name={isBeta ? BETA_PLAN.icon : plan.icon} size={20} />
                </span>
                <div className="flex flex-col gap-0.5 flex-1">
                    <span className="font-body font-semibold text-[15px] leading-[1.3] text-on-surface">{billing.tierName}</span>
                    <span className="font-body font-normal text-[13px] leading-[1.4] text-on-surface-variant">{priceLine}</span>
                </div>
                {!isBeta && billing.billingConfigured && !billing.betaMode && (
                    <PrimaryButton onClick={() => setChangePlanOpen(true)}>Change plan</PrimaryButton>
                )}
            </div>

            <CreditsMeter limit={billing.credits.limitSeconds} used={billing.credits.usedSeconds} />

            {(hasSubscription || billing.cancelAtPeriodEnd) && (
                <div className="flex items-center gap-3 flex-wrap">
                    {billing.cancelAtPeriodEnd && (
                        <SecondaryButton onClick={() => resume.mutate()} disabled={resume.isPending}>
                            Resume subscription
                        </SecondaryButton>
                    )}
                    <TertiaryButton onClick={() => portal.mutate()}>
                        {portal.isPending ? 'Opening billing portal…' : 'Invoices & payment method'}
                    </TertiaryButton>
                </div>
            )}

            {!isBeta && !billing.billingConfigured && (
                <p className="font-body font-normal text-[12px] leading-normal text-on-surface-variant m-0">
                    Billing isn&apos;t configured in this environment, so plan changes are disabled.
                </p>
            )}

            {changePlanOpen && <ChangePlanDialog billing={billing} onClose={() => setChangePlanOpen(false)} />}
        </Section>
    )
}

/** Today's recording budget as a small meter (resets at midnight UTC). */
function CreditsMeter({ limit, used }: { limit: number | null; used: number }) {
    const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`
    if (limit === null) {
        return (
            <div className="flex items-center gap-2 font-body font-normal text-[13px] text-on-surface-variant">
                <Icon name="infinity" size={16} />
                Unlimited recording — {fmt(used)} used today.
            </div>
        )
    }
    const pct = Math.min(100, (used / limit) * 100)
    return (
        <div className="flex flex-col gap-1.5">
            <div className="flex justify-between font-body font-normal text-[12px] leading-none text-on-surface-variant">
                <span>Recording today</span>
                <span className="font-mono">
                    {fmt(used)} / {fmt(limit)}
                </span>
            </div>
            <div className="h-1.5 rounded-full bg-surface-container overflow-hidden" role="progressbar" aria-valuenow={Math.round(pct)}>
                <div
                    className={pct >= 100 ? 'h-full bg-error-container' : 'h-full bg-primary-container'}
                    style={{ width: `${pct}%` }}
                />
            </div>
        </div>
    )
}

function SideNav({ tab, onTab }: { tab: Tab; onTab: (t: Tab) => void }) {
    const items: [Tab, string, string][] = [
        ['profile', 'Profile', 'user'],
        ['account', 'Account', 'shield'],
    ]
    return (
        <nav className="flex flex-row md:flex-col gap-1 md:sticky md:top-24">
            {items.map(([k, label, icon]) => {
                const active = tab === k
                return (
                    <button
                        key={k}
                        type="button"
                        onClick={() => onTab(k)}
                        className={[
                            'border-0 rounded-md px-3.5 py-2.5 text-left cursor-pointer',
                            'flex items-center gap-2.5',
                            'font-body font-medium text-[14px] leading-none',
                            'transition-colors duration-150 ease-sheemu',
                            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
                            active ? 'bg-surface-container text-on-surface' : 'bg-transparent text-on-surface-variant hover:text-on-surface',
                        ].join(' ')}>
                        <Icon name={icon} size={16} />
                        {label}
                    </button>
                )
            })}
        </nav>
    )
}

function Section({ title, subtitle, children }: { title: ReactNode; subtitle?: ReactNode; children: ReactNode }) {
    return (
        <section className="bg-surface-container-lowest rounded-lg tonal-layer-glow p-7 flex flex-col gap-5">
            <div className="flex flex-col gap-1">
                <h3 className="font-headline font-semibold text-[18px] leading-[1.2] text-on-surface m-0">{title}</h3>
                {subtitle && <span className="font-body font-normal text-[13px] leading-normal text-on-surface-variant">{subtitle}</span>}
            </div>
            {children}
        </section>
    )
}

function Avatar({ name }: { name: string }) {
    const initials = name
        .split(' ')
        .map((s) => s[0])
        .join('')
        .slice(0, 2)
        .toUpperCase()
    return (
        <div className="w-16 h-16 rounded-full bg-secondary-soft text-on-secondary-soft inline-flex items-center justify-center font-label font-semibold text-[22px] leading-none">
            {initials}
        </div>
    )
}
