'use client'

import { useState } from 'react'

import {
    DialogPanel,
    DialogScrim,
    Icon,
    PrimaryButton,
    TertiaryButton,
} from '@/components/ui'

// Mock plan catalogue — mirrors the design system's Settings.jsx tiers.
// Production would feed these from /api/polar/products.
export interface PlanTier {
    id: 'free' | 'pro' | 'studio'
    name: string
    icon: string
    priceMonthly: number
    priceYearly: number
    features: string[]
}

export type Billing = 'monthly' | 'yearly'

export const PLAN_TIERS: PlanTier[] = [
    {
        id: 'free',
        name: 'Sketch',
        icon: 'feather',
        priceMonthly: 0,
        priceYearly: 0,
        features: ['30 sec recording / day', '3 scores', 'Transcription', 'PDF export'],
    },
    {
        id: 'pro',
        name: 'Composer',
        icon: 'sparkles',
        priceMonthly: 8,
        priceYearly: 80,
        features: [
            '10 min recording / day',
            'Unlimited scores',
            'MIDI + MusicXML',
            'Shareable links',
            'Editor themes',
        ],
    },
    {
        id: 'studio',
        name: 'Studio',
        icon: 'gem',
        priceMonthly: 18,
        priceYearly: 180,
        features: [
            'Unlimited recording',
            'Everything in Composer',
            '5 collaborators per score',
            'Custom templates',
            'Priority support',
        ],
    },
]

function planPrice(plan: PlanTier, billing: Billing): string {
    if (plan.priceMonthly === 0) return 'Free'
    if (billing === 'yearly') {
        const m = (plan.priceYearly / 12).toFixed(plan.priceYearly % 12 === 0 ? 0 : 2)
        return `$${m}/mo · billed yearly`
    }
    return `$${plan.priceMonthly}/mo`
}

type Phase = 'choose' | 'redirecting' | 'done'

interface ChangePlanDialogProps {
    currentPlanId: PlanTier['id']
    currentBilling: Billing
    onCancel: () => void
    onChanged: (next: { planId: PlanTier['id']; billing: Billing }) => void
}

export function ChangePlanDialog({ currentPlanId, currentBilling, onCancel, onChanged }: ChangePlanDialogProps) {
    const [selected, setSelected] = useState<PlanTier['id']>(currentPlanId)
    const [billing, setBilling] = useState<Billing>(currentBilling)
    const [phase, setPhase] = useState<Phase>('choose')

    const currentPlan = PLAN_TIERS.find((p) => p.id === currentPlanId) ?? PLAN_TIERS[0]
    const nextPlan = PLAN_TIERS.find((p) => p.id === selected) ?? PLAN_TIERS[0]
    const isSame = selected === currentPlanId && billing === currentBilling
    const isDowngrade = nextPlan.priceMonthly < currentPlan.priceMonthly
    const isCancel = nextPlan.id === 'free' && currentPlan.id !== 'free'

    const apply = () => {
        if (isSame) return
        // Mock: simulate the hand-off latency. Real wiring would POST to
        // /api/polar/checkout for upgrades or PATCH /api/polar/subscription
        // for downgrades / cancellation.
        setPhase('redirecting')
        const delay = isDowngrade || isCancel ? 900 : 1400
        setTimeout(() => {
            setPhase('done')
            setTimeout(() => onChanged({ planId: selected, billing }), 900)
        }, delay)
    }

    const ctaLabel = isSame
        ? 'No change'
        : isCancel
            ? 'Cancel subscription'
            : isDowngrade
                ? `Switch to ${nextPlan.name}`
                : 'Continue to Polar checkout'

    const locked = phase === 'redirecting' || phase === 'done'

    return (
        <DialogScrim onDismiss={locked ? undefined : onCancel}>
            <DialogPanel
                title={
                    phase === 'done'
                        ? 'Plan updated.'
                        : phase === 'redirecting'
                            ? isDowngrade || isCancel
                                ? 'Updating your subscription…'
                                : 'Redirecting to Polar…'
                            : 'Change plan'
                }
                eyebrow={
                    phase === 'done'
                        ? `You're now on ${nextPlan.name}.`
                        : phase === 'redirecting'
                            ? undefined
                            : 'Switch tiers, change billing cadence, or cancel. Payments are processed by Polar.'
                }
                onClose={locked ? undefined : onCancel}
                width={720}
                footer={
                    phase === 'choose' ? (
                        <>
                            <TertiaryButton onClick={onCancel}>Keep current plan</TertiaryButton>
                            <PrimaryButton
                                emphasis="pop"
                                disabled={isSame}
                                danger={isCancel}
                                icon={!isDowngrade && !isCancel ? 'external-link' : undefined}
                                onClick={apply}>
                                {ctaLabel}
                            </PrimaryButton>
                        </>
                    ) : null
                }>
                {phase === 'choose' && (
                    <div className="flex flex-col gap-4.5 pb-2">
                        <div
                            role="radiogroup"
                            aria-label="Billing cadence"
                            className="inline-flex p-0.75 rounded-full bg-surface-container-low self-start">
                            {([
                                ['monthly', 'Monthly'],
                                ['yearly', 'Yearly · save 17%'],
                            ] as const).map(([k, label]) => {
                                const active = billing === k
                                return (
                                    <button
                                        key={k}
                                        type="button"
                                        role="radio"
                                        aria-checked={active}
                                        onClick={() => setBilling(k)}
                                        className={[
                                            'border-0 px-3.5 py-1.75 rounded-full cursor-pointer',
                                            'font-label font-semibold text-[12px] leading-none',
                                            active
                                                ? 'bg-surface-container-lowest text-on-surface shadow-[0_1px_3px_rgba(45,47,47,0.08)]'
                                                : 'bg-transparent text-on-surface-variant',
                                        ].join(' ')}>
                                        {label}
                                    </button>
                                )
                            })}
                        </div>

                        <div className="grid grid-cols-3 gap-3">
                            {PLAN_TIERS.map((p) => {
                                const active = selected === p.id
                                const isCurrent = p.id === currentPlanId && billing === currentBilling
                                return (
                                    <button
                                        key={p.id}
                                        type="button"
                                        onClick={() => setSelected(p.id)}
                                        aria-pressed={active}
                                        className={[
                                            'relative text-left border-0 rounded-lg p-4 cursor-pointer',
                                            'flex flex-col gap-2.5',
                                            active
                                                ? 'bg-primary-soft text-on-primary-soft'
                                                : 'bg-surface-container-lowest text-on-surface shadow-[inset_0_0_0_1px_var(--color-outline-variant)]',
                                        ].join(' ')}>
                                        {isCurrent && (
                                            <span className="absolute -top-2.5 right-3.5 bg-surface-container-high text-on-surface font-label font-semibold text-[10px] leading-none tracking-[0.12em] uppercase px-2.5 py-1.5 rounded-full">
                                                Current
                                            </span>
                                        )}
                                        <div className="flex items-center gap-2.5">
                                            <Icon name={p.icon} size={18} />
                                            <span className="font-body font-semibold text-[14px] leading-[1.2]">{p.name}</span>
                                        </div>
                                        <span className="font-display italic font-normal text-[24px] leading-none tracking-[-0.02em]">
                                            {planPrice(p, billing)}
                                        </span>
                                        <ul className="list-none p-0 m-0 flex flex-col gap-1.5">
                                            {p.features.map((f) => (
                                                <li
                                                    key={f}
                                                    className="flex items-start gap-1.5 font-body font-normal text-[12px] leading-[1.4]">
                                                    <span className="mt-px opacity-80">
                                                        <Icon name="check" size={12} />
                                                    </span>
                                                    {f}
                                                </li>
                                            ))}
                                        </ul>
                                    </button>
                                )
                            })}
                        </div>

                        {isCancel && (
                            <div className="bg-error-container text-on-error-container rounded-md px-3.5 py-3 font-body font-normal text-[13px] leading-normal">
                                You&apos;ll keep <strong>{currentPlan.name}</strong> features until your next billing
                                date, then drop to Sketch. Scores beyond the 3-score limit become read-only — they&apos;re
                                never deleted.
                            </div>
                        )}
                        {isDowngrade && !isCancel && (
                            <div className="bg-surface-container-low text-on-surface-variant rounded-md px-3.5 py-3 font-body font-normal text-[13px] leading-normal">
                                Downgrade takes effect at the end of your current billing cycle. Polar will prorate any
                                difference.
                            </div>
                        )}
                    </div>
                )}

                {phase === 'redirecting' && (
                    <div className="flex flex-col items-center gap-3.5 px-4 py-6">
                        <span
                            className="w-10 h-10 rounded-full border-[3px] border-surface-container border-t-primary"
                            style={{ animation: 'sheemu-spin 700ms linear infinite' }}
                        />
                        <span className="font-body font-normal text-[13px] leading-normal text-on-surface-variant text-center max-w-90">
                            {isDowngrade || isCancel
                                ? 'Talking to Polar to update your subscription.'
                                : "Hand-off to Polar's secure checkout in progress…"}
                        </span>
                    </div>
                )}

                {phase === 'done' && (
                    <div className="flex items-center gap-3.5 pt-2 pb-4">
                        <span className="w-10 h-10 rounded-full bg-primary-container text-on-primary-container inline-flex items-center justify-center shrink-0">
                            <Icon name="check" size={20} />
                        </span>
                        <span className="font-body font-normal text-[14px] leading-normal text-on-surface-variant">
                            {isCancel
                                ? 'Subscription cancelled. We sent a confirmation to your email.'
                                : 'Polar has the new plan on file. Receipt sent by email.'}
                        </span>
                    </div>
                )}
            </DialogPanel>
        </DialogScrim>
    )
}
