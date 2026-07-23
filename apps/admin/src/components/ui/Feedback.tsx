'use client'

import { type ReactNode } from 'react'

import { Wordmark } from './Brand'
import { PrimaryButton, SecondaryButton } from './Buttons'
import { Icon } from './Icon'

interface AlertProps {
    children: ReactNode
    /** Label for the retry affordance; omit to hide it. */
    onRetry?: () => void
    retryLabel?: string
}

/**
 * Inline error banner for content that failed to load or save in place.
 * Tonal fill, no border — per the design system's no-line rule.
 */
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

interface ErrorScreenProps {
    title: string
    message: string
    /** Primary action, e.g. retry. */
    onRetry?: () => void
    retryLabel?: string
    /** Secondary escape hatch, e.g. back to the library. */
    onBack?: () => void
    backLabel?: string
}

/**
 * Full-page error state for when a page's primary data can't load at all —
 * worst case, the API server itself is unreachable.
 */
export function ErrorScreen({ title, message, onRetry, retryLabel = 'Try again', onBack, backLabel = 'Go back' }: ErrorScreenProps) {
    return (
        <div className="min-h-dvh bg-surface flex items-center justify-center">
            <div className="text-center flex flex-col items-center gap-4 max-w-md px-8">
                <Wordmark size={28} />
                <span className="w-11 h-11 rounded-full bg-error-container text-on-error-container inline-flex items-center justify-center">
                    <Icon name="error" size={22} />
                </span>
                <h1 className="font-headline font-bold text-[1.75rem] leading-tight text-on-surface m-0">{title}</h1>
                <p className="font-body font-normal text-[14px] leading-normal text-on-surface-variant m-0">{message}</p>
                <div className="flex items-center gap-3 mt-2">
                    {onRetry && (
                        <PrimaryButton icon="refresh-cw" onClick={onRetry}>
                            {retryLabel}
                        </PrimaryButton>
                    )}
                    {onBack && <SecondaryButton onClick={onBack}>{backLabel}</SecondaryButton>}
                </div>
            </div>
        </div>
    )
}
