'use client'

import { useState } from 'react'

import { PlanPicker } from '@/components/PlanPicker'
import { BusyNotice, DialogPanel, Icon, PrimaryButton, TertiaryButton } from '@/components/ui'
import { track } from '@/lib/analytics'
import type { BillingInterval, BillingState } from '@/lib/api'
import { formatMoney } from '@/lib/currency'
import { formatLongDate } from '@/lib/dates'
import { isPaidTier, type PlanTier } from '@/lib/plans'
import { useCancelSubscription, useChangePlan, usePlanCatalogue, useStartCheckout } from '@/lib/queries'
import { formatAllowance } from '@/lib/recordingTime'
import { useDisplayCurrency } from '@/lib/useDisplayCurrency'

type Phase = 'choose' | 'redirecting' | 'done'

interface ChangePlanDialogProps {
    billing: BillingState
    /** The tier to open on (a pricing card's request, or Sketch for "Cancel subscription"); otherwise the account's current plan. */
    initialTier?: PlanTier['id']
    onClose: () => void
    /** Open the one-time packs dialog instead (subscriptions stay the headline). */
    onShowPacks?: () => void
}

/** Where the payment happens, said once at the step that leads there. */
const PAYMENT_PARTNER_NOTE = "You'll pay on a secure page run by our payment partner, Polar."

/**
 * Real Polar wiring:
 * - free/beta → paid: POST /billing/checkout, then redirect to Polar's page.
 * - paid → other paid tier/cadence: POST /billing/change (prorated in place).
 * - paid → free: POST /billing/cancel (keeps access until the period ends).
 * The footer has one action: just "Close" while the current plan is picked, else "Keep my
 * plan" beside a flat confirm that names what it does — "Continue to payment", "Switch to
 * Songwriter — $9 a month" or "Cancel subscription".
 */
export function ChangePlanDialog({ billing: state, initialTier, onClose, onShowPacks }: ChangePlanDialogProps) {
    const currentBilling: BillingInterval = state.interval ?? 'monthly'
    const [selected, setSelected] = useState<PlanTier['id']>(initialTier ?? (state.tierId === 'beta' ? 'free' : state.tierId))
    const [billing, setBilling] = useState<BillingInterval>(currentBilling)
    const [phase, setPhase] = useState<Phase>('choose')
    const currency = useDisplayCurrency()

    const startCheckout = useStartCheckout()
    const changePlan = useChangePlan()
    const cancelSubscription = useCancelSubscription()

    const catalogue = usePlanCatalogue()
    const plans = catalogue.sellable

    const hasSubscription = Boolean(state.status)
    const nextPlan = catalogue.byId(selected) ?? plans[0]
    // The tier the account is on, in the cadence it pays (a free tier has no cadence).
    const isCurrentPlan = (p: PlanTier) => p.id === state.tierId && (p.priceMonthly === 0 || billing === currentBilling)
    const isSame = isCurrentPlan(nextPlan)
    const isCancel = nextPlan.id === 'free' && hasSubscription
    const needsCheckout = nextPlan.priceMonthly > 0 && !hasSubscription
    // Sketch is reached by cancelling; checkouts and plan changes only ever target a paid tier.
    const canApply = !isSame && (isCancel || isPaidTier(nextPlan.id))
    const isSwitch = canApply && !isCancel && !needsCheckout
    const periodEnd = state.currentPeriodEnd ? formatLongDate(state.currentPeriodEnd) : null
    const keepsUntil = `You keep ${state.tierName} until ${periodEnd ?? 'the end of this billing period'}, then move to Sketch.`

    const apply = () => {
        if (!canApply || phase !== 'choose') return
        if (isCancel) {
            setPhase('redirecting')
            track('subscription_cancel_started')
            cancelSubscription.mutate(undefined, {
                onSuccess: () => setPhase('done'),
                onError: () => setPhase('choose'),
            })
            return
        }
        const tierId = nextPlan.id
        if (!isPaidTier(tierId)) return
        setPhase('redirecting')
        if (needsCheckout) {
            track('checkout_started', { tierId, interval: billing })
            startCheckout.mutate(
                { tierId, interval: billing },
                // Success navigates away to Polar; only errors return here.
                { onError: () => setPhase('choose') },
            )
        } else {
            track('plan_change_started', { tierId, interval: billing })
            changePlan.mutate(
                { tierId, interval: billing },
                {
                    onSuccess: () => setPhase('done'),
                    onError: () => setPhase('choose'),
                },
            )
        }
    }

    const price =
        billing === 'yearly'
            ? `${formatMoney(nextPlan.priceYearly, currency)} a year`
            : `${formatMoney(nextPlan.priceMonthly, currency)} a month`
    const ctaLabel = isCancel ? 'Cancel subscription' : needsCheckout ? 'Continue to payment' : `Switch to ${nextPlan.name} — ${price}`
    const doneLine =
        nextPlan.dailyRecordingSeconds === null
            ? `You're on ${nextPlan.name} now, with no daily recording limit.`
            : `You're on ${nextPlan.name} now — ${formatAllowance(nextPlan.dailyRecordingSeconds)} of recording a day.`

    const locked = phase !== 'choose'
    const note = 'bg-surface-container-low text-on-surface-variant rounded-md px-3.5 py-3 font-body font-normal text-[13px] leading-normal'

    return (
        <DialogPanel
            title={
                phase === 'done'
                    ? isCancel
                        ? 'Subscription cancelled.'
                        : 'Plan updated.'
                    : phase === 'redirecting'
                      ? needsCheckout
                          ? 'Taking you to the payment page…'
                          : isCancel
                            ? 'Cancelling your subscription…'
                            : 'Updating your plan…'
                      : 'Change plan'
            }
            subtitle={phase === 'choose' ? "Pick how much you'd like to record each day. Switch or cancel any time." : undefined}
            onClose={locked ? undefined : onClose}
            width={800}
            footer={
                phase === 'choose' ? (
                    canApply ? (
                        <>
                            <TertiaryButton onClick={onClose}>Keep my plan</TertiaryButton>
                            <PrimaryButton danger={isCancel} icon={needsCheckout ? 'external-link' : undefined} onClick={apply}>
                                {ctaLabel}
                            </PrimaryButton>
                        </>
                    ) : (
                        <TertiaryButton onClick={onClose}>Close</TertiaryButton>
                    )
                ) : phase === 'done' ? (
                    <PrimaryButton onClick={onClose}>Done</PrimaryButton>
                ) : null
            }>
            {phase === 'choose' && (
                <div className="flex flex-col gap-4.5 pb-2">
                    <p className="font-body font-normal text-[13px] leading-normal text-on-surface-variant m-0">
                        You&apos;re on <strong className="font-semibold text-on-surface">{state.tierName}</strong>.
                    </p>
                    <PlanPicker
                        plans={plans}
                        billing={billing}
                        onBillingChange={setBilling}
                        selected={selected}
                        onSelect={setSelected}
                        isCurrent={isCurrentPlan}
                        currentTierId={state.tierId}
                    />

                    {onShowPacks && (
                        <p className="font-body font-normal text-[12px] leading-normal text-on-surface-variant m-0">
                            Just need a few minutes once?{' '}
                            <button
                                type="button"
                                onClick={onShowPacks}
                                className="border-0 bg-transparent p-0 cursor-pointer font-body font-medium text-[12px] text-primary underline rounded-sm focus-ring">
                                Buy extra minutes
                            </button>
                        </p>
                    )}

                    {isCancel && <div className={note}>{keepsUntil} Your scores stay.</div>}
                    {isSwitch && (
                        <div className={note}>
                            The switch happens now, and your next bill is adjusted for the days you&apos;ve already paid.
                        </div>
                    )}
                    {canApply && needsCheckout && (
                        <p className="font-body font-normal text-[12px] leading-normal text-on-surface-variant m-0">
                            {PAYMENT_PARTNER_NOTE}
                        </p>
                    )}
                </div>
            )}

            {phase === 'redirecting' && <BusyNotice>{needsCheckout ? PAYMENT_PARTNER_NOTE : 'This only takes a moment.'}</BusyNotice>}

            {phase === 'done' && (
                <div className="flex items-center gap-3.5 pt-2 pb-4">
                    <span className="w-10 h-10 rounded-full bg-primary-container text-on-primary-container inline-flex items-center justify-center shrink-0">
                        <Icon name="check" size={20} />
                    </span>
                    <span className="font-body font-normal text-[14px] leading-normal text-on-surface-variant">
                        {isCancel ? `${keepsUntil} Changed your mind? Resume any time before then.` : doneLine}
                    </span>
                </div>
            )}
        </DialogPanel>
    )
}
