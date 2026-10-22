'use client'

import { type ReactNode, useId } from 'react'

import { EYEBROW_CLASS } from './Brand'
import { Icon, type IconName } from './Icon'

const LABEL_CLASS = `${EYEBROW_CLASS} cursor-text`

export interface TextFieldProps {
    label?: ReactNode
    value: string
    onChange?: (v: string) => void
    type?: string
    placeholder?: string
    leftIcon?: IconName
    rightSlot?: ReactNode
    autoFocus?: boolean
    hint?: string
    /** The field's inline error line (a mismatch, a rejected value), under the input. */
    error?: ReactNode
    onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void
    inputRef?: React.Ref<HTMLInputElement>
}

/**
 * Text input on a `surface-container-low` fill with a 2px cyan bottom stroke
 * that grows from the centre on focus (CSS `peer-focus`, both edges transition).
 * `peer-focus` rather than `focus-within`, so a focused `rightSlot` button (the
 * password toggle) doesn't light the stroke.
 */
export function TextField({
    label,
    value,
    onChange,
    type = 'text',
    placeholder,
    leftIcon,
    rightSlot,
    autoFocus,
    hint,
    error,
    onKeyDown,
    inputRef,
}: TextFieldProps) {
    const id = useId()
    return (
        <div className="flex flex-col gap-1.5">
            {label && (
                <label htmlFor={id} className={LABEL_CLASS}>
                    {label}
                </label>
            )}
            <div
                className={[
                    'relative flex items-center gap-1.5 bg-surface-container-low rounded-sm',
                    leftIcon ? 'pl-9 pr-2.5' : 'px-2.5',
                ].join(' ')}>
                {leftIcon && (
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-outline inline-flex">
                        <Icon name={leftIcon} size={16} />
                    </span>
                )}
                <input
                    id={id}
                    ref={inputRef}
                    type={type}
                    value={value}
                    placeholder={placeholder}
                    autoFocus={autoFocus}
                    onChange={(e) => onChange?.(e.target.value)}
                    onKeyDown={onKeyDown}
                    className="peer flex-1 min-w-0 bg-transparent border-0 outline-0 text-on-surface font-body font-normal text-[14px] leading-none py-3 px-1"
                />
                {rightSlot}
                <div className="absolute bottom-0 left-1/2 right-1/2 peer-focus:left-0 peer-focus:right-0 h-0.5 bg-primary-container transition-[left,right] duration-300 ease-solkey" />
            </div>
            {hint && <span className="font-body font-normal text-[12px] leading-[1.4] text-on-surface-variant">{hint}</span>}
            {error && <span className="font-body font-medium text-[12px] leading-[1.4] text-error">{error}</span>}
        </div>
    )
}

// Not in the web app's barrel (it never renders one); the admin console and the eval workbench do.
interface TextAreaProps {
    label?: ReactNode
    value: string
    onChange?: (v: string) => void
    placeholder?: string
    rows?: number
}

/** Multi-line sibling of TextField, with the same `peer-focus` centre-out stroke. */
export function TextArea({ label, value, onChange, placeholder, rows = 4 }: TextAreaProps) {
    const id = useId()
    return (
        <div className="flex flex-col gap-1.5">
            {label && (
                <label htmlFor={id} className={LABEL_CLASS}>
                    {label}
                </label>
            )}
            <div className="relative bg-surface-container-low rounded-sm px-2.5">
                <textarea
                    id={id}
                    value={value}
                    placeholder={placeholder}
                    rows={rows}
                    onChange={(e) => onChange?.(e.target.value)}
                    className="peer w-full bg-transparent border-0 outline-0 resize-y text-on-surface font-body font-normal text-[14px] leading-[1.55] py-3 box-border"
                />
                <div className="absolute bottom-0 left-1/2 right-1/2 peer-focus:left-0 peer-focus:right-0 h-0.5 bg-primary-container transition-[left,right] duration-300 ease-solkey" />
            </div>
        </div>
    )
}

interface ChipProps {
    active?: boolean
    onClick?: () => void
    children: ReactNode
    ariaLabel?: string
    size?: 'sm' | 'md'
}

/**
 * Choice chip for picking options inside forms and onboarding (secondary-soft
 * when selected); for editor-chrome toggles use ChipToggle. Without `onClick` it
 * renders display-only, with no hover.
 */
export function Chip({ active, onClick, children, ariaLabel, size = 'sm' }: ChipProps) {
    const interactive = !!onClick
    const palette = active
        ? 'bg-secondary-soft text-on-secondary-soft'
        : `bg-surface-container text-on-surface ${interactive ? 'hover:bg-surface-container-high' : ''}`
    const sizing =
        size === 'md'
            ? 'px-4.5 py-2.5 font-body font-medium text-[14px] tracking-normal'
            : 'px-3.5 py-1.5 font-label font-bold text-[11px] tracking-[0.04em]'
    return (
        <button
            type="button"
            aria-label={ariaLabel}
            aria-pressed={active}
            onClick={onClick}
            disabled={!interactive}
            className={[
                'inline-flex items-center gap-1.5 whitespace-nowrap leading-none rounded-full border-0',
                'transition-colors duration-150 ease-solkey',
                'focus-ring',
                interactive ? 'cursor-pointer' : 'cursor-default',
                palette,
                sizing,
            ].join(' ')}>
            {children}
        </button>
    )
}
