'use client'

import { type ReactNode } from 'react'

import { Eyebrow, Wordmark } from './Brand'
import { PrimaryButton, SecondaryButton } from './Buttons'
import { Icon } from './Icon'

interface AlertProps {
    children: ReactNode
    /** Shows a retry affordance; omit to hide it. */
    onRetry?: () => void
    /** Its label. */
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
    /** Secondary escape hatch, e.g. back to the library. */
    onBack?: () => void
    backLabel?: string
}

/**
 * Full-page error state for when a page's primary data can't load at all —
 * worst case, the API server itself is unreachable.
 */
export function ErrorScreen({ title, message, onRetry, onBack, backLabel = 'Go back' }: ErrorScreenProps) {
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
                            Try again
                        </PrimaryButton>
                    )}
                    {onBack && <SecondaryButton onClick={onBack}>{backLabel}</SecondaryButton>}
                </div>
            </div>
        </div>
    )
}

/**
 * A spinner over a one-line caption — what a dialog shows while it waits on a
 * redirect or a round trip it cannot skip (e.g. Polar's checkout).
 */
export function BusyNotice({ children }: { children: ReactNode }) {
    return (
        <div className="flex flex-col items-center gap-3.5 px-4 py-6">
            <span className="w-10 h-10 rounded-full border-[3px] border-surface-container border-t-primary animate-solkey-spin" />
            <span className="font-body font-normal text-[13px] leading-normal text-on-surface-variant text-center max-w-90">
                {children}
            </span>
        </div>
    )
}

/**
 * A multi-step flow's position: one segment per step, filled up to the
 * current one, and an "n of total" label. Segments cap at 48px so a long flow
 * stays compact; `fill` stretches them across the row instead.
 */
export function StepProgress({ step, total, fill = false }: { step: number; total: number; fill?: boolean }) {
    return (
        <div className={`flex items-center ${fill ? 'gap-2' : 'gap-1.5'}`}>
            {Array.from({ length: total }).map((_, i) => (
                <div
                    key={i}
                    className={[
                        'h-1 rounded-sm flex-1 transition-colors duration-200 ease-solkey',
                        fill ? '' : 'max-w-12',
                        i <= step ? 'bg-primary-container' : 'bg-surface-container',
                    ].join(' ')}
                />
            ))}
            <Eyebrow className="ml-2">
                {Math.min(step + 1, total)} of {total}
            </Eyebrow>
        </div>
    )
}
