'use client'

import { Eyebrow } from '@mushee/ui'
import { type ReactNode, useEffect, useLayoutEffect, useRef } from 'react'

import { FOCUSABLE_SELECTOR } from './Dialog'

interface PopoverProps {
    /** Accessible dialog name, e.g. "Select clef". */
    ariaLabel: string
    /** Eyebrow heading. */
    title: ReactNode
    onDismiss: () => void
    /**
     * Handles keys beyond Escape (which always dismisses) — the only way popover content sees
     * keydown (see the listener below). Keep referentially stable — it re-binds the window listener.
     */
    onKeyDown?: (e: KeyboardEvent) => void
    /** Width/gap plus positioning classes (e.g. `w-max gap-2 right-0 top-full`). */
    className?: string
    /** Trigger element to exclude from outside-click dismissal, so its toggle isn't fought by the popover. */
    anchorRef?: { current: HTMLElement | null }
    /** Rendered on the far side of the eyebrow, e.g. a live readout. */
    headerRight?: ReactNode
    /**
     * Move focus to the panel's first control on open, and back to the trigger (the first
     * control in `anchorRef`) on close when focus was still inside — for menus opened from a
     * chip (HeaderMenu). Off for the editor's attribute popovers, which leave focus on the score.
     */
    manageFocus?: boolean
    children: ReactNode
}

/**
 * Anchored transient panel: dialog role + eyebrow heading on a glass panel, dismissed
 * by Escape or clicking outside. The chrome mirror of `DialogPanel` for
 * non-modal surfaces.
 */
export function Popover({
    ariaLabel,
    title,
    onDismiss,
    onKeyDown,
    className,
    anchorRef,
    headerRight,
    manageFocus = false,
    children,
}: PopoverProps) {
    const popRef = useRef<HTMLDivElement>(null)

    // A layout effect, not a passive one: its cleanup runs while the panel is still in the
    // document, so it can tell whether focus was inside it when the popover closed.
    useLayoutEffect(() => {
        const panel = popRef.current
        if (!manageFocus || !panel) return
        const trigger = anchorRef?.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR) ?? null
        panel.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)?.focus()
        return () => {
            // Only steal focus back when it is still inside the closing panel (not when the user clicked elsewhere).
            if (panel.contains(document.activeElement)) trigger?.focus()
        }
    }, [manageFocus, anchorRef])

    // While a popover is open no key reaches the editor shortcuts underneath. The listener
    // sits on window in the capture phase, so it runs before the editor container's own
    // keydown listener: Escape dismisses (and so no longer also collapses the selection);
    // every other key goes to `onKeyDown`, then stops here. Default actions still happen —
    // Tab moves focus, Enter/Space press the focused button, typing fills an input — but
    // React's handlers never see the event, so popover content handles keys through
    // `onKeyDown`, not a React onKeyDown.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            e.stopPropagation()
            if (e.key === 'Escape') {
                e.preventDefault()
                onDismiss()
            } else onKeyDown?.(e)
        }
        window.addEventListener('keydown', onKey, { capture: true })
        return () => window.removeEventListener('keydown', onKey, { capture: true })
    }, [onDismiss, onKeyDown])

    useEffect(() => {
        const onMouseDown = (e: MouseEvent) => {
            const target = e.target as Node
            if (popRef.current && !popRef.current.contains(target) && !anchorRef?.current?.contains(target)) onDismiss()
        }
        // Deferred a tick so the click that opened the popover doesn't immediately dismiss it.
        const t = setTimeout(() => document.addEventListener('mousedown', onMouseDown), 0)
        return () => {
            clearTimeout(t)
            document.removeEventListener('mousedown', onMouseDown)
        }
    }, [onDismiss, anchorRef])

    return (
        <div
            ref={popRef}
            role="dialog"
            aria-label={ariaLabel}
            className={`glass-panel tonal-layer-glow absolute z-(--z-popover) flex flex-col p-4 rounded-lg${className ? ` ${className}` : ''}`}
            onMouseDown={(e) => e.stopPropagation()}>
            {headerRight ? (
                <div className="flex justify-between items-center">
                    <Eyebrow>{title}</Eyebrow>
                    {headerRight}
                </div>
            ) : (
                <Eyebrow>{title}</Eyebrow>
            )}
            {children}
        </div>
    )
}

interface PopoverOptionProps {
    active: boolean
    onClick: () => void
    ariaLabel: string
    title?: string
    /** Size/layout classes (e.g. `justify-center w-11 h-11`). */
    className?: string
    children: ReactNode
}

/** A selectable cell in a popover option grid; `active` carries the loud primary fill. */
export function PopoverOption({ active, onClick, ariaLabel, title, className, children }: PopoverOptionProps) {
    return (
        <button
            type="button"
            aria-pressed={active}
            aria-label={ariaLabel}
            title={title}
            onClick={onClick}
            className={[
                'flex items-center rounded-md cursor-pointer border-0 shrink-0',
                'transition-[background-color,color] duration-150 ease-solkey',
                'focus-ring',
                active
                    ? 'bg-primary-container text-on-primary-container'
                    : 'bg-surface-container-low text-on-surface hover:bg-surface-container',
                className ?? '',
            ]
                .filter(Boolean)
                .join(' ')}>
            {children}
        </button>
    )
}
