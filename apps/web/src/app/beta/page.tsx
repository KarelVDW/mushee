'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

import { BetaPlanCard } from '@/components/BetaPlanCard'
import { FunnelShell } from '@/components/FunnelShell'
import { Eyebrow, Icon, ModalTitle, PrimaryButton, SubHeadline, TertiaryButton } from '@/components/ui'
import { signOut, useSession } from '@/lib/auth-client'
import { useBetaGate, usePlanCatalogue } from '@/lib/queries'

/**
 * Closed-beta waiting room. Pending users land here after signup; the page
 * polls their status and lets them straight in the moment an admin approves.
 */
export default function BetaWaitingPage() {
    const router = useRouter()
    const { data: session, isPending: sessionPending } = useSession()
    const gate = useBetaGate({ poll: true, enabled: !!session?.user })
    const betaPlan = usePlanCatalogue().beta

    // Stay on the waitlist copy until the server has answered.
    const approved = gate.isResolved && !gate.awaitingApproval

    useEffect(() => {
        if (!sessionPending && !session?.user) router.replace('/login')
    }, [sessionPending, session, router])

    async function handleSignOut() {
        await signOut()
        router.push('/')
    }

    return (
        <FunnelShell gap={6} action={<TertiaryButton onClick={() => void handleSignOut()}>Sign out</TertiaryButton>}>
            {approved ? (
                <>
                    <div className="w-14 h-14 rounded-full bg-primary-soft text-on-primary-soft inline-flex items-center justify-center">
                        <Icon name="check" size={28} />
                    </div>
                    <ModalTitle>You&apos;re in.</ModalTitle>
                    <SubHeadline>Your beta access has been approved. Have fun — and tell us everything that feels rough.</SubHeadline>
                    <div>
                        <PrimaryButton emphasis="pop" icon="arrow-right" href="/scores">
                            Open my library
                        </PrimaryButton>
                    </div>
                </>
            ) : (
                <>
                    <Eyebrow className="text-secondary">Closed beta</Eyebrow>
                    <ModalTitle>You&apos;re on the waitlist.</ModalTitle>
                    <SubHeadline>
                        Solkey is in a closed beta, so access is granted personally. We&apos;ll email{' '}
                        <strong className="text-on-surface">{session?.user?.email ?? 'you'}</strong> the moment your account is approved —
                        usually within a day.
                    </SubHeadline>

                    <BetaPlanCard plan={betaPlan} title={<>Waiting for you: the {betaPlan.name} plan</>} />

                    <div className="flex items-center gap-4 flex-wrap">
                        <PrimaryButton onClick={() => void gate.refetch()} disabled={gate.isFetching} icon="refresh-cw">
                            {gate.isFetching ? 'Checking…' : 'Check my status'}
                        </PrimaryButton>
                        <span className="font-body font-normal text-[12px] leading-[1.4] text-on-surface-variant">
                            This page checks automatically every 30 seconds. Questions?{' '}
                            <a href="mailto:support@solkey.io" className="text-primary underline">
                                support@solkey.io
                            </a>
                        </span>
                    </div>
                </>
            )}
        </FunnelShell>
    )
}
