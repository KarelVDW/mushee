'use client'

import { type CSSProperties, useEffect } from 'react'

import { DialogPanel, DialogScrim, Icon, PrimaryButton, TertiaryButton } from '@/components/ui'
import { formatMoney } from '@/lib/currency'
import { PLAN_TIERS } from '@/lib/plans'
import { usePlans } from '@/lib/queries'
import type { RecordingLimitInfo } from '@/lib/RecordingEngine'
import { useDisplayCurrency } from '@/lib/useDisplayCurrency'

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
    const currency = useDisplayCurrency()

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
                        start at {formatMoney(6, currency)} and never expire.
                    </span>
                </div>
            </DialogPanel>
        </DialogScrim>
    )
}

/**
 * Looping storyboard of the Control Center → Mic Mode → Wide Spectrum flow.
 * Three schematic phases crossfade on a shared 9s loop (keyframes in
 * globals.css); under prefers-reduced-motion they stack as a static list.
 */
function WideSpectrumWalkthrough() {
    const phases = [
        {
            delay: '0s',
            caption: 'Swipe down from the top-right corner',
            scene: (
                <div className="relative w-20 h-24 rounded-[10px] bg-surface-container-lowest tonal-layer-glow">
                    <div className="absolute top-1.5 right-3 h-13 w-0.5 rounded-full bg-primary/30" />
                    <div className="mic-guide-swipe absolute top-1 right-2 w-4 h-4 rounded-full bg-primary" style={{ '--phase-delay': '0s' } as CSSProperties} />
                </div>
            ),
        },
        {
            delay: '3s',
            caption: 'Tap Mic Mode',
            scene: (
                <div className="mic-guide-tap flex items-center gap-2.5 bg-surface-container-lowest tonal-layer-glow rounded-[10px] px-4 py-3" style={{ '--phase-delay': '3s' } as CSSProperties}>
                    <span className="w-8 h-8 rounded-full bg-primary-soft text-on-primary-soft inline-flex items-center justify-center shrink-0">
                        <Icon name="mic" size={16} />
                    </span>
                    <span className="font-body font-semibold text-[13px] text-on-surface">Mic Mode</span>
                </div>
            ),
        },
        {
            delay: '6s',
            caption: 'Choose Wide Spectrum',
            scene: (
                <div className="flex flex-col gap-1 w-44">
                    {['Standard', 'Voice Isolation'].map((mode) => (
                        <span key={mode} className="font-body text-[12px] text-on-surface-variant rounded-sm px-3 py-1.5">
                            {mode}
                        </span>
                    ))}
                    <span className="flex items-center justify-between bg-primary-soft text-on-primary-soft rounded-sm px-3 py-1.5">
                        <span className="font-body font-semibold text-[12px]">Wide Spectrum</span>
                        <span className="mic-guide-pop inline-flex">
                            <Icon name="check" size={14} />
                        </span>
                    </span>
                </div>
            ),
        },
    ]
    return (
        <div className="mic-guide-stage relative h-[150px] flex rounded-[10px] bg-surface-container-low" aria-hidden="true">
            {phases.map((phase) => (
                <div
                    key={phase.delay}
                    className="mic-guide-phase absolute inset-0 flex flex-col items-center justify-center gap-3"
                    style={{ '--phase-delay': phase.delay } as CSSProperties}>
                    {phase.scene}
                    <span className="font-body font-normal text-[12px] leading-[1.4] text-on-surface-variant">{phase.caption}</span>
                </div>
            ))}
        </div>
    )
}

interface MicModeGuideDialogProps {
    /** Confirms the setting and starts the take the user asked for. */
    onConfirm: () => void
    /** Backs out without confirming — the guide returns on the next attempt. */
    onClose: () => void
}

/**
 * Shown once per device, the first time an iPhone user hits record: iOS
 * voice processing erases whistling and instrument tones unless the user
 * sets Control Center's Mic Mode to Wide Spectrum, and no web (or native)
 * API can do it for them — see src/lib/micMode.ts. The confirm button
 * deliberately attests the setting instead of a bare "OK".
 */
export function MicModeGuideDialog({ onConfirm, onClose }: MicModeGuideDialogProps) {
    useEscape(onClose)

    return (
        <DialogScrim onDismiss={onClose}>
            <DialogPanel
                title="iPhone user"
                subtitle="Your iPhone filters the microphone for speech — one setting fixes it."
                onClose={onClose}
                width={480}
                footer={
                    <PrimaryButton icon="mic" onClick={onConfirm}>
                        I&apos;ve set Wide Spectrum — record
                    </PrimaryButton>
                }>
                <div className="flex flex-col gap-3.5 pb-2">
                    <WideSpectrumWalkthrough />
                    <span className="font-body font-normal text-[13px] leading-[1.4] text-on-surface-variant">
                        Without <strong className="text-on-surface">Wide Spectrum</strong>, iOS removes whistling and instrument notes
                        before Solkey can hear them. The Mic Mode control appears in Control Center while a recording is running, and
                        your iPhone remembers the choice for this browser.
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
