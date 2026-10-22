'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

import { BetaPlanCard } from '@/components/BetaPlanCard'
import { FunnelShell } from '@/components/FunnelShell'
import { Eyebrow, Icon, ModalTitle, PrimaryButton, SubHeadline, TertiaryButton } from '@/components/ui'
import { useSession } from '@/lib/auth-client'
import { useBetaGate, usePlanCatalogue, useScores, useSignOut, useStartFirstMelody } from '@/lib/queries'

/**
 * Closed-beta waiting room. Pending users land here after signup; the page
 * polls their status and lets them straight in the moment an admin approves.
 */
export default function BetaWaitingPage() {
    const router = useRouter()
    const { data: session, isPending: sessionPending } = useSession()
    const gate = useBetaGate({ poll: true, enabled: !!session?.user })
    const betaPlan = usePlanCatalogue().beta
    const signOut = useSignOut()

    // Stay on the waitlist copy until the server has answered.
    const approved = gate.isResolved && !gate.awaitingApproval

    useEffect(() => {
        if (!sessionPending && !session?.user) router.replace('/login')
    }, [sessionPending, session, router])

    // Signing out of the waiting room leads back to the landing page rather than the
    // sign-in form: until approval, this page is all that signing in again would reach.
    return (
        <FunnelShell gap={6} action={<TertiaryButton onClick={() => void signOut('/')}>Sign out</TertiaryButton>}>
            {approved ? (
                <ApprovedWelcome />
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

                    <div className="flex flex-col gap-1.5">
                        <h3 className="m-0 font-body font-semibold text-[15px] leading-[1.3] text-on-surface">While you wait</h3>
                        <p className="m-0 font-body font-normal text-[15px] leading-normal text-on-surface-variant">
                            Think of a tune to try first — something you can hum or play. You&apos;ll be recording a minute after
                            you&apos;re in.
                        </p>
                    </div>

                    {/*
                     * The page already checks by itself, so checking by hand stays a quiet option. It
                     * is disabled while a check runs (refetch would cancel it and start over).
                     */}
                    <div className="flex items-center gap-x-4 gap-y-1 flex-wrap">
                        <TertiaryButton disabled={gate.isFetching} onClick={() => void gate.refetch()}>
                            <span className="inline-flex items-center gap-1.5">
                                <Icon name="refresh-cw" size={13} />
                                {gate.isFetching ? 'Checking…' : 'Check my status'}
                            </span>
                        </TertiaryButton>
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

/**
 * Approved: the same hand-off as onboarding's done screen. An empty library goes straight into a
 * first score on the onboarding pick, ready to record; one that already holds scores (an account
 * let in again) just opens the library, so nothing is made unasked.
 */
function ApprovedWelcome() {
    const library = useScores()
    const firstMelody = useStartFirstMelody()
    const count = library.data?.length
    return (
        <>
            <div className="w-14 h-14 rounded-full bg-primary-soft text-on-primary-soft inline-flex items-center justify-center">
                <Icon name="check" size={28} />
            </div>
            <ModalTitle>You&apos;re in.</ModalTitle>
            <SubHeadline>Your beta access has been approved. Have fun — and tell us everything that feels rough.</SubHeadline>
            {/* Its height held until the library is counted, so no button swaps in under a tap. */}
            <div className="flex items-center gap-x-5 gap-y-2 flex-wrap min-h-8.5 pointer-coarse:min-h-11">
                {count === 0 ? (
                    <>
                        <PrimaryButton
                            emphasis="pop"
                            icon="arrow-right"
                            onClick={() => firstMelody.start()}
                            disabled={firstMelody.creating}>
                            {firstMelody.creating ? 'Getting it ready…' : 'Record my first melody'}
                        </PrimaryButton>
                        <TertiaryButton href="/scores">Go to my library</TertiaryButton>
                    </>
                ) : (
                    (count !== undefined || library.isError) && (
                        <PrimaryButton emphasis="pop" icon="arrow-right" href="/scores">
                            Open my library
                        </PrimaryButton>
                    )
                )}
            </div>
        </>
    )
}
