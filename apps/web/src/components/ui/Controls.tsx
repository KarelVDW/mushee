'use client'

import { createContext, type CSSProperties, type ReactNode, useContext, useId } from 'react'

import { useRadioGroup } from '@/lib/useRadioGroup'

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
    /**
     * `header`: the editor header's slimmer well — 32px (44px on coarse pointers), its plain chips
     * 28px (40px) — so it lines up with the header's 32px chips.
     */
    size?: 'default' | 'header'
}

/** The size of the ToolGroup a control sits in (none outside one), so its plain chips can match the well. */
const ToolGroupContext = createContext<'default' | 'header' | null>(null)

/**
 * A white capsule well that makes a cluster of tool controls read as one group —
 * the no-line rule's tonal shift (`surface_container_lowest` + tonal glow, the card
 * lift) instead of borders or dividers. Controls inside it render `plain`
 * (transparent at rest); the well is what separates them from the chrome behind.
 */
export function ToolGroup({ ariaLabel, children, size = 'default' }: ToolGroupProps) {
    return (
        <div
            role="group"
            aria-label={ariaLabel}
            className={[
                'inline-flex items-center rounded-full bg-surface-container-lowest tonal-layer-glow',
                size === 'header' ? 'min-h-8 p-0.5 gap-0.5 pointer-coarse:min-h-11' : 'gap-0.5 p-0.75',
            ].join(' ')}>
            <ToolGroupContext.Provider value={size}>{children}</ToolGroupContext.Provider>
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
    /**
     * `default`: the compact track. `dock`: the dock's unit — 40px options (`--control-md`) in a
     * track 3px (`--well-pad`) bigger all round, so it lines up with the dock's other wells.
     */
    size?: 'default' | 'dock'
    /** Stretch across the row: the track grows and its options share the width equally. */
    fill?: boolean
    /**
     * `chrome` (default): the white track with its lift, for the chrome over the page. `inset`:
     * for a white panel or card, where a white track would vanish — a recessed
     * surface_container_low track with no lift, the picked option a raised white thumb.
     */
    tone?: 'chrome' | 'inset'
    /**
     * `toggle` (default): toggle buttons with aria-pressed. `radio`: one choice of a set — a
     * radiogroup of radios with aria-checked, one tab stop, and arrow keys that move and pick
     * (the billing toggle).
     */
    mode?: 'toggle' | 'radio'
}

/** A Segmented track and its options per size. */
const SEGMENTED_SIZES = {
    default: { track: 'gap-0.5 p-0.75', option: 'px-2.5 py-1.5 min-w-8.5 pointer-coarse:py-2.5 pointer-coarse:min-w-10' },
    dock: {
        track: 'h-[calc(var(--control-md)+2*var(--well-pad))] p-(--well-pad) gap-0.5',
        option: 'px-2.5 h-(--control-md) min-w-(--control-md)',
    },
} as const

/**
 * A row of mutually exclusive options in one track. Resting options are full-strength ink, like
 * every control in a well; the picked one is loud primary in the chrome tone (a pressed toggle
 * in a transparent-at-rest track) or a raised white thumb in the inset tone. Disabled, the glyphs
 * fade to 40% — a picked one keeps a grey thumb, never a pale cyan smudge.
 */
export function Segmented<T extends string | undefined>({
    options,
    value,
    onChange,
    ariaLabel,
    disabled,
    disabledReason,
    tooltipSide,
    size = 'default',
    fill = false,
    tone = 'chrome',
    mode = 'toggle',
}: SegmentedProps<T>) {
    const state = disabledState({ disabled, disabledReason })
    const radio = mode === 'radio'
    const radios = useRadioGroup(
        options.map((o) => o.value),
        value,
        (v) => {
            if (!state.off) onChange(v)
        },
    )
    const sizes = SEGMENTED_SIZES[size]
    const picked =
        tone === 'inset' ? 'bg-surface-container-lowest tonal-layer-glow text-on-surface' : 'bg-primary-container text-on-primary-container'
    return (
        <div
            role={radio ? 'radiogroup' : 'group'}
            aria-label={ariaLabel}
            aria-disabled={radio ? state.aria : undefined}
            className={[
                fill ? 'flex flex-1' : 'inline-flex',
                'rounded-full',
                sizes.track,
                tone === 'inset' ? 'bg-surface-container-low' : 'bg-surface-container-lowest tonal-layer-glow',
            ].join(' ')}>
            {options.map((o, i) => {
                const active = value !== null && value === o.value
                return (
                    <Tooltip key={i} {...tooltipFor({ ...o, tooltipSide }, o.ariaLabel, state.reason)}>
                        <button
                            type="button"
                            {...(radio ? radios.radioProps(i) : {})}
                            role={radio ? 'radio' : undefined}
                            aria-label={o.ariaLabel}
                            aria-pressed={radio ? undefined : active}
                            aria-checked={radio ? active : undefined}
                            aria-disabled={state.aria}
                            disabled={state.native}
                            onClick={state.off ? undefined : () => onChange(o.value)}
                            className={[
                                'border-0 rounded-full',
                                sizes.option,
                                fill ? 'flex-1 min-w-0' : '',
                                'font-label font-semibold text-[14px] leading-none',
                                'inline-flex items-center justify-center',
                                'transition-[background-color,color,box-shadow] duration-150 ease-solkey',
                                'focus-ring',
                                state.off ? 'cursor-not-allowed' : 'cursor-pointer',
                                state.off
                                    ? active
                                        ? 'bg-surface-container-high text-on-surface'
                                        : 'bg-transparent text-on-surface'
                                    : active
                                      ? picked
                                      : 'bg-transparent text-on-surface hover:bg-surface-container-high',
                            ]
                                .filter(Boolean)
                                .join(' ')}>
                            {state.off ? <span className="inline-flex items-center opacity-40">{o.label}</span> : o.label}
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
    /**
     * `default`: the 32px chip (40px on coarse pointers). `dock`: the dock's unit, 40px tall and
     * at least as wide (44px coarse), so a 3px well around it makes the dock's 46px (50px) row.
     * `lg`: a 44px chip with a 14px label, for a page's one menu beside its big CTA.
     */
    size?: 'default' | 'dock' | 'lg'
    /** An icon-only circle of the size's height: 32px (40px coarse), 40px (44px) in the dock, or 44px. */
    round?: boolean
}

/** A ChipToggle's box and label size per size: a full pill, or with `round` a circle of the same height. */
const CHIP_SIZES = {
    default: { pill: 'h-(--control-sm) px-3.5 pointer-coarse:px-4', round: 'size-(--control-sm) p-0', text: 'text-[13px]' },
    dock: { pill: 'h-(--control-md) min-w-(--control-md) px-3', round: 'size-(--control-md) p-0', text: 'text-[13px]' },
    lg: { pill: 'h-11 px-5', round: 'size-11 p-0', text: 'text-[14px]' },
} as const

/** A plain chip inside a header-sized ToolGroup: 28px in its 32px well (40px in a 44px one on touch). */
const HEADER_WELL_CHIP = 'h-7 min-w-9 px-2.5 pointer-coarse:h-10 pointer-coarse:min-w-10'

/** The press every unpressed chip shares: a tonal step on touch and a slight shrink (more on touch, none under reduced motion). */
const CHIP_PRESS =
    'pointer-coarse:active:bg-surface-container-high motion-safe:active:scale-[0.97] pointer-coarse:motion-safe:active:scale-[0.94]'

/**
 * Pressed-state toggle for editor chrome and header menus (primary-container when pressed);
 * for form option choice use Chip. With `popup` it is a menu trigger instead, and open it turns
 * one tonal step darker — never cyan: it is open, not chosen, and the panel shows that. Disabled,
 * it keeps its surface and fades only its content, so a disabled Undo still reads as a control
 * (an active one shows the open tone, faded).
 */
export function ChipToggle({
    active,
    onClick,
    ariaLabel,
    children,
    disabled,
    disabledReason,
    plain,
    popup,
    size = 'default',
    round = false,
    ...tip
}: ChipToggleProps) {
    const state = disabledState({ disabled, disabledReason })
    const well = useContext(ToolGroupContext)
    const rest = plain ? 'bg-transparent text-on-surface' : 'bg-surface-container-lowest tonal-layer-glow text-on-surface'
    const pressed = !popup && !!active
    const box = plain && well === 'header' && !round ? HEADER_WELL_CHIP : CHIP_SIZES[size][round ? 'round' : 'pill']
    const palette = state.off
        ? active
            ? 'bg-surface-container-high text-on-surface'
            : rest
        : pressed
          ? 'bg-primary-container text-on-primary-container active:brightness-95'
          : active
            ? `bg-surface-container-high text-on-surface ${CHIP_PRESS}`
            : `${rest} hover:bg-surface-container-high ${CHIP_PRESS}`
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
                    'border-0 rounded-full whitespace-nowrap',
                    box,
                    'font-label font-semibold leading-none',
                    CHIP_SIZES[size].text,
                    'inline-flex items-center justify-center',
                    state.off ? 'cursor-not-allowed' : 'cursor-pointer',
                    'transition-[transform,scale,background-color,color,filter] duration-150 ease-solkey',
                    'focus-ring',
                    palette,
                ].join(' ')}>
                {state.off ? <span className="inline-flex items-center gap-[inherit] opacity-40">{children}</span> : children}
            </button>
        </Tooltip>
    )
}

type TransportTone = 'neutral' | 'play' | 'record'

/**
 * Each tone's border (and padding), transition list and timing, hover effect and
 * active/idle palette. Neutral stays borderless with a quick colour-only fade. Play is a
 * white disc with the card lift — no ring, so it never competes with the record ring beside
 * it — and fills with the primary while playing. Record carries the 3px recording-red ring
 * round a flat red dot, and fills red while live. Both grow slightly on hover and sink a little
 * when pressed (not under reduced motion).
 */
const TONE_CLASSES: Record<TransportTone, { look: string; hover: string; active: string; idle: string }> = {
    neutral: {
        look: 'border-0 transition-[background-color,color] duration-150 ease-solkey',
        hover: 'hover:bg-surface-container-high',
        active: 'bg-surface-container-lowest text-primary',
        idle: 'bg-surface-container-lowest text-on-surface-variant',
    },
    play: {
        look: 'p-0 border-0 transition-[transform,scale,background-color,color] duration-200 ease-solkey',
        hover: 'motion-safe:hover:scale-105 motion-safe:active:scale-[0.96]',
        active: 'bg-primary-container text-on-primary-container',
        idle: 'bg-surface-container-lowest tonal-layer-glow text-primary',
    },
    record: {
        look: 'p-0 border-[3px] transition-[transform,scale,background-color,border-color] duration-200 ease-solkey',
        hover: 'motion-safe:hover:scale-105 motion-safe:active:scale-[0.96]',
        active: 'bg-record border-record',
        idle: 'bg-surface-container-lowest border-record',
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
    /**
     * A longer spoken description (aria-describedby), separate from the tooltip's `hint`:
     * what a screen reader hears after the name, never shown on screen.
     */
    description?: string
    /** The glyph; `record` draws its own (a dot, or the stop square while `active`). */
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
    description,
    children,
    disabled,
    disabledReason,
    ...tip
}: TransportBtnProps) {
    const classes = TONE_CLASSES[tone]
    const state = disabledState({ disabled, disabledReason })
    const descriptionId = useId()
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
                // The tooltip adds its own hint/key/reason id after this one, and again when this changes.
                aria-describedby={description ? descriptionId : undefined}
                onClick={state.off ? undefined : onClick}
                disabled={state.native}
                className={[
                    'relative rounded-full inline-flex items-center justify-center shrink-0',
                    'size-(--transport-size) pointer-coarse:size-(--transport-size-coarse)',
                    // A pressed toggle keeps its fill under the pointer, as ChipToggle does.
                    state.off ? 'cursor-not-allowed opacity-40' : pressed ? 'cursor-pointer' : `cursor-pointer ${classes.hover}`,
                    'focus-ring',
                    classes.look,
                    pressed ? PRESSED_CLASS : active ? classes.active : classes.idle,
                ].join(' ')}
                style={sizes}>
                {tone === 'record' ? <RecordGlyph active={active} /> : children}
            </button>
            {description && (
                <span id={descriptionId} hidden>
                    {description}
                </span>
            )}
        </Tooltip>
    )
}

/**
 * The record button's glyph, sized to the button so it follows the coarse size too: a flat
 * recording-red dot (42% of the diameter) at rest, and while a take runs a white rounded stop
 * square (36%) on the red fill — the universal stop sign, so the live state reads by shape, not
 * colour alone. The two crossfade over 150ms; under reduced motion they swap at once.
 */
function RecordGlyph({ active }: { active?: boolean }) {
    const fade = 'absolute transition-opacity duration-150 ease-solkey motion-reduce:transition-none'
    return (
        <>
            <span aria-hidden className={[fade, 'size-[42%] rounded-full bg-record', active ? 'opacity-0' : 'opacity-100'].join(' ')} />
            <span
                aria-hidden
                data-stop-glyph
                className={[fade, 'size-[36%] rounded-[22%] bg-on-record', active ? 'opacity-100' : 'opacity-0'].join(' ')}
            />
        </>
    )
}

interface SwitchProps {
    checked: boolean
    onChange: (v: boolean) => void
    label: ReactNode
    /** One plain line under the label saying what the switch does; also its aria-describedby. */
    hint?: string
    /** Set the label in semibold — for a switch that heads its own section. */
    labelEmphasis?: boolean
}

/**
 * An on/off switch with its label (and optional hint) on the left. The whole row is a
 * `<label>`, so a press anywhere toggles it; the switch is named by the label alone and
 * described by the hint. Off is a grey track with a small outline-grey knob (the knob carries
 * the 3:1 contrast); on, the track fills with the primary and the knob grows white and slides
 * across — the position and size say on, no check glyph.
 */
export function Switch({ checked, onChange, label, hint, labelEmphasis = false }: SwitchProps) {
    const id = useId()
    const labelId = `${id}-label`
    const hintId = `${id}-hint`
    return (
        <label className="flex justify-between items-center gap-4 cursor-pointer">
            <span className="flex flex-col gap-0.5 min-w-0">
                <span
                    id={labelId}
                    className={`font-body ${labelEmphasis ? 'font-semibold' : 'font-normal'} text-[14px] leading-[1.4] text-on-surface`}>
                    {label}
                </span>
                {hint && (
                    <span id={hintId} className="font-body font-normal text-[12px] leading-[1.4] text-on-surface-variant">
                        {hint}
                    </span>
                )}
            </span>
            <button
                type="button"
                role="switch"
                aria-checked={checked}
                aria-labelledby={labelId}
                aria-describedby={hint ? hintId : undefined}
                onClick={() => onChange(!checked)}
                className={[
                    'w-10 h-5.5 rounded-full border-0 p-0.5 cursor-pointer relative shrink-0 inline-flex items-center',
                    'transition-colors duration-150 ease-solkey',
                    'focus-ring',
                    checked ? 'bg-primary-container' : 'bg-surface-container-highest',
                ].join(' ')}>
                <span
                    aria-hidden="true"
                    className={[
                        'block rounded-full shadow-[0_1px_2px_rgb(45_47_47/0.24)]',
                        'transition-[translate,width,height,background-color] duration-200 ease-solkey',
                        checked ? 'size-4.5 translate-x-4.5 bg-surface-container-lowest' : 'size-3.5 translate-x-0.5 bg-outline',
                    ].join(' ')}
                />
            </button>
        </label>
    )
}
