'use client'

import { useEffect } from 'react'

import { DialogPanel, DialogScrim, Icon, PrimaryButton, TertiaryButton } from '@/components/ui'
import { PLAN_TIERS,planById } from '@/lib/plans'
import { useBillingState, usePlans } from '@/lib/queries'

function useEscape(onClose: () => void) {
    useEffect(() => {
        const handleEsc = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose()
        }
        window.addEventListener('keydown', handleEsc)
        return () => window.removeEventListener('keydown', handleEsc)
    }, [onClose])
}

interface ScoreLimitDialogProps {
    onUpgrade: () => void
    onClose: () => void
}

/**
 * Shown when the API refuses a create because the plan's score cap is
 * reached (403 code 'score-limit'). Tier-aware like RecordingLimitDialog:
 * the cap and the upgrade target come from the database catalogue; the
 * static list only bridges the moment before the queries resolve.
 */
export function ScoreLimitDialog({ onUpgrade, onClose }: ScoreLimitDialogProps) {
    useEscape(onClose)

    const { data: billing } = useBillingState()
    const { data: apiPlans } = usePlans()

    // Only the free tier is capped today, so it is the safe fallback while
    // the billing query resolves.
    const planId = billing?.tierId ?? 'free'
    const planName = billing?.tierName ?? planById(planId).name
    const limit = apiPlans?.find((p) => p.id === planId)?.maxScores ?? planById(planId).maxScores

    const catalogue = apiPlans?.filter((p) => p.sellable) ?? PLAN_TIERS
    const tierIndex = catalogue.findIndex((p) => p.id === planId)
    const nextPlanName = tierIndex >= 0 ? catalogue[tierIndex + 1]?.name : undefined

    return (
        <DialogScrim onDismiss={onClose}>
            <DialogPanel
                title={limit !== null ? `Your ${planName} plan holds up to ${limit} scores.` : 'Your score shelf is full.'}
                subtitle="Everything you've written is safe and stays fully editable — the shelf is full, not locked."
                onClose={onClose}
                width={480}
                footer={
                    <>
                        <TertiaryButton onClick={onClose}>Not now</TertiaryButton>
                        {nextPlanName && (
                            <PrimaryButton emphasis="pop" icon="arrow-right" onClick={onUpgrade}>
                                Upgrade to {nextPlanName}
                            </PrimaryButton>
                        )}
                    </>
                }>
                <div className="flex flex-col gap-3.5 pb-2">
                    <div className="flex items-center gap-3.5 bg-surface-container-low rounded-[10px] p-4">
                        <span className="w-11 h-11 rounded-full shrink-0 bg-error-container text-on-error-container inline-flex items-center justify-center">
                            <Icon name="file-music" size={20} />
                        </span>
                        <div className="flex flex-col gap-0.5">
                            <span className="font-body font-semibold text-[14px] leading-[1.3] text-on-surface">
                                No room for a new score right now
                            </span>
                            <span className="font-body font-normal text-[12px] leading-[1.4] text-on-surface-variant">
                                Editing, playback, recording, and export keep working on every score you already have.
                            </span>
                        </div>
                    </div>
                    {nextPlanName && (
                        <span className="font-body font-normal text-[13px] leading-normal text-on-surface-variant">
                            Upgrading to <strong className="text-on-surface">{nextPlanName}</strong> lifts the cap immediately.
                        </span>
                    )}
                    <span className="font-body font-normal text-[12px] leading-normal text-on-surface-variant">
                        Prefer to stay on {planName}? Deleting a score you no longer need frees up a slot.
                    </span>
                </div>
            </DialogPanel>
        </DialogScrim>
    )
}
