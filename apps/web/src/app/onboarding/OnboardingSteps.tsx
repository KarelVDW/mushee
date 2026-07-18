'use client'

import { type Dispatch, type SetStateAction, useState } from 'react'

import { Chip, Eyebrow, Icon, ModalTitle, PrimaryButton, SubHeadline, TertiaryButton, TextField } from '@/components/ui'
import { emailOtp } from '@/lib/auth-client'
import { BETA_PLAN, type Billing, planFeatures, type PlanTier } from '@/lib/plans'
import { useDisplayCurrency } from '@/lib/useDisplayCurrency'
import { Instrument } from '@/model'

import { BACKGROUNDS, NON_INSTRUMENT_OPTIONS, REFERRAL_SOURCES } from './onboarding-data'
import { BillingToggle, OptionCard, StepShell, TierCard } from './OnboardingControls'

export type MicState = 'idle' | 'requesting' | 'granted' | 'denied'

// Step 0 — verify email
export function VerifyStep({
    userEmail,
    sessionEmail,
    verified,
    onVerified,
}: {
    userEmail: string
    sessionEmail: string | null
    verified: boolean
    onVerified: () => void | Promise<void>
}) {
    const [code, setCode] = useState('')
    const [otpError, setOtpError] = useState<string | null>(null)
    const [verifying, setVerifying] = useState(false)
    const [resending, setResending] = useState(false)
    const [resent, setResent] = useState(false)

    const submitCode = async () => {
        if (!/^\d{6}$/.test(code) || !sessionEmail || verifying) return
        setOtpError(null)
        setVerifying(true)
        const { error } = await emailOtp.verifyEmail({ email: sessionEmail, otp: code })
        if (error) {
            setOtpError(error.message ?? "That code didn't work. Try again or request a new one.")
            setVerifying(false)
            return
        }
        setVerifying(false)
        await onVerified()
    }
    const resendCode = async () => {
        if (!sessionEmail || resending) return
        setOtpError(null)
        setResending(true)
        const { error } = await emailOtp.sendVerificationOtp({ email: sessionEmail, type: 'email-verification' })
        setResending(false)
        if (error) {
            setOtpError(error.message ?? 'Could not send a new code.')
            return
        }
        setResent(true)
    }

    return (
        <StepShell
            title="Verify your email."
            subtitle={
                <>
                    We sent a 6-digit code to <strong className="text-on-surface">{userEmail}</strong>. Enter it below to
                    continue — this step protects your scores.
                </>
            }>
            {!verified ? (
                <>
                    <div className="max-w-70">
                        <TextField
                            label="Verification code"
                            value={code}
                            onChange={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))}
                            placeholder="••••••"
                            autoFocus
                        />
                    </div>
                    {otpError && <span className="font-body font-medium text-[12px] leading-[1.4] text-error">{otpError}</span>}
                    <div className="flex gap-3 items-center flex-wrap">
                        <PrimaryButton disabled={!/^\d{6}$/.test(code) || verifying} onClick={() => void submitCode()}>
                            {verifying ? 'Verifying…' : 'Verify'}
                        </PrimaryButton>
                        <TertiaryButton onClick={() => void resendCode()}>
                            {resending ? 'Sending…' : resent ? 'Code sent again' : 'Resend code'}
                        </TertiaryButton>
                    </div>
                </>
            ) : (
                <div className="flex items-center gap-3 bg-surface-container-low rounded-md px-4 py-3.5">
                    <span className="w-7 h-7 rounded-full bg-primary-container text-on-primary-container inline-flex items-center justify-center shrink-0">
                        <Icon name="check" size={16} />
                    </span>
                    <span className="font-body font-medium text-[14px] leading-[1.3] text-on-surface">
                        Email verified. You can continue.
                    </span>
                </div>
            )}
        </StepShell>
    )
}

// Step 1 — mic permission. The state itself lives in the page: `canAdvance`
// depends on it, and it must survive navigating away from this step and back.
export function MicStep({ micState, setMicState }: { micState: MicState; setMicState: (s: MicState) => void }) {
    const requestMic = async () => {
        setMicState('requesting')
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
            // Release the track right away — we only needed the permission grant.
            stream.getTracks().forEach((t) => t.stop())
            setMicState('granted')
        } catch {
            setMicState('denied')
        }
    }

    return (
        <StepShell
            title="Allow microphone access."
            subtitle="Sheemu listens through your microphone to transcribe what you play or hum into notation. We only record while you tap Record — never in the background.">
            <div className="flex items-start gap-4 bg-surface-container-low rounded-md p-5">
                <span
                    className={[
                        'w-12 h-12 rounded-full shrink-0 inline-flex items-center justify-center transition-colors duration-150 ease-sheemu',
                        micState === 'granted'
                            ? 'bg-primary-container text-on-primary-container'
                            : micState === 'denied'
                              ? 'bg-error-container text-on-error-container'
                              : 'bg-surface-container text-on-surface',
                    ].join(' ')}>
                    <Icon name={micState === 'granted' ? 'check' : micState === 'denied' ? 'mic-off' : 'mic'} size={22} />
                </span>
                <div className="flex flex-col gap-1.5 flex-1">
                    <span className="font-body font-semibold text-[15px] leading-[1.3] text-on-surface">
                        {micState === 'granted' && 'Microphone connected.'}
                        {micState === 'denied' && 'Microphone blocked.'}
                        {micState === 'requesting' && 'Waiting for your browser…'}
                        {micState === 'idle' && 'Microphone access needed'}
                    </span>
                    <span className="font-body font-normal text-[13px] leading-normal text-on-surface-variant">
                        {micState === 'granted' && "You're ready to record. Tap Continue."}
                        {micState === 'denied' &&
                            'No problem — the editor works without a mic, and recording will ask again when you need it. To enable it now, update site permissions in your browser and try again, or just Continue.'}
                        {micState === 'requesting' && 'Your browser will ask you to confirm in a moment.'}
                        {micState === 'idle' && 'When you tap Allow, your browser will ask for permission.'}
                    </span>
                </div>
            </div>
            <div className="flex gap-3 items-center flex-wrap">
                {micState !== 'granted' && (
                    <PrimaryButton
                        onClick={() => void requestMic()}
                        disabled={micState === 'requesting'}
                        icon={micState === 'denied' ? 'refresh-cw' : 'mic'}>
                        {micState === 'denied' ? 'Try again' : micState === 'requesting' ? 'Asking…' : 'Allow microphone'}
                    </PrimaryButton>
                )}
                <span className="font-body font-normal text-[12px] leading-[1.4] text-on-surface-variant">
                    You can revoke this any time from Settings.
                </span>
            </div>
        </StepShell>
    )
}

// Step 2 — name
export function NameStep({ value, onChange }: { value: string; onChange: (v: string) => void }) {
    return (
        <StepShell title="What should we call you?" subtitle="This shows up on your scores and lets us greet you properly.">
            <TextField label="Name" value={value} onChange={onChange} placeholder="Anya Mokri" autoFocus />
        </StepShell>
    )
}

// Step 3 — musical background
export function BackgroundStep({ value, onChange }: { value: string | null; onChange: (v: string) => void }) {
    return (
        <StepShell
            title="Where are you in your musical life?"
            subtitle="We tune the editor's defaults and tutorials to your level — pick the closest match.">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {BACKGROUNDS.map(([k, t, b]) => (
                    <OptionCard key={k} active={value === k} onClick={() => onChange(k)} title={t} body={b} />
                ))}
            </div>
        </StepShell>
    )
}

// Step 4 — instruments
export function InstrumentsStep({ value, onChange }: { value: string[]; onChange: Dispatch<SetStateAction<string[]>> }) {
    const toggleInstrument = (i: string) => {
        onChange((prev) => (prev.includes(i) ? prev.filter((x) => x !== i) : [...prev, i]))
    }

    const renderChips = (names: string[]) => (
        <div className="flex flex-wrap gap-2">
            {names.map((i) => (
                <Chip key={i} size="md" active={value.includes(i)} onClick={() => toggleInstrument(i)}>
                    {i}
                </Chip>
            ))}
        </div>
    )

    return (
        <StepShell
            title="Which instruments do you play?"
            subtitle="Pick any that apply — or none, if you're more of a listener. We'll suggest staff layouts based on this.">
            <div className="flex flex-col gap-3.5 max-h-[45dvh] overflow-y-auto pr-1">
                {Instrument.selectableByCategory().map(({ category, instruments }) => (
                    <div key={category} className="flex flex-col gap-2">
                        <Eyebrow>{category}</Eyebrow>
                        {renderChips(instruments.map((i) => i.displayName))}
                    </div>
                ))}
                <div className="flex flex-col gap-2">
                    <Eyebrow>None of the above</Eyebrow>
                    {renderChips(NON_INSTRUMENT_OPTIONS)}
                </div>
            </div>
        </StepShell>
    )
}

// Step 5 — referral source
export function SourceStep({
    source,
    onSourceChange,
    sourceDetail,
    onSourceDetailChange,
}: {
    source: string | null
    onSourceChange: (v: string) => void
    sourceDetail: string
    onSourceDetailChange: (v: string) => void
}) {
    return (
        <StepShell
            title="How did you find Sheemu?"
            subtitle="Helps us know what's working — entirely optional, no wrong answers.">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {REFERRAL_SOURCES.map(([k, label]) => (
                    <OptionCard key={k} active={source === k} onClick={() => onSourceChange(k)} title={label} />
                ))}
            </div>
            {source && (
                <TextField
                    label="Anything else? (optional)"
                    value={sourceDetail}
                    onChange={onSourceDetailChange}
                    placeholder={source === 'friend' ? "Who, if you don't mind sharing?" : 'A name, channel, or link'}
                />
            )}
        </StepShell>
    )
}

// Step 6 — pick a plan (outside beta mode)
export function PlanStep({
    plans,
    billing,
    onBillingChange,
    tier,
    onTierChange,
}: {
    plans: PlanTier[]
    billing: Billing
    onBillingChange: (b: Billing) => void
    tier: PlanTier['id']
    onTierChange: (id: PlanTier['id']) => void
}) {
    const currency = useDisplayCurrency()
    return (
        <StepShell title="Pick a plan to start with." subtitle="You can switch or cancel any time from Settings.">
            <BillingToggle value={billing} onChange={onBillingChange} />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {plans.map((p) => (
                    <TierCard
                        key={p.id}
                        plan={p}
                        billing={billing}
                        currency={currency}
                        active={tier === p.id}
                        onSelect={() => onTierChange(p.id)}
                    />
                ))}
            </div>
        </StepShell>
    )
}

// Step 6 — beta mode: nothing to pick, nothing to pay
export function BetaPlanStep({
    betaPlan,
    awaitingApproval,
}: {
    betaPlan: Pick<PlanTier, 'dailyRecordingSeconds' | 'maxScores' | 'features'> & { name: string; tagline: string }
    awaitingApproval: boolean
}) {
    return (
        <StepShell
            title="You're on the Beta plan."
            subtitle="During the closed beta there's nothing to pick and nothing to pay — every account gets the same plan.">
            <div className="flex items-start gap-4 bg-surface-container-low rounded-md p-5">
                <span className="w-12 h-12 rounded-full bg-primary-soft text-on-primary-soft inline-flex items-center justify-center shrink-0">
                    <Icon name={BETA_PLAN.icon} size={22} />
                </span>
                <div className="flex flex-col gap-1.5">
                    <span className="font-body font-semibold text-[15px] leading-[1.3] text-on-surface">
                        {betaPlan.name} — {betaPlan.tagline.toLowerCase()}
                    </span>
                    <ul className="list-none p-0 m-0 flex flex-col gap-1">
                        {planFeatures(betaPlan).map((f) => (
                            <li
                                key={f}
                                className="flex items-start gap-2 font-body font-normal text-[13px] leading-[1.4] text-on-surface-variant">
                                <span className="mt-px opacity-80">
                                    <Icon name="check" size={14} />
                                </span>
                                {f}
                            </li>
                        ))}
                    </ul>
                </div>
            </div>
            {awaitingApproval && (
                <div className="bg-secondary-soft text-on-secondary-soft rounded-md px-4 py-3.5 font-body font-normal text-[13px] leading-normal">
                    One more thing: beta access is granted personally. Your account is on the waitlist — we&apos;ll email you
                    the moment it&apos;s approved.
                </div>
            )}
        </StepShell>
    )
}

// Success screen shown after the last step
export function DoneStep({
    name,
    awaitingApproval,
    betaPlanName,
    planName,
    onFinish,
}: {
    name: string
    awaitingApproval: boolean
    betaPlanName: string
    planName: string | undefined
    onFinish: () => void
}) {
    return (
        <div className="flex flex-col gap-5 items-start pt-4">
            <div className="w-14 h-14 rounded-full bg-primary-container text-on-primary-container inline-flex items-center justify-center">
                <Icon name="check" size={28} />
            </div>
            <ModalTitle>You&apos;re all set, {name.split(' ')[0] || 'there'}.</ModalTitle>
            <SubHeadline>
                {awaitingApproval ? (
                    <>
                        Your account is ready on the <strong>{betaPlanName}</strong> plan — it just needs a nod from us.
                        We&apos;ll email you the moment your beta access is approved.
                    </>
                ) : (
                    <>
                        Your library is ready on <strong>{planName}</strong>. Start a fresh score, or take the editor for a spin.
                    </>
                )}
            </SubHeadline>
            <div className="flex gap-3 mt-2">
                <PrimaryButton emphasis="pop" icon="arrow-right" onClick={onFinish}>
                    {awaitingApproval ? 'View my status' : 'Open my library'}
                </PrimaryButton>
            </div>
        </div>
    )
}
