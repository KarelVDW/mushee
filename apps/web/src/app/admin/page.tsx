'use client'

import { useRouter } from 'next/navigation'

import { Alert, ErrorScreen, Footer, PageHeader, Pill, PrimaryButton, TertiaryButton, TopNav } from '@/components/ui'
import { useSession } from '@/lib/auth-client'
import { useApproveBetaSignup, useBetaSignups, useRevokeBetaSignup } from '@/lib/queries'

/** Admin panel: review, approve, and revoke closed-beta signups. */
export default function AdminPage() {
    const router = useRouter()
    const { data: session, isPending: sessionPending } = useSession()
    const signups = useBetaSignups()
    const approve = useApproveBetaSignup()
    const revoke = useRevokeBetaSignup()

    const role = (session?.user as { role?: string } | undefined)?.role
    if (!sessionPending && session?.user && role !== 'admin') {
        return (
            <ErrorScreen
                title="Admin access required"
                message="This page is reserved for administrators."
                onBack={() => router.push('/scores')}
                backLabel="Back to my library"
            />
        )
    }

    const pending = signups.data?.filter((s) => s.status === 'pending') ?? []
    const approved = signups.data?.filter((s) => s.status === 'approved') ?? []

    return (
        <div className="bg-surface text-on-surface min-h-screen flex flex-col">
            <TopNav user={session?.user?.name ?? undefined} />

            <main className="flex-1 max-w-5xl mx-auto px-8 py-10 flex flex-col gap-8 w-full box-border">
                <PageHeader
                    title="Beta signups"
                    subtitle={
                        signups.data
                            ? `${pending.length} waiting for approval · ${approved.length} approved`
                            : 'Approve who gets into the closed beta.'
                    }
                />

                {signups.isError && <Alert onRetry={() => void signups.refetch()}>Couldn&apos;t load the signup list.</Alert>}

                {signups.data && signups.data.length === 0 && (
                    <p className="font-body font-normal text-[14px] text-on-surface-variant">
                        No beta signups yet. They&apos;ll show up here the moment someone registers.
                    </p>
                )}

                {signups.data && signups.data.length > 0 && (
                    <div className="bg-surface-container-lowest rounded-lg editorial-shadow overflow-hidden">
                        <ul className="list-none p-0 m-0">
                            {signups.data.map((signup) => (
                                <li
                                    key={signup.id}
                                    className="flex items-center gap-4 px-6 py-4 not-last:border-b not-last:border-outline-variant/10">
                                    <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                                        <span className="font-body font-semibold text-[14px] leading-[1.3] text-on-surface truncate">
                                            {signup.name || '—'}
                                        </span>
                                        <span className="font-body font-normal text-[13px] leading-[1.3] text-on-surface-variant truncate">
                                            {signup.email}
                                        </span>
                                    </div>
                                    <span className="font-mono font-normal text-[12px] text-on-surface-variant whitespace-nowrap">
                                        {new Date(signup.createdAt).toLocaleDateString(undefined, {
                                            day: 'numeric',
                                            month: 'short',
                                            year: 'numeric',
                                        })}
                                    </span>
                                    <Pill tone={signup.status === 'approved' ? 'cyan' : 'magenta'}>
                                        {signup.status === 'approved' ? 'Approved' : 'Waiting'}
                                    </Pill>
                                    {signup.status === 'pending' ? (
                                        <PrimaryButton
                                            emphasis="pop"
                                            disabled={approve.isPending}
                                            onClick={() => approve.mutate(signup.id)}>
                                            Approve
                                        </PrimaryButton>
                                    ) : (
                                        <TertiaryButton danger onClick={() => revoke.mutate(signup.id)}>
                                            Revoke
                                        </TertiaryButton>
                                    )}
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
            </main>

            <Footer />
        </div>
    )
}
