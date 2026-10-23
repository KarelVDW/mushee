'use client'

import { Instrument } from '@mushee/notation/model'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

import { FunnelShell } from '@/components/FunnelShell'
import { Icon, PrimaryButton, StepProgress, TertiaryButton } from '@/components/ui'
import { AuthPrefill } from '@/components/ui/AuthCard'
import { setUserProperties, track } from '@/lib/analytics'
import type { BillingInterval, OnboardingPatch } from '@/lib/api'
import { useSession } from '@/lib/auth-client'
import { formatMoney } from '@/lib/currency'
import { LIBRARY_PATH, nextPathFrom, withNext } from '@/lib/nextPath'
import { BETA_MODE, isPaidTier, type PlanCatalogue, type PlanTier, requestedPlanFrom, withPlan } from '@/lib/plans'
import { useBetaGate, usePatchOnboarding, usePlanCatalogue, useSignOut, useStartCheckout, useStartFirstMelody } from '@/lib/queries'
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
    const firstMelody = useStartFirstMelody()
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
    // The step leads by itself for now (the iPhone walkthrough, or the beat before a grant moves on).
    const [micHoldsContinue, setMicHoldsContinue] = useState(false)

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

    // Each step (and the done screen) opens at the top — the wordmark and 'Skip setup' in view,
    // not wherever a long step's Continue left the page on a phone — with focus on its heading,
    // so a screen reader reads the new question first. Not on arrival: the code field takes focus then.
    const titleRef = useRef<HTMLHeadingElement>(null)
    const screen = done ? 'done' : stepName
    const focusedScreen = useRef(screen)
    useEffect(() => {
        if (focusedScreen.current === screen) return
        focusedScreen.current = screen
        window.scrollTo({ top: 0 })
        titleRef.current?.focus({ preventScroll: true })
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
    // The picks made on this visit are fresher than the saved answers the hook falls back to.
    const firstInstrument = instruments[0] ?? Instrument.VoiceLead
    const recordFirstMelody = () => firstMelody.start(firstInstrument)

    // The button says what happens next: the optional survey is skipped until something in it
    // is picked, and the plan step names the price for a paid plan.
    const chosenPlan = plans.byId(tier)
    const paidChoice = stepName === 'plan' && !!chosenPlan && isPaidTier(tier)
    const surveyAnswered = background !== null || goal !== null || source !== null
    const ctaLabel =
        stepName === 'about' && !surveyAnswered
            ? 'Skip'
            : stepName !== 'plan' || !chosenPlan
              ? 'Continue'
              : paidChoice
                ? `Continue to payment · ${formatMoney(billing === 'yearly' ? chosenPlan.priceYearly : chosenPlan.priceMonthly, currency)}/${billing === 'yearly' ? 'year' : 'month'}`
                : 'Start free'
    // The verify step moves on by itself; the mic step's own buttons lead until the browser has
    // answered, and a fresh yes moves on by itself too (Back stays meanwhile).
    const showContinue =
        stepName !== 'verify' && (stepName !== 'mic' || (micState === 'granted' && !micHoldsContinue) || micState === 'denied')
    // Nothing to go back to on the step after verify: a verified email has nothing to redo.
    const showBack = step >= 2

    return (
        <FunnelShell gap={7} action={!done && step > 0 && <TertiaryButton onClick={skip}>Skip setup</TertiaryButton>}>
            {!done && <StepProgress step={step} total={steps.length} />}

            {/* Keyed by screen: each step (and the done screen) fades in over 150ms, no travel. */}
            <div key={screen} className="animate-solkey-step-in flex flex-col gap-7">
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

                {!done && stepName === 'instruments' && (
                    <InstrumentsStep titleRef={titleRef} value={instruments} onChange={setInstruments} />
                )}

                {!done && stepName === 'mic' && (
                    <MicStep
                        titleRef={titleRef}
                        micState={micState}
                        setMicState={setMicState}
                        onContinueHeldChange={setMicHoldsContinue}
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
                        firstInstrument={firstInstrument}
                        creating={firstMelody.creating}
                        onRecordFirstMelody={recordFirstMelody}
                        onFinish={leave}
                    />
                )}
            </div>

            {/*
             * Back comes first in the DOM, as it sits first (left) in the single row from sm up, so
             * Tab follows what the eye reads there. On phones the footer stacks: the primary full
             * width (its price-bearing label wraps rather than run past the card), the payment note
             * under it, Back last (order-last). There the wrapper dissolves (display: contents), so
             * the Continue block is the card's own child and can stick to the screen's bottom edge,
             * over a fade, while a long step scrolls under it; Back stays in flow after the content.
             * From sm up the row is top-aligned and Back's box is the primary's height, so the two
             * stay level when the note hangs under the primary. Only the closing CTA pops: every
             * step's button is flat.
             */}
            {!done && (showBack || showContinue) && (
                <div className="max-sm:contents sm:grid sm:grid-cols-[auto_1fr] sm:items-start sm:gap-x-4 sm:pt-3">
                    {showBack && (
                        // On phones it tucks up under the Continue block's own bottom padding.
                        <div
                            className={`flex justify-center items-center max-sm:order-last sm:col-start-1 sm:row-start-1 sm:justify-start sm:h-(--control-lg) ${showContinue ? 'max-sm:-mt-5' : ''}`}>
                            <TertiaryButton onClick={back}>
                                <span className="inline-flex items-center gap-1.5">
                                    <Icon name="arrow-left" size={13} />
                                    Back
                                </span>
                            </TertiaryButton>
                        </div>
                    )}
                    {showContinue && (
                        <div
                            data-sticky-actions
                            className={[
                                'flex flex-col gap-2 sm:col-start-2 sm:row-start-1 sm:items-end',
                                'max-sm:sticky max-sm:bottom-0 max-sm:z-1 max-sm:-mx-5 max-sm:px-5 max-sm:pt-4 max-sm:pb-[max(1rem,env(safe-area-inset-bottom))] max-sm:bg-surface-container-lowest',
                                "max-sm:before:absolute max-sm:before:inset-x-0 max-sm:before:-top-6 max-sm:before:h-6 max-sm:before:bg-linear-to-b max-sm:before:from-transparent max-sm:before:to-surface-container-lowest max-sm:before:pointer-events-none max-sm:before:content-['']",
                            ].join(' ')}>
                            <PrimaryButton size="lg" icon="arrow-right" emphasis="flat" onClick={next} disabled={startCheckout.isPending}>
                                <span className="whitespace-normal text-center leading-tight">{ctaLabel}</span>
                            </PrimaryButton>
                            {paidChoice && (
                                <p className="m-0 text-center font-body font-normal text-[12px] leading-[1.4] text-on-surface-variant sm:text-right">
                                    You&apos;ll confirm on the next page. Cancel any time.
                                </p>
                            )}
                        </div>
                    )}
                </div>
            )}
        </FunnelShell>
    )
}
