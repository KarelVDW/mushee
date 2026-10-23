'use client'

import Link from 'next/link'
import type { ReactNode } from 'react'

import { DialogPanel, Icon, type IconName, PrimaryButton, TertiaryButton } from '@/components/ui'
import { formatMoney } from '@/lib/currency'
import { BETA_MODE, CHEAPEST_PACK, type PlanTier } from '@/lib/plans'
import { usePlanCatalogue } from '@/lib/queries'
import type { RecordingLimitInfo } from '@/lib/TranscriptionSocket'
import { useDisplayCurrency } from '@/lib/useDisplayCurrency'

import { settingsTabPath } from '../../settings/settingsTabs'
import { MicFailure, RecordingLimitCopy } from './RecordingCopy'

/**
 * The neutral icon row in a recording dialog's body — one anatomy for all of them: the way
 * forward, under an optional title for what is in the way, recessed into the white panel.
 * Never red — none of these is an error. Body text never drops below 13px.
 */
function DialogCallout({ icon, title, body }: { icon: IconName; title?: string; body: ReactNode }) {
    return (
        <div className="flex items-center gap-3.5 bg-surface-container-low rounded-md p-4">
            <span className="w-11 h-11 rounded-full shrink-0 bg-surface-container text-on-surface-variant inline-flex items-center justify-center">
                <Icon name={icon} size={20} />
            </span>
            <div className="flex flex-col gap-0.5">
                {title && <span className="font-body font-semibold text-[14px] leading-[1.3] text-on-surface">{title}</span>}
                <span
                    className={
                        title
                            ? 'font-body font-normal text-[13px] leading-[1.4] text-on-surface-variant'
                            : 'font-body font-normal text-[13px] leading-normal text-on-surface'
                    }>
                    {body}
                </span>
            </div>
        </div>
    )
}

interface RecordingLimitDialogProps {
    info: RecordingLimitInfo
    /** Called with the next tier's id, to open Settings on the plan tab with that tier picked. */
    onUpgrade: (planId: PlanTier['id']) => void
    onClose: () => void
}

/**
 * The day's recording is used up. A normal moment, not an error: it says what the allowance
 * was (in words, never a clock), that everything recorded is in the score, when recording is
 * back in the viewer's own time, and that nothing is ever charged; then — only where the
 * catalogue has a next tier — what that tier gives, behind the same flat 'See {plan}' button
 * the score-limit dialog ends in.
 */
export function RecordingLimitDialog({ info, onUpgrade, onClose }: RecordingLimitDialogProps) {
    const currency = useDisplayCurrency()
    // Off the ladder (the beta plan) or at its top, there is no next tier to offer.
    const next = usePlanCatalogue().nextAfter(info.planId)
    const copy = new RecordingLimitCopy({
        limitSeconds: info.limitSeconds,
        usedSeconds: info.usedSeconds,
        next: next && { name: next.name, dailySeconds: next.dailyRecordingSeconds },
        resetsAt: info.resetsAt,
    })
    // The way forward, in one callout: what the next plan gives (its title) over the minute
    // packs (its body) — either alone as an untitled callout, and none when there is neither.
    const packs = BETA_MODE ? null : (
        <>
            Just need to finish this one?{' '}
            <Link href={`${settingsTabPath('plan')}&packs=1`} className="text-primary underline">
                Minute packs
            </Link>{' '}
            start at {formatMoney(CHEAPEST_PACK.price, currency)} and never expire.
        </>
    )
    const callout =
        copy.upgrade && packs ? (
            <DialogCallout icon="mic" title={copy.upgrade} body={packs} />
        ) : copy.upgrade || packs ? (
            <DialogCallout icon="mic" body={copy.upgrade ?? packs} />
        ) : null

    return (
        <DialogPanel
            title={copy.title}
            subtitle={copy.subtitle}
            onClose={onClose}
            width={480}
            footer={
                <>
                    <TertiaryButton onClick={onClose}>Not now</TertiaryButton>
                    {next && (
                        <PrimaryButton icon="arrow-right" onClick={() => onUpgrade(next.id)}>
                            See {next.name}
                        </PrimaryButton>
                    )}
                </>
            }>
            {callout && <div className="pb-2">{callout}</div>}
        </DialogPanel>
    )
}

/**
 * One step of the Wide Spectrum walkthrough: its number, a small schematic, and what to do.
 * Every schematic sits in the same 96×56 white tile, so the three scenes line up as a column.
 */
function WalkthroughStep({ number, scene, children }: { number: number; scene: ReactNode; children: ReactNode }) {
    return (
        <li className="flex items-center gap-4 rounded-md bg-surface-container-low px-3.5 py-3">
            <span className="font-mono font-medium text-[13px] leading-none text-primary w-3 shrink-0">{number}</span>
            <span aria-hidden className="w-24 shrink-0">
                <span className="relative h-14 w-24 rounded-md bg-surface-container-lowest tonal-layer-glow grid place-items-center">{scene}</span>
            </span>
            <span className="font-body font-normal text-[15px] leading-snug text-on-surface">{children}</span>
        </li>
    )
}

/** The three steps of Control Center → Mic Mode → Wide Spectrum, all visible at once. */
function WideSpectrumSteps() {
    return (
        <ol className="list-none m-0 p-0 flex flex-col gap-2">
            <WalkthroughStep
                number={1}
                scene={
                    // The swipe: a finger at the top-right corner, its trail running down.
                    <>
                        <span className="absolute top-1.5 right-3 h-8 w-0.5 rounded-full bg-primary/30" />
                        <span className="absolute top-1 right-2 size-3 rounded-full bg-primary" />
                    </>
                }>
                Swipe down from the top-right corner to open Control Center.
            </WalkthroughStep>
            <WalkthroughStep
                number={2}
                scene={
                    <span className="inline-flex items-center gap-1.5">
                        <span className="size-5 rounded-full bg-primary-soft text-on-primary-soft inline-flex items-center justify-center">
                            <Icon name="mic" size={11} />
                        </span>
                        <span className="font-body font-semibold text-[11px] leading-none text-on-surface whitespace-nowrap">Mic Mode</span>
                    </span>
                }>
                Tap Mic Mode.
            </WalkthroughStep>
            <WalkthroughStep
                number={3}
                scene={
                    <span className="inline-flex items-center gap-1 bg-primary-soft text-on-primary-soft rounded-sm px-1.5 py-1">
                        <span className="font-body font-semibold text-[11px] leading-tight text-center max-w-18">Wide Spectrum</span>
                        <Icon name="check" size={11} />
                    </span>
                }>
                Choose Wide Spectrum, then come back here.
            </WalkthroughStep>
        </ol>
    )
}

interface MicModeGuideDialogProps {
    /** Confirms the setting and starts the take the user asked for. */
    onConfirm: () => void
    /** Starts the take without confirming — the guide stays away for this visit and returns on the next. */
    onSkip: () => void
    /** Backs out without confirming — no take, and the guide returns on the next attempt. */
    onClose: () => void
}

/**
 * Shown the first time an iPhone user hits record: iOS voice processing erases whistling and
 * instrument tones unless the user sets Control Center's Mic Mode to Wide Spectrum, and no
 * web (or native) API can do it for them — see src/lib/micMode.ts. The tile only exists in
 * Control Center while capture is live, so useRecording holds a warm-up mic stream open for
 * this dialog's lifetime: the steps are performable right now, which is what lets the confirm
 * button attest the setting. "Record without it" is the honest way past it.
 */
export function MicModeGuideDialog({ onConfirm, onSkip, onClose }: MicModeGuideDialogProps) {
    return (
        <DialogPanel
            title="One quick iPhone setting"
            subtitle="iPhones tune the mic for phone calls, which can hide whistling and instruments. Switch it to Wide Spectrum once and you're set."
            onClose={onClose}
            width={480}
            footer={
                <>
                    <TertiaryButton onClick={onSkip}>Record without it</TertiaryButton>
                    <PrimaryButton icon="mic" onClick={onConfirm}>
                        Done — start recording
                    </PrimaryButton>
                </>
            }>
            <div className="flex flex-col gap-3 pb-2">
                <WideSpectrumSteps />
                <span className="font-body font-normal text-[13px] leading-[1.4] text-on-surface-variant">
                    {/* Step 3 already says to come back here; this says why the tile is there now, and that it sticks. */}
                    Your mic is on, so Mic Mode is in Control Center right now. Your iPhone remembers it.
                </span>
            </div>
        </DialogPanel>
    )
}

interface ConcurrentRecordingDialogProps {
    onClose: () => void
}

/**
 * Shown when the gateway refuses a recording because the account already has one in flight —
 * one recording at a time is a hard rule. The refused take is taken back out, so the score is
 * exactly as it was; a recording in a tab just closed frees itself after about 20 seconds.
 */
export function ConcurrentRecordingDialog({ onClose }: ConcurrentRecordingDialogProps) {
    return (
        <DialogPanel
            title="One recording at a time."
            subtitle="You're already recording somewhere else — another tab, or another device."
            onClose={onClose}
            width={480}
            footer={<PrimaryButton onClick={onClose}>Got it</PrimaryButton>}>
            <div className="flex flex-col gap-3.5 pb-2">
                {/* No title of its own: the subtitle already says what is in the way (the account's one
                    recording, not this device's mic) — the callout is what to do about it. */}
                <DialogCallout
                    icon="mic"
                    body="Stop that recording, then press record here. Just closed it? Give it about 20 seconds and try again. Nothing in this score changed."
                />
            </div>
        </DialogPanel>
    )
}

interface MicBlockedDialogProps {
    /** Press Record again. */
    onRetry: () => void
    onClose: () => void
}

/**
 * The browser refused the microphone. Instead of a dead Record button, one plain fix in the
 * user's own browser: where its microphone permission lives, then Try again.
 */
export function MicBlockedDialog({ onRetry, onClose }: MicBlockedDialogProps) {
    const step = typeof navigator === 'undefined' ? null : MicFailure.permissionStep(navigator.userAgent)
    return (
        <DialogPanel
            title="Solkey can't hear you yet"
            subtitle="Your browser is blocking the microphone for this site. Allow it, then try again."
            onClose={onClose}
            width={440}
            footer={
                <>
                    <TertiaryButton onClick={onClose}>Not now</TertiaryButton>
                    <PrimaryButton icon="mic" onClick={onRetry}>
                        Try again
                    </PrimaryButton>
                </>
            }>
            {step && (
                <div className="pb-2">
                    <span className="font-body font-normal text-[14px] leading-normal text-on-surface">{step}</span>
                </div>
            )}
        </DialogPanel>
    )
}
