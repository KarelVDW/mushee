import type { ReactNode } from 'react'

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
}

interface SegmentedProps<T> {
    options: SegmentedOption<T>[]
    value: T
    onChange: (v: T) => void
    ariaLabel: string
}

export function Segmented<T extends string | undefined>({ options, value, onChange, ariaLabel }: SegmentedProps<T>) {
    return (
        <div
            role="group"
            aria-label={ariaLabel}
            className="inline-flex gap-0.5 p-0.75 rounded-full bg-surface-container-lowest tonal-layer-glow">
            {options.map((o, i) => {
                const active = value === o.value
                return (
                    <button
                        key={i}
                        type="button"
                        aria-pressed={active}
                        onClick={() => onChange(o.value)}
                        className={[
                            'border-0 px-2.5 py-1.5 cursor-pointer rounded-full min-w-8.5',
                            'pointer-coarse:py-2.5 pointer-coarse:min-w-10',
                            'font-label font-semibold text-[14px] leading-none',
                            'inline-flex items-center justify-center',
                            'transition-[background-color,color] duration-150 ease-solkey',
                            'focus-ring',
                            active
                                ? 'bg-primary-container text-on-primary-container'
                                : 'bg-transparent text-on-surface-variant hover:bg-surface-container-high',
                        ].join(' ')}>
                        {o.label}
                    </button>
                )
            })}
        </div>
    )
}

interface ChipToggleProps {
    active?: boolean
    onClick?: () => void
    ariaLabel?: string
    children: ReactNode
    disabled?: boolean
    /** Transparent at rest — for chips inside a ToolGroup well, which provides the raised surface. */
    plain?: boolean
}

/**
 * Pressed-state toggle for editor chrome and header menus (primary-container when
 * active); for form option choice use Chip.
 */
export function ChipToggle({ active, onClick, ariaLabel, children, disabled, plain }: ChipToggleProps) {
    return (
        <button
            type="button"
            aria-label={ariaLabel}
            aria-pressed={active}
            disabled={disabled}
            onClick={onClick}
            className={[
                'border-0 rounded-full px-3.5 py-1.75 min-h-8 whitespace-nowrap',
                'pointer-coarse:min-h-10 pointer-coarse:px-4',
                'font-label font-semibold text-[13px] leading-none',
                'inline-flex items-center justify-center',
                'cursor-pointer disabled:cursor-not-allowed disabled:opacity-40',
                'transition-[background-color,color] duration-150 ease-solkey',
                'focus-ring',
                active
                    ? 'bg-primary-container text-on-primary-container'
                    : plain
                      ? 'bg-transparent text-on-surface enabled:hover:bg-surface-container-high'
                      : 'bg-surface-container-lowest tonal-layer-glow text-on-surface enabled:hover:bg-surface-container-high',
            ].join(' ')}>
            {children}
        </button>
    )
}

type TransportTone = 'neutral' | 'play' | 'record'

/**
 * Each tone's border (and padding), transition list and timing, hover scale and
 * active/idle palette. Neutral stays borderless with a quick colour-only fade;
 * play and record carry the 3px ring and grow slightly on hover.
 */
const TONE_CLASSES: Record<TransportTone, { look: string; active: string; idle: string }> = {
    neutral: {
        look: 'border-0 bg-surface-container-lowest enabled:hover:bg-surface-container-high transition-[background-color,color] duration-150 ease-solkey',
        active: 'text-primary',
        idle: 'text-on-surface-variant',
    },
    play: {
        look: 'p-0 border-[3px] border-primary-container transition-[transform,background-color,color] duration-200 ease-solkey enabled:hover:scale-105',
        active: 'bg-primary-container text-on-primary-container',
        idle: 'bg-surface-container-lowest text-primary',
    },
    record: {
        look: 'p-0 border-[3px] transition-[transform,background-color,border-color] duration-200 ease-solkey enabled:hover:scale-105',
        active: 'bg-error border-error',
        idle: 'bg-surface-container-lowest border-error-container',
    },
}

interface TransportBtnProps {
    size: number
    tone?: TransportTone
    active?: boolean
    onClick?: () => void
    ariaLabel: string
    /** The glyph; `record` draws its own dot instead. */
    children?: ReactNode
    disabled?: boolean
}

/** A round transport control (stop, play, record, metronome, and the phone dock's nudges). */
export function TransportBtn({ size, tone = 'neutral', active, onClick, ariaLabel, children, disabled }: TransportBtnProps) {
    const classes = TONE_CLASSES[tone]
    return (
        <button
            type="button"
            aria-label={ariaLabel}
            onClick={onClick}
            disabled={disabled}
            className={[
                'rounded-full inline-flex items-center justify-center shrink-0',
                'cursor-pointer disabled:cursor-not-allowed disabled:opacity-40',
                'focus-ring',
                classes.look,
                active ? classes.active : classes.idle,
            ].join(' ')}
            style={{ width: size, height: size }}>
            {tone === 'record' ? <RecordDot size={Math.round(size * 0.42)} active={active} /> : children}
        </button>
    )
}

function RecordDot({ size, active }: { size: number; active?: boolean }) {
    return (
        <span
            className={[
                'rounded-full transition-[background-color] duration-200 ease-solkey',
                active ? 'bg-on-error shadow-none' : 'bg-error-container shadow-[inset_0_-2px_4px_rgba(0,0,0,0.18)]',
            ].join(' ')}
            style={{ width: size, height: size }}
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
