'use client'

import { Instrument, Score } from '@mushee/notation/model'
import { ScoreSerializer } from '@mushee/notation/model/io/ScoreSerializer'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

import { defaultScoreTitle } from '@/app/scores/NewScoreDialog'
import { FunnelShell } from '@/components/FunnelShell'
import { Icon, PrimaryButton, showToast, StepProgress, TertiaryButton } from '@/components/ui'
import { AuthPrefill } from '@/components/ui/AuthCard'
import { setUserProperties, track } from '@/lib/analytics'
import { ApiError, type BillingInterval, type OnboardingPatch } from '@/lib/api'
import { useSession } from '@/lib/auth-client'
import { formatMoney } from '@/lib/currency'
import { LIBRARY_PATH, nextPathFrom, withNext } from '@/lib/nextPath'
import { BETA_MODE, isPaidTier, type PlanCatalogue, type PlanTier, requestedPlanFrom, withPlan } from '@/lib/plans'
import { useBetaGate, useCreateScore, usePatchOnboarding, usePlanCatalogue, useSignOut, useStartCheckout } from '@/lib/queries'
import { formatAllowance } from '@/lib/recordingTime'
import { useDisplayCurrency } from '@/lib/useDisplayCurrency'

import { onboardingSteps } from './onboarding-data'
import { AboutStep, type DoneDestination, DoneStep, InstrumentsStep, type MicState, MicStep, PlanStep, VerifyStep } from './OnboardingSteps'

/** The done screen's plan line: the plan the account is on, in words. Paid picks leave for checkout, so this is the free plan or the beta's. */
function planLineFor(plans: PlanCatalogue): string {
    if (BETA_MODE) return `You're on ${plans.beta.name} — free during the beta.`
    const free = plans.byId('free')
    if (!free) return "You're on the free plan."
    const recording = free.dailyRecordingSeconds === null ? '' : `, with ${formatAllowance(free.dailyRecordingSeconds)} of recording a day`
    return `You're on ${free.name} — free${recording}.`
}

export default function OnboardingPage() {
    const router = useRouter()
    const patchMutation = usePatchOnboarding()
    const startCheckout = useStartCheckout()
    const createScore = useCreateScore()
    const signOut = useSignOut()
    const plans = usePlanCatalogue()
    const currency = useDisplayCurrency()
    const { data: session, refetch } = useSession()
    const sessionEmail = session?.user?.email ?? null
    const sessionName = session?.user?.name ?? ''
    const verified = session?.user?.emailVerified ?? false
    const userEmail = sessionEmail ?? 'your inbox'
    // During the closed beta, unapproved users end up on the waiting page. The
    // server decides (not BETA_MODE), and AuthGate shares this query.
    const { awaitingApproval } = useBetaGate({ enabled: !!session?.user })

    // From the URL (see the mount effect below): a paid pricing card's ?plan=, and ?next=.
    const [requestedPlan, setRequestedPlan] = useState<PlanTier['id'] | null>(null)
    const [nextPath, setNextPath] = useState(LIBRARY_PATH)

    const steps = onboardingSteps(requestedPlan)
    const [step, setStep] = useState(0)
    // Steps are addressed by name; the index only orders them.
    const stepName = steps[Math.min(step, steps.length - 1)]
    const isLastStep = step >= steps.length - 1

    // Mic permission state lives here (not in MicStep): the footer reads it, and it
    // must survive navigating away from the step and back.
    const [micState, setMicState] = useState<MicState>('idle')
    const [micGuideOpen, setMicGuideOpen] = useState(false)

    // The answers. Every one is optional.
    const [instruments, setInstruments] = useState<Instrument[]>([])
    const [background, setBackground] = useState<string | null>(null)
    const [goal, setGoal] = useState<string | null>(null)
    const [source, setSource] = useState<string | null>(null)
    const [sourceDetail, setSourceDetail] = useState('')
    // Nothing paid is ever chosen for the visitor: the free plan, unless ?plan= asked for a tier.
    const [tier, setTier] = useState<PlanTier['id']>('free')
    const [billing, setBilling] = useState<BillingInterval>('monthly')
    const [done, setDone] = useState(false)
    // Read after mount: the page prerenders, where there is no URL to read. A visitor who came
    // from a paid pricing card (signup forwards its ?plan=) gets the plan step with that tier
    // chosen; one heading somewhere specific (?next=, a shared score) goes back there at the end.
    useEffect(() => {
        const search = window.location.search
        const requested = requestedPlanFrom(search)
        setRequestedPlan(requested)
        if (requested) setTier(requested)
        setNextPath(nextPathFrom(search))
    }, [])

    // Each step (and the done screen) opens with focus on its heading, so a screen reader
    // reads the new question first. Not on arrival: the code field takes focus then.
    const titleRef = useRef<HTMLHeadingElement>(null)
    const screen = done ? 'done' : stepName
    const focusedScreen = useRef(screen)
    useEffect(() => {
        if (focusedScreen.current === screen) return
        focusedScreen.current = screen
        titleRef.current?.focus()
    }, [screen])

    const patchFor = (name: typeof stepName): OnboardingPatch | null => {
        switch (name) {
            case 'instruments':
                // Instrument display names, the strings Instrument.findByDisplayName resolves.
                return { instruments: instruments.map((i) => i.displayName) }
            case 'about': {
                const answers: OnboardingPatch = {
                    ...(background ? { background } : {}),
                    ...(goal ? { goal } : {}),
                    ...(source ? { source, sourceDetail: sourceDetail.trim() } : {}),
                }
                return Object.keys(answers).length > 0 ? answers : null
            }
            default:
                return null
        }
    }

    const next = () => {
        const answers = patchFor(stepName)
        // The last step, whichever it is, records that onboarding is complete.
        const patch = isLastStep ? { ...answers, completedAt: new Date().toISOString() } : answers
        // Persistence is best-effort and never blocks progress; a failure
        // surfaces as a toast through the global mutation error handler.
        if (patch) patchMutation.mutate(patch)
        track('onboarding_step_completed', {
            step: stepName,
            ...(stepName === 'mic' ? { mic_permission: micState === 'idle' || micState === 'requesting' ? 'skipped' : micState } : {}),
            // The survey used to be three steps of its own; its answers ride on this one event now.
            ...(stepName === 'about' ? { background, goal, source, source_detail_provided: sourceDetail.trim().length > 0 } : {}),
        })
        if (!isLastStep) {
            setStep((s) => Math.min(s + 1, steps.length - 1))
            return
        }
        // Categorical answers only — sourceDetail and the name are free text and never leave the database.
        const played = instruments.map((i) => i.displayName)
        // Singing is not playing: an empty pick or the voice alone means no instrument.
        const playsInstrument = instruments.some((i) => i !== Instrument.VoiceLead)
        track('onboarding_completed', {
            tier: BETA_MODE ? 'beta' : tier,
            background,
            goal,
            source,
            instruments: played,
            instrument_count: played.length,
            plays_instrument: playsInstrument,
            source_detail_provided: sourceDetail.trim().length > 0,
        })
        setUserProperties({
            background,
            goal,
            source,
            instrument_count: played.length,
            plays_instrument: playsInstrument,
            onboarding_completed_at: new Date().toISOString(),
        })
        // Paid pick → straight into Polar checkout; on failure fall through to the done screen.
        if (!BETA_MODE && isPaidTier(tier)) {
            startCheckout.mutate({ tierId: tier, interval: billing }, { onError: () => setDone(true) })
            return
        }
        setDone(true)
    }
    const back = () => setStep((s) => Math.max(s - 1, 0))
    // Where onboarding lets out: the waiting room while approval is pending, else wherever the
    // visitor was heading before signup (a shared score they want to keep) — the library by default.
    const leave = () => router.push(awaitingApproval ? '/beta' : nextPath)
    const skip = () => {
        track('onboarding_skipped', { step: stepName })
        leave()
    }
    // A mistyped email: back to signup, the name already filled in, and the ?next= destination
    // and ?plan= pick kept, so signing up again leads to the same place and plan step.
    const startOver = () => {
        track('onboarding_start_over')
        AuthPrefill.offer({ name: sessionName })
        void signOut(withPlan(withNext('/signup', nextPath), requestedPlan))
    }

    // The usual end: a new score on the first instrument picked, open and ready to record.
    const destination: DoneDestination = awaitingApproval ? 'beta' : nextPath !== LIBRARY_PATH ? 'next' : 'first-melody'
    const recordFirstMelody = () => {
        const score = Score.blank(instruments[0] ?? Instrument.VoiceLead)
        createScore.mutate(
            { title: defaultScoreTitle(true), score: new ScoreSerializer(score).toInput() },
            {
                onSuccess: (created) => router.push(`/scores/${created.id}?first=1`),
                onError: (err) => {
                    // A full library (an older account onboarding again): the library's limit dialog explains.
                    if (err instanceof ApiError && err.isScoreLimit) router.push('/scores?new=1')
                    else showToast("Couldn't create your score. Please try again.")
                },
            },
        )
    }

    // The plan step's button says what happens next, the price in it for a paid plan.
    const chosenPlan = plans.byId(tier)
    const paidChoice = stepName === 'plan' && !!chosenPlan && isPaidTier(tier)
    const ctaLabel =
        stepName !== 'plan' || !chosenPlan
            ? 'Continue'
            : paidChoice
              ? `Continue to payment · ${formatMoney(billing === 'yearly' ? chosenPlan.priceYearly : chosenPlan.priceMonthly, currency)}/${billing === 'yearly' ? 'year' : 'month'}`
              : 'Start free'
    // The verify step moves on by itself; the mic step's own buttons lead until the browser has answered.
    const showContinue = stepName !== 'verify' && (stepName !== 'mic' || (micState === 'granted' && !micGuideOpen) || micState === 'denied')
    // Nothing to go back to on the step after verify: a verified email has nothing to redo.
    const showBack = step >= 2

    return (
        <FunnelShell gap={7} action={!done && step > 0 && <TertiaryButton onClick={skip}>Skip setup</TertiaryButton>}>
            {!done && <StepProgress step={step} total={steps.length} />}

            {!done && stepName === 'verify' && (
                <VerifyStep
                    titleRef={titleRef}
                    userEmail={userEmail}
                    sessionEmail={sessionEmail}
                    verified={verified}
                    onVerified={refetch}
                    onAdvance={next}
                    onStartOver={startOver}
                />
            )}

            {!done && stepName === 'instruments' && <InstrumentsStep titleRef={titleRef} value={instruments} onChange={setInstruments} />}

            {!done && stepName === 'mic' && (
                <MicStep
                    titleRef={titleRef}
                    micState={micState}
                    setMicState={setMicState}
                    onGuideOpenChange={setMicGuideOpen}
                    onAdvance={next}
                />
            )}

            {!done && stepName === 'about' && (
                <AboutStep
                    titleRef={titleRef}
                    background={background}
                    onBackgroundChange={setBackground}
                    goal={goal}
                    onGoalChange={setGoal}
                    source={source}
                    onSourceChange={setSource}
                    sourceDetail={sourceDetail}
                    onSourceDetailChange={setSourceDetail}
                />
            )}

            {!done && stepName === 'plan' && (
                <PlanStep
                    titleRef={titleRef}
                    plans={plans.sellable}
                    freePlan={plans.byId('free') ?? plans.sellable[0]}
                    billing={billing}
                    onBillingChange={setBilling}
                    tier={tier}
                    onTierChange={setTier}
                />
            )}

            {done && (
                <DoneStep
                    titleRef={titleRef}
                    name={sessionName}
                    destination={destination}
                    betaPlanName={plans.beta.name}
                    planLine={destination === 'beta' ? null : planLineFor(plans)}
                    creating={createScore.isPending || createScore.isSuccess}
                    onRecordFirstMelody={recordFirstMelody}
                    onFinish={leave}
                />
            )}

            {!done && (showBack || showContinue) && (
                <div className="flex flex-col gap-2 pt-3">
                    <div className="flex justify-between items-center gap-4">
                        {showBack ? (
                            <TertiaryButton onClick={back}>
                                <span className="inline-flex items-center gap-1.5">
                                    <Icon name="arrow-left" size={13} />
                                    Back
                                </span>
                            </TertiaryButton>
                        ) : (
                            <span />
                        )}
                        {showContinue && (
                            <PrimaryButton icon="arrow-right" emphasis="pop" onClick={next} disabled={startCheckout.isPending}>
                                {ctaLabel}
                            </PrimaryButton>
                        )}
                    </div>
                    {paidChoice && (
                        <p className="m-0 self-end text-right font-body font-normal text-[12px] leading-[1.4] text-on-surface-variant">
                            You&apos;ll confirm on the next page. Cancel any time.
                        </p>
                    )}
                </div>
            )}
        </FunnelShell>
    )
}
