'use client'

import { type ReactNode } from 'react'

import { Icon } from './Icon'

interface AlertProps {
    children: ReactNode
    onRetry?: () => void
    retryLabel?: string
}

/** Inline error banner — tonal fill, no border, per the design system. */
export function Alert({ children, onRetry, retryLabel = 'Try again' }: AlertProps) {
    return (
        <div className="bg-error-container text-on-error-container rounded-md px-3.5 py-3 flex items-center gap-3" role="alert">
            <Icon name="error" size={18} className="shrink-0" />
            <span className="font-body font-normal text-[13px] leading-normal flex-1">{children}</span>
            {onRetry && (
                <button
                    type="button"
                    onClick={onRetry}
                    className={[
                        'bg-transparent border-0 cursor-pointer shrink-0 inline-flex items-center gap-1.5 p-1',
                        'font-label font-semibold text-[12px] tracking-[0.01em] text-on-error-container',
                        'underline underline-offset-2 hover:no-underline',
                    ].join(' ')}>
                    <Icon name="refresh-cw" size={14} />
                    {retryLabel}
                </button>
            )}
        </div>
    )
}

/** Rotating loader glyph for in-flight actions. */
export function Spinner({ size = 16 }: { size?: number }) {
    return (
        <span className="inline-flex animate-[solkey-spin_1s_linear_infinite] text-on-surface-variant">
            <Icon name="loader" size={size} />
        </span>
    )
}
