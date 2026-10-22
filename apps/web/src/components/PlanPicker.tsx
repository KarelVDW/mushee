'use client'

import { useState } from 'react'

import { Badge, Eyebrow, Icon } from '@/components/ui'
import type { BillingInterval } from '@/lib/api'
import { type Currency, formatMoney } from '@/lib/currency'
import { planFeatures, planPriceParts, type PlanTier } from '@/lib/plans'
import { useDisplayCurrency } from '@/lib/useDisplayCurrency'
import { type RadioProps, useRadioGroup } from '@/lib/useRadioGroup'

interface PlanPickerProps {
    plans: PlanTier[]
    billing: BillingInterval
    onBillingChange: (b: BillingInterval) => void
    /**
     * The chosen tier, always the caller's: the picker never preselects one itself, so a flow
     * entered through a free button passes Sketch (or the tier a ?plan= asked for), never a
     * paid tier on its own initiative. null leaves every plan unchosen.
     */
    selected: PlanTier['id'] | null
    onSelect: (id: PlanTier['id']) => void
    /** Marks the user's current plan (settings); onboarding has none. */
    isCurrent?: (plan: PlanTier) => boolean
    /**
     * Radio rows (name, price, a one-line tagline) instead of cards — the selection and the
     * flow's button then fit one phone screen. Feature lists open behind "Compare plans", and
     * professional tiers behind "Recording for work? See …". For onboarding's plan step.
     */
    compact?: boolean
}

/**
 * The subscription picker shared by onboarding and settings, mirroring the
 * landing page's ladder: the three consumer tiers side by side, professional
 * tiers as a slim full-width card below — present enough to anchor the
 * ladder, separate enough not to add a fourth column to the decision.
 * `compact` swaps the cards for radio rows (CompactPlanPicker).
 */
export function PlanPicker(props: PlanPickerProps) {
    const currency = useDisplayCurrency()
    if (props.compact) return <CompactPlanPicker {...props} currency={currency} />
    const { plans, billing, onBillingChange, selected, onSelect, isCurrent } = props
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

/**
 * The plans as radio rows: name and tagline, the price at the right, an 18px ring that fills
 * with a check when chosen (so the choice never rests on the fill colour alone). "Compare
 * plans" opens every row's feature list; professional tiers wait behind their own link and
 * show from the start when one of them is the chosen tier.
 */
function CompactPlanPicker({
    plans,
    billing,
    onBillingChange,
    selected,
    onSelect,
    isCurrent,
    currency,
}: PlanPickerProps & { currency: Currency }) {
    const consumer = plans.filter((p) => !p.professional)
    const professional = plans.filter((p) => p.professional)
    const [comparing, setComparing] = useState(false)
    const [showProfessional, setShowProfessional] = useState(() => professional.some((p) => p.id === selected))
    const shown = showProfessional ? plans : consumer
    const radios = useRadioGroup(
        shown.map((p) => p.id),
        selected,
        onSelect,
    )

    // The link goes away once used, so focus moves to the row it revealed rather than to <body>.
    const revealProfessional = () => {
        setShowProfessional(true)
        const firstProfessional = plans.findIndex((p) => p.professional)
        requestAnimationFrame(() => radios.focus(firstProfessional))
    }

    return (
        <>
            <BillingToggle value={billing} onChange={onBillingChange} />
            <div role="radiogroup" aria-label="Plans" className="flex flex-col gap-2">
                {shown.map((p, index) => (
                    <PlanRow
                        key={p.id}
                        radio={radios.radioProps(index)}
                        plan={p}
                        billing={billing}
                        currency={currency}
                        active={selected === p.id}
                        current={isCurrent?.(p)}
                        expanded={comparing}
                        onSelect={() => onSelect(p.id)}
                    />
                ))}
            </div>
            <div className="flex items-center justify-between gap-x-4 flex-wrap -mt-1">
                <button type="button" aria-expanded={comparing} onClick={() => setComparing((c) => !c)} className={DISCLOSURE_CLASS}>
                    Compare plans
                    <span
                        className={['inline-flex transition-transform duration-200 ease-solkey', comparing ? 'rotate-180' : ''].join(' ')}>
                        <Icon name="chevron-down" size={14} />
                    </span>
                </button>
                {!showProfessional && professional[0] && (
                    <button type="button" onClick={revealProfessional} className={DISCLOSURE_CLASS}>
                        Recording for work? See {professional[0].name}
                    </button>
                )}
            </div>
        </>
    )
}

/** A quiet text button for the compact picker's two disclosures, with the 40px touch floor. */
const DISCLOSURE_CLASS = [
    'inline-flex items-center gap-1.5 bg-transparent border-0 px-0 py-2 cursor-pointer rounded-sm',
    'pointer-coarse:min-h-10',
    'font-body font-medium text-[13px] leading-none text-primary hover:text-on-surface',
    'transition-colors duration-150 ease-solkey focus-ring',
].join(' ')

/** The price a compact row shows: the amount per month, or per year once yearly is picked. */
function rowPrice(plan: PlanTier, billing: BillingInterval, currency: Currency): { amount: string; cadence: string } {
    if (plan.priceMonthly === 0) return { amount: 'Free', cadence: '' }
    return billing === 'yearly'
        ? { amount: formatMoney(plan.priceYearly, currency), cadence: '/year' }
        : { amount: formatMoney(plan.priceMonthly, currency), cadence: '/month' }
}

function PlanRow({
    radio,
    plan,
    billing,
    currency,
    active,
    current,
    expanded,
    onSelect,
}: TierCardProps & { radio: RadioProps; expanded: boolean }) {
    const price = rowPrice(plan, billing, currency)
    return (
        <button
            {...radio}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={onSelect}
            className={`${cardShell(active)} px-4 py-3.5 flex flex-col gap-3`}>
            <span className="flex items-center gap-3 w-full">
                <span
                    aria-hidden="true"
                    className={[
                        'size-4.5 shrink-0 rounded-full inline-flex items-center justify-center',
                        active ? 'bg-primary-container text-on-primary-container' : 'border-2 border-solid border-outline',
                    ].join(' ')}>
                    {active && <Icon name="check" size={12} />}
                </span>
                <span className="flex flex-col gap-0.5 flex-1 min-w-0">
                    <span className="flex items-center gap-2 flex-wrap">
                        <span className="font-body font-semibold text-[15px] leading-[1.2]">{plan.name}</span>
                        {current ? <Badge tone="neutral">Current</Badge> : plan.popular ? <Badge tone="secondary">Best value</Badge> : null}
                    </span>
                    <span className="font-body font-normal text-[12px] leading-[1.3] opacity-80">{plan.tagline}</span>
                </span>
                <span className="flex items-baseline gap-0.5 shrink-0">
                    <span className="font-mono font-semibold text-[18px] leading-none tracking-[-0.01em]">{price.amount}</span>
                    {price.cadence && <span className="font-body font-normal text-[12px] leading-none opacity-80">{price.cadence}</span>}
                </span>
            </span>
            {/* Spans, not a list: a button may only hold phrasing content. */}
            {expanded && (
                <span className="pl-7.5 flex flex-col gap-1.5">
                    {planFeatures(plan).map((f) => (
                        <span key={f} className="flex items-start gap-2 font-body font-normal text-[13px] leading-[1.4]">
                            <span className="mt-px opacity-80">
                                <Icon name="check" size={14} />
                            </span>
                            {f}
                        </span>
                    ))}
                </span>
            )}
        </button>
    )
}

const BILLING_OPTIONS = [
    ['monthly', 'Monthly'],
    ['yearly', 'Yearly · save 17%'],
] as const satisfies readonly (readonly [BillingInterval, string])[]

function BillingToggle({ value, onChange }: { value: BillingInterval; onChange: (v: BillingInterval) => void }) {
    const radios = useRadioGroup(
        BILLING_OPTIONS.map(([k]) => k),
        value,
        onChange,
    )
    return (
        <div
            role="radiogroup"
            aria-label="How often you pay"
            className="inline-flex p-0.75 rounded-full bg-surface-container-low self-start">
            {BILLING_OPTIONS.map(([k, label], index) => {
                const active = value === k
                return (
                    <button
                        key={k}
                        {...radios.radioProps(index)}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        onClick={() => onChange(k)}
                        className={[
                            'border-0 px-3.5 py-1.75 rounded-full cursor-pointer font-label font-semibold text-[12px] leading-none transition-all duration-150 ease-solkey',
                            'focus-ring',
                            active ? 'bg-primary-container text-on-primary-container' : 'bg-transparent text-on-surface-variant',
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
    billing: BillingInterval
    currency: Currency
    active: boolean
    current?: boolean
    onSelect: () => void
}

function cardShell(active: boolean): string {
    return [
        'relative text-left border-0 rounded-lg cursor-pointer transition-all duration-150 ease-solkey',
        'focus-ring',
        active
            ? 'bg-primary-soft text-on-primary-soft'
            : 'bg-surface-container-lowest text-on-surface tonal-layer-glow hover:bg-surface-container',
    ].join(' ')
}

/** Where a tier card pins its badge: straddling the top edge, near the right corner. */
const CARD_BADGE = 'absolute -top-2.5 right-3.5'

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
    billing: BillingInterval
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

function TierCard({ plan, billing, currency, active, current, onSelect }: TierCardProps) {
    return (
        <button
            onClick={onSelect}
            type="button"
            aria-pressed={active}
            className={`${cardShell(active)} px-4.5 pt-5 pb-4.5 flex flex-col gap-3.5`}>
            {current ? (
                <Badge tone="neutral" className={CARD_BADGE}>
                    Current
                </Badge>
            ) : plan.popular ? (
                <Badge tone="secondary" className={CARD_BADGE}>
                    Best value
                </Badge>
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
function ProfessionalTierCard({ plan, billing, currency, active, current, onSelect }: TierCardProps) {
    return (
        <button
            onClick={onSelect}
            type="button"
            aria-pressed={active}
            className={`${cardShell(active)} px-5 py-4.5 flex flex-wrap items-center gap-4`}>
            {current && (
                <Badge tone="neutral" className={CARD_BADGE}>
                    Current
                </Badge>
            )}
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
                <span
                    className={['font-body font-normal text-[13px] leading-[1.4]', active ? 'opacity-85' : 'text-on-surface-variant'].join(
                        ' ',
                    )}>
                    {planFeatures(plan).join(' · ')}
                </span>
            </div>
            <PriceBlock plan={plan} billing={billing} currency={currency} active={active} size="sm" />
        </button>
    )
}
