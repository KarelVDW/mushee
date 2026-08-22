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

/** Card surface every panel in this app sits on. */
export function Card({ children, className }: { children: ReactNode; className?: string }) {
    return <div className={`bg-surface-container-lowest rounded-lg tonal-layer-glow px-5 py-4 ${className ?? ''}`}>{children}</div>
}
