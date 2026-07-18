'use client'

import { useState } from 'react'

import { PlanPicker } from '@/components/PlanPicker'
import { DialogPanel, DialogScrim, Icon, PrimaryButton, TertiaryButton } from '@/components/ui'
import { track } from '@/lib/analytics'
import type { BillingState } from '@/lib/api'
import { type Billing, PLAN_TIERS, planById, type PlanTier } from '@/lib/plans'
import { useCancelSubscription, useChangePlan, usePlans, useStartCheckout } from '@/lib/queries'

type Phase = 'choose' | 'redirecting' | 'done'

interface ChangePlanDialogProps {
    billing: BillingState
    onClose: () => void
    /** Open the one-time packs dialog instead (subscriptions stay the headline). */
    onShowPacks?: () => void
}

/**
 * Real Polar wiring:
 * - free/beta → paid: POST /billing/checkout, then redirect to Polar's page.
 * - paid → other paid tier/cadence: POST /billing/change (prorated in place).
 * - paid → free: POST /billing/cancel (keeps access until the period ends).
 */
export function ChangePlanDialog({ billing: state, onClose, onShowPacks }: ChangePlanDialogProps) {
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
                  maxScores: p.maxScores,
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
                { tierId: nextPlan.id as 'pro' | 'studio' | 'arranger', interval: billing },
                // Success navigates away to Polar; only errors return here.
                { onError: () => setPhase('choose') },
            )
        } else {
            track('plan_change_started', { tierId: nextPlan.id, interval: billing })
            changePlan.mutate(
                { tierId: nextPlan.id as 'pro' | 'studio' | 'arranger', interval: billing },
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
                        <PlanPicker
                            plans={plans}
                            billing={billing}
                            onBillingChange={setBilling}
                            selected={selected}
                            onSelect={setSelected}
                            isCurrent={(p) => p.id === state.tierId && (p.priceMonthly === 0 || billing === currentBilling)}
                        />

                        {onShowPacks && (
                            <p className="font-body font-normal text-[12px] leading-normal text-on-surface-variant m-0">
                                Just need a few minutes once?{' '}
                                <button
                                    type="button"
                                    onClick={onShowPacks}
                                    className="border-0 bg-transparent p-0 cursor-pointer font-body font-medium text-[12px] text-primary underline">
                                    One-time minute packs
                                </button>
                            </p>
                        )}

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
