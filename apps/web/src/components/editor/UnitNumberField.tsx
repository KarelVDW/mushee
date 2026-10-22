'use client'

import type { ReactNode, RefObject } from 'react'

/**
 * Per-size spacing and type: `md` is the tempo popover's bpm field, `sm` the transpose
 * popover's ± stepper.
 */
const FIELD_SIZES = {
    md: { wrapper: 'gap-2', input: 'py-3 text-[16px]', unit: 'text-[11px]' },
    sm: { wrapper: '', input: 'w-8 py-2.5 text-[15px]', unit: 'text-[10px]' },
} as const

interface UnitNumberFieldProps {
    /** The raw field text — callers keep their own draft, so partial input can sit unparsed. */
    value: string
    onChange: (raw: string) => void
    onBlur?: () => void
    ariaLabel: string
    /** Unit label at the field's end, e.g. "bpm". */
    unit: string
    /** Decoration before the input (the tempo mark's note and "="); hidden from assistive tech. */
    leading?: ReactNode
    inputRef?: RefObject<HTMLInputElement | null>
    min: number
    max: number
    size: keyof typeof FIELD_SIZES
    /** Width classes for the field (e.g. `flex-1`, `w-24`). */
    className?: string
}

/**
 * The editor popovers' numeric input: a filled field with an uppercase unit label and the
 * primary bottom stroke (DESIGN.md inputs), spin buttons hidden. Presentational only.
 */
export function UnitNumberField({
    value,
    onChange,
    onBlur,
    ariaLabel,
    unit,
    leading,
    inputRef,
    min,
    max,
    size,
    className,
}: UnitNumberFieldProps) {
    const sizes = FIELD_SIZES[size]
    return (
        <div className={`relative flex items-center px-3 rounded-sm bg-surface-container-low ${sizes.wrapper} ${className ?? ''}`}>
            {leading && (
                <span className="flex items-center gap-1.5 text-on-surface" aria-hidden>
                    {leading}
                </span>
            )}
            <input
                ref={inputRef}
                type="number"
                min={min}
                max={max}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                onBlur={onBlur}
                aria-label={ariaLabel}
                className={`flex-1 min-w-0 ${sizes.input} bg-transparent border-0 outline-0 font-body font-medium leading-none text-on-surface [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none`}
            />
            <span className={`font-label font-medium ${sizes.unit} leading-none uppercase tracking-[0.12em] text-on-surface-variant`}>
                {unit}
            </span>
            <div className="absolute left-0 right-0 bottom-0 h-0.5 bg-primary-container" />
        </div>
    )
}
