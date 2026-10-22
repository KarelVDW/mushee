import Link from 'next/link'
import { type ButtonHTMLAttributes, type ReactNode } from 'react'

import { Icon, type IconName } from './Icon'

type ButtonSize = 'md' | 'lg'

/**
 * `href` renders the button as a next/link `<Link>` with the same look — real
 * navigation (middle-click, prefetch) instead of a button that pushes a route.
 * `onClick` still fires on the link (e.g. for tracking). A link can't be typed
 * or disabled, so those props are button-only.
 */
type ButtonOrLink<ButtonOnly> = ({ href?: undefined } & ButtonOnly) | ({ href: string } & { [K in keyof ButtonOnly]?: never })

type PrimaryButtonProps = {
    children?: ReactNode
    onClick?: () => void
    size?: ButtonSize
    icon?: IconName
    emphasis?: 'flat' | 'pop'
    danger?: boolean
    fullWidth?: boolean
    /** Accessible name — required when rendering icon-only (no children). */
    ariaLabel?: string
} & ButtonOrLink<{ type?: 'button' | 'submit' | 'reset'; disabled?: boolean }>

function primaryClasses({
    size,
    emphasis,
    danger,
    fullWidth,
}: {
    size: ButtonSize
    emphasis: 'flat' | 'pop'
    danger: boolean
    fullWidth: boolean
}) {
    // Destructive variant: red fill, no magenta pop — the signature lift is reserved
    // for actions you want the user to tap, not for ones you want them to think twice about.
    const pop = emphasis === 'pop' && !danger

    const palette = danger
        ? 'bg-error-container text-on-error-container hover:bg-error hover:text-on-error'
        : 'bg-primary-container text-on-primary-container hover:bg-primary hover:text-on-primary'

    // The disabled freeze lives here too: outside `pop` it would paint the magenta
    // shadow onto disabled flat/danger buttons on hover.
    const popStyles = pop
        ? 'shadow-(--shadow-offset-3) hover:shadow-(--shadow-offset-5) hover:-translate-y-[2px] disabled:hover:translate-y-0 disabled:hover:shadow-(--shadow-offset-3)'
        : ''

    return [
        'inline-flex items-center justify-center gap-2 whitespace-nowrap shrink-0 cursor-pointer',
        'border-0 rounded-full font-label font-semibold tracking-[0.01em]',
        // Touch: md grows by padding to 41px (44px with its icon) — the 40px floor, same type size.
        size === 'lg' ? 'px-6.5 py-3.25 text-[14px]' : 'px-4.5 py-2.25 text-[13px] pointer-coarse:py-3.5',
        'leading-none',
        'transition-[transform,box-shadow,background-color,color] duration-200 ease-solkey',
        'focus-ring',
        'disabled:opacity-40 disabled:cursor-not-allowed',
        palette,
        popStyles,
        fullWidth ? 'w-full' : '',
    ].join(' ')
}

/**
 * Filled cyan capsule (red with `danger`). With `emphasis="pop"` it gains the
 * magenta offset shadow that grows from 3px to 5px on hover, paired with a -2px
 * lift; disabled, it holds still at 3px. Hover/disabled states are pure CSS — no
 * JS state.
 */
export function PrimaryButton({
    children,
    onClick,
    size = 'md',
    icon,
    href,
    type = 'button',
    disabled,
    emphasis = 'flat',
    danger = false,
    fullWidth = false,
    ariaLabel,
}: PrimaryButtonProps) {
    const className = primaryClasses({ size, emphasis, danger, fullWidth })
    const content = (
        <>
            {children != null && <span>{children}</span>}
            {icon && <Icon name={icon} size={size === 'lg' ? 18 : 16} />}
        </>
    )
    if (href != null) {
        return (
            <Link href={href} onClick={onClick} aria-label={ariaLabel} className={className}>
                {content}
            </Link>
        )
    }
    return (
        <button type={type} disabled={disabled} onClick={onClick} aria-label={ariaLabel} className={className}>
            {content}
        </button>
    )
}

type SecondaryButtonProps = {
    children?: ReactNode
    onClick?: () => void
    fullWidth?: boolean
} & ButtonOrLink<{ disabled?: boolean }>

function secondaryClasses({ fullWidth }: { fullWidth: boolean }) {
    return [
        'inline-flex items-center justify-center whitespace-nowrap shrink-0 cursor-pointer',
        'border-0 rounded-full font-label font-semibold',
        'bg-surface-container-low text-on-surface hover:bg-surface-container',
        'px-4.5 py-2.25 text-[13px] pointer-coarse:py-3.5',
        'leading-none',
        'transition-colors duration-150 ease-solkey',
        'focus-ring',
        'disabled:opacity-40 disabled:cursor-not-allowed',
        fullWidth ? 'w-full' : '',
    ].join(' ')
}

export function SecondaryButton({ children, onClick, href, disabled, fullWidth = false }: SecondaryButtonProps) {
    const className = secondaryClasses({ fullWidth })
    if (href != null) {
        return (
            <Link href={href} onClick={onClick} className={className}>
                {children}
            </Link>
        )
    }
    return (
        <button type="button" disabled={disabled} onClick={onClick} className={className}>
            {children}
        </button>
    )
}

type TertiaryButtonProps = {
    children?: ReactNode
    onClick?: () => void
    danger?: boolean
    // `href` renders a next/link `<Link>` with the same look; `disabled` is button-only (see ButtonOrLink).
} & ButtonOrLink<{ disabled?: boolean }>

function tertiaryClasses({ danger }: { danger: boolean }) {
    return [
        // inline-flex so the <Link> form's padding takes up space too, and so the touch floor
        // (40×40 on coarse pointers, DESIGN.md §4b) centres the label; desktop keeps py-2.
        'inline-flex items-center justify-center bg-transparent border-0 cursor-pointer whitespace-nowrap shrink-0 py-2 px-0',
        'pointer-coarse:min-h-10 pointer-coarse:min-w-10',
        'font-body font-medium text-[13px] leading-none',
        'transition-colors duration-150 ease-solkey',
        'focus-ring rounded-sm',
        // Disabled: dimmed like the capsule buttons, and the hover colour holds still.
        'disabled:opacity-40 disabled:cursor-not-allowed',
        danger
            ? 'text-secondary hover:text-secondary-container disabled:hover:text-secondary'
            : 'text-on-surface-variant hover:text-primary disabled:hover:text-on-surface-variant',
    ].join(' ')
}

export function TertiaryButton({ children, onClick, danger = false, href, disabled }: TertiaryButtonProps) {
    const className = tertiaryClasses({ danger })
    if (href != null) {
        return (
            <Link href={href} onClick={onClick} className={className}>
                {children}
            </Link>
        )
    }
    return (
        <button type="button" disabled={disabled} onClick={onClick} className={className}>
            {children}
        </button>
    )
}

interface IconButtonProps {
    icon: IconName
    onClick?: () => void
    /** Hover fill: cyan (default), magenta for destructive actions, neutral for a quiet tonal step. */
    hoverTone?: 'cyan' | 'magenta' | 'neutral'
    size?: number
    ariaLabel?: string
    /** Native tooltip — e.g. why the button is disabled. */
    title?: string
    disabled?: boolean
    /** Override the idle background — useful when a row already darkens on hover. */
    idleClassName?: string
}

const ICON_BUTTON_HOVER: Record<NonNullable<IconButtonProps['hoverTone']>, string> = {
    cyan: 'hover:bg-primary-container hover:text-on-primary-container',
    magenta: 'hover:bg-secondary-container hover:text-on-secondary',
    neutral: 'hover:bg-surface-container-high',
}

export function IconButton({ icon, onClick, hoverTone = 'cyan', size = 32, ariaLabel, title, disabled, idleClassName }: IconButtonProps) {
    return (
        <button
            type="button"
            aria-label={ariaLabel}
            title={title}
            disabled={disabled}
            onClick={onClick}
            className={[
                // shrink-0: the box is a fixed circle — in a crowded flex row it must not squash.
                'inline-flex items-center justify-center shrink-0 cursor-pointer border-0 rounded-full',
                // Touch: a 40px floor on the circle itself (min-* wins over the inline size), so
                // neighbouring buttons' hit areas never overlap the way an invisible halo would.
                'pointer-coarse:min-h-10 pointer-coarse:min-w-10',
                'text-on-surface',
                idleClassName ?? 'bg-surface-container',
                ICON_BUTTON_HOVER[hoverTone],
                'transition-colors duration-150 ease-solkey',
                'focus-ring',
                'disabled:opacity-40 disabled:cursor-not-allowed',
            ].join(' ')}
            style={{ width: size, height: size }}>
            <Icon name={icon} size={size <= 28 ? 14 : 16} />
        </button>
    )
}

interface CloseButtonProps {
    onClick: () => void
    ariaLabel?: string
    /** `sm` (14px glyph) for toasts and banners, `md` (20px) for dialog headers. */
    size?: 'sm' | 'md'
}

/**
 * The bare × that dismisses a toast, banner or dialog. Plain CSS only — no
 * opacity-modified colours, transforms or shadows — because the web app's
 * BrowserSupportBanner renders it on the browsers below the CSS floor.
 */
export function CloseButton({ onClick, ariaLabel = 'Close', size = 'sm' }: CloseButtonProps) {
    return (
        <button
            type="button"
            aria-label={ariaLabel}
            onClick={onClick}
            className={[
                'bg-transparent border-0 cursor-pointer inline-flex items-center justify-center shrink-0 rounded-full',
                size === 'md' ? 'p-1' : 'p-1.5',
                // Touch: a 40×40 hit area (DESIGN.md §4b floor).
                'pointer-coarse:min-h-10 pointer-coarse:min-w-10',
                'text-on-surface-variant hover:text-on-surface transition-colors duration-150 ease-solkey',
                'focus-ring',
            ].join(' ')}>
            <Icon name="x" size={size === 'md' ? 20 : 14} />
        </button>
    )
}

// Not in the web app's barrel (it never renders one); the eval workbench does.
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
                'border-0 rounded-sm px-2.75 py-1.75 min-h-7.5 pointer-coarse:min-h-10',
                'font-label font-semibold text-[12px] leading-none',
                'focus-ring',
                active ? activePalette : 'bg-surface-container-low text-on-surface',
                className ?? '',
            ].join(' ')}>
            {children}
        </button>
    )
}
