'use client'

import { PriceTag, SelectedMark } from '@mushee/ui'
import { useId, useState } from 'react'

import { Badge, Eyebrow, Icon, Segmented } from '@/components/ui'
import type { BillingInterval } from '@/lib/api'
import { type Currency, formatMoney } from '@/lib/currency'
import { planFeatures, planPriceParts, planSavingsPercent, type PlanTier } from '@/lib/plans'
import { useDisplayCurrency } from '@/lib/useDisplayCurrency'
import { useMediaQuery } from '@/lib/useMediaQuery'
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
    /** Marks the user's current plan, in the cadence they pay (settings); onboarding has none. */
    isCurrent?: (plan: PlanTier) => boolean
    /**
     * The tier the account is on (settings), whatever the cadence: "Best value" then marks the
     * popular tier only while it is above this one, so it never nudges a subscriber down.
     */
    currentTierId?: string
    /**
     * Radio rows (name, price, a one-line tagline) instead of cards — the selection and the
     * flow's button then fit one screen. From md each row carries its features as one line;
     * on phones they open behind "Compare plans". Professional tiers wait behind "Recording for
     * work? See …". For onboarding's plan step, at every width.
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
    const { plans, billing, onBillingChange, selected, onSelect, isCurrent, currentTierId } = props
    const consumer = plans.filter((p) => !p.professional)
    const professional = plans.filter((p) => p.professional)
    return (
        <>
            <BillingToggle plans={plans} value={billing} onChange={onBillingChange} />
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {consumer.map((p) => (
                    <TierCard
                        key={p.id}
                        plan={p}
                        billing={billing}
                        currency={currency}
                        active={selected === p.id}
                        current={isCurrent?.(p)}
                        bestValue={marksBestValue(plans, p, currentTierId)}
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
                    bestValue={marksBestValue(plans, p, currentTierId)}
                    onSelect={() => onSelect(p.id)}
                />
            ))}
        </>
    )
}

/** Whether "Best value" marks `plan`: the popular tier, for someone below it on the ladder (`plans` is in ladder order). */
function marksBestValue(plans: PlanTier[], plan: PlanTier, currentTierId: string | undefined): boolean {
    return plan.popular === true && plans.findIndex((p) => p.id === currentTierId) < plans.indexOf(plan)
}

/** A tier's one badge: "Your plan" on the account's own (as on /pricing), else "Best value" where it applies. */
function PlanBadge({ current, bestValue, className }: { current?: boolean; bestValue?: boolean; className?: string }) {
    if (current)
        return (
            <Badge tone="neutral" className={className}>
                Your plan
            </Badge>
        )
    if (bestValue)
        return (
            <Badge tone="secondary" className={className}>
                Best value
            </Badge>
        )
    return null
}

/**
 * The plans as radio rows: name and tagline, the price at the right, an 18px ring that takes a
 * SelectedMark when chosen (so the choice never rests on the fill colour alone). From md the
 * features run as one line under the tagline; on phones "Compare plans" opens every row's list.
 * Professional tiers wait behind their own link and show from the start when one of them is
 * the chosen tier.
 */
function CompactPlanPicker({
    plans,
    billing,
    onBillingChange,
    selected,
    onSelect,
    isCurrent,
    currentTierId,
    currency,
}: PlanPickerProps & { currency: Currency }) {
    const consumer = plans.filter((p) => !p.professional)
    const professional = plans.filter((p) => p.professional)
    // From md a row has the room to carry its features inline, so there is nothing to open.
    const wide = useMediaQuery('(min-width: 768px)')
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
            <BillingToggle plans={plans} value={billing} onChange={onBillingChange} />
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
                        bestValue={marksBestValue(plans, p, currentTierId)}
                        features={wide ? 'inline' : comparing ? 'list' : 'none'}
                        onSelect={() => onSelect(p.id)}
                    />
                ))}
            </div>
            <div className="flex items-center justify-between gap-x-4 flex-wrap -mt-1">
                {!wide && (
                    <button type="button" aria-expanded={comparing} onClick={() => setComparing((c) => !c)} className={DISCLOSURE_CLASS}>
                        Compare plans
                        <span
                            className={['inline-flex transition-transform duration-200 ease-solkey', comparing ? 'rotate-180' : ''].join(
                                ' ',
                            )}>
                            <Icon name="chevron-down" size={14} />
                        </span>
                    </button>
                )}
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
function rowPrice(plan: PlanTier, billing: BillingInterval, currency: Currency): { amount: string; cadence?: string } {
    if (plan.priceMonthly === 0) return { amount: 'Free' }
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
    bestValue,
    features,
    onSelect,
}: TierCardProps & {
    radio: RadioProps
    /** `inline`: one ' · ' line under the tagline (md up); `list`: the opened comparison (phones); `none`. */
    features: 'inline' | 'list' | 'none'
}) {
    const price = rowPrice(plan, billing, currency)
    const featuresId = useId()
    return (
        <button
            {...radio}
            type="button"
            role="radio"
            aria-checked={active}
            // The inline features describe the row rather than name it: aria-hidden in the content
            // (so the name stays plan, tagline, price) and read out through this reference.
            aria-describedby={features === 'inline' ? featuresId : undefined}
            onClick={onSelect}
            className={`${cardShell(active)} px-5 py-4 flex flex-col gap-3`}>
            <span className="flex items-center gap-3 w-full">
                {/* The ring's 18px slot holds the mark when chosen. */}
                <span
                    aria-hidden="true"
                    className={[
                        'size-4.5 shrink-0 rounded-full inline-flex items-center justify-center',
                        active ? '' : 'border-2 border-solid border-outline',
                    ].join(' ')}>
                    {active && <SelectedMark />}
                </span>
                <span className="flex flex-col gap-0.5 flex-1 min-w-0">
                    <span className="flex items-center gap-2 flex-wrap">
                        <span className="font-body font-semibold text-[15px] leading-[1.2]">{plan.name}</span>
                        <PlanBadge current={current} bestValue={bestValue} />
                    </span>
                    <span className="font-body font-normal text-[12px] leading-[1.3] opacity-80">{plan.tagline}</span>
                    {features === 'inline' && (
                        <span
                            id={featuresId}
                            aria-hidden="true"
                            className={`mt-1 font-body font-normal text-[13px] leading-[1.4] text-pretty ${active ? 'opacity-85' : 'text-on-surface-variant'}`}>
                            {planFeatures(plan).join(' · ')}
                        </span>
                    )}
                </span>
                <PriceTag amount={price.amount} cadence={price.cadence} size="md" className="shrink-0" />
            </span>
            {/* Spans, not a list: a button may only hold phrasing content. */}
            {features === 'list' && (
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

/**
 * What paying yearly saves, for the toggle's label: the smallest saving among the paid plans on
 * offer, so the label never promises more than any one of them gives (today they all save the
 * same). 0 when none is cheaper by the year.
 */
function yearlySavingsPercent(plans: PlanTier[]): number {
    const savings = plans.map(planSavingsPercent).filter((n) => n > 0)
    return savings.length === 0 ? 0 : Math.min(...savings)
}

/** Monthly or yearly: a radio Segmented on the inset track (the picker sits on a white card or dialog). */
function BillingToggle({ plans, value, onChange }: { plans: PlanTier[]; value: BillingInterval; onChange: (v: BillingInterval) => void }) {
    const savings = yearlySavingsPercent(plans)
    return (
        <div className="self-start">
            <Segmented<BillingInterval>
                mode="radio"
                tone="inset"
                ariaLabel="How often you pay"
                value={value}
                onChange={onChange}
                options={[
                    { value: 'monthly', label: 'Monthly' },
                    { value: 'yearly', label: savings > 0 ? `Yearly · save ${savings}%` : 'Yearly' },
                ]}
            />
        </div>
    )
}

interface TierCardProps {
    plan: PlanTier
    billing: BillingInterval
    currency: Currency
    active: boolean
    current?: boolean
    /** Carries the "Best value" badge (see marksBestValue). */
    bestValue?: boolean
    onSelect: () => void
}

/**
 * A tier card or row. The picker always sits inside a white card or dialog, and a card never sits
 * on a card: no glow, a tonal step down at rest and a further one on hover. Chosen, the selected
 * fill, paired with a SelectedMark wherever it renders — never colour alone.
 */
function cardShell(active: boolean): string {
    return [
        'relative text-left border-0 rounded-lg cursor-pointer transition-colors duration-150 ease-solkey',
        'focus-ring',
        active
            ? 'bg-(--color-selected) text-(--color-on-selected)'
            : 'bg-surface-container-low text-on-surface hover:bg-surface-container-high',
    ].join(' ')
}

/** Where a tier card pins its badge: straddling the top edge, near the right corner. */
const CARD_BADGE = 'absolute -top-2.5 right-3.5'

/** Amount, cadence note, savings — the same three lines in both cadences and on every tier (a free
 *  plan's note is an invisible placeholder line), so the ladder lines up across the cards and a
 *  card never changes height when the billing toggle flips. */
function PriceBlock({
    plan,
    billing,
    currency,
    active,
}: {
    plan: PlanTier
    billing: BillingInterval
    currency: Currency
    active: boolean
}) {
    const price = planPriceParts(plan, billing, currency)
    return (
        <div className="flex flex-col gap-1">
            <PriceTag amount={price.amount} cadence={price.cadence} note={price.note || null} size="md" />
            {/* On monthly the line stays as an invisible placeholder, so the card keeps its height
                when the billing toggle flips; on a plan with nothing to save it holds the line from
                sm, where the cards sit side by side, so every feature list starts level. */}
            <Eyebrow
                className={
                    price.savings <= 0 ? 'invisible max-sm:hidden' : billing === 'yearly' ? (active ? '' : 'text-primary') : 'invisible'
                }>
                {price.savings > 0 ? `Saving ${formatMoney(price.savings, currency)}/yr` : ' '}
            </Eyebrow>
        </div>
    )
}

function TierCard({ plan, billing, currency, active, current, bestValue, onSelect }: TierCardProps) {
    return (
        <button
            onClick={onSelect}
            type="button"
            aria-pressed={active}
            className={`${cardShell(active)} px-5 pt-5 pb-4.5 flex flex-col gap-3.5`}>
            <PlanBadge current={current} bestValue={bestValue} className={CARD_BADGE} />
            <div className="flex items-center gap-2.5">
                <span
                    className={[
                        'w-8 h-8 rounded-full shrink-0 inline-flex items-center justify-center',
                        active ? 'bg-on-primary-soft text-primary-soft' : 'bg-surface-container text-primary',
                    ].join(' ')}>
                    <Icon name={plan.icon} size={18} />
                </span>
                <div className="flex flex-col min-w-0">
                    <span className="font-body font-semibold text-[15px] leading-[1.2]">{plan.name}</span>
                    <span className="font-body font-normal text-[12px] leading-[1.3] opacity-80">{plan.tagline}</span>
                </div>
                {active && <SelectedMark className="ml-auto self-start" />}
            </div>
            <PriceBlock plan={plan} billing={billing} currency={currency} active={active} />
            <ul className="list-none p-0 m-0 flex flex-col gap-2">
                {planFeatures(plan).map((f) => (
                    <li key={f} className="flex items-start gap-2 font-body font-normal text-[13px] leading-[1.4] text-pretty">
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
function ProfessionalTierCard({ plan, billing, currency, active, current, bestValue, onSelect }: TierCardProps) {
    return (
        <button
            onClick={onSelect}
            type="button"
            aria-pressed={active}
            className={`${cardShell(active)} px-5 py-4.5 flex flex-wrap items-center gap-4`}>
            <PlanBadge current={current} bestValue={bestValue} className={CARD_BADGE} />
            <span
                className={[
                    'w-10 h-10 rounded-full shrink-0 inline-flex items-center justify-center',
                    active ? 'bg-on-primary-soft text-primary-soft' : 'bg-surface-container text-primary',
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
            <PriceBlock plan={plan} billing={billing} currency={currency} active={active} />
            {active && <SelectedMark className="self-start" />}
        </button>
    )
}
