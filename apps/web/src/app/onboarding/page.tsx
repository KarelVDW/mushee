'use client'

import { useRouter } from 'next/navigation'
import { type ReactNode, useState } from 'react'

import { Chip, Eyebrow, Icon, ModalTitle, PrimaryButton, SubHeadline, TertiaryButton, TextField, Wordmark } from '@/components/ui'
import { track } from '@/lib/analytics'
import { type OnboardingPatch } from '@/lib/api'
import { emailOtp, useSession } from '@/lib/auth-client'
import { BETA_MODE, BETA_PLAN, type Billing, PLAN_TIERS, planById, planFeatures, type PlanTier } from '@/lib/plans'
import { useBetaStatus, usePatchOnboarding, usePlans, useStartCheckout } from '@/lib/queries'

const BACKGROUNDS: [string, string, string][] = [
    ['curious', 'Just curious', 'I tinker with melodies sometimes.'],
    ['hobbyist', 'Hobbyist', 'I play for myself — a few years in.'],
    ['student', 'Student', 'Studying music formally right now.'],
    ['teacher', 'Teacher', 'I teach others to play or compose.'],
    ['composer', 'Composer / arranger', 'I write or arrange music regularly.'],
    ['professional', 'Performing musician', 'I gig, record, or perform for a living.'],
]

const PRIMARY_INSTRUMENTS = [
    'Piano',
    'Guitar',
    'Violin',
    'Cello',
    'Flute',
    'Clarinet',
    'Voice',
    'Trumpet',
    'Drums',
    'Bass',
    'Other',
    "I don't play (yet)",
]

const REFERRAL_SOURCES: [string, string][] = [
    ['friend', 'A friend told me'],
    ['search', 'Found it on a search engine'],
    ['social', 'Saw it on social media'],
    ['youtube', 'Saw it on YouTube'],
    ['teacher', 'My teacher recommended it'],
    ['blog', 'Read about it in an article'],
    ['other', 'Somewhere else'],
]

function formatPrice(plan: PlanTier, billing: Billing): { amount: string; cadence: string } {
    if (plan.priceMonthly === 0) return { amount: 'Free', cadence: 'forever' }
    if (billing === 'yearly') {
        const monthlyEquiv = (plan.priceYearly / 12).toFixed(plan.priceYearly % 12 === 0 ? 0 : 2)
        return { amount: `$${monthlyEquiv}`, cadence: '/month, billed yearly' }
    }
    return { amount: `$${plan.priceMonthly}`, cadence: '/month' }
}

// Steps in order: verify email, mic permission, name, background, instruments, source, tier.
const STEP_COUNT = 7

type MicState = 'idle' | 'requesting' | 'granted' | 'denied'

export default function OnboardingPage() {
    const router = useRouter()
    const patchMutation = usePatchOnboarding()
    const startCheckout = useStartCheckout()
    // Tier names and recording budgets come from the database catalogue; the
    // static entries decorate it and bridge the moment before it resolves.
    const { data: apiPlans } = usePlans()
    const displayPlans: PlanTier[] = apiPlans
        ? apiPlans
              .filter((p) => p.sellable)
              .map((p) => ({
                  ...planById(p.id),
                  id: p.id as PlanTier['id'],
                  name: p.name,
                  dailyRecordingSeconds: p.dailyRecordingCredits,
              }))
        : PLAN_TIERS
    const betaApiPlan = apiPlans?.find((p) => p.id === BETA_PLAN.id)
    const betaPlan = betaApiPlan
        ? { ...BETA_PLAN, name: betaApiPlan.name, dailyRecordingSeconds: betaApiPlan.dailyRecordingCredits }
        : BETA_PLAN
    const { data: session, refetch } = useSession()
    const sessionEmail = session?.user?.email ?? null
    const verified = session?.user?.emailVerified ?? false
    const userEmail = sessionEmail ?? 'your inbox'
    // During the closed beta, unapproved users end up on the waiting page.
    const betaStatus = useBetaStatus({ enabled: BETA_MODE && !!session?.user })
    const awaitingApproval = BETA_MODE && betaStatus.data?.status === 'pending'

    const [step, setStep] = useState(0)

    // Step 0 — verify email
    const [code, setCode] = useState('')
    const [otpError, setOtpError] = useState<string | null>(null)
    const [verifying, setVerifying] = useState(false)
    const [resending, setResending] = useState(false)
    const [resent, setResent] = useState(false)

    // Step 1 — mic permission
    const [micState, setMicState] = useState<MicState>('idle')

    // Steps 2–6 — preferences
    const [name, setName] = useState(session?.user?.name ?? '')
    const [background, setBackground] = useState<string | null>(null)
    const [instruments, setInstruments] = useState<string[]>([])
    const [source, setSource] = useState<string | null>(null)
    const [sourceDetail, setSourceDetail] = useState('')
    const [tier, setTier] = useState<PlanTier['id']>('pro')
    const [billing, setBilling] = useState<Billing>('monthly')
    const [done, setDone] = useState(false)

    const toggleInstrument = (i: string) => {
        setInstruments((prev) => (prev.includes(i) ? prev.filter((x) => x !== i) : [...prev, i]))
    }

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
        await refetch()
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

    const canAdvance = (() => {
        switch (step) {
            case 0:
                return verified
            case 1:
                // Denied still advances: the editor works fine without a mic
                // (recording asks again later), and a desktop user with no
                // microphone must not be walled out of the rest of onboarding.
                return micState === 'granted' || micState === 'denied'
            case 2:
                return name.trim().length > 0
            case 3:
                return !!background
            case 4:
                return instruments.length > 0
            case 5:
                return !!source
            case 6:
                return true
            default:
                return true
        }
    })()

    const patchForStep = (s: number): OnboardingPatch | null => {
        switch (s) {
            case 3:
                return background ? { background } : null
            case 4:
                return { instruments }
            case 5:
                return source ? { source, sourceDetail: sourceDetail.trim() } : null
            case 6:
                return { completedAt: new Date().toISOString() }
            default:
                return null
        }
    }

    const next = () => {
        const patch = patchForStep(step)
        // Persistence is best-effort and never blocks progress; a failure
        // surfaces as a toast through the global mutation error handler.
        if (patch) patchMutation.mutate(patch)
        if (step === STEP_COUNT - 1) {
            track('onboarding_completed', { tier: BETA_MODE ? 'beta' : tier })
            // Paid pick → straight into Polar checkout; on failure (or beta
            // mode, where plans can't be bought) fall through to the done screen.
            if (!BETA_MODE && tier !== 'free') {
                startCheckout.mutate({ tierId: tier, interval: billing }, { onError: () => setDone(true) })
                return
            }
            setDone(true)
            return
        }
        setStep((s) => Math.min(s + 1, STEP_COUNT - 1))
    }
    const back = () => setStep((s) => Math.max(s - 1, 0))
    const skip = () => router.push(awaitingApproval ? '/beta' : '/scores')
    const finish = () => router.push(awaitingApproval ? '/beta' : '/scores')

    return (
        <main className="min-h-screen bg-surface flex flex-col items-center px-6 py-8">
            <header className="w-full max-w-180 flex justify-between items-center">
                <Wordmark size={26} />
                {!done && step > 0 ? <TertiaryButton onClick={skip}>Skip for now</TertiaryButton> : <span />}
            </header>

            <div className="w-full max-w-180 mt-12 bg-surface-container-lowest rounded-xl editorial-shadow px-12 py-10 flex flex-col gap-7">
                {!done && <StepProgress step={step} total={STEP_COUNT} />}

                {!done && step === 0 && (
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
                )}

                {!done && step === 1 && (
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
                )}

                {!done && step === 2 && (
                    <StepShell title="What should we call you?" subtitle="This shows up on your scores and lets us greet you properly.">
                        <TextField label="Name" value={name} onChange={setName} placeholder="Anya Mokri" autoFocus />
                    </StepShell>
                )}

                {!done && step === 3 && (
                    <StepShell
                        title="Where are you in your musical life?"
                        subtitle="We tune the editor's defaults and tutorials to your level — pick the closest match.">
                        <div className="grid grid-cols-2 gap-3">
                            {BACKGROUNDS.map(([k, t, b]) => (
                                <OptionCard key={k} active={background === k} onClick={() => setBackground(k)} title={t} body={b} />
                            ))}
                        </div>
                    </StepShell>
                )}

                {!done && step === 4 && (
                    <StepShell
                        title="Which instruments do you play?"
                        subtitle="Pick any that apply — or none, if you're more of a listener. We'll suggest staff layouts based on this.">
                        <div className="flex flex-wrap gap-2">
                            {PRIMARY_INSTRUMENTS.map((i) => (
                                <Chip key={i} size="md" active={instruments.includes(i)} onClick={() => toggleInstrument(i)}>
                                    {i}
                                </Chip>
                            ))}
                        </div>
                    </StepShell>
                )}

                {!done && step === 5 && (
                    <StepShell
                        title="How did you find Sheemu?"
                        subtitle="Helps us know what's working — entirely optional, no wrong answers.">
                        <div className="grid grid-cols-2 gap-2">
                            {REFERRAL_SOURCES.map(([k, label]) => (
                                <OptionCard key={k} active={source === k} onClick={() => setSource(k)} title={label} />
                            ))}
                        </div>
                        {source && (
                            <TextField
                                label="Anything else? (optional)"
                                value={sourceDetail}
                                onChange={setSourceDetail}
                                placeholder={source === 'friend' ? "Who, if you don't mind sharing?" : 'A name, channel, or link'}
                            />
                        )}
                    </StepShell>
                )}

                {!done && step === 6 && !BETA_MODE && (
                    <StepShell title="Pick a plan to start with." subtitle="You can switch or cancel any time from Settings.">
                        <BillingToggle value={billing} onChange={setBilling} />
                        <div className="grid grid-cols-3 gap-3">
                            {displayPlans.map((p) => (
                                <TierCard key={p.id} plan={p} billing={billing} active={tier === p.id} onSelect={() => setTier(p.id)} />
                            ))}
                        </div>
                    </StepShell>
                )}

                {!done && step === 6 && BETA_MODE && (
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
                )}

                {done && (
                    <div className="flex flex-col gap-5 items-start pt-4">
                        <div className="w-14 h-14 rounded-full bg-primary-container text-on-primary-container inline-flex items-center justify-center">
                            <Icon name="check" size={28} />
                        </div>
                        <ModalTitle>You&apos;re all set, {name.split(' ')[0] || 'there'}.</ModalTitle>
                        <SubHeadline>
                            {awaitingApproval ? (
                                <>
                                    Your account is ready on the <strong>{betaPlan.name}</strong> plan — it just needs a nod from us.
                                    We&apos;ll email you the moment your beta access is approved.
                                </>
                            ) : (
                                <>
                                    Your library is ready on{' '}
                                    <strong>{BETA_MODE ? betaPlan.name : displayPlans.find((p) => p.id === tier)?.name}</strong>. Start a
                                    fresh score, or take the editor for a spin.
                                </>
                            )}
                        </SubHeadline>
                        <div className="flex gap-3 mt-2">
                            <PrimaryButton emphasis="pop" icon="arrow-right" onClick={finish}>
                                {awaitingApproval ? 'View my status' : 'Open my library'}
                            </PrimaryButton>
                        </div>
                    </div>
                )}

                {!done && (
                    <div className="flex justify-between items-center pt-3">
                        {step > 0 ? (
                            <TertiaryButton onClick={back}>
                                <span className="inline-flex items-center gap-1.5">
                                    <Icon name="arrow-left" size={13} />
                                    Back
                                </span>
                            </TertiaryButton>
                        ) : (
                            <span />
                        )}
                        <PrimaryButton disabled={!canAdvance} icon="arrow-right" emphasis="pop" onClick={next}>
                            {step === STEP_COUNT - 1 ? 'Finish' : 'Continue'}
                        </PrimaryButton>
                    </div>
                )}
            </div>
        </main>
    )
}

function StepShell({ title, subtitle, children }: { title: ReactNode; subtitle: ReactNode; children: ReactNode }) {
    return (
        <div className="flex flex-col gap-5">
            <ModalTitle>{title}</ModalTitle>
            <SubHeadline>{subtitle}</SubHeadline>
            {children}
        </div>
    )
}

function StepProgress({ step, total }: { step: number; total: number }) {
    return (
        <div className="flex gap-1.5 items-center">
            {Array.from({ length: total }).map((_, i) => (
                <div
                    key={i}
                    className={[
                        'h-1 rounded-sm flex-1 max-w-12 transition-colors duration-200 ease-sheemu',
                        i <= step ? 'bg-primary-container' : 'bg-surface-container',
                    ].join(' ')}
                />
            ))}
            <Eyebrow className="ml-2">
                {Math.min(step + 1, total)} of {total}
            </Eyebrow>
        </div>
    )
}

function OptionCard({ active, onClick, title, body }: { active?: boolean; onClick?: () => void; title: ReactNode; body?: ReactNode }) {
    return (
        <button
            onClick={onClick}
            type="button"
            className={[
                'text-left border-0 rounded-md px-5 py-4.5 cursor-pointer flex gap-3.5 items-start transition-colors duration-150 ease-sheemu',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
                active ? 'bg-primary-soft text-on-primary-soft' : 'bg-surface-container-lowest text-on-surface tonal-layer-glow hover:bg-surface-container',
            ].join(' ')}>
            <div className="flex flex-col gap-1">
                <span className="font-body font-semibold text-[15px] leading-[1.2]">{title}</span>
                {body && (
                    <span
                        className={[
                            'font-body font-normal text-[13px] leading-[1.4] opacity-85',
                            active ? 'text-on-primary-soft' : 'text-on-surface-variant',
                        ].join(' ')}>
                        {body}
                    </span>
                )}
            </div>
        </button>
    )
}

function BillingToggle({ value, onChange }: { value: Billing; onChange: (v: Billing) => void }) {
    return (
        <div role="radiogroup" aria-label="Billing cadence" className="inline-flex p-0.75 rounded-full bg-surface-container-low self-start">
            {(
                [
                    ['monthly', 'Monthly'],
                    ['yearly', 'Yearly · save 17%'],
                ] as const
            ).map(([k, label]) => {
                const active = value === k
                return (
                    <button
                        key={k}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        onClick={() => onChange(k)}
                        className={[
                            'border-0 px-3.5 py-1.75 rounded-full cursor-pointer font-label font-semibold text-[12px] leading-none transition-all duration-150 ease-sheemu',
                            active
                                ? 'bg-primary-container text-on-primary-container'
                                : 'bg-transparent text-on-surface-variant',
                        ].join(' ')}>
                        {label}
                    </button>
                )
            })}
        </div>
    )
}

function TierCard({ plan, active, billing, onSelect }: { plan: PlanTier; active: boolean; billing: Billing; onSelect: () => void }) {
    const price = formatPrice(plan, billing)
    const showSavings = billing === 'yearly' && plan.priceMonthly > 0
    const savings = showSavings ? plan.priceMonthly * 12 - plan.priceYearly : 0
    return (
        <button
            onClick={onSelect}
            type="button"
            aria-pressed={active}
            className={[
                'relative text-left border-0 rounded-lg px-4.5 pt-5 pb-4.5 cursor-pointer flex flex-col gap-3.5 transition-all duration-150 ease-sheemu',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
                active ? 'bg-primary-soft text-on-primary-soft' : 'bg-surface-container-lowest text-on-surface tonal-layer-glow hover:bg-surface-container',
            ].join(' ')}>
            {plan.popular && (
                <span className="absolute -top-2.5 right-3.5 bg-secondary-soft text-on-secondary-soft font-label font-semibold text-[10px] leading-none tracking-[0.12em] uppercase px-2.5 py-1.5 rounded-full">
                    Most picked
                </span>
            )}
            <div className="flex items-center gap-2.5">
                <span
                    className={[
                        'w-8 h-8 rounded-full shrink-0 inline-flex items-center justify-center',
                        active ? 'bg-on-primary-soft text-primary-soft' : 'bg-surface-container text-primary',
                    ].join(' ')}>
                    <Icon name={plan.icon} size={18} />
                </span>
                <div className="flex flex-col">
                    <span className="font-body font-semibold text-[15px] leading-[1.2]">{plan.name}</span>
                    <span className="font-body font-normal text-[12px] leading-[1.3] opacity-80">{plan.tagline}</span>
                </div>
            </div>
            <div className="flex items-baseline gap-1.5">
                <span className="font-mono font-semibold text-[28px] leading-none tracking-[-0.02em]">{price.amount}</span>
                <span className="font-body font-normal text-[12px] leading-[1.3] opacity-80">{price.cadence}</span>
            </div>
            {showSavings && <Eyebrow className={active ? '' : 'text-primary'}>Save ${savings}/yr</Eyebrow>}
            <ul className="list-none p-0 m-0 flex flex-col gap-2">
                {planFeatures(plan).map((f) => (
                    <li key={f} className="flex items-start gap-2 font-body font-normal text-[13px] leading-[1.4]">
                        <span className="mt-px opacity-80">
                            <Icon name="check" size={14} />
                        </span>
                        {f}
                    </li>
                ))}
            </ul>
        </button>
    )
}
