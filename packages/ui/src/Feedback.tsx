'use client'

import Link from 'next/link'
import { type ReactNode, useEffect, useRef, useState, useSyncExternalStore } from 'react'

import { Eyebrow, Wordmark } from './Brand'
import { PrimaryButton, SecondaryButton } from './Buttons'
import { Icon } from './Icon'

type AlertTone = 'fault' | 'form'

interface AlertProps {
    children: ReactNode
    /** Shows a retry affordance; omit to hide it. */
    onRetry?: () => void
    /** Its label. */
    retryLabel?: string
    /**
     * `fault` (default): something really failed (a load, a save, the network) — the loud
     * error_container slab. `form`: the user can fix it (credentials don't match, an account
     * exists) — the quiet error_soft tier, the icon and inline links in `error`.
     */
    tone?: AlertTone
}

const ALERT_TONES: Record<AlertTone, { box: string; icon: string; retry: string }> = {
    fault: {
        box: 'bg-error-container text-on-error-container rounded-md px-3.5 py-3',
        icon: '',
        retry: 'text-on-error-container',
    },
    form: {
        // Body 11.8:1 and links 5.9:1 on error_soft.
        box: 'bg-error-soft text-on-surface rounded-md px-4 py-3 [&_a]:text-error [&_a]:font-medium [&_a]:underline',
        icon: 'text-error',
        retry: 'text-error',
    },
}

/**
 * Inline error banner for content that failed to load or save in place (`fault`), or for a
 * form-level message the user can act on (`form`). Tonal fill, no border — per the design
 * system's no-line rule.
 */
export function Alert({ children, onRetry, retryLabel = 'Try again', tone = 'fault' }: AlertProps) {
    const palette = ALERT_TONES[tone]
    return (
        <div className={`${palette.box} flex items-center gap-3`} role="alert">
            <Icon name="error" size={18} className={`shrink-0 ${palette.icon}`} />
            <span className="font-body font-normal text-[13px] leading-normal flex-1 text-pretty">{children}</span>
            {onRetry && (
                <button
                    type="button"
                    onClick={onRetry}
                    className={[
                        'bg-transparent border-0 cursor-pointer shrink-0 inline-flex items-center gap-1.5 p-1',
                        `font-label font-semibold text-[12px] tracking-[0.01em] ${palette.retry}`,
                        'underline underline-offset-2 hover:no-underline',
                    ].join(' ')}>
                    <Icon name="refresh-cw" size={14} />
                    {retryLabel}
                </button>
            )}
        </div>
    )
}

/** A secondary action ErrorScreen renders itself, as a SecondaryButton (a link with `href`). */
interface ErrorScreenAction {
    label: string
    href?: string
    onClick?: () => void
}

interface ErrorScreenProps {
    title: string
    message: string
    /**
     * `fault` (default): something really broke — the red error well. `unreachable`: the
     * app can't connect — a neutral well, the offline copy when the device has no network,
     * and a retry the moment the connection comes back. `missing`: what was asked for isn't
     * there (a deleted score, a 404) — no fault, so no well: pass an `illustration`.
     */
    tone?: 'fault' | 'unreachable' | 'missing'
    /** Primary action, e.g. retry. */
    onRetry?: () => void
    /** A retry is in flight — shows a quiet 'Trying again…' line. */
    retrying?: boolean
    /** The escape hatch, e.g. back to the library: secondary next to a retry, primary without one. */
    onBack?: () => void
    /** Renders the escape hatch as a link (e.g. the 404's 'Go to the home page' → '/'). */
    backHref?: string
    backLabel?: string
    /**
     * One more action after the buttons. Pass `{ label, href | onClick }` and it renders as the
     * screen's SecondaryButton (the second action is always one); a node renders as given.
     */
    secondaryAction?: ReactNode | ErrorScreenAction
    /** What fills the 64px slot above the title in place of the tone's well (e.g. the missing tone's mark). */
    illustration?: ReactNode
}

function isScreenAction(action: ErrorScreenProps['secondaryAction']): action is ErrorScreenAction {
    return typeof action === 'object' && action !== null && 'label' in action && typeof action.label === 'string'
}

export const OFFLINE_TITLE = "You're offline"
export const OFFLINE_MESSAGE = "Solkey needs the internet to open your scores. We'll pick up again as soon as you're back online."

function subscribeToConnection(onChange: () => void) {
    window.addEventListener('online', onChange)
    window.addEventListener('offline', onChange)
    return () => {
        window.removeEventListener('online', onChange)
        window.removeEventListener('offline', onChange)
    }
}

/** navigator.onLine, live; true on the server and through hydration. */
function useOnline(): boolean {
    return useSyncExternalStore(
        subscribeToConnection,
        () => navigator.onLine,
        () => true,
    )
}

/**
 * Full-page error state for when a page's primary data can't load at all —
 * worst case, the API server itself is unreachable.
 */
export function ErrorScreen({
    title,
    message,
    tone = 'fault',
    onRetry,
    retrying = false,
    onBack,
    backHref,
    backLabel = 'Go back',
    secondaryAction,
    illustration,
}: ErrorScreenProps) {
    const online = useOnline()
    const unreachable = tone === 'unreachable'
    const offline = unreachable && !online

    // Coming back online retries straight away; the ref keeps the listener stable across renders.
    const retryRef = useRef(onRetry)
    useEffect(() => {
        retryRef.current = onRetry
    })
    useEffect(() => {
        if (!unreachable) return
        const retry = () => retryRef.current?.()
        window.addEventListener('online', retry)
        return () => window.removeEventListener('online', retry)
    }, [unreachable])

    const hasBack = onBack != null || backHref != null
    const BackButton = onRetry ? SecondaryButton : PrimaryButton
    // The 56px well a fault or an unreachable server shows; a missing page has none.
    const well =
        tone === 'missing' ? null : (
            <span
                className={[
                    'size-14 rounded-full inline-flex items-center justify-center',
                    unreachable ? 'bg-surface-container-high text-on-surface-variant' : 'bg-error-container text-on-error-container',
                ].join(' ')}>
                <Icon name={unreachable ? (offline ? 'wifi-off' : 'globe') : 'error'} size={28} />
            </span>
        )
    const art = illustration ?? well
    return (
        <div className="min-h-dvh bg-surface">
            {/* The wordmark where TopNav puts it, linking home — not inside the stack. */}
            <div className="h-16 px-5 sm:px-8 flex items-center">
                <Link
                    href="/"
                    aria-label="Solkey home"
                    className="no-underline inline-flex items-center rounded-sm pointer-coarse:min-h-10 focus-ring">
                    <Wordmark size={24} />
                </Link>
            </div>
            {/* Optically centred: 8vh of extra room below. */}
            <div className="grid place-items-center min-h-[calc(100dvh-4rem)] pb-[8vh] px-6">
                <div className="text-center flex flex-col items-center max-w-md">
                    {art != null && <div className="h-16 mb-6 flex items-center justify-center">{art}</div>}
                    <h1 className="font-headline font-bold text-[28px] leading-[1.15] text-on-surface m-0 text-balance">
                        {offline ? OFFLINE_TITLE : title}
                    </h1>
                    <p className="mt-3 font-body font-normal text-[15px] leading-normal text-pretty max-w-[36ch] text-on-surface-variant m-0">
                        {offline ? OFFLINE_MESSAGE : message}
                    </p>
                    <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
                        {onRetry && (
                            <PrimaryButton icon="refresh-cw" onClick={onRetry}>
                                Try again
                            </PrimaryButton>
                        )}
                        {hasBack &&
                            (backHref != null ? (
                                <BackButton href={backHref} onClick={onBack}>
                                    {backLabel}
                                </BackButton>
                            ) : (
                                <BackButton onClick={onBack}>{backLabel}</BackButton>
                            ))}
                        {isScreenAction(secondaryAction) ? (
                            secondaryAction.href != null ? (
                                <SecondaryButton href={secondaryAction.href} onClick={secondaryAction.onClick}>
                                    {secondaryAction.label}
                                </SecondaryButton>
                            ) : (
                                <SecondaryButton onClick={secondaryAction.onClick}>{secondaryAction.label}</SecondaryButton>
                            )
                        ) : (
                            secondaryAction
                        )}
                    </div>
                    {onRetry && (
                        <p
                            role="status"
                            className="mt-3 font-body font-normal text-[13px] leading-[1.4] min-h-[1.4em] text-on-surface-variant m-0">
                            {retrying ? 'Trying again…' : ''}
                        </p>
                    )}
                </div>
            </div>
        </div>
    )
}

/**
 * The quiet success mark: a check in a primary_soft disc (40px inline, 56px for a screen's
 * headline moment). Loud primary_container stays for actions, never a status. Decorative.
 */
export function SuccessMark({ size = 56 }: { size?: 40 | 56 }) {
    return (
        <span
            aria-hidden="true"
            className={`${size === 40 ? 'size-10' : 'size-14'} shrink-0 rounded-full bg-primary-soft text-on-primary-soft inline-flex items-center justify-center`}>
            <Icon name="check" size={size / 2} />
        </span>
    )
}

/**
 * A loading placeholder in the shape of what's coming: a surface_container block on the slow
 * 1.6s pulse (static under reduced motion), hidden from assistive tech. Size, shape and tone
 * come from `className` (e.g. `h-3 w-40`, `size-11 rounded-full`, `bg-surface-container-low`).
 */
export function Skeleton({ className }: { className?: string }) {
    const classes = className ?? ''
    // Defaults the caller can override with its own corner or fill.
    const shape = /(^|\s)rounded(-|\s|$)/.test(classes) ? '' : 'rounded-md'
    const fill = /(^|\s)bg-/.test(classes) ? '' : 'bg-surface-container'
    return <span aria-hidden="true" className={['block animate-solkey-pulse motion-reduce:animate-none', shape, fill, classes].join(' ')} />
}

export const SLOW_LOADING_MS = 10_000
export const SLOW_LOADING_MESSAGE = 'Still loading — slow connections can take a little longer.'

/** Five staff lines on a slow 1.6 s pulse (static under reduced motion) — the skeleton for anything score-shaped. */
export function StaffSkeleton() {
    return (
        <span aria-hidden="true" className="flex flex-col gap-2 w-60 max-w-full animate-solkey-pulse motion-reduce:animate-none">
            {Array.from({ length: 5 }).map((_, i) => (
                <span key={i} className="block h-px bg-outline-variant" />
            ))}
        </span>
    )
}

interface LoadingStatusProps {
    /** What is happening right now, e.g. 'Opening your score…'; callers swap it as the stages advance. */
    message: ReactNode
    /** The shape of what's coming; defaults to the staff skeleton (the library passes skeleton rows). */
    skeleton?: ReactNode
    /** Offered next to the slow-connection line, e.g. a TertiaryButton 'Try again'. */
    slowAction?: ReactNode
    slowAfterMs?: number
}

/**
 * A loading state that shows signs of life: a pulsing skeleton, a 14px line saying
 * what is happening (announced politely), and after 10 s a reassurance that slow
 * connections take a little longer, plus an optional way out.
 */
export function LoadingStatus({ message, skeleton = <StaffSkeleton />, slowAction, slowAfterMs = SLOW_LOADING_MS }: LoadingStatusProps) {
    const [slow, setSlow] = useState(false)
    useEffect(() => {
        const timer = setTimeout(() => setSlow(true), slowAfterMs)
        return () => clearTimeout(timer)
    }, [slowAfterMs])
    return (
        <div className="flex flex-col items-center gap-4 w-full">
            {skeleton}
            <div role="status" aria-live="polite" className="flex flex-col items-center gap-1.5 text-center">
                <span className="font-body font-normal text-[14px] leading-normal text-on-surface-variant text-pretty">{message}</span>
                {slow && (
                    <span className="font-body font-normal text-[13px] leading-normal text-on-surface-variant text-pretty">
                        {SLOW_LOADING_MESSAGE}
                    </span>
                )}
            </div>
            {slow && slowAction}
        </div>
    )
}

/** Full-page {@link LoadingStatus} under the wordmark — the editor's first paint. */
export function LoadingScreen({ testId, ...status }: LoadingStatusProps & { testId?: string }) {
    return (
        <div data-testid={testId} className="min-h-dvh bg-surface flex items-center justify-center px-8">
            <div className="flex flex-col items-center gap-6 w-full max-w-md">
                <Wordmark size={28} />
                <LoadingStatus {...status} />
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
 * current one, and an "n of total" label. A newly reached segment's fill sweeps in
 * from the left (300ms, like the input stroke; at once under reduced motion).
 * Segments cap at 48px so a long flow stays compact; `fill` stretches them across
 * the row instead.
 */
export function StepProgress({ step, total, fill = false }: { step: number; total: number; fill?: boolean }) {
    const current = Math.min(step + 1, total)
    return (
        <div
            role="progressbar"
            aria-valuemin={1}
            aria-valuemax={total}
            aria-valuenow={current}
            aria-valuetext={`Step ${current} of ${total}`}
            className={`flex items-center ${fill ? 'gap-2' : 'gap-1.5'}`}>
            {Array.from({ length: total }).map((_, i) => (
                <div key={i} className={['h-1 rounded-sm flex-1 overflow-hidden bg-surface-container', fill ? '' : 'max-w-12'].join(' ')}>
                    <div
                        className={[
                            'bg-primary-container h-full origin-left transition-transform duration-(--t-flow) ease-solkey',
                            i <= step ? 'scale-x-100' : 'scale-x-0',
                        ].join(' ')}
                    />
                </div>
            ))}
            <Eyebrow className="ml-2">
                {current} of {total}
            </Eyebrow>
        </div>
    )
}

/** Rotating loader glyph for in-flight actions. */
export function Spinner({ size = 16 }: { size?: number }) {
    return (
        <span className="inline-flex animate-solkey-spin-glyph text-on-surface-variant">
            <Icon name="loader" size={size} />
        </span>
    )
}
