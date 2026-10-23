'use client'

import { type AnimationEvent, type FocusEvent, type PointerEvent, useCallback, useEffect, useState } from 'react'

import { CloseButton } from './Buttons'
import { Icon, type IconName } from './Icon'

/**
 * `error`: something failed (the alert region, a red well). `info`: something happened as
 * asked (Saved, Copied — a cyan-soft well). `notice`: worth knowing, neither a success nor a
 * fault (a dropped connection, a hint — a neutral well). info and notice share the polite
 * region and the info duration.
 */
export type ToastTone = 'error' | 'info' | 'notice'

/** A button inside the toast; clicking it runs `onClick` and dismisses the toast. */
export interface ToastAction {
    label: string
    /** Accessible name when the visible label would clash with another control (e.g. 'Undo delete' vs the header's 'Undo'). */
    ariaLabel?: string
    onClick: () => void
}

export interface ToastOptions {
    /**
     * Overrides the tone's default glyph ('error' for errors, 'info' otherwise) so the well says
     * what happened: 'check' for a done action (Saved, Copied), 'info' for news, 'mic' for
     * recording hints, 'globe' when Solkey can't be reached, 'wifi-off' when the device is offline.
     */
    icon?: IconName
    /** Milliseconds before the toast dismisses itself; overrides the tone's default. */
    duration?: number
    /** Keep the toast until the user dismisses it — for errors that ask the user to act. */
    persist?: boolean
    /** One button — shorthand for `actions: [action]`. */
    action?: ToastAction
    /**
     * Up to two buttons, shown in this order (e.g. 'Hear it back' then 'Undo'). With
     * `action` as well, `action` comes first; anything past the second is dropped.
     */
    actions?: ToastAction[]
}

export interface ToastItem {
    id: number
    message: string
    tone: ToastTone
    icon?: IconName
    /** The toast's buttons in reading order, at most `ToastQueue.MAX_ACTIONS`. */
    actions: ToastAction[]
}

type PauseReason = 'hover' | 'focus' | 'touch'

/**
 * One toast's auto-dismiss clock. It counts down the toast's duration and holds
 * while anything pauses it (a hovering mouse, focus inside, a finger on it), then
 * carries on with the time that was left. A null duration never expires.
 */
class DismissTimer {
    private handle: ReturnType<typeof setTimeout> | null = null
    private startedAt = 0
    private remaining: number
    private readonly pausedBy = new Set<PauseReason>()

    constructor(
        private duration: number | null,
        private readonly onExpire: () => void,
    ) {
        this.remaining = duration ?? Infinity
        this.run()
    }

    /** Starts the full countdown again, e.g. when the same message is raised twice. */
    restart(duration: number | null) {
        this.stop()
        this.duration = duration
        this.remaining = duration ?? Infinity
        this.run()
    }

    pause(reason: PauseReason) {
        this.pausedBy.add(reason)
        this.stop()
    }

    resume(reason: PauseReason) {
        this.pausedBy.delete(reason)
        this.run()
    }

    clear() {
        this.stop()
    }

    private run() {
        if (this.duration == null || this.handle != null || this.pausedBy.size > 0) return
        this.startedAt = Date.now()
        this.handle = setTimeout(this.onExpire, Math.max(0, this.remaining))
    }

    private stop() {
        if (this.handle == null) return
        clearTimeout(this.handle)
        this.handle = null
        this.remaining -= Date.now() - this.startedAt
    }
}

/**
 * The toast stack's state: what is visible, how long each toast stays, and the
 * two-toast cap. Module-level (see `toasts` below) so non-React code — the React
 * Query caches, the recording socket — can raise toasts without a context.
 */
export class ToastQueue {
    static readonly MAX_VISIBLE = 2
    static readonly MAX_ACTIONS = 2
    static readonly INFO_MS = 6000
    static readonly ERROR_MIN_MS = 8000
    static readonly ERROR_MS_PER_WORD = 300

    /**
     * How long a toast stays: info 6 s; an error max(8 s, 0.3 s per word) so a long
     * one can be read; `duration` overrides both; `persist` (null) never expires.
     */
    static durationFor(message: string, tone: ToastTone, options: ToastOptions = {}): number | null {
        if (options.persist) return null
        if (options.duration != null) return options.duration
        if (tone !== 'error') return ToastQueue.INFO_MS
        const words = message.trim().split(/\s+/).filter(Boolean).length
        return Math.max(ToastQueue.ERROR_MIN_MS, words * ToastQueue.ERROR_MS_PER_WORD)
    }

    /** The buttons a toast shows: `action` first, then `actions`, capped at two. */
    static actionsFor(options: ToastOptions = {}): ToastAction[] {
        const { action, actions = [] } = options
        return [...(action ? [action] : []), ...actions].slice(0, ToastQueue.MAX_ACTIONS)
    }

    private nextId = 1
    private items: ToastItem[] = []
    private readonly timers = new Map<number, DismissTimer>()
    private readonly listeners = new Set<(items: ToastItem[]) => void>()

    get visible(): ToastItem[] {
        return this.items
    }

    subscribe(listener: (items: ToastItem[]) => void): () => void {
        this.listeners.add(listener)
        return () => {
            this.listeners.delete(listener)
        }
    }

    /** Raises a toast and returns its id (for `dismiss`). */
    show(message: string, tone: ToastTone, options: ToastOptions = {}): number {
        const duration = ToastQueue.durationFor(message, tone, options)
        const { icon } = options
        const actions = ToastQueue.actionsFor(options)
        // An identical visible toast is refreshed rather than stacked — repeated failures
        // (e.g. a retrying auto-save) shouldn't pile into a wall of red. It takes the newer
        // icon/actions, since a fresh action (an Undo) refers to the latest step.
        const existing = this.items.find((t) => t.message === message && t.tone === tone)
        if (existing) {
            this.items = this.items.map((t) => (t.id === existing.id ? { ...t, icon, actions } : t))
            this.timers.get(existing.id)?.restart(duration)
            this.emit()
            return existing.id
        }
        while (this.items.length >= ToastQueue.MAX_VISIBLE) this.remove(this.items[0].id)
        const item: ToastItem = { id: this.nextId++, message, tone, icon, actions }
        this.items = [...this.items, item]
        this.timers.set(item.id, new DismissTimer(duration, () => this.dismiss(item.id)))
        this.emit()
        return item.id
    }

    dismiss(id: number) {
        if (!this.items.some((t) => t.id === id)) return
        this.remove(id)
        this.emit()
    }

    pause(id: number, reason: PauseReason) {
        this.timers.get(id)?.pause(reason)
    }

    resume(id: number, reason: PauseReason) {
        this.timers.get(id)?.resume(reason)
    }

    /** Drops every toast (tests, sign-out). */
    clear() {
        for (const timer of this.timers.values()) timer.clear()
        this.timers.clear()
        this.items = []
        this.emit()
    }

    private remove(id: number) {
        this.timers.get(id)?.clear()
        this.timers.delete(id)
        this.items = this.items.filter((t) => t.id !== id)
    }

    private emit() {
        for (const listener of this.listeners) listener(this.items)
    }
}

/** The app-wide stack the Toaster renders. */
export const toasts = new ToastQueue()

/** A toast as the Toaster draws it: still showing, or a ghost of one that just left. */
export interface StagedToast {
    toast: ToastItem
    /** Gone from the queue: drawn inert while it plays toast-out, then dropped. */
    leaving: boolean
}

/**
 * The Toaster's render list. The queue drops a toast the moment it is dismissed or expires, so
 * its caps, dedupe and timers stay exact; the stage keeps a just-removed toast on screen as a
 * ghost, in its place, until its exit animation ends. Pure: each method returns a new list.
 */
export class ToastStage {
    /** A ghost leaves after this long even if its animationend never fires. */
    static readonly GHOST_MAX_MS = 300

    /** The next render list: toasts still visible keep their place (with their latest content), toasts that left become ghosts, new ones join the end. */
    static next(staged: StagedToast[], visible: ToastItem[]): StagedToast[] {
        const current = new Map(visible.map((t) => [t.id, t]))
        const next: StagedToast[] = staged.map(({ toast, leaving }) => {
            const live = current.get(toast.id)
            return live && !leaving ? { toast: live, leaving: false } : { toast, leaving: true }
        })
        const placed = new Set(staged.map((s) => s.toast.id))
        for (const toast of visible) if (!placed.has(toast.id)) next.push({ toast, leaving: false })
        return next
    }

    /** Drops a ghost whose exit has played. */
    static drop(staged: StagedToast[], id: number): StagedToast[] {
        return staged.filter((s) => !(s.leaving && s.toast.id === id))
    }
}

/**
 * Raises a toast. The third argument is either the glyph (the original signature)
 * or the options object. Returns the toast's id, for `dismissToast`.
 */
export function showToast(message: string, tone: ToastTone = 'error', iconOrOptions?: IconName | ToastOptions): number {
    const options = typeof iconOrOptions === 'string' ? { icon: iconOrOptions } : (iconOrOptions ?? {})
    return toasts.show(message, tone, options)
}

export function dismissToast(id: number) {
    toasts.dismiss(id)
}

const REGION_CLASS = 'flex flex-col items-center gap-3 max-w-full empty:-mt-3'

/**
 * The stack of opaque toast cards that surfaces toast messages. Mount once, in the root layout.
 * Both live regions are always in the DOM (screen readers miss messages in a region
 * that appears together with them): info and notice toasts in a polite `status` region,
 * errors in an `alert` region. A toast rises in over 200ms; one that leaves plays a 150ms
 * exit as an inert ghost (see ToastStage). The stack sits `--toast-bottom` above the
 * viewport's bottom edge (1.5rem by default; the editor raises it above its dock, a phone
 * sheet dialog above its footer), never under the safe-area inset.
 */
export function Toaster() {
    const [staged, setStaged] = useState<StagedToast[]>(() => ToastStage.next([], toasts.visible))

    useEffect(() => {
        const sync = (items: ToastItem[]) => setStaged((prev) => ToastStage.next(prev, items))
        sync(toasts.visible)
        return toasts.subscribe(sync)
    }, [])

    // Stable, so a ghost's fallback timer isn't restarted by every render of the stack.
    const drop = useCallback((id: number) => setStaged((prev) => ToastStage.drop(prev, id)), [])
    const region = (errors: boolean) =>
        staged
            .filter((s) => (s.toast.tone === 'error') === errors)
            .map((s) => <ToastCard key={s.toast.id} toast={s.toast} leaving={s.leaving} onLeft={drop} />)

    return (
        <div className="fixed bottom-[max(var(--toast-bottom,1.5rem),env(safe-area-inset-bottom))] left-1/2 -translate-x-1/2 z-(--z-toast) w-max max-w-[calc(100vw-2rem)] flex flex-col items-center gap-3 pointer-events-none">
            <div role="status" aria-live="polite" className={REGION_CLASS}>
                {region(false)}
            </div>
            <div role="alert" className={REGION_CLASS}>
                {region(true)}
            </div>
        </div>
    )
}

// The glyph well says what kind of news it is.
const TONE_WELL: Record<ToastTone, string> = {
    error: 'bg-error-container text-on-error-container',
    info: 'bg-primary-soft text-on-primary-soft',
    notice: 'bg-surface-container-high text-on-surface-variant',
}

interface ToastCardProps {
    toast: ToastItem
    /** A ghost: inert and hidden from assistive tech, it plays toast-out and then reports `onLeft`. */
    leaving?: boolean
    onLeft?: (id: number) => void
}

function ToastCard({ toast, leaving = false, onLeft }: ToastCardProps) {
    const { id, actions } = toast

    // The ghost goes on its animationend — never gated by motion-safe, so it also fires under
    // reduced motion (the global 0.01ms rule) — or after GHOST_MAX_MS, whichever comes first.
    useEffect(() => {
        if (!leaving) return
        const timer = setTimeout(() => onLeft?.(id), ToastStage.GHOST_MAX_MS)
        return () => clearTimeout(timer)
    }, [leaving, id, onLeft])
    const onAnimationEnd = (e: AnimationEvent) => {
        if (leaving && e.target === e.currentTarget) onLeft?.(id)
    }

    // Mouse hover pauses while the pointer is over the toast; a finger pauses only while it
    // is down (touch has no "leave", so a hover-style pause would hold forever).
    const reasonOf = (e: PointerEvent): 'hover' | 'touch' => (e.pointerType === 'mouse' ? 'hover' : 'touch')
    const onPointerEnter = (e: PointerEvent) => {
        if (reasonOf(e) === 'hover') toasts.pause(id, 'hover')
    }
    const onPointerLeave = (e: PointerEvent) => {
        if (reasonOf(e) === 'hover') toasts.resume(id, 'hover')
    }
    const onPointerDown = (e: PointerEvent) => {
        if (reasonOf(e) === 'touch') toasts.pause(id, 'touch')
    }
    const onPointerUp = (e: PointerEvent) => {
        if (reasonOf(e) === 'touch') toasts.resume(id, 'touch')
    }
    const onBlur = (e: FocusEvent) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) toasts.resume(id, 'focus')
    }
    // Two buttons beside the message leave a phone almost no room for it (at 320px about
    // 12px), so below `sm` such a toast becomes a two-row grid: the icon and message on the
    // first row with the × at its end, the buttons under them, their text lined up with the
    // message's (pl-7). The × stays last in the DOM — reading and tab order unchanged.
    const stacked = actions.length > 1
    return (
        <div
            inert={leaving || undefined}
            aria-hidden={leaving || undefined}
            onAnimationEnd={onAnimationEnd}
            onPointerEnter={onPointerEnter}
            onPointerLeave={onPointerLeave}
            onPointerDown={onPointerDown}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onFocus={() => toasts.pause(id, 'focus')}
            onBlur={onBlur}
            className={[
                'flex items-center gap-3 max-w-full sm:max-w-xl',
                stacked ? 'max-sm:grid max-sm:grid-cols-[1fr_auto] max-sm:gap-y-1' : '',
                // Opaque: a card over the page, never glass.
                'bg-surface-container-lowest shadow-overlay rounded-lg',
                'pl-3 pr-2 py-2.5',
                leaving
                    ? 'pointer-events-none animate-[toast-out_150ms_var(--ease-solkey)_forwards]'
                    : 'pointer-events-auto animate-[toast-in_200ms_var(--ease-solkey)]',
            ].join(' ')}>
            <span
                className={['min-w-0 flex-auto flex items-center gap-3', stacked ? 'max-sm:col-start-1 max-sm:row-start-1' : ''].join(' ')}>
                <span
                    className={['w-7 h-7 rounded-full shrink-0 inline-flex items-center justify-center', TONE_WELL[toast.tone]].join(' ')}>
                    <Icon name={toast.icon ?? (toast.tone === 'error' ? 'error' : 'info')} size={16} />
                </span>
                {/* Wraps between words, and inside a word too long for its line, never past the card. */}
                <span className="min-w-0 wrap-break-word font-body font-medium text-[13px] leading-[1.4] text-on-surface">
                    {toast.message}
                </span>
            </span>
            <span className={['shrink-0 ml-auto flex items-center gap-3', stacked ? 'max-sm:contents' : ''].join(' ')}>
                {actions.length > 0 && (
                    // Text (tertiary) buttons in reading order; 40px tall, the negative margin keeps
                    // the toast itself at its usual height.
                    <span
                        className={[
                            '-my-1.5 flex items-center',
                            stacked ? 'max-sm:col-span-2 max-sm:row-start-2 max-sm:justify-start max-sm:pl-7' : '',
                        ].join(' ')}>
                        {actions.map((action, i) => (
                            <button
                                key={i}
                                type="button"
                                aria-label={action.ariaLabel}
                                onClick={() => {
                                    action.onClick()
                                    toasts.dismiss(id)
                                }}
                                className={[
                                    'shrink-0 h-10 px-3 rounded-full bg-transparent border-0 cursor-pointer whitespace-nowrap',
                                    'font-label font-semibold text-[13px] leading-none text-primary hover:bg-surface-container-low',
                                    'transition-colors duration-150 ease-solkey focus-ring',
                                ].join(' ')}>
                                {action.label}
                            </button>
                        ))}
                    </span>
                )}
                <span className={['inline-flex', stacked ? 'max-sm:row-start-1 max-sm:col-start-2 max-sm:self-start' : ''].join(' ')}>
                    <CloseButton ariaLabel="Dismiss" onClick={() => toasts.dismiss(id)} />
                </span>
            </span>
        </div>
    )
}
