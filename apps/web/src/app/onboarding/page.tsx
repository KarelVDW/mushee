'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { FunnelShell } from '@/components/FunnelShell'
import { Icon, PrimaryButton, TertiaryButton } from '@/components/ui'
import { setUserProperties, track } from '@/lib/analytics'
import { type BillingInterval, type OnboardingPatch } from '@/lib/api'
import { useSession } from '@/lib/auth-client'
import { nextPathFrom } from '@/lib/nextPath'
import { BETA_MODE, isPaidTier, type PlanTier } from '@/lib/plans'
import { useBetaGate, usePatchOnboarding, usePlanCatalogue, useStartCheckout } from '@/lib/queries'

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
    const plans = usePlanCatalogue()
    const { data: session, refetch } = useSession()
    const sessionEmail = session?.user?.email ?? null
    const verified = session?.user?.emailVerified ?? false
    const userEmail = sessionEmail ?? 'your inbox'
    // During the closed beta, unapproved users end up on the waiting page. The
    // server decides (not BETA_MODE), and AuthGate shares this query.
    const { awaitingApproval } = useBetaGate({ enabled: !!session?.user })

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
    const [billing, setBilling] = useState<BillingInterval>('monthly')
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
            if (!BETA_MODE && isPaidTier(tier)) {
                startCheckout.mutate({ tierId: tier, interval: billing }, { onError: () => setDone(true) })
                return
            }
            setDone(true)
            return
        }
        setStep((s) => Math.min(s + 1, STEP_COUNT - 1))
    }
    const back = () => setStep((s) => Math.max(s - 1, 0))
    // Where onboarding lets out: the waiting room while approval is pending, else wherever the
    // visitor was heading before signup (a shared score they want to keep) — the library by default.
    const leave = () => router.push(awaitingApproval ? '/beta' : nextPathFrom(window.location.search))
    const skip = () => {
        track('onboarding_skipped', { step: STEP_NAMES[step] })
        leave()
    }
    const finish = () => leave()

    return (
        <FunnelShell gap={7} action={!done && step > 0 && <TertiaryButton onClick={skip}>Skip for now</TertiaryButton>}>
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
                <SourceStep source={source} onSourceChange={setSource} sourceDetail={sourceDetail} onSourceDetailChange={setSourceDetail} />
            )}

            {!done && step === 7 && !BETA_MODE && (
                <PlanStep plans={plans.sellable} billing={billing} onBillingChange={setBilling} tier={tier} onTierChange={setTier} />
            )}

            {!done && step === 7 && BETA_MODE && <BetaPlanStep betaPlan={plans.beta} awaitingApproval={awaitingApproval} />}

            {done && (
                <DoneStep
                    name={name}
                    awaitingApproval={awaitingApproval}
                    betaPlanName={plans.beta.name}
                    planName={BETA_MODE ? plans.beta.name : plans.byId(tier)?.name}
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
        </FunnelShell>
    )
}
