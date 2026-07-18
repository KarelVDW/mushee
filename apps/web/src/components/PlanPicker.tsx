'use client'

import { type ReactNode } from 'react'

import { Eyebrow, Icon } from '@/components/ui'
import { type Currency, formatMoney } from '@/lib/currency'
import { type Billing, planFeatures, planPriceParts, type PlanTier } from '@/lib/plans'
import { useDisplayCurrency } from '@/lib/useDisplayCurrency'

/**
 * The subscription picker shared by onboarding and settings, mirroring the
 * landing page's ladder: the three consumer tiers side by side, professional
 * tiers as a slim full-width card below — present enough to anchor the
 * ladder, separate enough not to add a fourth column to the decision.
 */
export function PlanPicker({
    plans,
    billing,
    onBillingChange,
    selected,
    onSelect,
    isCurrent,
}: {
    plans: PlanTier[]
    billing: Billing
    onBillingChange: (b: Billing) => void
    selected: PlanTier['id']
    onSelect: (id: PlanTier['id']) => void
    /** Marks the user's current plan (settings); onboarding has none. */
    isCurrent?: (plan: PlanTier) => boolean
}) {
    const currency = useDisplayCurrency()
    const consumer = plans.filter((p) => !p.professional)
    const professional = plans.filter((p) => p.professional)
    return (
        <>
            <BillingToggle value={billing} onChange={onBillingChange} />
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {consumer.map((p) => (
                    <TierCard
                        key={p.id}
                        plan={p}
                        billing={billing}
                        currency={currency}
                        active={selected === p.id}
                        current={isCurrent?.(p)}
                        onSelect={() => onSelect(p.id)}
                    />
                ))}
            </div>
            {professional.map((p) => (
                <ProfessionalTierCard
                    key={p.id}
                    plan={p}
                    billing={billing}
                    currency={currency}
                    active={selected === p.id}
                    current={isCurrent?.(p)}
                    onSelect={() => onSelect(p.id)}
                />
            ))}
        </>
    )
}

export function BillingToggle({ value, onChange }: { value: Billing; onChange: (v: Billing) => void }) {
    return (
        <div role="radiogroup" aria-label="Billing cadence" className="inline-flex p-0.75 rounded-full bg-surface-container-low self-start">
            {(
                [
                    ['monthly', 'Monthly'],
                    ['yearly', 'Yearly · save 17%'],
                ] as const
            ).map(([k, label]) => {
                const active = value === k
                return (
                    <button
                        key={k}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        onClick={() => onChange(k)}
                        className={[
                            'border-0 px-3.5 py-1.75 rounded-full cursor-pointer font-label font-semibold text-[12px] leading-none transition-all duration-150 ease-sheemu',
                            active
                                ? 'bg-primary-container text-on-primary-container'
                                : 'bg-transparent text-on-surface-variant',
                        ].join(' ')}>
                        {label}
                    </button>
                )
            })}
        </div>
    )
}

interface TierCardProps {
    plan: PlanTier
    billing: Billing
    currency: Currency
    active: boolean
    current?: boolean
    onSelect: () => void
}

function cardShell(active: boolean): string {
    return [
        'relative text-left border-0 rounded-lg cursor-pointer transition-all duration-150 ease-sheemu',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
        active ? 'bg-primary-soft text-on-primary-soft' : 'bg-surface-container-lowest text-on-surface tonal-layer-glow hover:bg-surface-container',
    ].join(' ')
}

function CardBadge({ tone, children }: { tone: 'secondary' | 'neutral'; children: ReactNode }) {
    return (
        <span
            className={[
                'absolute -top-2.5 right-3.5 font-label font-semibold text-[10px] leading-none tracking-[0.12em] uppercase px-2.5 py-1.5 rounded-full',
                tone === 'secondary' ? 'bg-secondary-soft text-on-secondary-soft' : 'bg-surface-container-high text-on-surface',
            ].join(' ')}>
            {children}
        </span>
    )
}

/** Amount, cadence note, savings — the same three lines in both cadences,
 *  so the card never changes height when the billing toggle flips. */
function PriceBlock({
    plan,
    billing,
    currency,
    active,
    size,
}: {
    plan: PlanTier
    billing: Billing
    currency: Currency
    active: boolean
    size: 'lg' | 'sm'
}) {
    const price = planPriceParts(plan, billing, currency)
    return (
        <div className="flex flex-col gap-1">
            <div className="flex items-baseline gap-1.5">
                <span
                    className={[
                        'font-mono font-semibold leading-none',
                        size === 'lg' ? 'text-[28px] tracking-[-0.02em]' : 'text-[22px] tracking-[-0.01em]',
                    ].join(' ')}>
                    {price.amount}
                </span>
                <span className="font-body font-normal text-[12px] leading-[1.3] opacity-80">{price.cadence}</span>
            </div>
            {price.note && <span className="font-body font-normal text-[12px] leading-[1.3] opacity-80">{price.note}</span>}
            {/* On monthly the line stays as invisible placeholder, so the card
                keeps its height when the billing toggle flips. */}
            {price.savings > 0 && (
                <Eyebrow className={billing === 'yearly' ? (active ? '' : 'text-primary') : 'invisible'}>
                    Saving {formatMoney(price.savings, currency)}/yr
                </Eyebrow>
            )}
        </div>
    )
}

export function TierCard({ plan, billing, currency, active, current, onSelect }: TierCardProps) {
    return (
        <button
            onClick={onSelect}
            type="button"
            aria-pressed={active}
            className={`${cardShell(active)} px-4.5 pt-5 pb-4.5 flex flex-col gap-3.5`}>
            {current ? (
                <CardBadge tone="neutral">Current</CardBadge>
            ) : plan.popular ? (
                <CardBadge tone="secondary">Best value</CardBadge>
            ) : null}
            <div className="flex items-center gap-2.5">
                <span
                    className={[
                        'w-8 h-8 rounded-full shrink-0 inline-flex items-center justify-center',
                        active ? 'bg-on-primary-soft text-primary-soft' : 'bg-surface-container text-primary',
                    ].join(' ')}>
                    <Icon name={plan.icon} size={18} />
                </span>
                <div className="flex flex-col">
                    <span className="font-body font-semibold text-[15px] leading-[1.2]">{plan.name}</span>
                    <span className="font-body font-normal text-[12px] leading-[1.3] opacity-80">{plan.tagline}</span>
                </div>
            </div>
            <PriceBlock plan={plan} billing={billing} currency={currency} active={active} size="lg" />
            <ul className="list-none p-0 m-0 flex flex-col gap-2">
                {planFeatures(plan).map((f) => (
                    <li key={f} className="flex items-start gap-2 font-body font-normal text-[13px] leading-[1.4]">
                        <span className="mt-px opacity-80">
                            <Icon name="check" size={14} />
                        </span>
                        {f}
                    </li>
                ))}
            </ul>
        </button>
    )
}

/** The professional tier as a selectable row: enough to anchor the ladder,
 *  slim enough not to compete with the consumer cards above. */
export function ProfessionalTierCard({ plan, billing, currency, active, current, onSelect }: TierCardProps) {
    return (
        <button
            onClick={onSelect}
            type="button"
            aria-pressed={active}
            className={`${cardShell(active)} px-5 py-4.5 flex flex-wrap items-center gap-4`}>
            {current && <CardBadge tone="neutral">Current</CardBadge>}
            <span
                className={[
                    'w-10 h-10 rounded-full shrink-0 inline-flex items-center justify-center',
                    active ? 'bg-on-primary-soft text-primary-soft' : 'bg-secondary-soft text-on-secondary-soft',
                ].join(' ')}>
                <Icon name={plan.icon} size={18} />
            </span>
            <div className="flex flex-col gap-0.5 flex-1 min-w-50">
                <span className="font-body font-semibold text-[15px] leading-[1.2]">
                    {plan.name} — {plan.tagline.toLowerCase()}
                </span>
                <span className={['font-body font-normal text-[13px] leading-[1.4]', active ? 'opacity-85' : 'text-on-surface-variant'].join(' ')}>
                    {planFeatures(plan).join(' · ')}
                </span>
            </div>
            <PriceBlock plan={plan} billing={billing} currency={currency} active={active} size="sm" />
        </button>
    )
}
