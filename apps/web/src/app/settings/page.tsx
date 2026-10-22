'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { type KeyboardEvent, useEffect, useLayoutEffect, useRef, useState } from 'react'

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
import { track } from '@/lib/analytics'
import { useSession } from '@/lib/auth-client'
import { downloadBlob } from '@/lib/FileDownload'
import { type PlanTier, requestedPlanFrom } from '@/lib/plans'
import { useAllRecordings, useExportAccountData, useRefreshBillingState, useScores, useSignOut, useUpdateProfile } from '@/lib/queries'
import { rovingIndexForKey } from '@/lib/useRadioGroup'

import { BillingSection } from './BillingSection'
import { ChangePasswordDialog } from './ChangePasswordDialog'
import { DeleteAccountDialog } from './DeleteAccountDialog'
import { SettingsSection } from './SettingsSection'
import { DEFAULT_SETTINGS_TAB, type SettingsTab, settingsTabFrom, settingsTabPath } from './settingsTabs'

export default function SettingsPage() {
    const router = useRouter()
    const { data: session } = useSession()
    const refreshBillingState = useRefreshBillingState()
    const signOut = useSignOut()
    const [tab, setTab] = useState<SettingsTab>(DEFAULT_SETTINGS_TAB)

    const [name, setName] = useState(session?.user?.name ?? '')
    const updateProfile = useUpdateProfile()
    const [changePwOpen, setChangePwOpen] = useState(false)
    const [deleteOpen, setDeleteOpen] = useState(false)

    // The session usually resolves after first render — sync the form once it does.
    const sessionName = session?.user?.name
    useEffect(() => {
        if (sessionName !== undefined) setName(sessionName)
    }, [sessionName])

    // Save only does something once the name has changed: the trimmed name differs from the
    // one on file (the session's, or the last one saved here) and isn't empty.
    const [savedName, setSavedName] = useState<string | null>(null)
    const trimmedName = name.trim()
    const canSaveProfile = !updateProfile.isPending && trimmedName !== '' && trimmedName !== (savedName ?? sessionName ?? '').trim()
    function handleSaveProfile() {
        if (!canSaveProfile) return
        updateProfile.mutate(trimmedName, {
            onSuccess: () => {
                setSavedName(trimmedName)
                showToast('Profile updated.', 'info')
            },
        })
    }

    // What the URL asked the plan tab to open: a tier's plan dialog (?plan=, a pricing card or an
    // upgrade button) or the minute packs (?packs=1). Dropped on the first tab switch, so coming
    // back to the plan tab doesn't reopen them.
    const [requestedPlan, setRequestedPlan] = useState<PlanTier['id'] | null>(null)
    const [requestedPacks, setRequestedPacks] = useState(false)
    // The tab lives in the URL (?tab=, the default tab at the bare /settings), so a reload and
    // Back keep it; replaceState, because a tab switch isn't a page of its own in history.
    const switchTab = (next: SettingsTab) => {
        setTab(next)
        setRequestedPlan(null)
        setRequestedPacks(false)
        window.history.replaceState(null, '', settingsTabPath(next))
    }

    // Land on the tab the URL names. A layout effect, so a deep link never paints the default tab
    // first. Upgrade links, the packs link and the return from a Polar checkout all land on the
    // plan tab, their one-shot parameters swapped for ?tab=plan.
    useLayoutEffect(() => {
        const search = window.location.search
        const params = new URLSearchParams(search)
        const plan = requestedPlanFrom(search)
        const landOnPlanTab = () => {
            setTab('plan')
            window.history.replaceState(null, '', settingsTabPath('plan'))
        }
        if (plan) {
            landOnPlanTab()
            setRequestedPlan(plan)
        } else if (params.get('checkout') === 'success') {
            landOnPlanTab()
            showToast("Payment confirmed — you're on your new plan now.", 'info')
        } else if (params.get('pack') === 'success') {
            landOnPlanTab()
            // The minutes land via the Polar webhook, usually within seconds —
            // refresh the balance once it has had a moment to arrive.
            showToast('Payment confirmed — your minutes will show up in a moment.', 'info')
            const timer = setTimeout(() => void refreshBillingState(), 4000)
            return () => clearTimeout(timer)
        } else if (params.get('packs') === '1') {
            landOnPlanTab()
            setRequestedPacks(true)
        } else {
            const named = settingsTabFrom(search)
            if (named) setTab(named)
        }
    }, [refreshBillingState])

    const exportData = useExportAccountData()
    /** GDPR portability: every score (MusicXML + JSON), profile and settings, zipped in the browser. */
    function handleExport() {
        const user = session?.user
        if (!user || exportData.isPending) return
        const profile = {
            name: user.name,
            email: user.email,
            createdAt: user.createdAt ? new Date(user.createdAt).toISOString() : undefined,
        }
        // mutateAsync rather than mutate's onSuccess, which is skipped once this page
        // unmounts: the download must still land if the user leaves Settings while the
        // archive builds. A failure has already toasted through the mutation's meta.
        exportData.mutateAsync(profile).then(
            (archive) => {
                downloadBlob(archive.toBlob(), archive.filename)
                track('data_export_downloaded', { scores: archive.scores.length })
                showToast(
                    `Your data is downloading (${archive.scores.length} ${archive.scores.length === 1 ? 'score' : 'scores'}).`,
                    'info',
                )
            },
            () => undefined,
        )
    }

    return (
        <div className="bg-surface text-on-surface min-h-dvh flex flex-col">
            {/* ?new=1 has the library open its new-score dialog. */}
            <TopNav user={session?.user?.name ?? undefined} onCreate={() => router.push('/scores?new=1')} />

            <main className="flex-1 max-w-5xl mx-auto px-4 sm:px-8 py-6 sm:py-10 flex flex-col gap-6 sm:gap-8 w-full box-border">
                <PageHeader title="Settings" subtitle="Tweak your profile and account." />

                <div className="grid grid-cols-1 md:grid-cols-[220px_1fr] gap-4 md:gap-8 items-start">
                    <SettingsTabs tab={tab} onTab={switchTab} />
                    <div role="tabpanel" id={panelId(tab)} aria-labelledby={tabId(tab)} className="flex flex-col gap-4 min-w-0">
                        {tab === 'profile' && (
                            <>
                                <SettingsSection title="Profile" subtitle="How you appear across Solkey.">
                                    <div className="flex items-center gap-4">
                                        <Avatar name={name || 'You'} size="lg" />
                                    </div>
                                    <TextField
                                        label="Your name"
                                        value={name}
                                        onChange={setName}
                                        autoComplete="name"
                                        enterKeyHint="done"
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') handleSaveProfile()
                                        }}
                                    />
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
                                        <PrimaryButton onClick={handleSaveProfile} disabled={!canSaveProfile}>
                                            {updateProfile.isPending ? 'Saving…' : 'Save changes'}
                                        </PrimaryButton>
                                    </div>
                                </SettingsSection>
                                <SettingsSection title="Password" subtitle="Update the password you use to sign in.">
                                    <div>
                                        <SecondaryButton onClick={() => setChangePwOpen(true)}>Change password</SecondaryButton>
                                    </div>
                                </SettingsSection>
                            </>
                        )}

                        {tab === 'plan' && <BillingSection requestedPlan={requestedPlan} requestedPacks={requestedPacks} />}

                        {tab === 'recordings' && <RecordingsSection />}

                        {tab === 'account' && (
                            <>
                                <SettingsSection
                                    title="Your data"
                                    subtitle="Download everything Solkey holds for you: your profile, your settings and every score, in files other music apps can open.">
                                    <div>
                                        <SecondaryButton onClick={handleExport} disabled={exportData.isPending}>
                                            {exportData.isPending ? 'Preparing your download…' : 'Download my data'}
                                        </SecondaryButton>
                                    </div>
                                </SettingsSection>
                                <SettingsSection title="Support" subtitle="Stuck, found a bug, or want to say hi? We read everything.">
                                    <div className="flex items-center gap-4 flex-wrap">
                                        <a
                                            href="mailto:support@solkey.io"
                                            className="inline-flex items-center gap-2 font-body font-medium text-[14px] text-primary no-underline">
                                            <Icon name="mail" size={16} />
                                            support@solkey.io
                                        </a>
                                        <Link
                                            href="/contact"
                                            className="font-body font-normal text-[13px] text-on-surface-variant underline">
                                            All contact options
                                        </Link>
                                    </div>
                                </SettingsSection>
                                <SettingsSection
                                    title="Sign out"
                                    subtitle="Sign out of Solkey on this browser."
                                    action={<TertiaryButton onClick={() => void signOut('/login')}>Sign out</TertiaryButton>}
                                />
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

            {changePwOpen && <ChangePasswordDialog onClose={() => setChangePwOpen(false)} />}

            {deleteOpen && (
                <DeleteAccountDialog
                    email={session?.user?.email}
                    onExport={handleExport}
                    exporting={exportData.isPending}
                    onCancel={() => setDeleteOpen(false)}
                    onConfirm={() => {
                        setDeleteOpen(false)
                        void signOut('/login')
                    }}
                />
            )}
        </div>
    )
}

/**
 * Every recording the account holds, across scores, with replay and delete, always
 * listed. The export leaves audio out (it is deleted with the account), so this is
 * where it can be heard and removed one by one.
 */
function RecordingsSection() {
    const takes = useAllRecordings()
    const scores = useScores()
    // Score names link to their score; without the score list (it failed) rows just skip the name
    // rather than calling every score deleted.
    const titles = scores.data && new Map(scores.data.map((score) => [score.id, score.title]))

    return (
        <SettingsSection
            title="Recordings"
            subtitle="Every recording you make is kept here, audio included, so you can listen back. ‘Download my data’ covers your scores, not the audio.">
            {takes.isPending || scores.isPending ? (
                <div className="h-12 bg-surface-container-low rounded-md animate-pulse" />
            ) : takes.isError ? (
                <Alert onRetry={() => void takes.refetch()}>Couldn&apos;t load your recordings.</Alert>
            ) : takes.data.length === 0 ? (
                <p className="font-body font-normal text-[13px] leading-normal text-on-surface-variant m-0">
                    No recordings yet — press record in any score and your recordings show up here.
                </p>
            ) : (
                <TakesList
                    takes={takes.data}
                    scroll={false}
                    scoreTitleFor={titles ? (take) => titles.get(take.scoreId) ?? null : undefined}
                />
            )}
        </SettingsSection>
    )
}

const TABS: readonly { readonly id: SettingsTab; readonly label: string; readonly icon: IconName }[] = [
    { id: 'profile', label: 'Profile', icon: 'user' },
    { id: 'plan', label: 'Plan', icon: 'credit-card' },
    { id: 'recordings', label: 'Recordings', icon: 'audio-lines' },
    { id: 'account', label: 'Account', icon: 'shield' },
]

const tabId = (tab: SettingsTab) => `settings-tab-${tab}`
const panelId = (tab: SettingsTab) => `settings-panel-${tab}`

/**
 * The settings tabs: a side rail on desktop, a row of labels on phones (no icons, so all four
 * fit at 360px). The current tab pairs its fill with a shape — a 4px cyan stripe on the rail,
 * the 3px cyan underline on the row — and is aria-selected. Arrow keys, Home and End move
 * between tabs (the ARIA tabs pattern, activating as they go); only the current tab is in
 * the Tab order. Only the current tab's panel is rendered, so only that tab names it in
 * aria-controls — the others would point at an id that isn't in the page.
 */
function SettingsTabs({ tab, onTab }: { tab: SettingsTab; onTab: (t: SettingsTab) => void }) {
    const refs = useRef<(HTMLButtonElement | null)[]>([])

    const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
        const target = rovingIndexForKey(e, index, TABS.length)
        if (target === null) return
        e.preventDefault()
        onTab(TABS[target].id)
        refs.current[target]?.focus()
    }

    return (
        <div
            role="tablist"
            aria-label="Settings"
            className="flex flex-row flex-wrap gap-x-5 gap-y-1 md:flex-col md:gap-1 md:sticky md:top-24">
            {TABS.map(({ id, label, icon }, index) => {
                const active = tab === id
                return (
                    <button
                        key={id}
                        ref={(el) => {
                            refs.current[index] = el
                        }}
                        type="button"
                        role="tab"
                        id={tabId(id)}
                        aria-selected={active}
                        aria-controls={active ? panelId(id) : undefined}
                        tabIndex={active ? 0 : -1}
                        onClick={() => onTab(id)}
                        onKeyDown={(e) => onKeyDown(e, index)}
                        className={[
                            'relative border-0 cursor-pointer text-left',
                            'flex items-center justify-center md:justify-start gap-2.5',
                            'font-body font-medium text-[14px] leading-none',
                            'transition-colors duration-150 ease-solkey',
                            'focus-ring',
                            // Phones: a bare label over the 3px underline, 41px tall with it.
                            'max-md:bg-transparent max-md:px-1 max-md:py-3 max-md:min-w-10 max-md:border-b-[3px]',
                            // Desktop: a rail item; the current one carries the 4px stripe at its left edge.
                            'md:rounded-md md:px-3.5 md:py-2.5',
                            active
                                ? 'text-on-surface max-md:border-primary-container md:bg-surface-container md:before:absolute md:before:left-0 md:before:inset-y-1.5 md:before:w-1 md:before:rounded-r-sm md:before:bg-primary-container md:before:content-[""]'
                                : 'text-on-surface-variant hover:text-on-surface max-md:border-transparent md:bg-transparent',
                        ].join(' ')}>
                        <span className="max-md:hidden inline-flex">
                            <Icon name={icon} size={16} />
                        </span>
                        {label}
                    </button>
                )
            })}
        </div>
    )
}
