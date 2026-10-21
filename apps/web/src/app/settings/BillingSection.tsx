'use client'

import { useState } from 'react'

import { Alert, Icon, PrimaryButton, SecondaryButton, TertiaryButton } from '@/components/ui'
import { BETA_PLAN, planById, planPrice } from '@/lib/plans'
import { useBillingPortal, useBillingState, useResumeSubscription } from '@/lib/queries'
import { formatRecordingTime } from '@/lib/recordingTime'
import { useDisplayCurrency } from '@/lib/useDisplayCurrency'

import { ChangePlanDialog } from './ChangePlanDialog'
import { PacksDialog } from './PacksDialog'
import { SettingsSection } from './SettingsSection'

/** Live Polar-backed subscription state: plan, renewal, credits, actions. */
export function BillingSection() {
    const { data: billing, isPending, isError, refetch } = useBillingState()
    const portal = useBillingPortal()
    const resume = useResumeSubscription()
    const [changePlanOpen, setChangePlanOpen] = useState(false)
    const [packsOpen, setPacksOpen] = useState(false)
    const currency = useDisplayCurrency()

    if (isPending) {
        return (
            <SettingsSection title="Plan & billing" subtitle="Loading your subscription…">
                <div className="h-20 bg-surface-container-low rounded-md animate-pulse" />
            </SettingsSection>
        )
    }
    if (isError || !billing) {
        return (
            <SettingsSection title="Plan & billing">
                <Alert onRetry={() => void refetch()}>Couldn&apos;t load your subscription.</Alert>
            </SettingsSection>
        )
    }

    const isBeta = billing.tierId === 'beta'
    const plan = planById(billing.tierId)
    const hasSubscription = Boolean(billing.status)
    const periodEnd = billing.currentPeriodEnd
        ? new Date(billing.currentPeriodEnd).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })
        : null

    const priceLine = isBeta
        ? 'Free during the beta'
        : hasSubscription
          ? `${planPrice(plan, billing.interval ?? 'monthly', currency)}${
                periodEnd ? (billing.cancelAtPeriodEnd ? ` · ends ${periodEnd}` : ` · renews ${periodEnd}`) : ''
            }`
          : 'Free'

    return (
        <SettingsSection
            title="Plan & billing"
            subtitle={
                isBeta
                    ? 'Solkey is in closed beta — your plan is on the house. Paid plans arrive at launch.'
                    : `You're on the ${billing.tierName} plan. Payments are handled securely by Polar.`
            }>
            <div className="flex items-center gap-4 p-4 bg-surface-container-low rounded-md">
                <span className="w-11 h-11 rounded-full bg-primary-soft text-on-primary-soft inline-flex items-center justify-center">
                    <Icon name={isBeta ? BETA_PLAN.icon : plan.icon} size={20} />
                </span>
                <div className="flex flex-col gap-0.5 flex-1">
                    <span className="font-body font-semibold text-[15px] leading-[1.3] text-on-surface">{billing.tierName}</span>
                    <span className="font-body font-normal text-[13px] leading-[1.4] text-on-surface-variant">{priceLine}</span>
                </div>
                {!isBeta && billing.billingConfigured && !billing.betaMode && (
                    <PrimaryButton onClick={() => setChangePlanOpen(true)}>Change plan</PrimaryButton>
                )}
            </div>

            <CreditsMeter
                limit={billing.credits.limitSeconds}
                used={billing.credits.usedSeconds}
                packSeconds={billing.credits.packSeconds}
            />

            {!isBeta && billing.billingConfigured && !billing.betaMode && (
                <div>
                    <TertiaryButton onClick={() => setPacksOpen(true)}>Top up with a one-time pack</TertiaryButton>
                </div>
            )}

            {(hasSubscription || billing.cancelAtPeriodEnd) && (
                <div className="flex items-center gap-3 flex-wrap">
                    {billing.cancelAtPeriodEnd && (
                        <SecondaryButton onClick={() => resume.mutate()} disabled={resume.isPending}>
                            Resume subscription
                        </SecondaryButton>
                    )}
                    <TertiaryButton onClick={() => portal.mutate()}>
                        {portal.isPending ? 'Opening billing portal…' : 'Invoices & payment method'}
                    </TertiaryButton>
                </div>
            )}

            {!isBeta && !billing.billingConfigured && (
                <p className="font-body font-normal text-[12px] leading-normal text-on-surface-variant m-0">
                    Billing isn&apos;t configured in this environment, so plan changes are disabled.
                </p>
            )}

            {changePlanOpen && (
                <ChangePlanDialog
                    billing={billing}
                    onClose={() => setChangePlanOpen(false)}
                    onShowPacks={() => {
                        setChangePlanOpen(false)
                        setPacksOpen(true)
                    }}
                />
            )}
            {packsOpen && (
                <PacksDialog
                    onClose={() => setPacksOpen(false)}
                    onSeePlans={() => {
                        setPacksOpen(false)
                        setChangePlanOpen(true)
                    }}
                />
            )}
        </SettingsSection>
    )
}

/** Today's recording budget as a small meter (resets at midnight UTC), plus
 *  any purchased pack minutes waiting behind it. */
function CreditsMeter({ limit, used, packSeconds = 0 }: { limit: number | null; used: number; packSeconds?: number }) {
    const fmt = formatRecordingTime
    const packLine = packSeconds > 0 && (
        <div className="flex items-center gap-2 font-body font-normal text-[12px] leading-none text-on-surface-variant">
            <Icon name="gift" size={14} />
            <span>
                <span className="font-mono">{fmt(packSeconds)}</span> banked from packs — used once today&apos;s minutes run out, never
                expires.
            </span>
        </div>
    )
    if (limit === null) {
        return (
            <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2 font-body font-normal text-[13px] text-on-surface-variant">
                    <Icon name="infinity" size={16} />
                    Unlimited recording — {fmt(used)} used today.
                </div>
                {packLine}
            </div>
        )
    }
    const pct = Math.min(100, (used / limit) * 100)
    return (
        <div className="flex flex-col gap-1.5">
            <div className="flex justify-between font-body font-normal text-[12px] leading-none text-on-surface-variant">
                <span>Recording today</span>
                <span className="font-mono">
                    {fmt(used)} / {fmt(limit)}
                </span>
            </div>
            <div className="h-1.5 rounded-full bg-surface-container overflow-hidden" role="progressbar" aria-valuenow={Math.round(pct)}>
                <div className={pct >= 100 ? 'h-full bg-error-container' : 'h-full bg-primary-container'} style={{ width: `${pct}%` }} />
            </div>
            {packLine}
        </div>
    )
}
