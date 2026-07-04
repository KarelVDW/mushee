import { type ButtonHTMLAttributes, type ReactNode } from 'react'

import { Icon } from './Icon'

type ButtonSize = 'md' | 'lg'

interface PrimaryButtonProps {
    children?: ReactNode
    onClick?: () => void
    size?: ButtonSize
    icon?: string
    type?: 'button' | 'submit' | 'reset'
    disabled?: boolean
    emphasis?: 'flat' | 'pop'
    danger?: boolean
    fullWidth?: boolean
}

/**
 * Filled cyan/magenta button. With `emphasis="pop"`, gains the signature magenta
 * drop-shadow that grows from 3px to 5px on hover, paired with a -2px translate.
 * Hover/disabled states are pure CSS — no JS state.
 */
export function PrimaryButton({
    children,
    onClick,
    size = 'md',
    icon,
    type = 'button',
    disabled,
    emphasis = 'flat',
    danger = false,
    fullWidth = false,
}: PrimaryButtonProps) {
    const big = size === 'lg'
    // Destructive variant: red fill, no magenta pop — the signature lift is reserved
    // for actions you want the user to tap, not for ones you want them to think twice about.
    const pop = emphasis === 'pop' && !danger

    const palette = danger
        ? 'bg-error-container text-on-error-container hover:bg-error hover:text-on-error'
        : 'bg-primary-container text-on-primary-container hover:bg-primary hover:text-on-primary'

    const popStyles = pop ? 'shadow-(--shadow-offset-3) hover:shadow-(--shadow-offset-5) hover:-translate-y-[2px]' : ''

    return (
        <button
            type={type}
            disabled={disabled}
            onClick={onClick}
            className={[
                'inline-flex items-center justify-center gap-2 whitespace-nowrap shrink-0 cursor-pointer',
                'border-0 rounded-full font-label font-semibold tracking-[0.01em]',
                big ? 'px-6.5 py-3.25 text-[14px]' : 'px-4.5 py-2.25 text-[13px]',
                'leading-none',
                'transition-[transform,box-shadow,background-color,color] duration-200 ease-sheemu',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
                'disabled:opacity-40 disabled:cursor-not-allowed',
                'disabled:hover:translate-y-0 disabled:hover:shadow-(--shadow-offset-3)',
                palette,
                popStyles,
                fullWidth ? 'w-full' : '',
            ].join(' ')}>
            <span>{children}</span>
            {icon && <Icon name={icon} size={big ? 18 : 16} />}
        </button>
    )
}

export function SecondaryButton({ children, onClick, size = 'md', type = 'button', disabled, fullWidth }: PrimaryButtonProps) {
    const big = size === 'lg'
    return (
        <button
            type={type}
            disabled={disabled}
            onClick={onClick}
            className={[
                'inline-flex items-center justify-center whitespace-nowrap shrink-0 cursor-pointer',
                'border-0 rounded-full font-label font-semibold',
                'bg-surface-container-low text-on-surface hover:bg-surface-container',
                big ? 'px-6.5 py-3.25 text-[14px]' : 'px-4.5 py-2.25 text-[13px]',
                'leading-none',
                'transition-colors duration-150 ease-sheemu',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
                'disabled:opacity-40 disabled:cursor-not-allowed',
                fullWidth ? 'w-full' : '',
            ].join(' ')}>
            {children}
        </button>
    )
}

interface TertiaryButtonProps {
    children?: ReactNode
    onClick?: () => void
    danger?: boolean
    type?: 'button' | 'submit'
}

export function TertiaryButton({ children, onClick, danger = false, type = 'button' }: TertiaryButtonProps) {
    return (
        <button
            type={type}
            onClick={onClick}
            className={[
                'bg-transparent border-0 cursor-pointer whitespace-nowrap shrink-0 py-2 px-0',
                'font-body font-medium text-[13px] leading-none',
                'transition-colors duration-150 ease-sheemu',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary rounded-sm',
                danger ? 'text-secondary hover:text-secondary-container' : 'text-on-surface-variant hover:text-primary',
            ].join(' ')}>
            {children}
        </button>
    )
}

interface IconButtonProps {
    icon: string
    onClick?: () => void
    hoverTone?: 'cyan' | 'magenta'
    size?: number
    ariaLabel?: string
    /** Override the idle background — useful when a row already darkens on hover. */
    idleClassName?: string
}

export function IconButton({ icon, onClick, hoverTone = 'cyan', size = 32, ariaLabel, idleClassName }: IconButtonProps) {
    const hoverPalette =
        hoverTone === 'magenta'
            ? 'hover:bg-secondary-container hover:text-on-secondary'
            : 'hover:bg-primary-container hover:text-on-primary-container'
    return (
        <button
            type="button"
            aria-label={ariaLabel}
            onClick={onClick}
            className={[
                'inline-flex items-center justify-center cursor-pointer border-0 rounded-full',
                'text-on-surface',
                idleClassName ?? 'bg-surface-container',
                hoverPalette,
                'transition-colors duration-150 ease-sheemu',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
            ].join(' ')}
            style={{ width: size, height: size }}>
            <Icon name={icon} size={size <= 28 ? 14 : 16} />
        </button>
    )
}

interface ToggleButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    active?: boolean
    tone?: 'cyan' | 'rec'
}

export function ToggleButton({ active, tone = 'cyan', children, className, ...rest }: ToggleButtonProps) {
    const activePalette = tone === 'rec' ? 'bg-error text-on-error' : 'bg-primary-container text-on-primary-container'
    return (
        <button
            type="button"
            {...rest}
            className={[
                'inline-flex items-center gap-1.5 shrink-0 whitespace-nowrap cursor-pointer',
                'border-0 rounded-sm px-2.75 py-1.75 min-h-7.5',
                'font-label font-semibold text-[12px] leading-none',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
                active ? activePalette : 'bg-surface-container-low text-on-surface',
                className ?? '',
            ].join(' ')}>
            {children}
        </button>
    )
}
