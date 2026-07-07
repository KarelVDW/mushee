'use client'

import { useState } from 'react'

import { DialogPanel, DialogScrim, Icon, PrimaryButton, TertiaryButton } from '@/components/ui'
import { track } from '@/lib/analytics'
import type { BillingState } from '@/lib/api'
import { type Billing, PLAN_TIERS, planById, planFeatures, planPrice, type PlanTier } from '@/lib/plans'
import { useCancelSubscription, useChangePlan, usePlans, useStartCheckout } from '@/lib/queries'

type Phase = 'choose' | 'redirecting' | 'done'

interface ChangePlanDialogProps {
    billing: BillingState
    onClose: () => void
}

/**
 * Real Polar wiring:
 * - free/beta → paid: POST /billing/checkout, then redirect to Polar's page.
 * - paid → other paid tier/cadence: POST /billing/change (prorated in place).
 * - paid → free: POST /billing/cancel (keeps access until the period ends).
 */
export function ChangePlanDialog({ billing: state, onClose }: ChangePlanDialogProps) {
    const currentBilling: Billing = state.interval ?? 'monthly'
    const [selected, setSelected] = useState<PlanTier['id']>(state.tierId === 'beta' ? 'free' : state.tierId)
    const [billing, setBilling] = useState<Billing>(currentBilling)
    const [phase, setPhase] = useState<Phase>('choose')

    const startCheckout = useStartCheckout()
    const changePlan = useChangePlan()
    const cancelSubscription = useCancelSubscription()

    // Tier identity (names, budgets, which tiers exist) comes from the
    // database catalogue; the static entries only decorate it (icons, display
    // prices) and bridge the moment before the query resolves.
    const { data: apiPlans } = usePlans()
    const plans: PlanTier[] = apiPlans
        ? apiPlans
              .filter((p) => p.sellable)
              .map((p) => ({
                  ...planById(p.id),
                  id: p.id as PlanTier['id'],
                  name: p.name,
                  dailyRecordingSeconds: p.dailyRecordingCredits,
              }))
        : PLAN_TIERS

    const hasSubscription = Boolean(state.status)
    const currentPlan = plans.find((p) => p.id === state.tierId) ?? plans[0]
    const nextPlan = plans.find((p) => p.id === selected) ?? plans[0]
    const isSame = selected === state.tierId && (nextPlan.priceMonthly === 0 || billing === currentBilling)
    const isDowngrade = nextPlan.priceMonthly < currentPlan.priceMonthly
    const isCancel = nextPlan.id === 'free' && hasSubscription
    const needsCheckout = nextPlan.priceMonthly > 0 && !hasSubscription

    const apply = () => {
        if (isSame || phase !== 'choose') return
        setPhase('redirecting')
        if (isCancel) {
            track('subscription_cancel_started')
            cancelSubscription.mutate(undefined, {
                onSuccess: () => setPhase('done'),
                onError: () => setPhase('choose'),
            })
        } else if (needsCheckout) {
            track('checkout_started', { tierId: nextPlan.id, interval: billing })
            startCheckout.mutate(
                { tierId: nextPlan.id as 'pro' | 'studio', interval: billing },
                // Success navigates away to Polar; only errors return here.
                { onError: () => setPhase('choose') },
            )
        } else {
            track('plan_change_started', { tierId: nextPlan.id, interval: billing })
            changePlan.mutate(
                { tierId: nextPlan.id as 'pro' | 'studio', interval: billing },
                {
                    onSuccess: () => setPhase('done'),
                    onError: () => setPhase('choose'),
                },
            )
        }
    }

    const ctaLabel = isSame
        ? 'No change'
        : isCancel
          ? 'Cancel subscription'
          : needsCheckout
            ? 'Continue to Polar checkout'
            : `Switch to ${nextPlan.name}${billing === 'yearly' ? ' (yearly)' : ' (monthly)'}`

    const locked = phase !== 'choose'

    return (
        <DialogScrim onDismiss={locked ? undefined : onClose}>
            <DialogPanel
                title={
                    phase === 'done'
                        ? isCancel
                            ? 'Cancellation scheduled.'
                            : 'Plan updated.'
                        : phase === 'redirecting'
                          ? needsCheckout
                              ? 'Redirecting to Polar…'
                              : 'Updating your subscription…'
                          : 'Change plan'
                }
                subtitle={
                    phase === 'choose'
                        ? 'Switch tiers, change billing cadence, or cancel. Payments are processed securely by Polar.'
                        : undefined
                }
                onClose={locked ? undefined : onClose}
                width={720}
                footer={
                    phase === 'choose' ? (
                        <>
                            <TertiaryButton onClick={onClose}>Keep current plan</TertiaryButton>
                            <PrimaryButton
                                emphasis="pop"
                                disabled={isSame}
                                danger={isCancel}
                                icon={needsCheckout ? 'external-link' : undefined}
                                onClick={apply}>
                                {ctaLabel}
                            </PrimaryButton>
                        </>
                    ) : phase === 'done' ? (
                        <PrimaryButton emphasis="pop" onClick={onClose}>
                            Done
                        </PrimaryButton>
                    ) : null
                }>
                {phase === 'choose' && (
                    <div className="flex flex-col gap-4.5 pb-2">
                        <div
                            role="radiogroup"
                            aria-label="Billing cadence"
                            className="inline-flex p-0.75 rounded-full bg-surface-container-low self-start">
                            {(
                                [
                                    ['monthly', 'Monthly'],
                                    ['yearly', 'Yearly · save 17%'],
                                ] as const
                            ).map(([k, label]) => {
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
                                            'transition-colors duration-150 ease-sheemu',
                                            active
                                                ? 'bg-primary-container text-on-primary-container'
                                                : 'bg-transparent text-on-surface-variant',
                                        ].join(' ')}>
                                        {label}
                                    </button>
                                )
                            })}
                        </div>

                        <div className="grid grid-cols-3 gap-3">
                            {plans.map((p) => {
                                const active = selected === p.id
                                const isCurrent = p.id === state.tierId && (p.priceMonthly === 0 || billing === currentBilling)
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
                                                : 'bg-surface-container-lowest text-on-surface tonal-layer-glow',
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
                                        <span className="font-mono font-semibold text-[22px] leading-none tracking-[-0.01em]">
                                            {planPrice(p, billing)}
                                        </span>
                                        <ul className="list-none p-0 m-0 flex flex-col gap-1.5">
                                            {planFeatures(p).map((f) => (
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
                                You&apos;ll keep <strong>{currentPlan.name}</strong> features until the end of your billing period, then
                                drop to Sketch. Your scores are never deleted.
                            </div>
                        )}
                        {isDowngrade && !isCancel && (
                            <div className="bg-surface-container-low text-on-surface-variant rounded-md px-3.5 py-3 font-body font-normal text-[13px] leading-normal">
                                The switch takes effect right away; Polar prorates the difference on your next invoice.
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
                            {needsCheckout
                                ? "Sending you to Polar's secure checkout…"
                                : 'Talking to Polar to update your subscription.'}
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
                                ? 'Your subscription ends at the close of the current billing period. You can resume any time before then.'
                                : 'Polar has the new plan on file. Receipt follows by email.'}
                        </span>
                    </div>
                )}
            </DialogPanel>
        </DialogScrim>
    )
}
