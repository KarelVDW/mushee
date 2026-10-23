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
    /**
     * `compact`: a 40px input row on fine pointers, for a field that sits in a toolbar beside
     * md buttons (the library search). Coarse pointers keep the full touch height.
     */
    size?: 'default' | 'compact'
}

// 14px on a mouse, 16px on touch: iOS Safari zooms the page into any focused field under
// 16px. Never fix that by disabling pinch zoom (maximum-scale) — low-vision users need it.
// (The placeholder colour is set kit-wide in theme.css.)
const FIELD_TEXT = 'text-on-surface font-body font-normal text-[14px] pointer-coarse:text-[16px]'

// The input fill, read from `--field-fill` (theme.css): `surface-container-low` on the page, one
// tonal step up inside a dialog's glass, which renders that same shade. The container decides,
// so no caller passes a tone. A named group, so an outer `group` never lights the stroke.
const FIELD_FRAME = 'relative group/field bg-(--field-fill) rounded-sm min-h-(--control-md)'

// The focus stroke: 2px `primary` (the neon fill fails 3:1 on the input fill), grown from the
// centre while anything inside the frame has focus. Never a resting stroke. Above the error
// stroke (later in the DOM, z-1), so focusing an invalid field still sweeps primary over red.
const FOCUS_STROKE =
    'absolute inset-x-0 bottom-0 z-1 h-0.5 bg-primary origin-center scale-x-0 group-focus-within/field:scale-x-100 transition-transform duration-(--t-flow) ease-solkey motion-reduce:transition-none'

// While the field is invalid: a full-width 2px `error` stroke at rest (5.99:1 on the fill).
const ERROR_STROKE = 'absolute inset-x-0 bottom-0 h-0.5 bg-error'

const HINT_CLASS = 'font-body font-normal text-[12px] leading-[1.4] text-on-surface-variant text-pretty'
const ERROR_CLASS = 'font-body font-medium text-[12px] leading-[1.4] text-error'

interface FieldFrameProps {
    children: ReactNode
    /** Shows the resting error stroke (the field's own aria-invalid stays the caller's job). */
    invalid?: boolean
    /** Layout for the frame's content (flex row, padding, a fixed height). */
    className?: string
}

/**
 * The filled box every text entry is built on: the container's `--field-fill`, 4px corners, at
 * least --control-md tall, and the 2px primary stroke that grows from the centre while the
 * field has focus (:focus-within, 300ms, instant under reduced motion). With `invalid` a red
 * stroke rests underneath it, and returns on blur.
 */
export function FieldFrame({ children, invalid = false, className }: FieldFrameProps) {
    return (
        <div className={className ? `${FIELD_FRAME} ${className}` : FIELD_FRAME}>
            {children}
            {invalid && <span aria-hidden="true" className={ERROR_STROKE} />}
            <span aria-hidden="true" className={FOCUS_STROKE} />
        </div>
    )
}

/**
 * Text input on a FieldFrame: a `surface-container-low` fill (`surface-container` inside a
 * dialog) with a 2px `primary` bottom stroke that grows from the centre on focus, and a red
 * one at rest while `error` is set. The hint and error are wired to the input through
 * aria-describedby; an error also sets aria-invalid.
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
    size = 'default',
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
    const compact = size === 'compact'
    return (
        <div className="flex flex-col gap-1.5">
            {label && (
                <label htmlFor={id} className={LABEL_CLASS}>
                    {label}
                </label>
            )}
            <FieldFrame
                invalid={!!error}
                className={['flex items-center gap-1.5', leftIcon ? 'pl-9 pr-2.5' : 'px-2.5', compact ? 'pointer-fine:h-10' : ''].join(
                    ' ',
                )}>
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
                    className={[
                        `flex-1 min-w-0 bg-transparent border-0 outline-0 ${FIELD_TEXT} leading-none py-3 pointer-coarse:py-3.5 px-1`,
                        compact ? 'pointer-fine:py-2.5' : '',
                    ].join(' ')}
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
            </FieldFrame>
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

/** Multi-line sibling of TextField, on the same FieldFrame and its centre-out stroke. */
export function TextArea({ label, value, onChange, placeholder, rows = 4, ariaLabel, name, required }: TextAreaProps) {
    const id = useId()
    return (
        <div className="flex flex-col gap-1.5">
            {label && (
                <label htmlFor={id} className={LABEL_CLASS}>
                    {label}
                </label>
            )}
            <FieldFrame className="px-2.5">
                <textarea
                    id={id}
                    value={value}
                    placeholder={placeholder}
                    rows={rows}
                    aria-label={ariaLabel}
                    name={name}
                    required={required}
                    onChange={(e) => onChange?.(e.target.value)}
                    className={`block w-full bg-transparent border-0 outline-0 resize-y ${FIELD_TEXT} leading-[1.55] py-3 box-border`}
                />
            </FieldFrame>
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

// The pick check (SelectedMark's and Chip's): scales in from 0.6 and fades in over 150ms; at
// once under reduced motion.
const PICK_IN = 'motion-safe:animate-[pick-in_150ms_var(--ease-solkey)]'

/**
 * Choice chip for picking options inside forms and onboarding; for editor-chrome toggles use
 * ChipToggle. At rest it sits on the control fill; picked, it takes the selected fill
 * (primary-soft) and a leading check, so the choice never rides on colour alone. Without
 * `onClick` it renders display-only, with no hover.
 */
export function Chip({ active, onClick, children, ariaLabel, size = 'sm' }: ChipProps) {
    const interactive = !!onClick
    const palette = active
        ? 'bg-(--color-selected) text-(--color-on-selected)'
        : `bg-(--control-fill) text-on-surface ${interactive ? 'hover:bg-(--control-fill-hover)' : ''}`
    const sizing =
        size === 'md'
            ? 'px-4.5 py-2.5 font-body font-medium text-[14px] tracking-normal'
            : 'px-3.5 py-1.5 pointer-coarse:px-4 font-label font-bold text-[11px] tracking-[0.04em]'
    // The leading check takes the place of part of the left padding.
    const pickedPad = active ? 'pl-3 pointer-coarse:pl-3' : ''
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
                pickedPad,
            ].join(' ')}>
            {active && (
                <span aria-hidden="true" className={`inline-flex shrink-0 ${PICK_IN}`}>
                    <Icon name="check" size={12} />
                </span>
            )}
            {children}
        </button>
    )
}

interface SelectedMarkProps {
    /** `md` (default): an 18px disc with a 12px check, for tiles, cards and rows. `sm`: 14px with a 10px check, for compact grid cells. */
    size?: 'md' | 'sm'
    /** Placement, e.g. `absolute top-2 right-2` on a tile, `ml-auto` at the end of a row. */
    className?: string
}

/**
 * The mark of a picked option: a check in a primary_container disc, paired with the selected
 * fill (`--color-selected`). Decorative (aria-hidden) — the state itself stays on the option's
 * aria-pressed / aria-checked. It scales in when it appears, at once under reduced motion.
 */
export function SelectedMark({ size = 'md', className }: SelectedMarkProps) {
    return (
        <span
            aria-hidden="true"
            className={[
                'inline-flex items-center justify-center shrink-0 rounded-full bg-primary-container text-on-primary-container',
                size === 'sm' ? 'size-3.5' : 'size-4.5',
                PICK_IN,
                className ?? '',
            ].join(' ')}>
            <Icon name="check" size={size === 'sm' ? 10 : 12} />
        </span>
    )
}
