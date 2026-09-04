'use client'

import { type ReactNode, useEffect, useRef } from 'react'

import { Eyebrow } from './Brand'

interface PopoverProps {
    /** Accessible dialog name, e.g. "Select clef". */
    ariaLabel: string
    /** Eyebrow heading. */
    title: ReactNode
    onDismiss: () => void
    /** Handles keys beyond Escape (which always dismisses). Keep referentially stable — it re-binds the window listener. */
    onKeyDown?: (e: KeyboardEvent) => void
    /** Absolute position within the nearest positioned ancestor. Omit to position via `className` instead. */
    x?: number
    y?: number
    /** Width/gap plus positioning classes (e.g. `w-max gap-2 right-0 top-full`). */
    className?: string
    /** Trigger element to exclude from outside-click dismissal, so its toggle isn't fought by the popover. */
    anchorRef?: { current: HTMLElement | null }
    /** Rendered on the far side of the eyebrow, e.g. a live readout. */
    headerRight?: ReactNode
    children: ReactNode
}

/**
 * Anchored transient panel: dialog role + eyebrow heading on a glass panel, dismissed
 * by Escape or clicking outside. The chrome mirror of `DialogScrim`/`DialogPanel` for
 * non-modal surfaces.
 */
export function Popover({ ariaLabel, title, onDismiss, onKeyDown, x, y, className, anchorRef, headerRight, children }: PopoverProps) {
    const popRef = useRef<HTMLDivElement>(null)

    // While a popover is open no key reaches the editor shortcuts underneath.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.preventDefault()
                onDismiss()
            } else onKeyDown?.(e)
            e.stopPropagation()
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
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
            style={x !== undefined && y !== undefined ? { left: x, top: y } : undefined}
            className={`glass-panel tonal-layer-glow absolute z-50 flex flex-col p-4 rounded-lg${className ? ` ${className}` : ''}`}
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
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
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
