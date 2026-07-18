'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { Icon, PrimaryButton, TertiaryButton, Wordmark } from '@/components/ui'
import { setUserProperties, track } from '@/lib/analytics'
import { type OnboardingPatch } from '@/lib/api'
import { useSession } from '@/lib/auth-client'
import { BETA_MODE, BETA_PLAN, type Billing, PLAN_TIERS, planById, type PlanTier } from '@/lib/plans'
import { useBetaStatus, usePatchOnboarding, usePlans, useStartCheckout } from '@/lib/queries'

import { NO_INSTRUMENT_OPTION, STEP_COUNT, STEP_NAMES } from './onboarding-data'
import { StepProgress } from './OnboardingControls'
import {
    BackgroundStep,
    BetaPlanStep,
    DoneStep,
    GoalStep,
    InstrumentsStep,
    type MicState,
    MicStep,
    NameStep,
    PlanStep,
    SourceStep,
    VerifyStep,
} from './OnboardingSteps'

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
                  maxScores: p.maxScores,
              }))
        : PLAN_TIERS
    const betaApiPlan = apiPlans?.find((p) => p.id === BETA_PLAN.id)
    const betaPlan = betaApiPlan
        ? { ...BETA_PLAN, name: betaApiPlan.name, dailyRecordingSeconds: betaApiPlan.dailyRecordingCredits, maxScores: betaApiPlan.maxScores }
        : BETA_PLAN
    const { data: session, refetch } = useSession()
    const sessionEmail = session?.user?.email ?? null
    const verified = session?.user?.emailVerified ?? false
    const userEmail = sessionEmail ?? 'your inbox'
    // During the closed beta, unapproved users end up on the waiting page.
    const betaStatus = useBetaStatus({ enabled: BETA_MODE && !!session?.user })
    const awaitingApproval = BETA_MODE && betaStatus.data?.status === 'pending'

    const [step, setStep] = useState(0)

    // Mic permission state lives here (not in MicStep): canAdvance reads it,
    // and it must survive navigating away from the step and back.
    const [micState, setMicState] = useState<MicState>('idle')

    // Steps 2–7 — preferences
    const [name, setName] = useState(session?.user?.name ?? '')
    const [background, setBackground] = useState<string | null>(null)
    const [goal, setGoal] = useState<string | null>(null)
    const [instruments, setInstruments] = useState<string[]>([])
    const [source, setSource] = useState<string | null>(null)
    const [sourceDetail, setSourceDetail] = useState('')
    const [tier, setTier] = useState<PlanTier['id']>('pro')
    const [billing, setBilling] = useState<Billing>('monthly')
    const [done, setDone] = useState(false)

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
                return !!goal
            case 5:
                return instruments.length > 0
            case 6:
                return !!source
            case 7:
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
                return goal ? { goal } : null
            case 5:
                return { instruments }
            case 6:
                return source ? { source, sourceDetail: sourceDetail.trim() } : null
            case 7:
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
        track('onboarding_step_completed', {
            step: STEP_NAMES[step],
            ...(step === 1 ? { mic_permission: micState } : {}),
        })
        if (step === STEP_COUNT - 1) {
            // Categorical answers only — sourceDetail and name are free text
            // (the friend placeholder invites a person's name) and never
            // leave the database.
            const played = instruments.filter((i) => i !== NO_INSTRUMENT_OPTION)
            track('onboarding_completed', {
                tier: BETA_MODE ? 'beta' : tier,
                background,
                goal,
                source,
                instruments: played,
                instrument_count: played.length,
                plays_instrument: played.length > 0,
                source_detail_provided: sourceDetail.trim().length > 0,
            })
            setUserProperties({
                background,
                goal,
                source,
                instrument_count: played.length,
                plays_instrument: played.length > 0,
                onboarding_completed_at: new Date().toISOString(),
            })
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
    const skip = () => {
        track('onboarding_skipped', { step: STEP_NAMES[step] })
        router.push(awaitingApproval ? '/beta' : '/scores')
    }
    const finish = () => router.push(awaitingApproval ? '/beta' : '/scores')

    return (
        <main className="min-h-dvh bg-surface flex flex-col items-center px-6 py-8">
            <header className="w-full max-w-180 flex justify-between items-center">
                <Wordmark size={26} />
                {!done && step > 0 ? <TertiaryButton onClick={skip}>Skip for now</TertiaryButton> : <span />}
            </header>

            <div className="w-full max-w-180 mt-12 bg-surface-container-lowest rounded-xl editorial-shadow px-6 py-8 sm:px-12 sm:py-10 flex flex-col gap-7">
                {!done && <StepProgress step={step} total={STEP_COUNT} />}

                {!done && step === 0 && (
                    <VerifyStep userEmail={userEmail} sessionEmail={sessionEmail} verified={verified} onVerified={refetch} />
                )}

                {!done && step === 1 && <MicStep micState={micState} setMicState={setMicState} />}

                {!done && step === 2 && <NameStep value={name} onChange={setName} />}

                {!done && step === 3 && <BackgroundStep value={background} onChange={setBackground} />}

                {!done && step === 4 && <GoalStep value={goal} onChange={setGoal} />}

                {!done && step === 5 && <InstrumentsStep value={instruments} onChange={setInstruments} />}

                {!done && step === 6 && (
                    <SourceStep
                        source={source}
                        onSourceChange={setSource}
                        sourceDetail={sourceDetail}
                        onSourceDetailChange={setSourceDetail}
                    />
                )}

                {!done && step === 7 && !BETA_MODE && (
                    <PlanStep plans={displayPlans} billing={billing} onBillingChange={setBilling} tier={tier} onTierChange={setTier} />
                )}

                {!done && step === 7 && BETA_MODE && <BetaPlanStep betaPlan={betaPlan} awaitingApproval={awaitingApproval} />}

                {done && (
                    <DoneStep
                        name={name}
                        awaitingApproval={awaitingApproval}
                        betaPlanName={betaPlan.name}
                        planName={BETA_MODE ? betaPlan.name : displayPlans.find((p) => p.id === tier)?.name}
                        onFinish={finish}
                    />
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
