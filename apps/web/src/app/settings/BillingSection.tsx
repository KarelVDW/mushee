'use client'

import { Skeleton } from '@mushee/ui'
import { useEffect, useState } from 'react'

import { Alert, Icon, PrimaryButton, SecondaryButton, TertiaryButton } from '@/components/ui'
import { BETA_PLAN, planById, type PlanTier } from '@/lib/plans'
import { useBillingPortal, useBillingState, usePlanCatalogue, useResumeSubscription, useScores } from '@/lib/queries'
import { useDisplayCurrency } from '@/lib/useDisplayCurrency'

import { ChangePlanDialog } from './ChangePlanDialog'
import { PacksDialog } from './PacksDialog'
import { PlanCardCopy } from './PlanCardCopy'
import { SettingsSection } from './SettingsSection'

/** The plan dialog while it is open, and the tier it opens on (else the account's current one). */
interface PlanDialogState {
    initialTier?: PlanTier['id']
}

/**
 * Live Polar-backed subscription state: plan, renewal, today's recording time, actions.
 * `requestedPlan` — a tier a pricing card or an upgrade button sent the visitor here for:
 * the plan dialog opens on arrival with that tier selected, wherever plans can be bought.
 * `requestedPacks` — the visitor followed a minute-packs link: the packs dialog opens on
 * arrival, again only where packs can be bought (otherwise the plan card is all there is).
 */
export function BillingSection({
    requestedPlan,
    requestedPacks = false,
}: {
    requestedPlan?: PlanTier['id'] | null
    requestedPacks?: boolean
}) {
    const { data: billing, isPending, isError, refetch } = useBillingState()
    const catalogue = usePlanCatalogue()
    const scores = useScores()
    const portal = useBillingPortal()
    const resume = useResumeSubscription()
    const [planDialog, setPlanDialog] = useState<PlanDialogState | null>(null)
    const [packsOpen, setPacksOpen] = useState(false)
    const currency = useDisplayCurrency()

    useEffect(() => {
        if (requestedPlan) setPlanDialog({ initialTier: requestedPlan })
    }, [requestedPlan])
    useEffect(() => {
        if (requestedPacks) setPacksOpen(true)
    }, [requestedPacks])

    if (isPending) {
        return (
            <SettingsSection title="Plan & billing" subtitle="Loading your plan…">
                <PlanCardSkeleton />
            </SettingsSection>
        )
    }
    if (isError || !billing) {
        return (
            <SettingsSection title="Plan & billing">
                <Alert onRetry={() => void refetch()}>Couldn&apos;t load your plan.</Alert>
            </SettingsSection>
        )
    }

    const isBeta = billing.tierId === 'beta'
    const plan = catalogue.byId(billing.tierId) ?? planById(billing.tierId)
    const isFree = !isBeta && plan.priceMonthly === 0
    const hasSubscription = Boolean(billing.status)
    // Plans and packs are on offer only where Polar is wired up and the beta isn't running.
    const canPurchase = !isBeta && billing.billingConfigured && !billing.betaMode
    const copy = new PlanCardCopy(billing, plan, catalogue.maxScoresFor(billing.tierId), currency)
    const scoresLine = scores.data ? copy.scoresLine(scores.data.length) : null
    const canCancel = canPurchase && hasSubscription && !billing.cancelAtPeriodEnd
    const openPlans = () => setPlanDialog({})

    return (
        <SettingsSection title="Plan & billing" subtitle={copy.subtitle}>
            {/* On the card itself, not a tinted panel: the tonal "Change plan" capsule needs the white behind it. */}
            <div className="flex items-center gap-4">
                <span className="w-11 h-11 shrink-0 rounded-full bg-primary-soft text-on-primary-soft inline-flex items-center justify-center">
                    <Icon name={isBeta ? BETA_PLAN.icon : plan.icon} size={20} />
                </span>
                <div className="flex flex-col gap-1 flex-1 min-w-0">
                    <span className="font-headline font-semibold text-[20px] leading-tight text-on-surface">{billing.tierName}</span>
                    <span className="font-body font-normal text-[13px] leading-[1.4] text-on-surface-variant">{copy.priceLine}</span>
                </div>
                {/* Sketch's one step is to look at the plans; a paying account's is a quieter "change". */}
                {canPurchase &&
                    (isFree ? (
                        <PrimaryButton onClick={openPlans}>See plans</PrimaryButton>
                    ) : (
                        <SecondaryButton onClick={openPlans}>Change plan</SecondaryButton>
                    ))}
            </div>

            <div className="flex flex-col gap-3">
                <RecordingMeterView copy={copy} />
                {/* Plain words, no second bar: a used-up score meter would read the opposite way to the time gauge above. */}
                {scoresLine && <span className={`${METER_LABEL_CLASS} tabular-nums text-on-surface-variant`}>{scoresLine}</span>}
            </div>

            {(canPurchase || hasSubscription || billing.cancelAtPeriodEnd) && (
                <div className="flex items-center gap-x-5 gap-y-2 flex-wrap">
                    {billing.cancelAtPeriodEnd && (
                        <SecondaryButton onClick={() => resume.mutate()} disabled={resume.isPending}>
                            Resume subscription
                        </SecondaryButton>
                    )}
                    {canPurchase && <TertiaryButton onClick={() => setPacksOpen(true)}>Buy extra minutes</TertiaryButton>}
                    {(hasSubscription || billing.cancelAtPeriodEnd) && (
                        <TertiaryButton onClick={() => portal.mutate()}>
                            {portal.isPending ? 'Opening…' : 'Invoices & payment method'}
                        </TertiaryButton>
                    )}
                    {/* A visible way out: the plan dialog with Sketch picked, which explains what cancelling keeps. */}
                    {canCancel && (
                        <TertiaryButton onClick={() => setPlanDialog({ initialTier: 'free' })}>Cancel subscription</TertiaryButton>
                    )}
                </div>
            )}

            {!isBeta && !billing.billingConfigured && (
                <p className="font-body font-normal text-[12px] leading-normal text-on-surface-variant m-0">
                    Billing isn&apos;t configured in this environment, so plan changes are disabled.
                </p>
            )}

            {planDialog && canPurchase && (
                <ChangePlanDialog
                    billing={billing}
                    initialTier={planDialog.initialTier}
                    onClose={() => setPlanDialog(null)}
                    onShowPacks={() => {
                        setPlanDialog(null)
                        setPacksOpen(true)
                    }}
                />
            )}
            {packsOpen && canPurchase && (
                <PacksDialog
                    billing={billing}
                    onClose={() => setPacksOpen(false)}
                    onSeePlans={() => {
                        setPacksOpen(false)
                        openPlans()
                    }}
                />
            )}
        </SettingsSection>
    )
}

/** The plan card while the billing state loads: the plan row (its 44px mark, two lines) and the meter, in their own geometry. */
function PlanCardSkeleton() {
    return (
        <div aria-hidden="true" className="flex flex-col gap-5">
            <div className="flex items-center gap-4">
                <Skeleton className="size-11 rounded-full" />
                <div className="flex flex-col gap-2 flex-1 min-w-0">
                    <Skeleton className="h-5 w-28 rounded-sm" />
                    <Skeleton className="h-3 w-44 max-w-full rounded-sm" />
                </div>
            </div>
            <div className="flex flex-col gap-1.5">
                <Skeleton className="h-3 w-36 rounded-sm" />
                <Skeleton className="h-2 w-full rounded-full" />
            </div>
        </div>
    )
}

/** The meter's label rows (time today, the score count): 13px, one line height. */
const METER_LABEL_CLASS = 'font-body font-normal text-[13px] leading-[1.3]'

/**
 * Today's recording as a fuel gauge in plain units — the bar is the time left, draining as the
 * day is used and simply empty once it is spent (never red: a limit is not a fault), with when it
 * refills in the viewer's own time — plus any purchased pack minutes waiting behind it. A plan
 * without a daily limit gets one line instead.
 */
function RecordingMeterView({ copy }: { copy: PlanCardCopy }) {
    const { meter, packLine } = copy
    const packs = packLine && (
        <div className="flex items-center gap-2 font-body font-normal text-[12px] leading-[1.4] text-on-surface-variant">
            <Icon name="gift" size={14} />
            <span>{packLine}</span>
        </div>
    )
    if (!meter) {
        return (
            <div className="flex flex-col gap-1.5">
                <span className="font-body font-normal text-[13px] leading-[1.4] text-on-surface-variant">{copy.noLimitLine}</span>
                {packs}
            </div>
        )
    }
    return (
        <div className="flex flex-col gap-1.5">
            <div className={`flex justify-between gap-x-3 gap-y-1 flex-wrap ${METER_LABEL_CLASS}`}>
                <span className="text-on-surface-variant">Recording time today</span>
                <span className="font-medium tabular-nums text-on-surface">{meter.value}</span>
            </div>
            <div
                className="h-2 rounded-full bg-surface-container overflow-hidden"
                role="progressbar"
                aria-label="Recording time left today"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(meter.percentLeft)}
                aria-valuetext={meter.value}>
                <div
                    className="h-full rounded-full bg-primary-container transition-[width] duration-300 ease-solkey motion-reduce:transition-none"
                    style={{ width: `${meter.percentLeft}%` }}
                />
            </div>
            <span className="font-body font-normal text-[12px] leading-[1.4] text-on-surface-variant">{meter.helper}</span>
            {packs}
        </div>
    )
}
