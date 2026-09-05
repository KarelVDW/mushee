'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'

import { Eyebrow, Footer, PrimaryButton, TertiaryButton, Wordmark } from '@/components/ui'
import { track } from '@/lib/analytics'
import { useSession } from '@/lib/auth-client'
import { BETA_MODE } from '@/lib/plans'

import { BetaPricing, Pricing } from '../PricingSection'
import { PRICING_FAQ } from './faq'

/**
 * The dedicated pricing route: the same tier cards as the landing page's
 * #pricing section, framed with a page heading, the pricing FAQ and a closing
 * CTA. A page of its own so it can be linked, indexed and shared directly.
 */
export function PricingPage() {
    const router = useRouter()
    const { data: session } = useSession()
    const authed = !!session?.user

    const onGetStarted = (location: string) => {
        track('landing_cta_clicked', { location, beta: BETA_MODE })
        router.push(authed ? '/scores' : '/signup')
    }
    const cta = authed ? 'Open library' : BETA_MODE ? 'Request access' : 'Start free'

    return (
        <div className="bg-surface min-h-dvh flex flex-col">
            <nav className="sticky top-0 z-50 bg-surface-container-low/85 backdrop-blur-xl">
                <div className="max-w-320 mx-auto px-4 sm:px-8 py-4 sm:py-5 flex justify-between items-center gap-3">
                    <Link href="/" className="no-underline" aria-label="Solkey home">
                        <Wordmark size={28} />
                    </Link>
                    <div className="flex items-center gap-4 sm:gap-6">
                        {!authed && <TertiaryButton onClick={() => router.push('/login')}>Sign in</TertiaryButton>}
                        <PrimaryButton icon="arrow-right" onClick={() => onGetStarted('pricing-nav')}>
                            {cta}
                        </PrimaryButton>
                    </div>
                </div>
            </nav>

            <header className="pt-14 sm:pt-20 px-5 sm:px-8">
                <div className="max-w-190 mx-auto text-center flex flex-col gap-4 items-center">
                    <Eyebrow className="text-primary">Pricing</Eyebrow>
                    <h1 className="font-display font-bold text-[40px] sm:text-[56px] leading-[0.95] tracking-[-0.04em] text-on-surface m-0">
                        Simple plans,
                        <br />
                        <em className="font-serif font-normal">priced by the minute you record.</em>
                    </h1>
                    <p className="font-body font-normal text-[17px] leading-normal text-on-surface-variant m-0 max-w-130">
                        Every plan has the whole editor. You only pay for how much you can record each day — and you can start for free.
                    </p>
                </div>
            </header>

            <main className="flex-1">
                {BETA_MODE ? <BetaPricing /> : <Pricing intro={false} onGetStarted={() => onGetStarted('pricing-page')} />}
                <PricingFaq />
                <section className="py-16 sm:py-20 px-5 sm:px-8">
                    <div className="max-w-190 mx-auto text-center flex flex-col gap-5 items-center">
                        <h2 className="font-display font-bold text-[32px] sm:text-[44px] leading-none tracking-[-0.03em] text-on-surface m-0">
                            Start with Sketch. <em className="font-serif font-normal">Upgrade when your ideas do.</em>
                        </h2>
                        <PrimaryButton size="lg" emphasis="pop" icon="arrow-right" onClick={() => onGetStarted('pricing-footer')}>
                            {cta}
                        </PrimaryButton>
                        <Link href="/contact" className="font-body font-normal text-[14px] text-on-surface-variant underline">
                            Questions about a plan? Talk to us.
                        </Link>
                    </div>
                </section>
            </main>

            <Footer width="marketing" />
        </div>
    )
}

function PricingFaq() {
    return (
        <section aria-labelledby="pricing-faq" className="py-14 sm:py-20 px-5 sm:px-8 bg-surface-container-lowest">
            <div className="max-w-190 mx-auto">
                <h2
                    id="pricing-faq"
                    className="font-display font-bold text-[28px] sm:text-[36px] leading-none tracking-[-0.03em] text-on-surface m-0 mb-10">
                    Questions, answered.
                </h2>
                <dl className="m-0 grid grid-cols-1 sm:grid-cols-2 gap-x-10 gap-y-8">
                    {PRICING_FAQ.map((item) => (
                        <div key={item.question} className="flex flex-col gap-2">
                            <dt className="font-headline font-semibold text-[17px] leading-[1.3] tracking-[-0.005em] text-on-surface">
                                {item.question}
                            </dt>
                            <dd className="m-0 font-body font-normal text-[14px] leading-[1.6] text-on-surface-variant">{item.answer}</dd>
                        </div>
                    ))}
                </dl>
            </div>
        </section>
    )
}
