import type { CSSProperties, ReactNode } from 'react'

import { Tooltip, type TooltipShortcut } from './Tooltip'

/**
 * The tooltip a control wears (contract C2): its name, an optional plain hint and its live
 * shortcut. Leave them all out and the control renders bare, with no wrapper.
 */
interface TooltipProps {
    /** The tooltip's name line; defaults to the control's `ariaLabel` once a hint or shortcut is given. */
    tooltip?: string
    /** One plain line after the name ("Rest — turn this note into silence"). */
    hint?: string
    /** The live binding (fill it from the editor's Keybindings, so a rebound key shows); omit when unbound. */
    shortcut?: TooltipShortcut
    /** `top` for the dock (the default), `bottom` for header chrome. */
    tooltipSide?: 'top' | 'bottom'
}

/**
 * A disabled control that can say why. With `disabledReason` set, a `disabled` control stays
 * focusable (aria-disabled instead of the native attribute, its click ignored) so hover and
 * keyboard focus still reach the tooltip, which shows the reason.
 */
interface DisableableProps {
    disabled?: boolean
    disabledReason?: string
}

/** How a control renders disabled: natively, or focusable with aria-disabled when it explains itself. */
function disabledState({ disabled, disabledReason }: DisableableProps) {
    const off = !!disabled
    const explains = off && !!disabledReason
    return {
        off,
        native: off && !explains ? true : undefined,
        aria: explains ? (true as const) : undefined,
        reason: explains ? disabledReason : undefined,
    }
}

/** The Tooltip props for a control: none at all (a bare control) unless a name, hint, key or reason is given. */
function tooltipFor({ tooltip, hint, shortcut, tooltipSide }: TooltipProps, ariaLabel: string | undefined, reason: string | undefined) {
    const wanted = tooltip !== undefined || hint !== undefined || !!shortcut || !!reason
    return { label: wanted ? (tooltip ?? ariaLabel) : undefined, hint, shortcut, reason, side: tooltipSide ?? 'top' }
}

interface ToolGroupProps {
    ariaLabel: string
    children: ReactNode
}

/**
 * A white capsule well that makes a cluster of tool controls read as one group —
 * the no-line rule's tonal shift (`surface_container_lowest` + tonal glow, the card
 * lift) instead of borders or dividers. Controls inside it render `plain`
 * (transparent at rest); the well is what separates them from the chrome behind.
 */
export function ToolGroup({ ariaLabel, children }: ToolGroupProps) {
    return (
        <div
            role="group"
            aria-label={ariaLabel}
            className="inline-flex items-center gap-0.5 p-0.75 rounded-full bg-surface-container-lowest tonal-layer-glow">
            {children}
        </div>
    )
}

interface SegmentedOption<T> {
    value: T
    label: ReactNode
    /** The option's accessible name, for a glyph-only label ('Quarter note', 'Flat'). */
    ariaLabel?: string
    /** Tooltip name line; defaults to `ariaLabel` once a hint or shortcut is given. */
    tooltip?: string
    hint?: string
    shortcut?: TooltipShortcut
}

interface SegmentedProps<T> extends DisableableProps {
    options: SegmentedOption<T>[]
    /** The pressed option; `null` presses none (a mixed selection — distinct from an option whose value is `undefined`). */
    value: T | null
    onChange: (v: T) => void
    ariaLabel: string
    /** Which side of the options their tooltips sit on. */
    tooltipSide?: 'top' | 'bottom'
}

export function Segmented<T extends string | undefined>({
    options,
    value,
    onChange,
    ariaLabel,
    disabled,
    disabledReason,
    tooltipSide,
}: SegmentedProps<T>) {
    const state = disabledState({ disabled, disabledReason })
    return (
        <div
            role="group"
            aria-label={ariaLabel}
            className="inline-flex gap-0.5 p-0.75 rounded-full bg-surface-container-lowest tonal-layer-glow">
            {options.map((o, i) => {
                const active = value !== null && value === o.value
                return (
                    <Tooltip key={i} {...tooltipFor({ ...o, tooltipSide }, o.ariaLabel, state.reason)}>
                        <button
                            type="button"
                            aria-label={o.ariaLabel}
                            aria-pressed={active}
                            aria-disabled={state.aria}
                            disabled={state.native}
                            onClick={state.off ? undefined : () => onChange(o.value)}
                            className={[
                                'border-0 px-2.5 py-1.5 rounded-full min-w-8.5',
                                'pointer-coarse:py-2.5 pointer-coarse:min-w-10',
                                'font-label font-semibold text-[14px] leading-none',
                                'inline-flex items-center justify-center',
                                'transition-[background-color,color] duration-150 ease-solkey',
                                'focus-ring',
                                state.off ? 'cursor-not-allowed opacity-40' : 'cursor-pointer',
                                active
                                    ? 'bg-primary-container text-on-primary-container'
                                    : state.off
                                      ? 'bg-transparent text-on-surface-variant'
                                      : 'bg-transparent text-on-surface-variant hover:bg-surface-container-high',
                            ].join(' ')}>
                            {o.label}
                        </button>
                    </Tooltip>
                )
            })}
        </div>
    )
}

interface ChipToggleProps extends TooltipProps, DisableableProps {
    active?: boolean
    onClick?: () => void
    ariaLabel?: string
    children: ReactNode
    /** Transparent at rest — for chips inside a ToolGroup well, which provides the raised surface. */
    plain?: boolean
    /**
     * The chip opens a popover or menu rather than toggling a state: it exposes
     * aria-haspopup="dialog" and aria-expanded (from `active`) instead of aria-pressed.
     */
    popup?: boolean
}

/**
 * Pressed-state toggle for editor chrome and header menus (primary-container when
 * active); for form option choice use Chip. With `popup` it is a menu trigger instead.
 */
export function ChipToggle({ active, onClick, ariaLabel, children, disabled, disabledReason, plain, popup, ...tip }: ChipToggleProps) {
    const state = disabledState({ disabled, disabledReason })
    const rest = plain ? 'bg-transparent text-on-surface' : 'bg-surface-container-lowest tonal-layer-glow text-on-surface'
    return (
        <Tooltip {...tooltipFor(tip, ariaLabel, state.reason)}>
            <button
                type="button"
                aria-label={ariaLabel}
                aria-pressed={popup ? undefined : active}
                aria-haspopup={popup ? 'dialog' : undefined}
                aria-expanded={popup ? !!active : undefined}
                aria-disabled={state.aria}
                disabled={state.native}
                onClick={state.off ? undefined : onClick}
                className={[
                    'border-0 rounded-full px-3.5 py-1.75 min-h-8 whitespace-nowrap',
                    'pointer-coarse:min-h-10 pointer-coarse:px-4',
                    'font-label font-semibold text-[13px] leading-none',
                    'inline-flex items-center justify-center',
                    state.off ? 'cursor-not-allowed opacity-40' : 'cursor-pointer',
                    'transition-[background-color,color] duration-150 ease-solkey',
                    'focus-ring',
                    active
                        ? 'bg-primary-container text-on-primary-container'
                        : state.off
                          ? rest
                          : `${rest} hover:bg-surface-container-high`,
                ].join(' ')}>
                {children}
            </button>
        </Tooltip>
    )
}

type TransportTone = 'neutral' | 'play' | 'record'

/**
 * Each tone's border (and padding), transition list and timing, hover effect and
 * active/idle palette. Neutral stays borderless with a quick colour-only fade;
 * play and record carry the 3px ring and grow slightly on hover (not under reduced motion).
 */
const TONE_CLASSES: Record<TransportTone, { look: string; hover: string; active: string; idle: string }> = {
    neutral: {
        look: 'border-0 transition-[background-color,color] duration-150 ease-solkey',
        hover: 'hover:bg-surface-container-high',
        active: 'bg-surface-container-lowest text-primary',
        idle: 'bg-surface-container-lowest text-on-surface-variant',
    },
    play: {
        look: 'p-0 border-[3px] border-primary-container transition-[transform,background-color,color] duration-200 ease-solkey',
        hover: 'motion-safe:hover:scale-105',
        active: 'bg-primary-container text-on-primary-container',
        idle: 'bg-surface-container-lowest text-primary',
    },
    record: {
        look: 'p-0 border-[3px] transition-[transform,background-color,border-color] duration-200 ease-solkey',
        hover: 'motion-safe:hover:scale-105',
        active: 'bg-error border-error',
        idle: 'bg-surface-container-lowest border-error-container',
    },
}

/** A toggle's on state (the metronome): the ChipToggle's primary-container fill. */
const PRESSED_CLASS = 'bg-primary-container text-on-primary-container'

/** Coarse pointers never get a transport circle smaller than this (the 40px touch floor). */
const COARSE_FLOOR_PX = 40

interface TransportBtnProps extends TooltipProps, DisableableProps {
    /** Diameter in px on fine pointers. */
    size: number
    /** Diameter in px on coarse pointers; defaults to `size`, and never goes under the 40px floor. */
    coarseSize?: number
    tone?: TransportTone
    /** Playing / recording: the tone's live palette. */
    active?: boolean
    /** A toggle's on state (the metronome): sets aria-pressed and the primary-container fill. Leave it out on non-toggles. */
    pressed?: boolean
    onClick?: () => void
    ariaLabel: string
    /** The glyph; `record` draws its own dot instead. */
    children?: ReactNode
}

/** A round transport control (stop, play, record, metronome, and the phone dock's nudges). */
export function TransportBtn({
    size,
    coarseSize,
    tone = 'neutral',
    active,
    pressed,
    onClick,
    ariaLabel,
    children,
    disabled,
    disabledReason,
    ...tip
}: TransportBtnProps) {
    const classes = TONE_CLASSES[tone]
    const state = disabledState({ disabled, disabledReason })
    // Runtime sizes, so they ride in as CSS variables; the classes pick fine vs coarse.
    const sizes = {
        '--transport-size': `${size}px`,
        '--transport-size-coarse': `${Math.max(coarseSize ?? size, COARSE_FLOOR_PX)}px`,
    } as CSSProperties
    return (
        <Tooltip {...tooltipFor(tip, ariaLabel, state.reason)}>
            <button
                type="button"
                aria-label={ariaLabel}
                aria-pressed={pressed}
                aria-disabled={state.aria}
                onClick={state.off ? undefined : onClick}
                disabled={state.native}
                className={[
                    'rounded-full inline-flex items-center justify-center shrink-0',
                    'size-(--transport-size) pointer-coarse:size-(--transport-size-coarse)',
                    state.off ? 'cursor-not-allowed opacity-40' : `cursor-pointer ${classes.hover}`,
                    'focus-ring',
                    classes.look,
                    pressed ? PRESSED_CLASS : active ? classes.active : classes.idle,
                ].join(' ')}
                style={sizes}>
                {tone === 'record' ? <RecordDot active={active} /> : children}
            </button>
        </Tooltip>
    )
}

/** The record button's dot, 42% of the button's diameter so it follows the coarse size too. */
function RecordDot({ active }: { active?: boolean }) {
    return (
        <span
            className={[
                'size-[42%] rounded-full transition-[background-color] duration-200 ease-solkey',
                active ? 'bg-on-error shadow-none' : 'bg-error-container shadow-[inset_0_-2px_4px_rgba(0,0,0,0.18)]',
            ].join(' ')}
        />
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
                    'transition-colors duration-150 ease-solkey',
                    'focus-ring',
                    checked ? 'bg-primary-container' : 'bg-surface-container-high',
                ].join(' ')}>
                <span
                    className={[
                        'block w-4.5 h-4.5 rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,0.2)] transition-transform duration-200 ease-solkey',
                        checked ? 'translate-x-4.5' : 'translate-x-0',
                    ].join(' ')}
                />
            </button>
        </label>
    )
}
