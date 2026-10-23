'use client'

import { PriceTag } from '@mushee/ui'
import { useState } from 'react'

import { settingsTabPath } from '@/app/settings/settingsTabs'
import { GetStartedButton } from '@/components/marketing/GetStartedButton'
import { SectionHeading } from '@/components/marketing/SectionHeading'
import { Badge, Container, Icon, PrimaryButton, SecondaryButton } from '@/components/ui'
import { useSession } from '@/lib/auth-client'
import { type Currency, formatMoney } from '@/lib/currency'
import {
    CHEAPEST_PACK,
    CREDIT_PACKS,
    isPlanTierId,
    PLAN_TIERS,
    planBudgetHint,
    planCtaLabel,
    planFeatures,
    planSavingsPercent,
    type PlanTier,
    recordingBudgetLabel,
    withPlan,
} from '@/lib/plans'
import { useBillingState } from '@/lib/queries'
import { useDisplayCurrency } from '@/lib/useDisplayCurrency'

interface PricingProps {
    /** The tier cards' `location` on landing_cta_clicked. */
    ctaLocation: string
    /** The section's own eyebrow + headline; off when the page already frames it (the /pricing hero). */
    intro?: boolean
}

/**
 * The pricing section — the tier cards, the professional tier, the one-time
 * packs teaser — shared by the landing page (#pricing) and the /pricing route.
 * Renders straight from the static plan catalogue so both pages work without
 * the API; in-app surfaces use the DB-driven `usePlanCatalogue()` instead.
 * A signed-in visitor's own plan is marked once their billing state resolves
 * (see TierCards); until then, and for everyone else, the cards are static.
 */
export function Pricing({ ctaLocation, intro = true }: PricingProps) {
    const currency = useDisplayCurrency()
    return (
        <section id="pricing" className={intro ? 'py-14 sm:py-22' : 'pt-10 pb-14 sm:pt-12 sm:pb-22'}>
            <Container width="marketing">
                {intro && (
                    <SectionHeading
                        eyebrow="Pricing"
                        align="center"
                        title="Free to start. Pay only for more recording time."
                        sub="Every plan gets the full editor, recording that writes the notes for you, and playback. The plans differ in how much you can record each day — and Sketch holds up to five scores."
                    />
                )}

                <TierCards currency={currency} ctaLocation={ctaLocation} />

                <PacksTeaser currency={currency} />

                <p className="mt-6 font-body font-normal text-[12px] leading-normal text-on-surface-variant text-center m-0">
                    {currency === 'eur'
                        ? 'Euro prices include VAT — the amount you see is the total you pay.'
                        : 'Prices are shown before local sales tax, which is added at checkout.'}
                </p>
            </Container>
        </section>
    )
}

/** The pricing section while the closed beta runs: the tier ladder and all
 *  prices stay hidden — they may still change as real costs surface — so the
 *  section only says what the beta costs (nothing) and that pricing follows
 *  at launch. Keeps the section's id="pricing", so a /#pricing link still
 *  lands on it (the site's own links go to /pricing). */
export function BetaPricing() {
    return (
        <section id="pricing" className="py-14 sm:py-22">
            <Container width="marketing">
                {/* Nothing follows the heading, so it takes no space under it. */}
                <SectionHeading
                    eyebrow="Pricing"
                    align="center"
                    className="mb-0"
                    title="Free while the beta runs."
                    sub="Every beta account gets the same plan: the full editor, recording that writes the notes for you, playback, and 30 minutes of recording a day — no card, no charge. Paid plans arrive at launch."
                />
            </Container>
        </section>
    )
}

interface TierCardsProps {
    currency: Currency
    ctaLocation: string
}

/**
 * The tier ladder. Signed out it is the same for everyone; signed in, the visitor's billing
 * state marks their own plan (see AccountTierCards). The marketing pages must work without
 * the API, so the billing query only runs for a session, and any state short of a resolved
 * plan (loading, an error, a tier off the ladder) keeps the static cards.
 */
function TierCards(props: TierCardsProps) {
    const { data: session } = useSession()
    return session?.user ? <AccountTierCards {...props} /> : <TierLadder {...props} currentTierId={null} />
}

function AccountTierCards(props: TierCardsProps) {
    const { data: billing } = useBillingState()
    const currentTierId = billing && isPlanTierId(billing.tierId) ? billing.tierId : null
    return <TierLadder {...props} currentTierId={currentTierId} />
}

interface TierLadderProps extends TierCardsProps {
    /** The signed-in visitor's own tier, once known; null renders the cards for a stranger. */
    currentTierId: PlanTier['id'] | null
}

function TierLadder({ currency, ctaLocation, currentTierId }: TierLadderProps) {
    return (
        <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-100 md:max-w-none mx-auto w-full">
                {PLAN_TIERS.filter((tier) => !tier.professional).map((tier) => (
                    <PricingCard key={tier.id} tier={tier} currency={currency} ctaLocation={ctaLocation} currentTierId={currentTierId} />
                ))}
            </div>

            {PLAN_TIERS.filter((tier) => tier.professional).map((tier) => (
                <ProfessionalCard key={tier.id} tier={tier} currency={currency} ctaLocation={ctaLocation} currentTierId={currentTierId} />
            ))}
        </>
    )
}

interface CardProps {
    tier: PlanTier
    currency: Currency
    ctaLocation: string
    currentTierId: PlanTier['id'] | null
}

/**
 * A tier card's button, always the big (lg) capsule across the card, and always flat: the
 * page's magenta pop belongs to its hero and closing CTAs. For a stranger: "Start free" /
 * "Choose {plan}" into signup (or, for a signed-in visitor whose plan isn't known yet, the plan
 * dialog). Once the visitor's plan is known: "Your plan" on their own card, to the plan tab, and
 * "Switch to {plan}" on the others, to the plan tab's Change plan with that tier selected.
 */
function PlanCardCta({ tier, ctaLocation, currentTierId, primary }: CardProps & { primary: boolean }) {
    if (currentTierId === null) {
        return (
            <GetStartedButton location={ctaLocation} plan={tier.id} variant={primary ? 'primary' : 'secondary'} size="lg" fullWidth>
                {planCtaLabel(tier)}
            </GetStartedButton>
        )
    }
    if (tier.id === currentTierId) {
        return (
            <SecondaryButton href={settingsTabPath('plan')} size="lg" fullWidth>
                Your plan
            </SecondaryButton>
        )
    }
    const href = withPlan(settingsTabPath('plan'), tier.id)
    const label = `Switch to ${tier.name}`
    return primary ? (
        <PrimaryButton href={href} size="lg" fullWidth>
            {label}
        </PrimaryButton>
    ) : (
        <SecondaryButton href={href} size="lg" fullWidth>
            {label}
        </SecondaryButton>
    )
}

/** A paid plan's second price line: the year's price and what it saves, in the app's own words. */
function yearlyLine(tier: PlanTier, currency: Currency): string {
    return `or ${formatMoney(tier.priceYearly, currency)} a year — save ${planSavingsPercent(tier)}%`
}

// PriceTag sets its cadence and note in on_surface_variant, which sinks on the charcoal card: there
// they take the inverse quiet tone (the note is the tag's last line, the cadence its first line's last part).
const PRICE_ON_DARK = '[&>span:last-child]:text-inverse-on-surface [&>span:first-child>span:last-child]:text-inverse-on-surface'

/**
 * The professional tier: one wide card under the ladder, on its grid — name and what it adds on
 * the left, its price, then its button — present enough to anchor the ladder, quiet enough not
 * to compete with the consumer cards. Stacked on phones.
 */
function ProfessionalCard(props: CardProps) {
    const { tier, currency, currentTierId } = props
    const lines = [recordingBudgetLabel(tier.dailyRecordingSeconds), ...tier.features]
    return (
        <div className="mt-6 w-full rounded-lg bg-surface-container-lowest tonal-layer-glow p-7 flex flex-col gap-5 md:grid md:grid-cols-[minmax(0,1fr)_auto_auto] md:items-center md:gap-10">
            <div className="flex flex-col gap-3 min-w-0">
                <div className="flex flex-col gap-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                        <h3 className="type-heading text-on-surface m-0">{tier.name}</h3>
                        {tier.id === currentTierId && <Badge tone="neutral">Your plan</Badge>}
                    </div>
                    <span className="font-body font-normal text-[14px] leading-[1.3] text-on-surface-variant">{tier.tagline}</span>
                </div>
                <ul className="list-none p-0 m-0 flex flex-wrap gap-x-6 gap-y-2">
                    {lines.map((line) => (
                        <FeatureLine key={line} emphasis={false}>
                            {line}
                        </FeatureLine>
                    ))}
                </ul>
            </div>
            <PriceTag size="lg" amount={formatMoney(tier.priceMonthly, currency)} cadence="/ month" note={yearlyLine(tier, currency)} />
            <PlanCardCta {...props} primary={false} />
        </div>
    )
}

/** One-time packs, one click away — the subscriptions above stay the offer. A disclosure: its chevron turns as it opens. */
function PacksTeaser({ currency }: { currency: Currency }) {
    const [open, setOpen] = useState(false)
    return (
        <div className="mt-8 text-center">
            <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                aria-expanded={open}
                className="group inline-flex items-center gap-2 border-0 bg-transparent p-0 cursor-pointer font-body font-medium text-[14px] leading-normal text-primary hover:text-primary-dim transition-colors duration-150 ease-solkey rounded-sm focus-ring pointer-coarse:min-h-10">
                Not ready for a subscription? One-time minute packs, from {formatMoney(CHEAPEST_PACK.price, currency)}
                <span
                    aria-hidden
                    className="shrink-0 inline-flex transition-transform duration-150 ease-solkey group-aria-expanded:rotate-180 motion-reduce:transition-none">
                    <Icon name="chevron-down" size={16} />
                </span>
            </button>
            {open && (
                <div className="mt-5 max-w-190 mx-auto grid grid-cols-1 sm:grid-cols-3 gap-4 text-left">
                    {CREDIT_PACKS.map((pack) => (
                        <div key={pack.id} className="bg-surface-container-lowest tonal-layer-glow rounded-lg p-5 flex flex-col gap-1.5">
                            <span className="font-headline font-semibold text-[15px] leading-[1.2] text-on-surface">{pack.name}</span>
                            <PriceTag amount={formatMoney(pack.price, currency)} className="text-on-surface" />
                            <span className="font-body font-normal text-[13px] leading-[1.4] text-on-surface-variant">
                                {pack.minutes} min of recording · {pack.blurb}
                            </span>
                            <span className="font-body font-normal text-[12px] leading-[1.4] text-on-surface-variant">
                                {pack.compare(currency)}
                            </span>
                        </div>
                    ))}
                    <p className="sm:col-span-3 font-body font-normal text-[12px] leading-normal text-on-surface-variant text-center m-0">
                        Packs never expire and need a free account — buy them any time from Settings.
                    </p>
                </div>
            )}
        </div>
    )
}

function PricingCard(props: CardProps) {
    const { tier, currency, currentTierId } = props
    const emphasis = tier.popular === true
    const current = tier.id === currentTierId
    const [budget, ...features] = planFeatures(tier)
    const budgetHint = planBudgetHint(tier)
    const quiet = emphasis ? 'text-inverse-on-surface' : 'text-on-surface-variant'
    const free = tier.priceMonthly === 0
    return (
        <div
            className={[
                'rounded-lg p-7 flex flex-col gap-4',
                // The popular card is set apart by its charcoal alone (no offset plate: the magenta is the
                // hero CTA's); on it the focus ring turns neon so it stays visible.
                emphasis
                    ? 'bg-on-surface text-surface [--focus-ring-color:var(--color-primary-container)]'
                    : 'bg-surface-container-lowest text-on-surface tonal-layer-glow',
            ].join(' ')}>
            <div className="flex justify-between items-start gap-3">
                <div className="flex flex-col gap-1.5">
                    <h3 className="font-headline font-semibold text-[20px] leading-none tracking-[-0.01em] m-0">{tier.name}</h3>
                    <span className={`font-body font-normal text-[14px] leading-[1.3] ${quiet}`}>{tier.tagline}</span>
                </div>
                {/* The visitor's own plan wins the corner; "Best value" stays on the popular card otherwise. */}
                {current ? <Badge tone="neutral">Your plan</Badge> : emphasis && <Badge tone="secondary">Best value</Badge>}
            </div>
            {/* One price block: the month, and under it the year with its saving; Sketch keeps the line's
                height empty, so the three cards' feature lists start level. */}
            <PriceTag
                size="xl"
                amount={free ? 'Free' : formatMoney(tier.priceMonthly, currency)}
                cadence={free ? 'forever' : '/ month'}
                note={free ? null : yearlyLine(tier, currency)}
                className={emphasis ? PRICE_ON_DARK : undefined}
            />
            <ul className="list-none p-0 m-0 flex flex-col gap-2.5">
                <FeatureLine emphasis={emphasis} hint={budgetHint}>
                    {budget}
                </FeatureLine>
                {features.map((f) => (
                    <FeatureLine key={f} emphasis={emphasis}>
                        {f}
                    </FeatureLine>
                ))}
            </ul>
            <div className="mt-auto pt-2">
                <PlanCardCta {...props} primary={emphasis} />
            </div>
        </div>
    )
}

/** One checked line of a tier card (15px), with an optional 13px picture of what it means (the free budget's). */
function FeatureLine({ emphasis, hint, children }: { emphasis: boolean; hint?: string | null; children: string }) {
    return (
        <li className="flex gap-3 items-start font-body font-normal text-[15px] leading-normal">
            <span className={`shrink-0 ${emphasis ? 'text-primary-container' : 'text-primary'}`}>
                <Icon name="check" size={16} />
            </span>
            <span className="flex flex-col gap-0.5">
                <span>{children}</span>
                {hint && (
                    <span className={`text-[13px] leading-[1.4] ${emphasis ? 'text-inverse-on-surface' : 'text-on-surface-variant'}`}>
                        {hint}
                    </span>
                )}
            </span>
        </li>
    )
}
