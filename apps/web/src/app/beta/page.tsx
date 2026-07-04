'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

import { Eyebrow, Icon, ModalTitle, PrimaryButton, SubHeadline, TertiaryButton, Wordmark } from '@/components/ui'
import { signOut, useSession } from '@/lib/auth-client'
import { BETA_PLAN } from '@/lib/plans'
import { useBetaStatus } from '@/lib/queries'

/**
 * Closed-beta waiting room. Pending users land here after signup; the page
 * polls their status and lets them straight in the moment an admin approves.
 */
export default function BetaWaitingPage() {
    const router = useRouter()
    const { data: session, isPending: sessionPending } = useSession()
    const status = useBetaStatus({ poll: true, enabled: !!session?.user })

    const approved = status.data ? status.data.status !== 'pending' || !status.data.betaMode : false

    useEffect(() => {
        if (!sessionPending && !session?.user) router.replace('/login')
    }, [sessionPending, session, router])

    async function handleSignOut() {
        await signOut()
        router.push('/')
    }

    return (
        <main className="min-h-screen bg-surface flex flex-col items-center px-6 py-8">
            <header className="w-full max-w-180 flex justify-between items-center">
                <Wordmark size={26} />
                <TertiaryButton onClick={() => void handleSignOut()}>Sign out</TertiaryButton>
            </header>

            <div className="w-full max-w-180 mt-12 bg-surface-container-lowest rounded-2xl editorial-shadow px-12 py-10 flex flex-col gap-6">
                {approved ? (
                    <>
                        <div className="w-14 h-14 rounded-full bg-primary-container text-on-primary-container inline-flex items-center justify-center">
                            <Icon name="check" size={28} />
                        </div>
                        <ModalTitle>You&apos;re in!</ModalTitle>
                        <SubHeadline>Your beta access has been approved. Have fun — and tell us everything that feels rough.</SubHeadline>
                        <div>
                            <PrimaryButton emphasis="pop" icon="arrow-right" onClick={() => router.push('/scores')}>
                                Open my library
                            </PrimaryButton>
                        </div>
                    </>
                ) : (
                    <>
                        <Eyebrow className="text-secondary">Closed beta</Eyebrow>
                        <ModalTitle>You&apos;re on the waitlist.</ModalTitle>
                        <SubHeadline>
                            Sheemu is in a closed beta, so access is granted personally. We&apos;ll email{' '}
                            <strong className="text-on-surface">{session?.user?.email ?? 'you'}</strong> the moment your account is
                            approved — usually within a day.
                        </SubHeadline>

                        <div className="flex items-start gap-4 bg-surface-container-low rounded-md p-5">
                            <span className="w-12 h-12 rounded-full bg-primary-container text-on-primary-container inline-flex items-center justify-center shrink-0">
                                <Icon name={BETA_PLAN.icon} size={22} />
                            </span>
                            <div className="flex flex-col gap-1.5">
                                <span className="font-body font-semibold text-[15px] leading-[1.3] text-on-surface">
                                    Waiting for you: the {BETA_PLAN.name} plan
                                </span>
                                <ul className="list-none p-0 m-0 flex flex-col gap-1">
                                    {BETA_PLAN.features.map((f) => (
                                        <li
                                            key={f}
                                            className="flex items-start gap-2 font-body font-normal text-[13px] leading-[1.4] text-on-surface-variant">
                                            <span className="mt-px opacity-80">
                                                <Icon name="check" size={14} />
                                            </span>
                                            {f}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        </div>

                        <div className="flex items-center gap-4 flex-wrap">
                            <PrimaryButton onClick={() => void status.refetch()} disabled={status.isFetching} icon="refresh-cw">
                                {status.isFetching ? 'Checking…' : 'Check my status'}
                            </PrimaryButton>
                            <span className="font-body font-normal text-[12px] leading-[1.4] text-on-surface-variant">
                                This page checks automatically every half minute. Questions?{' '}
                                <a href="mailto:support@sheemu.app" className="text-primary underline">
                                    support@sheemu.app
                                </a>
                            </span>
                        </div>
                    </>
                )}
            </div>
        </main>
    )
}
