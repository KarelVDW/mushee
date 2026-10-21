'use client'

import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

import { TakesList } from '@/components/TakesList'
import {
    Alert,
    Avatar,
    Eyebrow,
    Footer,
    Icon,
    type IconName,
    PageHeader,
    PrimaryButton,
    SecondaryButton,
    showToast,
    TertiaryButton,
    TextField,
    TopNav,
} from '@/components/ui'
import { AccountExport } from '@/lib/AccountExport'
import { track } from '@/lib/analytics'
import { signOut, updateUser, useSession } from '@/lib/auth-client'
import { downloadBlob } from '@/lib/FileDownload'
import { type PlanTier, requestedPlanFrom } from '@/lib/plans'
import { billingKeys, useAllRecordings, useScores } from '@/lib/queries'

import { BillingSection } from './BillingSection'
import { ChangePasswordDialog } from './ChangePasswordDialog'
import { DeleteAccountDialog } from './DeleteAccountDialog'
import { SettingsSection } from './SettingsSection'

type Tab = 'profile' | 'account'

export default function SettingsPage() {
    const router = useRouter()
    const { data: session } = useSession()
    const queryClient = useQueryClient()
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

    // The tier a signed-in visitor's pricing card asked for (?plan=): BillingSection opens its plan dialog.
    const [requestedPlan, setRequestedPlan] = useState<PlanTier['id'] | null>(null)

    // Coming back from a successful Polar checkout, or from a pricing card: land on the account tab.
    useEffect(() => {
        const params = new URLSearchParams(window.location.search)
        const plan = requestedPlanFrom(window.location.search)
        if (plan) {
            setTab('account')
            setRequestedPlan(plan)
            window.history.replaceState(null, '', '/settings')
        } else if (params.get('checkout') === 'success') {
            setTab('account')
            showToast('Payment confirmed — welcome to your new plan!', 'info')
            window.history.replaceState(null, '', '/settings')
        } else if (params.get('pack') === 'success') {
            setTab('account')
            // The minutes land via the Polar webhook, usually within seconds —
            // refresh the balance once it has had a moment to arrive.
            showToast('Payment confirmed — your minutes are on their way!', 'info')
            window.history.replaceState(null, '', '/settings')
            const timer = setTimeout(() => void queryClient.invalidateQueries({ queryKey: billingKeys.subscription }), 4000)
            return () => clearTimeout(timer)
        }
    }, [queryClient])

    async function handleSignOut() {
        await signOut()
        router.push('/login')
    }

    const [exporting, setExporting] = useState(false)
    /** GDPR portability: every score (MusicXML + JSON), profile and settings, zipped in the browser. */
    async function handleExport() {
        const user = session?.user
        if (!user) return
        setExporting(true)
        try {
            const archive = await AccountExport.collect({
                name: user.name,
                email: user.email,
                createdAt: user.createdAt ? new Date(user.createdAt).toISOString() : undefined,
            })
            downloadBlob(archive.toBlob(), archive.filename)
            track('data_export_downloaded', { scores: archive.scores.length })
            showToast(`Your data is downloading (${archive.scores.length} ${archive.scores.length === 1 ? 'score' : 'scores'}).`, 'info')
        } catch {
            showToast("Your data couldn't be exported. Please try again.")
        } finally {
            setExporting(false)
        }
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
                            <SettingsSection title="Profile" subtitle="How you appear across Solkey.">
                                <div className="flex items-center gap-4">
                                    <Avatar name={name || 'You'} size="lg" />
                                </div>
                                <TextField label="Display name" value={name} onChange={setName} />
                                <div className="flex flex-col gap-1.5">
                                    <Eyebrow>Email</Eyebrow>
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
                            </SettingsSection>
                        )}

                        {tab === 'account' && (
                            <>
                                <BillingSection requestedPlan={requestedPlan} />
                                <SettingsSection title="Password" subtitle="Update the password you use to sign in.">
                                    <div>
                                        <SecondaryButton onClick={() => setChangePwOpen(true)}>Change password</SecondaryButton>
                                    </div>
                                </SettingsSection>
                                <SettingsSection title="Support" subtitle="Stuck, found a bug, or want to say hi? We read everything.">
                                    <div className="flex items-center gap-4">
                                        <a
                                            href="mailto:support@solkey.io"
                                            className="inline-flex items-center gap-2 font-body font-medium text-[14px] text-primary no-underline">
                                            <Icon name="mail" size={16} />
                                            support@solkey.io
                                        </a>
                                        <a href="/contact" className="font-body font-normal text-[13px] text-on-surface-variant underline">
                                            All contact options
                                        </a>
                                    </div>
                                </SettingsSection>
                                <SettingsSection title="Sign out" subtitle="Log out of this browser.">
                                    <div>
                                        <TertiaryButton onClick={() => void handleSignOut()}>Sign out</TertiaryButton>
                                    </div>
                                </SettingsSection>
                                <SettingsSection
                                    title="Your data"
                                    subtitle="Download everything Solkey holds for you: your profile, settings, and every score as MusicXML and JSON.">
                                    <div>
                                        <SecondaryButton onClick={() => void handleExport()} disabled={exporting}>
                                            {exporting ? 'Preparing your download…' : 'Download my data'}
                                        </SecondaryButton>
                                    </div>
                                    <RecordingsInventory />
                                </SettingsSection>
                                <SettingsSection
                                    title="Delete account"
                                    subtitle="Deactivates your account today; after 7 days everything is permanently deleted.">
                                    <div>
                                        <TertiaryButton danger onClick={() => setDeleteOpen(true)}>
                                            Delete my account
                                        </TertiaryButton>
                                    </div>
                                </SettingsSection>
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

/**
 * Every take the account holds, across scores, with replay and delete — the
 * recordings half of "your data": the export leaves audio out (it is deleted with
 * the account), so this is where it can be heard and removed one by one.
 */
function RecordingsInventory() {
    const takes = useAllRecordings()
    const scores = useScores()
    const [open, setOpen] = useState(false)
    const titles = new Map((scores.data ?? []).map((score) => [score.id, score.title]))

    if (takes.isPending) return <div className="h-6 w-48 bg-surface-container-low rounded-md animate-pulse" />
    if (takes.isError) return <Alert onRetry={() => void takes.refetch()}>Couldn&apos;t load your recordings.</Alert>
    const count = takes.data.length
    return (
        <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
                <span className="font-body font-normal text-[13px] leading-normal text-on-surface-variant">
                    {count === 0
                        ? 'No recordings kept yet — every take you record is archived here, audio included.'
                        : `${count} ${count === 1 ? 'recording' : 'recordings'} kept — listen back or delete them one by one. They are not part of the download.`}
                </span>
                {count > 0 && (
                    <TertiaryButton onClick={() => setOpen((o) => !o)}>{open ? 'Hide recordings' : 'Show recordings'}</TertiaryButton>
                )}
            </div>
            {open && count > 0 && (
                <TakesList takes={takes.data} scroll={false} subtitleFor={(take) => titles.get(take.scoreId) ?? 'Deleted score'} />
            )}
        </div>
    )
}

function SideNav({ tab, onTab }: { tab: Tab; onTab: (t: Tab) => void }) {
    const items: [Tab, string, IconName][] = [
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
                            'transition-colors duration-150 ease-solkey',
                            'focus-ring',
                            active
                                ? 'bg-surface-container text-on-surface'
                                : 'bg-transparent text-on-surface-variant hover:text-on-surface',
                        ].join(' ')}>
                        <Icon name={icon} size={16} />
                        {label}
                    </button>
                )
            })}
        </nav>
    )
}
