'use client'

import { useState } from 'react'

import { BusyNotice, DialogPanel, PrimaryButton, TertiaryButton } from '@/components/ui'
import { track } from '@/lib/analytics'
import type { BillingState } from '@/lib/api'
import { formatMoney } from '@/lib/currency'
import { CREDIT_PACKS, type CreditPack } from '@/lib/plans'
import { usePlanCatalogue, useStartPackCheckout } from '@/lib/queries'
import { formatAllowance } from '@/lib/recordingTime'
import { useDisplayCurrency } from '@/lib/useDisplayCurrency'

type Phase = 'choose' | 'redirecting'

interface PacksDialogProps {
    /** The account's plan and allowance — what the packs come on top of. */
    billing: BillingState
    onClose: () => void
    /** Open the subscription picker instead — plans stay the headline offer. */
    onSeePlans?: () => void
}

/**
 * The subtitle: when pack minutes are used, measured against the account's own allowance in
 * words ("your free 3 minutes", "your daily 3 hours").
 */
function packsSubtitle(billing: BillingState): string {
    const limit = billing.credits.limitSeconds
    if (limit === null) return 'For busy days: extra recording time that never expires.'
    const allowance = billing.tierId === 'free' ? `free ${formatAllowance(limit)}` : `daily ${formatAllowance(limit)}`
    return `For busy days: used after your ${allowance} run out, and they never expire.`
}

/**
 * One-time minute packs. Deliberately the secondary offer: a free account gets one honest
 * "a subscription is the better deal" nudge (a subscriber already has one, so it gets none).
 * Each card leads with what it buys — minutes. Checkout is Polar-hosted; the minutes land
 * via the `order.paid` webhook and never expire.
 */
export function PacksDialog({ billing, onClose, onSeePlans }: PacksDialogProps) {
    const [selected, setSelected] = useState<CreditPack['id']>('single')
    const [phase, setPhase] = useState<Phase>('choose')
    const currency = useDisplayCurrency()
    const startCheckout = useStartPackCheckout()
    const songwriter = usePlanCatalogue().songwriter

    const pack = CREDIT_PACKS.find((p) => p.id === selected) ?? CREDIT_PACKS[0]
    const locked = phase !== 'choose'
    // The subscription nudge is for a free account only: a subscriber already has a plan,
    // often a bigger one than Songwriter. It quotes Songwriter's allowance in words.
    const songwriterDaily = songwriter.dailyRecordingSeconds
    const nudge = billing.tierId === 'free' && songwriterDaily !== null ? formatAllowance(songwriterDaily) : null

    const buy = () => {
        if (locked) return
        setPhase('redirecting')
        track('pack_checkout_started', { packId: pack.id })
        // Success navigates away to Polar; only errors return here.
        startCheckout.mutate(pack.id, { onError: () => setPhase('choose') })
    }

    return (
        <DialogPanel
            title={phase === 'redirecting' ? 'Taking you to the payment page…' : 'Extra recording minutes'}
            subtitle={phase === 'choose' ? packsSubtitle(billing) : undefined}
            onClose={locked ? undefined : onClose}
            width={640}
            footer={
                phase === 'choose' ? (
                    <div className="flex flex-wrap justify-end items-center gap-x-3 gap-y-2 min-w-0">
                        {onSeePlans && <TertiaryButton onClick={onSeePlans}>See subscription plans</TertiaryButton>}
                        <PrimaryButton icon="external-link" onClick={buy}>
                            {`Buy ${pack.minutes} min · ${formatMoney(pack.price, currency)}`}
                        </PrimaryButton>
                    </div>
                ) : null
            }>
            {phase === 'choose' && (
                <div className="flex flex-col gap-4 pb-2">
                    {nudge && (
                        <div className="bg-surface-container-low text-on-surface-variant rounded-md px-3.5 py-3 font-body font-normal text-[13px] leading-normal">
                            Recording regularly? <strong>{songwriter.name}</strong> gives you {nudge} every day for{' '}
                            {formatMoney(songwriter.priceMonthly, currency)} a month — packs are for the once-in-a-while.
                        </div>
                    )}

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
                                        'focus-ring',
                                        active
                                            ? 'bg-primary-soft text-on-primary-soft'
                                            : 'bg-surface-container-lowest text-on-surface tonal-layer-glow',
                                    ].join(' ')}>
                                    <span className="font-mono font-semibold text-[22px] leading-none tracking-[-0.01em]">
                                        {p.minutes} min
                                    </span>
                                    <span className="font-body font-semibold text-[14px] leading-[1.2]">
                                        {formatMoney(p.price, currency)}
                                    </span>
                                    <span className="font-body font-normal text-[13px] leading-[1.4] opacity-80">
                                        {p.name} · {p.blurb}
                                    </span>
                                </button>
                            )
                        })}
                    </div>
                </div>
            )}

            {phase === 'redirecting' && <BusyNotice>You&apos;ll pay on a secure page run by our payment partner, Polar.</BusyNotice>}
        </DialogPanel>
    )
}
