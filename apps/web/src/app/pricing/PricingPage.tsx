import Link from 'next/link'

import { FaqList } from '@/components/marketing/FaqList'
import { GetStartedButton } from '@/components/marketing/GetStartedButton'
import { MarketingNav } from '@/components/marketing/MarketingNav'
import { SectionHeading } from '@/components/marketing/SectionHeading'
import { Container, Eyebrow, Footer } from '@/components/ui'
import { BETA_MODE } from '@/lib/plans'

import { BetaPricing, Pricing } from '../PricingSection'
import { PRICING_FAQ_SHOWN } from './faq'

/**
 * The dedicated pricing route: the same tier cards as the landing page's
 * #pricing section, framed with a page heading, the pricing FAQ and a closing
 * CTA. A page of its own so it can be linked, indexed and shared directly.
 * Static apart from its client islands (the CTAs, sign-in, the tier cards).
 */
export function PricingPage() {
    return (
        <div className="bg-surface min-h-dvh flex flex-col">
            <MarketingNav sectionLinks="pricing" ctaLocation="pricing-nav" />

            {/* The page heading sits inside <main>, so the skip link lands on it. */}
            <main id="content" className="flex-1">
                <header className="pt-14 sm:pt-20">
                    <Container width="marketing" className="text-center flex flex-col gap-4 items-center">
                        <Eyebrow className="text-primary">Pricing</Eyebrow>
                        <h1 className="font-display font-bold text-[40px] sm:text-[56px] leading-[0.95] tracking-[-0.04em] text-on-surface m-0">
                            Simple plans.
                            <br />
                            <em className="font-serif font-normal">Free to start.</em>
                        </h1>
                        <p className="font-body font-normal text-[17px] leading-normal text-on-surface-variant m-0 max-w-130">
                            Every plan has the whole editor. Plans differ only in how much you can record each day.
                        </p>
                    </Container>
                </header>

                {BETA_MODE ? <BetaPricing /> : <Pricing intro={false} ctaLocation="pricing-page" />}
                <PricingFaq />
                <section className="py-16 sm:py-20">
                    <Container width="marketing">
                        <div className="max-w-190 mx-auto flex flex-col items-center">
                            {/* Sketch and upgrades aren't on offer in the beta; the closing line names neither. The italic clause starts its own line. */}
                            <SectionHeading
                                align="center"
                                className="mb-9"
                                title={
                                    BETA_MODE ? (
                                        <>
                                            Join the beta.
                                            <br />
                                            <em className="font-serif font-normal">Get that melody on the page.</em>
                                        </>
                                    ) : (
                                        <>
                                            Start with Sketch.
                                            <br />
                                            <em className="font-serif font-normal">Upgrade when your ideas do.</em>
                                        </>
                                    )
                                }
                            />
                            <GetStartedButton location="pricing-footer" size="lg" emphasis="pop" />
                            <Link href="/contact" className="mt-5 font-body font-normal text-[14px] text-on-surface-variant underline">
                                Questions about a plan? Talk to us.
                            </Link>
                        </div>
                    </Container>
                </section>
            </main>

            <Footer width="marketing" />
        </div>
    )
}

function PricingFaq() {
    return (
        <section aria-labelledby="pricing-faq" className="py-14 sm:py-20 bg-surface-container-lowest">
            <Container width="marketing">
                <SectionHeading eyebrow="Questions" title="Questions, answered." id="pricing-faq" />
                <div className="max-w-190">
                    <FaqList items={PRICING_FAQ_SHOWN} tone="low" />
                </div>
            </Container>
        </section>
    )
}
