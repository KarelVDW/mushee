import type { ReactNode } from 'react'

interface SegmentedOption<T> {
    value: T
    label: ReactNode
}

interface SegmentedProps<T> {
    options: SegmentedOption<T>[]
    value: T
    onChange: (v: T) => void
    ariaLabel: string
}

export function Segmented<T extends string | undefined>({ options, value, onChange, ariaLabel }: SegmentedProps<T>) {
    return (
        <div role="group" aria-label={ariaLabel} className="inline-flex p-0.75 rounded-full bg-surface-container-low">
            {options.map((o, i) => {
                const active = value === o.value
                return (
                    <button
                        key={i}
                        type="button"
                        aria-pressed={active}
                        onClick={() => onChange(o.value)}
                        className={[
                            'border-0 px-2.5 py-1.5 cursor-pointer rounded-full min-w-8.5',
                            'pointer-coarse:py-2.5 pointer-coarse:min-w-10',
                            'font-label font-semibold text-[14px] leading-none',
                            'inline-flex items-center justify-center',
                            'transition-[background-color,color] duration-150 ease-sheemu',
                            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
                            active ? 'bg-primary-container text-on-primary-container' : 'bg-transparent text-on-surface-variant',
                        ].join(' ')}>
                        {o.label}
                    </button>
                )
            })}
        </div>
    )
}

interface ChipToggleProps {
    active?: boolean
    onClick?: () => void
    ariaLabel?: string
    children: ReactNode
    disabled?: boolean
}

export function ChipToggle({ active, onClick, ariaLabel, children, disabled }: ChipToggleProps) {
    return (
        <button
            type="button"
            aria-label={ariaLabel}
            aria-pressed={active}
            disabled={disabled}
            onClick={onClick}
            className={[
                'border-0 rounded-full px-3.5 py-1.75 min-h-8 whitespace-nowrap',
                'pointer-coarse:min-h-10 pointer-coarse:px-4',
                'font-label font-semibold text-[13px] leading-none',
                'inline-flex items-center justify-center',
                'cursor-pointer disabled:cursor-not-allowed disabled:opacity-40',
                'transition-[background-color,color] duration-150 ease-sheemu',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
                active
                    ? 'bg-primary-container text-on-primary-container'
                    : 'bg-surface-container-low text-on-surface enabled:hover:bg-surface-container',
            ].join(' ')}>
            {children}
        </button>
    )
}

interface TransportBtnProps {
    size: number
    tone?: 'neutral' | 'play' | 'record'
    active?: boolean
    onClick?: () => void
    ariaLabel: string
    children: ReactNode
    disabled?: boolean
}

export function TransportBtn({ size, tone = 'neutral', active, onClick, ariaLabel, children, disabled }: TransportBtnProps) {
    if (tone === 'record') {
        const dotSize = Math.round(size * 0.42)
        return (
            <button
                type="button"
                aria-label={ariaLabel}
                onClick={onClick}
                disabled={disabled}
                className={[
                    'rounded-full p-0 inline-flex items-center justify-center shrink-0',
                    'cursor-pointer disabled:cursor-not-allowed disabled:opacity-40',
                    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
                    'border-[3px]',
                    active ? 'bg-error border-error' : 'bg-surface-container-lowest border-error-container',
                    'transition-[transform,background-color,border-color] duration-200 ease-sheemu',
                    'enabled:hover:scale-105',
                ].join(' ')}
                style={{ width: size, height: size }}>
                <span
                    className={[
                        'rounded-full transition-[background-color] duration-200 ease-sheemu',
                        active ? 'bg-on-error shadow-none' : 'bg-error-container shadow-[inset_0_-2px_4px_rgba(0,0,0,0.18)]',
                    ].join(' ')}
                    style={{ width: dotSize, height: dotSize }}
                />
                <span className="hidden">{children}</span>
            </button>
        )
    }
    if (tone === 'play') {
        return (
            <button
                type="button"
                aria-label={ariaLabel}
                onClick={onClick}
                disabled={disabled}
                className={[
                    'rounded-full p-0 inline-flex items-center justify-center shrink-0',
                    'cursor-pointer disabled:cursor-not-allowed disabled:opacity-40',
                    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
                    'border-[3px] border-primary-container',
                    active ? 'bg-primary-container text-on-primary-container' : 'bg-surface-container-lowest text-primary',
                    'transition-[transform,background-color,color] duration-200 ease-sheemu',
                    'enabled:hover:scale-105',
                ].join(' ')}
                style={{ width: size, height: size }}>
                {children}
            </button>
        )
    }
    return (
        <button
            type="button"
            aria-label={ariaLabel}
            onClick={onClick}
            disabled={disabled}
            className={[
                'rounded-full border-0 inline-flex items-center justify-center shrink-0',
                'cursor-pointer disabled:cursor-not-allowed disabled:opacity-40',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
                'bg-surface-container-low enabled:hover:bg-surface-container',
                active ? 'text-primary' : 'text-on-surface-variant',
                'transition-[background-color,color] duration-150 ease-sheemu',
            ].join(' ')}
            style={{ width: size, height: size }}>
            {children}
        </button>
    )
}

interface SwitchProps {
    checked: boolean
    onChange: (v: boolean) => void
    label: ReactNode
}

export function Switch({ checked, onChange, label }: SwitchProps) {
    return (
        <label className="flex justify-between items-center gap-4 cursor-pointer">
            <span className="font-body font-normal text-[14px] leading-[1.4] text-on-surface">{label}</span>
            <button
                type="button"
                role="switch"
                aria-checked={checked}
                onClick={() => onChange(!checked)}
                className={[
                    'w-10 h-5.5 rounded-full border-0 p-0.5 cursor-pointer relative',
                    'transition-colors duration-150 ease-sheemu',
                    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
                    checked ? 'bg-primary-container' : 'bg-surface-container-high',
                ].join(' ')}>
                <span
                    className="block w-4.5 h-4.5 rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,0.2)] transition-transform duration-200 ease-sheemu"
                    style={{ transform: checked ? 'translateX(18px)' : 'translateX(0)' }}
                />
            </button>
        </label>
    )
}
