'use client'

import { useRouter } from 'next/navigation'

import { Eyebrow, Footer, Icon, PrimaryButton, SecondaryButton, TertiaryButton, Wordmark } from '@/components/ui'
import { track } from '@/lib/analytics'
import { useSession } from '@/lib/auth-client'
import { BETA_MODE, BETA_PLAN, PLAN_TIERS, type PlanTier } from '@/lib/plans'

import { HeroDemo } from './HeroDemo'

export function LandingPage() {
    const router = useRouter()
    const { data: session } = useSession()
    const authed = !!session?.user

    const onSignIn = () => router.push('/login')
    const onGetStarted = (location: string) => {
        track('landing_cta_clicked', { location, beta: BETA_MODE })
        router.push(authed ? '/scores' : '/signup')
    }

    const primaryCta = authed ? 'Open library' : BETA_MODE ? 'Request beta access' : "Start free — no card needed"

    return (
        <div className="bg-surface min-h-screen flex flex-col">
            <LandingNav authed={authed} cta={authed ? 'Open library' : BETA_MODE ? 'Request access' : 'Start free'} onSignIn={onSignIn} onGetStarted={() => onGetStarted('nav')} />
            <Hero authed={authed} cta={primaryCta} onSignIn={onSignIn} onGetStarted={() => onGetStarted('hero')} />
            <HowItWorks />
            <FeatureGrid />
            <Pricing onGetStarted={() => onGetStarted('pricing')} />
            <FinalCTA cta={primaryCta} onGetStarted={() => onGetStarted('footer')} />
            <Footer />
        </div>
    )
}

function LandingNav({
    authed,
    cta,
    onSignIn,
    onGetStarted,
}: {
    authed: boolean
    cta: string
    onSignIn: () => void
    onGetStarted: () => void
}) {
    const navLinkClass = 'font-body font-medium text-[14px] leading-none text-on-surface-variant no-underline whitespace-nowrap'
    return (
        <nav className="sticky top-0 z-50 bg-[rgba(246,246,246,0.85)] backdrop-blur-xl">
            <div className="max-w-320 mx-auto px-8 py-5 flex justify-between items-center">
                <Wordmark size={28} />
                <div className="flex items-center gap-6">
                    <a href="#how" className={navLinkClass}>
                        How it works
                    </a>
                    <a href="#features" className={navLinkClass}>
                        Features
                    </a>
                    <a href="#pricing" className={navLinkClass}>
                        Pricing
                    </a>
                    {!authed && <TertiaryButton onClick={onSignIn}>Sign in</TertiaryButton>}
                    <PrimaryButton emphasis="pop" icon="arrow-right" onClick={onGetStarted}>
                        {cta}
                    </PrimaryButton>
                </div>
            </div>
        </nav>
    )
}

function Hero({
    authed,
    cta,
    onSignIn,
    onGetStarted,
}: {
    authed: boolean
    cta: string
    onSignIn: () => void
    onGetStarted: () => void
}) {
    return (
        <section className="relative overflow-hidden pt-16 pb-20">
            <div className="absolute -top-[10%] -right-[5%] w-120 h-120 bg-[rgba(0,219,233,0.18)] rounded-full blur-[120px] pointer-events-none" />
            <div className="absolute -bottom-[15%] -left-[5%] w-90 h-90 bg-[rgba(255,32,121,0.10)] rounded-full blur-[120px] pointer-events-none" />
            <div className="max-w-320 mx-auto px-8 relative z-2 grid grid-cols-[1.05fr_1fr] gap-12 items-center">
                <div className="flex flex-col gap-6">
                    <Eyebrow className="text-primary">{BETA_MODE ? 'Now in closed beta' : 'Live audio-to-notation'}</Eyebrow>
                    <h1 className="font-display font-bold text-[72px] leading-[0.95] tracking-[-0.04em] text-on-surface m-0">
                        The fastest way to get a melody
                        <br />
                        <em className="font-serif font-normal">on the page.</em>
                    </h1>
                    <p className="font-body font-normal text-[18px] leading-normal text-on-surface-variant m-0 max-w-120">
                        Hum it, sing it, or play it — Sheemu listens and writes clean sheet music in front of your eyes. No
                        note-by-note clicking, no wrestling with menus. Just press record.
                    </p>
                    <div className="flex gap-3 items-center mt-2 flex-wrap">
                        <PrimaryButton size="lg" emphasis="pop" icon="arrow-right" onClick={onGetStarted}>
                            {cta}
                        </PrimaryButton>
                        {!authed && <TertiaryButton onClick={onSignIn}>Already have an account?</TertiaryButton>}
                    </div>
                    {BETA_MODE && (
                        <p className="font-body font-normal text-[13px] leading-normal text-on-surface-variant m-0">
                            Free during the beta · 5 minutes of recording per day · approved personally, usually within a day.
                        </p>
                    )}
                </div>
                <HeroDemo />
            </div>
        </section>
    )
}

function HowItWorks() {
    const steps: [string, string, string][] = [
        [
            '01',
            'Press record',
            'Open a score, set your tempo, and hit record. Sheemu counts you in and starts listening — only while you record.',
        ],
        [
            '02',
            'Play or sing',
            'Any instrument, or just your voice. The melody lands on the staff as notation while you play it, measure by measure.',
        ],
        [
            '03',
            'Polish & keep',
            "Fix a note with a keystroke, tweak rhythm and key, and hear it back with real instrument sounds. It's saved as you go.",
        ],
    ]
    return (
        <section id="how" className="py-22 px-8">
            <div className="max-w-320 mx-auto">
                <div className="mb-12">
                    <Eyebrow className="text-primary">How it works</Eyebrow>
                    <h2 className="font-display font-bold text-[48px] leading-none tracking-[-0.03em] text-on-surface mt-3 mb-0 max-w-160">
                        From melody to sheet music in one take.
                    </h2>
                </div>
                <div className="grid grid-cols-3 gap-8">
                    {steps.map(([num, title, body]) => (
                        <div key={num} className="flex flex-col gap-3">
                            <span className="font-mono font-medium text-[14px] leading-none text-primary">{num}</span>
                            <h3 className="font-headline font-semibold text-[22px] leading-tight tracking-[-0.01em] text-on-surface m-0">
                                {title}
                            </h3>
                            <p className="font-body font-normal text-[15px] leading-[1.55] text-on-surface-variant m-0">{body}</p>
                        </div>
                    ))}
                </div>
            </div>
        </section>
    )
}

function FeatureGrid() {
    const features: [string, string, string][] = [
        [
            'mic',
            'Live transcription',
            'Sing, whistle, or play — pitch and rhythm are detected in real time and written as proper notation, not a piano roll.',
        ],
        [
            'music',
            'Real engraving',
            'Spacing, beaming, accidentals, and ties follow real engraving rules, so the page always looks like sheet music should.',
        ],
        [
            'keyboard',
            'Keyboard-first editing',
            'Every correction is a keystroke away: durations, accidentals, octaves. Customize the shortcuts to fit your hands.',
        ],
        [
            'audio-lines',
            'Hear it back',
            'Play your score with lifelike instrument samples to proof your work by ear before anyone else does.',
        ],
        [
            'cloud',
            'Saved as you go',
            'Every change is stored instantly. Close the tab mid-phrase and pick up on another device without losing a note.',
        ],
        [
            'shield',
            'Yours, privately',
            'Your music belongs to you. Recording audio is transcribed in memory and never stored — only the notes remain.',
        ],
    ]
    return (
        <section id="features" className="py-22 px-8 bg-surface-container-lowest">
            <div className="max-w-320 mx-auto">
                <h2 className="font-display font-bold text-[48px] leading-none tracking-[-0.03em] text-on-surface m-0 mb-3">
                    Quiet tools, real notation.
                </h2>
                <p className="font-body font-normal text-[16px] leading-normal text-on-surface-variant max-w-140 m-0 mb-12">
                    Everything you need to catch an idea before it evaporates — nothing you don&apos;t.
                </p>
                <div className="grid grid-cols-3 gap-6">
                    {features.map(([icon, title, body]) => (
                        <div key={title} className="bg-surface rounded-lg p-6 flex flex-col gap-3">
                            <div className="w-11 h-11 rounded-full bg-primary-soft text-on-primary-soft inline-flex items-center justify-center">
                                <Icon name={icon} size={22} />
                            </div>
                            <h3 className="font-headline font-semibold text-[18px] leading-[1.3] tracking-[-0.005em] text-on-surface m-0">
                                {title}
                            </h3>
                            <p className="font-body font-normal text-[14px] leading-[1.55] text-on-surface-variant m-0">{body}</p>
                        </div>
                    ))}
                </div>
            </div>
        </section>
    )
}

function Pricing({ onGetStarted }: { onGetStarted: () => void }) {
    return (
        <section id="pricing" className="py-22 px-8 bg-surface-container-lowest">
            <div className="max-w-320 mx-auto">
                <div className="mb-12 text-center">
                    <Eyebrow className="text-primary">Pricing</Eyebrow>
                    <h2 className="font-display font-bold text-[48px] leading-none tracking-[-0.03em] text-on-surface mt-3 mx-auto mb-0">
                        Pay for recording time, nothing else.
                    </h2>
                    <p className="font-body font-normal text-[15px] leading-normal text-on-surface-variant mt-4 max-w-140 mx-auto">
                        Every plan gets the full editor, unlimited scores, and playback. The plans differ in one thing: how much you
                        can record per day.
                    </p>
                </div>

                {BETA_MODE && (
                    <div className="max-w-190 mx-auto mb-10 bg-secondary-soft text-on-secondary-soft rounded-lg px-6 py-5 text-center">
                        <p className="font-body font-medium text-[15px] leading-normal m-0">
                            <strong>Sheemu is in closed beta.</strong> Right now every account is on the free{' '}
                            <strong>{BETA_PLAN.name}</strong> plan — 5 minutes of recording per day, no card, no charge. The plans
                            below go live at launch.
                        </p>
                    </div>
                )}

                <div className="grid grid-cols-3 gap-6">
                    {PLAN_TIERS.map((tier) => (
                        <PricingCard key={tier.id} tier={tier} onGetStarted={onGetStarted} />
                    ))}
                </div>
            </div>
        </section>
    )
}

function PricingCard({ tier, onGetStarted }: { tier: PlanTier; onGetStarted: () => void }) {
    const emphasis = tier.popular === true
    const cta = BETA_MODE ? 'Join the beta' : tier.priceMonthly === 0 ? 'Start sketching' : `Go ${tier.name}`
    return (
        <div
            className={[
                'rounded-lg p-7 flex flex-col gap-4',
                emphasis ? 'bg-on-surface text-surface shadow-(--shadow-offset-3)' : 'bg-surface text-on-surface',
            ].join(' ')}>
            <div className="flex justify-between items-start">
                <h3 className="font-headline font-semibold text-[20px] leading-none tracking-[-0.01em] m-0">{tier.name}</h3>
                {emphasis && (
                    <span className="font-label font-semibold text-[10px] leading-none uppercase tracking-[0.12em] bg-secondary-container text-on-secondary-container px-2.5 py-1.5 rounded-full">
                        Most picked
                    </span>
                )}
            </div>
            <div className="flex items-baseline gap-1.5">
                <span className="font-display font-bold text-[40px] tracking-[-0.03em]">
                    {tier.priceMonthly === 0 ? 'Free' : `$${tier.priceMonthly}`}
                </span>
                <span
                    className={[
                        'font-body font-medium text-[13px] leading-none',
                        emphasis ? 'text-inverse-on-surface' : 'text-on-surface-variant',
                    ].join(' ')}>
                    {tier.priceMonthly === 0 ? 'forever' : `/ month · $${tier.priceYearly}/yr`}
                </span>
            </div>
            <ul className="list-none p-0 m-0 flex flex-col gap-2.5">
                {tier.features.map((f) => (
                    <li key={f} className="flex gap-2.5 items-start font-body font-normal text-[14px] leading-normal">
                        <span className={emphasis ? 'text-primary-container' : 'text-primary'}>
                            <Icon name="check" size={16} />
                        </span>
                        <span>{f}</span>
                    </li>
                ))}
            </ul>
            <div className="mt-auto pt-2">
                {emphasis ? (
                    <PrimaryButton emphasis="pop" onClick={onGetStarted} fullWidth>
                        {cta}
                    </PrimaryButton>
                ) : (
                    <SecondaryButton onClick={onGetStarted} fullWidth>
                        {cta}
                    </SecondaryButton>
                )}
            </div>
        </div>
    )
}

function FinalCTA({ cta, onGetStarted }: { cta: string; onGetStarted: () => void }) {
    return (
        <section className="py-24 px-8 relative overflow-hidden">
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[540px] h-[540px] rounded-full bg-[rgba(0,219,233,0.18)] blur-[120px] pointer-events-none" />
            <div className="max-w-190 mx-auto text-center relative z-2 flex flex-col gap-5 items-center">
                <h2 className="font-display font-bold text-[48px] leading-none tracking-[-0.03em] text-on-surface m-0">
                    That melody in your head?
                    <br />
                    <em className="font-serif font-normal">It takes one take.</em>
                </h2>
                <p className="font-body font-normal text-[17px] leading-normal text-on-surface-variant m-0 max-w-130">
                    {BETA_MODE
                        ? 'Request access, warm up your voice, and get it on paper before it slips away.'
                        : 'Free to start. No credit card. Your first recording is on the page in under a minute.'}
                </p>
                <div className="mt-2">
                    <PrimaryButton size="lg" emphasis="pop" icon="arrow-right" onClick={onGetStarted}>
                        {cta}
                    </PrimaryButton>
                </div>
            </div>
        </section>
    )
}
