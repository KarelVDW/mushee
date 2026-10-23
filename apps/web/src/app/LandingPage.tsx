import { FaqList } from '@/components/marketing/FaqList'
import { GetStartedButton, GetStartedNote } from '@/components/marketing/GetStartedButton'
import { Haze } from '@/components/marketing/Haze'
import { MarketingNav } from '@/components/marketing/MarketingNav'
import { SectionHeading } from '@/components/marketing/SectionHeading'
import { Container, Eyebrow, Footer, Icon, type IconName } from '@/components/ui'
import { BETA_MODE } from '@/lib/plans'

import { HeroDemo } from './HeroDemo'
import { LANDING_FAQ_SHOWN } from './pricing/faq'
import { BetaPricing, Pricing } from './PricingSection'

/** The landing page. Static apart from its client islands: the CTAs, sign-in links, demo and pricing. */
export function LandingPage() {
    return (
        <div className="bg-surface min-h-dvh flex flex-col">
            <MarketingNav sectionLinks="landing" />
            <main id="content" className="flex-1">
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
            <Haze placement="top-right" />
            <Container width="marketing" className="relative z-2 grid grid-cols-1 lg:grid-cols-[1fr_1.1fr] gap-10 lg:gap-12 items-center">
                {/* An explicit rhythm, not one flat gap: eyebrow 20px, headline 24px, then 36px to the CTA. */}
                <div className="flex flex-col">
                    <Eyebrow className="text-primary mb-5">{BETA_MODE ? 'Now in closed beta' : 'Melody to sheet music'}</Eyebrow>
                    <h1 className="type-hero text-on-surface m-0 mb-6">
                        The fastest way to get a melody
                        <br />
                        <em className="font-serif font-normal">on the page.</em>
                    </h1>
                    <p className="font-body font-normal text-[18px] leading-normal text-on-surface-variant m-0 mb-9 max-w-120">
                        Hum it, sing it, or play it — Solkey listens and writes the sheet music in front of your eyes.
                    </p>
                    {/* One action: the nav keeps the only "Sign in"; the line 12px under it is the button's caption, answering
                        "is it free, do I install anything?" (signed out only). */}
                    <div className="flex flex-col items-start gap-3">
                        <GetStartedButton location="hero" size="lg" emphasis="pop" />
                        <GetStartedNote>
                            {BETA_MODE ? (
                                <p className="font-body font-normal text-[13px] leading-normal text-on-surface-variant m-0">
                                    Free during the beta · 30 minutes of recording per day · approved personally, usually within a day.
                                </p>
                            ) : (
                                <p className="font-body font-normal text-[14px] leading-normal text-on-surface-variant m-0">
                                    Free to start — no card, nothing to install.
                                </p>
                            )}
                        </GetStartedNote>
                    </div>
                </div>
                <HeroDemo />
            </Container>
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
        <section id="how" className="py-14 sm:py-22">
            <Container width="marketing">
                <SectionHeading eyebrow="How it works" title="From melody to sheet music in one go." />
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
            </Container>
        </section>
    )
}

function FeatureGrid() {
    return (
        <section id="features" className="py-14 sm:py-22 bg-surface-container-lowest">
            <Container width="marketing">
                <SectionHeading
                    eyebrow="Features"
                    title="Simple tools, real notation."
                    sub="Everything you need to catch an idea before it evaporates."
                />
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
            </Container>
        </section>
    )
}

/** The questions a newcomer asks before trying Solkey — the same list the page's FAQPage structured data reads. */
function GoodToKnow() {
    return (
        <section id="faq" aria-labelledby="faq-title" className="py-14 sm:py-22">
            <Container width="marketing">
                <SectionHeading eyebrow="Questions" title="Good to know." id="faq-title" />
                <div className="max-w-190">
                    <FaqList items={LANDING_FAQ_SHOWN} />
                </div>
            </Container>
        </section>
    )
}

function FinalCTA() {
    return (
        <section className="py-16 sm:py-24 relative overflow-hidden">
            <Haze placement="right-edge" />
            <Container width="marketing" className="relative z-2">
                {/* The closing statement: no eyebrow, and its CTA follows at the hero's 36px. */}
                <div className="max-w-190 mx-auto flex flex-col items-center">
                    <SectionHeading
                        align="center"
                        className="mb-9"
                        title={
                            <>
                                That melody in your head?
                                <br />
                                <em className="font-serif font-normal">One recording is all it takes.</em>
                            </>
                        }
                        sub="Sign up now and get it on paper before it slips away."
                    />
                    <GetStartedButton location="footer" size="lg" emphasis="pop" />
                </div>
            </Container>
        </section>
    )
}
