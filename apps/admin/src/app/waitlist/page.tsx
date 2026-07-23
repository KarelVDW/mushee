'use client'

import { AdminShell, PageHeading } from '@/components/AdminShell'
import { Alert, Pill, PrimaryButton, TertiaryButton } from '@/components/ui'
import type { BetaSignup } from '@/lib/api'
import { formatDate } from '@/lib/format'
import { useApproveBetaSignup, useBetaSignups, useRevokeBetaSignup } from '@/lib/queries'

export default function WaitlistPage() {
    const signups = useBetaSignups()
    const approve = useApproveBetaSignup()
    const revoke = useRevokeBetaSignup()

    const pending = signups.data?.filter((s) => s.status === 'pending') ?? []
    const approved = signups.data?.filter((s) => s.status === 'approved') ?? []

    return (
        <AdminShell>
            <PageHeading eyebrow="Closed beta" title="Waitlist">
                {signups.data && (
                    <span className="font-mono text-[13px] leading-none text-on-surface-variant">
                        {pending.length} waiting · {approved.length} approved
                    </span>
                )}
            </PageHeading>

            {signups.isError && <Alert onRetry={() => void signups.refetch()}>Couldn&apos;t load the waitlist.</Alert>}

            {signups.data && signups.data.length === 0 && (
                <p className="font-body text-[14px] text-on-surface-variant">Nobody has signed up through the beta flow yet.</p>
            )}

            {pending.length > 0 && (
                <SignupList
                    title="Waiting for approval"
                    signups={pending}
                    action={(signup) => (
                        <PrimaryButton onClick={() => approve.mutate(signup.id)} disabled={approve.isPending}>
                            Approve
                        </PrimaryButton>
                    )}
                />
            )}

            {approved.length > 0 && (
                <SignupList
                    title="Approved"
                    signups={approved}
                    action={(signup) => (
                        <TertiaryButton danger onClick={() => revoke.mutate(signup.id)}>
                            Revoke
                        </TertiaryButton>
                    )}
                />
            )}
        </AdminShell>
    )
}

function SignupList({
    title,
    signups,
    action,
}: {
    title: string
    signups: BetaSignup[]
    action: (signup: BetaSignup) => React.ReactNode
}) {
    return (
        <section className="bg-surface-container-lowest rounded-lg tonal-layer-glow px-5 py-4 mb-4">
            <div className="flex items-center gap-2.5 mb-3">
                <span className="font-label font-semibold text-[11px] leading-none tracking-[0.12em] uppercase text-on-surface-variant">
                    {title}
                </span>
                <Pill>{signups.length}</Pill>
            </div>
            <div className="flex flex-col">
                {signups.map((signup) => (
                    <div
                        key={signup.id}
                        className="grid grid-cols-[1fr_auto_auto] items-center gap-4 rounded-md px-3 py-2.5 -mx-3 hover:bg-surface-container-high transition-colors duration-150 ease-solkey">
                        <div className="min-w-0">
                            <span className="block font-body font-medium text-[14px] leading-tight text-on-surface truncate">
                                {signup.name || '—'}
                            </span>
                            <span className="block font-body text-[12px] leading-tight text-on-surface-variant truncate">
                                {signup.email}
                            </span>
                        </div>
                        <span className="font-body text-[12px] leading-none text-on-surface-variant">{formatDate(signup.createdAt)}</span>
                        {action(signup)}
                    </div>
                ))}
            </div>
        </section>
    )
}
