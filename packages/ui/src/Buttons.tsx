import Link from 'next/link'
import { type AnchorHTMLAttributes, type ButtonHTMLAttributes, type ReactNode } from 'react'

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

// The capsule's height is a token (theme.css: 40px md, 48px lg; 44/52px on coarse pointers),
// never padding plus line-height, so an icon never changes it and neighbours line up.
const CAPSULE_HEIGHT: Record<ButtonSize, string> = {
    md: 'h-(--control-md) text-[13px]',
    lg: 'h-(--control-lg) text-[14px]',
}

// A label's side padding. Kept out of an icon-only capsule: Tailwind emits px-5 / px-6.5 after
// px-0, so the padding would win and widen the circle (to 52px at lg).
const CAPSULE_PADDING: Record<ButtonSize, string> = {
    md: 'px-5',
    lg: 'px-6.5',
}

// Icon-only: a true circle of the same height.
const CAPSULE_ICON_ONLY: Record<ButtonSize, string> = {
    md: 'px-0 aspect-square size-(--control-md)',
    lg: 'px-0 aspect-square size-(--control-lg)',
}

// The press every compact control shares: a 3% shrink over 100ms (reduced motion keeps only the
// tonal step). Never on a disabled control. Tailwind's scale and translate utilities set the
// individual `scale` / `translate` properties, so the transition lists them beside transform.
const PRESS_SCALE = 'motion-safe:not-disabled:not-aria-disabled:active:scale-[0.97]'
const PRESS_TRANSITION = 'transition-[transform,translate,scale,background-color,color,box-shadow] duration-(--t-press) ease-solkey'

// The disabled states below are spelled out for both the native attribute and aria-disabled,
// class by class, so Tailwind's scanner sees each one.

function primaryClasses({
    size,
    emphasis,
    danger,
    fullWidth,
    iconOnly,
}: {
    size: ButtonSize
    emphasis: 'flat' | 'pop'
    danger: boolean
    fullWidth: boolean
    iconOnly: boolean
}) {
    // Destructive variant: red fill, no magenta pop — the signature lift is reserved
    // for actions you want the user to tap, not for ones you want them to think twice about.
    const pop = emphasis === 'pop' && !danger

    // Hover deepens the neon a step instead of inverting it to dark teal, and press one step
    // further (on_primary_soft text: 5.7:1 on hover, 4.83:1 pressed). Danger steps from
    // error_container to error on hover and darkens again on press.
    const palette = danger
        ? 'bg-error-container text-on-error-container hover:bg-error hover:text-on-error active:bg-error active:text-on-error active:brightness-90 disabled:brightness-100 aria-disabled:brightness-100'
        : 'bg-primary-container text-on-primary-container hover:bg-primary-container-hover hover:text-on-primary-soft active:bg-primary-container-pressed active:text-on-primary-soft'

    // Pop: the magenta plate grows 3→5px under a -2px lift on hover; on press the capsule sinks
    // onto its plate (3px right and down, the shadow gone).
    const popStyles = pop
        ? 'shadow-(--shadow-offset-3) hover:shadow-(--shadow-offset-5) hover:-translate-y-[2px] active:translate-x-[3px] active:translate-y-[3px] active:shadow-none active:duration-100'
        : ''

    return [
        'inline-flex items-center justify-center gap-2 whitespace-nowrap shrink-0 cursor-pointer',
        'border-0 rounded-full font-label font-semibold tracking-[0.01em]',
        CAPSULE_HEIGHT[size],
        iconOnly ? CAPSULE_ICON_ONLY[size] : CAPSULE_PADDING[size],
        'leading-none',
        PRESS_TRANSITION,
        PRESS_SCALE,
        'focus-ring',
        palette,
        popStyles,
        // Disabled: a neutral capsule that holds still — no neon fade, no magenta ghost, no
        // hover. The disabled variants sort after hover and active, so they win over both.
        'disabled:bg-surface-container aria-disabled:bg-surface-container disabled:text-on-surface-variant aria-disabled:text-on-surface-variant disabled:opacity-100 aria-disabled:opacity-100 disabled:shadow-none aria-disabled:shadow-none disabled:translate-x-0 aria-disabled:translate-x-0 disabled:translate-y-0 aria-disabled:translate-y-0 disabled:cursor-not-allowed aria-disabled:cursor-not-allowed',
        fullWidth ? 'w-full' : '',
    ].join(' ')
}

/**
 * Filled cyan capsule (red with `danger`), 40px (md) or 48px (lg) tall. Hover deepens the
 * fill a step, press another step with a 3% shrink. With `emphasis="pop"` it gains the
 * magenta offset shadow that grows from 3px to 5px on hover, paired with a -2px lift, and
 * sinks onto that plate when pressed. Disabled, it is a still, neutral capsule. Without
 * children it renders as an icon-only circle (pass `ariaLabel`). Pure CSS — no JS state.
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
    const className = primaryClasses({ size, emphasis, danger, fullWidth, iconOnly: children == null && icon != null })
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

type SecondaryTone = 'tonal' | 'raised'

type SecondaryButtonProps = {
    children?: ReactNode
    onClick?: () => void
    fullWidth?: boolean
    /** md (40px, the default) or lg (48px) — the same heights as PrimaryButton. */
    size?: ButtonSize
    /**
     * `tonal` (default): the quiet control fill (--control-fill), for the page and white cards.
     * `raised`: a white capsule with the raised shadow, for tinted surfaces where a grey fill
     * would sink (the pricing cards, grey panels).
     */
    tone?: SecondaryTone
} & ButtonOrLink<{ disabled?: boolean }>

const SECONDARY_TONES: Record<SecondaryTone, string> = {
    tonal: 'bg-(--control-fill) hover:bg-(--control-fill-hover) active:bg-(--control-fill-press) disabled:bg-(--control-fill) aria-disabled:bg-(--control-fill)',
    raised: 'bg-surface-container-lowest tonal-layer-glow hover:bg-surface-container-low active:bg-surface-container disabled:bg-surface-container-lowest aria-disabled:bg-surface-container-lowest',
}

function secondaryClasses({ fullWidth, size, tone }: { fullWidth: boolean; size: ButtonSize; tone: SecondaryTone }) {
    return [
        'inline-flex items-center justify-center whitespace-nowrap shrink-0 cursor-pointer',
        'border-0 rounded-full font-label font-semibold',
        'text-on-surface',
        SECONDARY_TONES[tone],
        CAPSULE_HEIGHT[size],
        CAPSULE_PADDING[size],
        'leading-none',
        PRESS_TRANSITION,
        PRESS_SCALE,
        'focus-ring',
        // Disabled: its own fill, the label muted, no hover — never faded to 40%.
        'disabled:opacity-100 aria-disabled:opacity-100 disabled:text-on-surface-variant aria-disabled:text-on-surface-variant disabled:cursor-not-allowed aria-disabled:cursor-not-allowed',
        fullWidth ? 'w-full' : '',
    ].join(' ')
}

export function SecondaryButton({
    children,
    onClick,
    href,
    disabled,
    fullWidth = false,
    size = 'md',
    tone = 'tonal',
}: SecondaryButtonProps) {
    const className = secondaryClasses({ fullWidth, size, tone })
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
        // inline-flex so the <Link> form's padding takes up space too, and so the height floor
        // (--control-sm: 32px, 40px on coarse pointers, DESIGN.md §4b) centres the label.
        'inline-flex items-center justify-center bg-transparent border-0 cursor-pointer whitespace-nowrap shrink-0 py-2 px-0',
        'min-h-(--control-sm) pointer-coarse:min-w-10',
        // A button's voice (Space Grotesk 600) in on_surface, never caption-grey body text.
        'font-label font-semibold text-[13px] leading-none',
        'transition-colors duration-150 ease-solkey',
        'focus-ring rounded-sm',
        // Disabled: dimmed, and the hover colour holds still.
        'disabled:opacity-40 disabled:cursor-not-allowed',
        danger
            ? 'text-secondary hover:text-secondary-container disabled:hover:text-secondary'
            : 'text-on-surface hover:text-primary disabled:hover:text-on-surface',
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
    /** Pixel size of the circle; unset, it follows --control-sm (32px, 40px on coarse pointers). */
    size?: number
    ariaLabel?: string
    /** Native tooltip — e.g. why the button is disabled. */
    title?: string
    disabled?: boolean
    /** Override the idle background — useful when a row already darkens on hover. */
    idleClassName?: string
}

// Hover, then press. The neutral tone steps through the control fills; the cyan and magenta
// hovers press one step deeper in their own hue, so a mouse press never flashes back to grey.
const ICON_BUTTON_HOVER: Record<NonNullable<IconButtonProps['hoverTone']>, string> = {
    cyan: 'hover:bg-primary-container hover:text-on-primary-container active:bg-primary-container-pressed active:text-on-primary-soft',
    magenta: 'hover:bg-secondary-container hover:text-on-secondary active:bg-secondary active:text-on-secondary',
    neutral: 'hover:bg-(--control-fill-hover) active:bg-(--control-fill-press)',
}

export function IconButton({ icon, onClick, hoverTone = 'cyan', size, ariaLabel, title, disabled, idleClassName }: IconButtonProps) {
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
                size == null ? 'size-(--control-sm)' : '',
                idleClassName ?? 'bg-(--control-fill)',
                ICON_BUTTON_HOVER[hoverTone],
                'transition-[transform,translate,scale,background-color,color,opacity] duration-(--t-press) ease-solkey',
                PRESS_SCALE,
                'focus-ring',
                'disabled:opacity-40 disabled:cursor-not-allowed',
            ].join(' ')}
            style={size == null ? undefined : { width: size, height: size }}>
            <Icon name={icon} size={size != null && size <= 28 ? 14 : 16} />
        </button>
    )
}

/**
 * The in-sentence link: primary text over a quiet 35% underline that firms up on hover, 3px
 * below the baseline. It inherits the surrounding font size; the shared focus ring applies.
 */
export const TEXT_LINK_CLASS =
    'text-primary font-medium underline decoration-1 decoration-primary/35 underline-offset-[3px] hover:decoration-primary transition-colors duration-150 ease-solkey rounded-sm focus-ring'

type TextLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & {
    href: string
    children: ReactNode
    /** `'a'` (default) renders a plain anchor (mailto:, other sites); `Link` renders next/link for in-app routes. */
    as?: 'a' | typeof Link
}

/** An inline link in running text, styled by {@link TEXT_LINK_CLASS}. */
export function TextLink({ as = 'a', href, children, className, ...rest }: TextLinkProps) {
    const classes = className ? `${TEXT_LINK_CLASS} ${className}` : TEXT_LINK_CLASS
    if (as === Link) {
        return (
            <Link href={href} className={classes} {...rest}>
                {children}
            </Link>
        )
    }
    return (
        <a href={href} className={classes} {...rest}>
            {children}
        </a>
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
