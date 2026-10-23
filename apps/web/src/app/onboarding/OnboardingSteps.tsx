'use client'

import { Instrument } from '@mushee/notation/model'
import { SelectedMark } from '@mushee/ui'
import { type KeyboardEvent, type ReactNode, type Ref, useEffect, useEffectEvent, useId, useRef, useState } from 'react'

import { MicFailure } from '@/app/scores/[id]/RecordingCopy'
import { InstrumentChordHint, PopularInstrumentTiles } from '@/app/scores/InstrumentPicker'
import { PlanPicker } from '@/components/PlanPicker'
import { Chip, Eyebrow, Icon, ModalTitle, PrimaryButton, SubHeadline, TertiaryButton, TextField } from '@/components/ui'
import type { BillingInterval } from '@/lib/api'
import { emailOtp } from '@/lib/auth-client'
import { AuthErrorCopy } from '@/lib/AuthErrorCopy'
import { isIPhone, markMicModeGuideConfirmed } from '@/lib/micMode'
import { Microphone } from '@/lib/Microphone'
import type { PlanTier } from '@/lib/plans'
import { formatAllowance } from '@/lib/recordingTime'
import { type RadioProps, useRadioGroup } from '@/lib/useRadioGroup'

import { BACKGROUNDS, GOALS, REFERRAL_SOURCES } from './onboarding-data'

export type MicState = 'idle' | 'requesting' | 'granted' | 'denied'

/** Every step's heading takes focus when the step opens, so a screen reader reads the new question first. */
interface StepProps {
    titleRef: Ref<HTMLHeadingElement>
}

/** How long the "Email verified" row shows before the flow moves on by itself (no animation, so reduced motion keeps it). */
export const VERIFIED_ADVANCE_MS = 600

/** The same beat for "Microphone connected." after a fresh grant off an iPhone. */
export const MIC_GRANTED_ADVANCE_MS = VERIFIED_ADVANCE_MS

/** better-auth's code for a verification code past its 10 minutes; a fresh one is sent at once. */
const OTP_EXPIRED = 'OTP_EXPIRED'

// 'verify' — the emailed 6-digit code. It submits itself: no Verify button and no Continue.
export function VerifyStep({
    userEmail,
    sessionEmail,
    verified,
    onVerified,
    onAdvance,
    onStartOver,
    titleRef,
}: StepProps & {
    userEmail: string
    sessionEmail: string | null
    verified: boolean
    onVerified: () => void | Promise<void>
    /** Moves on once the verified row has shown for a moment. */
    onAdvance: () => void
    /** "Wrong email? Start over": back to signup with the name handed over. */
    onStartOver: () => void
}) {
    const [code, setCode] = useState('')
    const [codeError, setCodeError] = useState<string | null>(null)
    const [verifying, setVerifying] = useState(false)
    const [resend, setResend] = useState<'idle' | 'sending' | 'sent'>('idle')
    const inputRef = useRef<HTMLInputElement | null>(null)

    // Verified — just now, or already when the page opened: show the row, then move on.
    const advance = useEffectEvent(onAdvance)
    useEffect(() => {
        if (!verified) return
        const timer = window.setTimeout(() => advance(), VERIFIED_ADVANCE_MS)
        return () => window.clearTimeout(timer)
    }, [verified])

    const sendNewCode = async (): Promise<boolean> => {
        if (!sessionEmail) return false
        // A new code makes the last error stale; clearing it also lets a repeat of it be read out again.
        setCodeError(null)
        setResend('sending')
        try {
            const { error } = await emailOtp.sendVerificationOtp({ email: sessionEmail, type: 'email-verification' })
            if (error) {
                setCodeError(AuthErrorCopy.for(error).message)
                setResend('idle')
                return false
            }
        } catch (err) {
            setCodeError(AuthErrorCopy.for(err).message)
            setResend('idle')
            return false
        }
        setResend('sent')
        return true
    }

    const submit = async (value: string) => {
        if (!/^\d{6}$/.test(value) || !sessionEmail || verifying) return
        setCodeError(null)
        setVerifying(true)
        let failure: unknown = null
        try {
            const { error } = await emailOtp.verifyEmail({ email: sessionEmail, otp: value })
            failure = error
        } catch (err) {
            failure = err
        }
        setVerifying(false)
        if (!failure) {
            await onVerified()
            return
        }
        // Typing again replaces the code rather than appending to it.
        inputRef.current?.select()
        const expired = typeof failure === 'object' && 'code' in failure && failure.code === OTP_EXPIRED
        if (expired && (await sendNewCode())) {
            setCode('')
            setCodeError("That code has expired, so we've sent you a new one.")
            return
        }
        setCodeError(AuthErrorCopy.for(failure).message)
    }

    // The 6th digit submits — typed, pasted or filled in from the email by the phone.
    const change = (raw: string) => {
        const digits = raw.replace(/\D/g, '').slice(0, 6)
        setCode(digits)
        if (digits.length === 6 && digits !== code) void submit(digits)
    }

    return (
        <StepShell
            titleRef={titleRef}
            title="Verify your email."
            subtitle={
                <>
                    We sent a 6-digit code to <strong className="text-on-surface">{userEmail}</strong>. Enter it below to continue — this
                    step protects your scores.
                </>
            }>
            {/*
             * No gap of its own: the status region is always there (so "Email verified." is read out
             * when it lands, rather than mounting with its text), and takes no room while empty.
             */}
            <div className="flex flex-col">
                <div role="status" className="flex flex-col">
                    {verified && (
                        <div className="flex items-center gap-3 bg-surface-container-low rounded-md px-4 py-3.5 self-start min-w-0 max-w-full">
                            <span className="w-7 h-7 rounded-full bg-primary-container text-on-primary-container inline-flex items-center justify-center shrink-0">
                                <Icon name="check" size={16} />
                            </span>
                            <span className="font-body font-medium text-[14px] leading-[1.3] text-on-surface">Email verified.</span>
                        </div>
                    )}
                </div>
                {!verified && (
                    <div className="flex flex-col gap-5">
                        <CodeField
                            value={code}
                            onChange={change}
                            onEnter={() => void submit(code)}
                            error={codeError}
                            busy={verifying}
                            inputRef={inputRef}
                        />
                        {/* Spaced apart on touch, so the two links' tap areas (INLINE_BUTTON) don't overlap. */}
                        <div className="flex flex-col gap-1.5 pointer-coarse:gap-6 font-body font-normal text-[13px] leading-normal text-on-surface-variant">
                            <p className="m-0" aria-live="polite">
                                Can&apos;t find it? Check your spam folder, or{' '}
                                <button
                                    type="button"
                                    onClick={() => void sendNewCode()}
                                    disabled={resend === 'sending'}
                                    className={INLINE_BUTTON}>
                                    {resend === 'sending' ? 'sending a new code…' : resend === 'sent' ? 'new code sent' : 'send a new code'}
                                </button>
                                .
                            </p>
                            {/*
                             * No account is deleted here: the API has no way for an unverified account to remove
                             * itself yet. The mistyped address keeps an unverified account, and its real owner can
                             * claim it through "reset your password" (the email proves the address is theirs).
                             */}
                            <p className="m-0">
                                Wrong email?{' '}
                                <button type="button" onClick={onStartOver} className={INLINE_BUTTON}>
                                    Start over
                                </button>
                            </p>
                        </div>
                    </div>
                )}
            </div>
        </StepShell>
    )
}

/**
 * A link-styled button inside a sentence of help text. On touch an invisible ::after grows its
 * tap area past 40px tall (DESIGN.md §4b) without spreading the sentence's lines apart.
 */
const INLINE_BUTTON = [
    'relative bg-transparent border-0 p-0 text-primary cursor-pointer font-body text-[13px] underline underline-offset-2 rounded-sm focus-ring disabled:cursor-default',
    "pointer-coarse:after:absolute pointer-coarse:after:-inset-x-1 pointer-coarse:after:-inset-y-3 pointer-coarse:after:content-['']",
].join(' ')

// The kit's centre-out focus stroke, in `primary` (the neon fails 3:1 on the field's fill).
const FOCUS_STROKE =
    'absolute bottom-0 left-1/2 right-1/2 peer-focus:left-0 peer-focus:right-0 h-0.5 bg-primary transition-[left,right] duration-300 ease-solkey motion-reduce:transition-none'

/**
 * The verification code field: the kit's input look (fill, focus stroke, eyebrow label, error
 * wired through aria-describedby), with a numeric keypad, the phone's one-time-code autofill,
 * and 22px Geist Mono digits in a box sized to six of them.
 */
function CodeField({
    value,
    onChange,
    onEnter,
    error,
    busy,
    inputRef,
}: {
    value: string
    onChange: (v: string) => void
    onEnter: () => void
    error: string | null
    busy: boolean
    inputRef: Ref<HTMLInputElement>
}) {
    const id = useId()
    const errorId = `${id}-error`
    const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            e.preventDefault()
            onEnter()
        }
    }
    return (
        <div className="flex flex-col">
            <label
                htmlFor={id}
                className="mb-1.5 font-label font-semibold text-[11px] leading-none tracking-[0.12em] uppercase text-on-surface-variant">
                6-digit code
            </label>
            <div className="relative self-start bg-surface-container-low rounded-sm">
                <input
                    id={id}
                    ref={inputRef}
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    onKeyDown={onKeyDown}
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    enterKeyHint="done"
                    pattern="[0-9]*"
                    autoFocus
                    aria-invalid={error ? true : undefined}
                    aria-describedby={error ? errorId : undefined}
                    aria-busy={busy || undefined}
                    className="peer block bg-transparent border-0 outline-0 px-3 py-3 font-mono font-medium text-[22px] leading-none tracking-[0.3em] text-on-surface w-[calc(6ch+1.8em+1.5rem)]"
                />
                <div className={FOCUS_STROKE} />
            </div>
            {/*
             * Always mounted and live: the code submits itself and focus stays put, so a wrong or
             * expired code is read out as it lands (aria-describedby alone waits for the next focus).
             */}
            <div aria-live="polite">
                {error && (
                    <span id={errorId} className="block mt-1.5 font-body font-medium text-[12px] leading-[1.4] text-error">
                        {error}
                    </span>
                )}
            </div>
        </div>
    )
}

/** The Mic Mode walkthrough, inline in the mic step on iPhones (the editor's dialog then never needs to interrupt a first take). */
const MIC_MODE_STEPS = [
    'Swipe down from the top-right corner to open Control Center.',
    'Tap Mic Mode.',
    'Choose Wide Spectrum, then come back here.',
] as const

// 'mic' — mic permission. The state itself lives in the page: the footer reads it, and it
// must survive navigating away from this step and back.
export function MicStep({
    micState,
    setMicState,
    onContinueHeldChange,
    onAdvance,
    titleRef,
}: StepProps & {
    micState: MicState
    setMicState: (s: MicState) => void
    /**
     * Whether the step leads by itself for now, the footer's Continue held back: while the iPhone
     * walkthrough shows its own buttons, and for the beat before a fresh grant moves on.
     */
    onContinueHeldChange: (held: boolean) => void
    /** 'Not now', 'Done — Wide Spectrum is on' and a fresh grant off an iPhone move on to the next step. */
    onAdvance: () => void
}) {
    // On iPhones the granted stream stays open while the walkthrough shows: Control Center only
    // offers Mic Mode while an app is capturing. Every way out of the step lets go of it.
    const guideStream = useRef<MediaStream | null>(null)
    const [guideOpen, setGuideOpen] = useState(false)

    const release = () => {
        const stream = guideStream.current
        guideStream.current = null
        if (!stream) return
        stream.getTracks().forEach((t) => t.stop())
        Microphone.endSession()
        setGuideOpen(false)
        onContinueHeldChange(false)
    }
    // Back, 'Skip setup' or any other way off the step.
    const releaseOnLeave = useEffectEvent(release)
    useEffect(() => () => releaseOnLeave(), [])

    // A fresh grant off an iPhone leaves nothing to ask: "Microphone connected." shows for a beat,
    // then the flow moves on by itself, as "Email verified" does (Back stays). Only a fresh one —
    // back on this step later, the granted row waits for the footer's Continue.
    const [justGranted, setJustGranted] = useState(false)
    const advance = useEffectEvent(onAdvance)
    const releaseHold = useEffectEvent(() => onContinueHeldChange(false))
    useEffect(() => {
        if (!justGranted) return
        const timer = window.setTimeout(() => advance(), MIC_GRANTED_ADVANCE_MS)
        return () => {
            window.clearTimeout(timer)
            releaseHold()
        }
    }, [justGranted])

    const requestMic = async () => {
        setMicState('requesting')
        try {
            const stream = await Microphone.open({ audio: true })
            if (isIPhone()) {
                guideStream.current = stream
                setGuideOpen(true)
            } else {
                // Only the permission grant was needed.
                stream.getTracks().forEach((t) => t.stop())
                Microphone.endSession()
                setJustGranted(true)
            }
            // Either way the step leads now: the walkthrough's buttons, or the move on by itself.
            onContinueHeldChange(true)
            setMicState('granted')
        } catch {
            setMicState('denied')
        }
    }

    const leave = (confirmedWideSpectrum: boolean) => {
        if (confirmedWideSpectrum) markMicModeGuideConfirmed()
        release()
        onAdvance()
    }

    // Where this browser keeps the microphone permission, in one line; null where there is no
    // reliable path to name. It only shows once blocked, so the server render (no navigator) matches.
    const permissionStep = typeof navigator === 'undefined' ? null : MicFailure.permissionStep(navigator.userAgent)

    return (
        <StepShell
            titleRef={titleRef}
            title="Allow microphone access."
            subtitle="Solkey uses your microphone to hear you sing, hum, whistle or play. It only listens while you press Record, never in the background.">
            <div className="flex items-start gap-4 bg-surface-container-low rounded-md p-5">
                <span
                    className={[
                        'w-12 h-12 rounded-full shrink-0 inline-flex items-center justify-center transition-colors duration-150 ease-solkey',
                        micState === 'granted'
                            ? 'bg-primary-container text-on-primary-container'
                            : micState === 'denied'
                              ? 'bg-error-container text-on-error-container'
                              : 'bg-surface-container text-on-surface',
                    ].join(' ')}>
                    <Icon name={micState === 'granted' ? 'check' : micState === 'denied' ? 'mic-off' : 'mic'} size={22} />
                </span>
                <div className="flex flex-col gap-1.5 flex-1 min-w-0" role="status">
                    <span className="font-body font-semibold text-[15px] leading-[1.3] text-on-surface">
                        {micState === 'granted' && 'Microphone connected.'}
                        {micState === 'denied' && 'Microphone blocked.'}
                        {micState === 'requesting' && 'Waiting for your browser…'}
                        {micState === 'idle' && 'Microphone access needed'}
                    </span>
                    <span className="font-body font-normal text-[13px] leading-normal text-on-surface-variant">
                        {micState === 'granted' &&
                            (guideOpen
                                ? 'One iPhone setting first. Your iPhone tunes its mic for phone calls, which hides whistling and instruments. Switch it once and it stays that way.'
                                : "You're ready to record.")}
                        {micState === 'denied' &&
                            'No problem — the editor works without a mic, and recording will ask again when you need it.'}
                        {micState === 'requesting' && 'Your browser will ask you to confirm in a moment.'}
                        {micState === 'idle' && 'Your browser will ask for permission next.'}
                    </span>
                </div>
            </div>

            {micState === 'granted' && guideOpen && (
                <div className="flex flex-col gap-3">
                    <ol className="m-0 pl-0 list-none flex flex-col gap-2.5">
                        {MIC_MODE_STEPS.map((text, index) => (
                            <li
                                key={text}
                                className="flex items-start gap-3 font-body font-normal text-[15px] leading-normal text-on-surface">
                                <span
                                    aria-hidden="true"
                                    className="size-6 shrink-0 rounded-full bg-primary-soft text-on-primary-soft inline-flex items-center justify-center font-mono text-[12px] font-semibold">
                                    {index + 1}
                                </span>
                                {text}
                            </li>
                        ))}
                    </ol>
                    <p className="m-0 font-body font-normal text-[12px] leading-[1.4] text-on-surface-variant">
                        Solkey has the mic open only so this setting shows up. Nothing is recorded until you press Record.
                    </p>
                    <div className="flex gap-x-5 gap-y-2 items-center flex-wrap">
                        <PrimaryButton onClick={() => leave(true)}>Done — Wide Spectrum is on</PrimaryButton>
                        <TertiaryButton onClick={() => leave(false)}>Not now</TertiaryButton>
                    </div>
                </div>
            )}

            {micState !== 'granted' && (
                <div className="flex flex-col gap-3">
                    {micState === 'denied' ? (
                        // Blocked: the footer's Continue is the one next step. Browsers remember a block,
                        // so Try again stays quiet, after the line saying where this browser keeps it.
                        <>
                            {permissionStep && (
                                <p className="m-0 font-body font-normal text-[13px] leading-normal text-on-surface">
                                    To allow it now: {permissionStep} Then Try again.
                                </p>
                            )}
                            <div>
                                <TertiaryButton onClick={() => void requestMic()}>
                                    <span className="inline-flex items-center gap-1.5">
                                        <Icon name="refresh-cw" size={13} />
                                        Try again
                                    </span>
                                </TertiaryButton>
                            </div>
                        </>
                    ) : (
                        <div className="flex gap-x-5 gap-y-2 items-center flex-wrap">
                            <PrimaryButton onClick={() => void requestMic()} disabled={micState === 'requesting'} icon="mic">
                                {micState === 'requesting' ? 'Asking…' : 'Allow microphone'}
                            </PrimaryButton>
                            {/* Skipping the mic skips only the mic. A yes moves on by itself; after a no, the footer's Continue leads. */}
                            <TertiaryButton onClick={onAdvance}>Not now</TertiaryButton>
                        </div>
                    )}
                    {/* Said once: where this browser keeps the setting (above, when blocked), else this. */}
                    {!(micState === 'denied' && permissionStep) && (
                        <span className="font-body font-normal text-[12px] leading-[1.4] text-on-surface-variant">
                            You can change this any time in your browser&apos;s site settings.
                        </span>
                    )}
                </div>
            )}
        </StepShell>
    )
}

/** The instrument a chordal pick names in the melody line (C13): the first picked one that plays chords. */
function firstChordal(instruments: ReadonlyArray<Instrument>): Instrument | undefined {
    return instruments.find((i) => i.playsChords)
}

// 'instruments' — "What will you record?": the popular tiles, the rest behind "All instruments".
export function InstrumentsStep({
    value,
    onChange,
    titleRef,
}: StepProps & {
    value: ReadonlyArray<Instrument>
    onChange: (instruments: Instrument[]) => void
}) {
    const popular = Instrument.popular()
    const [expanded, setExpanded] = useState(() => value.some((i) => !popular.includes(i)))
    const others = Instrument.byCategory(Instrument.pickable().filter((i) => !popular.includes(i)))
    const toggle = (instrument: Instrument) =>
        onChange(value.includes(instrument) ? value.filter((i) => i !== instrument) : [...value, instrument])
    const chordal = firstChordal(value)

    return (
        <StepShell
            titleRef={titleRef}
            title="What will you record?"
            subtitle="Pick any that apply — or none. Your first pick becomes your first score's instrument.">
            <div className="flex flex-col gap-3">
                <PopularInstrumentTiles multiple value={value} onChange={onChange} />
                {/* Always mounted, so a screen reader hears the line the moment a chordal pick adds it. */}
                <div aria-live="polite">{chordal && <InstrumentChordHint instrument={chordal} />}</div>
                <button
                    type="button"
                    aria-expanded={expanded}
                    onClick={() => setExpanded((open) => !open)}
                    className={[
                        'self-start inline-flex items-center gap-1.5 bg-transparent border-0 cursor-pointer py-2 px-0 pointer-coarse:min-h-10',
                        'font-body font-medium text-[13px] leading-none text-on-surface-variant hover:text-primary',
                        'transition-colors duration-150 ease-solkey focus-ring rounded-sm',
                    ].join(' ')}>
                    All instruments
                    <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={14} />
                </button>
                {expanded && (
                    <div className="flex flex-col gap-3.5 max-h-[45dvh] overflow-y-auto pr-1">
                        {others.map(({ category, instruments }) => (
                            <div key={category} className="flex flex-col gap-2">
                                <Eyebrow>{category}</Eyebrow>
                                <div className="flex flex-wrap gap-2">
                                    {instruments.map((i) => (
                                        <Chip
                                            key={i.id}
                                            size="md"
                                            active={value.includes(i)}
                                            onClick={() => toggle(i)}
                                            ariaLabel={`Pick ${i.displayName}`}>
                                            {i.displayName}
                                        </Chip>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </StepShell>
    )
}

// 'about' — the optional survey: three single-choice rows on one screen, nothing chosen up front.
export function AboutStep({
    background,
    onBackgroundChange,
    goal,
    onGoalChange,
    source,
    onSourceChange,
    sourceDetail,
    onSourceDetailChange,
    titleRef,
}: StepProps & {
    background: string | null
    onBackgroundChange: (v: string) => void
    goal: string | null
    onGoalChange: (v: string) => void
    source: string | null
    onSourceChange: (v: string) => void
    sourceDetail: string
    onSourceDetailChange: (v: string) => void
}) {
    // One follow-up per source, asked by the field's label alone: no placeholder posing a second question.
    const detailQuestion = REFERRAL_SOURCES.find((s) => s.key === source)?.detailQuestion
    return (
        <StepShell titleRef={titleRef} title="A bit about you." subtitle="Optional. It helps us build the right things.">
            <div className="flex flex-col gap-7">
                <ChoiceRow label="Where are you with music?" options={BACKGROUNDS} value={background} onChange={onBackgroundChange} />
                <ChoiceRow label="What do you want to do first?" options={GOALS} value={goal} onChange={onGoalChange} />
                <div className="flex flex-col gap-3">
                    <ChoiceRow label="How did you find Solkey?" options={REFERRAL_SOURCES} value={source} onChange={onSourceChange} />
                    {detailQuestion && (
                        <TextField
                            label={
                                // The field's own label, in the questions' voice rather than the eyebrow's.
                                <span className={`${QUESTION_CLASS} normal-case tracking-normal`}>
                                    {detailQuestion}
                                    <span className="font-normal text-on-surface-variant"> (optional)</span>
                                </span>
                            }
                            value={sourceDetail}
                            onChange={onSourceDetailChange}
                        />
                    )}
                </div>
            </div>
        </StepShell>
    )
}

/** A survey question's voice: a 15px semibold sentence. */
const QUESTION_CLASS = 'font-body font-semibold text-[15px] leading-[1.3] text-on-surface'

/** A question with its single-choice answers: a radiogroup named by the question, one Tab stop, arrows move. */
function ChoiceRow({
    label,
    options,
    value,
    onChange,
}: {
    label: string
    options: ReadonlyArray<{ key: string; label: string }>
    value: string | null
    onChange: (key: string) => void
}) {
    const labelId = useId()
    const radios = useRadioGroup(
        options.map((o) => o.key),
        value,
        onChange,
    )
    return (
        <div className="flex flex-col gap-2.5">
            <span id={labelId} className={QUESTION_CLASS}>
                {label}
            </span>
            <div role="radiogroup" aria-labelledby={labelId} className="flex flex-wrap gap-2">
                {options.map((option, index) => (
                    <ChoiceChip
                        key={option.key}
                        radio={radios.radioProps(index)}
                        checked={value === option.key}
                        onClick={() => onChange(option.key)}>
                        {option.label}
                    </ChoiceChip>
                ))}
            </div>
        </div>
    )
}

/**
 * One answer: an outlined 18px ring at rest on the tile fill; chosen, the selected fill and a
 * SelectedMark in the ring's place, so the choice never rests on colour alone.
 */
function ChoiceChip({
    radio,
    checked,
    onClick,
    children,
}: {
    radio: RadioProps
    checked: boolean
    onClick: () => void
    children: ReactNode
}) {
    return (
        <button
            {...radio}
            type="button"
            role="radio"
            aria-checked={checked}
            onClick={onClick}
            className={[
                'inline-flex items-center gap-2 rounded-full border-0 pl-2.5 pr-4 py-2 min-h-9 pointer-coarse:min-h-10 cursor-pointer text-left',
                'font-body font-medium text-[14px] leading-tight transition-colors duration-150 ease-solkey focus-ring',
                checked
                    ? 'bg-(--color-selected) text-(--color-on-selected)'
                    : 'bg-surface-container-low text-on-surface hover:bg-surface-container-high',
            ].join(' ')}>
            {/* The ring's 18px slot holds the mark too, so the label never shifts when picked. */}
            <span
                aria-hidden="true"
                className={[
                    'size-4.5 shrink-0 rounded-full inline-flex items-center justify-center',
                    checked ? '' : 'border-2 border-solid border-outline',
                ].join(' ')}>
                {checked && <SelectedMark size="sm" />}
            </span>
            {children}
        </button>
    )
}

/** The plan step's subtitle: what the free plan holds, from the catalogue (never hard-coded). */
function freePlanSummary(free: PlanTier): string {
    const recording =
        free.dailyRecordingSeconds === null
            ? 'no daily recording limit'
            : `${formatAllowance(free.dailyRecordingSeconds)} of recording a day`
    const scores = free.maxScores === null ? 'as many scores as you like' : `up to ${free.maxScores} scores`
    return `${free.name} is free forever: ${recording} and ${scores}. Upgrade any time in Settings.`
}

// 'plan' — only for a visitor who picked a paid plan on the pricing page; that tier comes chosen.
export function PlanStep({
    plans,
    freePlan,
    billing,
    onBillingChange,
    tier,
    onTierChange,
    titleRef,
}: StepProps & {
    plans: PlanTier[]
    freePlan: PlanTier
    billing: BillingInterval
    onBillingChange: (b: BillingInterval) => void
    tier: PlanTier['id']
    onTierChange: (id: PlanTier['id']) => void
}) {
    // Radio rows at every width: the chosen plan and the button that acts on it share one screen,
    // and the white card never holds a pricing page's cards (those are for /pricing and Settings).
    return (
        <StepShell titleRef={titleRef} title="Start free, or pick a plan." subtitle={freePlanSummary(freePlan)}>
            <PlanPicker plans={plans} billing={billing} onBillingChange={onBillingChange} selected={tier} onSelect={onTierChange} compact />
        </StepShell>
    )
}

/** Which way the done screen sends the user on. */
export type DoneDestination =
    /** Straight into a new score, ready to record (the usual end). */
    | 'first-melody'
    /** The closed-beta waiting room. */
    | 'beta'
    /** Wherever they were heading before signup (a shared score), via ?next=. */
    | 'next'

// The screen after the last step.
export function DoneStep({
    name,
    destination,
    betaPlanName,
    planLine,
    creating,
    onRecordFirstMelody,
    onFinish,
    titleRef,
}: StepProps & {
    name: string
    destination: DoneDestination
    betaPlanName: string
    /** The 13px line naming the plan the account is on ("You're on Sketch — free, …"); null to leave it out. */
    planLine: string | null
    /** The first melody's score is being created. */
    creating: boolean
    onRecordFirstMelody: () => void
    /** The library, the waiting room or the ?next= destination. */
    onFinish: () => void
}) {
    return (
        <div className="flex flex-col gap-5 items-start pt-4">
            <div className="w-14 h-14 rounded-full bg-primary-container text-on-primary-container inline-flex items-center justify-center">
                <Icon name="check" size={28} />
            </div>
            <ModalTitle ref={titleRef} tabIndex={-1}>
                You&apos;re all set, {name.trim().split(/\s+/)[0] || 'there'}.
            </ModalTitle>
            <div className="flex flex-col gap-2">
                <SubHeadline>
                    {destination === 'beta' ? (
                        <>
                            Your account is ready on the <strong>{betaPlanName}</strong> plan — it just needs a nod from us. We&apos;ll
                            email you the moment your beta access is approved.
                        </>
                    ) : destination === 'next' ? (
                        <>Your library is ready. Start a fresh score, or take the editor for a spin.</>
                    ) : (
                        <>Let&apos;s get your first melody down. Press record, then sing, hum or play, and Solkey writes the notes.</>
                    )}
                </SubHeadline>
                {planLine && <p className="m-0 font-body font-normal text-[13px] leading-normal text-on-surface-variant">{planLine}</p>}
            </div>
            {destination === 'first-melody' ? (
                <div className="flex gap-x-5 gap-y-2 mt-2 items-center flex-wrap">
                    <PrimaryButton emphasis="pop" icon="arrow-right" onClick={onRecordFirstMelody} disabled={creating}>
                        {creating ? 'Getting it ready…' : 'Record my first melody'}
                    </PrimaryButton>
                    <TertiaryButton onClick={onFinish}>Go to my library</TertiaryButton>
                </div>
            ) : (
                <div className="flex gap-3 mt-2">
                    <PrimaryButton emphasis="pop" icon="arrow-right" onClick={onFinish}>
                        {destination === 'beta' ? 'View my status' : 'Open my library'}
                    </PrimaryButton>
                </div>
            )}
        </div>
    )
}

// Building blocks of the steps above

function StepShell({
    title,
    subtitle,
    titleRef,
    children,
}: StepProps & {
    title: ReactNode
    subtitle: ReactNode
    children: ReactNode
}) {
    return (
        <div className="flex flex-col gap-5">
            {/* Focusable by script only (no ring): the page moves focus here when the step opens. */}
            <ModalTitle ref={titleRef} tabIndex={-1}>
                {title}
            </ModalTitle>
            <SubHeadline>{subtitle}</SubHeadline>
            {children}
        </div>
    )
}
