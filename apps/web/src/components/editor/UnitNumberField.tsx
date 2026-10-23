'use client'

import { FieldFrame } from '@mushee/ui'
import { type ReactNode, type RefObject, useId } from 'react'

/**
 * Per-size spacing and type: `md` is the tempo popover's bpm field, `sm` the transpose
 * popover's ± stepper. The frame sets the height (--control-md, a button beside it the same);
 * the unit label never goes under the 11px floor.
 */
const FIELD_SIZES = {
    md: { wrapper: 'gap-2', input: 'self-stretch text-[16px]', unit: 'text-[13px]' },
    sm: { wrapper: 'gap-1.5', input: 'w-8 self-stretch text-[15px]', unit: 'text-[11px]' },
} as const

interface UnitNumberFieldProps {
    /** The raw field text — callers keep their own draft, so partial input can sit unparsed. */
    value: string
    onChange: (raw: string) => void
    onBlur?: () => void
    ariaLabel: string
    /** Unit label at the field's end, lowercase as written: "bpm". */
    unit: string
    /** The unit spelled out for screen readers ("beats per minute"), read as the field's description. */
    unitDescription?: string
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
 * The editor popovers' numeric input, on the shared field frame (DESIGN.md inputs): the field
 * fill with its unit label, no stroke at rest, and the primary stroke growing from the centre
 * while it has focus. The number is set in the mono face, as every figure the editor reads out;
 * spin buttons hidden. A field that can't go negative asks phones for the number pad.
 * Presentational only.
 */
export function UnitNumberField({
    value,
    onChange,
    onBlur,
    ariaLabel,
    unit,
    unitDescription,
    leading,
    inputRef,
    min,
    max,
    size,
    className,
}: UnitNumberFieldProps) {
    const sizes = FIELD_SIZES[size]
    const descriptionId = useId()
    return (
        <FieldFrame className={`flex items-center px-3 ${sizes.wrapper} ${className ?? ''}`}>
            {leading && (
                <span className="flex items-center gap-1.5 text-on-surface" aria-hidden>
                    {leading}
                </span>
            )}
            <input
                ref={inputRef}
                type="number"
                // The number pad has no minus key: only a field that stays at or above zero asks for it.
                inputMode={min >= 0 ? 'numeric' : undefined}
                min={min}
                max={max}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                onBlur={onBlur}
                aria-label={ariaLabel}
                aria-describedby={unitDescription ? descriptionId : undefined}
                className={`flex-1 min-w-0 ${sizes.input} bg-transparent border-0 outline-0 font-mono font-medium leading-none text-on-surface [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none`}
            />
            <span
                aria-hidden={unitDescription ? true : undefined}
                className={`font-label font-medium ${sizes.unit} leading-none text-on-surface-variant`}>
                {unit}
            </span>
            {unitDescription && (
                <span id={descriptionId} hidden>
                    {unitDescription}
                </span>
            )}
        </FieldFrame>
    )
}
