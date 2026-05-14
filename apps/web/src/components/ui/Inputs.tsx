'use client'

import { type ReactNode, useState } from 'react'

import { Eyebrow } from './Brand'
import { Icon } from './Icon'

interface TextFieldProps {
    label?: ReactNode
    value: string
    onChange?: (v: string) => void
    type?: string
    placeholder?: string
    leftIcon?: string
    rightSlot?: ReactNode
    autoFocus?: boolean
    hint?: string
    onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void
    inputRef?: React.Ref<HTMLInputElement>
}

/**
 * Text input on a `surface-container-low` fill with a 2px cyan bottom stroke
 * that animates in from the centre on focus. Focused state is JS-driven (rather
 * than CSS `:focus-within`) because the stroke needs to slide both `left` and
 * `right` from 50% → 0/100% simultaneously, which can't be expressed with a
 * single pseudo-element transition.
 */
export function TextField({
    label, value, onChange, type = 'text', placeholder, leftIcon, rightSlot, autoFocus, hint, onKeyDown, inputRef,
}: TextFieldProps) {
    const [focused, setFocused] = useState(false)
    return (
        <div className="flex flex-col gap-1.5">
            {label && <Eyebrow>{label}</Eyebrow>}
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
                    ref={inputRef}
                    type={type}
                    value={value}
                    placeholder={placeholder}
                    autoFocus={autoFocus}
                    onChange={(e) => onChange?.(e.target.value)}
                    onFocus={() => setFocused(true)}
                    onBlur={() => setFocused(false)}
                    onKeyDown={onKeyDown}
                    className="flex-1 min-w-0 bg-transparent border-0 outline-0 text-on-surface font-body font-normal text-[14px] leading-none py-3 px-1"
                />
                {rightSlot}
                <div
                    className="absolute bottom-0 h-0.5 bg-primary-container transition-[left,right] duration-300 ease-sheemu"
                    style={focused ? { left: 0, right: 0 } : { left: '50%', right: '50%' }}
                />
            </div>
            {hint && <span className="font-body font-normal text-[12px] leading-[1.4] text-on-surface-variant">{hint}</span>}
        </div>
    )
}

interface TextAreaProps {
    label?: ReactNode
    value: string
    onChange?: (v: string) => void
    placeholder?: string
    rows?: number
}

export function TextArea({ label, value, onChange, placeholder, rows = 4 }: TextAreaProps) {
    const [focused, setFocused] = useState(false)
    return (
        <div className="flex flex-col gap-1.5">
            {label && <Eyebrow>{label}</Eyebrow>}
            <div className="relative bg-surface-container-low rounded-sm px-2.5">
                <textarea
                    value={value}
                    placeholder={placeholder}
                    rows={rows}
                    onChange={(e) => onChange?.(e.target.value)}
                    onFocus={() => setFocused(true)}
                    onBlur={() => setFocused(false)}
                    className="w-full bg-transparent border-0 outline-0 resize-y text-on-surface font-body font-normal text-[14px] leading-[1.55] py-3 box-border"
                />
                <div
                    className="absolute bottom-0 h-0.5 bg-primary-container transition-[left,right] duration-300 ease-sheemu"
                    style={focused ? { left: 0, right: 0 } : { left: '50%', right: '50%' }}
                />
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

/** Selectable identity chip. Hover only fires when interactive (has `onClick`). */
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
                'transition-colors duration-150 ease-sheemu',
                interactive ? 'cursor-pointer' : 'cursor-default',
                palette,
                sizing,
            ].join(' ')}>
            {children}
        </button>
    )
}
