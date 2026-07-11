'use client'

import { useState } from 'react'

import { DialogPanel, DialogScrim, PrimaryButton, TertiaryButton } from '@/components/ui'
import { track } from '@/lib/analytics'
import { CREDIT_PACKS, type CreditPack } from '@/lib/plans'
import { useStartPackCheckout } from '@/lib/queries'

type Phase = 'choose' | 'redirecting'

interface PacksDialogProps {
    onClose: () => void
    /** Open the subscription picker instead — plans stay the headline offer. */
    onSeePlans?: () => void
}

/**
 * One-time minute packs. Deliberately the secondary offer: the dialog opens
 * with an honest "a subscription is the better deal" nudge and every card
 * carries its subscription comparison. Checkout is Polar-hosted; the minutes
 * land via the `order.paid` webhook and never expire.
 */
export function PacksDialog({ onClose, onSeePlans }: PacksDialogProps) {
    const [selected, setSelected] = useState<CreditPack['id']>('single')
    const [phase, setPhase] = useState<Phase>('choose')
    const startCheckout = useStartPackCheckout()

    const pack = CREDIT_PACKS.find((p) => p.id === selected) ?? CREDIT_PACKS[0]
    const locked = phase !== 'choose'

    const buy = () => {
        if (locked) return
        setPhase('redirecting')
        track('pack_checkout_started', { packId: pack.id })
        // Success navigates away to Polar; only errors return here.
        startCheckout.mutate(pack.id, { onError: () => setPhase('choose') })
    }

    return (
        <DialogScrim onDismiss={locked ? undefined : onClose}>
            <DialogPanel
                title={phase === 'redirecting' ? 'Redirecting to Polar…' : 'One-time minute packs'}
                subtitle={
                    phase === 'choose'
                        ? 'Extra recording minutes without a subscription. They never expire and are used once your daily minutes run out.'
                        : undefined
                }
                onClose={locked ? undefined : onClose}
                width={640}
                footer={
                    phase === 'choose' ? (
                        <>
                            {onSeePlans && <TertiaryButton onClick={onSeePlans}>See subscription plans</TertiaryButton>}
                            <PrimaryButton icon="external-link" onClick={buy}>
                                {`Buy ${pack.name} · $${pack.price}`}
                            </PrimaryButton>
                        </>
                    ) : null
                }>
                {phase === 'choose' && (
                    <div className="flex flex-col gap-4 pb-2">
                        <div className="bg-surface-container-low text-on-surface-variant rounded-md px-3.5 py-3 font-body font-normal text-[13px] leading-normal">
                            Recording regularly? <strong>Songwriter</strong> gives you 20 minutes <em>every day</em> for
                            $9/month — packs are for the once-in-a-while.
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3" role="radiogroup" aria-label="Minute pack">
                            {CREDIT_PACKS.map((p) => {
                                const active = selected === p.id
                                return (
                                    <button
                                        key={p.id}
                                        type="button"
                                        role="radio"
                                        aria-checked={active}
                                        onClick={() => setSelected(p.id)}
                                        className={[
                                            'text-left border-0 rounded-lg p-4 cursor-pointer',
                                            'flex flex-col gap-2',
                                            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
                                            active
                                                ? 'bg-primary-soft text-on-primary-soft'
                                                : 'bg-surface-container-lowest text-on-surface tonal-layer-glow',
                                        ].join(' ')}>
                                        <span className="font-body font-semibold text-[14px] leading-[1.2]">{p.name}</span>
                                        <span className="font-mono font-semibold text-[22px] leading-none tracking-[-0.01em]">
                                            ${p.price}
                                        </span>
                                        <span className="font-body font-normal text-[13px] leading-[1.4]">
                                            {p.minutes} min of recording
                                        </span>
                                        <span className="font-body font-normal text-[12px] leading-[1.4] opacity-80">{p.blurb}</span>
                                    </button>
                                )
                            })}
                        </div>

                        <p className="font-body font-normal text-[12px] leading-[1.5] text-on-surface-variant m-0">
                            {pack.compare}
                        </p>
                    </div>
                )}

                {phase === 'redirecting' && (
                    <div className="flex flex-col items-center gap-3.5 px-4 py-6">
                        <span
                            className="w-10 h-10 rounded-full border-[3px] border-surface-container border-t-primary"
                            style={{ animation: 'sheemu-spin 700ms linear infinite' }}
                        />
                        <span className="font-body font-normal text-[13px] leading-normal text-on-surface-variant text-center max-w-90">
                            Sending you to Polar&apos;s secure checkout…
                        </span>
                    </div>
                )}
            </DialogPanel>
        </DialogScrim>
    )
}
