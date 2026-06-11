'use client'

import { useRouter } from 'next/navigation'
import { type ReactNode, useState } from 'react'

import {
    Eyebrow,
    Footer,
    Icon,
    PageHeader,
    PrimaryButton,
    SecondaryButton,
    Switch,
    TertiaryButton,
    TextArea,
    TextField,
    TopNav,
} from '@/components/ui'
import { signOut, useSession } from '@/lib/auth-client'

import { ChangePasswordDialog } from './ChangePasswordDialog'
import { type Billing, ChangePlanDialog, PLAN_TIERS, type PlanTier } from './ChangePlanDialog'
import { DeleteAccountDialog } from './DeleteAccountDialog'

// Settings is visual + light wiring. signOut and password change hit the real
// backend; billing/plan flows remain visual demos until those endpoints exist.

type Tab = 'profile' | 'editor' | 'notifications' | 'account'

export default function SettingsPage() {
    const router = useRouter()
    const { data: session } = useSession()
    const [tab, setTab] = useState<Tab>('profile')

    const [name, setName] = useState(session?.user?.name ?? '')
    const [email, setEmail] = useState(session?.user?.email ?? '')
    const [bio, setBio] = useState('')
    const [autosave, setAutosave] = useState(true)
    const [metronome, setMetronome] = useState(false)
    const [defaultBpm, setDefaultBpm] = useState(120)
    const [emails, setEmails] = useState(true)
    const [tips, setTips] = useState(true)
    const [changePwOpen, setChangePwOpen] = useState(false)
    const [changePlanOpen, setChangePlanOpen] = useState(false)
    const [deleteOpen, setDeleteOpen] = useState(false)
    const [planId, setPlanId] = useState<PlanTier['id']>('free')
    const [billing, setBilling] = useState<Billing>('monthly')

    const currentPlan = PLAN_TIERS.find((p) => p.id === planId) ?? PLAN_TIERS[0]
    const currentPlanPrice =
        currentPlan.priceMonthly === 0
            ? 'Free'
            : billing === 'yearly'
              ? `$${currentPlan.priceYearly}/yr`
              : `$${currentPlan.priceMonthly}/mo`

    async function handleSignOut() {
        await signOut()
        router.push('/login')
    }

    return (
        <div className="bg-surface text-on-surface min-h-screen flex flex-col">
            <TopNav user={session?.user?.name ?? undefined} onCreate={() => router.push('/scores')} />

            <main className="flex-1 max-w-5xl mx-auto px-8 py-10 flex flex-col gap-8 w-full box-border">
                <PageHeader title="Settings" subtitle="Tweak your profile, defaults, and account." />

                <div className="grid grid-cols-[220px_1fr] gap-8 items-start">
                    <SideNav tab={tab} onTab={setTab} />
                    <div className="flex flex-col gap-4">
                        {tab === 'profile' && (
                            <Section title="Profile" subtitle="What collaborators see when you share a score.">
                                <div className="flex items-center gap-4">
                                    <Avatar name={name || 'You'} />
                                    <SecondaryButton>Change photo</SecondaryButton>
                                </div>
                                <TextField label="Display name" value={name} onChange={setName} />
                                <TextField label="Email" value={email} onChange={setEmail} type="email" />
                                <TextArea label="Short bio" value={bio} onChange={setBio} rows={3} />
                                <div className="flex justify-end">
                                    <PrimaryButton emphasis="pop">Save changes</PrimaryButton>
                                </div>
                            </Section>
                        )}

                        {tab === 'editor' && (
                            <Section title="Editor defaults" subtitle="Applied to every new score you create.">
                                <Switch checked={autosave} onChange={setAutosave} label="Autosave changes as I edit" />
                                <Switch checked={metronome} onChange={setMetronome} label="Show metronome by default" />
                                <div className="flex flex-col gap-2">
                                    <Eyebrow>Default tempo</Eyebrow>
                                    <div className="flex gap-1.5">
                                        {[60, 90, 120, 144].map((bpm) => {
                                            const active = defaultBpm === bpm
                                            return (
                                                <button
                                                    key={bpm}
                                                    type="button"
                                                    onClick={() => setDefaultBpm(bpm)}
                                                    className={[
                                                        'border-0 rounded-sm px-4 py-2 cursor-pointer',
                                                        'font-mono font-medium text-[14px] leading-none',
                                                        active
                                                            ? 'bg-primary-container text-on-primary-container'
                                                            : 'bg-surface-container-low text-on-surface',
                                                    ].join(' ')}>
                                                    {bpm} bpm
                                                </button>
                                            )
                                        })}
                                    </div>
                                </div>
                            </Section>
                        )}

                        {tab === 'notifications' && (
                            <Section title="Notifications" subtitle="We keep these light. Promise.">
                                <Switch checked={emails} onChange={setEmails} label="Product updates by email" />
                                <Switch checked={tips} onChange={setTips} label="Occasional composition tips" />
                            </Section>
                        )}

                        {tab === 'account' && (
                            <>
                                {/* Plan + billing UI is wired but the Polar handshake is mocked until the backend exists. */}
                                <Section title="Plan & billing" subtitle={`You're on the ${currentPlan.name} plan.`}>
                                    <div className="flex items-center gap-4 p-4 bg-surface-container-low rounded-[10px]">
                                        <span className="w-11 h-11 rounded-full bg-primary-container text-on-primary-container inline-flex items-center justify-center">
                                            <Icon name={currentPlan.icon} size={20} />
                                        </span>
                                        <div className="flex flex-col gap-0.5 flex-1">
                                            <span className="font-body font-semibold text-[15px] leading-[1.3] text-on-surface">
                                                {currentPlan.name}
                                            </span>
                                            <span className="font-body font-normal text-[13px] leading-[1.4] text-on-surface-variant">
                                                {currentPlanPrice}
                                            </span>
                                        </div>
                                        <PrimaryButton emphasis="pop" onClick={() => setChangePlanOpen(true)}>
                                            Change plan
                                        </PrimaryButton>
                                    </div>
                                </Section>
                                <Section title="Password" subtitle="Last changed a while ago.">
                                    <div>
                                        <SecondaryButton onClick={() => setChangePwOpen(true)}>Change password</SecondaryButton>
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

            {changePlanOpen && (
                <ChangePlanDialog
                    currentPlanId={planId}
                    currentBilling={billing}
                    onCancel={() => setChangePlanOpen(false)}
                    onChanged={({ planId: nextId, billing: nextBilling }) => {
                        setPlanId(nextId)
                        setBilling(nextBilling)
                        setChangePlanOpen(false)
                    }}
                />
            )}

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

function SideNav({ tab, onTab }: { tab: Tab; onTab: (t: Tab) => void }) {
    const items: [Tab, string, string][] = [
        ['profile', 'Profile', 'user'],
        ['editor', 'Editor defaults', 'sliders-horizontal'],
        ['notifications', 'Notifications', 'bell'],
        ['account', 'Account', 'shield'],
    ]
    return (
        <nav className="flex flex-col gap-1 sticky top-24">
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
                            active ? 'bg-surface-container text-on-surface' : 'bg-transparent text-on-surface-variant',
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
        <section className="bg-surface-container-lowest rounded-lg editorial-shadow p-7 flex flex-col gap-5">
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
