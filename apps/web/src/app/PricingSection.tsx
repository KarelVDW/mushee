'use client'

import { useState } from 'react'

import { Eyebrow, Icon, PrimaryButton, SecondaryButton } from '@/components/ui'
import { type Currency, formatMoney } from '@/lib/currency'
import { CREDIT_PACKS, PLAN_TIERS, planFeatures, type PlanTier, recordingBudgetLabel } from '@/lib/plans'
import { useDisplayCurrency } from '@/lib/useDisplayCurrency'

/**
 * The pricing section — the tier cards, the professional tier, the one-time
 * packs teaser — shared by the landing page (#pricing) and the /pricing route.
 * Renders straight from the static plan catalogue so both pages work without
 * the API; in-app surfaces use the DB-driven `usePlans()` instead.
 */
/** `intro` — the section's own eyebrow + headline; off when a page already frames it (the /pricing hero). */
export function Pricing({ onGetStarted, intro = true }: { onGetStarted: () => void; intro?: boolean }) {
    const currency = useDisplayCurrency()
    return (
        <section id="pricing" className={intro ? 'py-14 sm:py-22 px-5 sm:px-8' : 'pt-10 pb-14 sm:pt-12 sm:pb-22 px-5 sm:px-8'}>
            <div className="max-w-320 mx-auto">
                {intro && (
                    <div className="mb-12 text-center">
                        <Eyebrow className="text-primary">Pricing</Eyebrow>
                        <h2 className="font-display font-bold text-[32px] sm:text-[48px] leading-none tracking-[-0.03em] text-on-surface mt-3 mx-auto mb-0">
                            Pay for recording time, nothing else.
                        </h2>
                        <p className="font-body font-normal text-[15px] leading-normal text-on-surface-variant mt-4 max-w-140 mx-auto">
                            Every plan gets the full editor, live audio-to-notation, and playback. The plans differ in how much you can
                            record per day — and Sketch holds up to five scores.
                        </p>
                    </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-100 md:max-w-none mx-auto w-full">
                    {PLAN_TIERS.filter((tier) => !tier.professional).map((tier) => (
                        <PricingCard key={tier.id} tier={tier} currency={currency} onGetStarted={onGetStarted} />
                    ))}
                </div>

                {PLAN_TIERS.filter((tier) => tier.professional).map((tier) => (
                    <ProfessionalCard key={tier.id} tier={tier} currency={currency} onGetStarted={onGetStarted} />
                ))}

                <PacksTeaser currency={currency} />

                <p className="mt-6 font-body font-normal text-[12px] leading-normal text-on-surface-variant text-center m-0">
                    {currency === 'eur'
                        ? 'Euro prices include VAT — the amount you see is the total you pay.'
                        : 'Prices are shown before local sales tax, which is added at checkout.'}
                </p>
            </div>
        </section>
    )
}

/** The pricing section while the closed beta runs: the tier ladder and all
 *  prices stay hidden — they may still change as real costs surface — so the
 *  section only says what the beta costs (nothing) and that pricing follows
 *  at launch. Keeps the #pricing anchor the nav and terms page link to. */
export function BetaPricing() {
    return (
        <section id="pricing" className="py-14 sm:py-22 px-5 sm:px-8">
            <div className="max-w-190 mx-auto text-center">
                <Eyebrow className="text-primary">Pricing</Eyebrow>
                <h2 className="font-display font-bold text-[32px] sm:text-[48px] leading-none tracking-[-0.03em] text-on-surface mt-3 mb-0">
                    Free while the beta runs.
                </h2>
                <p className="font-body font-normal text-[15px] leading-normal text-on-surface-variant mt-4 mb-0 max-w-140 mx-auto">
                    Every beta account gets the same plan: the full editor, live audio-to-notation, playback, and 30 minutes of recording
                    per day — no card, no charge. Paid plans arrive at launch.
                </p>
            </div>
        </section>
    )
}

/** The professional tier: present enough to anchor the ladder, slim enough
 *  not to compete with the consumer cards. */
function ProfessionalCard({ tier, currency, onGetStarted }: { tier: PlanTier; currency: Currency; onGetStarted: () => void }) {
    return (
        <div className="mt-6 max-w-190 mx-auto w-full bg-surface-container-lowest tonal-layer-glow rounded-lg px-6 py-5 flex flex-wrap items-center gap-4">
            <span className="w-10 h-10 rounded-full bg-secondary-soft text-on-secondary-soft inline-flex items-center justify-center shrink-0">
                <Icon name={tier.icon} size={18} />
            </span>
            <div className="flex flex-col gap-0.5 flex-1 min-w-50">
                <span className="font-headline font-semibold text-[16px] leading-[1.2] text-on-surface">
                    {tier.name} — {tier.tagline.toLowerCase()}
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
            <SecondaryButton onClick={onGetStarted}>{`Go ${tier.name}`}</SecondaryButton>
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
                Not ready for a subscription? One-time minute packs, from {formatMoney(6, currency)}
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

function PricingCard({ tier, currency, onGetStarted }: { tier: PlanTier; currency: Currency; onGetStarted: () => void }) {
    const emphasis = tier.popular === true
    const cta = tier.priceMonthly === 0 ? 'Start sketching' : `Go ${tier.name}`
    return (
        <div
            className={[
                'rounded-lg p-7 flex flex-col gap-4',
                emphasis
                    ? 'bg-on-surface text-surface shadow-(--shadow-offset-3)'
                    : 'bg-surface-container-lowest text-on-surface tonal-layer-glow',
            ].join(' ')}>
            <div className="flex justify-between items-start">
                <h3 className="font-headline font-semibold text-[20px] leading-none tracking-[-0.01em] m-0">{tier.name}</h3>
                {emphasis && (
                    <span className="font-label font-semibold text-[10px] leading-none uppercase tracking-[0.12em] bg-secondary-soft text-on-secondary-soft px-2.5 py-1.5 rounded-full">
                        Best value
                    </span>
                )}
            </div>
            <div className="flex items-baseline gap-1.5">
                <span className="font-display font-bold text-[40px] tracking-[-0.03em]">
                    {tier.priceMonthly === 0 ? 'Free' : formatMoney(tier.priceMonthly, currency)}
                </span>
                <span
                    className={[
                        'font-body font-medium text-[13px] leading-none',
                        emphasis ? 'text-inverse-on-surface' : 'text-on-surface-variant',
                    ].join(' ')}>
                    {tier.priceMonthly === 0 ? 'forever' : `/ month · ${formatMoney(tier.priceYearly, currency)}/yr`}
                </span>
            </div>
            <ul className="list-none p-0 m-0 flex flex-col gap-2.5">
                {planFeatures(tier).map((f) => (
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
                    <PrimaryButton onClick={onGetStarted} fullWidth>
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
