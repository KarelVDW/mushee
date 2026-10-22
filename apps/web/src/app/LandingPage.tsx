import { FaqList } from '@/components/marketing/FaqList'
import { GetStartedButton } from '@/components/marketing/GetStartedButton'
import { MarketingNav } from '@/components/marketing/MarketingNav'
import { Eyebrow, Footer, Icon, type IconName } from '@/components/ui'
import { BETA_MODE } from '@/lib/plans'

import { HeroDemo } from './HeroDemo'
import { LANDING_FAQ_SHOWN } from './pricing/faq'
import { BetaPricing, Pricing } from './PricingSection'

/** The landing page. Static apart from its client islands: the CTAs, sign-in links, demo and pricing. */
export function LandingPage() {
    return (
        <div className="bg-surface min-h-dvh flex flex-col">
            <MarketingNav sectionLinks />
            <main className="flex-1">
                <Hero />
                <HowItWorks />
                <FeatureGrid />
                <GoodToKnow />
                {BETA_MODE ? <BetaPricing /> : <Pricing ctaLocation="pricing" />}
                <FinalCTA />
            </main>
            <Footer width="marketing" />
        </div>
    )
}

function Hero() {
    return (
        <section className="relative overflow-hidden pt-10 pb-14 sm:pt-16 sm:pb-20">
            <div className="absolute -top-[10%] -right-[5%] w-120 h-120 bg-primary-container/[0.18] rounded-full blur-[120px] pointer-events-none" />
            <div className="max-w-320 mx-auto px-5 sm:px-8 relative z-2 grid grid-cols-1 lg:grid-cols-[1.05fr_1fr] gap-10 lg:gap-12 items-center">
                <div className="flex flex-col gap-6">
                    <Eyebrow className="text-primary">{BETA_MODE ? 'Now in closed beta' : 'Melody to sheet music'}</Eyebrow>
                    <h1 className="font-display font-bold text-[40px] sm:text-[56px] lg:text-[72px] leading-[0.95] tracking-[-0.04em] text-on-surface m-0">
                        The fastest way to get a melody
                        <br />
                        <em className="font-serif font-normal">on the page.</em>
                    </h1>
                    <p className="font-body font-normal text-[18px] leading-normal text-on-surface-variant m-0 max-w-120">
                        Hum it, sing it, or play it — Solkey listens and writes the sheet music in front of your eyes.
                    </p>
                    {/* One action: the nav keeps the only "Sign in"; the line under it answers "is it free, do I install anything?". */}
                    <div className="flex gap-3 items-center mt-2 flex-wrap">
                        <GetStartedButton location="hero" size="lg" emphasis="pop" />
                    </div>
                    {BETA_MODE ? (
                        <p className="font-body font-normal text-[13px] leading-normal text-on-surface-variant m-0">
                            Free during the beta · 30 minutes of recording per day · approved personally, usually within a day.
                        </p>
                    ) : (
                        <p className="font-body font-normal text-[14px] leading-normal text-on-surface-variant m-0">
                            Free to start — no card, nothing to install.
                        </p>
                    )}
                </div>
                <HeroDemo />
            </div>
        </section>
    )
}

const HOW_STEPS: readonly { readonly num: string; readonly title: string; readonly body: string }[] = [
    {
        num: '01',
        title: 'Press record',
        body: 'Open a new score and press record. Solkey counts you in, then listens — only while you record.',
    },
    {
        num: '02',
        title: 'Sing or play the tune',
        // The one place the landing says how Solkey hears; the FAQ below goes into more detail.
        body: 'Your voice or any instrument, one note at a time. Solkey writes the melody onto the staff, bar by bar, while you play.',
    },
    {
        num: '03',
        title: 'Fix it and keep it',
        body: 'Tap a wrong note to fix it, change the key if you like, and hear it played back. Everything saves as you go.',
    },
]

const FEATURES: readonly { readonly icon: IconName; readonly title: string; readonly body: string }[] = [
    {
        icon: 'mic',
        title: 'Watch it write itself',
        body: 'Sing, hum, whistle or play a melody. Solkey hears pitch and rhythm and writes real sheet music as you go.',
    },
    {
        icon: 'music',
        title: 'Looks like real sheet music',
        body: 'Notes are spaced, grouped and spelled the way printed music is, so you can hand it to a teacher or a bandmate.',
    },
    {
        icon: 'pencil',
        title: 'Fix it in a tap',
        body: 'Nudge a note up or down, change its length, or use your keyboard if you have one. Every change can be undone.',
    },
    {
        icon: 'audio-lines',
        title: 'Hear it back',
        body: 'Play your score with the sound of the right instrument to check your work by ear before anyone else does.',
    },
    {
        icon: 'cloud',
        title: 'Saved as you go',
        body: 'Every change is stored instantly. Close the tab mid-phrase and pick up on another device without losing a note.',
    },
    {
        icon: 'shield',
        title: 'Yours, privately',
        body: 'Your music belongs to you. Recordings stay private to your account — never published or sold — and a score is only ever shared when you turn on its link.',
    },
]

function HowItWorks() {
    return (
        <section id="how" className="py-14 sm:py-22 px-5 sm:px-8">
            <div className="max-w-320 mx-auto">
                <div className="mb-12">
                    <Eyebrow className="text-primary">How it works</Eyebrow>
                    <h2 className="font-display font-bold text-[32px] sm:text-[48px] leading-none tracking-[-0.03em] text-on-surface mt-3 mb-0 max-w-160">
                        From melody to sheet music in one go.
                    </h2>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                    {HOW_STEPS.map(({ num, title, body }) => (
                        <div key={num} className="flex flex-col gap-3">
                            <span className="font-mono font-medium text-[14px] leading-none text-primary">{num}</span>
                            <h3 className="font-headline font-semibold text-[22px] leading-tight tracking-[-0.01em] text-on-surface m-0">
                                {title}
                            </h3>
                            <p className="font-body font-normal text-[16px] leading-[1.55] text-on-surface-variant m-0">{body}</p>
                        </div>
                    ))}
                </div>
            </div>
        </section>
    )
}

function FeatureGrid() {
    return (
        <section id="features" className="py-14 sm:py-22 px-5 sm:px-8 bg-surface-container-lowest">
            <div className="max-w-320 mx-auto">
                <h2 className="font-display font-bold text-[32px] sm:text-[48px] leading-none tracking-[-0.03em] text-on-surface m-0 mb-3">
                    Simple tools, real notation.
                </h2>
                <p className="font-body font-normal text-[16px] leading-normal text-on-surface-variant max-w-140 m-0 mb-12">
                    Everything you need to catch an idea before it evaporates.
                </p>
                {/* Phones: icon-left rows, so the six features stay a short scroll; from sm up, stacked cards. */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
                    {FEATURES.map(({ icon, title, body }) => (
                        <div key={title} className="bg-surface rounded-lg p-5 sm:p-6 flex flex-row sm:flex-col items-start gap-4 sm:gap-3">
                            <div className="w-10 h-10 sm:w-11 sm:h-11 shrink-0 rounded-full bg-primary-soft text-on-primary-soft inline-flex items-center justify-center">
                                <Icon name={icon} size={22} />
                            </div>
                            <div className="flex flex-col gap-1.5 sm:gap-3 min-w-0">
                                <h3 className="font-headline font-semibold text-[17px] sm:text-[18px] leading-[1.3] tracking-[-0.005em] text-on-surface m-0">
                                    {title}
                                </h3>
                                <p className="font-body font-normal text-[15px] sm:text-[16px] leading-[1.55] text-on-surface-variant m-0">
                                    {body}
                                </p>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </section>
    )
}

/** The questions a newcomer asks before trying Solkey — the same list the page's FAQPage structured data reads. */
function GoodToKnow() {
    return (
        <section id="faq" aria-labelledby="faq-title" className="py-14 sm:py-22 px-5 sm:px-8">
            <div className="max-w-190 mx-auto">
                <h2
                    id="faq-title"
                    className="font-display font-bold text-[32px] sm:text-[48px] leading-none tracking-[-0.03em] text-on-surface m-0 mb-10">
                    Good to know.
                </h2>
                <FaqList items={LANDING_FAQ_SHOWN} />
            </div>
        </section>
    )
}

function FinalCTA() {
    return (
        <section className="py-16 sm:py-24 px-5 sm:px-8 relative overflow-hidden">
            <div className="absolute -bottom-[30%] -right-[5%] w-[540px] h-[540px] rounded-full bg-primary-container/[0.18] blur-[120px] pointer-events-none" />
            <div className="max-w-190 mx-auto text-center relative z-2 flex flex-col gap-5 items-center">
                <h2 className="font-display font-bold text-[32px] sm:text-[48px] leading-none tracking-[-0.03em] text-on-surface m-0">
                    That melody in your head?
                    <br />
                    <em className="font-serif font-normal">One recording is all it takes.</em>
                </h2>
                <p className="font-body font-normal text-[17px] leading-normal text-on-surface-variant m-0 max-w-130">
                    Sign up now and get it on paper before it slips away.
                </p>
                <div className="mt-2">
                    <GetStartedButton location="footer" size="lg" emphasis="pop" />
                </div>
            </div>
        </section>
    )
}
