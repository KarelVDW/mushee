'use client'

import { type HTMLAttributes, type InputHTMLAttributes, type ReactNode, type Ref, useCallback, useId, useRef } from 'react'

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
    /** The field's inline error line (a mismatch, a rejected value), under the input. Sets aria-invalid. */
    error?: ReactNode
    onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void
    inputRef?: Ref<HTMLInputElement>
    /** Accessible name when the field has no visible label (e.g. 'Search your scores'); never rely on the placeholder. */
    ariaLabel?: string
    /**
     * Shows a trailing 40px × button while the field has text; it empties the field and
     * focuses it. The string is its accessible name and tooltip (e.g. 'Clear search').
     */
    clearLabel?: string
    // Native pass-throughs: autofill, the phone keyboard, form semantics.
    autoComplete?: InputHTMLAttributes<HTMLInputElement>['autoComplete']
    inputMode?: HTMLAttributes<HTMLInputElement>['inputMode']
    enterKeyHint?: InputHTMLAttributes<HTMLInputElement>['enterKeyHint']
    autoCapitalize?: HTMLAttributes<HTMLInputElement>['autoCapitalize']
    name?: string
    required?: boolean
}

// 14px on a mouse, 16px on touch: iOS Safari zooms the page into any focused field under
// 16px. Never fix that by disabling pinch zoom (maximum-scale) — low-vision users need it.
// (The placeholder colour is set kit-wide in theme.css.)
const FIELD_TEXT = 'text-on-surface font-body font-normal text-[14px] pointer-coarse:text-[16px]'

// The focus stroke: 2px `primary` (the neon fill fails 3:1 on the input fill), grown from the centre.
const FOCUS_STROKE =
    'absolute bottom-0 left-1/2 right-1/2 peer-focus:left-0 peer-focus:right-0 h-0.5 bg-primary transition-[left,right] duration-300 ease-solkey motion-reduce:transition-none'

const HINT_CLASS = 'font-body font-normal text-[12px] leading-[1.4] text-on-surface-variant'
const ERROR_CLASS = 'font-body font-medium text-[12px] leading-[1.4] text-error'

/**
 * Text input on a `surface-container-low` fill with a 2px `primary` bottom stroke
 * that grows from the centre on focus (CSS `peer-focus`, both edges transition).
 * `peer-focus` rather than `focus-within`, so a focused `rightSlot` button (the
 * password toggle) doesn't light the stroke. The hint and error are wired to the
 * input through aria-describedby; an error also sets aria-invalid.
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
    ariaLabel,
    clearLabel,
    autoComplete,
    inputMode,
    enterKeyHint,
    autoCapitalize,
    name,
    required,
}: TextFieldProps) {
    const id = useId()
    const hintId = `${id}-hint`
    const errorId = `${id}-error`
    const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined
    const localRef = useRef<HTMLInputElement | null>(null)
    const setRef = useCallback(
        (el: HTMLInputElement | null) => {
            localRef.current = el
            if (typeof inputRef === 'function') inputRef(el)
            else if (inputRef) inputRef.current = el
        },
        [inputRef],
    )
    const clear = () => {
        onChange?.('')
        localRef.current?.focus()
    }
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
                    ref={setRef}
                    type={type}
                    value={value}
                    placeholder={placeholder}
                    autoFocus={autoFocus}
                    aria-label={ariaLabel}
                    aria-invalid={error ? true : undefined}
                    aria-describedby={describedBy}
                    autoComplete={autoComplete}
                    inputMode={inputMode}
                    enterKeyHint={enterKeyHint}
                    autoCapitalize={autoCapitalize}
                    name={name}
                    required={required}
                    onChange={(e) => onChange?.(e.target.value)}
                    onKeyDown={onKeyDown}
                    className={`peer flex-1 min-w-0 bg-transparent border-0 outline-0 ${FIELD_TEXT} leading-none py-3 pointer-coarse:py-3.5 px-1`}
                />
                {clearLabel && value !== '' && (
                    <button
                        type="button"
                        aria-label={clearLabel}
                        title={clearLabel}
                        onClick={clear}
                        className={[
                            // 40px hit area; the negative margins keep the field at its usual height.
                            'shrink-0 w-10 h-10 -my-1 -mr-1.5 inline-flex items-center justify-center rounded-full',
                            'bg-transparent border-0 cursor-pointer text-on-surface-variant hover:text-on-surface',
                            'transition-colors duration-150 ease-solkey focus-ring',
                        ].join(' ')}>
                        <Icon name="x" size={16} />
                    </button>
                )}
                {rightSlot}
                <div className={FOCUS_STROKE} />
            </div>
            {hint && (
                <span id={hintId} className={HINT_CLASS}>
                    {hint}
                </span>
            )}
            {error && (
                <span id={errorId} className={ERROR_CLASS}>
                    {error}
                </span>
            )}
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
    /** Accessible name when there is no visible label. */
    ariaLabel?: string
    name?: string
    required?: boolean
}

/** Multi-line sibling of TextField, with the same `peer-focus` centre-out stroke. */
export function TextArea({ label, value, onChange, placeholder, rows = 4, ariaLabel, name, required }: TextAreaProps) {
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
                    aria-label={ariaLabel}
                    name={name}
                    required={required}
                    onChange={(e) => onChange?.(e.target.value)}
                    className={`peer w-full bg-transparent border-0 outline-0 resize-y ${FIELD_TEXT} leading-[1.55] py-3 box-border`}
                />
                <div className={FOCUS_STROKE} />
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
            : 'px-3.5 py-1.5 pointer-coarse:px-4 font-label font-bold text-[11px] tracking-[0.04em]'
    return (
        <button
            type="button"
            aria-label={ariaLabel}
            aria-pressed={active}
            onClick={onClick}
            disabled={!interactive}
            className={[
                // Touch: a 40px floor (DESIGN.md §4b), grown by height so the pill keeps its type size.
                'inline-flex items-center gap-1.5 whitespace-nowrap leading-none rounded-full border-0 pointer-coarse:min-h-10',
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
