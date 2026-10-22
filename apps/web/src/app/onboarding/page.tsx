'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

import { FunnelShell } from '@/components/FunnelShell'
import { Icon, PrimaryButton, StepProgress, TertiaryButton } from '@/components/ui'
import { setUserProperties, track } from '@/lib/analytics'
import { type BillingInterval, type OnboardingPatch } from '@/lib/api'
import { useSession } from '@/lib/auth-client'
import { nextPathFrom } from '@/lib/nextPath'
import { BETA_MODE, isPaidTier, type PlanTier, requestedPlanFrom } from '@/lib/plans'
import { useBetaGate, usePatchOnboarding, usePlanCatalogue, useStartCheckout, useUpdateProfile } from '@/lib/queries'

import { NO_INSTRUMENT_OPTION, STEP_COUNT, STEP_NAMES, type StepName } from './onboarding-data'
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
    const updateProfile = useUpdateProfile()
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
    // Steps are addressed by name; the index only orders them.
    const stepName = STEP_NAMES[step]

    // Mic permission state lives here (not in MicStep): canAdvance reads it,
    // and it must survive navigating away from the step and back.
    const [micState, setMicState] = useState<MicState>('idle')

    // The preference answers, 'name' through 'plan'
    const [name, setName] = useState(session?.user?.name ?? '')
    const [background, setBackground] = useState<string | null>(null)
    const [goal, setGoal] = useState<string | null>(null)
    const [instruments, setInstruments] = useState<string[]>([])
    const [source, setSource] = useState<string | null>(null)
    const [sourceDetail, setSourceDetail] = useState('')
    const [tier, setTier] = useState<PlanTier['id']>('pro')
    const [billing, setBilling] = useState<BillingInterval>('monthly')
    const [done, setDone] = useState(false)

    // The session can still be loading at mount (a reload on /onboarding) — seed the
    // name step from it once it resolves, so the field isn't left empty and blocking.
    const sessionName = session?.user?.name
    useEffect(() => {
        if (sessionName !== undefined) setName(sessionName)
    }, [sessionName])

    // A visitor who came from a pricing card (signup forwards its ?plan=) finds that tier
    // preselected. Read after mount: the page prerenders, where there is no URL to read.
    useEffect(() => {
        const requested = requestedPlanFrom(window.location.search)
        if (requested) setTier(requested)
    }, [])

    const canAdvance = (() => {
        switch (stepName) {
            case 'verify':
                return verified
            case 'mic':
                // Denied still advances: the editor works fine without a mic
                // (recording asks again later), and a desktop user with no
                // microphone must not be walled out of the rest of onboarding.
                return micState === 'granted' || micState === 'denied'
            case 'name':
                return name.trim().length > 0
            case 'background':
                return !!background
            case 'goal':
                return !!goal
            case 'instruments':
                return instruments.length > 0
            case 'source':
                // Optional, as the step tells the user: without a pick nothing is saved.
                return true
            case 'plan':
                return true
        }
    })()

    const patchForStep = (s: StepName): OnboardingPatch | null => {
        switch (s) {
            case 'background':
                return background ? { background } : null
            case 'goal':
                return goal ? { goal } : null
            case 'instruments':
                return { instruments }
            case 'source':
                return source ? { source, sourceDetail: sourceDetail.trim() } : null
            case 'plan':
                return { completedAt: new Date().toISOString() }
            default:
                return null
        }
    }

    const next = () => {
        const patch = patchForStep(stepName)
        // Persistence is best-effort and never blocks progress; a failure
        // surfaces as a toast through the global mutation error handler.
        if (patch) patchMutation.mutate(patch)
        // The name is the account's display name (Settings edits the same field), not an
        // onboarding answer, so it is saved on the user rather than in the patch.
        if (stepName === 'name' && name.trim() !== sessionName) updateProfile.mutate(name.trim())
        track('onboarding_step_completed', {
            step: stepName,
            ...(stepName === 'mic' ? { mic_permission: micState } : {}),
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
        track('onboarding_skipped', { step: stepName })
        leave()
    }

    return (
        <FunnelShell gap={7} action={!done && step > 0 && <TertiaryButton onClick={skip}>Skip for now</TertiaryButton>}>
            {!done && <StepProgress step={step} total={STEP_COUNT} />}

            {!done && stepName === 'verify' && (
                <VerifyStep userEmail={userEmail} sessionEmail={sessionEmail} verified={verified} onVerified={refetch} />
            )}

            {!done && stepName === 'mic' && <MicStep micState={micState} setMicState={setMicState} />}

            {!done && stepName === 'name' && <NameStep value={name} onChange={setName} />}

            {!done && stepName === 'background' && <BackgroundStep value={background} onChange={setBackground} />}

            {!done && stepName === 'goal' && <GoalStep value={goal} onChange={setGoal} />}

            {!done && stepName === 'instruments' && <InstrumentsStep value={instruments} onChange={setInstruments} />}

            {!done && stepName === 'source' && (
                <SourceStep source={source} onSourceChange={setSource} sourceDetail={sourceDetail} onSourceDetailChange={setSourceDetail} />
            )}

            {!done && stepName === 'plan' && !BETA_MODE && (
                <PlanStep plans={plans.sellable} billing={billing} onBillingChange={setBilling} tier={tier} onTierChange={setTier} />
            )}

            {!done && stepName === 'plan' && BETA_MODE && <BetaPlanStep betaPlan={plans.beta} awaitingApproval={awaitingApproval} />}

            {done && (
                <DoneStep
                    name={name}
                    awaitingApproval={awaitingApproval}
                    betaPlanName={plans.beta.name}
                    planName={BETA_MODE ? plans.beta.name : plans.byId(tier)?.name}
                    onFinish={leave}
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
