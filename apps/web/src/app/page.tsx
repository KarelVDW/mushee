'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

import { Eyebrow, Footer, Icon, PrimaryButton, SecondaryButton, TertiaryButton, Wordmark } from '@/components/ui'
import { useSession } from '@/lib/auth-client'

export default function LandingPage() {
    const router = useRouter()
    const { data: session } = useSession()
    const authed = !!session?.user

    const onSignIn = () => router.push('/login')
    const onGetStarted = () => router.push(authed ? '/scores' : '/signup')

    return (
        <div className="bg-surface min-h-screen flex flex-col">
            <LandingNav authed={authed} onSignIn={onSignIn} onGetStarted={onGetStarted} />
            <Hero authed={authed} onSignIn={onSignIn} onGetStarted={onGetStarted} />
            <TrustStrip />
            <HowItWorks />
            <FeatureGrid />
            <Testimonials />
            <PricingTeaser onGetStarted={onGetStarted} />
            <FinalCTA onGetStarted={onGetStarted} />
            <Footer />
            <CookieBanner />
        </div>
    )
}

function LandingNav({ authed, onSignIn, onGetStarted }: { authed: boolean; onSignIn: () => void; onGetStarted: () => void }) {
    const navLinkClass = 'font-body font-medium text-[14px] leading-none text-on-surface-variant no-underline whitespace-nowrap'
    return (
        <nav className="sticky top-0 z-50 bg-[rgba(246,246,246,0.85)] backdrop-blur-xl">
            <div className="max-w-320 mx-auto px-8 py-5 flex justify-between items-center">
                <Wordmark size={28} />
                <div className="flex items-center gap-6">
                    <a href="#features" className={navLinkClass}>
                        Features
                    </a>
                    <a href="#how" className={navLinkClass}>
                        How it works
                    </a>
                    <a href="#pricing" className={navLinkClass}>
                        Pricing
                    </a>
                    {!authed && <TertiaryButton onClick={onSignIn}>Sign in</TertiaryButton>}
                    <PrimaryButton emphasis="pop" icon="arrow-right" onClick={onGetStarted}>
                        {authed ? 'Open library' : 'Start composing'}
                    </PrimaryButton>
                </div>
            </div>
        </nav>
    )
}

function Hero({ authed, onSignIn, onGetStarted }: { authed: boolean; onSignIn: () => void; onGetStarted: () => void }) {
    return (
        <section className="relative overflow-hidden pt-16 pb-20">
            <div className="absolute -top-[10%] -right-[5%] w-120 h-120 bg-[rgba(0,219,233,0.18)] rounded-full blur-[120px] pointer-events-none" />
            <div className="absolute -bottom-[15%] -left-[5%] w-90 h-90 bg-[rgba(255,32,121,0.10)] rounded-full blur-[120px] pointer-events-none" />
            <div className="max-w-320 mx-auto px-8 relative z-2 grid grid-cols-[1.1fr_1fr] gap-12 items-center">
                <div className="flex flex-col gap-6">
                    <Eyebrow className="text-primary">A score editor for the rest of us</Eyebrow>
                    <h1 className="font-display font-bold text-[76px] leading-[0.95] tracking-[-0.04em] text-on-surface m-0">
                        Write the music
                        <br />
                        <em className="font-serif font-normal">in your head.</em>
                    </h1>
                    <p className="font-body font-normal text-[18px] leading-normal text-on-surface-variant m-0 max-w-120">
                        Sheemu is a fast, quiet space for sketching scores — no fiddly menus, no twelve dialogs to find a sharp. Just you
                        and the notes.
                    </p>
                    <div className="flex gap-3 items-center mt-2 flex-wrap">
                        <PrimaryButton size="lg" emphasis="pop" icon="arrow-right" onClick={onGetStarted}>
                            {authed ? 'Open library' : "Start composing — it's free"}
                        </PrimaryButton>
                        {!authed && <TertiaryButton onClick={onSignIn}>Already have an account?</TertiaryButton>}
                    </div>
                </div>
                <HeroScreenshot />
            </div>
        </section>
    )
}

function HeroScreenshot() {
    return (
        <div className="bg-surface-container-lowest rounded-lg editorial-shadow p-6 -rotate-[1.5deg]">
            <div className="flex gap-1.5 mb-3">
                {[0, 1, 2].map((i) => (
                    <span key={i} className="w-2.5 h-2.5 rounded-full bg-surface-container-high" />
                ))}
            </div>
            <div className="bg-surface-container-low rounded-md p-3 mb-3 flex gap-1.5">
                {['𝅝', '𝅗𝅥', '𝅘𝅥', '𝅘𝅥𝅮', '𝅘𝅥𝅯'].map((g, i) => (
                    <span
                        key={i}
                        className={[
                            'px-2.5 py-1 rounded-sm text-[16px]',
                            i === 2 ? 'bg-primary-container text-on-primary-container' : 'bg-surface-container-lowest text-on-surface',
                        ].join(' ')}>
                        {g}
                    </span>
                ))}
            </div>
            <svg viewBox="0 0 600 160" width="100%" height="160">
                {[0, 1, 2, 3, 4].map((i) => (
                    <line key={i} x1={20} x2={580} y1={40 + i * 10} y2={40 + i * 10} stroke="#2d2f2f" strokeWidth={1} />
                ))}
                <text x={26} y={88} fontFamily="serif" fontSize={56} fill="#2d2f2f">
                    𝄞
                </text>
                {[120, 180, 240, 300, 360, 420, 480, 540].map((x, i) => {
                    const cy = 40 + [2, 1, 0, 1, 2, 3, 2, 1][i] * 10
                    return (
                        <g key={x}>
                            <ellipse cx={x} cy={cy} rx={5} ry={4} fill="#2d2f2f" transform={`rotate(-15 ${x} ${cy})`} />
                            <line x1={x + 5} y1={cy} x2={x + 5} y2={cy - 28} stroke="#2d2f2f" strokeWidth={1.4} />
                        </g>
                    )
                })}
            </svg>
        </div>
    )
}

function TrustStrip() {
    const names = ['Royal Conservatory', 'Berklee', 'Juilliard', 'RNCM', 'CalArts', 'Trinity Laban']
    return (
        <section className="p-8 border-t border-b border-outline-variant">
            <div className="max-w-320 mx-auto flex items-center justify-between gap-8 flex-wrap">
                <span className="font-label font-semibold text-[11px] leading-none uppercase tracking-[0.12em] text-on-surface-variant whitespace-nowrap">
                    Trusted by composers at
                </span>
                <div className="flex gap-10 flex-wrap items-center opacity-55">
                    {names.map((name) => (
                        <span key={name} className="font-display font-semibold text-[16px] leading-none tracking-[-0.02em] text-on-surface">
                            {name}
                        </span>
                    ))}
                </div>
            </div>
        </section>
    )
}

function HowItWorks() {
    const steps: [string, string, string][] = [
        ['01', 'Pick your instruments', 'Start from a template or build your own ensemble. Add, remove, or transpose at any time.'],
        ['02', 'Write the notes', 'Type, click, or play your MIDI keyboard. Sheemu handles the engraving as you go.'],
        ['03', 'Hear it back', "Real instrument sounds. Loop a bar, slow it down, or export to MIDI when you're ready."],
    ]
    return (
        <section id="how" className="py-22 px-8">
            <div className="max-w-320 mx-auto">
                <div className="mb-12">
                    <Eyebrow className="text-primary">How it works</Eyebrow>
                    <h2 className="font-display font-bold text-[44px] leading-none tracking-[-0.03em] text-on-surface mt-3 mb-0 max-w-160">
                        From idea to score in three steps.
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
        ['feather', 'Fast input', 'MIDI, keyboard, or click. Switch durations and accidentals without losing your place.'],
        ['users', 'Real instruments', 'Pick from piano, strings, winds, brass, and traditional instruments — the staff adapts.'],
        ['cloud', 'Saved as you go', 'Every change is kept. Open the same piece on any device and pick up where you left off.'],
        ['audio-lines', 'Hear it back', 'Lifelike instrument samples. Loop, slow down, and proof your work by ear.'],
        ['sliders-horizontal', 'Engraver-grade output', 'Spacing, beaming, and ties laid out with the same rules a pro engraver follows.'],
        ['shield', 'Yours forever', 'Export to MusicXML or PDF any time. Your music belongs to you, not us.'],
    ]
    return (
        <section id="features" className="py-22 px-8 bg-surface-container-lowest">
            <div className="max-w-320 mx-auto">
                <h2 className="font-display font-bold italic text-[44px] leading-none tracking-[-0.03em] text-on-surface m-0 mb-3">
                    Quiet tools, real notation.
                </h2>
                <p className="font-body font-normal text-[16px] leading-normal text-on-surface-variant max-w-140 m-0 mb-12">
                    Everything you need to sketch a piece, nothing you don&apos;t. Built on real SMuFL notation under the hood.
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

function Testimonials() {
    const items = [
        {
            quote: 'I sketched a string quartet on a train ride. Notion would have made me cry.',
            name: 'Maya Okafor',
            role: 'Composer, RNCM',
        },
        { quote: 'Finally, an editor where input feels like writing, not wrestling.', name: 'Daniel Park', role: 'Film scorer' },
        { quote: 'My students stop asking how to make a sharp and just write music.', name: 'Prof. Anya Reyes', role: 'Theory faculty' },
    ]
    return (
        <section className="py-22 px-8">
            <div className="max-w-320 mx-auto">
                <div className="mb-12">
                    <Eyebrow className="text-secondary">Hear it from them</Eyebrow>
                    <h2 className="font-display font-bold text-[44px] leading-none tracking-[-0.03em] text-on-surface mt-3 mb-0 max-w-160">
                        People who write a lot of notes.
                    </h2>
                </div>
                <div className="grid grid-cols-3 gap-6">
                    {items.map((t) => (
                        <figure key={t.name} className="bg-surface-container-lowest rounded-lg p-7 flex flex-col gap-5 m-0">
                            <span aria-hidden className="font-serif font-bold text-[56px] leading-[0.7] text-primary">
                                &ldquo;
                            </span>
                            <blockquote className="font-serif font-normal italic text-[17px] leading-[1.45] text-on-surface m-0">
                                {t.quote}
                            </blockquote>
                            <figcaption className="flex items-center gap-3 mt-auto">
                                <span className="w-9 h-9 rounded-full bg-secondary-soft text-on-secondary-soft inline-flex items-center justify-center font-display font-semibold text-[14px] leading-none">
                                    {t.name
                                        .split(' ')
                                        .map((s) => s[0])
                                        .join('')}
                                </span>
                                <div className="flex flex-col gap-0.5">
                                    <span className="font-body font-semibold text-[14px] leading-[1.2] text-on-surface">{t.name}</span>
                                    <span className="font-body font-normal text-[12px] leading-[1.2] text-on-surface-variant">
                                        {t.role}
                                    </span>
                                </div>
                            </figcaption>
                        </figure>
                    ))}
                </div>
            </div>
        </section>
    )
}

function PricingTeaser({ onGetStarted }: { onGetStarted: () => void }) {
    const tiers = [
        {
            name: 'Tinkerer',
            price: 'Free',
            sub: 'forever',
            bullets: ['30 sec recording / day', 'Up to 3 active scores', 'Real-instrument playback', 'Export to PDF & MusicXML'],
            cta: 'Start tinkering',
            emphasis: false,
        },
        {
            name: 'Hobbyist',
            price: '$15',
            sub: '/ month',
            bullets: ['10 min recording / day', 'Unlimited scores', 'Full instrument library', 'Lossless audio export', 'Priority support'],
            cta: 'Try Hobbyist free',
            emphasis: true,
        },
        {
            name: 'Professional',
            price: '$99',
            sub: '/ month',
            bullets: [
                'Unlimited recording',
                'Everything in Hobbyist',
                'Engraver-grade layout controls',
                'Parts & score generation',
                'Collaborator seats',
            ],
            cta: 'Go Professional',
            emphasis: false,
        },
    ]
    return (
        <section id="pricing" className="py-22 px-8 bg-surface-container-lowest">
            <div className="max-w-320 mx-auto">
                <div className="mb-12 text-center">
                    <Eyebrow className="text-primary">Pricing</Eyebrow>
                    <h2 className="font-display font-bold text-[44px] leading-none tracking-[-0.03em] text-on-surface mt-3 mx-auto mb-0">
                        Pick the size that fits.
                    </h2>
                </div>
                <div className="grid grid-cols-3 gap-6">
                    {tiers.map((t) => (
                        <div
                            key={t.name}
                            className={[
                                'rounded-lg p-7 flex flex-col gap-4',
                                t.emphasis
                                    ? 'bg-on-surface text-surface shadow-[3px_3px_0_0_var(--color-secondary)]'
                                    : 'bg-surface text-on-surface',
                            ].join(' ')}>
                            <div className="flex justify-between items-start">
                                <h3 className="font-headline font-semibold text-[20px] leading-none tracking-[-0.01em] m-0">{t.name}</h3>
                                {t.emphasis && (
                                    <span className="font-label font-semibold text-[10px] leading-none uppercase tracking-[0.12em] bg-secondary text-on-secondary px-2 py-1 rounded-sm">
                                        Most picked
                                    </span>
                                )}
                            </div>
                            <div className="flex items-baseline gap-1.5">
                                <span className="font-display font-bold text-[40px] tracking-[-0.03em]">{t.price}</span>
                                <span className="font-body font-medium text-[13px] leading-none opacity-70">{t.sub}</span>
                            </div>
                            <ul className="list-none p-0 m-0 flex flex-col gap-2.5">
                                {t.bullets.map((b) => (
                                    <li key={b} className="flex gap-2.5 items-start font-body font-normal text-[14px] leading-normal">
                                        <span className={t.emphasis ? 'text-tertiary' : 'text-primary'}>
                                            <Icon name="check" size={16} />
                                        </span>
                                        <span>{b}</span>
                                    </li>
                                ))}
                            </ul>
                            <div className="mt-auto pt-2">
                                {t.emphasis ? (
                                    <PrimaryButton emphasis="pop" onClick={onGetStarted} fullWidth>
                                        {t.cta}
                                    </PrimaryButton>
                                ) : (
                                    <SecondaryButton onClick={onGetStarted} fullWidth>
                                        {t.cta}
                                    </SecondaryButton>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </section>
    )
}

function FinalCTA({ onGetStarted }: { onGetStarted: () => void }) {
    return (
        <section className="py-24 px-8 relative overflow-hidden">
            <div className="absolute inset-0 bg-[radial-gradient(60%_80%_at_50%_50%,rgba(0,219,233,0.18),transparent_70%)] pointer-events-none" />
            <div className="max-w-190 mx-auto text-center relative z-2 flex flex-col gap-5 items-center">
                <h2 className="font-display font-bold text-[56px] leading-none tracking-[-0.04em] text-on-surface m-0">
                    The score is waiting.
                    <br />
                    <em className="font-serif font-normal">Go write it.</em>
                </h2>
                <p className="font-body font-normal text-[17px] leading-normal text-on-surface-variant m-0 max-w-130">
                    Free to start. No credit card. Your first piece takes about a minute to set up.
                </p>
                <div className="mt-2">
                    <PrimaryButton size="lg" emphasis="pop" icon="arrow-right" onClick={onGetStarted}>
                        Start composing — it&apos;s free
                    </PrimaryButton>
                </div>
            </div>
        </section>
    )
}

function CookieBanner() {
    const [dismissed, setDismissed] = useState(false)
    useEffect(() => {
        try {
            if (localStorage.getItem('sheemu:cookies') === 'ok') setDismissed(true)
        } catch {
            // localStorage unavailable (private mode, disabled cookies) — leave banner visible
        }
    }, [])
    if (dismissed) return null
    const dismiss = () => {
        try {
            localStorage.setItem('sheemu:cookies', 'ok')
        } catch {
            // localStorage unavailable — dismissal won't persist, but still hide for this session
        }
        setDismissed(true)
    }
    return (
        <div
            role="dialog"
            aria-label="Cookie preferences"
            className="fixed bottom-5 left-5 right-5 z-60 max-w-180 mx-auto bg-[rgba(255,255,255,0.96)] backdrop-blur-md rounded-lg px-5.5 py-4.5 shadow-[0_8px_28px_0_rgba(45,47,47,0.14),0_0_1px_0_rgba(45,47,47,0.2)] flex items-center gap-5 flex-wrap">
            <div className="flex-1 min-w-55 flex flex-col gap-1.5">
                <span className="font-label font-semibold text-[11px] leading-none tracking-[0.14em] uppercase text-on-surface-variant">
                    Cookies
                </span>
                <p className="font-body font-normal text-[14px] leading-normal text-on-surface m-0">
                    We use a few cookies to remember your scores and improve the editor.{' '}
                    <Link href="#" className="text-primary underline">
                        Read more
                    </Link>
                    .
                </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
                <TertiaryButton onClick={dismiss}>Decline</TertiaryButton>
                <PrimaryButton onClick={dismiss}>Accept</PrimaryButton>
            </div>
        </div>
    )
}
