import type { ReactNode } from 'react'

export { IconButton, PrimaryButton, SecondaryButton, TertiaryButton, ToggleButton } from './Buttons'
export { Alert, Spinner } from './Feedback'
export { Icon } from './Icon'
export { Chip, TextArea, TextField } from './Inputs'

/** Small uppercase section label — the design system's card eyebrow. */
export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
    return (
        <span
            className={`font-label font-semibold text-[11px] leading-none tracking-[0.12em] uppercase text-on-surface-variant ${className ?? ''}`}>
            {children}
        </span>
    )
}

/**
 * Card surface every panel in this app sits on. `flush` drops the padding for
 * edge-to-edge content like tables; a `p-0` className can't, because Tailwind
 * emits the padding shorthand before the px/py longhands it would override.
 */
export function Card({ children, className, flush }: { children: ReactNode; className?: string; flush?: boolean }) {
    return (
        <div className={`bg-surface-container-lowest rounded-lg tonal-layer-glow ${flush ? '' : 'px-5 py-4'} ${className ?? ''}`}>
            {children}
        </div>
    )
}
