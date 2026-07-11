'use client'

import { type ReactNode } from 'react'

import { Eyebrow, Icon, ModalTitle, SubHeadline } from '@/components/ui'
import { type Billing, planFeatures, type PlanTier } from '@/lib/plans'

import { formatPrice } from './onboarding-data'

export function StepShell({ title, subtitle, children }: { title: ReactNode; subtitle: ReactNode; children: ReactNode }) {
    return (
        <div className="flex flex-col gap-5">
            <ModalTitle>{title}</ModalTitle>
            <SubHeadline>{subtitle}</SubHeadline>
            {children}
        </div>
    )
}

export function StepProgress({ step, total }: { step: number; total: number }) {
    return (
        <div className="flex gap-1.5 items-center">
            {Array.from({ length: total }).map((_, i) => (
                <div
                    key={i}
                    className={[
                        'h-1 rounded-sm flex-1 max-w-12 transition-colors duration-200 ease-sheemu',
                        i <= step ? 'bg-primary-container' : 'bg-surface-container',
                    ].join(' ')}
                />
            ))}
            <Eyebrow className="ml-2">
                {Math.min(step + 1, total)} of {total}
            </Eyebrow>
        </div>
    )
}

export function OptionCard({ active, onClick, title, body }: { active?: boolean; onClick?: () => void; title: ReactNode; body?: ReactNode }) {
    return (
        <button
            onClick={onClick}
            type="button"
            className={[
                'text-left border-0 rounded-md px-5 py-4.5 cursor-pointer flex gap-3.5 items-start transition-colors duration-150 ease-sheemu',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
                active ? 'bg-primary-soft text-on-primary-soft' : 'bg-surface-container-lowest text-on-surface tonal-layer-glow hover:bg-surface-container',
            ].join(' ')}>
            <div className="flex flex-col gap-1">
                <span className="font-body font-semibold text-[15px] leading-[1.2]">{title}</span>
                {body && (
                    <span
                        className={[
                            'font-body font-normal text-[13px] leading-[1.4] opacity-85',
                            active ? 'text-on-primary-soft' : 'text-on-surface-variant',
                        ].join(' ')}>
                        {body}
                    </span>
                )}
            </div>
        </button>
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

export function TierCard({ plan, active, billing, onSelect }: { plan: PlanTier; active: boolean; billing: Billing; onSelect: () => void }) {
    const price = formatPrice(plan, billing)
    const showSavings = billing === 'yearly' && plan.priceMonthly > 0
    const savings = showSavings ? plan.priceMonthly * 12 - plan.priceYearly : 0
    return (
        <button
            onClick={onSelect}
            type="button"
            aria-pressed={active}
            className={[
                'relative text-left border-0 rounded-lg px-4.5 pt-5 pb-4.5 cursor-pointer flex flex-col gap-3.5 transition-all duration-150 ease-sheemu',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
                active ? 'bg-primary-soft text-on-primary-soft' : 'bg-surface-container-lowest text-on-surface tonal-layer-glow hover:bg-surface-container',
            ].join(' ')}>
            {plan.popular && (
                <span className="absolute -top-2.5 right-3.5 bg-secondary-soft text-on-secondary-soft font-label font-semibold text-[10px] leading-none tracking-[0.12em] uppercase px-2.5 py-1.5 rounded-full">
                    Best value
                </span>
            )}
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
            <div className="flex items-baseline gap-1.5">
                <span className="font-mono font-semibold text-[28px] leading-none tracking-[-0.02em]">{price.amount}</span>
                <span className="font-body font-normal text-[12px] leading-[1.3] opacity-80">{price.cadence}</span>
            </div>
            {showSavings && <Eyebrow className={active ? '' : 'text-primary'}>Save ${savings}/yr</Eyebrow>}
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
