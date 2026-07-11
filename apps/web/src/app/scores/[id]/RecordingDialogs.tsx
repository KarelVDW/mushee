'use client'

import { useEffect } from 'react'

import { DialogPanel, DialogScrim, Icon, PrimaryButton, TertiaryButton } from '@/components/ui'
import { PLAN_TIERS } from '@/lib/plans'
import { usePlans } from '@/lib/queries'
import type { RecordingLimitInfo } from '@/lib/RecordingEngine'

// Format seconds as S"s" under a minute, M:SS under an hour, then H"h".
function fmtRecTime(sec: number): string {
    const s = Math.max(0, Math.floor(sec))
    if (s < 60) return `${s}s`
    const m = Math.floor(s / 60)
    if (m < 60) return `${m}:${String(s % 60).padStart(2, '0')}`
    const h = Math.floor(m / 60)
    return m % 60 ? `${h}h ${m % 60}m` : `${h}h`
}

function useEscape(onClose: () => void) {
    useEffect(() => {
        const handleEsc = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose()
        }
        window.addEventListener('keydown', handleEsc)
        return () => window.removeEventListener('keydown', handleEsc)
    }, [onClose])
}

interface RecordingLimitDialogProps {
    info: RecordingLimitInfo
    onUpgrade: () => void
    onClose: () => void
}

/**
 * Daily-limit-reached dialog (design: design/ui_kits/web/Editor.jsx →
 * LimitReachedDialog). Tier-aware: every capped tier sees an upgrade CTA;
 * the secondary action acknowledges the cap.
 */
export function RecordingLimitDialog({ info, onUpgrade, onClose }: RecordingLimitDialogProps) {
    useEscape(onClose)

    // The upgrade target comes from the database tier catalogue; the static
    // list only bridges the moment before the query resolves.
    const { data: apiPlans } = usePlans()
    const catalogue = apiPlans?.filter((p) => p.sellable) ?? PLAN_TIERS
    const tierIndex = catalogue.findIndex((p) => p.id === info.planId)
    const nextPlanName = tierIndex >= 0 ? catalogue[tierIndex + 1]?.name : undefined

    return (
        <DialogScrim onDismiss={onClose}>
            <DialogPanel
                title={`You've used today's ${fmtRecTime(info.limitSeconds ?? info.usedSeconds)} of recording.`}
                subtitle={`Your ${info.planName} plan resets at midnight. Until then, playback, editing, and export still work — only mic capture pauses.`}
                onClose={onClose}
                width={480}
                footer={
                    <>
                        <TertiaryButton onClick={onClose}>OK, I&apos;ll wait</TertiaryButton>
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
                            <Icon name="mic-off" size={20} />
                        </span>
                        <div className="flex flex-col gap-0.5">
                            <span className="font-body font-semibold text-[14px] leading-[1.3] text-on-surface">
                                Recording paused until tomorrow
                            </span>
                            <span className="font-body font-normal text-[12px] leading-[1.4] text-on-surface-variant">
                                We stop capture the moment your daily budget runs out — no surprise charges, ever.
                            </span>
                        </div>
                    </div>
                    {nextPlanName && (
                        <span className="font-body font-normal text-[13px] leading-normal text-on-surface-variant">
                            Upgrading to <strong className="text-on-surface">{nextPlanName}</strong> lifts the cap immediately.
                        </span>
                    )}
                    <span className="font-body font-normal text-[12px] leading-normal text-on-surface-variant">
                        Just need to finish this one?{' '}
                        <a href="/settings" className="text-primary underline">
                            One-time minute packs
                        </a>{' '}
                        start at $6 and never expire.
                    </span>
                </div>
            </DialogPanel>
        </DialogScrim>
    )
}

interface ConcurrentRecordingDialogProps {
    onClose: () => void
}

/**
 * Shown when the gateway refuses a recording because the account already has
 * one in flight — one recording at a time is a hard rule.
 */
export function ConcurrentRecordingDialog({ onClose }: ConcurrentRecordingDialogProps) {
    useEscape(onClose)

    return (
        <DialogScrim onDismiss={onClose}>
            <DialogPanel
                title="One recording at a time."
                subtitle="Your account already has a recording running — maybe in another tab, or on another device."
                onClose={onClose}
                width={480}
                footer={<PrimaryButton onClick={onClose}>Got it</PrimaryButton>}>
                <div className="flex flex-col gap-3.5 pb-2">
                    <div className="flex items-center gap-3.5 bg-surface-container-low rounded-[10px] p-4">
                        <span className="w-11 h-11 rounded-full shrink-0 bg-error-container text-on-error-container inline-flex items-center justify-center">
                            <Icon name="mic" size={20} />
                        </span>
                        <div className="flex flex-col gap-0.5">
                            <span className="font-body font-semibold text-[14px] leading-[1.3] text-on-surface">
                                The mic is busy somewhere else
                            </span>
                            <span className="font-body font-normal text-[12px] leading-[1.4] text-on-surface-variant">
                                Finish or stop that session first, then hit record here. Nothing in this score was changed.
                            </span>
                        </div>
                    </div>
                </div>
            </DialogPanel>
        </DialogScrim>
    )
}
