'use client'

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
 * A tier card's button. For a stranger: "Start free" / "Choose {plan}" into signup (or, for a
 * signed-in visitor whose plan isn't known yet, the plan dialog). Once the visitor's plan is
 * known: "Your plan" on their own card, to the plan tab, and "Switch to {plan}" on the others,
 * to the plan tab's Change plan with that tier selected.
 */
function PlanCardCta({
    tier,
    ctaLocation,
    currentTierId,
    primary,
    fullWidth = false,
}: CardProps & { primary: boolean; fullWidth?: boolean }) {
    if (currentTierId === null) {
        return (
            <GetStartedButton location={ctaLocation} plan={tier.id} variant={primary ? 'primary' : 'secondary'} fullWidth={fullWidth}>
                {planCtaLabel(tier)}
            </GetStartedButton>
        )
    }
    if (tier.id === currentTierId) {
        return (
            <SecondaryButton href={settingsTabPath('plan')} fullWidth={fullWidth}>
                Your plan
            </SecondaryButton>
        )
    }
    const href = withPlan(settingsTabPath('plan'), tier.id)
    const label = `Switch to ${tier.name}`
    return primary ? (
        <PrimaryButton href={href} fullWidth={fullWidth}>
            {label}
        </PrimaryButton>
    ) : (
        <SecondaryButton href={href} fullWidth={fullWidth}>
            {label}
        </SecondaryButton>
    )
}

/** The professional tier: present enough to anchor the ladder, slim enough
 *  not to compete with the consumer cards. */
function ProfessionalCard(props: CardProps) {
    const { tier, currency, currentTierId } = props
    return (
        <div className="mt-6 max-w-190 mx-auto w-full bg-surface-container-lowest tonal-layer-glow rounded-lg px-6 py-5 flex flex-wrap items-center gap-4">
            <span className="w-10 h-10 rounded-full bg-secondary-soft text-on-secondary-soft inline-flex items-center justify-center shrink-0">
                <Icon name={tier.icon} size={18} />
            </span>
            <div className="flex flex-col gap-0.5 flex-1 min-w-50">
                <span className="inline-flex flex-wrap items-center gap-2 font-headline font-semibold text-[16px] leading-[1.2] text-on-surface">
                    {tier.name} — {tier.tagline.toLowerCase()}
                    {tier.id === currentTierId && <Badge tone="neutral">Your plan</Badge>}
                </span>
                <span className="font-body font-normal text-[13px] leading-[1.4] text-on-surface-variant">
                    {recordingBudgetLabel(tier.dailyRecordingSeconds)} · everything in Studio · direct support from the maker
                </span>
            </div>
            <div className="flex items-baseline gap-1.5">
                <span className="font-mono font-semibold text-[22px] leading-none tracking-[-0.01em] text-on-surface">
                    {formatMoney(tier.priceMonthly, currency)}
                </span>
                <span className="font-body font-medium text-[12px] leading-none text-on-surface-variant">
                    / month · {formatMoney(tier.priceYearly, currency)}/yr
                </span>
            </div>
            <PlanCardCta {...props} primary={false} />
        </div>
    )
}

/** One-time packs, one click away — the subscriptions above stay the offer. */
function PacksTeaser({ currency }: { currency: Currency }) {
    const [open, setOpen] = useState(false)
    return (
        <div className="mt-8 text-center">
            <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                aria-expanded={open}
                className="border-0 bg-transparent p-0 cursor-pointer font-body font-medium text-[14px] text-primary underline">
                Not ready for a subscription? One-time minute packs, from {formatMoney(CHEAPEST_PACK.price, currency)}
            </button>
            {open && (
                <div className="mt-5 max-w-190 mx-auto grid grid-cols-1 sm:grid-cols-3 gap-4 text-left">
                    {CREDIT_PACKS.map((pack) => (
                        <div key={pack.id} className="bg-surface-container-lowest tonal-layer-glow rounded-lg p-5 flex flex-col gap-1.5">
                            <span className="font-headline font-semibold text-[15px] leading-[1.2] text-on-surface">{pack.name}</span>
                            <span className="font-mono font-semibold text-[20px] leading-none tracking-[-0.01em] text-on-surface">
                                {formatMoney(pack.price, currency)}
                            </span>
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
    return (
        <div
            className={[
                'rounded-lg p-7 flex flex-col gap-4',
                emphasis
                    ? 'bg-on-surface text-surface shadow-(--shadow-offset-3)'
                    : 'bg-surface-container-lowest text-on-surface tonal-layer-glow',
            ].join(' ')}>
            <div className="flex justify-between items-start gap-3">
                <div className="flex flex-col gap-1.5">
                    <h3 className="font-headline font-semibold text-[20px] leading-none tracking-[-0.01em] m-0">{tier.name}</h3>
                    <span className={`font-body font-normal text-[13px] leading-[1.3] ${quiet}`}>{tier.tagline}</span>
                </div>
                {/* The visitor's own plan wins the corner; "Best value" stays on the popular card otherwise. */}
                {current ? <Badge tone="neutral">Your plan</Badge> : emphasis && <Badge tone="secondary">Best value</Badge>}
            </div>
            <div className="flex items-baseline gap-1.5">
                <span className="font-display font-bold text-[40px] tracking-[-0.03em]">
                    {tier.priceMonthly === 0 ? 'Free' : formatMoney(tier.priceMonthly, currency)}
                </span>
                <span className={`font-body font-medium text-[13px] leading-none ${quiet}`}>
                    {tier.priceMonthly === 0 ? 'forever' : `/ month · ${formatMoney(tier.priceYearly, currency)}/yr`}
                </span>
            </div>
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
                <PlanCardCta {...props} primary={emphasis} fullWidth />
            </div>
        </div>
    )
}

/** One checked line of a tier card, with an optional 12px picture of what it means (the free budget's). */
function FeatureLine({ emphasis, hint, children }: { emphasis: boolean; hint?: string | null; children: string }) {
    return (
        <li className="flex gap-2.5 items-start font-body font-normal text-[14px] leading-normal">
            <span className={emphasis ? 'text-primary-container' : 'text-primary'}>
                <Icon name="check" size={16} />
            </span>
            <span className="flex flex-col gap-0.5">
                <span>{children}</span>
                {hint && (
                    <span className={`text-[12px] leading-[1.4] ${emphasis ? 'text-inverse-on-surface' : 'text-on-surface-variant'}`}>
                        {hint}
                    </span>
                )}
            </span>
        </li>
    )
}
